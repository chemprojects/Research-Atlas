from __future__ import annotations
from datetime import datetime
from typing import AsyncIterator
import httpx
from ingestion.base import BaseFetcher, PaperDict, make_paper

CROSSREF_API = "https://api.crossref.org/works"


class CrossrefFetcher(BaseFetcher):
    source_type = "crossref"

    def __init__(self, query: str = "computational chemistry biochemistry", rows: int = 100):
        self.query = query
        self.rows = rows

    async def fetch(self, since: datetime, limit: int = 200) -> AsyncIterator[PaperDict]:
        date_str = since.strftime("%Y-%m-%d")
        fetched = 0
        offset = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while fetched < limit:
                params = {
                    "query": self.query,
                    "filter": f"from-pub-date:{date_str}",
                    "rows": min(self.rows, limit - fetched),
                    "offset": offset,
                    "select": "DOI,title,abstract,author,container-title,published,URL",
                    "mailto": "user@example.com",
                }
                try:
                    resp = await client.get(CROSSREF_API, params=params)
                    resp.raise_for_status()
                    items = resp.json().get("message", {}).get("items", [])
                except Exception:
                    break

                if not items:
                    break

                for item in items:
                    if fetched >= limit:
                        return
                    title_list = item.get("title", [])
                    title = title_list[0] if title_list else ""
                    if not title:
                        continue
                    abstract = item.get("abstract", "")
                    # Strip JATS XML tags from abstract
                    import re
                    abstract = re.sub(r"<[^>]+>", " ", abstract).strip()
                    authors = [
                        {"name": f"{a.get('given', '')} {a.get('family', '')}".strip(), "affiliation": ""}
                        for a in item.get("author", [])[:10]
                    ]
                    containers = item.get("container-title", [])
                    journal = containers[0] if containers else ""
                    pub_info = item.get("published", {}).get("date-parts", [[]])
                    pub_date = None
                    if pub_info and pub_info[0]:
                        parts = pub_info[0]
                        try:
                            pub_date = datetime(parts[0], parts[1] if len(parts) > 1 else 1, parts[2] if len(parts) > 2 else 1)
                        except (ValueError, TypeError):
                            pass
                    doi = item.get("DOI")
                    url = item.get("URL") or (f"https://doi.org/{doi}" if doi else "")
                    yield make_paper(
                        title=title, abstract=abstract, authors=authors, journal=journal,
                        source="crossref", published_date=pub_date, url=url, doi=doi,
                    )
                    fetched += 1

                offset += len(items)
