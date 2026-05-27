from __future__ import annotations
import json, asyncio, time
from datetime import datetime, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from config import settings
from perf import timed_stage

_scheduler: AsyncIOScheduler | None = None
_scan_running = False
_scan_stop_requested = False
_scan_progress: dict[str, object] = {
    "mode": "idle",
    "phase": "idle",
    "message": "",
    "percent": 0,
    "sources_total": 0,
    "sources_done": 0,
    "papers_fetched": 0,
    "papers_kept": 0,
    "papers_total": 0,
    "papers_processed": 0,
    "tier_counts": {},
    "lookback_days": 7,
}


def is_scan_running() -> bool:
    return _scan_running


def get_scan_progress() -> dict[str, object]:
    return dict(_scan_progress)


def request_scan_stop() -> bool:
    global _scan_stop_requested
    if not _scan_running:
        return False
    _scan_stop_requested = True
    _scan_progress["message"] = "Stopping scan..."
    return True


def _set_scan_progress(**updates: object) -> None:
    _scan_progress.update(updates)


def _should_stop() -> bool:
    return _scan_stop_requested


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
    return _scheduler


async def run_daily_scan():
    """Compatibility wrapper: daily scheduler runs ingest-only scan."""
    await run_scan_ingest()


async def run_scan_ingest(
    from_date: datetime | None = None,
    to_date: datetime | None = None,
):
    """Scan stage: fetch -> dedupe -> store as unfiltered (no AI ranking)."""
    global _scan_running, _scan_stop_requested
    if _scan_running:
        return
    _scan_stop_requested = False
    _scan_running = True
    _set_scan_progress(
        mode="scan",
        phase="starting",
        message="Initializing source scan...",
        percent=2,
        sources_total=0,
        sources_done=0,
        papers_fetched=0,
        papers_kept=0,
        papers_total=0,
        papers_processed=0,
        tier_counts={},
    )
    try:
        await _run_scan_ingest_impl(from_date=from_date, to_date=to_date)
    except asyncio.CancelledError:
        _set_scan_progress(
            mode="scan",
            phase="stopped",
            message="Scan stopped",
            percent=100,
        )
        raise
    except Exception as e:
        _set_scan_progress(
            mode="scan",
            phase="failed",
            message=f"Scan failed: {e}",
            percent=100,
        )
    finally:
        _scan_running = False
        _scan_stop_requested = False


async def run_ai_filter():
    """Filter stage: embed -> rank -> summarize -> assign tiers for unfiltered papers."""
    global _scan_running, _scan_stop_requested
    if _scan_running:
        return
    _scan_stop_requested = False
    _scan_running = True
    _set_scan_progress(
        mode="filter",
        phase="starting",
        message="Initializing AI filter...",
        percent=2,
        papers_total=0,
        papers_processed=0,
        tier_counts={},
    )
    try:
        await _run_ai_filter_impl()
    except asyncio.CancelledError:
        _set_scan_progress(
            mode="filter",
            phase="stopped",
            message="Filter stopped",
            percent=100,
        )
        raise
    except Exception as e:
        _set_scan_progress(
            mode="filter",
            phase="failed",
            message=f"Filter failed: {e}",
            percent=100,
        )
    finally:
        _scan_running = False
        _scan_stop_requested = False


async def _run_scan_ingest_impl(
    from_date: datetime | None = None,
    to_date: datetime | None = None,
):
    from database.db import AsyncSessionLocal
    from database.models import Paper, Source, DigestRun
    from ingestion.openalex import OpenAlexFetcher
    from ingestion.arxiv import ArXivFetcher
    from ingestion.pubmed import PubMedFetcher
    from ingestion.rss import RSSFetcher
    from sqlalchemy import select
    import logging

    log = logging.getLogger("scheduler")
    today = datetime.utcnow().date().isoformat()
    scan_started = time.perf_counter()
    configured_days = int(getattr(settings, "scan_lookback_days", 7) or 7)
    lookback_days = max(1, min(7, configured_days))
    configured_total_limit = int(getattr(settings, "daily_paper_limit", 1000) or 1000)
    total_paper_limit = max(100, min(2000, configured_total_limit))
    configured_source_timeout = int(getattr(settings, "scan_source_timeout_seconds", 35) or 35)
    source_timeout_seconds = max(10, min(120, configured_source_timeout))
    default_since = datetime.utcnow() - timedelta(days=lookback_days)
    since = from_date or default_since
    until = to_date or datetime.utcnow()
    if since > until:
        since, until = until, since
    effective_days = max(1, min(366, (until.date() - since.date()).days + 1))
    _set_scan_progress(
        mode="scan",
        phase="loading_sources",
        message=f"Loading enabled sources ({since.date().isoformat()} to {until.date().isoformat()})...",
        percent=5,
        lookback_days=effective_days,
    )

    async with AsyncSessionLocal() as session:
        # Mark digest as running
        digest = DigestRun(date=today, status="running", started_at=datetime.utcnow())
        session.add(digest)
        await session.commit()
        await session.refresh(digest)
        digest_id = digest.id

        try:
            # Load active sources
            sources_result = await session.execute(select(Source).where(Source.enabled == True))
            sources = sources_result.scalars().all()
            total_sources = len(sources)
            _set_scan_progress(sources_total=total_sources, sources_done=0)
            if _should_stop():
                raise asyncio.CancelledError()

            all_papers = []
            source_fraction = 35 / max(1, total_sources)
            derived_source_limit = max(
                50,
                min(300, int(total_paper_limit / max(1, total_sources)) + 40),
            )
            with timed_stage(
                "scan.fetch_sources",
                sources=total_sources,
                lookback_days=effective_days,
                limit=total_paper_limit,
                source_timeout_seconds=source_timeout_seconds,
            ):
                for idx, source in enumerate(sources, start=1):
                    if _should_stop():
                        raise asyncio.CancelledError()
                    if len(all_papers) >= total_paper_limit:
                        break
                    _set_scan_progress(
                        mode="scan",
                        phase="fetching",
                        message=f"Fetching from {source.name}...",
                        percent=min(45, int(10 + (idx - 1) * source_fraction)),
                        sources_done=idx - 1,
                    )
                    fetcher = _get_fetcher(source)
                    if not fetcher:
                        _set_scan_progress(sources_done=idx)
                        continue
                    source_limit = derived_source_limit
                    try:
                        source_cfg = json.loads(source.config or "{}")
                        if isinstance(source_cfg, dict):
                            requested = int(source_cfg.get("scan_limit", source_limit) or source_limit)
                            source_limit = max(25, min(500, requested))
                    except Exception:
                        source_limit = derived_source_limit
                    remaining = max(0, total_paper_limit - len(all_papers))
                    fetch_limit = max(0, min(source_limit, remaining))
                    if fetch_limit <= 0:
                        _set_scan_progress(sources_done=idx)
                        break
                    try:
                        async with asyncio.timeout(source_timeout_seconds):
                            async for paper_dict in fetcher.fetch(since=since, limit=fetch_limit):
                                if _should_stop():
                                    raise asyncio.CancelledError()
                                if len(all_papers) >= total_paper_limit:
                                    break
                                pub_date = paper_dict.get("published_date")
                                if pub_date and pub_date < since:
                                    continue
                                if pub_date and pub_date > until:
                                    continue
                                all_papers.append(paper_dict)
                                _set_scan_progress(papers_fetched=len(all_papers))
                                if len(all_papers) % 25 == 0:
                                    await asyncio.sleep(0)
                    except TimeoutError:
                        log.warning(
                            "Source %s timed out after %ss; skipping",
                            source.name,
                            source_timeout_seconds,
                        )
                        _set_scan_progress(
                            message=f"{source.name} timed out, continuing…",
                            sources_done=idx,
                        )
                        continue
                    except Exception as e:
                        log.warning(f"Source {source.name} failed: {e}")
                        _set_scan_progress(sources_done=idx)
                        continue
                    _set_scan_progress(sources_done=idx)

            # Deduplicate by DOI then title
            _set_scan_progress(
                mode="scan",
                phase="deduplicating",
                message="Deduplicating fetched papers...",
                percent=52,
            )
            seen_dois: set[str] = set()
            seen_titles: set[str] = set()
            unique_papers = []
            with timed_stage("scan.deduplicate", fetched=len(all_papers)):
                for dedupe_idx, p in enumerate(all_papers, start=1):
                    doi = p.get("doi")
                    title = (p.get("title") or "").lower().strip()[:120]
                    if doi and doi in seen_dois:
                        continue
                    if title and title in seen_titles:
                        continue
                    if doi:
                        seen_dois.add(doi)
                    if title:
                        seen_titles.add(title)
                    unique_papers.append(p)
                    if dedupe_idx % 200 == 0:
                        await asyncio.sleep(0)
            _set_scan_progress(papers_kept=len(unique_papers))

            if _should_stop():
                raise asyncio.CancelledError()
            _set_scan_progress(
                mode="scan",
                phase="saving",
                message="Saving fetched papers...",
                percent=72,
            )

            now = datetime.utcnow()
            doi_values = {str(p.get("doi")).strip() for p in unique_papers if str(p.get("doi") or "").strip()}
            external_values = {
                str(p.get("external_id")).strip()
                for p in unique_papers
                if str(p.get("external_id") or "").strip()
            }

            existing_by_doi: dict[str, Paper] = {}
            existing_by_external: dict[str, Paper] = {}
            if doi_values:
                result = await session.execute(select(Paper).where(Paper.doi.in_(list(doi_values))))
                for item in result.scalars().all():
                    if item.doi:
                        existing_by_doi[item.doi] = item
            if external_values:
                result = await session.execute(
                    select(Paper).where(Paper.external_id.in_(list(external_values)))
                )
                for item in result.scalars().all():
                    if item.external_id:
                        existing_by_external[item.external_id] = item

            upserted_ids: list[int] = []
            with timed_stage("scan.save_upserts", unique=len(unique_papers)):
                for idx, p_dict in enumerate(unique_papers, start=1):
                    if _should_stop():
                        raise asyncio.CancelledError()
                    doi = str(p_dict.get("doi") or "").strip()
                    external_id = str(p_dict.get("external_id") or "").strip()
                    existing = (
                        existing_by_doi.get(doi)
                        or existing_by_external.get(external_id)
                    )

                    paper_obj = existing or Paper()
                    paper_obj.doi = doi or None
                    paper_obj.external_id = external_id or None
                    paper_obj.title = p_dict.get("title") or ""
                    paper_obj.abstract = p_dict.get("abstract") or ""
                    paper_obj.authors = p_dict.get("authors") if isinstance(p_dict.get("authors"), str) else json.dumps(p_dict.get("authors") or [])
                    paper_obj.journal = p_dict.get("journal") or ""
                    paper_obj.source = p_dict.get("source") or "unknown"
                    paper_obj.published_date = p_dict.get("published_date")
                    paper_obj.url = p_dict.get("url")
                    paper_obj.keywords = (
                        p_dict.get("keywords")
                        if isinstance(p_dict.get("keywords"), str)
                        else json.dumps(p_dict.get("keywords") or [])
                    )
                    paper_obj.fetched_at = now

                    if existing is None:
                        paper_obj.tier = "unfiltered"
                        paper_obj.relevance_score = 0.0
                        paper_obj.embedding = None
                        paper_obj.summary = None
                        paper_obj.why_it_matters = None
                        paper_obj.methods_detected = json.dumps([])
                        session.add(paper_obj)
                        await session.flush()
                        if doi:
                            existing_by_doi[doi] = paper_obj
                        if external_id:
                            existing_by_external[external_id] = paper_obj

                    upserted_ids.append(int(paper_obj.id))
                    if idx % 25 == 0:
                        _set_scan_progress(
                            mode="scan",
                            message=f"Saving fetched papers... ({idx}/{len(unique_papers)})",
                            percent=min(92, int(72 + (20 * idx / max(1, len(unique_papers))))),
                        )
                    if idx % 50 == 0:
                        await session.flush()
                        await asyncio.sleep(0)

            await session.flush()

            # Update digest run
            digest_obj = await session.get(DigestRun, digest_id)
            digest_obj.status = "done"
            digest_obj.paper_count = len(unique_papers)
            digest_obj.top_paper_ids = json.dumps(upserted_ids[:50])
            digest_obj.finished_at = datetime.utcnow()
            await session.commit()
            _set_scan_progress(
                mode="scan",
                phase="done",
                message="Scan complete. Run Filter to apply AI ranking.",
                percent=100,
            )
            log.info(
                "scan total done papers=%s unique=%s sources=%s elapsed_ms=%s",
                len(all_papers),
                len(unique_papers),
                total_sources,
                round((time.perf_counter() - scan_started) * 1000),
            )

        except asyncio.CancelledError:
            log.info("Daily scan stopped by user")
            async with AsyncSessionLocal() as stop_session:
                d = await stop_session.get(DigestRun, digest_id)
                if d:
                    d.status = "stopped"
                    d.error = "Stopped by user"
                    d.finished_at = datetime.utcnow()
                    await stop_session.commit()
            _set_scan_progress(
                mode="scan",
                phase="stopped",
                message="Scan stopped by user",
                percent=100,
            )
            return

        except Exception as e:
            log.error(f"Daily scan failed: {e}", exc_info=True)
            async with AsyncSessionLocal() as err_session:
                d = await err_session.get(DigestRun, digest_id)
                if d:
                    d.status = "failed"
                    d.error = str(e)
                    d.finished_at = datetime.utcnow()
                    await err_session.commit()
            _set_scan_progress(
                mode="scan",
                phase="failed",
                message=f"Scan failed: {e}",
                percent=100,
            )


async def _run_ai_filter_impl():
    from database.db import AsyncSessionLocal
    from database.models import Paper, ResearchProfile, DigestRun
    from ranking.ranker import rank_papers
    from llm.summarizer import summarize_batch
    from sqlalchemy import select
    import logging

    log = logging.getLogger("scheduler")
    today = datetime.utcnow().date().isoformat()
    filter_started = time.perf_counter()
    _set_scan_progress(mode="filter", phase="loading", message="Loading unfiltered papers...", percent=8)

    async with AsyncSessionLocal() as session:
        digest = DigestRun(date=today, status="running", started_at=datetime.utcnow())
        session.add(digest)
        await session.commit()
        await session.refresh(digest)
        digest_id = digest.id

        try:
            with timed_stage("filter.load_candidates"):
                result = await session.execute(
                    select(Paper)
                    .where(Paper.tier == "unfiltered")
                    .order_by(Paper.fetched_at.desc().nullslast(), Paper.id.desc())
                    .limit(500)
                )
                candidates = result.scalars().all()
            if not candidates:
                digest_obj = await session.get(DigestRun, digest_id)
                digest_obj.status = "done"
                digest_obj.paper_count = 0
                digest_obj.top_paper_ids = json.dumps([])
                digest_obj.finished_at = datetime.utcnow()
                await session.commit()
                _set_scan_progress(
                    mode="filter",
                    phase="done",
                    message="No unfiltered papers found.",
                    percent=100,
                )
                return

            profile_result = await session.execute(select(ResearchProfile).limit(1))
            profile_obj = profile_result.scalar_one_or_none()
            profile = {}
            if profile_obj:
                profile = {
                    "interests": json.loads(profile_obj.interests or "[]"),
                    "keywords": json.loads(profile_obj.keywords or "[]"),
                    "domains": json.loads(profile_obj.domains or "[]"),
                    "authors_of_interest": json.loads(profile_obj.authors_of_interest or "[]"),
                    "journals_of_interest": json.loads(profile_obj.journals_of_interest or "[]"),
                }

            _set_scan_progress(
                mode="filter",
                phase="embedding",
                message=f"Embedding {len(candidates)} papers...",
                percent=30,
                papers_fetched=len(candidates),
                papers_kept=len(candidates),
                papers_total=len(candidates),
                papers_processed=0,
            )
            paper_dicts: list[dict] = []
            for p in candidates:
                paper_dicts.append(
                    {
                        "id": p.id,
                        "doi": p.doi,
                        "external_id": p.external_id,
                        "title": p.title,
                        "abstract": p.abstract or "",
                        "authors": p.authors or "[]",
                        "journal": p.journal,
                        "source": p.source,
                        "published_date": p.published_date,
                        "keywords": p.keywords or "[]",
                        "url": p.url,
                    }
                )
            texts = [f"{p.get('title','')}. {p.get('abstract','')[:300]}" for p in paper_dicts]
            if texts:
                embed_texts = None
                embedding_to_bytes = None
                try:
                    from embedding.embedder import embed_texts as _embed_texts, embedding_to_bytes as _embedding_to_bytes
                    embed_texts = _embed_texts
                    embedding_to_bytes = _embedding_to_bytes
                except Exception as embed_import_error:
                    log.warning(
                        "Embedding module unavailable during filter; continuing with non-embedding ranking: %s",
                        embed_import_error,
                    )
                # Run CPU-heavy embedding encode work off the main event loop so
                # status/model endpoints stay responsive while filtering.
                if embed_texts and embedding_to_bytes:
                    with timed_stage("filter.embed", papers=len(texts)):
                        try:
                            embeddings = await asyncio.to_thread(embed_texts, texts)
                            for i, p in enumerate(paper_dicts):
                                if _should_stop():
                                    raise asyncio.CancelledError()
                                p["embedding"] = embedding_to_bytes(embeddings[i])
                        except Exception as embed_error:
                            log.warning(
                                "Embedding stage failed; continuing with non-embedding ranking: %s",
                                embed_error,
                            )
                            for p in paper_dicts:
                                p["embedding"] = None
                else:
                    for p in paper_dicts:
                        p["embedding"] = None

            _set_scan_progress(mode="filter", phase="ranking", message="Ranking papers...", percent=56)
            with timed_stage("filter.rank", papers=len(paper_dicts)):
                ranked = await asyncio.to_thread(rank_papers, paper_dicts, profile)

            must_read_candidates = [p for p in ranked if str(p.get("tier") or "") == "must_read"]
            _set_scan_progress(
                mode="filter",
                phase="summarizing",
                message=(
                    f"Preparing 'What this matters to you' for Must Read papers "
                    f"({len(must_read_candidates)})..."
                ),
                percent=72,
            )
            interests = profile.get("interests", [])
            summarize_limit = min(60, len(must_read_candidates))

            async def on_summary_progress(current: int, total: int, title: str) -> None:
                short_title = title[:64] + ("..." if len(title) > 64 else "")
                _set_scan_progress(
                    mode="filter",
                    phase="summarizing",
                    message=(
                        f"Summarizing Must Read {current}/{total}"
                        + (f" — {short_title}" if short_title else "")
                    ),
                    percent=min(86, int(72 + (14 * current / max(1, total)))),
                )

            with timed_stage("filter.summarize", top=summarize_limit):
                summarized_top = await summarize_batch(
                    must_read_candidates[:summarize_limit],
                    interests,
                    max_papers=summarize_limit,
                    progress_callback=on_summary_progress,
                )
            summary_by_id = {int(p["id"]): p for p in summarized_top if p.get("id")}

            _set_scan_progress(mode="filter", phase="saving", message="Saving filter results...", percent=88)
            id_to_obj = {int(p.id): p for p in candidates}
            top_ids: list[int] = []
            tier_counts = {"must_read": 0, "possibly_relevant": 0, "adjacent": 0, "ignored": 0}
            with timed_stage("filter.save_results", papers=len(ranked)):
                total_ranked = max(1, len(ranked))
                for idx, p in enumerate(ranked, start=1):
                    pid = int(p["id"])
                    paper_obj = id_to_obj.get(pid)
                    if not paper_obj:
                        continue
                    score = float(p.get("relevance_score") or 0.0)
                    tier = str(p.get("tier") or "ignored")
                    paper_obj.relevance_score = score
                    paper_obj.tier = tier
                    paper_obj.embedding = p.get("embedding")
                    paper_obj.methods_detected = p.get("methods_detected") or json.dumps([])
                    if tier in tier_counts:
                        tier_counts[tier] += 1

                    if tier == "must_read":
                        summ = summary_by_id.get(pid, p)
                        summary_text = str((summ.get("summary") or "")).strip()
                        why_text = str((summ.get("why_it_matters") or "")).strip()
                        if not summary_text:
                            abstract_text = (paper_obj.abstract or "").strip()
                            summary_text = (
                                abstract_text[:700] + "..."
                                if len(abstract_text) > 700
                                else abstract_text
                            )
                        paper_obj.summary = summary_text or paper_obj.summary
                        paper_obj.why_it_matters = why_text or None
                    else:
                        abstract_text = (paper_obj.abstract or "").strip()
                        if abstract_text:
                            paper_obj.summary = (
                                abstract_text[:700] + "..."
                                if len(abstract_text) > 700
                                else abstract_text
                            )
                        paper_obj.why_it_matters = None
                    top_ids.append(pid)
                    if idx % 10 == 0 or idx == total_ranked:
                        title = str(p.get("title") or "").strip()
                        short_title = title[:70] + ("..." if len(title) > 70 else "")
                        _set_scan_progress(
                            mode="filter",
                            phase="saving",
                            message=(
                                f"Filtering {idx}/{total_ranked}"
                                + (f" — {short_title}" if short_title else "")
                            ),
                            papers_processed=idx,
                            papers_total=total_ranked,
                            papers_kept=idx,
                            percent=min(99, int(88 + (11 * idx / total_ranked))),
                            tier_counts=tier_counts,
                        )
                        await asyncio.sleep(0)

            digest_obj = await session.get(DigestRun, digest_id)
            digest_obj.status = "done"
            digest_obj.paper_count = len(ranked)
            digest_obj.top_paper_ids = json.dumps(top_ids[:50])
            digest_obj.finished_at = datetime.utcnow()
            await session.commit()
            _set_scan_progress(mode="filter", phase="done", message="Filter complete.", percent=100)
            log.info(
                "filter total done candidates=%s ranked=%s elapsed_ms=%s",
                len(candidates),
                len(ranked),
                round((time.perf_counter() - filter_started) * 1000),
            )
        except asyncio.CancelledError:
            log.info("AI filter stopped by user")
            async with AsyncSessionLocal() as stop_session:
                d = await stop_session.get(DigestRun, digest_id)
                if d:
                    d.status = "stopped"
                    d.error = "Stopped by user"
                    d.finished_at = datetime.utcnow()
                    await stop_session.commit()
            _set_scan_progress(mode="filter", phase="stopped", message="Filter stopped by user", percent=100)
            return
        except Exception as e:
            log.error("AI filter failed: %s", e, exc_info=True)
            async with AsyncSessionLocal() as err_session:
                d = await err_session.get(DigestRun, digest_id)
                if d:
                    d.status = "failed"
                    d.error = str(e)
                    d.finished_at = datetime.utcnow()
                    await err_session.commit()
            _set_scan_progress(mode="filter", phase="failed", message=f"Filter failed: {e}", percent=100)


def _get_fetcher(source):
    from ingestion.openalex import OpenAlexFetcher
    from ingestion.arxiv import ArXivFetcher
    from ingestion.pubmed import PubMedFetcher
    from ingestion.crossref import CrossrefFetcher
    from ingestion.chemrxiv import ChemrxivFetcher
    from ingestion.rss import RSSFetcher
    import json

    config = {}
    if source.config:
        try:
            config = json.loads(source.config)
        except Exception:
            pass

    if source.type == "openalex":
        return OpenAlexFetcher(email=config.get("email", "user@example.com"))
    if source.type == "arxiv":
        return ArXivFetcher(categories=config.get("categories"))
    if source.type == "pubmed":
        return PubMedFetcher(retmax=config.get("retmax", 200))
    if source.type == "crossref":
        return CrossrefFetcher(
            query=config.get("query", "computational chemistry biochemistry"),
            rows=config.get("rows", 100),
        )
    if source.type == "chemrxiv" or (
        source.name and source.name.lower() == "chemrxiv" and source.type == "rss"
    ):
        return ChemrxivFetcher(page_size=config.get("page_size", 50))
    if source.type == "rss" and source.url:
        return RSSFetcher(feed_url=source.url, source_name=source.name)
    return None


def start_scheduler():
    scheduler = get_scheduler()
    scheduler.add_job(
        run_scan_ingest,
        CronTrigger(hour=6, minute=0),  # 06:00 UTC daily
        id="daily_scan",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    if not scheduler.running:
        scheduler.start()


def stop_scheduler():
    scheduler = get_scheduler()
    if scheduler.running:
        scheduler.shutdown(wait=False)
