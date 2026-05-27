import type { Paper } from "../api/client";

export interface ImportPaperRef {
  id?: string;
  title?: string;
  doi?: string;
  authors?: string[];
}

export interface ImportResolveResult {
  resolved: Paper[];
  notFound: ImportPaperRef[];
}

export interface ImportApplyResult {
  added: Paper[];
  duplicates: Paper[];
  notFound: ImportPaperRef[];
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function normDoi(doi: string): string {
  return norm(doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

export function parseImportFile(content: string, filename: string): ImportPaperRef[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return parseJsonImport(content);
  if (lower.endsWith(".csv")) return parseCsvImport(content);
  if (lower.endsWith(".bib")) return parseBibtexImport(content);
  // Try JSON, then CSV
  try {
    return parseJsonImport(content);
  } catch {
    return parseCsvImport(content);
  }
}

function parseJsonImport(content: string): ImportPaperRef[] {
  const data = JSON.parse(content) as unknown;
  const list = Array.isArray(data)
    ? data
    : (data as { papers?: unknown[] })?.papers ?? [];
  return list.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: r.id != null ? String(r.id) : undefined,
      title: r.title != null ? String(r.title) : undefined,
      doi: r.doi != null ? String(r.doi) : undefined,
      authors: Array.isArray(r.authors) ? (r.authors as string[]) : undefined,
    };
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsvImport(content: string): ImportPaperRef[] {
  const lines = content.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idIdx = headers.indexOf("id");
  const titleIdx = headers.indexOf("title");
  const doiIdx = headers.indexOf("doi");
  const authorsIdx = headers.indexOf("authors");
  if (titleIdx < 0 && doiIdx < 0 && idIdx < 0) return [];

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const authors =
      authorsIdx >= 0 && cols[authorsIdx]
        ? cols[authorsIdx].split(";").map((a) => a.trim()).filter(Boolean)
        : undefined;
    return {
      id: idIdx >= 0 && cols[idIdx] ? cols[idIdx].trim() : undefined,
      title: titleIdx >= 0 ? cols[titleIdx]?.trim() : undefined,
      doi: doiIdx >= 0 ? cols[doiIdx]?.trim() || undefined : undefined,
      authors,
    };
  });
}

function parseBibtexImport(content: string): ImportPaperRef[] {
  const refs: ImportPaperRef[] = [];
  const blocks = content.split(/(?=@\w+\s*\{)/i).filter((b) => b.trim());
  for (const block of blocks) {
    const title =
      block.match(/title\s*=\s*\{([^}]*)\}/i)?.[1] ??
      block.match(/title\s*=\s*"([^"]*)"/i)?.[1];
    const doi =
      block.match(/doi\s*=\s*\{([^}]*)\}/i)?.[1] ??
      block.match(/doi\s*=\s*"([^"]*)"/i)?.[1];
    if (title || doi) {
      refs.push({
        title: title?.replace(/\s+/g, " ").trim(),
        doi: doi?.trim(),
      });
    }
  }
  return refs;
}

export function resolveImportRefs(
  refs: ImportPaperRef[],
  allPapers: Paper[],
): ImportResolveResult {
  const byId = new Map<string, Paper>();
  const byDoi = new Map<string, Paper>();
  const byTitle = new Map<string, Paper>();
  for (const p of allPapers) {
    byId.set(String(p.id), p);
    if (p.doi) byDoi.set(normDoi(p.doi), p);
    if (p.title) byTitle.set(norm(p.title), p);
  }

  const resolved: Paper[] = [];
  const notFound: ImportPaperRef[] = [];
  const seenIds = new Set<string>();

  for (const ref of refs) {
    let paper: Paper | undefined;
    if (ref.id) paper = byId.get(String(ref.id));
    if (!paper && ref.doi) paper = byDoi.get(normDoi(ref.doi));
    if (!paper && ref.title) paper = byTitle.get(norm(ref.title));

    if (paper && !seenIds.has(paper.id)) {
      seenIds.add(paper.id);
      resolved.push(paper);
    } else if (!paper) {
      notFound.push(ref);
    }
  }

  return { resolved, notFound };
}

export function folderNameExists(folders: { name: string }[], name: string): boolean {
  const n = norm(name);
  return folders.some((f) => norm(f.name) === n);
}
