import { mapPaper, type Paper } from "../api/client";
import { MOCK_PAPERS } from "../store";
import type { LibraryEntry } from "./library";
import {
  paperIdsForSelection,
  type ContextSelection,
} from "../components/ChatContextPicker";
import { fetchContextPapers } from "./chats";

const CONTEXT_CACHE_TTL_MS = 30_000;
const contextPaperCache = new Map<string, { at: number; papers: Paper[] }>();

/** Resolve saved papers directly from the compact library context endpoint. */
export async function resolveContextPapers(
  selection: ContextSelection,
  entries: LibraryEntry[],
): Promise<Paper[]> {
  const ids = paperIdsForSelection(selection, entries);
  if (ids.size === 0) return [];
  const orderedIds = [...ids].map((id) => String(id));

  const target =
    selection.wholeLibrary
      ? "library"
      : selection.folderIds.size === 1
        ? [...selection.folderIds][0]
        : [...selection.folderIds].join(",");
  const cacheKey = `${target || "library"}:${[...orderedIds].sort().join("|")}`;
  const cached = contextPaperCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CONTEXT_CACHE_TTL_MS) {
    return cached.papers;
  }

  try {
    const data = await fetchContextPapers(target || "library", {
      paperIds: orderedIds,
      limit: 60,
    });
    const papers = (data.papers as Record<string, unknown>[]).map(mapPaper);
    if (papers.length > 0) {
      const clipped = papers.slice(0, 60);
      contextPaperCache.set(cacheKey, { at: Date.now(), papers: clipped });
      return clipped;
    }

    const fallbackById = new Map(MOCK_PAPERS.map((paper) => [String(paper.id), paper]));
    const fallback = [...ids]
      .map((id) => fallbackById.get(String(id)))
      .filter((paper): paper is Paper => Boolean(paper))
      .slice(0, 60);
    contextPaperCache.set(cacheKey, { at: Date.now(), papers: fallback });
    return fallback;
  } catch {
    const fallbackById = new Map(MOCK_PAPERS.map((paper) => [String(paper.id), paper]));
    const fallback = [...ids]
      .map((id) => fallbackById.get(String(id)))
      .filter((paper): paper is Paper => Boolean(paper))
      .slice(0, 60);
    contextPaperCache.set(cacheKey, { at: Date.now(), papers: fallback });
    return fallback;
  }
}

export function contextEntryCount(selection: ContextSelection, entries: LibraryEntry[]): number {
  return paperIdsForSelection(selection, entries).size;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 2);
}

export function selectRelevantContextPapers(
  message: string,
  papers: Paper[],
  limit = 12,
): Paper[] {
  if (papers.length <= limit) return papers;
  const terms = tokenize(message);
  if (terms.length === 0) return papers.slice(0, limit);

  const scored = papers.map((paper, index) => {
    const title = paper.title.toLowerCase();
    const summary = (paper.summary ?? "").toLowerCase();
    const abstract = paper.abstract.toLowerCase();
    const metadata = [
      paper.journal,
      paper.source,
      ...(paper.authors ?? []),
      ...(paper.keywords ?? []),
      ...(paper.methods ?? []),
    ].join(" ").toLowerCase();
    let score = paper.relevance_score / 1000;
    for (const term of terms) {
      if (title.includes(term)) score += 8;
      if (summary.includes(term)) score += 4;
      if (metadata.includes(term)) score += 3;
      if (abstract.includes(term)) score += 1;
    }
    return { paper, score, index };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.paper);
}
