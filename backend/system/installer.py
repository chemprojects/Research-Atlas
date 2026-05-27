from __future__ import annotations
import platform, subprocess, tempfile, os, shutil, asyncio, zipfile, time
from pathlib import Path
from typing import Optional
import httpx


OLLAMA_INSTALL_URLS = {
    "Darwin": "https://ollama.com/download/Ollama-darwin.zip",
    "Linux": "https://ollama.com/install.sh",
    "Windows": "https://ollama.com/download/OllamaSetup.exe",
}

_OLLAMA_STATUS_TTL_SECONDS = 1.0
_ollama_status_cache: tuple[float, bool] = (0.0, False)
_ollama_status_lock = asyncio.Lock()


def _macos_ollama_app_candidates() -> list[Path]:
    return [
        Path("/Applications/Ollama.app"),
        Path.home() / "Applications" / "Ollama.app",
    ]


def _macos_ollama_binary(app: Path) -> Path:
    return app / "Contents" / "Resources" / "ollama"


def _macos_quarantine_status(path: Path) -> dict[str, str | bool]:
    if platform.system() != "Darwin" or not path.exists():
        return {"quarantined": False, "message": ""}
    try:
        proc = subprocess.run(
            ["xattr", "-p", "com.apple.quarantine", str(path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception as e:
        return {"quarantined": False, "message": f"Could not inspect quarantine: {e}"}
    if proc.returncode == 0:
        return {"quarantined": True, "message": proc.stdout.strip()}
    return {"quarantined": False, "message": ""}


def _macos_gatekeeper_status(path: Path) -> dict[str, str | bool]:
    if platform.system() != "Darwin" or not path.exists():
        return {"allowed": True, "message": ""}
    try:
        proc = subprocess.run(
            ["spctl", "--assess", "--type", "execute", "--verbose=4", str(path)],
            capture_output=True,
            text=True,
            timeout=8,
        )
    except Exception as e:
        return {"allowed": True, "message": f"Could not inspect Gatekeeper: {e}"}
    detail = (proc.stderr or proc.stdout or "").strip()
    if proc.returncode == 0:
        return {"allowed": True, "message": detail}
    return {"allowed": False, "message": detail or "Gatekeeper blocked execution"}


def _remove_macos_quarantine(path: Path) -> Optional[str]:
    if platform.system() != "Darwin" or not path.exists():
        return None
    try:
        proc = subprocess.run(
            ["xattr", "-dr", "com.apple.quarantine", str(path)],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except Exception as e:
        return f"Could not remove macOS quarantine from {path}: {e}"
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        return f"Could not remove macOS quarantine from {path}: {detail or 'xattr failed'}"
    return None


def _repair_executable(path: Path) -> Optional[str]:
    if not path.exists():
        return f"{path} does not exist"
    if os.access(path, os.X_OK):
        return None
    try:
        mode = path.stat().st_mode
        path.chmod(mode | 0o111)
    except Exception as e:
        return f"Could not make {path} executable: {e}"
    if os.access(path, os.X_OK):
        return None
    return f"{path} is still not executable after permission repair"


def _repair_macos_ollama_app(app: Path) -> Optional[str]:
    errors: list[str] = []
    quarantine_error = _remove_macos_quarantine(app)
    if quarantine_error:
        errors.append(quarantine_error)
    executable_error = _repair_executable(_macos_ollama_binary(app))
    if executable_error:
        errors.append(executable_error)
    return "; ".join(errors) if errors else None


def _repair_macos_ollama_apps() -> list[str]:
    errors: list[str] = []
    for app in _macos_ollama_app_candidates():
        if not app.exists():
            continue
        error = _repair_macos_ollama_app(app)
        if error:
            errors.append(error)
    return errors


def _download_headers() -> dict[str, str]:
    return {
        "User-Agent": "ResearchAtlas/0.1.1",
        "Accept": "application/zip,application/octet-stream,*/*",
    }


def _describe_download(path: Path) -> str:
    try:
        raw = path.read_bytes()[:300]
    except OSError:
        return "could not read downloaded file"
    text = raw.decode("utf-8", errors="replace").replace("\n", " ").strip()
    return text or raw.hex()[:120]

def _ollama_url() -> str:
    try:
        from config import normalize_ollama_base_url, settings
        return normalize_ollama_base_url(settings.ollama_base_url)
    except Exception:
        return "http://127.0.0.1:11434"


async def ollama_diagnostics() -> dict:
    try:
        from system.model_paths import resolve_ollama_binary

        binary = resolve_ollama_binary()
    except Exception as e:
        binary = None
        binary_error = str(e)
    else:
        binary_error = ""

    apps = [
        {
            "path": str(app),
            "exists": app.exists(),
            "binary_exists": _macos_ollama_binary(app).exists(),
            "binary_executable": os.access(_macos_ollama_binary(app), os.X_OK),
            "quarantine": _macos_quarantine_status(app),
            "gatekeeper": _macos_gatekeeper_status(app),
        }
        for app in _macos_ollama_app_candidates()
    ]

    api_url = _ollama_url()
    api_error = ""
    api_running = False
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{api_url}/api/tags")
            api_running = resp.status_code == 200
            if not api_running:
                api_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        api_error = str(e)

    return {
        "platform": platform.system(),
        "api_url": api_url,
        "api_running": api_running,
        "api_error": api_error,
        "app_candidates": apps,
        "binary": binary,
        "binary_error": binary_error,
        "installed": bool(binary) or any(app["exists"] for app in apps),
    }


async def install_ollama(progress_callback=None) -> bool:
    system = platform.system()
    url = OLLAMA_INSTALL_URLS.get(system)
    if not url:
        raise RuntimeError(f"Unsupported OS: {system}")

    if progress_callback:
        await progress_callback({"step": "download", "message": f"Downloading Ollama for {system}...", "percent": 0})

    if system == "Linux":
        return await _install_linux(progress_callback)
    elif system == "Darwin":
        return await _install_macos(url, progress_callback)
    elif system == "Windows":
        return await _install_windows(url, progress_callback)
    return False


async def _install_linux(progress_callback) -> bool:
    proc = await asyncio.create_subprocess_shell(
        "curl -fsSL https://ollama.com/install.sh | sh",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    if progress_callback:
        await progress_callback({"step": "install", "message": "Installing Ollama...", "percent": 50})
    await proc.communicate()
    if progress_callback:
        await progress_callback({"step": "done", "message": "Ollama installed.", "percent": 100})
    return proc.returncode == 0


async def _install_macos(url: str, progress_callback) -> bool:
    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = Path(tmpdir) / "Ollama.zip"
        async with httpx.AsyncClient(timeout=300, follow_redirects=True, headers=_download_headers()) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                total = int(resp.headers.get("content-length", 0))
                downloaded = 0
                with open(zip_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if progress_callback and total:
                            pct = int(downloaded / total * 60)
                            await progress_callback({"step": "download", "message": "Downloading...", "percent": pct})

        if progress_callback:
            await progress_callback({"step": "extract", "message": "Extracting...", "percent": 65})

        if not zipfile.is_zipfile(zip_path):
            raise RuntimeError(
                "Ollama download was not a valid zip file. "
                f"First bytes: {_describe_download(zip_path)}"
            )
        with zipfile.ZipFile(zip_path) as archive:
            bad_file = archive.testzip()
            if bad_file:
                raise RuntimeError(f"Ollama zip is corrupt at {bad_file}. Try again.")
            archive.extractall(tmpdir)
        app_src = Path(tmpdir) / "Ollama.app"
        if not app_src.exists():
            raise RuntimeError("Downloaded Ollama archive did not contain Ollama.app")
        last_error: Exception | None = None
        app_dst: Path | None = None
        for candidate in _macos_ollama_app_candidates():
            try:
                candidate.parent.mkdir(parents=True, exist_ok=True)
                if candidate.exists():
                    shutil.rmtree(candidate)
                shutil.copytree(str(app_src), str(candidate))
                app_dst = candidate
                break
            except Exception as e:
                last_error = e
        if app_dst is None:
            raise RuntimeError(f"Could not install Ollama.app: {last_error}")
        repair_error = _repair_macos_ollama_app(app_dst)
        if repair_error:
            raise RuntimeError(repair_error)

        if progress_callback:
            await progress_callback({"step": "launch", "message": "Launching Ollama...", "percent": 90})

        subprocess.Popen(["open", str(app_dst)])
        await asyncio.sleep(3)

        if progress_callback:
            await progress_callback({"step": "done", "message": "Ollama installed successfully.", "percent": 100})
    return True


async def _install_windows(url: str, progress_callback) -> bool:
    with tempfile.TemporaryDirectory() as tmpdir:
        exe_path = Path(tmpdir) / "OllamaSetup.exe"
        async with httpx.AsyncClient(timeout=300, follow_redirects=True, headers=_download_headers()) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                with open(exe_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
        if progress_callback:
            await progress_callback({"step": "install", "message": "Running installer...", "percent": 60})
        proc = subprocess.run([str(exe_path), "/S"], capture_output=True)
        if progress_callback:
            await progress_callback({"step": "done", "message": "Done.", "percent": 100})
        return proc.returncode == 0


async def pull_model(model_name: str, progress_callback=None) -> bool:
    async with httpx.AsyncClient(timeout=600) as client:
        async with client.stream("POST", f"{_ollama_url()}/api/pull", json={"name": model_name}) as resp:
            async for line in resp.aiter_lines():
                if not line:
                    continue
                import json
                try:
                    data = json.loads(line)
                    if progress_callback:
                        await progress_callback(data)
                    if data.get("status") == "success":
                        return True
                except Exception:
                    continue
    return False


async def list_models() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            resp = await client.get(f"{_ollama_url()}/api/tags")
            resp.raise_for_status()
            return resp.json().get("models", [])
    except Exception:
        return []


async def delete_model(name: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.request(
                "DELETE",
                f"{_ollama_url()}/api/delete",
                json={"name": name},
            )
            return resp.status_code == 200
    except Exception:
        return False


async def check_ollama_running() -> bool:
    global _ollama_status_cache
    return await _check_ollama_running(force_refresh=False)


def _set_ollama_status_cache(value: bool) -> None:
    global _ollama_status_cache
    _ollama_status_cache = (time.monotonic(), bool(value))


async def _check_ollama_running(*, force_refresh: bool) -> bool:
    global _ollama_status_cache
    now = time.monotonic()
    cached_at, cached_value = _ollama_status_cache
    if not force_refresh and now - cached_at <= _OLLAMA_STATUS_TTL_SECONDS:
        return cached_value
    async with _ollama_status_lock:
        now = time.monotonic()
        cached_at, cached_value = _ollama_status_cache
        if not force_refresh and now - cached_at <= _OLLAMA_STATUS_TTL_SECONDS:
            return cached_value
        value = False
        try:
            async with httpx.AsyncClient(timeout=1.25) as client:
                resp = await client.get(f"{_ollama_url()}/api/tags")
                value = resp.status_code == 200
        except Exception:
            value = False
        _set_ollama_status_cache(value)
        return value


async def _wait_for_ollama(seconds: int = 15) -> bool:
    for _ in range(seconds * 2):
        if await _check_ollama_running(force_refresh=True):
            return True
        await asyncio.sleep(0.5)
    return False


def _popen_detached(args: list[str]) -> None:
    kwargs = {
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if platform.system() == "Windows":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(args, **kwargs)


def _try_popen_detached(args: list[str]) -> Optional[str]:
    try:
        _popen_detached(args)
        return None
    except Exception as e:
        return f"{args[0]}: {e}"


def _try_open_macos_app(app: Path) -> Optional[str]:
    try:
        proc = subprocess.run(
            ["open", str(app)],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception as e:
        return f"open {app}: {e}"
    if proc.returncode == 0:
        return None
    detail = (proc.stderr or proc.stdout or "").strip()
    return f"open {app}: {detail or f'exit status {proc.returncode}'}"


def _macos_start_failure_message(before: dict, after: dict, errors: list[str]) -> str:
    combined = " | ".join(
        [*errors, str(before.get("api_error") or ""), str(after.get("api_error") or "")]
    ).lower()
    app_candidates = (after.get("app_candidates") or before.get("app_candidates") or [])
    has_quarantine = any(
        bool((a.get("quarantine") or {}).get("quarantined"))
        for a in app_candidates
        if isinstance(a, dict)
    )
    gatekeeper_block = any(
        not bool((a.get("gatekeeper") or {}).get("allowed", True))
        for a in app_candidates
        if isinstance(a, dict)
    )

    if "damaged" in combined:
        return (
            "Could not start Ollama because macOS reports the app as damaged. "
            "Reinstall Ollama from ollama.com/download, then open it once manually from Applications."
        )
    if "permission denied" in combined:
        return (
            "Could not start Ollama due to macOS permissions on the Ollama binary. "
            "Open Ollama once manually from Applications; if needed run: "
            "chmod +x /Applications/Ollama.app/Contents/Resources/ollama"
        )
    if has_quarantine or gatekeeper_block or "cannot be opened" in combined or "blocked" in combined:
        return (
            "Could not start Ollama because macOS blocked the app. "
            "Research Atlas attempted automatic repair. If it is still blocked, run: "
            "xattr -dr com.apple.quarantine /Applications/Ollama.app "
            "then open Ollama once manually from Applications."
        )
    return "Could not start Ollama automatically. Open it from Applications and try again."


async def start_ollama() -> tuple[bool, str]:
    if await check_ollama_running():
        return True, "Ollama is running."

    before = await ollama_diagnostics()
    system = platform.system()
    errors: list[str] = []
    if system == "Darwin":
        errors.extend(_repair_macos_ollama_apps())
        for app in _macos_ollama_app_candidates():
            if app.exists():
                error = _try_open_macos_app(app)
                if error:
                    errors.append(error)
                if await _wait_for_ollama(12):
                    return True, "Ollama is running."
                break
        error = _try_popen_detached(["open", "-a", "Ollama"])
        if error:
            errors.append(error)
        if await _wait_for_ollama(8):
            return True, "Ollama is running."

    binary = None
    try:
        from system.model_paths import resolve_ollama_binary

        binary = resolve_ollama_binary()
    except Exception as e:
        errors.append(f"Could not resolve Ollama binary: {e}")
        binary = shutil.which("ollama")

    if not binary:
        detail = "; ".join(errors)
        suffix = f" Details: {detail}" if detail else ""
        return False, f"Ollama is installed, but the Ollama command was not found.{suffix}"

    error = _try_popen_detached([binary, "serve"])
    if error:
        errors.append(error)
    if await _wait_for_ollama(15):
        return True, "Ollama is running."

    after = await ollama_diagnostics()
    detail = "; ".join(errors)
    diagnostic = after.get("api_error") or before.get("api_error") or ""
    suffix_parts = []
    if detail:
        suffix_parts.append(f"launch: {detail}")
    if diagnostic:
        suffix_parts.append(f"api: {diagnostic}")
    suffix = f" Details: {'; '.join(suffix_parts)}" if suffix_parts else ""
    if system == "Darwin":
        guidance = _macos_start_failure_message(before, after, errors)
        return False, f"{guidance}{suffix}"
    return False, f"Could not start Ollama.{suffix}"


def is_ollama_installed() -> bool:
    from system.model_paths import resolve_ollama_binary

    if resolve_ollama_binary():
        return True
    if platform.system() == "Darwin":
        return any(app.exists() for app in _macos_ollama_app_candidates())
    return False


async def get_ollama_version() -> Optional[str]:
    from system.model_paths import resolve_ollama_binary

    binary = resolve_ollama_binary()
    if not binary:
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            binary,
            "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        out = stdout.decode().strip()
        return out.split()[-1] if out else None
    except Exception:
        return None


async def uninstall_ollama() -> bool:
    system = platform.system()
    if system == "Darwin":
        subprocess.run(["pkill", "-x", "ollama"], capture_output=True)
        subprocess.run(
            ["osascript", "-e", 'tell application "Ollama" to quit'],
            capture_output=True,
        )
        await asyncio.sleep(1)
        removed = False
        for app in _macos_ollama_app_candidates():
            if app.exists():
                shutil.rmtree(app)
                removed = True
        if removed:
            _set_ollama_status_cache(False)
            return True
        return False
    if system == "Linux":
        raise RuntimeError(
            "On Linux, uninstall Ollama with your package manager or run: "
            "curl -fsSL https://ollama.com/install.sh | sh"
        )
    if system == "Windows":
        raise RuntimeError(
            "On Windows, uninstall Ollama from Settings → Apps or run the Ollama uninstaller."
        )
    raise RuntimeError(f"Unsupported OS: {system}")
