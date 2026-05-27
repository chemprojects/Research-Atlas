from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any, Callable, Optional

from config import settings

log = logging.getLogger(__name__)

# Generous timeouts for slow networks (embedding models are hundreds of MB).
HF_ENV = {
    "HF_HUB_DOWNLOAD_TIMEOUT": "900",
    "HF_HUB_ETAG_TIMEOUT": "60",
    "HF_HUB_ENABLE_HF_TRANSFER": "0",
}


def embedding_cache_root() -> Path:
    root = settings.models_path / "embedding"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _match_keys(model_id: str) -> list[str]:
    return [
        model_id.lower(),
        model_id.replace("/", "--").lower(),
        model_id.replace("/", "_").lower(),
        (model_id.split("/")[-1] if "/" in model_id else model_id).lower(),
    ]


def is_embedding_cached(model_id: str) -> bool:
    cache = embedding_cache_root()
    if not cache.is_dir():
        return False
    keys = _match_keys(model_id)
    for child in cache.iterdir():
        name = child.name.lower()
        if any(k in name for k in keys):
            # Ignore incomplete hub snapshots
            if ".incomplete" in name or name.endswith(".tmp"):
                continue
            if child.is_dir():
                try:
                    if any(child.iterdir()):
                        return True
                except OSError:
                    continue
    return False


def embedding_cache_dirs(model_id: str) -> list[Path]:
    cache = embedding_cache_root()
    if not cache.is_dir():
        return []
    keys = _match_keys(model_id)
    return [
        child
        for child in cache.iterdir()
        if any(k in child.name.lower() for k in keys)
    ]


def cleanup_embedding_download(model_id: str) -> None:
    """Remove partial / failed Hugging Face cache folders so retry can start clean."""
    cache = embedding_cache_root()
    keys = _match_keys(model_id)
    if not cache.is_dir():
        return
    for child in list(cache.iterdir()):
        name = child.name.lower()
        if any(k in name for k in keys):
            if ".incomplete" in name or ".tmp" in name or "tmp" in name:
                shutil.rmtree(child, ignore_errors=True)
                log.info("Removed incomplete cache: %s", child)
                continue
            # On failed install, remove empty or partial model dirs
            try:
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                    log.info("Removed cache dir for retry: %s", child)
            except OSError:
                pass


def delete_embedding_cache(model_id: str) -> bool:
    removed = False
    for path in embedding_cache_dirs(model_id):
        shutil.rmtree(path, ignore_errors=True)
        removed = True
    cleanup_embedding_download(model_id)
    return removed


def _sync_download(model_id: str, cache_dir: str, attempts: int = 3) -> None:
    for key, val in HF_ENV.items():
        os.environ.setdefault(key, val)

    last_err: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            log.info(
                "Embedding download attempt %s/%s: %s → %s",
                attempt,
                attempts,
                model_id,
                cache_dir,
            )
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id=model_id,
                cache_dir=cache_dir,
                resume_download=True,
                local_files_only=False,
            )
            return
        except Exception as e:
            last_err = e
            log.warning(
                "Embedding download attempt %s failed for %s: %s",
                attempt,
                model_id,
                e,
            )
            cleanup_embedding_download(model_id)
            if attempt < attempts:
                time.sleep(3)

    assert last_err is not None
    raise last_err


async def download_embedding(
    model_id: str,
    progress_callback: Optional[Callable[[dict[str, Any]], Any]] = None,
) -> tuple[bool, str]:
    """
    Download an embedding model into ~/.research_atlas/models/embedding.
    Returns (success, message).
    """
    cache_dir = str(embedding_cache_root())

    if is_embedding_cached(model_id):
        return True, f"{model_id} is already installed."

    if progress_callback:
        await progress_callback(
            {
                "status": "downloading",
                "message": f"Downloading {model_id} from Hugging Face (may take 5–15 min)…",
            }
        )

    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: _sync_download(model_id, cache_dir),
        )
    except Exception as e:
        cleanup_embedding_download(model_id)
        err = str(e).strip() or type(e).__name__
        log.exception("Embedding download failed for %s", model_id)
        hint = (
            " Check your internet connection and try Install again. "
            f"Cache folder: {cache_dir}"
        )
        return False, f"{err}.{hint}"

    if progress_callback:
        await progress_callback({"status": "success", "message": "Download complete."})

    if is_embedding_cached(model_id):
        return True, f"Embedding model ready: {model_id}"

    return (
        False,
        f"Download finished but {model_id} was not found in {cache_dir}. Try Install again.",
    )
