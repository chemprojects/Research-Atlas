from __future__ import annotations
from abc import ABC, abstractmethod
from datetime import datetime
from typing import AsyncIterator
import json


class PaperDict(dict):
    """Normalized paper representation returned by all fetchers."""
    pass


def make_paper(
    title: str,
    abstract: str | None,
    authors: list[dict],
    journal: str | None,
    source: str,
    published_date: datetime | None,
    url: str | None,
    doi: str | None = None,
    external_id: str | None = None,
) -> PaperDict:
    return PaperDict(
        title=title,
        abstract=abstract or "",
        authors=json.dumps(authors),
        journal=journal or "",
        source=source,
        published_date=published_date,
        url=url or "",
        doi=doi,
        external_id=external_id,
    )


class BaseFetcher(ABC):
    source_type: str = ""

    @abstractmethod
    async def fetch(self, since: datetime, limit: int = 200) -> AsyncIterator[PaperDict]:
        yield
