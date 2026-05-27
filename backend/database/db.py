from __future__ import annotations
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select, text
from contextlib import asynccontextmanager
from config import settings
from database.models import Base, Source
import json

DATABASE_URL = f"sqlite+aiosqlite:///{settings.db_path}"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_tier ON papers (tier)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_source ON papers (source)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_published_date ON papers (published_date)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_relevance_score ON papers (relevance_score)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_tier_relevance ON papers (tier, relevance_score)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_tier_date ON papers (tier, published_date)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_tier_source_relevance ON papers (tier, source, relevance_score, id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_tier_source_date ON papers (tier, source, published_date, id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_fetched_at ON papers (fetched_at, id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_external_id ON papers (external_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_doi ON papers (doi)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_digest_runs_date_id ON digest_runs (date, id)"))
    await _seed_default_sources()


async def _seed_default_sources():
    default_sources = [
        {"name": "OpenAlex", "type": "openalex", "url": "https://api.openalex.org", "enabled": True, "config": json.dumps({"email": "user@example.com", "per_page": 200})},
        {"name": "arXiv", "type": "arxiv", "url": "https://export.arxiv.org/api/query", "enabled": True, "config": json.dumps({"categories": ["chem-ph", "physics.chem-ph", "q-bio.BM", "cond-mat.mtrl-sci"]})},
        {"name": "PubMed", "type": "pubmed", "url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils", "enabled": True, "config": json.dumps({"retmax": 200})},
        {"name": "Crossref", "type": "crossref", "url": "https://api.crossref.org/works", "enabled": False, "config": json.dumps({})},
        {"name": "bioRxiv", "type": "rss", "url": "https://connect.biorxiv.org/biorxiv_xml.php?subject=all", "enabled": False, "config": json.dumps({})},
        {"name": "medRxiv", "type": "rss", "url": "https://connect.medrxiv.org/medrxiv_xml.php?subject=all", "enabled": False, "config": json.dumps({})},
        {
            "name": "ChemRxiv",
            "type": "chemrxiv",
            "url": "https://www.cambridge.org/engage/coe/public-api/v1",
            "enabled": False,
            "config": json.dumps({}),
        },
    ]
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM sources"))
        count = result.scalar()
        if count == 0:
            for s in default_sources:
                session.add(Source(**s))
            await session.commit()
        else:
            existing = await session.execute(select(Source.name))
            names = {n.lower() for (n,) in existing.all()}
            added = False
            for s in default_sources:
                if s["name"].lower() not in names:
                    session.add(Source(**s))
                    added = True
            await _migrate_chemrxiv_source(session)
            await session.commit()


async def _migrate_chemrxiv_source(session: AsyncSession) -> None:
    """Upgrade legacy ChemRxiv RSS rows to the Cambridge API fetcher."""
    result = await session.execute(select(Source).where(Source.name.ilike("chemrxiv")))
    for source in result.scalars().all():
        if source.type != "chemrxiv":
            source.type = "chemrxiv"
            source.url = "https://www.cambridge.org/engage/coe/public-api/v1"
            if not source.config:
                source.config = json.dumps({})


@asynccontextmanager
async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
