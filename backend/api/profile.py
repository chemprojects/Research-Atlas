from __future__ import annotations
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database.db import get_db
from database.models import ResearchProfile
from datetime import datetime
import json

router = APIRouter(prefix="/profile", tags=["profile"])


def _profile_to_dict(p: ResearchProfile) -> dict:
    return {
        "id": p.id,
        "interests": json.loads(p.interests or "[]"),
        "keywords": json.loads(p.keywords or "[]"),
        "domains": json.loads(p.domains or "[]"),
        "authors_of_interest": json.loads(p.authors_of_interest or "[]"),
        "journals_of_interest": json.loads(p.journals_of_interest or "[]"),
        "negative_keywords": json.loads(p.negative_keywords or "[]"),
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.get("/")
async def get_profile(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ResearchProfile).limit(1))
    profile = result.scalar_one_or_none()
    if not profile:
        return {
            "id": None,
            "interests": [],
            "keywords": [],
            "domains": [],
            "authors_of_interest": [],
            "journals_of_interest": [],
            "negative_keywords": [],
            "updated_at": None,
        }
    return _profile_to_dict(profile)


@router.put("/")
async def update_profile(body: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ResearchProfile).limit(1))
    profile = result.scalar_one_or_none()
    if not profile:
        profile = ResearchProfile()
        db.add(profile)

    for field in ("interests", "keywords", "domains", "authors_of_interest", "journals_of_interest", "negative_keywords"):
        if field in body:
            value = body[field]
            setattr(profile, field, json.dumps(value) if isinstance(value, list) else value)

    profile.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(profile)
    return _profile_to_dict(profile)
