from __future__ import annotations
from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Any
import json, os, logging

log = logging.getLogger(__name__)

APP_DATA_DIR = Path.home() / ".research_atlas"
APP_DATA_DIR.mkdir(exist_ok=True)
CONFIG_PATH = APP_DATA_DIR / "config.json"
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"


def normalize_ollama_base_url(value: str | None) -> str:
    url = (value or DEFAULT_OLLAMA_BASE_URL).strip().rstrip("/")
    if url in {"http://localhost:11434", "https://localhost:11434"}:
        return url.replace("localhost", "127.0.0.1")
    return url


class Settings(BaseSettings):
    app_data_dir: Path = APP_DATA_DIR
    db_path: Path = APP_DATA_DIR / "papers.db"
    vector_path: Path = APP_DATA_DIR / "vectors"
    pdf_cache_path: Path = APP_DATA_DIR / "pdfs"
    log_path: Path = APP_DATA_DIR / "logs"
    models_path: Path = APP_DATA_DIR / "models"
    chats_path: Path = APP_DATA_DIR / "chats"
    embedding_model: str = "allenai/specter2_base"
    llm_model: str = ""
    llm_model_selected: bool = False
    chat_llm_model: str = ""
    ollama_base_url: str = DEFAULT_OLLAMA_BASE_URL
    ollama_models_path: str = ""
    daily_paper_limit: int = 1000
    scan_lookback_days: int = 7
    scan_source_timeout_seconds: int = 35
    top_k_for_llm: int = 50
    digest_top_n: int = 20
    run_mode: str = "cpu"  # cpu | gpu | hybrid
    first_run: bool = True
    version: str = "0.1.1"
    resource_allocation: dict[str, Any] = Field(default_factory=dict)
    must_read_threshold: float = 0.68

    def save(self):
        existing: dict = {}
        if CONFIG_PATH.exists():
            try:
                existing = json.loads(CONFIG_PATH.read_text())
            except Exception:
                pass
        data = {
            "embedding_model": self.embedding_model,
            "llm_model": self.llm_model,
            "llm_model_selected": self.llm_model_selected,
            "chat_llm_model": self.chat_llm_model,
            "ollama_base_url": normalize_ollama_base_url(self.ollama_base_url),
            "ollama_models_path": self.ollama_models_path,
            "daily_paper_limit": self.daily_paper_limit,
            "scan_lookback_days": self.scan_lookback_days,
            "scan_source_timeout_seconds": self.scan_source_timeout_seconds,
            "top_k_for_llm": self.top_k_for_llm,
            "digest_top_n": self.digest_top_n,
            "run_mode": self.run_mode,
            "first_run": self.first_run,
            "resource_allocation": self.resource_allocation or existing.get("resource_allocation", {}),
            "must_read_threshold": self.must_read_threshold,
        }
        CONFIG_PATH.write_text(json.dumps(data, indent=2))


def _hydrate_from_config_file() -> None:
    if not CONFIG_PATH.exists():
        return
    try:
        data = json.loads(CONFIG_PATH.read_text())
    except Exception:
        return
    for key in (
        "embedding_model",
        "llm_model",
        "llm_model_selected",
        "chat_llm_model",
        "ollama_base_url",
        "ollama_models_path",
        "daily_paper_limit",
        "scan_lookback_days",
        "scan_source_timeout_seconds",
        "top_k_for_llm",
        "digest_top_n",
        "run_mode",
        "first_run",
        "must_read_threshold",
    ):
        if key in data:
            value = normalize_ollama_base_url(data[key]) if key == "ollama_base_url" else data[key]
            setattr(settings, key, value)
    if "resource_allocation" in data and isinstance(data["resource_allocation"], dict):
        settings.resource_allocation = data["resource_allocation"]


settings = Settings()
_hydrate_from_config_file()

if settings.ollama_models_path:
    os.environ["OLLAMA_MODELS"] = settings.ollama_models_path

for d in [settings.vector_path, settings.pdf_cache_path, settings.log_path, settings.models_path, settings.chats_path]:
    d.mkdir(exist_ok=True)
