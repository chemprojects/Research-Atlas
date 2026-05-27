from __future__ import annotations

import asyncio
import json
import logging
import shlex
import time
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from config import settings
from config import normalize_ollama_base_url
from embedding.model_cache import (
    delete_embedding_cache,
    download_embedding,
    embedding_cache_dirs,
    embedding_cache_root,
    is_embedding_cached,
)
from system.installer import (
    check_ollama_running,
    delete_model as delete_ollama_model,
    get_ollama_version,
    install_ollama,
    is_ollama_installed,
    list_models,
    pull_model,
    start_ollama,
    uninstall_ollama,
)

log = logging.getLogger(__name__)
from system.model_paths import default_ollama_models_path, ollama_install_url, resolve_ollama_binary
import platform

router = APIRouter(prefix="/models", tags=["models"])
_INSTALLED_PAYLOAD_TTL_SECONDS = 2.0
_installed_payload_cache: tuple[float, dict[str, Any] | None] = (0.0, None)
_installed_payload_lock = asyncio.Lock()


def _ollama_library_url(model_id: str) -> str:
    return f"https://ollama.com/library/{model_id}"


def _huggingface_url(model_id: str) -> str:
    return f"https://huggingface.co/{model_id}"


def _shell_quote(value: str) -> str:
    return shlex.quote(value)


def _ollama_pull_command(model_id: str) -> str:
    models_path = str(default_ollama_models_path())
    system = platform.system()
    if system == "Windows":
        return f"$env:OLLAMA_MODELS={models_path!r}; ollama pull {model_id}"
    return f"OLLAMA_MODELS={_shell_quote(models_path)} ollama pull {model_id}"


def _runtime_install_command() -> str:
    system = platform.system()
    if system == "Darwin":
        return (
            "curl -L https://ollama.com/download/Ollama-darwin.zip -o /tmp/Ollama.zip\n"
            "python3 - <<'PY'\n"
            "import pathlib, shutil, zipfile\n"
            "work = pathlib.Path('/tmp/ollama-install')\n"
            "if work.exists(): shutil.rmtree(work)\n"
            "zipfile.ZipFile('/tmp/Ollama.zip').extractall(work)\n"
            "src = work / 'Ollama.app'\n"
            "dst = pathlib.Path.home() / 'Applications' / 'Ollama.app'\n"
            "dst.parent.mkdir(parents=True, exist_ok=True)\n"
            "if dst.exists(): shutil.rmtree(dst)\n"
            "shutil.copytree(src, dst)\n"
            "PY\n"
            "open \"$HOME/Applications/Ollama.app\""
        )
    if system == "Windows":
        return (
            "powershell -ExecutionPolicy Bypass -Command "
            "\"Invoke-WebRequest https://ollama.com/download/OllamaSetup.exe "
            "-OutFile $env:TEMP\\OllamaSetup.exe; "
            "Start-Process $env:TEMP\\OllamaSetup.exe -Wait\""
        )
    if system == "Linux":
        return "curl -fsSL https://ollama.com/install.sh | sh"
    return "Open https://ollama.com/download and install Ollama for your operating system."


def _embedding_download_command(model_id: str) -> str:
    cache_dir = str(embedding_cache_root())
    return (
        "python -m pip install 'huggingface-hub>=0.23,<1'\n"
        "python - <<'PY'\n"
        "from huggingface_hub import snapshot_download\n"
        f"snapshot_download(repo_id={model_id!r}, cache_dir={cache_dir!r})\n"
        "PY"
    )


def _enrich_llm(entry: dict[str, Any]) -> dict[str, Any]:
    model_id = entry["id"]
    return {
        **entry,
        "install_method": "ollama",
        "install_url": _ollama_library_url(model_id),
        "install_command": _ollama_pull_command(model_id),
        "storage_path": str(default_ollama_models_path()),
        "install_steps": [
            "Install Ollama from https://ollama.com/download and start the app.",
            f"Run the Terminal command below to pull {model_id} into the configured Ollama models folder.",
            "Or click Install below to pull via the Ollama API.",
        ],
    }


def _enrich_runtime(entry: dict[str, Any]) -> dict[str, Any]:
    app_path = (
        "/Applications/Ollama.app"
        if platform.system() == "Darwin"
        else "See ollama.com/download"
    )
    return {
        **entry,
        "install_method": "ollama_app",
        "install_url": ollama_install_url(),
        "install_command": _runtime_install_command(),
        "storage_path": app_path,
        "install_steps": [
            "Click Install below to download and install the Ollama app.",
            "On macOS, Research Atlas installs Ollama in /Applications when allowed, otherwise ~/Applications.",
            "After install, start Ollama if it is not already running (menu bar icon).",
            "Then install language models in the section below.",
        ],
    }


def _enrich_embedding(entry: dict[str, Any]) -> dict[str, Any]:
    model_id = entry["id"]
    return {
        **entry,
        "install_method": "huggingface",
        "install_url": _huggingface_url(model_id),
        "install_command": _embedding_download_command(model_id),
        "storage_path": str(embedding_cache_root()),
        "install_steps": [
            f"Run the Terminal command below to download {_huggingface_url(model_id)} into {embedding_cache_root()}.",
            "Or click Install below to download the same Hugging Face snapshot from inside Research Atlas.",
        ],
    }


CATALOG = [
    _enrich_llm(
        {
            "id": "gpt-oss:20b",
            "name": "GPT-OSS 20B (MoE)",
            "description": "Mixture-of-Experts local model tuned for strong reasoning and scientific writing assistance.",
            "size_gb": 12.0,
            "role": "llm",
            "recommended_hardware": "GPU ≥16 GB VRAM or CPU ≥32 GB RAM",
            "cpu_speed": 2,
            "gpu_speed": 4,
            "quality": 5,
            "recommended": False,
            "recommended_for": ["chat"],
        }
    ),
    _enrich_llm(
        {
            "id": "gemma4:26b",
            "name": "Gemma 4 26B (MoE)",
            "description": "Google's largest Gemma 4. MoE architecture activates only 4B params per token for fast inference with 256K context.",
            "size_gb": 18.0,
            "role": "llm",
            "recommended_hardware": "GPU ≥24 GB VRAM or CPU ≥32 GB RAM",
            "cpu_speed": 1,
            "gpu_speed": 3,
            "quality": 5,
            "recommended": False,
            "recommended_for": ["chat"],
        }
    ),
    _enrich_llm(
        {
            "id": "gemma4:e4b",
            "name": "Gemma 4 E4B",
            "description": "Strong multimodal model from Google. Great balance of quality and speed with 128K context support.",
            "size_gb": 9.6,
            "role": "llm",
            "recommended_hardware": "GPU ≥8 GB VRAM or CPU ≥16 GB RAM",
            "cpu_speed": 2,
            "gpu_speed": 4,
            "quality": 5,
            "recommended": False,
            "recommended_for": ["chat"],
        }
    ),
    _enrich_llm(
        {
            "id": "gemma4:e2b",
            "name": "Gemma 4 E2B",
            "description": "Efficient multimodal model from Google. Runs on laptops and edge devices with strong reasoning for its size.",
            "size_gb": 7.2,
            "role": "llm",
            "recommended_hardware": "GPU ≥6 GB VRAM or CPU ≥8 GB RAM",
            "cpu_speed": 3,
            "gpu_speed": 5,
            "quality": 4,
            "recommended": True,
            "recommended_for": ["chat"],
        }
    ),
    _enrich_llm(
        {
            "id": "mistral:7b",
            "name": "Mistral 7B Instruct",
            "description": "Fast and reliable. Great for quick summaries on modest hardware.",
            "size_gb": 4.4,
            "role": "llm",
            "recommended_hardware": "CPU ≥16 GB RAM",
            "cpu_speed": 4,
            "gpu_speed": 5,
            "quality": 3,
            "recommended": False,
            "recommended_for": ["filter", "chat"],
        }
    ),
    _enrich_llm(
        {
            "id": "phi4-mini:latest",
            "name": "Phi-4 Mini",
            "description": "Lightweight option for older or weaker machines.",
            "size_gb": 2.5,
            "role": "llm",
            "recommended_hardware": "CPU ≥8 GB RAM",
            "cpu_speed": 5,
            "gpu_speed": 5,
            "quality": 2,
            "recommended": False,
            "recommended_for": ["filter"],
        }
    ),
    _enrich_llm(
        {
            "id": "deepseek-r1:1.5b",
            "name": "DeepSeek-R1 1.5B",
            "description": "Smallest reasoning model. Good for quick drafts and low-resource machines.",
            "size_gb": 1.1,
            "role": "llm",
            "recommended_hardware": "CPU ≥8 GB RAM",
            "cpu_speed": 5,
            "gpu_speed": 5,
            "quality": 2,
            "recommended": False,
            "recommended_for": ["filter"],
        }
    ),
    _enrich_llm(
        {
            "id": "deepseek-r1:7b",
            "name": "DeepSeek-R1 7B",
            "description": "Balanced reasoning model. Strong performance for its size with good context handling.",
            "size_gb": 4.7,
            "role": "llm",
            "recommended_hardware": "CPU ≥16 GB RAM",
            "cpu_speed": 4,
            "gpu_speed": 5,
            "quality": 3,
            "recommended": False,
            "recommended_for": ["filter", "chat"],
        }
    ),
    _enrich_llm(
        {
            "id": "deepseek-r1:8b",
            "name": "DeepSeek-R1 8B",
            "description": "Larger reasoning variant with improved output quality. Good for chat and analysis.",
            "size_gb": 5.2,
            "role": "llm",
            "recommended_hardware": "GPU ≥8 GB VRAM or CPU ≥16 GB RAM",
            "cpu_speed": 3,
            "gpu_speed": 4,
            "quality": 4,
            "recommended": False,
            "recommended_for": ["chat"],
        }
    ),
    _enrich_llm(
        {
            "id": "deepseek-r1:latest",
            "name": "DeepSeek-R1 (latest)",
            "description": "Latest tagged release. Currently points to the 8B parameter release.",
            "size_gb": 5.2,
            "role": "llm",
            "recommended_hardware": "GPU ≥8 GB VRAM or CPU ≥16 GB RAM",
            "cpu_speed": 3,
            "gpu_speed": 4,
            "quality": 4,
            "recommended": False,
            "recommended_for": ["chat"],
        }
    ),
]

EMBEDDING_CATALOG = [
    _enrich_embedding(
        {
            "id": "allenai/specter2_base",
            "name": "SPECTER2",
            "description": "Designed specifically for scientific paper embeddings. Best accuracy for research literature.",
            "size_gb": 0.5,
            "role": "embedding",
            "recommended": True,
        }
    ),
    _enrich_embedding(
        {
            "id": "nomic-ai/nomic-embed-text-v1",
            "name": "Nomic Embed Text",
            "description": "Strong general-purpose embeddings. Good fallback option.",
            "size_gb": 0.5,
            "role": "embedding",
            "recommended": False,
        }
    ),
    _enrich_embedding(
        {
            "id": "BAAI/bge-small-en-v1.5",
            "name": "BGE Small",
            "description": "Very fast, small footprint. Use on minimal hardware.",
            "size_gb": 0.1,
            "role": "embedding",
            "recommended": False,
        }
    ),
]

OLLAMA_RUNTIME = _enrich_runtime(
    {
        "id": "ollama",
        "name": "Ollama",
        "description": "Local runtime required to run language models. Install this before pulling LLMs.",
        "size_gb": 0.5,
        "role": "runtime",
        "recommended": True,
    }
)

RUNTIME_CATALOG = [OLLAMA_RUNTIME]


def _catalog_by_id(model_id: str) -> Optional[dict[str, Any]]:
    for m in RUNTIME_CATALOG + CATALOG + EMBEDDING_CATALOG:
        if m["id"] == model_id:
            return m
    return None


def _role_for_model(model_id: str, role: Optional[str] = None) -> str:
    if role in ("llm", "embedding", "runtime"):
        return role
    if model_id == "ollama":
        return "runtime"
    entry = _catalog_by_id(model_id)
    if entry:
        return entry.get("role", "llm")
    return "embedding" if "/" in model_id else "llm"


def _ollama_has_model(model_id: str, installed: list) -> bool:
    """True only when the exact model name is present in Ollama (no fuzzy family match)."""
    target = (model_id or "").strip().lower()
    if not target:
        return False
    for m in installed:
        name = (m.get("name") if isinstance(m, dict) else str(m)).strip().lower()
        if name and name == target:
            return True
    return False


def _ollama_runtime_path() -> str:
    binary = resolve_ollama_binary()
    if not binary:
        return ollama_install_url()
    marker = ".app/Contents/Resources/ollama"
    if marker in binary:
        return f"{binary.split(marker, 1)[0]}.app"
    return binary


@router.get("/catalog")
async def get_catalog():
    return {
        "runtime": RUNTIME_CATALOG,
        "llm": CATALOG,
        "embedding": EMBEDDING_CATALOG,
    }


@router.get("/installed")
async def get_installed():
    return await _installed_payload()


async def _installed_payload() -> dict[str, Any]:
    global _installed_payload_cache
    now = time.monotonic()
    at, cached = _installed_payload_cache
    if cached is not None and now - at < _INSTALLED_PAYLOAD_TTL_SECONDS:
        return cached

    async with _installed_payload_lock:
        now = time.monotonic()
        at, cached = _installed_payload_cache
        if cached is not None and now - at < _INSTALLED_PAYLOAD_TTL_SECONDS:
            return cached

        app_installed = is_ollama_installed()
        running = await check_ollama_running()
        version = None
        if app_installed:
            try:
                version = await asyncio.wait_for(get_ollama_version(), timeout=3.0)
            except (asyncio.TimeoutError, Exception):
                version = None
        ollama_models = await list_models() if running else []
        embedding = [
            {
                "id": m["id"],
                "installed": is_embedding_cached(m["id"]),
                "cache_dirs": [str(p) for p in embedding_cache_dirs(m["id"])],
            }
            for m in EMBEDDING_CATALOG
        ]
        payload = {
            "llm": ollama_models,
            "embedding": embedding,
            "runtime": {
                "ollama": {
                    "installed": app_installed,
                    "running": running,
                    "version": version,
                }
            },
            "ollama_running": running,
            "ollama_installed": app_installed,
            "paths": {
                "ollama_models": str(default_ollama_models_path()),
                "ollama_runtime": _ollama_runtime_path(),
                "embedding_cache": str(embedding_cache_root()),
                "ollama_download": ollama_install_url(),
                "app_data": str(settings.app_data_dir),
            },
        }
        _installed_payload_cache = (time.monotonic(), payload)
        return payload


@router.get("/state")
async def get_models_state():
    installed = await _installed_payload()
    llm_models = installed.get("llm", [])
    llm_id = settings.llm_model if settings.llm_model_selected else ""
    emb_id = settings.embedding_model
    readiness = {
        "ollama_running": bool(installed.get("ollama_running")),
        "llm": {
            "id": llm_id,
            "ready": bool(
                llm_id and installed.get("ollama_running") and _ollama_has_model(llm_id, llm_models)
            ),
        },
        "embedding": {
            "id": emb_id,
            "ready": is_embedding_cached(emb_id),
        },
    }
    status = {
        "running": bool(installed.get("ollama_running")),
        "model_count": len(llm_models),
    }
    return {
        "installed": installed,
        "readiness": readiness,
        "status": status,
        "active": {
            "llm_model": settings.llm_model,
            "embedding_model": settings.embedding_model,
            "llm_model_selected": bool(settings.llm_model_selected),
        },
    }


@router.get("/status")
async def get_ollama_status():
    running = await check_ollama_running()
    models = await list_models() if running else []
    return {"running": running, "model_count": len(models)}


@router.get("/readiness")
async def get_model_readiness():
    payload = await _installed_payload()
    running = bool(payload.get("ollama_running"))
    installed = payload.get("llm", [])
    llm_id = settings.llm_model if settings.llm_model_selected else ""
    emb_id = settings.embedding_model
    return {
        "ollama_running": running,
        "llm": {
            "id": llm_id,
            "ready": bool(
                llm_id and running and _ollama_has_model(llm_id, installed)
            ),
        },
        "embedding": {
            "id": emb_id,
            "ready": is_embedding_cached(emb_id),
        },
    }


async def _install_blocking(model_name: str, role: str) -> dict[str, str]:
    """Single JSON response — reliable in Tauri where fetch() streaming often fails."""
    try:
        if role == "runtime":
            ok = await install_ollama()
            if ok:
                return {"status": "success", "message": "Ollama installed successfully."}
            return {"status": "error", "message": "Ollama install failed."}

        if role == "embedding":
            ok, msg = await download_embedding(model_name)
            if ok:
                return {"status": "success", "message": msg}
            return {"status": "error", "message": msg}

        if not await check_ollama_running():
            return {
                "status": "error",
                "message": "Ollama is not running. Install Ollama above and open the app first.",
            }

        ok = await pull_model(model_name)
        if ok:
            return {"status": "success", "message": f"Language model ready: {model_name}"}
        return {
            "status": "error",
            "message": f"Could not pull {model_name}. Check Ollama and disk space.",
        }
    except Exception as e:
        log.exception("Blocking install failed for %s (%s)", model_name, role)
        return {"status": "error", "message": str(e)}


@router.post("/install")
async def install_model(body: dict):
    model_name = body.get("name")
    if not model_name:
        raise HTTPException(status_code=400, detail="name is required")

    role = _role_for_model(model_name, body.get("role"))

    # Tauri / WKWebView often cannot read SSE bodies; use JSON mode from the desktop app.
    if body.get("stream") is False:
        return await _install_blocking(model_name, role)

    if role == "runtime":

        async def runtime_stream():
            queue: asyncio.Queue[dict] = asyncio.Queue()

            async def on_progress(data: dict) -> None:
                await queue.put(data)

            async def run_install() -> None:
                try:
                    ok = await install_ollama(progress_callback=on_progress)
                    await queue.put({"_done": True, "ok": ok})
                except Exception as e:
                    await queue.put({"_error": str(e)})

            task = asyncio.create_task(run_install())
            try:
                while True:
                    data = await queue.get()
                    if "_error" in data:
                        yield f"data: {json.dumps({'status': 'error', 'message': data['_error']})}\n\n"
                        break
                    if data.get("_done"):
                        if data.get("ok"):
                            yield f"data: {json.dumps({'status': 'success'})}\n\n"
                        else:
                            yield f"data: {json.dumps({'status': 'error', 'message': 'Ollama install failed'})}\n\n"
                        break
                    pct = int(data.get("percent", 0))
                    msg = data.get("message", "Installing Ollama…")
                    yield f"data: {json.dumps({'status': 'downloading', 'message': msg, 'completed': pct, 'total': 100})}\n\n"
            finally:
                await task
            yield "data: {\"status\": \"done\"}\n\n"

        return StreamingResponse(
            runtime_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    if role == "embedding":

        async def embed_stream():
            try:
                yield f"data: {json.dumps({'status': 'downloading', 'message': 'Downloading from Hugging Face…'})}\n\n"
                ok, msg = await download_embedding(model_name)
                if ok:
                    yield f"data: {json.dumps({'status': 'success', 'message': msg})}\n\n"
                else:
                    yield f"data: {json.dumps({'status': 'error', 'message': msg})}\n\n"
                yield "data: {\"status\": \"done\"}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"
                yield "data: {\"status\": \"done\"}\n\n"

        return StreamingResponse(
            embed_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def ollama_stream():
        if not await check_ollama_running():
            yield f"data: {json.dumps({'status': 'error', 'message': 'Ollama is not running. Install from https://ollama.com/download'})}\n\n"
            yield "data: {\"status\": \"done\"}\n\n"
            return
        saw_success = False
        try:
            async with httpx.AsyncClient(timeout=600) as client:
                async with client.stream(
                    "POST",
                    f"{normalize_ollama_base_url(settings.ollama_base_url)}/api/pull",
                    json={"name": model_name},
                ) as resp:
                    if resp.status_code >= 400:
                        body = await resp.aread()
                        msg = body.decode(errors="replace")[:400] or resp.reason_phrase
                        yield f"data: {json.dumps({'status': 'error', 'message': f'Ollama error ({resp.status_code}): {msg}'})}\n\n"
                        yield "data: {\"status\": \"done\"}\n\n"
                        return
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            yield f"data: {line}\n\n"
                            continue
                        if data.get("error"):
                            yield f"data: {json.dumps({'status': 'error', 'message': str(data['error'])})}\n\n"
                            yield "data: {\"status\": \"done\"}\n\n"
                            return
                        if data.get("status") == "success":
                            saw_success = True
                            yield f"data: {json.dumps({'status': 'success', 'message': 'Model ready'})}\n\n"
                            continue
                        completed = data.get("completed")
                        total = data.get("total")
                        payload: dict = {
                            "status": "downloading",
                            "message": str(data.get("status") or "Downloading…"),
                        }
                        if isinstance(completed, (int, float)) and isinstance(total, (int, float)) and total > 0:
                            payload["completed"] = int(completed / total * 100)
                            payload["total"] = 100
                        yield f"data: {json.dumps(payload)}\n\n"
            if saw_success:
                yield "data: {\"status\": \"done\"}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'error', 'message': 'Model pull did not complete'})}\n\n"
                yield "data: {\"status\": \"done\"}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"
            yield "data: {\"status\": \"done\"}\n\n"

    return StreamingResponse(
        ollama_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/{model_name:path}")
async def remove_model(model_name: str, role: Optional[str] = Query(None)):
    resolved = _role_for_model(model_name, role)
    if resolved == "runtime":
        try:
            ok = await uninstall_ollama()
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {
            "status": "deleted" if ok else "not_found",
            "name": model_name,
            "role": "runtime",
        }
    if resolved == "embedding":
        ok = delete_embedding_cache(model_name)
        return {"status": "deleted" if ok else "not_found", "name": model_name, "role": "embedding"}
    if not await check_ollama_running():
        try:
            await start_ollama()
            await asyncio.sleep(1.5)
        except Exception:
            pass
    success = await delete_ollama_model(model_name)
    if not success:
        base = model_name.split(":", 1)[0]
        installed_models = await list_models()
        candidates: list[str] = []
        for model in installed_models:
            name = str(model.get("name") or "")
            if not name:
                continue
            if name == model_name or name == base or name.startswith(f"{base}:"):
                candidates.append(name)
        for candidate in candidates:
            if await delete_ollama_model(candidate):
                success = True
                break
    if not success:
        raise HTTPException(
            status_code=502,
            detail="Could not uninstall this language model. Make sure Ollama is running and try again.",
        )
    return {"status": "deleted" if success else "error", "name": model_name, "role": "llm"}
