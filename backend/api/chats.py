from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from config import settings
from services.chat_attachments import UPLOAD_DIR, save_upload

router = APIRouter(prefix="/chats", tags=["chats"])

META_DIR = settings.app_data_dir / "chats"
META_SETTINGS = META_DIR / "settings.json"
DEFAULT_STORAGE = settings.chats_path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_settings() -> dict:
    return {
        "storage_dir": str(DEFAULT_STORAGE),
        "context_scope": "library",
        "context_folder_id": None,
        "context_whole_library": True,
        "context_folder_ids": [],
        "context_all_folders": False,
    }


def _storage_root() -> Path:
    prefs = _read_settings()
    root = Path(prefs.get("storage_dir") or str(DEFAULT_STORAGE)).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    (root / "sessions").mkdir(exist_ok=True)
    return root


def _index_path() -> Path:
    return _storage_root() / "index.json"


def _projects_path() -> Path:
    return _storage_root() / "projects.json"


def _session_path(session_id: str) -> Path:
    return _storage_root() / "sessions" / f"{session_id}.json"


def _read_settings() -> dict:
    META_DIR.mkdir(parents=True, exist_ok=True)
    if not META_SETTINGS.exists():
        data = _default_settings()
        META_SETTINGS.write_text(json.dumps(data, indent=2))
        _storage_root()  # ensure session dir exists
        return data
    try:
        data = json.loads(META_SETTINGS.read_text())
        return {**_default_settings(), **data}
    except Exception:
        return _default_settings()


def _write_settings(data: dict) -> dict:
    out = {**_default_settings(), **data}
    META_DIR.mkdir(parents=True, exist_ok=True)
    META_SETTINGS.write_text(json.dumps(out, indent=2))
    root = Path(out["storage_dir"]).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    (root / "sessions").mkdir(exist_ok=True)
    return out


def _read_index() -> list[dict]:
    p = _index_path()
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:
        return []


def _write_index(entries: list[dict]) -> None:
    _index_path().write_text(json.dumps(entries, indent=2))


def _read_projects() -> list[dict]:
    p = _projects_path()
    # Earlier builds stored project metadata beside chat settings. Keep a one-time
    # read fallback so existing projects still appear after moving to chat storage.
    legacy = META_DIR / "projects.json"
    if not p.exists() and legacy.exists():
        try:
            projects = json.loads(legacy.read_text())
            _write_projects(projects)
            return projects
        except Exception:
            pass
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:
        return []


def _write_projects(projects: list[dict]) -> None:
    p = _projects_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(projects, indent=2))


def _project_public(project: dict) -> dict:
    return {
        "id": project.get("id"),
        "name": project.get("name", "Project"),
        "created_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
        "files": [
            {
                "id": f.get("id"),
                "name": f.get("name"),
                "mime": f.get("mime"),
                "size_bytes": f.get("size_bytes", 0),
                "text_length": f.get("text_length", 0),
            }
            for f in project.get("files", [])
        ],
    }


def _attachment_file_by_id(file_id: str) -> tuple[Path, str, str]:
    if not file_id:
        raise HTTPException(status_code=404, detail="Attachment not found")

    for path in UPLOAD_DIR.glob(f"{file_id}_*"):
        if path.is_file():
            name = path.name.split("_", 1)[1] if "_" in path.name else path.name
            media_type = "application/pdf" if name.lower().endswith(".pdf") else "application/octet-stream"
            return path, name, media_type

    for project in _read_projects():
        for file in project.get("files", []):
            if str(file.get("id")) == file_id:
                path = Path(str(file.get("path") or ""))
                if path.is_file():
                    return path, str(file.get("name") or path.name), str(file.get("mime") or "application/octet-stream")

    for session_path in (_storage_root() / "sessions").glob("*.json"):
        try:
            session = json.loads(session_path.read_text())
        except Exception:
            continue
        for message in session.get("messages", []):
            for file in message.get("attachments", []) or []:
                if str(file.get("id")) == file_id:
                    path = Path(str(file.get("path") or ""))
                    if path.is_file():
                        return path, str(file.get("name") or path.name), str(file.get("mime") or "application/octet-stream")

    raise HTTPException(status_code=404, detail="Attachment not found")


def _title_from_messages(messages: list[dict]) -> str:
    for m in messages:
        if m.get("role") == "user" and m.get("content"):
            t = str(m["content"]).strip().replace("\n", " ")
            return (t[:48] + "…") if len(t) > 48 else t or "New chat"
    return "New chat"


@router.get("/settings")
async def get_chat_settings():
    prefs = _read_settings()
    root = _storage_root()
    sessions = _read_index()
    return {
        **prefs,
        "session_count": len(sessions),
        "resolved_storage_dir": str(root),
    }


@router.get("/projects")
async def list_projects():
    return {"projects": [_project_public(p) for p in _read_projects()]}


@router.post("/projects")
async def create_project(body: dict):
    name = str(body.get("name") or "New Project").strip() or "New Project"
    now = _now()
    project = {
        "id": str(uuid.uuid4()),
        "name": name,
        "created_at": now,
        "updated_at": now,
        "files": [],
    }
    projects = _read_projects()
    projects.append(project)
    _write_projects(projects)
    return _project_public(project)


@router.patch("/projects/{project_id}")
async def rename_project(project_id: str, body: dict):
    projects = _read_projects()
    for project in projects:
        if project.get("id") == project_id:
            name = str(body.get("name") or project.get("name") or "Project").strip()
            project["name"] = name or "Project"
            project["updated_at"] = _now()
            _write_projects(projects)
            return _project_public(project)
    raise HTTPException(status_code=404, detail="Project not found")


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    projects = _read_projects()
    next_projects = [p for p in projects if p.get("id") != project_id]
    if len(next_projects) == len(projects):
        raise HTTPException(status_code=404, detail="Project not found")
    _write_projects(next_projects)
    return {"deleted": project_id}


@router.post("/projects/{project_id}/files")
async def upload_project_file(project_id: str, file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename is required")
    projects = _read_projects()
    for project in projects:
        if project.get("id") == project_id:
            data = await file.read()
            try:
                attachment = save_upload(file.filename, data)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
            project.setdefault("files", []).append(attachment)
            project["updated_at"] = _now()
            _write_projects(projects)
            return _project_public(project)
    raise HTTPException(status_code=404, detail="Project not found")


@router.delete("/projects/{project_id}/files/{file_id}")
async def delete_project_file(project_id: str, file_id: str):
    projects = _read_projects()
    for project in projects:
        if project.get("id") == project_id:
            project["files"] = [
                f for f in project.get("files", []) if str(f.get("id")) != file_id
            ]
            project["updated_at"] = _now()
            _write_projects(projects)
            return _project_public(project)
    raise HTTPException(status_code=404, detail="Project not found")


@router.get("/projects/{project_id}/context")
async def get_project_context(project_id: str):
    for project in _read_projects():
        if project.get("id") == project_id:
            return {
                "project": _project_public(project),
                "attachments": project.get("files", []),
            }
    raise HTTPException(status_code=404, detail="Project not found")


@router.get("/attachments/{file_id}")
async def get_attachment(file_id: str):
    path, name, media_type = _attachment_file_by_id(file_id)
    return FileResponse(path, media_type=media_type, filename=name)


@router.patch("/settings")
async def update_chat_settings(body: dict):
    current = _read_settings()
    if "storage_dir" in body and body["storage_dir"]:
        new_dir = str(Path(body["storage_dir"]).expanduser())
        current["storage_dir"] = new_dir
    if "context_scope" in body:
        scope = body["context_scope"]
        if scope in ("library", "folder"):
            current["context_scope"] = scope
            if scope == "library":
                current["context_folder_id"] = None
    if "context_folder_id" in body:
        current["context_folder_id"] = body["context_folder_id"]
        if body["context_folder_id"]:
            current["context_scope"] = "folder"
    if "context_whole_library" in body:
        current["context_whole_library"] = bool(body["context_whole_library"])
        if current["context_whole_library"]:
            current["context_scope"] = "library"
            current["context_folder_id"] = None
            current["context_folder_ids"] = []
            current["context_all_folders"] = False
    if "context_all_folders" in body:
        current["context_all_folders"] = bool(body["context_all_folders"])
    if "context_folder_ids" in body:
        ids = body["context_folder_ids"]
        current["context_folder_ids"] = ids if isinstance(ids, list) else []
        if current["context_folder_ids"]:
            current["context_whole_library"] = False
            current["context_scope"] = "folder"
            current["context_folder_id"] = current["context_folder_ids"][0]
    return _write_settings(current)


@router.get("/sessions")
async def list_sessions(project_id: Optional[str] = None):
    index = _read_index()
    if project_id is not None:
        project_id = str(project_id).strip()
        if project_id:
            index = [entry for entry in index if str(entry.get("project_id") or "") == project_id]
        else:
            index = [entry for entry in index if not str(entry.get("project_id") or "").strip()]
    index.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return {"sessions": index}


@router.post("/sessions")
async def create_session(body: Optional[dict] = None):
    body = body or {}
    prefs = _read_settings()
    session_id = str(uuid.uuid4())
    now = _now()
    session = {
        "id": session_id,
        "title": body.get("title") or "New chat",
        "created_at": now,
        "updated_at": now,
        "project_id": (str(body.get("project_id") or "").strip() or None),
        "paper_id": (str(body.get("paper_id") or "").strip() or None),
        "folder_id": (str(body.get("folder_id") or "").strip() or None),
        "context_scope": body.get("context_scope", prefs.get("context_scope", "library")),
        "context_folder_id": body.get(
            "context_folder_id",
            prefs.get("context_folder_id"),
        ),
        "messages": [],
    }
    _session_path(session_id).write_text(json.dumps(session, indent=2))
    index = _read_index()
    index.append({
        "id": session_id,
        "title": session["title"],
        "created_at": now,
        "updated_at": now,
        "preview": "",
        "project_id": session["project_id"],
        "paper_id": session["paper_id"],
        "folder_id": session["folder_id"],
        "context_scope": session["context_scope"],
        "context_folder_id": session["context_folder_id"],
    })
    _write_index(index)
    return session


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    p = _session_path(session_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    return json.loads(p.read_text())


@router.patch("/sessions/{session_id}")
async def update_session(session_id: str, body: dict):
    p = _session_path(session_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    session = json.loads(p.read_text())
    if "title" in body:
        session["title"] = body["title"]
    if "messages" in body:
        session["messages"] = body["messages"]
        if not body.get("title") and session.get("title") in ("", None, "New chat"):
            session["title"] = _title_from_messages(session["messages"])
    if "context_scope" in body:
        session["context_scope"] = body["context_scope"]
    if "context_folder_id" in body:
        session["context_folder_id"] = body["context_folder_id"]
    if "project_id" in body:
        session["project_id"] = (str(body.get("project_id") or "").strip() or None)
    if "paper_id" in body:
        session["paper_id"] = (str(body.get("paper_id") or "").strip() or None)
    session["updated_at"] = _now()
    p.write_text(json.dumps(session, indent=2))

    msgs = session.get("messages", [])
    msg_count = len(msgs)
    preview = ""
    for m in reversed(msgs):
        if m.get("role") == "assistant" and m.get("content"):
            preview = str(m["content"])[:120]
            break
    if not preview:
        for m in reversed(msgs):
            if m.get("role") == "user" and m.get("content"):
                preview = str(m["content"])[:120]
                break

    index = _read_index()
    found = False
    for entry in index:
        if entry["id"] == session_id:
            entry["title"] = session["title"]
            entry["updated_at"] = session["updated_at"]
            entry["preview"] = preview
            entry["message_count"] = msg_count
            entry["project_id"] = session.get("project_id")
            entry["paper_id"] = session.get("paper_id")
            entry["context_scope"] = session.get("context_scope")
            entry["context_folder_id"] = session.get("context_folder_id")
            found = True
            break
    if not found:
        index.append({
            "id": session_id,
            "title": session["title"],
            "created_at": session.get("created_at", _now()),
            "updated_at": session["updated_at"],
            "preview": preview,
            "message_count": msg_count,
            "project_id": session.get("project_id"),
            "paper_id": session.get("paper_id"),
            "context_scope": session.get("context_scope"),
            "context_folder_id": session.get("context_folder_id"),
        })
    _write_index(index)
    return session


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    p = _session_path(session_id)
    if p.exists():
        p.unlink()
    index = [e for e in _read_index() if e["id"] != session_id]
    _write_index(index)
    return {"deleted": session_id}


@router.delete("/sessions")
async def delete_all_sessions():
    root = _storage_root() / "sessions"
    for f in root.glob("*.json"):
        f.unlink()
    _write_index([])
    return {"deleted": "all"}
