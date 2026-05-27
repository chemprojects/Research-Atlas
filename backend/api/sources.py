from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import get_db
from database.models import Source
from system.source_health import probe_source, probe_url

router = APIRouter(prefix="/sources", tags=["sources"])

# Seeded preprint feeds: name -> setup wizard database key
_PREPRINT_NAME_KEYS = {
    "biorxiv": "biorxiv",
    "medrxiv": "medrxiv",
}


def _coerce_enabled(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off", ""}:
            return False
    return bool(value)


def _source_to_dict(s: Source, health: dict | None = None) -> dict:
    out = {
        "id": s.id,
        "name": s.name,
        "type": s.type,
        "url": s.url,
        "enabled": s.enabled,
        "last_fetched": s.last_fetched.isoformat() if s.last_fetched else None,
        "paper_count": s.paper_count or 0,
        "config": json.loads(s.config) if s.config else {},
        "health": "unknown",
        "health_message": "",
    }
    if health:
        out["health"] = health.get("health", "unknown")
        out["health_message"] = health.get("health_message", "")
    return out


@router.get("/")
async def list_sources(
    probe: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Source).order_by(Source.id))
    sources = list(result.scalars().all())
    if not probe:
        return [_source_to_dict(s) for s in sources]

    health_results = await asyncio.gather(*[probe_source(s) for s in sources])
    return [_source_to_dict(s, h) for s, h in zip(sources, health_results)]


@router.post("/probe-url")
async def probe_feed_url(body: dict):
    url = (body.get("url") or "").strip()
    result = await probe_url(url)
    return {
        "valid": result["health"] in ("healthy", "warning"),
        "health": result["health"],
        "health_message": result["health_message"],
        "error": result["health_message"] if result["health"] == "error" else None,
    }


@router.post("/sync-setup")
async def sync_setup_sources(body: dict, db: AsyncSession = Depends(get_db)):
    """Apply database toggles and journal RSS feeds from the setup wizard."""
    databases = body.get("databases") or {}
    rss_feeds = body.get("rss_feeds") or []

    result = await db.execute(select(Source))
    all_sources = list(result.scalars().all())

    type_map = {"openalex", "arxiv", "pubmed", "crossref", "chemrxiv"}
    for source in all_sources:
        if source.type in type_map:
            key = source.type
            if key in databases:
                source.enabled = bool(databases[key])
        elif source.name.lower() in _PREPRINT_NAME_KEYS:
            key = _PREPRINT_NAME_KEYS[source.name.lower()]
            if key in databases:
                source.enabled = bool(databases[key])

    existing_urls = {s.url.strip(): s for s in all_sources if s.url}
    for feed in rss_feeds:
        name = (feed.get("name") or "").strip()
        url = (feed.get("url") or "").strip()
        if not name or not url:
            continue
        if url in existing_urls:
            existing_urls[url].enabled = True
            if existing_urls[url].name != name:
                existing_urls[url].name = name
        else:
            db.add(
                Source(
                    name=name,
                    type="rss",
                    url=url,
                    enabled=True,
                    config=json.dumps({}),
                )
            )

    await db.commit()
    result = await db.execute(select(Source).order_by(Source.id))
    return [_source_to_dict(s) for s in result.scalars().all()]


@router.post("/")
async def add_source(body: dict, db: AsyncSession = Depends(get_db)):
    name = body.get("name", "").strip()
    src_type = body.get("type", "rss")
    url = body.get("url", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if src_type == "rss" and not url:
        raise HTTPException(status_code=400, detail="url is required for RSS sources")
    source = Source(
        name=name,
        type=src_type,
        url=url,
        enabled=body.get("enabled", True),
        config=json.dumps(body.get("config", {})),
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return _source_to_dict(source)


@router.patch("/{source_id}")
async def update_source(source_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    try:
        for field in ("name", "url", "enabled"):
            if field not in body:
                continue
            if field == "enabled":
                source.enabled = _coerce_enabled(body[field])
            else:
                setattr(source, field, body[field])
        if "config" in body:
            source.config = json.dumps(body["config"])
        await db.commit()
        await db.refresh(source)
    except Exception:
        await db.rollback()
        raise
    return _source_to_dict(source)


@router.delete("/{source_id}")
async def delete_source(source_id: int, db: AsyncSession = Depends(get_db)):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    await db.delete(source)
    await db.commit()
    return {"status": "deleted", "id": source_id}


@router.post("/{source_id}/test")
async def test_source(source_id: int, db: AsyncSession = Depends(get_db)):
    from datetime import datetime, timedelta

    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    from scheduler.jobs import _get_fetcher

    fetcher = _get_fetcher(source)
    if not fetcher:
        return {"status": "error", "message": "Unsupported source type", "papers_found": 0}
    try:
        since = datetime.utcnow() - timedelta(days=7)
        count = 0
        async for _ in fetcher.fetch(since=since, limit=5):
            count += 1
        return {"status": "ok", "papers_found": count, "message": f"Found {count} sample papers"}
    except Exception as e:
        return {"status": "error", "message": str(e), "papers_found": 0}
