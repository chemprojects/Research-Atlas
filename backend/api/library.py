from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, HTTPException, Body, Query, File, UploadFile, Form
from pathlib import Path
import json
import logging
import time
from config import settings
from services import pdf_library as pdf_lib

router = APIRouter(prefix="/library", tags=["library"])
log = logging.getLogger("perf")

def _lib_path() -> Path:
    return settings.app_data_dir / "library.json"

def _load() -> dict:
    p = _lib_path()
    if not p.exists():
        return {"folders": [{"id": "default", "name": "Reading List", "parent": None}], "entries": []}
    try:
        return json.loads(p.read_text())
    except Exception:
        return {"folders": [{"id": "default", "name": "Reading List", "parent": None}], "entries": []}

def _save(data: dict):
    path = _lib_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)

@router.get("/")
async def get_library():
    data = _load()
    pdf_lib.sync_all_library_folders(data)
    return data


@router.post("/sync-pdf-folders")
async def sync_pdf_folders():
    data = _load()
    names = pdf_lib.sync_all_library_folders(data)
    return {"ok": True, "synced_folders": names}


def _folder_by_id(data: dict, folder_id: str) -> dict | None:
    for f in data["folders"]:
        if f["id"] == folder_id:
            return f
    return None


@router.get("/pdf-settings")
async def get_pdf_settings():
    return pdf_lib.read_settings()


@router.patch("/pdf-settings")
async def patch_pdf_settings(body: dict = Body(...)):
    return pdf_lib.write_settings(body)


@router.get("/papers/{paper_id}/pdf-status")
async def get_paper_pdf_status(paper_id: str, folder_id: Optional[str] = None):
    return pdf_lib.pdf_status(paper_id, folder_id)


@router.get("/papers/{paper_id}/pdf-target-folder")
async def get_paper_pdf_target_folder(
    paper_id: str,
    folder_id: Optional[str] = None,
    folder_name: Optional[str] = None,
):
    data = _load()
    req_folder_name: str | None = folder_name.strip() if isinstance(folder_name, str) and folder_name.strip() else None
    folder_id_value = str(folder_id or "")
    if folder_id:
        folder = _folder_by_id(data, folder_id_value)
        if folder:
            req_folder_name = str(folder.get("name") or "")
    host_folder_id, host_folder_name = pdf_lib.resolve_host_folder(
        data,
        str(paper_id),
        request_folder_id=folder_id_value or None,
        request_folder_name=req_folder_name,
    )
    disk_folder = host_folder_name or pdf_lib.INBOX_FOLDER
    target_dir = pdf_lib.folder_dir_for_name(disk_folder)
    return {
        "paper_id": str(paper_id),
        "host_folder_id": host_folder_id,
        "host_folder_name": disk_folder,
        "path": str(target_dir),
    }


@router.post("/pdf-status/bulk")
async def get_bulk_pdf_status(body: dict = Body(...)):
    paper_ids = body.get("paper_ids") or []
    if not isinstance(paper_ids, list):
        raise HTTPException(status_code=400, detail="paper_ids must be a list")
    return {"statuses": pdf_lib.pdf_status_bulk([str(pid) for pid in paper_ids])}


async def _download_pdf_for_paper(
    paper,
    paper_id: str,
    folder_id: str | None,
) -> dict:
    data = _load()
    folder_name = None
    if folder_id:
        folder = _folder_by_id(data, str(folder_id))
        if folder:
            folder_name = folder["name"]
    result = await pdf_lib.download_paper_pdf(
        paper,
        folder_id=str(folder_id) if folder_id else None,
        folder_name=folder_name,
        library_data=data,
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=422, detail=result.get("error", "Download failed"))
    result["paper_id"] = paper_id
    return result


@router.post("/download-open-access")
async def download_open_access(body: dict = Body(...)):
    """Download an open-access PDF using paper metadata (no DB row required)."""
    paper_meta = body.get("paper")
    if not isinstance(paper_meta, dict) or not paper_meta.get("title"):
        raise HTTPException(status_code=400, detail="paper metadata with title is required")
    paper_id = str(body.get("paper_id") or paper_meta.get("id") or "unknown")
    folder_id = body.get("folder_id")
    paper = pdf_lib.paper_from_metadata(paper_meta, paper_id)
    return await _download_pdf_for_paper(paper, paper_id, folder_id)


@router.post("/papers/{paper_id}/download-pdf")
async def download_paper_pdf(paper_id: str, body: Optional[dict] = Body(None)):
    from database.db import AsyncSessionLocal

    body = body or {}
    folder_id = body.get("folder_id")
    paper_meta = body.get("paper")

    paper = None
    if isinstance(paper_meta, dict) and paper_meta.get("title"):
        paper = pdf_lib.paper_from_metadata(paper_meta, paper_id)
    if not paper:
        async with AsyncSessionLocal() as db:
            paper = await _resolve_paper(db, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    return await _download_pdf_for_paper(paper, paper_id, folder_id)


@router.post("/papers/{paper_id}/upload-pdf")
async def upload_paper_pdf(
    paper_id: str,
    file: UploadFile = File(...),
    folder_id: Optional[str] = Form(default=None),
    folder_name: Optional[str] = Form(default=None),
    paper: Optional[str] = Form(default=None),
):
    from database.db import AsyncSessionLocal

    if not file.filename:
        raise HTTPException(status_code=400, detail="PDF file is required")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    upload_bytes = await file.read()
    if not upload_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty")

    data = _load()
    folder_name_value = folder_name.strip() if isinstance(folder_name, str) and folder_name.strip() else None
    if folder_id:
        folder = _folder_by_id(data, str(folder_id))
        if folder:
            folder_name_value = str(folder.get("name") or "")

    resolved_paper = None
    paper_meta: dict | None = None
    async with AsyncSessionLocal() as db:
        resolved_paper = await _resolve_paper(db, paper_id)

    if not resolved_paper and paper:
        try:
            parsed = json.loads(paper)
            if isinstance(parsed, dict):
                paper_meta = parsed
                resolved_paper = pdf_lib.paper_from_metadata(parsed, paper_id)
        except Exception:
            resolved_paper = None

    if not resolved_paper:
        fallback_meta = paper_meta or {}
        fallback_meta.setdefault("title", Path(file.filename).stem or f"Paper {paper_id}")
        resolved_paper = pdf_lib.paper_from_metadata(fallback_meta, paper_id)

    result = pdf_lib.save_uploaded_pdf_for_paper(
        paper=resolved_paper,
        paper_id=str(paper_id),
        file_bytes=upload_bytes,
        original_filename=file.filename,
        folder_id=str(folder_id) if folder_id else None,
        folder_name=folder_name_value,
        library_data=data,
    )
    if result.get("status") != "saved":
        raise HTTPException(status_code=422, detail=result.get("error", "Could not save PDF"))
    result["paper_id"] = str(paper_id)
    return result


@router.post("/upload-pdf")
async def upload_pdf_general(
    file: UploadFile = File(...),
    folder_id: Optional[str] = Form(default=None),
    folder_name: Optional[str] = Form(default=None),
    paper_id: Optional[str] = Form(default=None),
    paper: Optional[str] = Form(default=None),
):
    from database.db import AsyncSessionLocal

    if not file.filename:
        raise HTTPException(status_code=400, detail="PDF file is required")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    upload_bytes = await file.read()
    if not upload_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty")

    paper_meta: dict | None = None
    if paper:
        try:
            parsed = json.loads(paper)
            if isinstance(parsed, dict):
                paper_meta = parsed
        except Exception:
            paper_meta = None

    resolved_paper_id = str(
        (paper_id or "")
        or (paper_meta or {}).get("id")
        or (paper_meta or {}).get("doi")
        or (paper_meta or {}).get("external_id")
        or ""
    ).strip()
    if not resolved_paper_id:
        raise HTTPException(status_code=400, detail="paper_id or paper metadata is required")

    data = _load()
    folder_name_value = folder_name.strip() if isinstance(folder_name, str) and folder_name.strip() else None
    if folder_id:
        folder = _folder_by_id(data, str(folder_id))
        if folder:
            folder_name_value = str(folder.get("name") or "")

    resolved_paper = None
    async with AsyncSessionLocal() as db:
        resolved_paper = await _resolve_paper(db, resolved_paper_id)

    if not resolved_paper and paper_meta:
        resolved_paper = pdf_lib.paper_from_metadata(paper_meta, resolved_paper_id)
    if not resolved_paper:
        fallback_meta = paper_meta or {}
        fallback_meta.setdefault("title", Path(file.filename).stem or f"Paper {resolved_paper_id}")
        resolved_paper = pdf_lib.paper_from_metadata(fallback_meta, resolved_paper_id)

    result = pdf_lib.save_uploaded_pdf_for_paper(
        paper=resolved_paper,
        paper_id=resolved_paper_id,
        file_bytes=upload_bytes,
        original_filename=file.filename,
        folder_id=str(folder_id) if folder_id else None,
        folder_name=folder_name_value,
        library_data=data,
    )
    if result.get("status") != "saved":
        raise HTTPException(status_code=422, detail=result.get("error", "Could not save PDF"))
    result["paper_id"] = resolved_paper_id
    return result


@router.get("/folders/{folder_id}/pdf-count")
async def folder_pdf_count(folder_id: str):
    data = _load()
    folder = _folder_by_id(data, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"count": pdf_lib.count_pdfs_in_folder(folder["name"])}


@router.post("/folders")
async def create_folder(body: dict):
    data = _load()
    import uuid
    folder = {"id": str(uuid.uuid4()), "name": body.get("name", "New Folder"), "parent": body.get("parent")}
    data["folders"].append(folder)
    _save(data)
    pdf_lib.sync_folder_created(folder["name"])
    return folder

@router.put("/folders/{folder_id}")
async def rename_folder(folder_id: str, body: dict):
    data = _load()
    for f in data["folders"]:
        if f["id"] == folder_id:
            old_name = f["name"]
            f["name"] = body.get("name", f["name"])
            _save(data)
            if old_name != f["name"]:
                pdf_lib.sync_folder_renamed(old_name, f["name"])
            return f
    raise HTTPException(status_code=404, detail="Folder not found")

@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, delete_pdfs: bool = Query(default=False)):
    data = _load()
    folder = _folder_by_id(data, folder_id)
    pdfs_deleted = 0
    if delete_pdfs and folder:
        pdfs_deleted = pdf_lib.delete_folder_pdfs(folder["name"])
    data["folders"] = [f for f in data["folders"] if f["id"] != folder_id]
    data["entries"] = [e for e in data["entries"] if e.get("folder_id") != folder_id]
    _save(data)
    return {"deleted": folder_id, "pdfs_deleted": pdfs_deleted}

@router.post("/entries")
async def add_to_library(body: dict):
    data = _load()
    paper_id = str(body.get("paper_id", ""))
    folder_id = body.get("folder_id", "default")
    if not paper_id:
        raise HTTPException(status_code=400, detail="paper_id required")
    if any(e["paper_id"] == paper_id and e["folder_id"] == folder_id for e in data["entries"]):
        return {"status": "already_exists"}
    import datetime
    data["entries"].append({"paper_id": paper_id, "folder_id": folder_id, "saved_at": datetime.datetime.utcnow().isoformat()})
    _save(data)
    folder = _folder_by_id(data, folder_id)
    if folder:
        pdf_lib.sync_folder_created(folder["name"])
    pdf_lib.on_library_entry_added(data, paper_id, folder_id)
    prefs = pdf_lib.read_settings()
    if prefs.get("auto_download_on_save"):
        from database.db import AsyncSessionLocal
        from database.models import Paper
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(select(Paper).where(Paper.id == int(paper_id)))
                paper = result.scalar_one_or_none()
                if paper:
                    await pdf_lib.download_paper_pdf(
                        paper,
                        folder_id=folder_id,
                        folder_name=folder["name"] if folder else None,
                        library_data=data,
                    )
            except ValueError:
                pass
    return {"status": "added", "paper_id": paper_id, "folder_id": folder_id}

@router.delete("/entries/{paper_id}")
async def remove_from_library(paper_id: str, folder_id: str = "default"):
    data = _load()
    data["entries"] = [e for e in data["entries"] if not (e["paper_id"] == str(paper_id) and e["folder_id"] == folder_id)]
    _save(data)
    pdf_lib.on_library_entry_removed(data, str(paper_id), folder_id)
    return {"status": "removed"}


def _find_entry(data: dict, paper_id: str, folder_id: str) -> dict | None:
    for e in data["entries"]:
        if e["paper_id"] == str(paper_id) and e.get("folder_id", "default") == folder_id:
            return e
    return None


@router.patch("/entries/{paper_id}/comment")
async def update_entry_comment(
    paper_id: str,
    folder_id: str = "default",
    body: dict = Body(...),
):
    """Save a personal note/comment on a library entry."""
    data = _load()
    entry = _find_entry(data, paper_id, folder_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Paper not in this folder")
    comment = body.get("comment", "")
    if comment is None:
        comment = ""
    comment = str(comment).strip()
    if comment:
        entry["comment"] = comment
    else:
        entry.pop("comment", None)
    import datetime
    entry["comment_updated_at"] = datetime.datetime.utcnow().isoformat()
    _save(data)
    return {
        "paper_id": str(paper_id),
        "folder_id": folder_id,
        "comment": entry.get("comment", ""),
        "comment_updated_at": entry.get("comment_updated_at"),
    }

@router.get("/context-papers")
async def get_context_papers(
    scope: str = "library",
    folder_id: Optional[str] = None,
    folder_ids: Optional[str] = None,
    paper_ids: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    """Return full paper records for chat context (library-wide or one folder)."""
    started = time.perf_counter()
    from database.db import AsyncSessionLocal
    from database.models import Paper
    from sqlalchemy import select
    import json as _json

    resolved_ids: list[str]
    if paper_ids:
        resolved_ids = [str(x).strip() for x in paper_ids.split(",") if str(x).strip()]
    else:
        data = _load()
        if folder_ids:
            fids = {str(x).strip() for x in folder_ids.split(",") if str(x).strip()}
            resolved_ids = [
                e["paper_id"]
                for e in data["entries"]
                if str(e.get("folder_id", "")) in fids
            ]
        elif scope == "folder" and folder_id:
            fid = str(folder_id)
            resolved_ids = [
                e["paper_id"]
                for e in data["entries"]
                if str(e.get("folder_id", "")) == fid
            ]
        else:
            resolved_ids = [e["paper_id"] for e in data["entries"]]

    if not resolved_ids:
        log.info(
            "[library.context] scope=%s folder_id=%s folder_ids=%s direct_ids=%s source_ids=0 returned=0 ms=%s",
            scope,
            folder_id or "-",
            folder_ids or "-",
            "yes" if paper_ids else "no",
            round((time.perf_counter() - started) * 1000),
        )
        return {"papers": [], "count": 0, "scope": scope, "folder_id": folder_id}

    # Keep first-seen order, drop duplicates, and bound DB scope to keep chat context fast.
    deduped_ids: list[str] = []
    seen_ids: set[str] = set()
    max_source_ids = min(max(limit * 4, limit), 500)
    for pid in resolved_ids:
        key = str(pid).strip()
        if not key or key in seen_ids:
            continue
        seen_ids.add(key)
        deduped_ids.append(key)
        if len(deduped_ids) >= max_source_ids:
            break

    int_ids: list[int] = []
    str_ids: list[str] = []
    for pid in deduped_ids:
        try:
            int_ids.append(int(pid))
        except ValueError:
            str_ids.append(str(pid))

    papers_out: list[dict] = []
    async with AsyncSessionLocal() as db:
        from sqlalchemy import or_
        clauses = []
        if int_ids:
            clauses.append(Paper.id.in_(int_ids))
        if str_ids:
            clauses.append(Paper.external_id.in_(str_ids))
            clauses.append(Paper.doi.in_(str_ids))
        if not clauses:
            return {"papers": [], "count": 0, "scope": scope, "folder_id": folder_id}
        result = await db.execute(select(Paper).where(or_(*clauses)))
        paper_by_key: dict[str, Paper] = {}
        for p in result.scalars().all():
            paper_by_key[str(p.id)] = p
            if p.external_id:
                paper_by_key[str(p.external_id)] = p
            if p.doi:
                paper_by_key[str(p.doi)] = p

        ordered: list[Paper] = []
        seen_db_ids: set[int] = set()
        for raw_id in deduped_ids:
            paper = paper_by_key.get(raw_id)
            if not paper or int(paper.id) in seen_db_ids:
                continue
            seen_db_ids.add(int(paper.id))
            ordered.append(paper)
            if len(ordered) >= limit:
                break

        for p in ordered:
            authors = _json.loads(p.authors) if p.authors else []
            if authors and isinstance(authors[0], dict):
                author_names = [a.get("name", "") for a in authors]
            else:
                author_names = authors if isinstance(authors, list) else []
            papers_out.append({
                "id": str(p.id),
                "title": p.title or "",
                "authors": author_names,
                "journal": p.journal or "",
                "published_date": p.published_date.isoformat() if p.published_date else "",
                "abstract": p.abstract or "",
                "summary": p.summary or "",
                "doi": p.doi,
                "url": p.url,
                "tier": p.tier,
                "relevance_score": p.relevance_score,
                "source": p.source or "",
            })

    response = {
        "papers": papers_out,
        "count": len(papers_out),
        "scope": scope,
        "folder_id": folder_id,
    }
    log.info(
        "[library.context] scope=%s folder_id=%s folder_ids=%s direct_ids=%s source_ids=%s returned=%s limit=%s ms=%s",
        scope,
        folder_id or "-",
        folder_ids or "-",
        "yes" if paper_ids else "no",
        len(resolved_ids),
        len(papers_out),
        limit,
        round((time.perf_counter() - started) * 1000),
    )
    return response


def _author_names_from_paper(authors_raw: str | None) -> list[str]:
    import json as _json

    if not authors_raw:
        return []
    try:
        authors = _json.loads(authors_raw)
    except Exception:
        return []
    if not authors:
        return []
    if isinstance(authors[0], dict):
        names = []
        for author in authors[:6]:
            name = author.get("name") or author.get("display_name") or author.get("full_name")
            if not name:
                name = " ".join(
                    str(author.get(part, "")).strip()
                    for part in ("given", "family")
                    if str(author.get(part, "")).strip()
                )
            if name:
                names.append(str(name))
        return names
    return [str(a) for a in authors[:6] if str(a).strip()]


def _bibtex_value(value: str | int) -> str:
    return " ".join(str(value).replace("{", "").replace("}", "").split())


def _format_citation_string(
    author_names: list[str],
    year: str | int,
    title: str,
    journal: str,
    doi: str,
    style: str,
) -> str:
    doi_url = f"https://doi.org/{doi}" if doi else ""
    if style == "apa":
        author_str = "; ".join(author_names[:5]) + (
            " et al." if len(author_names) > 5 else ""
        )
        return f"{author_str} ({year}). {title}. *{journal}*. {doi_url}".strip()
    if style == "bibtex":
        key = "".join(
            ch for ch in ((author_names[0].split()[-1] if author_names else "Unknown") + str(year))
            if ch.isalnum() or ch in {":", "_", "-"}
        )
        return (
            f"@article{{{key},\n"
            f"  title={{{_bibtex_value(title)}}},\n"
            f"  author={{{_bibtex_value(' and '.join(author_names))}}},\n"
            f"  journal={{{_bibtex_value(journal)}}},\n"
            f"  year={{{_bibtex_value(year)}}},\n"
            f"  doi={{{_bibtex_value(doi)}}}\n"
            f"}}"
        )
    author_str = author_names[0] if author_names else "Unknown"
    return f'{author_str}. "{title}." *{journal}* ({year}). {doi_url}'.strip()


async def _resolve_paper(db, paper_id: str):
    from database.models import Paper
    from sqlalchemy import or_, select

    try:
        pid = int(paper_id)
        result = await db.execute(select(Paper).where(Paper.id == pid))
        paper = result.scalar_one_or_none()
        if paper:
            return paper
    except ValueError:
        pass
    result = await db.execute(
        select(Paper).where(
            or_(Paper.external_id == paper_id, Paper.doi == paper_id)
        )
    )
    return result.scalar_one_or_none()


@router.get("/citation/{paper_id}")
async def get_citation(paper_id: str, style: str = "apa"):
    """Generate a citation string for a paper in the papers DB."""
    from database.db import AsyncSessionLocal

    style = (style or "apa").lower()
    if style not in ("apa", "bibtex", "mla"):
        style = "apa"

    async with AsyncSessionLocal() as db:
        paper = await _resolve_paper(db, paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")
        author_names = _author_names_from_paper(paper.authors)
        year = paper.published_date.year if paper.published_date else "n.d."
        citation = _format_citation_string(
            author_names,
            year,
            paper.title or "",
            paper.journal or "",
            paper.doi or "",
            style,
        )
        return {"style": style, "citation": citation, "paper_id": paper_id}
