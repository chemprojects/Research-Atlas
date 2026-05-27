from __future__ import annotations

import logging
import os
import subprocess
import sys
import venv
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger(__name__)

ProgressCallback = Callable[[dict], None]

# Must not import config here — bootstrap runs before requirements are installed.
APP_DATA_DIR = Path.home() / ".research_atlas"


def app_data_dir() -> Path:
    return APP_DATA_DIR


def venv_path() -> Path:
    return APP_DATA_DIR / "venv"


def requirements_path(backend_dir: Path) -> Path:
    return backend_dir / "requirements.txt"


def python_executable() -> Path:
    root = venv_path()
    if sys.platform == "win32":
        return root / "Scripts" / "python.exe"
    return root / "bin" / "python"


def is_venv_ready() -> bool:
    exe = python_executable()
    if not exe.is_file():
        return False
    try:
        subprocess.run(
            [str(exe), "-c", "import fastapi, uvicorn"],
            capture_output=True,
            timeout=60,
            check=True,
        )
        return True
    except Exception:
        return False


def resolve_backend_dir() -> Path:
    """Directory containing main.py (dev checkout or bundled resource)."""
    here = Path(__file__).resolve().parent.parent
    if (here / "main.py").is_file():
        return here
    candidates = [
        Path.cwd(),
        Path.cwd() / "backend",
    ]
    for c in candidates:
        if (c / "main.py").is_file():
            return c.resolve()
    return here


def ensure_venv(
    backend_dir: Optional[Path] = None,
    progress: Optional[ProgressCallback] = None,
) -> Path:
    """Create app-local venv and install backend requirements."""
    backend = backend_dir or resolve_backend_dir()

    def emit(step: str, message: str, percent: int) -> None:
        if progress:
            progress({"step": step, "message": message, "percent": percent})

    emit("venv", "Preparing Python environment…", 5)

    # Delegate to stdlib-only bootstrap script (same logic as Tauri first launch).
    script = backend / "bootstrap_venv.py"
    if not script.is_file():
        raise FileNotFoundError(f"bootstrap_venv.py not found at {script}")

    proc = subprocess.run(
        [sys.executable, str(script), "--backend-dir", str(backend)],
        capture_output=True,
        text=True,
        timeout=1800,
    )
    if proc.stdout:
        log.info(proc.stdout.strip())
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-2000:]
        raise RuntimeError(f"Failed to create the isolated Python environment.\n{tail}")

    emit("done", "Backend environment ready.", 100)
    exe = python_executable()
    if not exe.is_file():
        raise FileNotFoundError(f"Python environment not found at {exe}")
    return exe


def purge_venv() -> bool:
    root = venv_path()
    if root.exists():
        import shutil

        shutil.rmtree(root, ignore_errors=True)
        return True
    return False
