from __future__ import annotations
from datetime import datetime
from typing import AsyncIterator
import httpx
import json
from ingestion.base import BaseFetcher, PaperDict, make_paper

OPENALEX_API = "https://api.openalex.org/works"


def _reconstruct_abstract(inverted_index: dict | None) -> str:
    if not inverted_index:
        return ""
    positions = {}
    for word, idxs in inverted_index.items():
        for i in idxs:
            positions[i] = word
    return " ".join(positions[k] for k in sorted(positions))


class OpenAlexFetcher(BaseFetcher):
    source_type = "openalex"

    def __init__(self, email: str = "user@example.com", concepts: list[str] | None = None):
        self.email = email
        self.concepts = concepts  # OpenAlex concept IDs to filter

    async def fetch(self, since: datetime, limit: int = 200) -> AsyncIterator[PaperDict]:
        date_str = since.strftime("%Y-%m-%d")
        cursor = "*"
        fetched = 0
        per_page = min(200, limit)

        params = {
            "filter": f"from_publication_date:{date_str},has_abstract:true",
            "select": "id,doi,title,abstract_inverted_index,authorships,primary_location,publication_date,concepts,open_access",
            "per-page": per_page,
            "mailto": self.email,
        }

        if self.concepts:
            params["filter"] += "," + "|".join(f"concepts.id:{c}" for c in self.concepts)

        async with httpx.AsyncClient(timeout=30) as client:
            while fetched < limit:
                params["cursor"] = cursor
                try:
                    resp = await client.get(OPENALEX_API, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                except Exception:
                    break

                results = data.get("results", [])
                if not results:
                    break

                for item in results:
                    if fetched >= limit:
                        return
                    title = item.get("title") or ""
                    if not title:
                        continue
                    abstract = _reconstruct_abstract(item.get("abstract_inverted_index"))
                    authors = [
                        {"name": a.get("author", {}).get("display_name", ""), "affiliation": ""}
                        for a in (item.get("authorships") or [])[:10]
                    ]
                    loc = item.get("primary_location") or {}
                    source_obj = loc.get("source") or {}
                    journal = source_obj.get("display_name") or ""
                    pub_date_str = item.get("publication_date")
                    pub_date = None
                    if pub_date_str:
                        try:
                            pub_date = datetime.strptime(pub_date_str, "%Y-%m-%d")
                        except ValueError:
                            pass
                    doi = item.get("doi")
                    url = loc.get("landing_page_url") or (f"https://doi.org/{doi}" if doi else "")
                    if doi and doi.startswith("https://doi.org/"):
                        doi = doi[len("https://doi.org/"):]
                    yield make_paper(
                        title=title, abstract=abstract, authors=authors, journal=journal,
                        source="openalex", published_date=pub_date, url=url, doi=doi,
                        external_id=item.get("id"),
                    )
                    fetched += 1

                meta = data.get("meta", {})
                cursor = meta.get("next_cursor")
                if not cursor:
                    break
