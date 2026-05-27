import type { Paper } from "../api/client";
import { API_BASE } from "./apiBase";
import { formatCitation } from "./citation";

export function downloadTextFile(content: string, filename: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function papersToCsv(papers: Paper[]): string {
  const headers = [
    "title",
    "authors",
    "journal",
    "published_date",
    "doi",
    "source",
    "tier",
    "relevance_score",
    "summary",
  ];
  const rows = papers.map((p) =>
    [
      p.title,
      p.authors.join("; "),
      p.journal ?? "",
      p.published_date ?? "",
      p.doi ?? "",
      p.source,
      p.tier,
      String(p.relevance_score),
      p.summary ?? "",
    ]
      .map(escapeCsv)
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

export function papersToJson(papers: Paper[]): string {
  return JSON.stringify(papers, null, 2);
}

export async function fetchBibtexForPapers(
  papers: Paper[],
  apiBase = API_BASE,
): Promise<string> {
  const citations = await Promise.all(
    papers.map(async (paper) => {
      try {
        const r = await fetch(
          `${apiBase}/library/citation/${paper.id}?style=bibtex`,
        );
        if (r.ok) {
          const d = await r.json();
          if (d.citation) return d.citation as string;
        }
      } catch {
        /* use local fallback */
      }
      return formatCitation(paper, "bibtex");
    }),
  );
  return citations.filter(Boolean).join("\n\n");
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 80) || "export";
}
