import { API_BASE as API } from "./apiBase";
import { isTauri } from "./apiBase";

const MODELS_STATE_TTL_MS = 3_000;
let modelsStateCache: { at: number; data: ModelsStateResponse } | null = null;
let modelsStateInflight: Promise<ModelsStateResponse> | null = null;

async function fetchJsonWithTimeout<T>(url: string, ms = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`Request failed: ${r.status}`);
    return r.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

export interface CatalogModel {
  id: string;
  name: string;
  description: string;
  size_gb: number;
  role: "llm" | "embedding" | "runtime";
  recommended?: boolean;
  recommended_for?: ("filter" | "chat")[];
  recommended_hardware?: string;
  install_method: "ollama" | "huggingface" | "ollama_app";
  install_url: string;
  install_command: string;
  storage_path: string;
  install_steps: string[];
}

export const DEFAULT_OLLAMA_RUNTIME: CatalogModel = {
  id: "ollama",
  name: "Ollama",
  description:
    "Local runtime required to run language models. Install this before pulling LLMs.",
  size_gb: 0.5,
  role: "runtime",
  recommended: true,
  install_method: "ollama_app",
  install_url: "https://ollama.com/download",
  install_command:
    "curl -L https://ollama.com/download/Ollama-darwin.zip -o /tmp/Ollama.zip\n" +
    "python3 - <<'PY'\n" +
    "import pathlib, shutil, zipfile\n" +
    "work = pathlib.Path('/tmp/ollama-install')\n" +
    "if work.exists(): shutil.rmtree(work)\n" +
    "zipfile.ZipFile('/tmp/Ollama.zip').extractall(work)\n" +
    "src = work / 'Ollama.app'\n" +
    "dst = pathlib.Path.home() / 'Applications' / 'Ollama.app'\n" +
    "dst.parent.mkdir(parents=True, exist_ok=True)\n" +
    "if dst.exists(): shutil.rmtree(dst)\n" +
    "shutil.copytree(src, dst)\n" +
    "print(dst)\n" +
    "PY\n" +
    "open \"$HOME/Applications/Ollama.app\"",
  storage_path: "/Applications/Ollama.app",
  install_steps: [
    "Click Install below to download and install the Ollama app.",
    "On macOS, Research Atlas installs Ollama in /Applications when allowed, otherwise ~/Applications.",
    "After install, start Ollama if it is not already running (menu bar icon).",
    "Then install language models below.",
  ],
};

export interface RuntimeInstallState {
  installed: boolean;
  running: boolean;
  version?: string | null;
}

export interface EmbeddingInstallState {
  id: string;
  installed: boolean;
  cache_dirs: string[];
}

export interface InstalledModelsResponse {
  llm: { name: string }[];
  embedding: EmbeddingInstallState[];
  runtime?: { ollama: RuntimeInstallState };
  ollama_running: boolean;
  ollama_installed?: boolean;
  paths: {
    ollama_models: string;
    ollama_runtime?: string;
    embedding_cache: string;
    ollama_download: string;
    app_data: string;
  };
}

export interface ModelsStateResponse {
  installed: InstalledModelsResponse;
  readiness: {
    ollama_running: boolean;
    llm: { id: string; ready: boolean };
    embedding: { id: string; ready: boolean };
  };
  status: {
    running: boolean;
    model_count: number;
  };
  active: {
    llm_model: string;
    embedding_model: string;
    llm_model_selected: boolean;
  };
}

export interface SystemComponent {
  id: string;
  label: string;
  path: string;
  type: "data" | "model" | "app" | "config";
  size_bytes: number;
  size_label: string;
  can_open: boolean;
  can_delete: boolean;
  purge_key: string | null;
  install_url?: string;
}

export type ModelInstallEvent = Record<string, unknown>;

function parseInstallEvent(line: string): ModelInstallEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload) as ModelInstallEvent;
  } catch {
    return null;
  }
}

function eventIndicatesFailure(data: ModelInstallEvent): string | null {
  if (data.status === "error") {
    return String(data.message ?? "Install failed");
  }
  if (typeof data.error === "string" && data.error) {
    return data.error;
  }
  return null;
}

function eventIndicatesSuccess(data: ModelInstallEvent): boolean {
  return data.status === "success";
}

/** Apply Ollama pull progress fields to our UI shape. */
function normalizeInstallEvent(data: ModelInstallEvent): ModelInstallEvent {
  if (data.status === "downloading" || data.status === "success" || data.status === "error") {
    return data;
  }
  const status = typeof data.status === "string" ? data.status : "";
  if (status === "success") {
    return { ...data, status: "success" };
  }
  if (status.includes("error") || data.error) {
    return {
      status: "error",
      message: String(data.error ?? data.message ?? status),
    };
  }
  const completed = data.completed;
  const total = data.total;
  const out: ModelInstallEvent = {
    status: "downloading",
    message: status || "Downloading…",
  };
  if (typeof completed === "number" && typeof total === "number" && total > 0) {
    out.completed = Math.round((completed / total) * 100);
    out.total = 100;
  }
  return out;
}

export async function fetchModelCatalog(): Promise<{
  runtime: CatalogModel[];
  llm: CatalogModel[];
  embedding: CatalogModel[];
}> {
  const data = await fetchJsonWithTimeout<{
    runtime?: CatalogModel[];
    llm: CatalogModel[];
    embedding: CatalogModel[];
  }>(`${API}/models/catalog`);
  const runtime =
    data.runtime?.length ? data.runtime : [DEFAULT_OLLAMA_RUNTIME];
  return { runtime, llm: data.llm ?? [], embedding: data.embedding ?? [] };
}

export async function fetchInstalledModels(): Promise<InstalledModelsResponse> {
  if (modelsStateCache && Date.now() - modelsStateCache.at < MODELS_STATE_TTL_MS) {
    return modelsStateCache.data.installed;
  }
  try {
    const state = await fetchJsonWithTimeout<ModelsStateResponse>(`${API}/models/state`, 7_000);
    modelsStateCache = { at: Date.now(), data: state };
    return state.installed;
  } catch {
    return fetchInstalledModelsDirect();
  }
}

async function fetchInstalledModelsDirect(): Promise<InstalledModelsResponse> {
  return fetchJsonWithTimeout<InstalledModelsResponse>(`${API}/models/installed`, 7_000);
}

async function fetchModelsStateUncached(): Promise<ModelsStateResponse> {
  try {
    return await fetchJsonWithTimeout<ModelsStateResponse>(`${API}/models/state`, 7_000);
  } catch {
    const [installedResult, readinessResult] = await Promise.allSettled([
      fetchInstalledModelsDirect(),
      fetchJsonWithTimeout<{
        ollama_running: boolean;
        llm: { id: string; ready: boolean };
        embedding: { id: string; ready: boolean };
      }>(`${API}/models/readiness`, 7_000),
    ]);
    if (installedResult.status !== "fulfilled" && readinessResult.status !== "fulfilled") {
      throw new Error("Could not load model state");
    }
    const installed =
      installedResult.status === "fulfilled"
        ? installedResult.value
        : {
            llm: [],
            embedding: [],
            runtime: { ollama: { installed: false, running: false } },
            ollama_running: false,
            ollama_installed: false,
            paths: {
              ollama_models: "",
              embedding_cache: "",
              ollama_download: "",
              app_data: "",
            },
          };
    const readiness =
      readinessResult.status === "fulfilled"
        ? readinessResult.value
        : {
            ollama_running: Boolean(installed.ollama_running),
            llm: { id: "", ready: false },
            embedding: { id: "", ready: false },
          };
    return {
      installed,
      readiness,
      status: {
        running: installed.ollama_running,
        model_count: installed.llm.length,
      },
      active: {
        llm_model: "",
        embedding_model: "",
        llm_model_selected: false,
      },
    };
  }
}

export function invalidateModelsStateCache(): void {
  modelsStateCache = null;
}

export async function fetchModelsState(options?: { force?: boolean }): Promise<ModelsStateResponse> {
  if (!options?.force && modelsStateCache && Date.now() - modelsStateCache.at < MODELS_STATE_TTL_MS) {
    return modelsStateCache.data;
  }
  if (!options?.force && modelsStateInflight) {
    return modelsStateInflight;
  }
  const request = fetchModelsStateUncached()
    .then((data) => {
      modelsStateCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      if (modelsStateInflight === request) {
        modelsStateInflight = null;
      }
    });
  modelsStateInflight = request;
  return request;
}

export function isLlmInstalled(
  modelId: string,
  ollamaModels: { name: string }[],
): boolean {
  const target = modelId.toLowerCase();
  const targetWithLatest = target.includes(":") ? target : `${target}:latest`;
  return ollamaModels.some((m) => {
    const name = m.name.toLowerCase();
    const nameWithLatest = name.includes(":") ? name : `${name}:latest`;
    return nameWithLatest === targetWithLatest;
  });
}

export function isOllamaAppInstalled(installed: InstalledModelsResponse): boolean {
  return (
    installed.runtime?.ollama?.installed ??
    installed.ollama_installed ??
    false
  );
}

export interface InstallResult {
  ok: boolean;
  message?: string;
}

async function installModelViaTauri(
  modelId: string,
  role: "llm" | "embedding" | "runtime",
): Promise<InstallResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const data = await invoke<{ status?: string; message?: string }>(
    "install_model_via_backend",
    {
      request: { name: modelId, role },
    },
  );
  if (data.status === "success") {
    return { ok: true, message: data.message };
  }
  return { ok: false, message: data.message ?? "Install failed" };
}

/** Blocking install (works in Tauri; no SSE). Can take several minutes. */
export async function installModelBlocking(
  modelId: string,
  role: "llm" | "embedding" | "runtime",
): Promise<InstallResult> {
  if (isTauri()) {
    try {
      return await installModelViaTauri(modelId, role);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : "Install failed";
      return { ok: false, message: msg };
    }
  }

  const controller = new AbortController();
  const timeoutMs = role === "embedding" ? 1_800_000 : 900_000;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/models/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelId, role, stream: false }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `Server error (${res.status})`;
      try {
        const body = (await res.json()) as { detail?: string; message?: string };
        detail = body.detail ?? body.message ?? detail;
      } catch {
        const text = await res.text().catch(() => "");
        if (text) detail = text.slice(0, 400);
      }
      return { ok: false, message: detail };
    }
    const data = (await res.json()) as { status?: string; message?: string };
    if (data.status === "success") {
      return { ok: true, message: data.message };
    }
    return {
      ok: false,
      message: data.message ?? "Install failed",
    };
  } catch (e: unknown) {
    if (controller.signal.aborted) {
      return { ok: false, message: "Install timed out. Try again or use manual install below." };
    }
    const msg =
      e instanceof Error ? e.message : "Could not reach Research Atlas backend";
    return { ok: false, message: msg };
  } finally {
    window.clearTimeout(timer);
  }
}

export function streamModelInstall(
  modelId: string,
  role: "llm" | "embedding" | "runtime",
  onEvent: (data: ModelInstallEvent) => void,
  onDone: (ok: boolean, errorMessage?: string) => void,
): () => void {
  const controller = new AbortController();
  let lastError = "Install failed. Check that Research Atlas is online.";

  const handleEvent = (raw: ModelInstallEvent) => {
    const data = normalizeInstallEvent(raw);
    onEvent(data);
    const err = eventIndicatesFailure(data);
    if (err) lastError = err;
    return { success: eventIndicatesSuccess(data), error: err };
  };

  const processSseBuffer = (buffer: string, onLine: (line: string) => void) => {
    const parts = buffer.split("\n");
    const rest = parts.pop() ?? "";
    for (const line of parts) {
      if (line.trim()) onLine(line);
    }
    return rest;
  };

  fetch(`${API}/models/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelId, role }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        let detail = `Server error (${res.status})`;
        try {
          const body = (await res.json()) as { detail?: string };
          if (body.detail) detail = body.detail;
        } catch {
          const text = await res.text().catch(() => "");
          if (text) detail = text.slice(0, 300);
        }
        onDone(false, detail);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onDone(false, "No response stream from server");
        return;
      }

      const decoder = new TextDecoder();
      let buf = "";
      let succeeded = false;
      let failed = false;

      const consumeLine = (line: string) => {
        const data = parseInstallEvent(line);
        if (!data) return;
        const result = handleEvent(data);
        if (result.success) succeeded = true;
        if (result.error) failed = true;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        buf = processSseBuffer(buf, consumeLine);
      }
      buf += decoder.decode();
      processSseBuffer(`${buf}\n`, consumeLine);

      if (failed) {
        onDone(false, lastError);
      } else if (succeeded) {
        onDone(true);
      } else {
        onDone(false, lastError);
      }
    })
    .catch((e: unknown) => {
      if (controller.signal.aborted) return;
      const msg =
        e instanceof Error ? e.message : "Could not reach Research Atlas backend";
      onDone(false, msg);
    });

  return () => controller.abort();
}

export async function deleteModel(
  modelId: string,
  role: "llm" | "embedding" | "runtime",
): Promise<void> {
  const q = new URLSearchParams({ role });
  const r = await fetch(
    `${API}/models/${encodeURIComponent(modelId)}?${q}`,
    { method: "DELETE" },
  );
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? "Failed to remove model");
  }
}

export async function fetchSystemComponents(): Promise<{
  components: SystemComponent[];
  app_data_dir: string;
}> {
  const r = await fetch(`${API}/system/components`);
  if (!r.ok) throw new Error("Failed to load components");
  return r.json();
}

export async function revealPath(path: string): Promise<void> {
  const r = await fetch(`${API}/system/reveal-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!r.ok) {
    throw new Error(`Could not show folder (${r.status})`);
  }
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (data.ok === false) {
    throw new Error(data.message ?? "Could not show folder");
  }
}

export async function purgeComponent(purgeKey: string): Promise<string[]> {
  const body: Record<string, boolean> = { [purgeKey]: true };
  const r = await fetch(`${API}/system/purge`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Failed to delete component");
  const data = await r.json();
  return data.deleted ?? [];
}

export async function purgeAllResearchAtlasData(): Promise<{ deleted: string[] }> {
  const r = await fetch(`${API}/system/purge-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ include_ollama: true, include_ollama_models: true }),
  });
  if (!r.ok) throw new Error("Failed to remove all data");
  return r.json();
}

export async function backupResearchAtlasData(): Promise<{ path: string; size_bytes: number }> {
  const r = await fetch(`${API}/system/backup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error("Backup failed");
  return r.json();
}
