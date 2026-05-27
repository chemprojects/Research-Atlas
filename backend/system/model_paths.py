from __future__ import annotations

import os
import platform
import shutil
from pathlib import Path
from typing import Optional

from config import settings


def default_ollama_models_path() -> Path:
    if settings.ollama_models_path:
        return Path(settings.ollama_models_path).expanduser()
    return Path.home() / ".ollama" / "models"


def resolve_ollama_binary() -> Optional[str]:
    found = shutil.which("ollama")
    if found:
        return found
    if platform.system() == "Darwin":
        for app_root in (
            Path("/Applications/Ollama.app"),
            Path.home() / "Applications" / "Ollama.app",
        ):
            app_bin = app_root / "Contents" / "Resources" / "ollama"
            if app_bin.exists():
                return str(app_bin)
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        program_files = os.environ.get("ProgramFiles")
        candidates = []
        if local:
            candidates.extend(
                [
                    Path(local) / "Programs" / "Ollama" / "ollama.exe",
                    Path(local) / "Ollama" / "ollama.exe",
                ]
            )
        if program_files:
            candidates.append(Path(program_files) / "Ollama" / "ollama.exe")
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
    return None


def ollama_install_url() -> str:
    return "https://ollama.com/download"


def format_bytes(num: int) -> str:
    if num < 1024:
        return f"{num} B"
    if num < 1024 ** 2:
        return f"{num / 1024:.1f} KB"
    if num < 1024 ** 3:
        return f"{num / (1024 ** 2):.1f} MB"
    return f"{num / (1024 ** 3):.2f} GB"


def dir_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for f in path.rglob("*"):
        if f.is_file():
            try:
                total += f.stat().st_size
            except OSError:
                pass
    return total


def file_size(path: Path) -> int:
    try:
        return path.stat().st_size if path.is_file() else 0
    except OSError:
        return 0
