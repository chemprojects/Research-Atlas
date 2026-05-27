from __future__ import annotations
import json
import logging
import re
from config import settings

log = logging.getLogger("ranking")

SCORE_WEIGHTS = {
    "embedding": 0.22,
    "method_match": 0.16,
    "keyword_affinity": 0.22,
    "journal_affinity": 0.14,
    "feedback": 0.12,
    "author_affinity": 0.07,
    "novelty": 0.07,
    "citation": 0.0,
}

TIER_THRESHOLDS = {
    "must_read": 0.68,
    "possibly_relevant": 0.35,
    "adjacent": 0.20,
}


def _get_thresholds() -> dict[str, float]:
    """Return tier thresholds scaled from the user-configured must_read threshold."""
    must_read = float(getattr(settings, "must_read_threshold", 0.68))
    must_read = max(0.05, min(1.0, must_read))
    return {
        "must_read": must_read,
        "possibly_relevant": round(must_read * 0.514, 4),
        "adjacent": round(must_read * 0.294, 4),
    }

CHEMISTRY_METHODS = [
    "dft", "density functional", "qm/mm", "molecular dynamics", "monte carlo",
    "neb", "nudged elastic band", "irc", "transition state", "metadynamics",
    "umbrella sampling", "force field", "basis set", "functional", "active site",
    "enzyme catalysis", "free energy", "gibbs", "activation energy", "reaction mechanism",
    "excited state", "tddft", "ccsd", "mp2", "hartree-fock", "semi-empirical",
    "machine learning potential", "neural network potential", "coarse-grained",
    "protein structure", "binding affinity", "docking", "adme", "pharmacokinetics",
]


def detect_methods(title: str, abstract: str) -> list[str]:
    text = (title + " " + abstract).lower()
    return [m for m in CHEMISTRY_METHODS if m in text]


def score_method_match(methods_in_paper: list[str], profile_interests: list[str]) -> float:
    if not methods_in_paper or not profile_interests:
        return 0.0
    profile_text = " ".join(str(i) for i in profile_interests).lower()
    matches = sum(1 for m in methods_in_paper if m.split()[0] in profile_text or m in profile_text)
    return min(matches / max(len(profile_interests), 1), 1.0)


def _normalize_profile_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(v).strip() for v in parsed if str(v).strip()]
        except Exception:
            return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


def _tokenize(text: str) -> set[str]:
    return {
        token
        for token in re.split(r"[^a-z0-9]+", (text or "").lower())
        if len(token) >= 3
    }


def score_keyword_affinity(
    title: str,
    abstract: str,
    profile_keywords: list[str],
    profile_domains: list[str],
    profile_interests: list[str],
) -> float:
    phrases: list[str] = []
    phrases.extend(profile_keywords)
    phrases.extend(profile_domains)
    phrases.extend(profile_interests)
    cleaned_phrases = [p.lower().strip() for p in phrases if p and p.strip()]
    if not cleaned_phrases:
        return 0.0

    text = f"{title or ''}. {abstract or ''}".lower()
    text_tokens = _tokenize(text)
    phrase_hits = 0.0
    for phrase in cleaned_phrases:
        if phrase in text:
            phrase_hits += 1.0
            continue
        phrase_tokens = _tokenize(phrase)
        if phrase_tokens and phrase_tokens.intersection(text_tokens):
            phrase_hits += 0.45
    return min(1.0, phrase_hits / max(1.0, len(cleaned_phrases) * 0.75))


def score_journal_affinity(journal: str | None, profile_journals: list[str]) -> float:
    if not journal or not profile_journals:
        return 0.0
    journal_l = journal.lower()
    best = 0.0
    for preferred in profile_journals:
        preferred_l = preferred.lower().strip()
        if not preferred_l:
            continue
        if preferred_l == journal_l:
            return 1.0
        if preferred_l in journal_l or journal_l in preferred_l:
            best = max(best, 0.75)
        else:
            pref_tokens = _tokenize(preferred_l)
            journal_tokens = _tokenize(journal_l)
            overlap = len(pref_tokens.intersection(journal_tokens))
            if overlap > 0:
                best = max(best, min(0.7, overlap / max(1, len(pref_tokens))))
    return best


def score_author_affinity(authors_json: str | None, profile: dict) -> float:
    if not authors_json:
        return 0.0
    try:
        authors = json.loads(authors_json) if isinstance(authors_json, str) else authors_json
        paper_author_names = {a.get("name", "").lower() for a in authors}
        interested_authors = profile.get("authors_of_interest") or []
        if isinstance(interested_authors, str):
            interested_authors = json.loads(interested_authors)
        interested_lower = {a.lower() for a in interested_authors}
        matches = len(paper_author_names & interested_lower)
        return min(matches / max(len(interested_lower), 1), 1.0) if interested_lower else 0.0
    except Exception:
        return 0.0


def compute_feedback_boost(feedback_history: list[dict]) -> float:
    if not feedback_history:
        return 0.5
    ups = sum(1 for f in feedback_history if f.get("rating") == "thumbs_up")
    downs = sum(1 for f in feedback_history if f.get("rating") == "thumbs_down")
    total = ups + downs
    if total == 0:
        return 0.5
    return ups / total


def assign_tier(score: float) -> str:
    thresholds = _get_thresholds()
    if score >= thresholds["must_read"]:
        return "must_read"
    if score >= thresholds["possibly_relevant"]:
        return "possibly_relevant"
    if score >= thresholds["adjacent"]:
        return "adjacent"
    return "ignored"


def rank_papers(papers: list[dict], profile: dict, feedback_stats: dict[int, float] | None = None) -> list[dict]:
    """
    papers: list of dicts with keys matching Paper ORM fields
    profile: dict from ResearchProfile
    feedback_stats: {paper_id: feedback_score} pre-computed

    Returns papers sorted by relevance_score descending, with tier assigned.
    """
    # Import embedding helpers lazily so ranking can still run when
    # torch/numpy/transformers environments are temporarily unhealthy.
    cosine_similarity = None
    bytes_to_embedding = None
    embed_single = None
    build_profile_text = None
    try:
        from embedding.embedder import (
            cosine_similarity as _cosine_similarity,
            bytes_to_embedding as _bytes_to_embedding,
            embed_single as _embed_single,
            build_profile_text as _build_profile_text,
        )
        cosine_similarity = _cosine_similarity
        bytes_to_embedding = _bytes_to_embedding
        embed_single = _embed_single
        build_profile_text = _build_profile_text
    except Exception as e:
        log.warning("Embedding helpers unavailable; ranking will use non-embedding signals only: %s", e)

    profile_text = build_profile_text(profile) if build_profile_text else ""
    if not profile_text.strip():
        for p in papers:
            p["relevance_score"] = 0.0
            p["tier"] = "ignored"
        return papers

    profile_emb = None
    if embed_single:
        try:
            profile_emb = embed_single(profile_text)
        except Exception as e:
            log.warning("Profile embedding unavailable; continuing without embedding similarity: %s", e)
            profile_emb = None

    interests = _normalize_profile_list(profile.get("interests"))
    keywords = _normalize_profile_list(profile.get("keywords"))
    domains = _normalize_profile_list(profile.get("domains"))
    journals_of_interest = _normalize_profile_list(profile.get("journals_of_interest"))

    seen_titles: set[str] = set()
    scored = []

    for paper in papers:
        title = paper.get("title", "")
        if title in seen_titles:
            continue
        seen_titles.add(title)

        # Embedding similarity
        emb_score = 0.0
        emb_bytes = paper.get("embedding")
        if profile_emb is not None and emb_bytes and bytes_to_embedding and cosine_similarity:
            try:
                paper_emb = bytes_to_embedding(emb_bytes)
                emb_score = max(0.0, cosine_similarity(profile_emb, paper_emb))
            except Exception:
                emb_score = 0.0

        # Method match
        methods = detect_methods(title, paper.get("abstract", ""))
        method_score = score_method_match(methods, interests)
        keyword_score = score_keyword_affinity(
            title=title,
            abstract=paper.get("abstract", ""),
            profile_keywords=keywords,
            profile_domains=domains,
            profile_interests=interests,
        )
        journal_score = score_journal_affinity(paper.get("journal"), journals_of_interest)

        # Author affinity
        author_score = score_author_affinity(paper.get("authors"), profile)

        # Feedback
        paper_id = paper.get("id")
        fb_score = (feedback_stats or {}).get(paper_id, 0.5)

        # Novelty: prefer papers without embeddings (not yet seen)
        novelty_score = 0.5  # neutral; could be enhanced with topic model

        # Citation proximity: placeholder
        citation_score = 0.0

        final_score = (
            SCORE_WEIGHTS["embedding"] * emb_score +
            SCORE_WEIGHTS["method_match"] * method_score +
            SCORE_WEIGHTS["keyword_affinity"] * keyword_score +
            SCORE_WEIGHTS["journal_affinity"] * journal_score +
            SCORE_WEIGHTS["feedback"] * fb_score +
            SCORE_WEIGHTS["author_affinity"] * author_score +
            SCORE_WEIGHTS["novelty"] * novelty_score +
            SCORE_WEIGHTS["citation"] * citation_score
        )

        paper["relevance_score"] = round(final_score, 4)
        paper["tier"] = assign_tier(final_score)
        paper["methods_detected"] = json.dumps(methods)
        scored.append(paper)

    scored.sort(key=lambda p: p["relevance_score"], reverse=True)

    # Guardrail: guarantee at least a small Must Read set when the profile has
    # meaningful intent signals but absolute scores are narrowly clustered.
    profile_has_signals = bool(interests or keywords or domains or journals_of_interest)
    if scored and profile_has_signals and not any(p.get("tier") == "must_read" for p in scored):
        promote_count = min(6, max(1, int(round(len(scored) * 0.1))))
        for item in scored[:promote_count]:
            item["tier"] = "must_read"

    # Guardrail: if scoring collapses almost everything into one middle bucket,
    # rebalance by rank percentile so tabs stay meaningful for users.
    if len(scored) >= 8:
        tier_hist = {"must_read": 0, "possibly_relevant": 0, "adjacent": 0, "ignored": 0}
        for item in scored:
            tier_hist[str(item.get("tier") or "ignored")] = tier_hist.get(str(item.get("tier") or "ignored"), 0) + 1
        dominant_tier = max(tier_hist, key=tier_hist.get)
        dominant_share = tier_hist[dominant_tier] / max(1, len(scored))
        collapsed_middle = (
            dominant_tier == "possibly_relevant"
            and dominant_share >= 0.8
            and tier_hist.get("must_read", 0) <= 1
            and tier_hist.get("adjacent", 0) <= 1
        )
        if collapsed_middle:
            n = len(scored)
            must_cut = max(1, int(round(n * 0.18)))
            poss_cut = max(must_cut + 1, int(round(n * 0.58)))
            adj_cut = max(poss_cut + 1, int(round(n * 0.82)))
            for i, item in enumerate(scored):
                if i < must_cut:
                    item["tier"] = "must_read"
                elif i < poss_cut:
                    item["tier"] = "possibly_relevant"
                elif i < adj_cut:
                    item["tier"] = "adjacent"
                else:
                    item["tier"] = "ignored"

    return scored
