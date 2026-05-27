import type { Paper } from "../api/client";

export type CitationStyle = "apa" | "bibtex" | "mla";

function yearFromDate(date?: string): string {
  if (!date) return "n.d.";
  const y = date.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : "n.d.";
}

function citationAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((author) => {
      if (typeof author === "string") return author.trim();
      if (author && typeof author === "object") {
        const record = author as Record<string, unknown>;
        const name = record.name ?? record.display_name ?? record.full_name;
        if (typeof name === "string" && name.trim()) return name.trim();
        const given = typeof record.given === "string" ? record.given.trim() : "";
        const family = typeof record.family === "string" ? record.family.trim() : "";
        return [given, family].filter(Boolean).join(" ").trim();
      }
      return "";
    })
    .filter(Boolean);
}

function bibtexValue(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** Build APA / BibTeX / MLA from in-memory paper metadata (works offline / without DB row). */
export function formatCitation(paper: Paper, style: CitationStyle): string {
  const authors = citationAuthors(paper.authors);
  const year = yearFromDate(paper.published_date);
  const title = paper.title || "";
  const journal = paper.journal || "";
  const doi = paper.doi || "";
  const doiUrl = doi ? `https://doi.org/${doi}` : "";

  if (style === "apa") {
    const authorStr =
      authors.slice(0, 5).join("; ") + (authors.length > 5 ? " et al." : "");
    return `${authorStr} (${year}). ${title}. *${journal}*. ${doiUrl}`.trim();
  }

  if (style === "bibtex") {
    const firstAuthor = authors[0] ?? "Unknown";
    const keyBase = `${firstAuthor.split(/\s+/).pop() || "Unknown"}${year}`.replace(/[^A-Za-z0-9:_-]/g, "");
    return `@article{${keyBase},
  title={${bibtexValue(title)}},
  author={${bibtexValue(authors.join(" and "))}},
  journal={${bibtexValue(journal)}},
  year={${bibtexValue(year)}},
  doi={${bibtexValue(doi)}}
}`;
  }

  const authorStr = authors[0] || "Unknown";
  return `${authorStr}. "${title}." *${journal}* (${year}). ${doiUrl}`.trim();
}
