from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, delete, cast, Date, or_
from fastapi import Body
from database.db import get_db
from database.models import Paper, Feedback
from datetime import datetime
import json
import logging
import time
from pathlib import Path
from config import settings

router = APIRouter(prefix="/papers", tags=["papers"])
log = logging.getLogger("perf")
_saved_ids_cache: tuple[float, list[int]] = (0.0, [])
_saved_ids_ttl_seconds = 1.0


def _saved_db_ids() -> list[int]:
    """Paper IDs currently saved in library.json, for Digest exclusion filters."""
    global _saved_ids_cache
    now = time.monotonic()
    cached_at, cached_ids = _saved_ids_cache
    if now - cached_at < _saved_ids_ttl_seconds:
        return list(cached_ids)
    path = Path(settings.app_data_dir) / "library.json"
    if not path.exists():
        _saved_ids_cache = (now, [])
        return []
    try:
        data = json.loads(path.read_text())
    except Exception:
        # Keep last known-good IDs if a concurrent write temporarily exposes
        # incomplete JSON.
        return list(cached_ids)
    ids: list[int] = []
    for entry in data.get("entries") or []:
        raw = str(entry.get("paper_id") or "").strip()
        if not raw:
            continue
        try:
            ids.append(int(raw))
        except ValueError:
            continue
    uniq = list(dict.fromkeys(ids))
    _saved_ids_cache = (time.monotonic(), uniq)
    return uniq


def _paper_to_dict(p: Paper) -> dict:
    return {
        "id": p.id,
        "external_id": p.external_id,
        "doi": p.doi,
        "title": p.title,
        "abstract": p.abstract,
        "authors": json.loads(p.authors) if p.authors else [],
        "journal": p.journal,
        "source": p.source,
        "published_date": p.published_date.isoformat() if p.published_date else None,
        "fetched_at": p.fetched_at.isoformat() if p.fetched_at else None,
        "relevance_score": p.relevance_score,
        "tier": p.tier,
        "summary": p.summary,
        "why_it_matters": p.why_it_matters,
        "methods_detected": json.loads(p.methods_detected) if p.methods_detected else [],
        "keywords": json.loads(p.keywords) if p.keywords else [],
        "url": p.url,
        "is_read": p.is_read,
        "feedback": p.feedback,
    }


@router.get("/")
async def list_papers(
    tier: Optional[str] = None,
    source: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    sort_by: str = "relevance_score",
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    include_total: bool = Query(default=False),
    exclude_saved: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    started = time.perf_counter()
    conditions = []
    if tier:
        conditions.append(Paper.tier == tier)
    if source:
        conditions.append(Paper.source == source)
    if search:
        term = f"%{search}%"
        conditions.append(
            or_(
                Paper.title.ilike(term),
                Paper.authors.ilike(term),
                Paper.journal.ilike(term),
            )
        )
    if date_from:
        try:
            conditions.append(Paper.published_date >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            conditions.append(Paper.published_date <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    if exclude_saved:
        saved_ids = _saved_db_ids()
        if saved_ids:
            conditions.append(~Paper.id.in_(saved_ids))
    q = select(Paper).where(*conditions)

    if sort_by == "relevance_score":
        q = q.order_by(Paper.relevance_score.desc().nullslast(), Paper.id.desc())
    elif sort_by == "date":
        q = q.order_by(Paper.published_date.desc().nullslast(), Paper.id.desc())
    else:
        q = q.order_by(Paper.id.desc())

    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    papers = result.scalars().all()
    total: int | None = None
    if include_total:
        # Cheap inference for terminal pages; avoid COUNT(*) when possible.
        if offset > 0 and len(papers) < limit:
            total = offset + len(papers)
        else:
            count_stmt = select(func.count(Paper.id)).where(*conditions)
            total_result = await db.execute(count_stmt)
            total = int(total_result.scalar() or 0)
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    log.info(
        "[papers.list] tier=%s source=%s search=%s limit=%s offset=%s total=%s rows=%s sort=%s ms=%s",
        tier or "-",
        source or "-",
        1 if search else 0,
        limit,
        offset,
        total if total is not None else "n/a",
        len(papers),
        sort_by,
        elapsed_ms,
    )
    return {
        "papers": [_paper_to_dict(p) for p in papers],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/stats")
async def paper_stats(
    exclude_saved: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    started = time.perf_counter()
    tiers = ["unfiltered", "must_read", "possibly_relevant", "adjacent", "ignored"]
    stats: dict[str, int] = {tier: 0 for tier in tiers}

    conditions = []
    # Keep Digest counts in sync with what users actually see.
    # Saved papers are hidden in Daily Digest, so counts can exclude them.
    if exclude_saved:
        saved_ids = _saved_db_ids()
        if saved_ids:
            conditions.append(~Paper.id.in_(saved_ids))

    tier_rows = await db.execute(
        select(Paper.tier, func.count(Paper.id)).where(*conditions).group_by(Paper.tier)
    )
    total = 0
    for row_tier, count in tier_rows.all():
        count_value = int(count or 0)
        total += count_value
        if row_tier in stats:
            stats[row_tier] = count_value

    if total == 0:
        total_result = await db.execute(select(func.count(Paper.id)).where(*conditions))
        total = int(total_result.scalar() or 0)
    stats["total"] = total
    log.info("[papers.stats] total=%s ms=%s", total, round((time.perf_counter() - started) * 1000))
    return stats


@router.get("/{paper_id}")
async def get_paper(paper_id: int, db: AsyncSession = Depends(get_db)):
    paper = await db.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    # Mark as read
    paper.is_read = True
    await db.commit()
    return _paper_to_dict(paper)


@router.patch("/{paper_id}/tier")
async def update_tier(paper_id: int, body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    tier = body.get("tier")
    allowed = {"unfiltered", "must_read", "possibly_relevant", "adjacent", "ignored"}
    if tier not in allowed:
        raise HTTPException(status_code=400, detail=f"tier must be one of: {', '.join(allowed)}")
    paper = await db.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    paper.tier = tier
    if tier == "ignored" and not paper.feedback:
        paper.feedback = "thumbs_down"
    await db.commit()
    return {"status": "ok", "paper_id": paper_id, "tier": tier}


@router.post("/bulk-ignore")
async def bulk_ignore(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Move papers to ignored tier — by ids and/or published date (+ optional tier scope)."""
    paper_ids = body.get("paper_ids") or []
    date_str = body.get("date")
    tier_scope = body.get("tier")

    if not paper_ids and not date_str:
        raise HTTPException(status_code=400, detail="Provide paper_ids and/or date (YYYY-MM-DD)")

    values = {"tier": "ignored", "feedback": "thumbs_down"}

    if paper_ids:
        stmt = (
            update(Paper)
            .where(Paper.id.in_([int(i) for i in paper_ids]))
            .values(**values)
        )
    else:
        try:
            day = datetime.fromisoformat(date_str).date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        conditions = [cast(Paper.published_date, Date) == day]
        if tier_scope:
            conditions.append(Paper.tier == tier_scope)
        stmt = update(Paper).where(*conditions).values(**values)

    result = await db.execute(stmt)
    await db.commit()
    return {"status": "ok", "updated": result.rowcount or 0}


@router.post("/bulk-reset-ignored")
async def bulk_reset_ignored(body: dict = Body(default={}), db: AsyncSession = Depends(get_db)):
    """Reset all ignored papers back to unfiltered tier so they can be re-filtered."""
    paper_ids = body.get("paper_ids") or []
    if paper_ids:
        stmt = (
            update(Paper)
            .where(Paper.id.in_([int(i) for i in paper_ids]))
            .where(Paper.tier == "ignored")
            .values(tier="unfiltered", feedback=None)
        )
    else:
        stmt = (
            update(Paper)
            .where(Paper.tier == "ignored")
            .values(tier="unfiltered", feedback=None)
        )
    result = await db.execute(stmt)
    await db.commit()
    return {"status": "ok", "updated": result.rowcount or 0}


@router.post("/bulk-delete")
async def bulk_delete(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Permanently delete papers — by ids and/or published date (+ optional tier scope)."""
    paper_ids = body.get("paper_ids") or []
    date_str = body.get("date")
    tier_scope = body.get("tier")

    if not paper_ids and not date_str:
        raise HTTPException(status_code=400, detail="Provide paper_ids and/or date (YYYY-MM-DD)")

    if paper_ids:
        stmt = delete(Paper).where(Paper.id.in_([int(i) for i in paper_ids]))
    else:
        try:
            day = datetime.fromisoformat(date_str).date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        conditions = [cast(Paper.published_date, Date) == day]
        if tier_scope:
            conditions.append(Paper.tier == tier_scope)
        stmt = delete(Paper).where(*conditions)

    result = await db.execute(stmt)
    await db.commit()
    return {"status": "ok", "deleted": result.rowcount or 0}


@router.post("/{paper_id}/feedback")
async def submit_feedback(paper_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    rating = body.get("rating")
    if rating not in ("thumbs_up", "thumbs_down", "skip"):
        raise HTTPException(status_code=400, detail="Invalid rating. Use: thumbs_up, thumbs_down, skip")
    paper = await db.get(Paper, paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    paper.feedback = rating
    db.add(Feedback(paper_id=paper_id, rating=rating))
    await db.commit()
    return {"status": "ok", "paper_id": paper_id, "rating": rating}
