from __future__ import annotations
from datetime import datetime
from typing import AsyncIterator
import httpx, feedparser, re
from ingestion.base import BaseFetcher, PaperDict, make_paper

ARXIV_API = "https://export.arxiv.org/api/query"

DEFAULT_CATEGORIES = [
    "chem-ph", "physics.chem-ph", "q-bio.BM", "q-bio.MN",
    "cond-mat.mtrl-sci", "physics.bio-ph", "cs.LG",
]


class ArXivFetcher(BaseFetcher):
    source_type = "arxiv"

    def __init__(self, categories: list[str] | None = None, search_query: str | None = None):
        self.categories = categories or DEFAULT_CATEGORIES
        self.search_query = search_query

    async def fetch(self, since: datetime, limit: int = 200) -> AsyncIterator[PaperDict]:
        cat_query = " OR ".join(f"cat:{c}" for c in self.categories)
        query = f"({cat_query})"
        if self.search_query:
            query = f"({query}) AND ({self.search_query})"

        start = 0
        fetched = 0
        max_results = min(100, limit)

        async with httpx.AsyncClient(timeout=30) as client:
            while fetched < limit:
                params = {
                    "search_query": query,
                    "start": start,
                    "max_results": max_results,
                    "sortBy": "submittedDate",
                    "sortOrder": "descending",
                }
                try:
                    resp = await client.get(ARXIV_API, params=params)
                    resp.raise_for_status()
                    feed = feedparser.parse(resp.text)
                except Exception:
                    break

                if not feed.entries:
                    break

                for entry in feed.entries:
                    if fetched >= limit:
                        return
                    pub_date = None
                    if hasattr(entry, "published_parsed") and entry.published_parsed:
                        pub_date = datetime(*entry.published_parsed[:6])
                    if pub_date and pub_date < since:
                        return

                    title = entry.get("title", "").replace("\n", " ").strip()
                    abstract = entry.get("summary", "").replace("\n", " ").strip()
                    arxiv_id = entry.get("id", "").split("/abs/")[-1]
                    authors = [{"name": a.get("name", ""), "affiliation": ""} for a in entry.get("authors", [])]
                    url = entry.get("id", "")

                    doi = None
                    for link in entry.get("links", []):
                        if link.get("title") == "doi":
                            doi = link.get("href", "").replace("https://doi.org/", "")
                            break

                    yield make_paper(
                        title=title, abstract=abstract, authors=authors, journal="arXiv",
                        source="arxiv", published_date=pub_date, url=url, doi=doi,
                        external_id=arxiv_id,
                    )
                    fetched += 1

                start += max_results
                if start >= 1000:
                    break
