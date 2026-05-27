from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

from config import settings

UPLOAD_DIR = settings.app_data_dir / "chat_uploads"
MAX_BYTES = 64 * 1024 * 1024
MAX_TEXT_CHARS = 24_000

TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log"}


def _truncate(text: str) -> str:
    text = text.strip()
    if len(text) <= MAX_TEXT_CHARS:
        return text
    return text[:MAX_TEXT_CHARS] + "\n\n[…truncated for context length…]"


def _extract_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
        import io

        reader = PdfReader(io.BytesIO(data))
        parts: list[str] = []
        for page in reader.pages[:80]:
            t = page.extract_text() or ""
            if t.strip():
                parts.append(t)
        text = _truncate("\n\n".join(parts))
        if not text.strip():
            return (
                "[PDF loaded, but no extractable text was found. "
                "This file may be image-only/scanned, encrypted, or use non-extractable fonts.]"
            )
        return text
    except Exception as e:
        return f"[Could not extract PDF text: {e}]"


def extract_text(filename: str, data: bytes) -> str:
    if len(data) > MAX_BYTES:
        raise ValueError(f"File too large (max {MAX_BYTES // (1024 * 1024)} MB)")

    ext = Path(filename).suffix.lower()
    if ext in TEXT_EXTENSIONS or not ext:
        try:
            return _truncate(data.decode("utf-8"))
        except UnicodeDecodeError:
            return _truncate(data.decode("latin-1", errors="replace"))

    if ext == ".pdf":
        return _extract_pdf(data)

    raise ValueError(f"Unsupported file type: {ext or 'unknown'}")


def save_upload(filename: str, data: bytes) -> dict[str, Any]:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^\w.\- ]+", "_", Path(filename).name)[:120] or "upload"
    file_id = str(uuid.uuid4())
    dest = UPLOAD_DIR / f"{file_id}_{safe_name}"
    dest.write_bytes(data)
    text = extract_text(filename, data)
    return {
        "id": file_id,
        "name": safe_name,
        "path": str(dest),
        "mime": "application/pdf" if safe_name.lower().endswith(".pdf") else "text/plain",
        "size_bytes": len(data),
        "text": text,
        "text_length": len(text),
    }
