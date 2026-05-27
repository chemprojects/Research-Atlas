from __future__ import annotations

import feedparser
import httpx

RSS_USER_AGENT = (
    "Mozilla/5.0 (compatible; ResearchAtlas/0.1; +https://github.com/research-atlas)"
)

API_PROBES = {
    "openalex": "https://api.openalex.org/works?per_page=1",
    "arxiv": "https://export.arxiv.org/api/query?search_query=all&max_results=1",
    "pubmed": (
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
        "?db=pubmed&term=test&retmax=1&retmode=json"
    ),
    "crossref": "https://api.crossref.org/works?rows=1",
    "chemrxiv": (
        "https://www.cambridge.org/engage/coe/public-api/v1/items/doi/"
        "10.26434/chemrxiv-2026-83634"
    ),
}


def _result(health: str, message: str = "") -> dict[str, str]:
    return {"health": health, "health_message": message}


async def probe_url(url: str) -> dict[str, str]:
    url = (url or "").strip()
    if not url:
        return _result("error", "URL is required")
    if not url.startswith(("http://", "https://")):
        return _result("error", "URL must start with http:// or https://")

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": RSS_USER_AGENT})
            resp.raise_for_status()
            feed = feedparser.parse(resp.text)
        if feed.bozo and not feed.entries:
            return _result("error", f"Invalid feed: {feed.bozo_exception}")
        if not feed.entries:
            return _result("warning", "Feed reachable but has no entries")
        return _result("healthy", f"{len(feed.entries)} entries in feed")
    except httpx.HTTPStatusError as e:
        return _result("error", f"HTTP {e.response.status_code}")
    except Exception as e:
        return _result("error", str(e)[:200])


async def probe_source(source) -> dict[str, str]:
    """Probe a Source ORM row or dict-like object with type, url, name."""
    src_type = getattr(source, "type", None) or source.get("type", "")
    url = getattr(source, "url", None) or source.get("url") or ""
    name = getattr(source, "name", None) or source.get("name") or ""

    if src_type in API_PROBES:
        probe_url_str = API_PROBES[src_type]
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(probe_url_str, headers={"User-Agent": RSS_USER_AGENT})
                resp.raise_for_status()
            return _result("healthy")
        except httpx.HTTPStatusError as e:
            return _result("error", f"HTTP {e.response.status_code}")
        except Exception as e:
            return _result("error", str(e)[:200])

    if src_type == "rss":
        if not url:
            return _result("error", "RSS source has no URL")
        return await probe_url(url)

    # Legacy names for seeded preprint feeds stored as rss
    if name.lower() in ("biorxiv", "medrxiv") and url:
        return await probe_url(url)

    return _result("error", f"Unsupported source type: {src_type}")
