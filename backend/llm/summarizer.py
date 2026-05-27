from __future__ import annotations
import json, httpx, re
from config import normalize_ollama_base_url, settings

SUMMARY_PROMPT = """You are a scientific literature assistant for a researcher. Analyze this paper and respond with ONLY valid JSON.

Paper title: {title}
Abstract: {abstract}

Researcher's interests: {interests}

Respond with this exact JSON structure:
{{
  "summary": "3-5 sentence plain-language summary of what this paper does and finds",
  "why_it_matters": "1-3 sentences written in a direct, collegial tone that explains the specific insight, method, or finding that connects to the researcher's work. Do NOT begin with phrases like 'The researcher', 'The researcher's interest', 'This paper is relevant', or 'This is relevant'. Instead open with the scientific substance itself.",
  "methods": ["list", "of", "key", "methods", "used"],
  "keywords": ["list", "of", "5-10", "keywords"]
}}"""


async def summarize_paper(title: str, abstract: str, interests: list[str]) -> dict:
    interests_str = ", ".join(str(i) for i in interests[:10]) if interests else "scientific research"
    prompt = SUMMARY_PROMPT.format(
        title=title[:300],
        abstract=abstract[:1500],
        interests=interests_str,
    )

    payload = {
        "model": settings.llm_model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": 768,
            "num_ctx": 2048,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{normalize_ollama_base_url(settings.ollama_base_url)}/api/generate",
                json=payload,
            )
            resp.raise_for_status()
            text = resp.json().get("response", "")
            return _parse_json_response(text)
    except Exception as e:
        return _fallback_summary(title, abstract, str(e))


def _parse_json_response(text: str) -> dict:
    # Extract JSON block from response
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return _fallback_summary(text[:100], "", "parse_error")


def _fallback_summary(title: str, abstract: str, reason: str) -> dict:
    abstract_text = (abstract or "").strip()
    return {
        "summary": abstract_text[:700] + "..." if len(abstract_text) > 700 else abstract_text,
        "why_it_matters": "",
        "methods": [],
        "keywords": [],
        "error": reason,
    }


async def summarize_batch(
    papers: list[dict],
    interests: list[str],
    max_papers: int = 50,
    progress_callback=None,
) -> list[dict]:
    results = []
    subset = papers[:max_papers]
    total = max(1, len(subset))
    for idx, paper in enumerate(subset, start=1):
        if progress_callback:
            try:
                await progress_callback(idx, total, str(paper.get("title") or ""))
            except Exception:
                pass
        result = await summarize_paper(
            paper.get("title", ""),
            paper.get("abstract", ""),
            interests,
        )
        paper.update({
            "summary": result.get("summary", ""),
            "why_it_matters": result.get("why_it_matters", ""),
            "methods_detected": json.dumps(result.get("methods", [])),
            "keywords": json.dumps(result.get("keywords", [])),
        })
        results.append(paper)
    return results
