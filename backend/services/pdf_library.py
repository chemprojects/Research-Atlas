from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import quote

import httpx

from config import settings

SETTINGS_PATH = settings.app_data_dir / "library_pdf_settings.json"
INDEX_PATH = settings.app_data_dir / "pdf_index.json"
INBOX_FOLDER = "Inbox"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_settings() -> dict[str, Any]:
    default_root = Path.home() / "Documents" / "Research Atlas Library"
    return {
        "pdf_root": str(default_root),
        "mirror_folders": True,
        "auto_download_on_save": False,
        "unpaywall_email": "",
        "filename_template": "{year}_{first_author}_{title_short}",
    }


def read_settings() -> dict[str, Any]:
    if not SETTINGS_PATH.exists():
        return default_settings()
    try:
        data = json.loads(SETTINGS_PATH.read_text())
        merged = default_settings()
        merged.update({k: v for k, v in data.items() if k in merged})
        return merged
    except Exception:
        return default_settings()


def write_settings(updates: dict[str, Any]) -> dict[str, Any]:
    current = read_settings()
    for key in default_settings():
        if key in updates:
            current[key] = updates[key]
    SETTINGS_PATH.write_text(json.dumps(current, indent=2))
    pdf_root = Path(current["pdf_root"]).expanduser()
    pdf_root.mkdir(parents=True, exist_ok=True)
    return current


def _read_index() -> dict[str, Any]:
    if not INDEX_PATH.exists():
        return {"entries": []}
    try:
        return json.loads(INDEX_PATH.read_text())
    except Exception:
        return {"entries": []}


def _write_index(data: dict[str, Any]) -> None:
    INDEX_PATH.write_text(json.dumps(data, indent=2))


def _index_entries() -> list[dict[str, Any]]:
    return list(_read_index().get("entries") or [])


def _save_entries(entries: list[dict[str, Any]]) -> None:
    _write_index({"entries": entries})


def _load_library_data() -> dict:
    p = settings.app_data_dir / "library.json"
    if not p.exists():
        return {"folders": [{"id": "default", "name": "Reading List", "parent": None}], "entries": []}
    try:
        return json.loads(p.read_text())
    except Exception:
        return {"folders": [{"id": "default", "name": "Reading List", "parent": None}], "entries": []}


def _parse_published_date(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()[:10]
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def paper_from_metadata(meta: dict[str, Any], paper_id: str | None = None):
    """Build a paper-like object for PDF download when no DB row exists."""
    authors = meta.get("authors") or []
    if isinstance(authors, list):
        author_objs = [
            a if isinstance(a, dict) else {"name": str(a)}
            for a in authors
        ]
        authors_json = json.dumps(author_objs)
    elif isinstance(authors, str):
        authors_json = authors
    else:
        authors_json = "[]"

    return SimpleNamespace(
        id=paper_id or meta.get("id") or "0",
        title=meta.get("title") or "",
        authors=authors_json,
        journal=meta.get("journal") or "",
        doi=(meta.get("doi") or "").strip() or None,
        external_id=(meta.get("external_id") or "").strip() or None,
        url=(meta.get("url") or "").strip() or None,
        source=(meta.get("source") or "").strip() or "",
        published_date=_parse_published_date(meta.get("published_date")),
    )


def sanitize_name(name: str, max_len: int = 80) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", name).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned[:max_len] if cleaned else "untitled")


def _first_author_last(authors_json: str | None) -> str:
    if not authors_json:
        return "Unknown"
    try:
        authors = json.loads(authors_json)
    except Exception:
        return "Unknown"
    if not authors:
        return "Unknown"
    first = authors[0]
    if isinstance(first, dict):
        name = first.get("name", "") or ""
    else:
        name = str(first)
    parts = name.split()
    return parts[-1] if parts else "Unknown"


def build_filename(paper, template: str | None = None) -> str:
    tpl = template or read_settings().get("filename_template", "{year}_{first_author}_{title_short}")
    year = str(paper.published_date.year) if paper.published_date else "nd"
    author = _first_author_last(paper.authors)
    title_short = sanitize_name(paper.title or "paper", 60)
    name = (
        tpl.replace("{year}", year)
        .replace("{first_author}", sanitize_name(author, 30))
        .replace("{title_short}", title_short)
    )
    name = sanitize_name(name.replace("_", " "), 120).replace(" ", "_")
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name


def pdf_root() -> Path:
    root = Path(read_settings()["pdf_root"]).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root


def folder_dir_for_name(folder_name: str | None, mirror: bool | None = None) -> Path:
    root = pdf_root()
    use_mirror = read_settings()["mirror_folders"] if mirror is None else mirror
    if use_mirror and folder_name:
        path = root / sanitize_name(folder_name, 100)
    elif use_mirror:
        path = root / INBOX_FOLDER
    else:
        path = root
    path.mkdir(parents=True, exist_ok=True)
    return path


def sync_folder_created(folder_name: str) -> Path | None:
    prefs = read_settings()
    if not prefs.get("mirror_folders", True):
        return None
    path = folder_dir_for_name(folder_name, mirror=True)
    return path


def sync_folder_renamed(old_name: str, new_name: str) -> None:
    prefs = read_settings()
    if not prefs.get("mirror_folders", True):
        return
    old_path = pdf_root() / sanitize_name(old_name, 100)
    new_path = pdf_root() / sanitize_name(new_name, 100)
    if old_path.exists() and old_path != new_path:
        if new_path.exists():
            return
        old_path.rename(new_path)
        _rewrite_index_paths(str(old_path), str(new_path))


def _rewrite_index_paths(old_prefix: str, new_prefix: str) -> None:
    entries = _index_entries()
    changed = False
    for e in entries:
        p = e.get("path", "")
        if p.startswith(old_prefix):
            e["path"] = new_prefix + p[len(old_prefix) :]
            changed = True
    if changed:
        _save_entries(entries)


def count_pdfs_in_folder(folder_name: str) -> int:
    path = pdf_root() / sanitize_name(folder_name, 100)
    if not path.is_dir():
        return 0
    return sum(1 for f in path.iterdir() if f.is_file() and f.suffix.lower() == ".pdf")


def delete_folder_pdfs(folder_name: str) -> int:
    path = pdf_root() / sanitize_name(folder_name, 100)
    if not path.is_dir():
        return 0
    deleted = 0
    folder_key = sanitize_name(folder_name, 100)
    for f in list(path.glob("*.pdf")):
        try:
            f.unlink()
            deleted += 1
        except OSError:
            pass
    try:
        if path.exists() and not any(path.iterdir()):
            path.rmdir()
    except OSError:
        pass
    entries = _index_entries()
    entries = [e for e in entries if e.get("host_folder_name") != folder_key]
    _save_entries(entries)
    return deleted


def _entry_file_valid(entry: dict[str, Any] | None) -> bool:
    if not entry or not entry.get("path"):
        return False
    return Path(entry["path"]).is_file()


def _canonical_entry(paper_id: str) -> dict[str, Any] | None:
    """One on-disk PDF per paper (host folder on disk)."""
    pid = str(paper_id)
    candidates = []
    for entry in _index_entries():
        if not _entry_file_valid(entry):
            continue
        entry_pid = str(entry.get("paper_id") or "")
        if entry_pid == pid:
            candidates.append(entry)
            continue
        aliases = entry.get("aliases") or []
        if isinstance(aliases, list) and pid in {str(a) for a in aliases if str(a).strip()}:
            candidates.append(entry)
    if not candidates:
        return None
    candidates.sort(key=lambda e: e.get("downloaded_at") or "", reverse=True)
    return candidates[0]


def _set_canonical_entry(
    paper_id: str,
    path: str,
    host_folder_id: str,
    host_folder_name: str,
    source_url: str | None = None,
    downloaded_at: str | None = None,
    aliases: list[str] | None = None,
) -> None:
    pid = str(paper_id)
    alias_set = {pid}
    for alias in aliases or []:
        value = str(alias or "").strip()
        if value:
            alias_set.add(value)
    entries = []
    for entry in _index_entries():
        entry_pid = str(entry.get("paper_id") or "")
        entry_aliases = {str(a) for a in (entry.get("aliases") or []) if str(a).strip()}
        if entry_pid == pid or pid in entry_aliases:
            continue
        entries.append(entry)
    entries.append({
        "paper_id": pid,
        "path": path,
        "host_folder_id": host_folder_id or "",
        "host_folder_name": sanitize_name(host_folder_name, 100) if host_folder_name else INBOX_FOLDER,
        "source_url": source_url or "",
        "downloaded_at": downloaded_at or _now(),
        "aliases": sorted(alias_set),
    })
    _save_entries(entries)


def _library_folders_for_paper(library_data: dict, paper_id: str) -> list[dict[str, Any]]:
    pid = str(paper_id)
    folder_ids = {
        e.get("folder_id")
        for e in library_data.get("entries") or []
        if e.get("paper_id") == pid and e.get("folder_id")
    }
    return [f for f in library_data.get("folders") or [] if f.get("id") in folder_ids]


def sync_all_library_folders(library_data: dict) -> list[str]:
    """Create on-disk subfolders matching in-app library folders (Settings: mirror folders)."""
    prefs = read_settings()
    if not prefs.get("mirror_folders", True):
        return []
    created: list[str] = []
    for folder in library_data.get("folders") or []:
        name = folder.get("name")
        if name:
            sync_folder_created(name)
            created.append(name)
    sync_folder_created(INBOX_FOLDER)
    created.append(INBOX_FOLDER)
    return created


def resolve_host_folder(
    library_data: dict,
    paper_id: str,
    request_folder_id: str | None = None,
    request_folder_name: str | None = None,
) -> tuple[str, str]:
    """Pick the single disk folder for this paper's PDF."""
    prefs = read_settings()
    if not prefs.get("mirror_folders", True):
        return "", ""

    entry = _canonical_entry(paper_id)
    lib_folders = _library_folders_for_paper(library_data, paper_id)

    if request_folder_id and request_folder_name:
        if not entry:
            return str(request_folder_id), request_folder_name
        if len(lib_folders) <= 1:
            return str(request_folder_id), request_folder_name
        if entry.get("host_folder_id") == str(request_folder_id):
            return str(request_folder_id), request_folder_name
        return (
            str(entry.get("host_folder_id") or ""),
            str(entry.get("host_folder_name") or INBOX_FOLDER),
        )

    if entry:
        return (
            str(entry.get("host_folder_id") or ""),
            str(entry.get("host_folder_name") or INBOX_FOLDER),
        )

    if lib_folders:
        f = lib_folders[0]
        return str(f.get("id", "")), str(f.get("name", INBOX_FOLDER))

    return "", INBOX_FOLDER


def _relocate_pdf_file(
    paper_id: str,
    source_path: str,
    host_folder_name: str,
    host_folder_id: str,
) -> str:
    src = Path(source_path)
    if not src.is_file():
        return source_path
    dest_dir = folder_dir_for_name(host_folder_name)
    dest = dest_dir / src.name
    if dest.resolve() == src.resolve():
        return str(dest)
    if dest.exists():
        stem, suffix = dest.stem, dest.suffix
        n = 2
        while dest.exists():
            dest = dest_dir / f"{stem}_{n}{suffix}"
            n += 1
    shutil.move(str(src), str(dest))
    entry = _canonical_entry(paper_id) or {}
    _set_canonical_entry(
        paper_id,
        str(dest),
        host_folder_id,
        host_folder_name,
        entry.get("source_url"),
        entry.get("downloaded_at"),
    )
    return str(dest)


def on_library_entry_added(library_data: dict, paper_id: str, folder_id: str) -> None:
    folder = next(
        (f for f in library_data.get("folders") or [] if f.get("id") == folder_id),
        None,
    )
    if not folder:
        return
    sync_folder_created(folder.get("name", ""))
    entry = _canonical_entry(paper_id)
    if not entry:
        return
    lib_folders = _library_folders_for_paper(library_data, paper_id)
    if len(lib_folders) == 1 and entry.get("host_folder_id") != folder_id:
        _relocate_pdf_file(
            paper_id,
            entry["path"],
            folder.get("name", INBOX_FOLDER),
            str(folder_id),
        )


def on_library_entry_removed(library_data: dict, paper_id: str, folder_id: str) -> None:
    entry = _canonical_entry(paper_id)
    if not entry or str(entry.get("host_folder_id")) != str(folder_id):
        return
    remaining = _library_folders_for_paper(library_data, paper_id)
    if not remaining:
        return
    new_host = remaining[0]
    _relocate_pdf_file(
        paper_id,
        entry["path"],
        new_host.get("name", INBOX_FOLDER),
        str(new_host.get("id", "")),
    )


def pdf_status(paper_id: str, folder_id: str | None = None) -> dict[str, Any]:
    """Saved PDF for this paper (same file everywhere in the app)."""
    entry = _canonical_entry(paper_id)
    if entry:
        return {
            "status": "saved",
            "path": str(entry["path"]),
            "downloaded_at": entry.get("downloaded_at"),
            "host_folder_name": entry.get("host_folder_name"),
            "host_folder_id": entry.get("host_folder_id"),
        }
    return {"status": "not_downloaded", "path": None}


def pdf_status_bulk(paper_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Saved PDF status for many papers using one index read."""
    wanted = {str(pid) for pid in paper_ids if str(pid)}
    latest: dict[str, dict[str, Any]] = {}
    alias_to_requested: dict[str, set[str]] = {}
    for requested in wanted:
        alias_to_requested.setdefault(requested, set()).add(requested)

    for entry in _index_entries():
        if not _entry_file_valid(entry):
            continue
        entry_ids = {str(entry.get("paper_id") or "")}
        aliases = entry.get("aliases") or []
        if isinstance(aliases, list):
            entry_ids.update(str(a) for a in aliases if str(a).strip())
        matched_requested = set()
        for entry_id in entry_ids:
            matched_requested.update(alias_to_requested.get(entry_id, set()))
        if not matched_requested:
            continue
        for requested in matched_requested:
            current = latest.get(requested)
            if not current or (entry.get("downloaded_at") or "") > (current.get("downloaded_at") or ""):
                latest[requested] = entry

    out: dict[str, dict[str, Any]] = {}
    for pid in wanted:
        entry = latest.get(pid)
        if entry:
            out[pid] = {
                "status": "saved",
                "path": str(entry["path"]),
                "downloaded_at": entry.get("downloaded_at"),
                "host_folder_name": entry.get("host_folder_name"),
                "host_folder_id": entry.get("host_folder_id"),
            }
        else:
            out[pid] = {"status": "not_downloaded", "path": None}
    return out


def save_uploaded_pdf_for_paper(
    *,
    paper,
    paper_id: str,
    file_bytes: bytes,
    original_filename: str,
    folder_id: str | None = None,
    folder_name: str | None = None,
    library_data: dict | None = None,
) -> dict[str, Any]:
    """Save a user-uploaded PDF as the canonical PDF for a paper."""
    if not file_bytes:
        return {"status": "error", "error": "Uploaded PDF is empty"}

    library = library_data or _load_library_data()
    host_id, host_name = resolve_host_folder(
        library,
        str(paper_id),
        request_folder_id=str(folder_id) if folder_id else None,
        request_folder_name=folder_name,
    )
    target_dir = folder_dir_for_name(host_name)

    preferred_name = build_filename(paper)
    source_ext = Path(original_filename or "").suffix.lower()
    ext = source_ext if source_ext == ".pdf" else ".pdf"
    if not preferred_name.lower().endswith(".pdf"):
        preferred_name = f"{sanitize_name(Path(preferred_name).stem, 120)}.pdf"
    elif ext != ".pdf":
        preferred_name = f"{sanitize_name(Path(preferred_name).stem, 120)}.pdf"

    dest = target_dir / preferred_name
    if dest.exists():
        stem, suffix = dest.stem, dest.suffix
        n = 2
        while dest.exists():
            dest = target_dir / f"{stem}_{n}{suffix}"
            n += 1

    try:
        dest.write_bytes(file_bytes)
    except Exception as e:
        return {"status": "error", "error": f"Could not save PDF: {e}"}

    now = _now()
    _set_canonical_entry(
        str(paper_id),
        str(dest),
        host_id or str(folder_id or ""),
        host_name or INBOX_FOLDER,
        source_url="manual-upload",
        downloaded_at=now,
        aliases=[
            str(getattr(paper, "id", "") or ""),
            str(getattr(paper, "doi", "") or ""),
            str(getattr(paper, "external_id", "") or ""),
        ],
    )

    return {
        "status": "saved",
        "path": str(dest),
        "downloaded_at": now,
        "host_folder_id": host_id or str(folder_id or ""),
        "host_folder_name": host_name or INBOX_FOLDER,
    }


def _looks_like_arxiv_id(value: str) -> bool:
    candidate = (value or "").strip()
    if not candidate:
        return False
    # New format: 2101.01234 (optional vN)
    if re.fullmatch(r"\d{4}\.\d{4,6}(v\d+)?", candidate):
        return True
    # Legacy format: hep-th/9901001 (optional vN)
    if re.fullmatch(r"[a-z\-]+(?:\.[A-Z]{2})?/\d{7}(v\d+)?", candidate, re.I):
        return True
    return False


def _arxiv_id(paper) -> str | None:
    src = str(getattr(paper, "source", "") or "").lower()
    url = str(getattr(paper, "url", "") or "")
    source_is_arxiv = (src == "arxiv") or ("arxiv.org" in url.lower())
    if not source_is_arxiv:
        return None

    eid = (getattr(paper, "external_id", "") or "").strip()
    if eid:
        eid = eid.replace("arxiv:", "").split("/")[-1]
        eid = re.sub(r"v\d+$", "", eid)
        if _looks_like_arxiv_id(eid):
            return eid

    m = re.search(r"arxiv\.org/abs/([^/?#]+)", url, re.I)
    if m:
        aid = re.sub(r"v\d+$", "", m.group(1))
        if _looks_like_arxiv_id(aid):
            return aid
    return None


CHEMRXIV_API_DOI = "https://www.cambridge.org/engage/coe/public-api/v1/items/doi/"
CHEMRXIV_API_DOI_FALLBACK = "https://chemrxiv.org/engage/chemrxiv/public-api/v1/items/doi/"


def _extract_chemrxiv_pdf_from_item(item: dict[str, Any]) -> str | None:
    if not isinstance(item, dict):
        return None
    direct_url = item.get("pdf_url") or item.get("pdfUrl")
    if isinstance(direct_url, str) and ".pdf" in direct_url.lower():
        return direct_url
    asset = item.get("asset")
    if isinstance(asset, dict):
        candidates = [
            asset.get("url"),
            asset.get("downloadUrl"),
        ]
        original = asset.get("original")
        if isinstance(original, dict):
            candidates.extend([original.get("url"), original.get("downloadUrl")])
        for candidate in candidates:
            if isinstance(candidate, str) and ".pdf" in candidate.lower():
                return candidate
    files = item.get("files")
    if isinstance(files, list):
        for entry in files:
            if isinstance(entry, dict):
                candidate = entry.get("url") or entry.get("downloadUrl")
                if isinstance(candidate, str) and ".pdf" in candidate.lower():
                    return candidate
    return None


async def _extract_pdf_from_article_page(article_url: str) -> str | None:
    if not article_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(
                article_url,
                headers={"User-Agent": "ResearchAtlas/0.1", "Accept": "text/html"},
            )
            if resp.status_code != 200:
                return None
            text = resp.text or ""
            match = re.search(
                r'https://(?:www\.)?cambridge\.org/engage/api-gateway/(?:coe|chemrxiv)/assets/[^"\s]+?\.pdf',
                text,
                re.I,
            )
            if match:
                return match.group(0)
            match = re.search(
                r'https://chemrxiv\.org/engage/api-gateway/chemrxiv/assets/[^"\s]+?\.pdf',
                text,
                re.I,
            )
            if match:
                return match.group(0)
    except Exception:
        return None
    return None


async def _chemrxiv_pdf_from_api(doi: str) -> str | None:
    doi = (doi or "").strip()
    if doi.startswith("https://doi.org/"):
        doi = doi[len("https://doi.org/") :]
    if not doi or "chemrxiv" not in doi.lower():
        return None
    encoded_doi = quote(doi, safe="")
    for endpoint in (CHEMRXIV_API_DOI, CHEMRXIV_API_DOI_FALLBACK):
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(
                    f"{endpoint}{encoded_doi}",
                    headers={"User-Agent": "ResearchAtlas/0.1", "Accept": "application/json"},
                )
                if resp.status_code != 200:
                    continue
                item = resp.json()
                pdf_url = _extract_chemrxiv_pdf_from_item(item)
                if pdf_url:
                    return pdf_url
                if isinstance(item, dict):
                    item_id = item.get("id")
                    if item_id:
                        article_url = f"https://chemrxiv.org/engage/chemrxiv/article-details/{item_id}"
                        scraped = await _extract_pdf_from_article_page(article_url)
                        if scraped:
                            return scraped
        except Exception:
            continue
    return None


async def resolve_pdf_url(paper) -> str | None:
    prefs = read_settings()
    aid = _arxiv_id(paper)
    if aid:
        return f"https://arxiv.org/pdf/{aid}.pdf"

    src = (paper.source or "").lower()
    if src in ("biorxiv", "medrxiv") and paper.doi:
        return f"https://www.{src}.org/content/{paper.doi}v1.full.pdf"

    doi = (paper.doi or "").strip()
    if src == "chemrxiv" or (doi and "chemrxiv" in doi.lower()):
        chemrxiv_pdf = await _chemrxiv_pdf_from_api(doi)
        if chemrxiv_pdf:
            return chemrxiv_pdf
        chem_doi = doi
        if chem_doi.startswith("https://doi.org/"):
            chem_doi = chem_doi[len("https://doi.org/") :]
        if chem_doi:
            return f"https://doi.org/{chem_doi}"

    if doi.startswith("https://doi.org/"):
        doi = doi[len("https://doi.org/") :]
    if doi:
        email = prefs.get("unpaywall_email") or "research-atlas@example.com"
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(
                    f"https://api.unpaywall.org/v2/{doi}",
                    params={"email": email},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    best = data.get("best_oa_location") or {}
                    pdf_url = best.get("url_for_pdf") or best.get("url")
                    if pdf_url:
                        return pdf_url
        except Exception:
            pass

    url = paper.url or ""
    if url.lower().endswith(".pdf"):
        return url
    return None


async def download_paper_pdf(
    paper,
    folder_id: str | None = None,
    folder_name: str | None = None,
    library_data: dict | None = None,
) -> dict[str, Any]:
    pid = str(paper.id)
    lib = library_data if library_data is not None else _load_library_data()
    host_id, host_name = resolve_host_folder(
        lib,
        pid,
        str(folder_id) if folder_id else None,
        folder_name,
    )

    existing = _canonical_entry(pid)
    if existing:
        path = str(existing["path"])
        target_name = host_name or folder_name
        if (
            read_settings().get("mirror_folders", True)
            and target_name
            and existing.get("host_folder_name") != target_name
            and len(_library_folders_for_paper(lib, pid)) <= 1
        ):
            path = _relocate_pdf_file(pid, path, target_name, host_id or folder_id or "")
        elif host_id and existing.get("host_folder_id") != host_id:
            if len(_library_folders_for_paper(lib, pid)) <= 1:
                path = _relocate_pdf_file(
                    pid, path, target_name or INBOX_FOLDER, host_id
                )
        _set_canonical_entry(
            pid,
            path,
            host_id or existing.get("host_folder_id") or "",
            target_name or existing.get("host_folder_name") or INBOX_FOLDER,
            existing.get("source_url"),
            existing.get("downloaded_at"),
            aliases=existing.get("aliases") if isinstance(existing.get("aliases"), list) else None,
        )
        return {
            "status": "saved",
            "path": path,
            "source_url": existing.get("source_url"),
            "downloaded_at": existing.get("downloaded_at"),
            "host_folder_name": target_name or existing.get("host_folder_name"),
            "already_downloaded": True,
        }

    disk_folder = host_name or folder_name
    pdf_url = await resolve_pdf_url(paper)
    if not pdf_url:
        return {
            "status": "error",
            "error": "No open-access PDF found for this paper.",
        }

    target_dir = folder_dir_for_name(disk_folder)
    filename = build_filename(paper)
    dest = target_dir / filename
    if dest.exists():
        n = 2
        stem = dest.stem
        while dest.exists():
            dest = target_dir / f"{stem}_{n}.pdf"
            n += 1

    download_urls: list[str] = [pdf_url]
    src = str(getattr(paper, "source", "") or "").lower()
    doi = str(getattr(paper, "doi", "") or "").strip()
    page_url = str(getattr(paper, "url", "") or "").strip()
    if src == "chemrxiv" or ("chemrxiv" in doi.lower()):
        api_pdf = await _chemrxiv_pdf_from_api(doi)
        if api_pdf and api_pdf not in download_urls:
            download_urls.append(api_pdf)
        if page_url and "chemrxiv.org" in page_url:
            scraped_pdf = await _extract_pdf_from_article_page(page_url)
            if scraped_pdf and scraped_pdf not in download_urls:
                download_urls.append(scraped_pdf)

    last_status_code: int | str = "unknown"
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
                "Referer": "https://doi.org/",
            }
            content: bytes | None = None
            used_url = pdf_url
            for candidate_url in download_urls:
                used_url = candidate_url
                resp = await client.get(candidate_url, headers=headers)
                if resp.status_code >= 400:
                    last_status_code = resp.status_code
                    continue
                candidate_content = resp.content
                if len(candidate_content) < 500 or not candidate_content[:5].startswith(b"%PDF"):
                    continue
                content = candidate_content
                pdf_url = used_url
                break
            if content is None:
                return {
                    "status": "error",
                    "error": (
                        f"Source returned HTTP {last_status_code} while downloading PDF. "
                        "Try Open paper, then upload PDF manually if needed."
                    ),
                }
            dest.write_bytes(content)
    except Exception as exc:
        return {"status": "error", "error": f"Could not download PDF: {exc}"}

    downloaded_at = _now()
    _set_canonical_entry(
        pid,
        str(dest),
        host_id or str(folder_id or ""),
        disk_folder or INBOX_FOLDER,
        pdf_url,
        downloaded_at,
        aliases=[
            str(getattr(paper, "id", "") or ""),
            str(getattr(paper, "doi", "") or ""),
            str(getattr(paper, "external_id", "") or ""),
        ],
    )

    return {
        "status": "saved",
        "path": str(dest),
        "source_url": pdf_url,
        "downloaded_at": downloaded_at,
        "host_folder_name": disk_folder or INBOX_FOLDER,
    }
