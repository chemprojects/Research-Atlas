// ── Types ──────────────────────────────────────────────────────────────────────

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  journal: string;
  published_date: string;
  doi?: string;
  external_id?: string;
  url?: string;
  abstract: string;
  summary?: string;
  why_it_matters?: string;
  methods?: string[];
  keywords?: string[];
  source: string;
  tier: "unfiltered" | "must_read" | "possibly_relevant" | "adjacent" | "ignored";
  relevance_score: number;
  feedback?: "up" | "down" | null;
}

export interface DigestEntry {
  date: string;
  must_read: Paper[];
  possibly_relevant: Paper[];
  adjacent: Paper[];
  total_scanned: number;
  generated_at: string;
}

export interface ResearchProfile {
  interests: string[];
  keywords: string[];
  domains: string[];
  authors_of_interest: string[];
  journals_of_interest: string[];
}

export interface Source {
  id: number;
  name: string;
  type: "openalex" | "arxiv" | "pubmed" | "crossref" | "chemrxiv" | "rss" | string;
  enabled: boolean;
  url?: string | null;
  last_fetched?: string | null;
  paper_count: number;
  health?: "healthy" | "warning" | "error" | "unknown";
  health_message?: string;
  config?: Record<string, unknown>;
}

export interface OllamaModel {
  name: string;
  display_name: string;
  description: string;
  size_gb: number;
  family: string;
  cpu_speed: number;  // 0-100
  gpu_speed: number;  // 0-100
  quality: number;    // 1-5
  best_for: string;
  installed: boolean;
  active: boolean;
  recommended?: boolean;
  type: "llm" | "embedding";
}

export interface HardwareInfo {
  os: string;
  os_version: string;
  cpu_model: string;
  cpu_cores: number;
  cpu_threads: number;
  ram_total_gb: number;
  ram_used_gb: number;
  gpu_name?: string;
  gpu_vram_gb?: number;
  gpu_available: boolean;
  disk_total_gb: number;
  disk_used_gb: number;
  disk_free_gb: number;
}

export interface SystemStatus {
  backend_ready: boolean;
  ollama_installed: boolean;
  ollama_version?: string;
  ollama_running: boolean;
  current_llm?: string;
  chat_llm_model?: string;
  current_embedding?: string;
  scan_running: boolean;
  scan_progress?: {
    mode?: "scan" | "filter";
    phase?: string;
    message?: string;
    percent?: number;
    sources_total?: number;
    sources_done?: number;
    papers_fetched?: number;
    papers_kept?: number;
    papers_total?: number;
    papers_processed?: number;
    lookback_days?: number;
    tier_counts?: Record<string, number>;
  };
  last_scan?: string;
  papers_today: number;
  must_read_today: number;
  app_data_dir: string;
  venv_ready?: boolean;
  ollama_supported?: boolean;
  os?: string;
  os_version?: string;
}

export interface ScanResult {
  job_id: string;
  mode?: "scan" | "filter";
  started_at: string;
  status: "running" | "completed" | "failed";
  papers_found?: number;
  message?: string;
}

export interface InstallProgress {
  model: string;
  progress: number;
  status: "downloading" | "verifying" | "ready" | "error";
  message?: string;
}

// ── Client ─────────────────────────────────────────────────────────────────────

import { API_BASE, isTauri } from "../lib/apiBase";

const SYSTEM_STATUS_TTL_MS = 800;
let systemStatusCache: { at: number; data: SystemStatus } | null = null;
let systemStatusInflight: Promise<SystemStatus> | null = null;

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`API error ${response.status}: ${text}`);
  }

  if (import.meta.env.DEV) {
    const ms = performance.now() - startedAt;
    if (ms >= 250) {
      console.info(`[api] ${options?.method ?? "GET"} ${path} ${Math.round(ms)}ms`);
    }
  }

  return response.json();
}

// ── Papers ─────────────────────────────────────────────────────────────────────

function normalizeAuthors(value: unknown): string[] {
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
    .filter((author) => author.length > 0);
}

export function mapPaper(raw: Record<string, unknown>): Paper {
  const feedback = raw.feedback as string | null | undefined;
  let mappedFeedback: Paper["feedback"] = null;
  if (feedback === "thumbs_up") mappedFeedback = "up";
  else if (feedback === "thumbs_down") mappedFeedback = "down";

  return {
    id: String(raw.id),
    title: String(raw.title ?? ""),
    authors: normalizeAuthors(raw.authors),
    journal: String(raw.journal ?? ""),
    published_date: String(raw.published_date ?? ""),
    doi: raw.doi as string | undefined,
    external_id: raw.external_id as string | undefined,
    url: raw.url as string | undefined,
    abstract: String(raw.abstract ?? ""),
    summary: raw.summary as string | undefined,
    why_it_matters: raw.why_it_matters as string | undefined,
    methods: (raw.methods_detected as string[] | undefined) ?? (raw.methods as string[] | undefined),
    keywords: (raw.keywords as string[] | undefined) ?? [],
    source: String(raw.source ?? ""),
    tier: (raw.tier as Paper["tier"]) ?? "ignored",
    relevance_score: Number(raw.relevance_score ?? 0),
    feedback: mappedFeedback,
  };
}

export async function fetchPapers(params?: {
  source?: string;
  tier?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  sort?: "relevance" | "date";
  limit?: number;
  offset?: number;
  include_total?: boolean;
  exclude_saved?: boolean;
}): Promise<{ papers: Paper[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.tier) qs.set("tier", params.tier);
  if (params?.source) qs.set("source", params.source);
  if (params?.search) qs.set("search", params.search);
  if (params?.date_from) qs.set("date_from", params.date_from);
  if (params?.date_to) qs.set("date_to", params.date_to);
  if (params?.sort) qs.set("sort_by", params.sort === "date" ? "date" : "relevance_score");
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  if (params?.include_total) qs.set("include_total", "1");
  if (params?.exclude_saved) qs.set("exclude_saved", "1");
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<unknown>(`/papers/${query}`);
  const list = Array.isArray(data)
    ? data
    : (data as { papers?: unknown[] }).papers ?? [];
  const papers = list.map((p) => mapPaper(p as Record<string, unknown>));
  const rawTotal = Array.isArray(data)
    ? papers.length
    : (data as { total?: number | null }).total;
  const parsedTotal = Number(rawTotal);
  const total = Number.isFinite(parsedTotal) && parsedTotal >= 0
    ? parsedTotal
    : papers.length;
  return { papers, total };
}

export async function fetchPaperStats(params?: { exclude_saved?: boolean }): Promise<Record<string, number>> {
  const qs = new URLSearchParams();
  if (params?.exclude_saved) qs.set("exclude_saved", "1");
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return request<Record<string, number>>(`/papers/stats${query}`);
}

export async function ignorePaper(paperId: string): Promise<void> {
  await request(`/papers/${paperId}/tier`, {
    method: "PATCH",
    body: JSON.stringify({ tier: "ignored" }),
  });
}

export async function bulkIgnorePapers(body: {
  paper_ids?: string[];
  date?: string;
  tier?: string;
}): Promise<{ updated: number }> {
  return request("/papers/bulk-ignore", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function bulkDeletePapers(body: {
  paper_ids?: string[];
  date?: string;
  tier?: string;
}): Promise<{ deleted: number }> {
  return request("/papers/bulk-delete", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function submitFeedback(
  paperId: string,
  rating: "up" | "down" | null
): Promise<{ success: boolean }> {
  return request(`/papers/${paperId}/feedback`, {
    method: "POST",
    body: JSON.stringify({ rating }),
  });
}

// ── Digest ─────────────────────────────────────────────────────────────────────

export async function fetchDigest(date?: string): Promise<DigestEntry> {
  const query = date ? `?date=${date}` : "";
  return request(`/digest${query}`);
}

// ── Profile ────────────────────────────────────────────────────────────────────

export async function fetchProfile(): Promise<ResearchProfile> {
  return request("/profile");
}

export async function updateProfile(
  profile: Partial<ResearchProfile>
): Promise<ResearchProfile> {
  return request("/profile", {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

// ── Sources ────────────────────────────────────────────────────────────────────

export async function fetchSources(options?: { probe?: boolean }): Promise<Source[]> {
  const q = options?.probe ? "?probe=1" : "";
  return request(`/sources/${q}`);
}

export async function addSource(source: {
  name: string;
  type?: string;
  url?: string;
  enabled?: boolean;
}): Promise<Source> {
  return request("/sources/", {
    method: "POST",
    body: JSON.stringify(source),
  });
}

export async function updateSource(
  id: number,
  updates: Partial<Pick<Source, "name" | "url" | "enabled">>
): Promise<Source> {
  return request(`/sources/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteSource(id: number): Promise<{ status: string; id: number }> {
  return request(`/sources/${id}`, { method: "DELETE" });
}

export async function probeSourceUrl(
  url: string
): Promise<{ valid: boolean; health: string; health_message?: string; error?: string }> {
  return request("/sources/probe-url", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function testSourceById(
  id: number
): Promise<{ status: string; papers_found?: number; message?: string }> {
  return request(`/sources/${id}/test`, { method: "POST" });
}

// ── Models ─────────────────────────────────────────────────────────────────────

export async function fetchModels(): Promise<OllamaModel[]> {
  return request("/models");
}

export async function installModel(name: string): Promise<{ job_id: string }> {
  return request("/models/install", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function deleteModel(
  name: string
): Promise<{ success: boolean }> {
  return request(`/models/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function setActiveModel(
  name: string,
  type: "llm" | "embedding"
): Promise<{ success: boolean }> {
  return request("/models/active", {
    method: "POST",
    body: JSON.stringify({ name, type }),
  });
}

export async function getInstallProgress(
  jobId: string
): Promise<InstallProgress> {
  return request(`/models/install/${jobId}/progress`);
}

// ── Hardware ───────────────────────────────────────────────────────────────────

export async function fetchHardware(): Promise<HardwareInfo> {
  return request("/hardware");
}

// ── Scan ───────────────────────────────────────────────────────────────────────

export async function triggerScan(options?: {
  embedding_model?: string;
  from_date?: string;
  to_date?: string;
}): Promise<ScanResult> {
  return request("/system/scan", {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
}

export async function triggerFilter(options?: {
  llm_model?: string;
  embedding_model?: string;
}): Promise<ScanResult> {
  return request("/system/filter", {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
}

export async function stopScan(): Promise<{ status: string; message: string }> {
  return request("/system/scan/stop", {
    method: "POST",
  });
}

export async function fetchScanStatus(jobId?: string): Promise<ScanResult> {
  const path = jobId ? `/scan/${jobId}/status` : "/scan/latest";
  return request(path);
}

// ── System ─────────────────────────────────────────────────────────────────────

export interface SystemConfig {
  llm_model: string;
  chat_llm_model?: string;
  embedding_model: string;
  ollama_base_url: string;
  ollama_models_path: string;
  must_read_threshold: number;
}

export async function fetchSystemConfig(): Promise<SystemConfig> {
  return request("/system/config");
}

export async function updateSystemConfig(
  patch: Partial<SystemConfig>,
): Promise<SystemConfig> {
  return request("/system/config", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function bulkResetIgnored(paperIds?: string[]): Promise<{ status: string; updated: number }> {
  return request("/papers/bulk-reset-ignored", {
    method: "POST",
    body: JSON.stringify(paperIds?.length ? { paper_ids: paperIds } : {}),
  });
}

export async function startOllama(): Promise<{ running: boolean; message?: string }> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{ running: boolean; message?: string }>("start_ollama_via_backend");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : typeof e === "string" ? e : "Could not start Ollama.";
      return { running: false, message };
    }
  }
  return request("/system/start-ollama", { method: "POST" });
}

async function fetchSystemStatusUncached(): Promise<SystemStatus> {
  const raw = await request<Record<string, unknown>>("/system/status");
  return {
    backend_ready: Boolean(raw.backend_ready ?? true),
    ollama_installed: Boolean(raw.ollama_installed ?? raw.ollama_running),
    ollama_running: Boolean(raw.ollama_running),
    ollama_version: undefined,
    current_llm: raw.active_model ? String(raw.active_model) : undefined,
    chat_llm_model: raw.chat_llm_model ? String(raw.chat_llm_model) : undefined,
    current_embedding: raw.embedding_model ? String(raw.embedding_model) : undefined,
    scan_running: Boolean(raw.scan_running ?? false),
    scan_progress:
      raw.scan_progress && typeof raw.scan_progress === "object"
        ? (raw.scan_progress as SystemStatus["scan_progress"])
        : undefined,
    last_scan: raw.last_scan ? String(raw.last_scan) : undefined,
    papers_today: 0,
    must_read_today: 0,
    app_data_dir: String(raw.data_dir ?? ""),
    venv_ready: Boolean(raw.venv_ready),
    ollama_supported: raw.ollama_supported !== false,
    os: String(raw.os ?? ""),
    os_version: String(raw.os_version ?? ""),
  };
}

export async function fetchSystemStatus(options?: { force?: boolean }): Promise<SystemStatus> {
  if (!options?.force && systemStatusCache && Date.now() - systemStatusCache.at < SYSTEM_STATUS_TTL_MS) {
    return systemStatusCache.data;
  }
  if (!options?.force && systemStatusInflight) {
    return systemStatusInflight;
  }
  const request = fetchSystemStatusUncached()
    .then((data) => {
      systemStatusCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      if (systemStatusInflight === request) {
        systemStatusInflight = null;
      }
    });
  systemStatusInflight = request;
  return request;
}

// ── Storage ────────────────────────────────────────────────────────────────────

export interface StorageInfo {
  app_data_dir: string;
  paper_db_gb: number;
  vector_db_gb: number;
  pdf_cache_gb: number;
  logs_gb: number;
  models_gb: number;
  total_gb: number;
}

export async function fetchStorageInfo(): Promise<StorageInfo> {
  return request("/storage");
}

export async function backupAppData(path?: string): Promise<{ path: string; size_bytes: number }> {
  return request("/system/backup", {
    method: "POST",
    body: JSON.stringify(path ? { path } : {}),
  });
}

export async function purgeAllData(options: {
  include_ollama?: boolean;
  include_ollama_models?: boolean;
}): Promise<{ deleted: string[] }> {
  return request("/system/purge-all", {
    method: "POST",
    body: JSON.stringify({
      include_ollama: options.include_ollama ?? true,
      include_ollama_models: options.include_ollama_models ?? true,
    }),
  });
}
