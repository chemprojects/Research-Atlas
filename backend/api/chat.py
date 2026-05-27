from __future__ import annotations

import asyncio
import json
import time
from typing import Any
from pathlib import Path

import httpx
from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from config import normalize_ollama_base_url, settings
from services.chat_attachments import save_upload
from services import pdf_library as pdf_lib

router = APIRouter(prefix="/chat", tags=["chat"])
_PROFILE_CACHE_TTL_SECONDS = 45.0
_profile_cache_lock = asyncio.Lock()
_profile_cache: tuple[float, list[tuple[str, list[str]]] | None] = (0.0, None)

# Shared HTTP client with connection pooling for better performance
_http_client = httpx.AsyncClient(
    timeout=120,
    limits=httpx.Limits(max_connections=10, max_keepalive_connections=5, keepalive_expiry=30),
)

SYSTEM_PROMPT = """You are Research Atlas, an AI research assistant for scientific literature.

You help researchers:
- Understand and discuss scientific papers
- Explain methods, assumptions, evidence, and limitations
- Summarize findings and their implications
- Compare papers and identify trends
- Answer questions using the user's selected papers, files, and research profile when available

When papers are provided as context, reference them specifically. Treat the user's profile as a preference signal, not a restriction: adapt to it when relevant, but do not force every answer into one domain. Be precise, scientifically accurate, and concise. If you don't know something, say so rather than speculating.

All processing is local. This conversation is private.

Response policy:
- Use provided papers/files as primary evidence when available.
- Treat user profile as secondary preference guidance only.
- If app context is missing or insufficient, say that clearly and ask for the needed paper/folder/file.
- If attached file text is present in context, do not claim you cannot access files; the extracted text is already provided to you.
- Never claim to be OpenAI, Microsoft, Anthropic, or any other provider persona.
- Avoid repetitive loops; if evidence is limited, state limits once and move to actionable next steps.
- When referencing papers, always cite them by title — never by a number or list index.
- When discussing a specific paper, extract and use its title, authors, journal, and other metadata from the provided context. Do not require the user to provide placeholders like "[Paper Name]" or "[Author]"; use the actual information available in the paper context."""


def _trim_history(history: list[dict[str, Any]], limit: int) -> list[dict[str, str]]:
    trimmed: list[dict[str, str]] = []
    for h in history[-limit:]:
        role = str(h.get("role") or "").strip()
        if role not in {"user", "assistant"}:
            continue
        content = str(h.get("content") or "").strip()
        if not content:
            continue
        if len(content) > 1400:
            content = content[:1400] + "\n[…truncated…]"
        trimmed.append({"role": role, "content": content})
    return trimmed


def _attachment_context(
    attachments: list[dict[str, Any]],
    *,
    max_files: int = 3,
    max_chars_per_file: int = 3500,
    max_total_chars: int = 9000,
) -> str:
    if not attachments:
        return ""
    parts = [
        "\n\n## Files attached to this message:\n"
        "The full extracted text below is available for analysis and question answering.\n"
    ]
    total = 0
    for i, att in enumerate(attachments[:max_files], 1):
        name = att.get("name") or f"file-{i}"
        text = (att.get("text") or "").strip()
        if not text:
            continue
        remaining = max_total_chars - total
        if remaining <= 0:
            break
        clipped = text[: min(max_chars_per_file, remaining)]
        total += len(clipped)
        parts.append(f"\n### [{i}] {name}\n{clipped}\n")
    if total >= max_total_chars:
        parts.append("\n[Attachment context truncated to fit model context window]\n")
    return "".join(parts)


def _tokenize(text: str) -> set[str]:
    import re

    return {t for t in re.split(r"[^a-z0-9]+", text.lower()) if len(t) >= 3}


def _dedupe_paper_context(papers: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    seen: set[str] = set()
    for paper in papers:
        doi = str(paper.get("doi") or "").strip().lower()
        title = str(paper.get("title") or "").strip().lower()
        key = doi or title
        if not key or key in seen:
            continue
        seen.add(key)
        kept.append(paper)
        if len(kept) >= limit:
            break
    return kept


def _compress_repeated_tail(text: str) -> str:
    """Trim repeated trailing line blocks if a model starts looping."""
    lines = [line for line in text.splitlines()]
    if len(lines) < 8:
        return text
    changed = True
    while changed and len(lines) >= 8:
        changed = False
        for window in (6, 5, 4, 3, 2):
            if len(lines) < window * 2:
                continue
            a = lines[-window:]
            b = lines[-window * 2 : -window]
            if a and a == b:
                lines = lines[:-window]
                changed = True
                break
    return "\n".join(lines).strip()


async def _profile_rows_cached() -> list[tuple[str, list[str]]]:
    global _profile_cache
    now = time.monotonic()
    at, cached = _profile_cache
    if cached is not None and now - at < _PROFILE_CACHE_TTL_SECONDS:
        return cached
    async with _profile_cache_lock:
        now = time.monotonic()
        at, cached = _profile_cache
        if cached is not None and now - at < _PROFILE_CACHE_TTL_SECONDS:
            return cached
        try:
            from database.db import AsyncSessionLocal
            from database.models import ResearchProfile
            from sqlalchemy import select

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ResearchProfile).limit(1))
                profile = result.scalar_one_or_none()
            if not profile:
                _profile_cache = (time.monotonic(), [])
                return []

            rows: list[tuple[str, list[str]]] = []
            for label, raw in (
                ("Interests", profile.interests),
                ("Domains", profile.domains),
                ("Keywords", profile.keywords),
                ("Authors of interest", profile.authors_of_interest),
                ("Journals of interest", profile.journals_of_interest),
            ):
                try:
                    values = json.loads(raw or "[]")
                except Exception:
                    values = []
                values = [str(v).strip() for v in values if str(v).strip()]
                if values:
                    rows.append((label, values[:12]))
            _profile_cache = (time.monotonic(), rows)
            return rows
        except Exception:
            _profile_cache = (time.monotonic(), [])
            return []


async def _profile_context(
    message: str,
    paper_context: list[dict[str, Any]],
) -> str:
    try:
        rows = await _profile_rows_cached()
        if not rows:
            return ""

        query_tokens = _tokenize(message)
        for paper in paper_context[:4]:
            query_tokens |= _tokenize(str(paper.get("title") or ""))
            query_tokens |= _tokenize(str(paper.get("keywords") or ""))

        scored: list[tuple[int, str, list[str]]] = []
        for label, values in rows:
            score = 0
            for value in values:
                vt = _tokenize(value)
                if vt & query_tokens:
                    score += 3
            scored.append((score, label, values))
        scored.sort(key=lambda x: x[0], reverse=True)

        # Keep profile influence explicit but bounded.
        top = scored[:3]
        lines = ["\n\n## User research profile (secondary preference guidance only):"]
        if top and top[0][0] > 0:
            lines.append("- Apply these preferences only where relevant to the current question/context.")
            for _, label, values in top:
                lines.append(f"{label}: {', '.join(values)}")
        else:
            # If nothing overlaps and no paper context is selected, skip profile injection
            # to avoid accidental domain over-bias.
            if not paper_context:
                return ""
            lines.append(
                "- Profile exists, but no strong overlap with this query. Do not force domain framing."
            )
            # Keep at most one compact row as light preference context.
            label, values = rows[0]
            lines.append(f"{label}: {', '.join(values[:4])}")
        return "\n".join(lines)
    except Exception:
        return ""


def _context_overview(
    paper_context: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    context_meta: dict[str, Any] | None,
) -> str:
    scope = ""
    selected = 0
    available = 0
    if isinstance(context_meta, dict):
        scope = str(context_meta.get("scope") or "").strip()
        try:
            selected = int(context_meta.get("selected_count") or 0)
        except Exception:
            selected = 0
        try:
            available = int(context_meta.get("available_count") or 0)
        except Exception:
            available = 0
    parts = ["\n\n## App context status:\n"]
    parts.append(f"- Papers provided: {len(paper_context)}")
    if selected:
        parts.append(f"- Papers selected in app context: {selected}")
    elif available > 0:
        parts.append(f"- Saved papers available in app: {available} (none were attached to this turn)")
    parts.append(f"- Attached files provided: {len(attachments)}")
    if scope:
        parts.append(f"- Context scope: {scope}")
    if not paper_context and not attachments:
        parts.append(
            "- No app paper/file context was provided for this message. Do not pretend to quote app content."
        )
        if available > 0:
            parts.append(
                "- Ask the user to select a folder/project paper context (or attach a file) before giving paper-specific claims."
            )
        else:
            parts.append(
                "- Ask the user to save/select papers or attach a document before paper-specific analysis."
            )
    return "\n".join(parts)


def _author_names(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    names: list[str] = []
    for author in value:
        if isinstance(author, str):
            name = author.strip()
        elif isinstance(author, dict):
            raw_name = author.get("name") or author.get("display_name") or author.get("full_name")
            if isinstance(raw_name, str) and raw_name.strip():
                name = raw_name.strip()
            else:
                name = " ".join(
                    str(author.get(part, "")).strip()
                    for part in ("given", "family")
                    if str(author.get(part, "")).strip()
                )
        else:
            name = ""
        if name:
            names.append(name)
    return names


@router.post("/upload")
async def upload_attachment(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename is required")
    data = await file.read()
    try:
        return save_upload(file.filename, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}") from e


@router.post("/attach-library-pdf")
async def attach_library_pdf(body: dict = Body(...)):
    paper_id = str(body.get("paper_id") or "").strip()
    folder_id = str(body.get("folder_id") or "").strip() or None
    if not paper_id:
        raise HTTPException(status_code=400, detail="paper_id is required")

    status = pdf_lib.pdf_status(paper_id, folder_id)
    # Fallback to canonical saved PDF if a folder-specific lookup misses.
    if status.get("status") != "saved":
        status = pdf_lib.pdf_status(paper_id, None)
    path = str(status.get("path") or "").strip()
    if status.get("status") != "saved" or not path:
        raise HTTPException(status_code=404, detail="No saved PDF found for this paper in the selected folder")

    file_path = Path(path)
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Saved PDF file path is no longer valid")

    try:
        data = file_path.read_bytes()
        return save_upload(file_path.name, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not load PDF: {e}") from e


@router.post("/")
async def chat(body: dict):
    request_started = time.perf_counter()
    message = body.get("message", "").strip()
    history = body.get("history", [])  # list of {role: "user"|"assistant", content: str}
    raw_paper_context = body.get("paper_context", [])  # list of paper dicts
    paper_context = raw_paper_context if isinstance(raw_paper_context, list) else []
    attachments = body.get("attachments") or []
    context_meta = body.get("context_meta") if isinstance(body.get("context_meta"), dict) else None
    speed_preset = str(body.get("speed_preset") or "balanced").strip().lower()
    if speed_preset not in {"fast", "balanced", "quality"}:
        speed_preset = "balanced"

    history_limit = {"fast": 4, "balanced": 8, "quality": 12}[speed_preset]
    paper_limit = {"fast": 3, "balanced": 5, "quality": 7}[speed_preset]
    abstract_limit = {"fast": 100, "balanced": 150, "quality": 220}[speed_preset]
    summary_limit = {"fast": 160, "balanced": 220, "quality": 320}[speed_preset]
    max_context_chars = {"fast": 4200, "balanced": 7000, "quality": 9800}[speed_preset]
    attachment_limits = {
        "fast": {"files": 2, "per_file": 1800, "total": 3000},
        "balanced": {"files": 3, "per_file": 2600, "total": 5600},
        "quality": {"files": 4, "per_file": 3400, "total": 8800},
    }[speed_preset]

    if not message and not attachments:
        raise HTTPException(status_code=400, detail="message or attachments required")

    # Build context string from papers
    paper_context = _dedupe_paper_context(paper_context, paper_limit)
    context_str = await _profile_context(message, paper_context)
    context_str += _context_overview(
        paper_context,
        attachments if isinstance(attachments, list) else [],
        context_meta,
    )
    if paper_context:
        context_str += "\n\n## Papers provided as context:\n"
        added_chars = 0
        for i, p in enumerate(paper_context[:paper_limit], 1):
            block = f"\n**{p.get('title', 'Untitled')}**\n"
            authors = _author_names(p.get("authors"))
            if authors:
                block += f"Authors: {', '.join(authors[:6])}\n"
            block += f"Journal: {p.get('journal', '')} ({p.get('published_date', '')[:4]})\n"
            if p.get("doi"):
                block += f"DOI: {p['doi']}\n"
            elif p.get("url"):
                block += f"URL: {p['url']}\n"
            if p.get('summary'):
                block += f"Summary: {str(p['summary'])[:summary_limit]}\n"
            if p.get('abstract'):
                block += f"Abstract: {str(p['abstract'])[:abstract_limit]}...\n"
            if added_chars + len(block) > max_context_chars:
                context_str += "\n[Paper context truncated to keep response fast]\n"
                break
            context_str += block
            added_chars += len(block)

    if len(context_str) > max_context_chars:
        context_str = context_str[:max_context_chars] + "\n\n[Context clipped for speed]"

    system = SYSTEM_PROMPT + context_str

    # Build messages for Ollama
    messages = [{"role": "system", "content": system}]
    for h in _trim_history(history if isinstance(history, list) else [], history_limit):
        messages.append(h)
    user_content = message
    attachment_context = _attachment_context(
        attachments if isinstance(attachments, list) else [],
        max_files=int(attachment_limits["files"]),
        max_chars_per_file=int(attachment_limits["per_file"]),
        max_total_chars=int(attachment_limits["total"]),
    )
    if attachments and not user_content:
        names = ", ".join(a.get("name", "file") for a in attachments[:5])
        user_content = f"Please read and discuss the attached file(s): {names}"
    if attachment_context:
        user_content = f"{user_content}\n\n{attachment_context}".strip()
    messages.append({"role": "user", "content": user_content})

    async def stream_response():
        assistant_accum = ""
        stream_started = time.perf_counter()
        first_token_logged = False
        token_count = 0
        try:
            async with _http_client.stream(
                "POST",
                f"{normalize_ollama_base_url(settings.ollama_base_url)}/api/chat",
                json={
                    "model": settings.chat_llm_model or settings.llm_model,
                    "messages": messages,
                    "stream": True,
                    "keep_alive": "10m",
                    "options": {
                        "num_ctx": {"fast": 3072, "balanced": 6144, "quality": 8192}[speed_preset],
                        "num_predict": {"fast": 1024, "balanced": 2048, "quality": 4096}[speed_preset],
                        "temperature": {"fast": 0.05, "balanced": 0.15, "quality": 0.2}[speed_preset],
                        "top_p": 0.9,
                        "top_k": {"fast": 30, "balanced": 40, "quality": 50}[speed_preset],
                        "repeat_penalty": 1.35,
                        "repeat_last_n": 1024,
                        "stop": ["\n\nUser:", "\nUser:", "## Papers provided as context:"],
                    },
                },
            ) as resp:
                    async for line in resp.aiter_lines():
                        if line:
                            try:
                                data = json.loads(line)
                                token = data.get("message", {}).get("content", "")
                                if token:
                                    if not first_token_logged:
                                        first_token_logged = True
                                    assistant_accum += token
                                    token_count += 1
                                    yield f"data: {json.dumps({'token': token})}\n\n"
                                    # Check repetition every 10 tokens to reduce overhead
                                    if token_count % 10 == 0 and len(assistant_accum) > 1200:
                                        tail = assistant_accum[-220:]
                                        if tail and assistant_accum.endswith(tail * 2):
                                            assistant_accum = _compress_repeated_tail(assistant_accum)
                                            yield f"data: {json.dumps({'done': True, 'final': assistant_accum})}\n\n"
                                            return
                                        # Also check for line repetition every 10 tokens
                                        lines = [ln.strip() for ln in assistant_accum.splitlines() if ln.strip()]
                                        if len(lines) >= 8:
                                            last = lines[-1]
                                            repeated = sum(1 for ln in lines[-8:] if ln == last)
                                            if repeated >= 5 and len(last) > 12:
                                                assistant_accum = _compress_repeated_tail(assistant_accum)
                                                yield f"data: {json.dumps({'done': True, 'final': assistant_accum})}\n\n"
                                                return
                                if data.get("done"):
                                    assistant_accum = _compress_repeated_tail(assistant_accum)
                                    yield f"data: {json.dumps({'done': True, 'final': assistant_accum})}\n\n"
                                    return
                            except json.JSONDecodeError:
                                pass
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")


@router.get("/models")
async def get_active_model():
    return {"model": settings.chat_llm_model or settings.llm_model, "ollama_base": normalize_ollama_base_url(settings.ollama_base_url)}
