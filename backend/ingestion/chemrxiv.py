from __future__ import annotations

import re
import html
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import httpx

from ingestion.base import BaseFetcher, PaperDict, make_paper
from system.source_health import RSS_USER_AGENT

# Cambridge Open Engage (no Cloudflare); chemrxiv.org API falls back here on 403.
API_PRIMARY = "https://chemrxiv.org/engage/chemrxiv/public-api/v1"
API_CAMBRIDGE = "https://www.cambridge.org/engage/coe/public-api/v1"
CHEMRXIV_ORIGIN = "CHEMRXIV"
CHEMRXIV_DOI_PREFIX = "10.26434/chemrxiv"


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        text = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except (ValueError, TypeError):
        return None


def _strip_html(text: str) -> str:
    raw = text or ""
    if not raw:
        return ""

    # Preserve scientific notation semantics before removing tags.
    # Examples:
    #   <jats:sub>2</jats:sub> -> _{2}
    #   <sup>n+1</sup>         -> ^{n+1}
    out = re.sub(
        r"<\s*(?:jats:)?sub\b[^>]*>\s*(.*?)\s*<\s*/\s*(?:jats:)?sub\s*>",
        r"_{\1}",
        raw,
        flags=re.IGNORECASE | re.DOTALL,
    )
    out = re.sub(
        r"<\s*(?:jats:)?sup\b[^>]*>\s*(.*?)\s*<\s*/\s*(?:jats:)?sup\s*>",
        r"^{\1}",
        out,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Strip remaining tags and normalize entities.
    out = re.sub(r"<[^>]+>", " ", out)
    out = html.unescape(out)

    # Collapse all redundant whitespace/newlines into single spaces.
    out = re.sub(r"\s+", " ", out).strip()
    return out


def _is_chemrxiv_item(item: dict[str, Any]) -> bool:
    if item.get("origin") == CHEMRXIV_ORIGIN:
        return True
    doi = (item.get("doi") or "").lower()
    return CHEMRXIV_DOI_PREFIX in doi


def _item_authors(item: dict[str, Any]) -> list[dict[str, str]]:
    authors = []
    for author in item.get("authors") or []:
        first = (author or {}).get("firstName") or ""
        last = (author or {}).get("lastName") or ""
        name = " ".join(part for part in (first, last) if part).strip()
        if name:
            authors.append({"name": name, "affiliation": ""})
    return authors


def _item_url(item: dict[str, Any]) -> str:
    doi = item.get("doi")
    if doi:
        return f"https://doi.org/{doi}"
    asset = item.get("asset") or {}
    original = asset.get("original") if isinstance(asset, dict) else None
    if isinstance(original, dict) and original.get("url"):
        return original["url"]
    item_id = item.get("id")
    if item_id:
        return f"https://chemrxiv.org/engage/chemrxiv/article-details/{item_id}"
    return ""


def _item_to_paper(item: dict[str, Any]) -> PaperDict | None:
    title = (item.get("title") or "").strip()
    if not title:
        return None
    pub_date = _parse_date(item.get("publishedDate") or item.get("statusDate"))
    categories = item.get("categories") or []
    journal = "ChemRxiv"
    if categories and isinstance(categories[0], dict):
        journal = categories[0].get("name") or journal
    return make_paper(
        title=title,
        abstract=_strip_html(item.get("abstract") or ""),
        authors=_item_authors(item),
        journal=journal,
        source="chemrxiv",
        published_date=pub_date,
        url=_item_url(item),
        doi=item.get("doi"),
        external_id=item.get("id"),
    )


CROSSREF_WORKS = "https://api.crossref.org/works"


def _crossref_to_paper(item: dict[str, Any]) -> PaperDict | None:
    doi = item.get("DOI") or ""
    if CHEMRXIV_DOI_PREFIX not in doi.lower():
        return None
    titles = item.get("title") or []
    title = titles[0] if titles else ""
    if not title:
        return None
    abstract = _strip_html(item.get("abstract") or "")
    authors = [
        {"name": f"{a.get('given', '')} {a.get('family', '')}".strip(), "affiliation": ""}
        for a in (item.get("author") or [])[:15]
    ]
    containers = item.get("container-title") or []
    journal = containers[0] if containers else "ChemRxiv"
    pub_date = None
    pub_info = item.get("published") or item.get("created") or {}
    parts_list = pub_info.get("date-parts") or [[]]
    parts = parts_list[0] if parts_list else []
    if parts:
        try:
            pub_date = datetime(
                int(parts[0]),
                int(parts[1]) if len(parts) > 1 else 1,
                int(parts[2]) if len(parts) > 2 else 1,
            )
        except (ValueError, TypeError):
            pub_date = None
    url = item.get("URL") or f"https://doi.org/{doi}"
    return make_paper(
        title=title,
        abstract=abstract,
        authors=authors,
        journal=journal,
        source="chemrxiv",
        published_date=pub_date,
        url=url,
        doi=doi,
    )


class ChemrxivFetcher(BaseFetcher):
    """Fetch ChemRxiv preprints via Crossref discovery + Cambridge Open Engage metadata."""

    source_type = "chemrxiv"

    def __init__(self, page_size: int = 50):
        self.page_size = min(max(page_size, 1), 100)

    async def _fetch_item_by_doi(
        self, client: httpx.AsyncClient, doi: str
    ) -> dict[str, Any] | None:
        try:
            resp = await client.get(f"{API_CAMBRIDGE}/items/doi/{doi}")
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, dict) else None
        except httpx.HTTPError:
            pass
        return None

    async def _fetch_via_open_engage(
        self,
        client: httpx.AsyncClient,
        since: datetime,
        limit: int,
    ) -> AsyncIterator[PaperDict]:
        """Use chemrxiv.org API when Cloudflare allows (all items are ChemRxiv)."""
        end = datetime.utcnow()
        skip = 0
        fetched = 0
        while fetched < limit and skip < 5000:
            params = {
                "limit": self.page_size,
                "skip": skip,
                "searchDateFrom": since.strftime("%Y-%m-%d"),
                "searchDateTo": end.strftime("%Y-%m-%d"),
            }
            try:
                resp = await client.get(f"{API_PRIMARY}/items", params=params)
                if resp.status_code == 403:
                    return
                resp.raise_for_status()
            except httpx.HTTPError:
                return
            hits = resp.json().get("itemHits") or []
            if not hits:
                break
            for hit in hits:
                if fetched >= limit:
                    return
                raw = hit.get("item") if isinstance(hit, dict) else None
                if not isinstance(raw, dict):
                    continue
                pub_date = _parse_date(raw.get("publishedDate") or raw.get("statusDate"))
                if pub_date and pub_date < since:
                    continue
                paper = _item_to_paper(raw)
                if paper:
                    yield paper
                    fetched += 1
            if len(hits) < self.page_size:
                break
            skip += self.page_size

    async def _fetch_via_crossref(
        self,
        client: httpx.AsyncClient,
        since: datetime,
        limit: int,
    ) -> AsyncIterator[PaperDict]:
        """Discover ChemRxiv DOIs through Crossref, enrich from Cambridge when possible."""
        date_str = since.strftime("%Y-%m-%d")
        fetched = 0
        cursor = "*"
        seen_dois: set[str] = set()

        while fetched < limit and cursor:
            params = {
                "filter": f"from-pub-date:{date_str},prefix:10.26434",
                "rows": min(self.page_size, limit - fetched),
                "cursor": cursor,
                "select": "DOI,title,abstract,author,container-title,published,created,URL",
                "mailto": "research-atlas@example.com",
            }
            try:
                resp = await client.get(CROSSREF_WORKS, params=params)
                resp.raise_for_status()
                message = resp.json().get("message", {})
            except httpx.HTTPError:
                break

            items = message.get("items") or []
            if not items:
                break

            for item in items:
                if fetched >= limit:
                    return
                doi = (item.get("DOI") or "").lower()
                if CHEMRXIV_DOI_PREFIX not in doi or doi in seen_dois:
                    continue
                seen_dois.add(doi)

                engage = await self._fetch_item_by_doi(client, item["DOI"])
                if engage and _is_chemrxiv_item(engage):
                    paper = _item_to_paper(engage)
                else:
                    paper = _crossref_to_paper(item)
                if not paper:
                    continue
                pub_date = paper.get("published_date")
                if pub_date and pub_date < since:
                    continue
                yield paper
                fetched += 1

            cursor = message.get("next-cursor")
            if not cursor or cursor == params["cursor"]:
                break

    async def fetch(self, since: datetime, limit: int = 200) -> AsyncIterator[PaperDict]:
        headers = {
            "User-Agent": RSS_USER_AGENT,
            "Accept": "application/json",
            "Accept-Encoding": "identity",
        }
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as client:
            yielded = 0
            async for paper in self._fetch_via_open_engage(client, since, limit):
                yielded += 1
                yield paper
            if yielded >= limit:
                return
            async for paper in self._fetch_via_crossref(client, since, limit - yielded):
                yield paper
