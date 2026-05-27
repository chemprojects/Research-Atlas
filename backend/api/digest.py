from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database.db import get_db
from database.models import DigestRun, Paper
from datetime import datetime, date
import json

router = APIRouter(prefix="/digest", tags=["digest"])


def _paper_to_dict(p: Paper) -> dict:
    return {
        "id": p.id,
        "doi": p.doi,
        "title": p.title,
        "abstract": p.abstract,
        "authors": json.loads(p.authors) if p.authors else [],
        "journal": p.journal,
        "source": p.source,
        "published_date": p.published_date.isoformat() if p.published_date else None,
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


@router.get("/today")
async def get_today_digest(db: AsyncSession = Depends(get_db)):
    today_str = date.today().isoformat()
    return await _get_digest_for_date(today_str, db)


@router.get("/{date_str}")
async def get_digest_by_date(date_str: str, db: AsyncSession = Depends(get_db)):
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD")
    return await _get_digest_for_date(date_str, db)


@router.get("/")
async def list_digests(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DigestRun).order_by(DigestRun.date.desc()).limit(30)
    )
    runs = result.scalars().all()
    return [
        {
            "id": r.id,
            "date": r.date,
            "status": r.status,
            "paper_count": r.paper_count,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in runs
    ]


async def _get_digest_for_date(date_str: str, db: AsyncSession) -> dict:
    result = await db.execute(
        select(DigestRun).where(DigestRun.date == date_str).order_by(DigestRun.id.desc()).limit(1)
    )
    run = result.scalar_one_or_none()

    if not run:
        return {"date": date_str, "status": "not_run", "papers": [], "tiers": {}}

    paper_ids = json.loads(run.top_paper_ids or "[]")
    int_ids: list[int] = []
    for pid in paper_ids:
        try:
            int_ids.append(int(pid))
        except Exception:
            continue

    papers = []
    if int_ids:
        result = await db.execute(select(Paper).where(Paper.id.in_(int_ids)))
        by_id = {int(p.id): p for p in result.scalars().all()}
        for pid in int_ids:
            paper = by_id.get(pid)
            if paper:
                papers.append(_paper_to_dict(paper))

    tiers: dict[str, list] = {
        "unfiltered": [],
        "must_read": [],
        "possibly_relevant": [],
        "adjacent": [],
        "ignored": [],
    }
    for p in papers:
        tier = p.get("tier", "ignored")
        tiers.setdefault(tier, []).append(p)

    return {
        "date": date_str,
        "status": run.status,
        "paper_count": run.paper_count,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "papers": papers,
        "tiers": tiers,
    }
