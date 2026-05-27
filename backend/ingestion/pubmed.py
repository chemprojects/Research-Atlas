from __future__ import annotations
from datetime import datetime
from typing import AsyncIterator
import httpx, json
from ingestion.base import BaseFetcher, PaperDict, make_paper

EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


class PubMedFetcher(BaseFetcher):
    source_type = "pubmed"

    def __init__(self, search_term: str = "chemistry OR biochemistry OR computational", retmax: int = 200):
        self.search_term = search_term
        self.retmax = retmax

    async def fetch(self, since: datetime, limit: int = 200) -> AsyncIterator[PaperDict]:
        date_str = since.strftime("%Y/%m/%d")
        query = f"({self.search_term}) AND (\"{date_str}\"[PDAT]:\"3000\"[PDAT])"

        async with httpx.AsyncClient(timeout=30) as client:
            # Step 1: esearch to get PMIDs
            try:
                search_resp = await client.get(f"{EUTILS_BASE}/esearch.fcgi", params={
                    "db": "pubmed", "term": query, "retmax": min(limit, self.retmax),
                    "retmode": "json", "sort": "pub+date",
                })
                search_resp.raise_for_status()
                ids = search_resp.json().get("esearchresult", {}).get("idlist", [])
            except Exception:
                return

            if not ids:
                return

            # Step 2: efetch to get abstracts
            chunk_size = 50
            fetched = 0
            for i in range(0, len(ids), chunk_size):
                chunk = ids[i:i + chunk_size]
                try:
                    fetch_resp = await client.get(f"{EUTILS_BASE}/efetch.fcgi", params={
                        "db": "pubmed", "id": ",".join(chunk),
                        "retmode": "xml", "rettype": "abstract",
                    })
                    fetch_resp.raise_for_status()
                except Exception:
                    continue

                for paper in _parse_pubmed_xml(fetch_resp.text, chunk):
                    if fetched >= limit:
                        return
                    yield paper
                    fetched += 1


def _parse_pubmed_xml(xml_text: str, pmids: list[str]):
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return

    for article in root.findall(".//PubmedArticle"):
        medline = article.find("MedlineCitation")
        if medline is None:
            continue
        pmid_el = medline.find("PMID")
        pmid = pmid_el.text if pmid_el is not None else None
        art = medline.find("Article")
        if art is None:
            continue

        title_el = art.find("ArticleTitle")
        title = "".join(title_el.itertext()) if title_el is not None else ""
        if not title:
            continue

        abstract_el = art.find("Abstract")
        abstract = ""
        if abstract_el is not None:
            abstract = " ".join("".join(t.itertext()) for t in abstract_el.findall("AbstractText"))

        authors = []
        author_list = art.find("AuthorList")
        if author_list is not None:
            for author in author_list.findall("Author")[:10]:
                ln = author.findtext("LastName", "")
                fn = author.findtext("ForeName", "")
                name = f"{fn} {ln}".strip()
                if name:
                    authors.append({"name": name, "affiliation": ""})

        journal_el = art.find("Journal")
        journal = ""
        if journal_el is not None:
            journal = journal_el.findtext("Title") or journal_el.findtext("ISOAbbreviation") or ""

        pub_date = None
        pub_date_el = medline.find(".//PubDate")
        if pub_date_el is not None:
            year = pub_date_el.findtext("Year")
            month = pub_date_el.findtext("Month") or "01"
            day = pub_date_el.findtext("Day") or "01"
            try:
                pub_date = datetime.strptime(f"{year} {month} {day}", "%Y %b %d")
            except (ValueError, TypeError):
                try:
                    pub_date = datetime.strptime(f"{year}-01-01", "%Y-%m-%d")
                except Exception:
                    pass

        doi = None
        for id_el in article.findall(".//ArticleId"):
            if id_el.get("IdType") == "doi":
                doi = id_el.text
                break

        url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None
        yield make_paper(
            title=title, abstract=abstract, authors=authors, journal=journal,
            source="pubmed", published_date=pub_date, url=url, doi=doi, external_id=pmid,
        )
