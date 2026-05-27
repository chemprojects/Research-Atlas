#!/usr/bin/env python3
"""
Create ~/.research_atlas/venv and install backend requirements.

Uses only the Python standard library so it can run before any pip packages exist.
Invoked by the Tauri app on first launch and by scripts/dev-backend.sh.

Stdout lines prefixed with PHASE: are shown in the setup progress UI.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import venv
from pathlib import Path

APP_DATA_DIR = Path.home() / ".research_atlas"
VENV_DIR = APP_DATA_DIR / "venv"


def phase(name: str, message: str) -> None:
    print(f"PHASE:{name} {message}", flush=True)


def progress(message: str) -> None:
    print(f"PROGRESS:{message}", flush=True)


def venv_python() -> Path:
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def is_venv_ready(exe: Path) -> bool:
    if not exe.is_file():
        return False
    try:
        subprocess.run(
            [str(exe), "-c", "import fastapi, uvicorn"],
            capture_output=True,
            timeout=120,
            check=True,
        )
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return False


def verify_ml_stack(exe: Path) -> None:
    subprocess.run(
        [
            str(exe),
            "-c",
            "import torch; from sentence_transformers import SentenceTransformer",
        ],
        capture_output=True,
        timeout=180,
        check=True,
        env={**os.environ, "PYTHONNOUSERSITE": "1"},
    )


def run_pip(exe: Path, args: list[str], *, label: str, retries: int = 2) -> None:
    env = os.environ.copy()
    env.pop("VIRTUAL_ENV", None)
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env.setdefault("PIP_DEFAULT_TIMEOUT", "120")

    last_err = ""
    for attempt in range(1, retries + 1):
        progress(f"{label} (step {attempt}/{retries})…")
        proc = subprocess.run(
            [str(exe), "-m", "pip", *args],
            capture_output=True,
            text=True,
            env=env,
            timeout=1800,
        )
        if proc.returncode == 0:
            return
        last_err = (proc.stderr or proc.stdout or "")[-3000:]
        if attempt < retries:
            progress("Retrying after a brief pause…")
            time.sleep(3)

    raise RuntimeError(f"{label} failed:\n{last_err}")


def bootstrap(backend_dir: Path) -> Path:
    req = backend_dir / "requirements.txt"
    if not req.is_file():
        raise FileNotFoundError(f"requirements.txt not found at {req}")

    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (APP_DATA_DIR / "logs").mkdir(exist_ok=True)

    exe = venv_python()
    if not exe.is_file():
        phase("bootstrapping", "Creating isolated Python environment…")
        builder = venv.EnvBuilder(with_pip=True, clear=False)
        builder.create(VENV_DIR)
        exe = venv_python()

    if is_venv_ready(exe):
        phase("bootstrapping", "Python environment already ready.")
        return exe

    phase("bootstrapping", "Upgrading pip and build tools…")
    run_pip(
        exe,
        ["install", "--upgrade", "pip", "wheel", "setuptools"],
        label="Upgrading pip",
    )

    core = backend_dir / "requirements-core.txt"
    ml = backend_dir / "requirements-ml.txt"
    if core.is_file() and ml.is_file():
        phase("bootstrapping", "Installing core backend packages…")
        run_pip(
            exe,
            ["install", "--prefer-binary", "-r", str(core)],
            label="Installing core dependencies",
            retries=2,
        )
        phase("bootstrapping", "Installing ML / embedding packages (this is the slow step)…")
        run_pip(
            exe,
            ["install", "--prefer-binary", "-r", str(ml)],
            label="Installing ML dependencies",
            retries=2,
        )
        phase("bootstrapping", "Verifying ML / embedding stack…")
        verify_ml_stack(exe)
    else:
        phase("bootstrapping", "Installing backend packages (please keep the app open)…")
        run_pip(
            exe,
            ["install", "--prefer-binary", "-r", str(req)],
            label="Installing backend dependencies",
            retries=2,
        )

    if not is_venv_ready(exe):
        raise RuntimeError(
            "Dependencies installed but fastapi/uvicorn could not be imported. "
            "Check ~/.research_atlas/logs/launcher.log"
        )

    phase("bootstrapping", "Python environment ready.")
    return exe


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap Research Atlas Python venv")
    parser.add_argument(
        "--backend-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Directory containing requirements.txt",
    )
    args = parser.parse_args()
    try:
        bootstrap(args.backend_dir.resolve())
        return 0
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
