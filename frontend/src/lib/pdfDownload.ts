import type { Paper } from "../api/client";
import { MOCK_PAPERS } from "../store";
import { API_BASE as API } from "./apiBase";
import { isTauri } from "./apiBase";
import { notifyPdfStatusChanged } from "./pdfEvents";

/** Metadata sent when the paper is not in the local DB (mock / demo list). */
export type PaperDownloadMeta = Pick<
  Paper,
  "id" | "title" | "authors" | "journal" | "published_date" | "doi" | "source"
> & {
  external_id?: string;
  url?: string;
};

export function toPaperDownloadMeta(paper: Paper): PaperDownloadMeta {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    journal: paper.journal,
    published_date: paper.published_date,
    doi: paper.doi,
    external_id: paper.external_id,
    url: paper.url,
    source: paper.source,
  };
}

/** Resolve metadata from the passed paper or the built-in demo list. */
export function resolvePaperDownloadMeta(
  paperId: string,
  paper?: Paper,
): PaperDownloadMeta | undefined {
  if (paper) return toPaperDownloadMeta(paper);
  const mock = MOCK_PAPERS.find((p) => String(p.id) === String(paperId));
  return mock ? toPaperDownloadMeta(mock) : undefined;
}

export interface LibraryPdfSettings {
  pdf_root: string;
  mirror_folders: boolean;
  auto_download_on_save: boolean;
  unpaywall_email: string;
  filename_template: string;
}

export interface PdfStatus {
  status: "saved" | "not_downloaded" | "error";
  path?: string | null;
  downloaded_at?: string;
  host_folder_name?: string;
  host_folder_id?: string;
  error?: string;
}

const PDF_STATUS_TTL_MS = 20_000;
type CachedPdfStatus = { expiresAt: number; value: PdfStatus };
const pdfStatusCache = new Map<string, CachedPdfStatus>();

function nowMs() {
  return Date.now();
}

function cacheKey(paperId: string): string {
  return String(paperId);
}

function readCachedPdfStatus(paperId: string): PdfStatus | null {
  const key = cacheKey(paperId);
  const hit = pdfStatusCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= nowMs()) {
    pdfStatusCache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCachedPdfStatus(paperId: string, value: PdfStatus) {
  pdfStatusCache.set(cacheKey(paperId), {
    expiresAt: nowMs() + PDF_STATUS_TTL_MS,
    value,
  });
}

export async function fetchLibraryPdfSettings(): Promise<LibraryPdfSettings> {
  const r = await fetch(`${API}/library/pdf-settings`);
  if (!r.ok) throw new Error("Failed to load PDF settings");
  return r.json();
}

export async function updateLibraryPdfSettings(
  patch: Partial<LibraryPdfSettings>,
): Promise<LibraryPdfSettings> {
  const r = await fetch(`${API}/library/pdf-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("Failed to save PDF settings");
  const settings = await r.json();
  await syncLibraryPdfFolders().catch(() => {});
  return settings;
}

export async function syncLibraryPdfFolders(): Promise<void> {
  await fetch(`${API}/library/sync-pdf-folders`, { method: "POST" });
}

export async function fetchPdfStatus(
  paperId: string,
  _folderId?: string,
): Promise<PdfStatus> {
  const cached = readCachedPdfStatus(paperId);
  if (cached) return cached;
  const pid = encodeURIComponent(String(paperId));
  const r = await fetch(`${API}/library/papers/${pid}/pdf-status`);
  if (!r.ok) {
    const miss = { status: "not_downloaded" } as PdfStatus;
    writeCachedPdfStatus(paperId, miss);
    return miss;
  }
  const status = (await r.json()) as PdfStatus;
  writeCachedPdfStatus(paperId, status);
  return status;
}

export async function fetchPdfTargetFolder(
  paperId: string,
  folderId?: string,
  folderName?: string,
): Promise<{ path: string; host_folder_id?: string; host_folder_name?: string }> {
  const qs = new URLSearchParams();
  if (folderId) qs.set("folder_id", folderId);
  if (folderName?.trim()) qs.set("folder_name", folderName.trim());
  const pid = encodeURIComponent(String(paperId));
  const r = await fetch(`${API}/library/papers/${pid}/pdf-target-folder?${qs.toString()}`);
  if (!r.ok) throw new Error("Could not resolve PDF folder");
  return r.json();
}

export async function fetchBulkPdfStatuses(
  paperIds: string[],
): Promise<Record<string, PdfStatus>> {
  if (paperIds.length === 0) return {};

  const out: Record<string, PdfStatus> = {};
  const missing: string[] = [];
  for (const paperId of paperIds) {
    const cached = readCachedPdfStatus(paperId);
    if (cached) {
      out[String(paperId)] = cached;
    } else {
      missing.push(String(paperId));
    }
  }
  if (missing.length === 0) return out;

  const r = await fetch(`${API}/library/pdf-status/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper_ids: missing }),
  });
  if (!r.ok) return out;
  const data = (await r.json().catch(() => ({}))) as {
    statuses?: Record<string, PdfStatus>;
  };
  const statuses = data.statuses ?? {};
  for (const [paperId, status] of Object.entries(statuses)) {
    writeCachedPdfStatus(paperId, status);
    out[paperId] = status;
  }
  for (const paperId of missing) {
    if (!out[paperId]) {
      const miss = { status: "not_downloaded" } as PdfStatus;
      writeCachedPdfStatus(paperId, miss);
      out[paperId] = miss;
    }
  }
  return out;
}

/** Open PDF in the system default viewer (Preview, Adobe, etc.). */
export async function openPdfFile(path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("No file path");

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_file", { path: trimmed });
    return;
  }

  const r = await fetch(`${API}/system/open-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: trimmed }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    throw new Error(
      typeof data.message === "string" ? data.message : "Could not open PDF",
    );
  }
}

export async function revealPdfInFolder(path: string): Promise<void> {
  const r = await fetch(`${API}/system/reveal-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    throw new Error(
      typeof data.message === "string" ? data.message : "Could not reveal file",
    );
  }
}

export async function openPdfLibraryRoot(pdfRoot: string): Promise<void> {
  const trimmed = pdfRoot.trim();
  if (!trimmed) return;
  const r = await fetch(`${API}/system/reveal-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: trimmed }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    throw new Error(
      typeof data.message === "string" ? data.message : "Could not open folder",
    );
  }
}

export async function downloadPaperPdf(
  paperId: string,
  folderId?: string,
  paper?: Paper,
): Promise<PdfStatus & { path?: string }> {
  const pid = encodeURIComponent(String(paperId));
  const meta = resolvePaperDownloadMeta(paperId, paper);
  if (!meta) {
    throw new Error("Paper metadata unavailable for PDF download");
  }

  const body: Record<string, unknown> = {
    paper_id: paperId,
    paper: meta,
  };
  if (folderId) body.folder_id = folderId;

  let r = await fetch(`${API}/library/download-open-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (r.status === 404) {
    r = await fetch(`${API}/library/papers/${pid}/download-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      typeof data.detail === "string" ? data.detail : "PDF download failed",
    );
  }
  if (data && typeof data === "object" && "status" in data) {
    writeCachedPdfStatus(paperId, data as PdfStatus);
  }
  notifyPdfStatusChanged(paperId);
  return data;
}

export async function uploadPaperPdf(
  paperId: string,
  file: File,
  options?: { folderId?: string; folderName?: string; paper?: Paper },
): Promise<PdfStatus & { path?: string; paper_id?: string }> {
  const meta = resolvePaperDownloadMeta(paperId, options?.paper);
  const buildForm = () => {
    const form = new FormData();
    form.append("file", file);
    form.append("paper_id", String(paperId));
    if (options?.folderId) form.append("folder_id", options.folderId);
    if (options?.folderName) form.append("folder_name", options.folderName);
    if (meta) form.append("paper", JSON.stringify(meta));
    return form;
  };

  let r = await fetch(`${API}/library/upload-pdf`, {
    method: "POST",
    body: buildForm(),
  });
  // Backward-compatible fallback: older backends only expose the per-paper route.
  if (r.status === 404) {
    const pid = encodeURIComponent(String(paperId));
    r = await fetch(`${API}/library/papers/${pid}/upload-pdf`, {
      method: "POST",
      body: buildForm(),
    });
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 404) {
      throw new Error(
        "PDF upload endpoint is unavailable in the running backend. Quit Research Atlas and reopen it, then try again.",
      );
    }
    const detail = typeof data.detail === "string" ? data.detail : "";
    throw new Error(detail || `PDF upload failed (${r.status})`);
  }
  if (data && typeof data === "object" && "status" in data) {
    writeCachedPdfStatus(paperId, data as PdfStatus);
  }
  notifyPdfStatusChanged(paperId);
  return data;
}

export async function fetchFolderPdfCount(folderId: string): Promise<number> {
  const r = await fetch(`${API}/library/folders/${folderId}/pdf-count`);
  if (!r.ok) return 0;
  const data = await r.json();
  return data.count ?? 0;
}

export async function browseFolder(): Promise<string> {
  const r = await fetch(`${API}/system/browse-folder`);
  const data = await r.json();
  return data.path ?? "";
}
