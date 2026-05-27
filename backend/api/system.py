from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Query, Body
from fastapi.responses import StreamingResponse
from system.hardware import detect_hardware
from system.resources import get_hardware_with_allocation, save_allocation
from system.installer import (
    install_ollama,
    start_ollama,
    check_ollama_running,
    is_ollama_installed,
    ollama_diagnostics,
    list_models,
    delete_model,
    uninstall_ollama,
)
from system.python_env import is_venv_ready, purge_venv, venv_path
from scheduler.jobs import (
    run_scan_ingest,
    run_ai_filter,
    get_scheduler,
    stop_scheduler,
    is_scan_running,
    get_scan_progress,
    request_scan_stop,
)
from config import settings
from perf import perf_snapshot, perf_reset
import json, asyncio, shutil, os, platform, subprocess, zipfile
from datetime import datetime, timezone
from pathlib import Path
import time

router = APIRouter(prefix="/system", tags=["system"])
_VENV_CACHE_TTL_SECONDS = 20.0
_HW_CACHE_TTL_SECONDS = 120.0
_LAST_SCAN_CACHE_TTL_SECONDS = 10.0
_venv_ready_cache: tuple[float, bool] = (0.0, False)
_venv_ready_lock = asyncio.Lock()
_hw_cache: tuple[float, dict] = (0.0, {})
_last_scan_cache: tuple[float, str | None] = (0.0, None)


def _parse_client_date(value: str | None) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    # Accept ISO first, then common locale forms observed in desktop webviews.
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        pass
    for fmt in ("%m/%d/%Y", "%Y/%m/%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unsupported date format: {text}")


async def _latest_completed_scan_at() -> str | None:
    global _last_scan_cache
    now = time.monotonic()
    at, cached = _last_scan_cache
    if now - at < _LAST_SCAN_CACHE_TTL_SECONDS:
        return cached
    try:
        from database.db import AsyncSessionLocal
        from database.models import DigestRun
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DigestRun)
                .where(DigestRun.status == "done")
                .order_by(DigestRun.finished_at.desc().nullslast(), DigestRun.id.desc())
                .limit(1)
            )
            run = result.scalar_one_or_none()
            if run and run.finished_at:
                finished = run.finished_at
                if finished.tzinfo is None:
                    # DB stores naive UTC timestamps; expose as explicit UTC
                    # so the frontend does not interpret them as local time.
                    finished = finished.replace(tzinfo=timezone.utc)
                value = finished.isoformat()
                _last_scan_cache = (time.monotonic(), value)
                return value
    except Exception:
        return None
    _last_scan_cache = (time.monotonic(), None)
    return None


def _apply_llm_selection(model_id: Optional[str]) -> None:
    value = (model_id or "").strip()
    if value:
        settings.llm_model = value
        settings.llm_model_selected = True
    else:
        settings.llm_model = ""
        settings.llm_model_selected = False


def _active_llm_for_status(ollama_running: bool, installed: list) -> Optional[str]:
    """Active LLM only when the user explicitly selected it and Ollama has that exact model."""
    from api.models import _ollama_has_model

    if not settings.llm_model_selected:
        return None
    configured = (settings.llm_model or "").strip()
    if not configured or not ollama_running:
        return None
    if _ollama_has_model(configured, installed):
        return configured
    return None


async def _cached_venv_ready() -> bool:
    global _venv_ready_cache
    now = time.monotonic()
    at, val = _venv_ready_cache
    if now - at < _VENV_CACHE_TTL_SECONDS:
        return val
    async with _venv_ready_lock:
        now = time.monotonic()
        at, val = _venv_ready_cache
        if now - at < _VENV_CACHE_TTL_SECONDS:
            return val
        resolved = await asyncio.to_thread(is_venv_ready)
        _venv_ready_cache = (time.monotonic(), bool(resolved))
        return bool(resolved)


def _cached_hardware() -> dict:
    global _hw_cache
    now = time.monotonic()
    at, snapshot = _hw_cache
    if snapshot and now - at < _HW_CACHE_TTL_SECONDS:
        return snapshot
    snapshot = detect_hardware()
    _hw_cache = (time.monotonic(), snapshot)
    return snapshot


@router.get("/hardware")
async def hardware():
    return get_hardware_with_allocation()


@router.patch("/resource-allocation")
async def patch_resource_allocation(body: dict):
    return save_allocation(body or {})


@router.get("/status")
async def status(include_models: bool = Query(default=False)):
    ollama_installed = is_ollama_installed()
    ollama_running = await check_ollama_running()
    models = await list_models() if (include_models and ollama_running) else []
    scheduler = get_scheduler()
    next_run = None
    job = scheduler.get_job("daily_scan")
    if job and job.next_run_time:
        next_run = job.next_run_time.isoformat()
    last_scan = await _latest_completed_scan_at()
    hw = _cached_hardware()
    venv_ready = await _cached_venv_ready()
    return {
        "version": settings.version,
        "first_run": settings.first_run,
        "backend_ready": True,
        "venv_ready": venv_ready,
        "ollama_installed": ollama_installed,
        "ollama_running": ollama_running,
        "active_model": (
            _active_llm_for_status(ollama_running, models)
            if include_models
            else (settings.llm_model if (settings.llm_model_selected and ollama_running) else None)
        ),
        "chat_llm_model": settings.chat_llm_model or "",
        "embedding_model": settings.embedding_model,
        "installed_models": [m.get("name") for m in models] if include_models else [],
        "run_mode": settings.run_mode,
        "scheduler_running": scheduler.running,
        "next_scan": next_run,
        "last_scan": last_scan,
        "data_dir": str(settings.app_data_dir),
        "os": hw.get("os"),
        "os_version": hw.get("os_version"),
        "ollama_supported": hw.get("ollama_supported", True),
        "scan_running": is_scan_running(),
        "scan_progress": get_scan_progress(),
    }


@router.get("/perf")
async def get_perf_snapshot():
    return perf_snapshot()


@router.post("/perf/reset")
async def reset_perf_snapshot(body: Optional[dict] = Body(None)):
    _ = body or {}
    perf_reset()
    return {"ok": True}


@router.post("/install-ollama")
async def install_ollama_endpoint():
    events: list = []

    async def event_stream():
        async def progress(data):
            events.append(data)
            yield f"data: {json.dumps(data)}\n\n"

        try:
            success = await install_ollama(progress_callback=progress)
            yield f"data: {json.dumps({'step': 'complete', 'success': success})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'step': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/start-ollama")
async def start_ollama_endpoint():
    try:
        ok, message = await start_ollama()
    except Exception as e:
        ok = False
        message = f"Could not start Ollama: {e}"
    return {
        "status": "running" if ok else "not_running",
        "running": ok,
        "message": message,
    }


@router.get("/ollama-diagnostics")
async def get_ollama_diagnostics():
    return await ollama_diagnostics()


@router.post("/scan")
async def trigger_scan(body: Optional[dict] = None):
    body = body or {}
    if body.get("embedding_model"):
        settings.embedding_model = body["embedding_model"]
    settings.save()
    from_date = None
    to_date = None
    from_date_raw = body.get("from_date")
    to_date_raw = body.get("to_date")
    try:
        if isinstance(from_date_raw, str) and from_date_raw.strip():
            from_date = _parse_client_date(from_date_raw)
        if isinstance(to_date_raw, str) and to_date_raw.strip():
            to_date = _parse_client_date(to_date_raw)
            # Include full end day when date-only input is provided.
            if len(to_date_raw.strip()) <= 10:
                to_date = to_date.replace(hour=23, minute=59, second=59, microsecond=999999)
    except ValueError as e:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail=f"Invalid date range: {e}")
    asyncio.create_task(run_scan_ingest(from_date=from_date, to_date=to_date))
    return {
        "status": "started",
        "mode": "scan",
        "message": "Source scan started (ingest-only)",
        "embedding_model": settings.embedding_model,
        "from_date": from_date.isoformat() if from_date else None,
        "to_date": to_date.isoformat() if to_date else None,
    }


@router.post("/filter")
async def trigger_filter(body: Optional[dict] = None):
    body = body or {}
    if body.get("llm_model"):
        _apply_llm_selection(body["llm_model"])
    if body.get("embedding_model"):
        settings.embedding_model = body["embedding_model"]
    settings.save()
    asyncio.create_task(run_ai_filter())
    return {
        "status": "started",
        "mode": "filter",
        "message": "AI filter started",
        "llm_model": settings.llm_model,
        "embedding_model": settings.embedding_model,
    }


@router.post("/scan/stop")
async def stop_scan():
    requested = request_scan_stop()
    return {
        "status": "stopping" if requested else "idle",
        "message": "Scan stop requested" if requested else "No active scan to stop",
    }


@router.get("/config")
async def get_config():
    return {
        "llm_model": settings.llm_model if settings.llm_model_selected else "",
        "llm_model_selected": settings.llm_model_selected,
        "chat_llm_model": settings.chat_llm_model or "",
        "embedding_model": settings.embedding_model,
        "ollama_base_url": settings.ollama_base_url,
        "ollama_models_path": settings.ollama_models_path or "",
        "must_read_threshold": settings.must_read_threshold,
    }


@router.patch("/config")
async def update_config(body: dict):
    if "llm_model" in body:
        _apply_llm_selection(str(body.get("llm_model") or ""))
    if "chat_llm_model" in body:
        settings.chat_llm_model = str(body.get("chat_llm_model") or "")
    if "embedding_model" in body and body["embedding_model"]:
        settings.embedding_model = str(body["embedding_model"])
    if "must_read_threshold" in body:
        val = float(body["must_read_threshold"])
        settings.must_read_threshold = max(0.05, min(1.0, val))
    if "ollama_base_url" in body and body["ollama_base_url"]:
        from config import normalize_ollama_base_url

        settings.ollama_base_url = normalize_ollama_base_url(str(body["ollama_base_url"]))
    if "ollama_models_path" in body:
        settings.ollama_models_path = str(body["ollama_models_path"] or "").strip()
        if settings.ollama_models_path:
            os.environ["OLLAMA_MODELS"] = settings.ollama_models_path
    settings.save()
    return await get_config()


@router.post("/complete-setup")
async def complete_setup(body: dict):
    settings.first_run = False
    if "run_mode" in body:
        settings.run_mode = body["run_mode"]
    if "llm_model" in body:
        _apply_llm_selection(body.get("llm_model"))
    if "chat_llm_model" in body:
        settings.chat_llm_model = str(body.get("chat_llm_model") or "")
    if "embedding_model" in body:
        settings.embedding_model = body["embedding_model"]
    if "ollama_base_url" in body and body["ollama_base_url"]:
        from config import normalize_ollama_base_url

        settings.ollama_base_url = normalize_ollama_base_url(str(body["ollama_base_url"]))
    if "ollama_models_path" in body:
        settings.ollama_models_path = str(body["ollama_models_path"] or "").strip()
        if settings.ollama_models_path:
            os.environ["OLLAMA_MODELS"] = settings.ollama_models_path
    settings.save()
    return {"status": "ok"}


@router.get("/storage-info")
async def storage_info():
    data_dir = settings.app_data_dir

    def dir_size(path: Path) -> int:
        total = 0
        if path.exists():
            for f in path.rglob("*"):
                if f.is_file():
                    try:
                        total += f.stat().st_size
                    except OSError:
                        pass
        return total

    sizes = {
        "database": (data_dir / "papers.db").stat().st_size if (data_dir / "papers.db").exists() else 0,
        "embedding_models": dir_size(settings.models_path / "embedding"),
        "pdf_cache": dir_size(settings.pdf_cache_path),
        "logs": dir_size(settings.log_path),
        "vectors": dir_size(settings.vector_path),
    }
    return {k: {"bytes": v, "mb": round(v / (1024 ** 2), 1)} for k, v in sizes.items()}


@router.get("/browse-folder")
async def browse_folder():
    """Open a native OS folder-picker dialog and return the chosen path."""
    import asyncio
    loop = asyncio.get_event_loop()
    selected = await loop.run_in_executor(None, _pick_folder_sync)
    return {"path": selected or ""}


def _pick_folder_sync() -> str:
    sys_name = platform.system()
    try:
        if sys_name == "Darwin":
            result = subprocess.run(
                ["osascript", "-e",
                 'POSIX path of (choose folder with prompt "Select Research Atlas data directory")'],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0:
                return result.stdout.strip().rstrip("/")
        elif sys_name == "Linux":
            for cmd in [
                ["zenity", "--file-selection", "--directory", "--title=Select data directory"],
                ["kdialog", "--getexistingdirectory", os.path.expanduser("~")],
            ]:
                try:
                    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                    if r.returncode == 0:
                        return r.stdout.strip()
                except FileNotFoundError:
                    continue
        elif sys_name == "Windows":
            ps = (
                "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;"
                "$d=New-Object System.Windows.Forms.FolderBrowserDialog;"
                "$d.Description='Select Research Atlas data directory';"
                "if($d.ShowDialog() -eq 'OK'){$d.SelectedPath}"
            )
            r = subprocess.run(["powershell", "-Command", ps],
                               capture_output=True, text=True, timeout=120)
            if r.returncode == 0:
                return r.stdout.strip()
    except Exception:
        pass

    # Cross-platform fallback via tkinter
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", True)
        path = filedialog.askdirectory(title="Select Research Atlas data directory")
        root.destroy()
        return path
    except Exception:
        return ""


_hibernate = False


@router.post("/hibernate")
async def set_hibernate(body: dict):
    global _hibernate
    _hibernate = body.get("active", True)
    scheduler = get_scheduler()
    if _hibernate:
        if scheduler.running:
            scheduler.pause()
    else:
        if scheduler.running:
            scheduler.resume()
    return {"hibernate": _hibernate}


@router.get("/hibernate")
async def get_hibernate():
    return {"hibernate": _hibernate}


@router.get("/components")
async def list_components():
    from system.model_paths import (
        default_ollama_models_path,
        dir_size,
        file_size,
        format_bytes,
        ollama_install_url,
        resolve_ollama_binary,
    )

    db_path = settings.db_path
    config_path = settings.app_data_dir / "config.json"
    ollama_models = default_ollama_models_path()
    ollama_bin = resolve_ollama_binary()

    items = [
        {
            "id": "paper_db",
            "label": "Paper Database",
            "path": str(db_path),
            "type": "data",
            "size_bytes": file_size(db_path),
            "can_open": db_path.exists(),
            "can_delete": db_path.exists(),
            "purge_key": "paper_database",
        },
        {
            "id": "vector_db",
            "label": "Vector Index",
            "path": str(settings.vector_path),
            "type": "data",
            "size_bytes": dir_size(settings.vector_path),
            "can_open": settings.vector_path.exists(),
            "can_delete": settings.vector_path.exists(),
            "purge_key": "vectors",
        },
        {
            "id": "pdf_cache",
            "label": "PDF Cache",
            "path": str(settings.pdf_cache_path),
            "type": "data",
            "size_bytes": dir_size(settings.pdf_cache_path),
            "can_open": settings.pdf_cache_path.exists(),
            "can_delete": True,
            "purge_key": "pdf_cache",
        },
        {
            "id": "logs",
            "label": "Log Files",
            "path": str(settings.log_path),
            "type": "data",
            "size_bytes": dir_size(settings.log_path),
            "can_open": settings.log_path.exists(),
            "can_delete": True,
            "purge_key": "logs",
        },
        {
            "id": "config",
            "label": "Configuration",
            "path": str(config_path),
            "type": "config",
            "size_bytes": file_size(config_path),
            "can_open": config_path.exists(),
            "can_delete": config_path.exists(),
            "purge_key": "config",
        },
        {
            "id": "chats",
            "label": "Chat Sessions",
            "path": str(settings.chats_path),
            "type": "data",
            "size_bytes": dir_size(settings.chats_path),
            "can_open": settings.chats_path.exists(),
            "can_delete": settings.chats_path.exists(),
            "purge_key": "chats",
        },
        {
            "id": "emb_models",
            "label": "Embedding Models",
            "path": str(settings.models_path / "embedding"),
            "type": "model",
            "size_bytes": dir_size(settings.models_path / "embedding"),
            "can_open": (settings.models_path / "embedding").exists(),
            "can_delete": True,
            "purge_key": "embedding_models",
        },
        {
            "id": "llm_models",
            "label": "LLM Models (Ollama)",
            "path": str(ollama_models),
            "type": "model",
            "size_bytes": dir_size(ollama_models),
            "can_open": ollama_models.exists(),
            "can_delete": ollama_models.exists(),
            "purge_key": "llm_models",
        },
        {
            "id": "python_venv",
            "label": "Python Environment (isolated)",
            "path": str(venv_path()),
            "type": "app",
            "size_bytes": dir_size(venv_path()),
            "can_open": venv_path().exists(),
            "can_delete": venv_path().exists(),
            "purge_key": "python_venv",
        },
        {
            "id": "ollama",
            "label": "Ollama Runtime",
            "path": ollama_bin or ollama_install_url(),
            "type": "app",
            "size_bytes": file_size(Path(ollama_bin)) if ollama_bin else 0,
            "can_open": bool(ollama_bin and Path(ollama_bin).exists()),
            "can_delete": True,
            "purge_key": "ollama_runtime",
            "install_url": ollama_install_url(),
        },
        {
            "id": "app_data",
            "label": "Research Atlas Data Folder",
            "path": str(settings.app_data_dir),
            "type": "data",
            "size_bytes": dir_size(settings.app_data_dir),
            "can_open": settings.app_data_dir.exists(),
            "can_delete": False,
            "purge_key": None,
        },
    ]
    for item in items:
        item["size_label"] = format_bytes(item["size_bytes"])
    return {"components": items, "app_data_dir": str(settings.app_data_dir)}


@router.post("/reveal-path")
async def reveal_path(body: dict):
    raw = (body.get("path") or "").strip()
    if not raw:
        return {"ok": False, "message": "path is required"}
    path = Path(raw).expanduser()
    if not path.exists():
        return {"ok": False, "message": f"Path does not exist: {path}"}
    sys_name = platform.system()
    try:
        if sys_name == "Darwin":
            if path.is_dir():
                subprocess.run(["open", str(path)], check=False)
            else:
                subprocess.run(["open", "-R", str(path)], check=False)
        elif sys_name == "Windows":
            subprocess.run(["explorer", "/select," if path.is_file() else "", str(path)], check=False)
        else:
            subprocess.run(["xdg-open", str(path)], check=False)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "message": str(e)}


@router.post("/open-file")
async def open_file(body: dict):
    """Open a file with the system default application (e.g. Preview for PDFs)."""
    raw = (body.get("path") or "").strip()
    if not raw:
        return {"ok": False, "message": "path is required"}
    path = Path(raw).expanduser()
    if not path.is_file():
        return {"ok": False, "message": f"File not found: {path}"}
    sys_name = platform.system()
    try:
        if sys_name == "Darwin":
            subprocess.run(["open", str(path)], check=False)
        elif sys_name == "Windows":
            subprocess.run(["cmd", "/c", "start", "", str(path)], check=False)
        else:
            subprocess.run(["xdg-open", str(path)], check=False)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "message": str(e)}


@router.delete("/purge")
async def purge_components(body: dict):
    deleted = []
    if body.get("paper_database") and settings.db_path.exists():
        os.remove(settings.db_path)
        deleted.append("paper_database")
    if body.get("vectors"):
        shutil.rmtree(settings.vector_path, ignore_errors=True)
        settings.vector_path.mkdir(exist_ok=True)
        deleted.append("vectors")
    if body.get("pdf_cache"):
        shutil.rmtree(settings.pdf_cache_path, ignore_errors=True)
        settings.pdf_cache_path.mkdir(exist_ok=True)
        deleted.append("pdf_cache")
    if body.get("logs"):
        shutil.rmtree(settings.log_path, ignore_errors=True)
        settings.log_path.mkdir(exist_ok=True)
        deleted.append("logs")
    if body.get("chats"):
        shutil.rmtree(settings.chats_path, ignore_errors=True)
        settings.chats_path.mkdir(exist_ok=True)
        deleted.append("chats")
    if body.get("config") and (settings.app_data_dir / "config.json").exists():
        os.remove(settings.app_data_dir / "config.json")
        deleted.append("config")
    if body.get("embedding_models"):
        shutil.rmtree(settings.models_path / "embedding", ignore_errors=True)
        deleted.append("embedding_models")
    if body.get("llm_models"):
        models = await list_models()
        for m in models:
            name = m.get("name") if isinstance(m, dict) else str(m)
            if name:
                await delete_model(name)
        deleted.append("llm_models")
    if body.get("python_venv"):
        if purge_venv():
            deleted.append("python_venv")
    if body.get("ollama_runtime"):
        try:
            if await uninstall_ollama():
                deleted.append("ollama_runtime")
        except (RuntimeError, OSError):
            pass
    if body.get("ollama_models_dir"):
        ollama_home = Path.home() / ".ollama"
        if ollama_home.exists():
            shutil.rmtree(ollama_home, ignore_errors=True)
            deleted.append("ollama_models_dir")
    return {"deleted": deleted}


@router.post("/shutdown")
async def shutdown_backend():
    """Stop scheduler and exit the backend process."""
    stop_scheduler()

    async def _exit():
        await asyncio.sleep(0.3)
        os._exit(0)

    asyncio.create_task(_exit())
    return {"status": "shutting_down"}


@router.post("/backup")
async def backup_app_data(body: Optional[dict] = None):
    body = body or {}
    dest = (body.get("path") or "").strip()
    if not dest:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = str(Path.home() / "Desktop" / f"ResearchAtlas-backup-{stamp}.zip")
    dest_path = Path(dest).expanduser()
    if dest_path.suffix.lower() != ".zip":
        dest_path = dest_path.with_suffix(".zip")
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    data_dir = settings.app_data_dir
    with zipfile.ZipFile(dest_path, "w", zipfile.ZIP_DEFLATED) as zf:
        if data_dir.exists():
            for f in data_dir.rglob("*"):
                if f.is_file():
                    zf.write(f, f.relative_to(data_dir.parent))
    return {"path": str(dest_path), "size_bytes": dest_path.stat().st_size if dest_path.exists() else 0}


@router.post("/purge-all")
async def purge_all(body: dict):
    """Remove all Research Atlas data; optionally Ollama app and ~/.ollama."""
    include_ollama = bool(body.get("include_ollama", True))
    include_ollama_models = bool(body.get("include_ollama_models", True))

    purge_body = {
        "paper_database": True,
        "vectors": True,
        "pdf_cache": True,
        "logs": True,
        "chats": True,
        "config": True,
        "embedding_models": True,
        "llm_models": True,
        "python_venv": True,
    }
    if include_ollama:
        purge_body["ollama_runtime"] = True
    if include_ollama_models:
        purge_body["ollama_models_dir"] = True

    result = await purge_components(purge_body)

    for sub in ("vectors", "pdfs", "logs", "chats", "models"):
        p = settings.app_data_dir / sub
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)

    if settings.db_path.exists():
        try:
            os.remove(settings.db_path)
        except OSError:
            pass

    cfg = settings.app_data_dir / "config.json"
    if cfg.exists():
        try:
            os.remove(cfg)
        except OSError:
            pass

    return {
        "deleted": result.get("deleted", []),
        "include_ollama": include_ollama,
        "include_ollama_models": include_ollama_models,
    }
