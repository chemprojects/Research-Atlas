from __future__ import annotations
from datetime import datetime
from typing import AsyncIterator
import httpx, feedparser, re
from ingestion.base import BaseFetcher, PaperDict, make_paper
from system.source_health import RSS_USER_AGENT


class RSSFetcher(BaseFetcher):
    source_type = "rss"

    def __init__(self, feed_url: str, source_name: str = "rss"):
        self.feed_url = feed_url
        self.source_name = source_name

    async def fetch(self, since: datetime, limit: int = 200) -> AsyncIterator[PaperDict]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(self.feed_url, headers={"User-Agent": RSS_USER_AGENT})
                resp.raise_for_status()
                feed = feedparser.parse(resp.text)
        except Exception:
            return

        fetched = 0
        for entry in feed.entries:
            if fetched >= limit:
                return

            pub_date = None
            for attr in ("published_parsed", "updated_parsed", "created_parsed"):
                parsed = getattr(entry, attr, None)
                if parsed:
                    try:
                        pub_date = datetime(*parsed[:6])
                    except Exception:
                        pass
                    break

            if pub_date and pub_date < since:
                continue

            title = entry.get("title", "").strip()
            if not title:
                continue

            abstract = ""
            for field in ("summary", "content", "description"):
                val = entry.get(field)
                if val:
                    if isinstance(val, list):
                        val = val[0].get("value", "")
                    abstract = re.sub(r"<[^>]+>", " ", val).strip()
                    break

            authors = []
            for a in entry.get("authors", []):
                name = a.get("name", "")
                if name:
                    authors.append({"name": name, "affiliation": ""})
            if not authors and entry.get("author"):
                authors = [{"name": entry.author, "affiliation": ""}]

            doi = None
            url = entry.get("link", "")
            if "doi.org/" in url:
                doi = url.split("doi.org/")[-1]

            journal = feed.feed.get("title", self.source_name)
            yield make_paper(
                title=title, abstract=abstract, authors=authors, journal=journal,
                source=self.source_name, published_date=pub_date, url=url, doi=doi,
            )
            fetched += 1
