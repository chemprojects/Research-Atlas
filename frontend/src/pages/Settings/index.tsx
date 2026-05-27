import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Save, Bell, Palette, Check, User, Globe, Cpu, Server, Monitor, Info, RefreshCw, Trash2, Plus, Type, ExternalLink, Loader2, AlertCircle, HardDrive } from "lucide-react";
import clsx from "clsx";
import {
  updateProfile,
  fetchProfile,
  fetchSources,
  addSource as apiAddSource,
  updateSource as apiUpdateSource,
  deleteSource as apiDeleteSource,
  probeSourceUrl,
  testSourceById,
  startOllama,
  type Source,
} from "../../api/client";
import { ScheduleEditor, loadScanSchedule, saveScanSchedule, type ScanSchedule } from "../../components/ScheduleEditor";
import { DomainPicker } from "../../components/DomainPicker";
import {
  useAppearance,
  type FontSize,
  THEME_OPTIONS,
} from "../../hooks/useAppearance";
import {
  fetchSystemConfig,
  updateSystemConfig,
} from "../../api/client";
import {
  fetchLibraryPdfSettings,
  updateLibraryPdfSettings,
  browseFolder,
  openPdfLibraryRoot,
  syncLibraryPdfFolders,
} from "../../lib/pdfDownload";
import {
  fetchHardware,
  updateResourceAllocation,
  type HardwareResponse,
  type ResourceAllocation,
} from "../../lib/hardware";
import { HardwareSettingsPanel } from "../../components/HardwareSettingsPanel";
import { ModelInstallPanel } from "../../components/ModelInstallPanel";
import { ComponentsPanel } from "../../components/ComponentsPanel";
import {
  fetchModelCatalog,
  fetchModelsState,
  installModelBlocking,
  deleteModel,
  isLlmInstalled,
  isOllamaAppInstalled,
  DEFAULT_OLLAMA_RUNTIME,
  revealPath,
  type CatalogModel,
  type EmbeddingInstallState,
} from "../../lib/models";
import { useAppStore } from "../../store";
import { API_BASE } from "../../lib/apiBase";
import { openExternalUrl } from "../../lib/externalLinks";

const API = API_BASE;

const SOURCES_HEALTH_CACHE_KEY = "atlas_sources_health_cache";

type SourcesHealthCache = {
  checkedAt: string;
  byId: Record<number, { health?: Source["health"]; health_message?: string }>;
};

function readSourcesHealthCache(): SourcesHealthCache | null {
  try {
    const raw = localStorage.getItem(SOURCES_HEALTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SourcesHealthCache;
    if (!parsed?.checkedAt || !parsed.byId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSourcesHealthCache(sources: Source[]) {
  const byId: SourcesHealthCache["byId"] = {};
  for (const s of sources) {
    byId[s.id] = { health: s.health, health_message: s.health_message };
  }
  localStorage.setItem(
    SOURCES_HEALTH_CACHE_KEY,
    JSON.stringify({ checkedAt: new Date().toISOString(), byId } satisfies SourcesHealthCache),
  );
}

function applyCachedHealth(sources: Source[], cache: SourcesHealthCache | null): Source[] {
  if (!cache) return sources;
  return sources.map((s) => {
    const h = cache.byId[s.id];
    if (!h) return s;
    return { ...s, health: h.health ?? s.health, health_message: h.health_message ?? s.health_message };
  });
}

function formatSourcesLastChecked(iso: string | null): string {
  if (!iso) return "Not checked yet";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "Not checked yet";
  }
}

function sourcesHealthSummary(sources: Source[], hasChecked: boolean): string {
  if (!hasChecked || sources.length === 0) return "";
  let healthy = 0;
  let warning = 0;
  let error = 0;
  let unknown = 0;
  for (const s of sources) {
    switch (s.health) {
      case "healthy":
        healthy += 1;
        break;
      case "warning":
        warning += 1;
        break;
      case "error":
        error += 1;
        break;
      default:
        unknown += 1;
    }
  }
  const parts: string[] = [];
  if (healthy) parts.push(`${healthy} connected`);
  if (warning) parts.push(`${warning} limited`);
  if (error) parts.push(`${error} unavailable`);
  if (unknown) parts.push(`${unknown} unknown`);
  return parts.join(", ");
}

const SOURCE_DOC_URLS: Record<string, string> = {
  openalex: "https://openalex.org",
  arxiv: "https://arxiv.org",
  pubmed: "https://pubmed.ncbi.nlm.nih.gov",
  crossref: "https://www.crossref.org",
  chemrxiv: "https://chemrxiv.org",
};

function sourceDisplayUrl(src: Source): string | null {
  if (src.url) return src.url;
  return SOURCE_DOC_URLS[src.type] ?? null;
}

function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}

function healthBadgeClass(health?: Source["health"]): string {
  switch (health) {
    case "healthy":
      return "source-health-healthy";
    case "warning":
      return "source-health-warning";
    case "error":
      return "source-health-error";
    default:
      return "source-health-unknown";
  }
}

/** User-facing connection status (API health is stored as healthy/warning/error). */
function healthStatusLabel(health?: Source["health"]): string {
  switch (health) {
    case "healthy":
      return "Connected";
    case "warning":
      return "Limited";
    case "error":
      return "Unavailable";
    default:
      return "Unknown";
  }
}

// ── TagInput ───────────────────────────────────────────────────────────────────

function TagInput({
  tags,
  onAdd,
  onRemove,
  placeholder,
  colorClass,
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder: string;
  colorClass: string;
}) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const t = input.trim();
    if (t && !tags.includes(t)) onAdd(t);
    setInput("");
  };

  return (
    <div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
        {tags.map((t) => (
          <span key={t} className={clsx("tag border text-sm", colorClass)}>
            {t}
            <button
              onClick={() => onRemove(t)}
              className="ml-1 opacity-70 hover:opacity-100 text-base leading-none"
            >
              ×
            </button>
          </span>
        ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
        />
        <button type="button" onClick={handleAdd} className="btn-secondary text-sm px-3">
          Add
        </button>
      </div>
    </div>
  );
}

// ── ProfileStrength ────────────────────────────────────────────────────────────

function ProfileStrength({ interests, keywords, domains, authors, journals }: {
  interests: string[];
  keywords: string[];
  domains: string[];
  authors: string[];
  journals: string[];
}) {
  const score = Math.min(
    100,
    interests.length * 10 +
      keywords.length * 8 +
      domains.length * 6 +
      authors.length * 4 +
      journals.length * 3
  );

  const label =
    score >= 80 ? "Excellent" :
    score >= 60 ? "Good" :
    score >= 40 ? "Fair" :
    "Getting started";

  const color =
    score >= 80 ? "bg-green-500 text-green-400" :
    score >= 60 ? "bg-primary-500 text-primary-400" :
    score >= 40 ? "bg-yellow-500 text-yellow-400" :
    "bg-red-500 text-red-400";

  const barColor =
    score >= 80 ? "bg-green-500" :
    score >= 60 ? "bg-primary-500" :
    score >= 40 ? "bg-yellow-500" :
    "bg-red-500";

  return (
    <div className="card border border-surface-border">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Info size={14} className="text-gray-500" />
          <span className="text-base font-medium text-gray-200">Profile Strength</span>
        </div>
        <span className={clsx("tag border text-xs font-bold", color.split(" ")[1], "bg-opacity-10 border-opacity-30")}>
          {label} — {score}%
        </span>
      </div>
      <div className="progress-bar mb-2">
        <div className={clsx("progress-fill", barColor)} style={{ width: `${score}%` }} />
      </div>
      <p className="text-sm text-gray-400">
        A richer profile leads to more accurate paper ranking. Add research interests, keywords, and domains.
      </p>
    </div>
  );
}

// Platform detection helper
function getPlatformInfo(systemStatus: { os?: string; os_version?: string } | null) {
  const os = systemStatus?.os || "";
  const isWindows = os === "Windows";
  const isMac = os === "Darwin";
  
  return {
    isWindows,
    isMac,
    platformName: isWindows ? "Windows" : isMac ? "Mac" : "system",
    pathExample: isWindows ? "C:\\Users\\you\\.ollama\\models" : "/Users/you/.ollama/models",
  };
}

function OllamaOsRequirementNotice() {
  const systemStatus = useAppStore((s) => s.systemStatus);
  const loadSystemStatus = useAppStore((s) => s.loadSystemStatus);

  useEffect(() => {
    loadSystemStatus();
  }, [loadSystemStatus]);

  if (systemStatus?.ollama_supported !== false) return null;

  const { isMac, platformName } = getPlatformInfo(systemStatus);

  return (
    <div className="callout-warning p-4 rounded-lg">
      <p className="callout-warning-title text-sm mb-1">
        {isMac ? "Ollama may not run on this Mac" : "Ollama may not run on this system"}
      </p>
      <p className="callout-warning-body">
        {isMac ? (
          <>
            Ollama officially requires <strong>macOS 14 (Sonoma)</strong> or newer. You are on{" "}
            {systemStatus.os_version || "an older version"}. Library, sources, and digests still work;
            chat and LLM summaries need a supported Mac, Windows 10/11, or an external Ollama install.
          </>
        ) : (
          <>
            Your {platformName} may not meet Ollama's requirements. You are on{" "}
            {systemStatus.os_version || "an unknown version"}. Library, sources, and digests still work;
            chat and LLM summaries need a supported Mac, Windows 10/11, or an external Ollama install.
          </>
        )}
      </p>
    </div>
  );
}

// ── Constants ──────────────────────────────────────────────────────────────────

const FONT_SIZE_OPTIONS: { id: FontSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium (default)" },
  { id: "large", label: "Large" },
  { id: "xlarge", label: "Extra large" },
];

const TABS = [
  { id: "resources", label: "Resources", icon: Globe },
  { id: "profile", label: "Research Profile", icon: User },
  { id: "components", label: "Components", icon: HardDrive },
  { id: "models", label: "AI Models", icon: Cpu },
  { id: "hardware", label: "Hardware", icon: Server },
  { id: "appearance", label: "Appearance", icon: Palette },
] as const;

type TabId = typeof TABS[number]["id"];

const LEGACY_TAB_IDS: Record<string, TabId> = {
  schedule: "resources",
  notifications: "resources",
  sources: "resources",
  library: "components",
};

function resolveTabId(tab: string | null): TabId | null {
  if (!tab) return null;
  const mapped = LEGACY_TAB_IDS[tab] ?? tab;
  return TAB_IDS.includes(mapped as TabId) ? (mapped as TabId) : null;
}

// ── Main Component ─────────────────────────────────────────────────────────────

const TAB_IDS = TABS.map((t) => t.id);

export default function Settings() {
  const loadSystemStatus = useAppStore((s) => s.loadSystemStatus);
  const systemStatus = useAppStore((s) => s.systemStatus);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabId>(
    resolveTabId(tabFromUrl) ?? "resources",
  );
  const { fontSize, setFontSize, theme, setTheme } = useAppearance();

  useEffect(() => {
    const resolved = resolveTabId(searchParams.get("tab"));
    if (resolved) setActiveTab(resolved);
  }, [searchParams]);

  const [scanSchedule, setScanSchedule] = useState<ScanSchedule>(loadScanSchedule);

  // Profile
  const [interests, setInterests] = useState(["enzyme catalysis", "DFT calculations", "active site engineering"]);
  const [keywords, setKeywords] = useState(["QM/MM", "cytochrome P450", "transition state", "ONIOM"]);
  const [domains, setDomains] = useState<string[]>([
    "Chemistry › Organic",
    "Biochemistry › Enzymology",
    "Interdisciplinary › Computational Chemistry",
  ]);
  const [authors, setAuthors] = useState(["Marie Curie", "Albert Einstein"]);
  const [journals, setJournals] = useState(["ACS Catalysis", "J. Am. Chem. Soc.", "Nature Chemistry"]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Notifications
  const [notifyMustRead, setNotifyMustRead] = useState(true);
  const [notifyDigest, setNotifyDigest] = useState(false);

  // Hardware
  const [hw, setHw] = useState<HardwareResponse | null>(null);
  const [alloc, setAlloc] = useState<ResourceAllocation | null>(null);
  const [hwLoading, setHwLoading] = useState(false);

  // Sources (API-backed)
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesRefreshing, setSourcesRefreshing] = useState(false);
  const [sourcesLastChecked, setSourcesLastChecked] = useState<string | null>(() =>
    readSourcesHealthCache()?.checkedAt ?? null,
  );
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [feedProbe, setFeedProbe] = useState<{ health: string; message: string } | null>(null);
  const [feedProbing, setFeedProbing] = useState(false);
  const [testingSourceId, setTestingSourceId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, string>>({});
  const [updatingSourceIds, setUpdatingSourceIds] = useState<Record<number, boolean>>({});
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const sourceUpdateSeqRef = useRef<Record<number, number>>({});

  // AI Models
  const [llmCatalog, setLlmCatalog] = useState<CatalogModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsLoadError, setModelsLoadError] = useState<string | null>(null);
  const [embeddingCatalog, setEmbeddingCatalog] = useState<CatalogModel[]>([]);
  const [ollamaAppInstalled, setOllamaAppInstalled] = useState(false);
  const [ollamaAppVersion, setOllamaAppVersion] = useState<string | null>(null);
  const [ollamaInstalled, setOllamaInstalled] = useState<{ name: string }[]>([]);
  const [embeddingInstalled, setEmbeddingInstalled] = useState<EmbeddingInstallState[]>([]);
  const [ollamaRunning, setOllamaRunning] = useState(false);
  const [modelPaths, setModelPaths] = useState<{
    ollama_models: string;
    ollama_runtime?: string;
    embedding_cache: string;
  } | null>(null);
  const [activeModel, setActiveModel] = useState<string>("");
  const [chatModel, setChatModel] = useState<string>("");
  const [modelInstalling, setModelInstalling] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<number>(0);
  const [modelInstallError, setModelInstallError] = useState<string | null>(null);
  const [modelInstallErrorTarget, setModelInstallErrorTarget] = useState<string | null>(null);
  const [runtimeStarting, setRuntimeStarting] = useState(false);
  const [ollamaModelsPath, setOllamaModelsPath] = useState("");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://127.0.0.1:11434");
  const [pathsSaving, setPathsSaving] = useState(false);
  const [pathsSaved, setPathsSaved] = useState(false);
  const [activeEmbedding, setActiveEmbedding] = useState("");
  const [embeddingStoragePath, setEmbeddingStoragePath] = useState("");

  // Library PDF storage
  const [pdfRoot, setPdfRoot] = useState("");
  const [mirrorFolders, setMirrorFolders] = useState(true);
  const [autoDownloadOnSave, setAutoDownloadOnSave] = useState(false);
  const [unpaywallEmail, setUnpaywallEmail] = useState("");

  // General save
  const [saved, setSaved] = useState(false);

  const loadHw = () => {
    setHwLoading(true);
    fetchHardware()
      .then((d) => {
        setHw(d);
        setAlloc(d.allocation);
        setHwLoading(false);
      })
      .catch(() => setHwLoading(false));
  };

  const loadSourcesList = () => {
    setSourcesLoading(true);
    setSourcesError(null);
    const cache = readSourcesHealthCache();
    fetchSources()
      .then((d) => {
        setSources(applyCachedHealth(d, cache));
        if (cache?.checkedAt) setSourcesLastChecked(cache.checkedAt);
        setSourcesLoading(false);
      })
      .catch(() => {
        setSourcesError("Could not load source settings. Check backend connection and retry.");
        setSourcesLoading(false);
      });
  };

  const refreshSourcesHealth = () => {
    setSourcesRefreshing(true);
    setSourcesError(null);
    fetchSources({ probe: true })
      .then((d) => {
        setSources(d);
        writeSourcesHealthCache(d);
        setSourcesLastChecked(new Date().toISOString());
        setSourcesRefreshing(false);
      })
      .catch(() => {
        setSourcesError("Could not refresh source status. Check backend connection and try again.");
        setSourcesRefreshing(false);
      });
  };

  const toggleSource = async (id: number, enabled: boolean) => {
    const previous = sources;
    const nextSeq = (sourceUpdateSeqRef.current[id] ?? 0) + 1;
    sourceUpdateSeqRef.current[id] = nextSeq;
    setSourcesError(null);
    setUpdatingSourceIds((prev) => ({ ...prev, [id]: true }));
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
    try {
      const updated = await apiUpdateSource(id, { enabled });
      if (sourceUpdateSeqRef.current[id] !== nextSeq) return;
      setSources((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                ...updated,
                // Keep latest cached/manual health display until user refreshes status.
                health: s.health,
                health_message: s.health_message,
              }
            : s,
        ),
      );
    } catch (e) {
      if (sourceUpdateSeqRef.current[id] !== nextSeq) return;
      setSources(previous);
      setSourcesError(
        e instanceof Error
          ? `Could not update source. ${e.message}`
          : "Could not update source. Please try again.",
      );
    } finally {
      if (sourceUpdateSeqRef.current[id] === nextSeq) {
        setUpdatingSourceIds((prev) => ({ ...prev, [id]: false }));
      }
    }
  };

  const deleteSource = async (id: number, name: string) => {
    if (!window.confirm(`Remove "${name}" from your sources?`)) return;
    setSources((prev) => prev.filter((s) => s.id !== id));
    try {
      await apiDeleteSource(id);
    } catch {
      loadSourcesList();
    }
  };

  const validateFeedUrl = async () => {
    const url = newSourceUrl.trim();
    if (!url) return;
    setFeedProbing(true);
    setFeedProbe(null);
    try {
      const r = await probeSourceUrl(url);
      setFeedProbe({
        health: r.health,
        message: r.health_message || r.error || (r.valid ? "Feed looks good" : "Invalid feed"),
      });
    } catch {
      setFeedProbe({ health: "error", message: "Could not validate feed — Research Atlas is offline" });
    } finally {
      setFeedProbing(false);
    }
  };

  const addSource = async () => {
    const name = newSourceName.trim();
    const url = newSourceUrl.trim();
    if (!name || !url) return;

    let probe = feedProbe;
    if (!probe || probe.health === "unknown") {
      setFeedProbing(true);
      try {
        const r = await probeSourceUrl(url);
        probe = {
          health: r.health,
          message: r.health_message || r.error || "",
        };
        setFeedProbe(probe);
      } catch {
        setFeedProbe({ health: "error", message: "Could not validate feed" });
        setFeedProbing(false);
        return;
      }
      setFeedProbing(false);
    }
    if (probe.health === "error") return;

    try {
      const s = await apiAddSource({ name, type: "rss", url, enabled: true });
      setSources((prev) => [...prev, s]);
      setNewSourceName("");
      setNewSourceUrl("");
      setFeedProbe(null);
    } catch {
      /* ignore */
    }
  };

  const runSourceTest = async (id: number) => {
    setTestingSourceId(id);
    setTestResults((prev) => ({ ...prev, [id]: "Testing…" }));
    try {
      const r = await testSourceById(id);
      const msg =
        r.papers_found != null
          ? `OK — ${r.papers_found} papers`
          : r.message || r.status || "Test complete";
      setTestResults((prev) => ({ ...prev, [id]: msg }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: "Test failed" }));
    } finally {
      setTestingSourceId(null);
    }
  };

  const loadModels = async () => {
    setModelsLoading(true);
    setModelsLoadError(null);
    try {
      const catalog = await fetchModelCatalog();
      setLlmCatalog((catalog.llm ?? []).sort((a, b) => a.size_gb - b.size_gb));
      setEmbeddingCatalog((catalog.embedding ?? []).sort((a, b) => a.size_gb - b.size_gb));
    } catch {
      setModelsLoadError("Could not load model catalog. Make sure Research Atlas is online.");
      setLlmCatalog([]);
      setEmbeddingCatalog([]);
    }
    try {
      const state = await fetchModelsState();
      const installed = state.installed;
      setOllamaAppInstalled(isOllamaAppInstalled(installed));
      setOllamaAppVersion(installed.runtime?.ollama?.version ?? null);
      setOllamaInstalled(installed.llm ?? []);
      setEmbeddingInstalled(installed.embedding ?? []);
      setOllamaRunning(state.readiness.ollama_running);
      setModelPaths({
        ollama_models: installed.paths.ollama_models,
        ollama_runtime: installed.paths.ollama_runtime,
        embedding_cache: installed.paths.embedding_cache,
      });
      if (!ollamaModelsPath && installed.paths.ollama_models) {
        setOllamaModelsPath(installed.paths.ollama_models);
      }
      setEmbeddingStoragePath(installed.paths.embedding_cache);
      setActiveModel(state.active.llm_model ?? "");
      setActiveEmbedding(state.active.embedding_model ?? "");
    } catch {
      /* installed status optional */
    }
    setModelsLoading(false);
    try {
      const cfg = await fetchSystemConfig();
      setOllamaModelsPath(cfg.ollama_models_path ?? "");
      setOllamaBaseUrl(cfg.ollama_base_url ?? "http://127.0.0.1:11434");
      setChatModel(cfg.chat_llm_model ?? "");
    } catch { /* ignore */ }
  };

  const saveModelPaths = async () => {
    setPathsSaving(true);
    try {
      await updateSystemConfig({
        ollama_models_path: ollamaModelsPath.trim(),
        ollama_base_url: ollamaBaseUrl.trim(),
      });
      setPathsSaved(true);
      setTimeout(() => setPathsSaved(false), 2500);
    } catch { /* ignore */ }
    setPathsSaving(false);
  };

  const showModelPath = async (path: string | undefined, targetId: string) => {
    if (!path) return;
    setModelInstallError(null);
    setModelInstallErrorTarget(null);
    try {
      await revealPath(path);
    } catch (e) {
      setModelInstallErrorTarget(targetId);
      setModelInstallError(e instanceof Error ? e.message : "Could not show this location.");
    }
  };

  const setActiveEmbeddingFn = async (modelId: string) => {
    setActiveEmbedding(modelId);
    setModelInstallError(null);
    setModelInstallErrorTarget(null);
    try {
      await fetch(`${API}/system/complete-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedding_model: modelId }),
      });
      await loadModels();
    } catch { /* ignore */ }
  };

  const installModel = async (modelId: string, role: "llm" | "embedding" | "runtime") => {
    if (modelInstalling) return;
    setModelInstalling(modelId);
    setModelProgress(5);
    setModelInstallError(null);
    setModelInstallErrorTarget(null);

    // Approximate progress only (real work is on the server). Slower for large embedding downloads.
    const step = role === "embedding" ? 1 : 2;
    const intervalMs = role === "embedding" ? 8000 : 2500;
    const progressTimer = window.setInterval(() => {
      setModelProgress((p) => (p < 88 ? p + step : p));
    }, intervalMs);

    try {
      const result = await installModelBlocking(modelId, role);
      if (result.ok) {
        setModelProgress(100);
        setModelInstallError(null);
        setModelInstallErrorTarget(null);
        await loadModels();
      } else {
        const msg = result.message ?? "Install failed";
        setModelInstallErrorTarget(modelId);
        setModelInstallError(
          role === "embedding"
            ? `${msg} You can tap Install again — partial files are cleared automatically.`
            : msg,
        );
      }
    } catch (e) {
      setModelInstallErrorTarget(modelId);
      setModelInstallError(e instanceof Error ? e.message : "Install failed");
    } finally {
      window.clearInterval(progressTimer);
      setModelInstalling(null);
      setModelProgress(0);
    }
  };

  const removeModel = async (modelId: string, role: "llm" | "embedding" | "runtime") => {
    const label =
      role === "runtime" ? "Ollama" : modelId;
    if (
      role === "runtime" &&
      !window.confirm(
        `Remove Ollama from this ${getPlatformInfo(systemStatus).platformName}? Language models will stop working until you install Ollama again.`,
      )
    ) {
      return;
    }
    setModelInstallError(null);
    setModelInstallErrorTarget(null);
    try {
      await deleteModel(modelId, role);
      await loadModels();
    } catch (e) {
      setModelInstallErrorTarget(modelId);
      setModelInstallError(
        e instanceof Error ? e.message : `Could not uninstall ${label}`,
      );
    }
  };

  const startRuntime = async () => {
    if (runtimeStarting) return;
    setRuntimeStarting(true);
    setModelInstallError(null);
    setModelInstallErrorTarget(null);
    try {
      const result = await startOllama();
      await loadModels();
      await loadSystemStatus();
      if (!result.running) {
        setModelInstallErrorTarget(DEFAULT_OLLAMA_RUNTIME.id);
        setModelInstallError(result.message ?? "Could not start Ollama.");
      }
    } catch (e) {
      setModelInstallErrorTarget(DEFAULT_OLLAMA_RUNTIME.id);
      setModelInstallError(e instanceof Error ? e.message : "Could not start Ollama.");
    } finally {
      setRuntimeStarting(false);
    }
  };

  const isEmbeddingInstalled = (modelId: string) =>
    embeddingInstalled.find((e) => e.id === modelId)?.installed ?? false;

  const setActiveModelFn = async (modelId: string) => {
    setActiveModel(modelId);
    setModelInstallError(null);
    setModelInstallErrorTarget(null);
    try {
      await fetch(`${API}/system/complete-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm_model: modelId }),
      });
      await loadSystemStatus();
    } catch { /* ignore */ }
  };

  const setChatModelFn = async (modelId: string) => {
    setChatModel(modelId);
    try {
      await updateSystemConfig({ chat_llm_model: modelId });
      await loadSystemStatus();
    } catch { /* ignore */ }
  };

  const setInactiveLlmFn = async (currentId: string) => {
    const other = llmCatalog.find(
      (m) => m.id !== currentId && isLlmInstalled(m.id, ollamaInstalled),
    );
    if (other) {
      await setActiveModelFn(other.id);
    } else {
      setModelInstallError("Install another language model first, then you can switch away from this one.");
      setModelInstallErrorTarget(currentId);
    }
  };

  const setInactiveEmbeddingFn = async (currentId: string) => {
    const other = embeddingCatalog.find(
      (m) => m.id !== currentId && isEmbeddingInstalled(m.id),
    );
    if (other) {
      await setActiveEmbeddingFn(other.id);
    } else {
      setModelInstallError("Install another embedding model first, then you can switch away from this one.");
      setModelInstallErrorTarget(currentId);
    }
  };

  const browseOllamaStorage = async () => {
    try {
      const path = await browseFolder();
      if (path) setOllamaModelsPath(path);
    } catch { /* ignore */ }
  };

  const browseEmbeddingStorage = async () => {
    try {
      const path = await browseFolder();
      if (path) setEmbeddingStoragePath(path);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (activeTab === "profile") {
      fetchProfile()
        .then((p) => {
          if (p.interests?.length) setInterests(p.interests);
          if (p.keywords?.length) setKeywords(p.keywords);
          if (p.domains?.length) setDomains(p.domains);
          if (p.authors_of_interest != null) setAuthors(p.authors_of_interest);
          if (p.journals_of_interest != null) setJournals(p.journals_of_interest);
        })
        .catch(() => {});
    }
    if (activeTab === "hardware") loadHw();
    if (activeTab === "resources") loadSourcesList();
    if (activeTab === "models") loadModels();
    if (activeTab === "components") {
      fetchLibraryPdfSettings()
        .then((s) => {
          setPdfRoot(s.pdf_root);
          setMirrorFolders(s.mirror_folders);
          setAutoDownloadOnSave(s.auto_download_on_save);
          setUnpaywallEmail(s.unpaywall_email);
        })
        .catch(() => {});
    }
  }, [activeTab]);

  const handleSave = async () => {
    saveScanSchedule(scanSchedule);
    if (activeTab === "components") {
      try {
        await updateLibraryPdfSettings({
          pdf_root: pdfRoot.trim(),
          mirror_folders: mirrorFolders,
          auto_download_on_save: autoDownloadOnSave,
          unpaywall_email: unpaywallEmail.trim(),
        });
      } catch {
        /* offline */
      }
    }
    if (activeTab === "hardware" && alloc) {
      try {
        const updated = await updateResourceAllocation(alloc);
        setHw(updated);
        setAlloc(updated.allocation);
      } catch {
        /* offline */
      }
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleProfileSave = async () => {
    const missing: string[] = [];
    if (!interests.length) missing.push("Research Interests");
    if (!keywords.length) missing.push("Technical Keywords");
    if (!domains.length) missing.push("Research Domains");
    if (missing.length) {
      setProfileError(`${missing.join(", ")} cannot be empty. They are required for paper filtering.`);
      return;
    }
    setProfileError(null);
    setProfileSaving(true);
    try {
      await updateProfile({
        interests,
        keywords,
        domains,
        authors_of_interest: authors,
        journals_of_interest: journals,
      });
    } catch {
      // Backend offline — still show saved in demo
    }
    setProfileSaving(false);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2500);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-surface-border bg-surface-raised px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Settings</h1>
        </div>
        {activeTab !== "profile" && (
          <button
            onClick={handleSave}
            className={clsx("btn-primary", saved && "bg-green-600 hover:bg-green-700")}
          >
            {saved ? <><Check size={15} /> Saved!</> : <><Save size={15} /> Save Settings</>}
          </button>
        )}
        {activeTab === "profile" && (
          <div className="flex items-center gap-3">
            {profileError && (
              <span className="text-xs text-red-400 max-w-sm">{profileError}</span>
            )}
            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className={clsx("btn-primary", profileSaved && "bg-green-600 hover:bg-green-700")}
            >
              {profileSaving ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
              ) : profileSaved ? (
                <><Check size={15} /> Saved!</>
              ) : (
                <><Save size={15} /> Save Profile</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-surface-border bg-surface-raised px-4 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === "resources") {
                  setSearchParams({});
                } else {
                  setSearchParams({ tab: tab.id });
                }
              }}
              className={clsx(
                "page-tab",
                activeTab === tab.id ? "page-tab-active" : "page-tab-inactive",
              )}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* ── Resources (notifications, schedule, sources) ── */}
        {activeTab === "resources" && (
          <div className="max-w-xl space-y-10">
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Bell size={15} className="text-primary-400" />
                <h2 className="text-sm font-semibold text-gray-200">Notifications</h2>
              </div>
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3 rounded-lg bg-surface-overlay border border-surface-border cursor-pointer">
                  <div>
                    <p className="text-sm text-gray-200">New Must Read papers found</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      You&apos;ll see a desktop notification when the daily scan finds papers matching your top research interests.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotifyMustRead(!notifyMustRead)}
                    className={clsx("relative rounded-full transition-colors flex-shrink-0 ml-4", notifyMustRead ? "bg-primary-500" : "bg-surface-border")}
                    style={{ width: 40, height: 22 }}
                  >
                    <div
                      className="absolute top-0.5 rounded-full bg-white shadow transition-transform"
                      style={{ width: 18, height: 18, transform: notifyMustRead ? "translateX(20px)" : "translateX(2px)" }}
                    />
                  </button>
                </label>
                <label className="flex items-center justify-between p-3 rounded-lg bg-surface-overlay border border-surface-border cursor-pointer">
                  <div>
                    <p className="text-sm text-gray-200">Daily digest ready</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      You&apos;ll receive a desktop notification when the daily digest has been generated. The digest summarizes all papers ranked for that day. Requires Research Atlas to be running (it does not need to be in the foreground).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotifyDigest(!notifyDigest)}
                    className={clsx("relative rounded-full transition-colors flex-shrink-0 ml-4", notifyDigest ? "bg-primary-500" : "bg-surface-border")}
                    style={{ width: 40, height: 22 }}
                  >
                    <div
                      className="absolute top-0.5 rounded-full bg-white shadow transition-transform"
                      style={{ width: 18, height: 18, transform: notifyDigest ? "translateX(20px)" : "translateX(2px)" }}
                    />
                  </button>
                </label>
              </div>
            </section>

            <section>
              <h2 className="text-base font-semibold text-gray-100 mb-1">Scan Schedule</h2>
              <p className="text-sm text-gray-400 mb-4">
                Set when Research Atlas fetches and ranks new papers.
              </p>
              <ScheduleEditor value={scanSchedule} onChange={setScanSchedule} />
            </section>

            <section>
              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <div className="flex items-center gap-2">
                  <Globe size={15} className="text-primary-400" />
                  <h2 className="text-sm font-semibold text-gray-200">Paper Sources</h2>
                </div>
                <button
                  type="button"
                  onClick={refreshSourcesHealth}
                  disabled={sourcesRefreshing || sourcesLoading}
                  className="btn-secondary text-xs py-1.5 px-2.5"
                  title="Test connections to all sources (manual only)"
                >
                  <RefreshCw size={12} className={clsx(sourcesRefreshing && "animate-spin")} />
                  Refresh status
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Last checked:{" "}
                <span className="text-gray-400">{formatSourcesLastChecked(sourcesLastChecked)}</span>
                {sourcesLastChecked && sources.length > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="text-gray-400">
                      {sourcesHealthSummary(sources, Boolean(sourcesLastChecked))}
                    </span>
                  </>
                )}
                {!sourcesLastChecked && (
                  <span className="text-gray-500">
                    {" "}
                    — use Refresh status to test feeds (not run automatically).
                  </span>
                )}
              </p>
              {sourcesError && (
                <p className="text-xs text-red-400 mb-3">{sourcesError}</p>
              )}

              {sourcesLoading && sources.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {!sourcesLoading && sources.length === 0 && (
                <p className="text-sm text-gray-500 py-4 text-center">No sources found. Make sure Research Atlas is online.</p>
              )}

              {sources.length > 0 && (
                <div className="space-y-2">
                  {sources.map((src) => {
                    const displayUrl = sourceDisplayUrl(src);
                    const health = src.health ?? "unknown";
                    return (
                    <div
                      key={src.id}
                      className="p-3 rounded-lg bg-surface-overlay border border-surface-border"
                    >
                      <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 min-w-0">
                          <span className="text-sm text-gray-200 font-medium truncate">{src.name}</span>
                          <span
                            className={clsx(
                              "source-status-badge tag border text-xs flex-shrink-0",
                              healthBadgeClass(health)
                            )}
                            title={src.health_message || undefined}
                          >
                            {healthStatusLabel(health)}
                          </span>
                        </div>
                        {displayUrl && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500 font-mono min-w-0">
                            <span className="truncate" title={displayUrl}>{truncateUrl(displayUrl)}</span>
                            <button
                              type="button"
                              onClick={() => void openExternalUrl(displayUrl)}
                              className="text-gray-500 hover:text-primary-400 flex-shrink-0"
                              title="Open in browser"
                            >
                              <ExternalLink size={11} />
                            </button>
                          </div>
                        )}
                        {src.health_message && health !== "healthy" && (
                          <p className="text-xs text-gray-500 mt-1 flex items-start gap-1">
                            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
                            <span>{src.health_message}</span>
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                          <span>{src.paper_count} papers</span>
                          {src.last_fetched ? (
                            <span>Last: {new Date(src.last_fetched).toLocaleDateString()}</span>
                          ) : (
                            <span>Never fetched</span>
                          )}
                        </div>
                        {testResults[src.id] && (
                          <p className="text-xs text-primary-400 mt-1">{testResults[src.id]}</p>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleSource(src.id, !src.enabled)}
                            disabled={Boolean(updatingSourceIds[src.id])}
                            className={clsx(
                              "relative rounded-full transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                              src.enabled ? "bg-primary-500" : "bg-surface-border"
                            )}
                            style={{ width: 40, height: 22 }}
                            title={
                              updatingSourceIds[src.id]
                                ? "Saving..."
                                : src.enabled
                                  ? "Disable source"
                                  : "Enable source"
                            }
                          >
                            <div
                              className="absolute top-0.5 rounded-full bg-white shadow transition-transform"
                              style={{
                                width: 18,
                                height: 18,
                                transform: src.enabled ? "translateX(20px)" : "translateX(2px)",
                              }}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSource(src.id, src.name)}
                            title="Remove source"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => runSourceTest(src.id)}
                          disabled={testingSourceId === src.id}
                          className="source-test-btn text-xs py-1 px-2.5 rounded-md border transition-colors disabled:opacity-50"
                          title="Run a quick fetch to verify this source"
                        >
                          {testingSourceId === src.id ? (
                            <span className="inline-flex items-center gap-1">
                              <Loader2 size={12} className="animate-spin" />
                              Testing…
                            </span>
                          ) : (
                            "Test fetch"
                          )}
                        </button>
                      </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3">
                <Plus size={14} className="text-primary-400" />
                <h2 className="text-sm font-semibold text-gray-200">Add RSS Feed</h2>
              </div>
              <div className="space-y-2">
                <input
                  className="input w-full"
                  placeholder="Feed name (e.g. Nature Chemistry)"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                />
                <input
                  className="input w-full font-mono text-xs"
                  placeholder="Feed URL (e.g. https://...)"
                  value={newSourceUrl}
                  onChange={(e) => {
                    setNewSourceUrl(e.target.value);
                    setFeedProbe(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addSource();
                  }}
                />
                {feedProbe && (
                  <p
                    className={clsx(
                      "text-xs flex items-start gap-1.5 px-2 py-1.5 rounded border",
                      healthBadgeClass(feedProbe.health as Source["health"])
                    )}
                  >
                    <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="font-medium">
                        {healthStatusLabel(feedProbe.health as Source["health"])}:
                      </span>{" "}
                      {feedProbe.message}
                    </span>
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={validateFeedUrl}
                    disabled={!newSourceUrl.trim() || feedProbing}
                    className="btn-secondary flex-1 justify-center disabled:opacity-40"
                  >
                    {feedProbing ? (
                      <>
                        <Loader2 size={13} className="animate-spin" /> Validating…
                      </>
                    ) : (
                      "Validate feed"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={addSource}
                    disabled={
                      !newSourceName.trim() ||
                      !newSourceUrl.trim() ||
                      feedProbing ||
                      feedProbe?.health === "error"
                    }
                    className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus size={13} /> Add Source
                  </button>
                </div>
              </div>
            </section>

          </div>
        )}

        {/* ── Research Profile ── */}
        {activeTab === "profile" && (
          <div className="max-w-2xl space-y-8">
            <ProfileStrength
              interests={interests}
              keywords={keywords}
              domains={domains}
              authors={authors}
              journals={journals}
            />

            <section>
              <h2 className="text-base font-semibold text-gray-100 mb-1">Research Interests</h2>
              <p className="text-sm text-gray-400 mb-3">
                Broad research topics you work on (e.g., enzyme catalysis, machine learning for chemistry).
              </p>
              <TagInput
                tags={interests}
                onAdd={(t) => setInterests([...interests, t])}
                onRemove={(t) => setInterests(interests.filter((x) => x !== t))}
                placeholder="e.g. enzyme catalysis"
                colorClass="bg-primary-500/20 text-primary-300 border-primary-500/30"
              />
            </section>

            <section>
              <h2 className="text-base font-semibold text-gray-100 mb-1">Technical Keywords</h2>
              <p className="text-sm text-gray-400 mb-3">
                Specific methods, molecules, or terms you want to track (e.g., QM/MM, SPECTER).
              </p>
              <TagInput
                tags={keywords}
                onAdd={(t) => setKeywords([...keywords, t])}
                onRemove={(t) => setKeywords(keywords.filter((x) => x !== t))}
                placeholder="e.g. QM/MM"
                colorClass="bg-accent-500/20 text-accent-500 border-accent-500/30"
              />
            </section>

            <section>
              <h2 className="text-base font-semibold text-gray-100 mb-1">Research Domains</h2>
              <p className="text-sm text-gray-400 mb-3">
                Expand a field and click a specialty to add it. Click × on a tag to remove.
              </p>
              <DomainPicker selected={domains} onChange={setDomains} />
            </section>

            <section>
              <h2 className="text-base font-semibold text-gray-100 mb-1">Authors of Interest</h2>
              <p className="text-sm text-gray-400 mb-3">Papers from these authors will always rank higher.</p>
              <TagInput
                tags={authors}
                onAdd={(t) => setAuthors([...authors, t])}
                onRemove={(t) => setAuthors(authors.filter((x) => x !== t))}
                placeholder="e.g. Marie Curie"
                colorClass="tag-orange"
              />
            </section>

            <section>
              <h2 className="text-base font-semibold text-gray-100 mb-1">Journals of Interest</h2>
              <p className="text-sm text-gray-400 mb-3">Papers from these journals receive a relevance boost.</p>
              <TagInput
                tags={journals}
                onAdd={(t) => setJournals([...journals, t])}
                onRemove={(t) => setJournals(journals.filter((x) => x !== t))}
                placeholder="e.g. ACS Catalysis"
                colorClass="bg-green-500/20 text-green-300 border-green-500/30"
              />
            </section>
          </div>
        )}

        {/* ── AI Models ── */}
        {activeTab === "models" && (
          <div className="max-w-2xl space-y-8">
            <OllamaOsRequirementNotice />

            <section className="card-overlay text-sm text-gray-400 space-y-1">
              <p className="font-semibold text-gray-400">Research Atlas v0.1.0</p>
              <p>Private AI literature monitoring for researchers.</p>
              <p>
                All AI processing happens locally on your machine. Research Atlas has no affiliation
                with Ollama, Hugging Face, or any model provider.
              </p>
            </section>

            <section className="card">
              <h2 className="text-base font-semibold text-gray-100 mb-1">Ollama connection</h2>
              <p className="text-sm text-gray-400 mb-4">
                How Research Atlas finds Ollama on your {getPlatformInfo(systemStatus).platformName}. Applies to all language models below.
                Click <span className="text-gray-300">Save connection</span> after you change anything.
              </p>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs text-gray-500 mb-1 block">Models folder path</span>
                  <p className="text-[11px] text-gray-600 mb-1">
                    Folder where Ollama keeps downloaded LLM files (the app sets <span className="font-mono code-inline">OLLAMA_MODELS</span> from this).
                  </p>
                  <div className="flex gap-2">
                    <input
                      className="input font-mono text-sm flex-1"
                      placeholder={`e.g. ${getPlatformInfo(systemStatus).pathExample}`}
                      value={ollamaModelsPath}
                      onChange={(e) => setOllamaModelsPath(e.target.value)}
                    />
                    <button type="button" onClick={browseOllamaStorage} className="btn-secondary text-sm px-3 shrink-0">
                      Browse…
                    </button>
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500 mb-1 block">Ollama API URL</span>
                  <p className="text-[11px] text-gray-600 mb-1">
                    Address of the running Ollama service (almost always <span className="font-mono">127.0.0.1:11434</span>).
                  </p>
                  <input
                    className="input font-mono text-sm"
                    placeholder="http://127.0.0.1:11434"
                    value={ollamaBaseUrl}
                    onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={saveModelPaths}
                  disabled={pathsSaving}
                  className="btn-primary text-sm"
                >
                  {pathsSaving ? "Saving…" : pathsSaved ? "Saved" : "Save connection"}
                </button>
              </div>
            </section>

            <section className="models-section models-section-runtime">
              <div className="flex items-center gap-2 mb-1">
                <Monitor size={16} className="icon-runtime" />
                <h2 className="text-sm font-semibold text-fg">Ollama runtime</h2>
                <span className="tag border text-[10px] tag-runtime">Step 1</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Install the Ollama app before downloading language models below.
              </p>
              <ModelInstallPanel
                key={DEFAULT_OLLAMA_RUNTIME.id}
                model={DEFAULT_OLLAMA_RUNTIME}
                role="runtime"
                isInstalled={ollamaAppInstalled}
                isActive={false}
                isInstalling={modelInstalling === DEFAULT_OLLAMA_RUNTIME.id}
                isStartingRuntime={runtimeStarting}
                progress={modelProgress}
                installError={
                  modelInstalling === DEFAULT_OLLAMA_RUNTIME.id ||
                  modelInstallErrorTarget === DEFAULT_OLLAMA_RUNTIME.id
                    ? modelInstallError
                    : null
                }
                serviceRunning={ollamaRunning}
                runtimeVersion={ollamaAppVersion}
                onInstall={() => void installModel(DEFAULT_OLLAMA_RUNTIME.id, "runtime")}
                onStartRuntime={() => void startRuntime()}
                onRemove={() => removeModel(DEFAULT_OLLAMA_RUNTIME.id, "runtime")}
                onRevealStorage={
                  modelPaths?.ollama_runtime || DEFAULT_OLLAMA_RUNTIME.storage_path
                    ? () =>
                        void showModelPath(
                          modelPaths?.ollama_runtime || DEFAULT_OLLAMA_RUNTIME.storage_path,
                          DEFAULT_OLLAMA_RUNTIME.id,
                        )
                    : undefined
                }
              />
            </section>

            {ollamaAppInstalled && !ollamaRunning && (
              <div className="ollama-warning p-3 rounded-lg border text-xs">
                Ollama is installed but not running. Open the Ollama app, then install a language model
                in Step 2.
              </div>
            )}

            <section className="models-section">
              <div className="flex items-center gap-2 mb-1">
                <Cpu size={15} className="text-primary-400" />
                <h2 className="text-sm font-semibold text-gray-200">Language Models</h2>
                <span className="tag border text-[10px] tag-primary">Step 2</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Pull a model after Ollama is installed and running.
              </p>
              {modelsLoadError && (
                <p className="text-xs text-red-400 mb-3">{modelsLoadError}</p>
              )}
              {modelsLoading && llmCatalog.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-4">Loading model catalog…</p>
              )}
              <div className="space-y-3">
                {llmCatalog.map((model) => (
                  <ModelInstallPanel
                    key={model.id}
                    model={model}
                    role="llm"
                    isInstalled={isLlmInstalled(model.id, ollamaInstalled)}
                    isActive={activeModel === model.id}
                    isActiveFilter={activeModel === model.id}
                    isActiveChat={(chatModel || activeModel) === model.id}
                    isInstalling={modelInstalling === model.id}
                    progress={modelProgress}
                    installError={
                      modelInstalling === model.id || modelInstallErrorTarget === model.id
                        ? modelInstallError
                        : null
                    }
                    ollamaRunning={ollamaRunning}
                    ollamaAppInstalled={ollamaAppInstalled}
                    storagePath={ollamaModelsPath}
                    onStoragePathChange={setOllamaModelsPath}
                    onBrowseStorage={browseOllamaStorage}
                    onInstall={() => void installModel(model.id, "llm")}
                    onRemove={() => removeModel(model.id, "llm")}
                    onSetActive={() => setActiveModelFn(model.id)}
                    onSetInactive={() => setInactiveLlmFn(model.id)}
                    onSetActiveFilter={() => setActiveModelFn(model.id)}
                    onSetActiveChat={() => setChatModelFn(model.id)}
                    onRevealStorage={() =>
                      void showModelPath(ollamaModelsPath || modelPaths?.ollama_models, model.id)
                    }
                  />
                ))}
              </div>
            </section>

            <section className="models-section">
              <div className="flex items-center gap-2 mb-1">
                <Server size={15} className="text-primary-400" />
                <h2 className="text-sm font-semibold text-gray-200">Embedding Models</h2>
                <span className="tag border text-[10px] tag-primary">Step 3</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Used for paper similarity and library search — independent of chat LLMs.
              </p>
              <div className="space-y-3">
                {embeddingCatalog.map((model) => (
                  <ModelInstallPanel
                    key={model.id}
                    model={model}
                    role="embedding"
                    isInstalled={isEmbeddingInstalled(model.id)}
                    isActive={activeEmbedding === model.id}
                    isInstalling={modelInstalling === model.id}
                    progress={modelProgress}
                    installError={
                      modelInstalling === model.id || modelInstallErrorTarget === model.id
                        ? modelInstallError
                        : null
                    }
                    storagePath={embeddingStoragePath}
                    onStoragePathChange={setEmbeddingStoragePath}
                    onBrowseStorage={browseEmbeddingStorage}
                    onInstall={() => void installModel(model.id, "embedding")}
                    onRemove={() => removeModel(model.id, "embedding")}
                    onSetActive={() => setActiveEmbeddingFn(model.id)}
                    onSetInactive={() => setInactiveEmbeddingFn(model.id)}
                    onRevealStorage={() =>
                      void showModelPath(
                        embeddingStoragePath || modelPaths?.embedding_cache,
                        model.id,
                      )
                    }
                  />
                ))}
              </div>
            </section>

          </div>
        )}

        {/* ── Hardware ── */}
        {activeTab === "hardware" && (
          <div className="max-w-xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Server size={15} className="text-primary-400" />
                  <h2 className="text-base font-semibold text-gray-100">Hardware</h2>
                </div>
                <p className="text-sm text-gray-400">
                  Detected system capacity and how much you allocate to Research Atlas.
                </p>
              </div>
              <button
                type="button"
                onClick={loadHw}
                disabled={hwLoading}
                className="btn-secondary text-xs flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw size={12} className={clsx(hwLoading && "animate-spin")} />
                Refresh
              </button>
            </div>
            <HardwareSettingsPanel
              hw={hw}
              alloc={alloc}
              loading={hwLoading}
              onAllocChange={setAlloc}
            />
          </div>
        )}


        {/* ── Components (library & data paths) ── */}
        {activeTab === "components" && (
          <div className="max-w-2xl space-y-10">
            <section>
              <h2 className="text-base font-semibold text-gray-100 mb-1">Local PDF library</h2>
              <p className="text-sm text-gray-400 mb-4">
                Download open-access PDFs to your computer. With mirror folders enabled, each in-app library folder gets a matching subfolder on disk. Papers in multiple folders are stored once in a single host folder.
              </p>
              <div className="space-y-4">
                <div>
                  <span className="text-xs text-gray-500 mb-1 block">Library folder on disk</span>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 font-mono text-sm"
                      value={pdfRoot}
                      onChange={(e) => setPdfRoot(e.target.value)}
                      placeholder="~/Documents/Research Atlas Library"
                    />
                    <button
                      type="button"
                      className="btn-secondary text-sm shrink-0"
                      onClick={async () => {
                        const path = await browseFolder();
                        if (path) setPdfRoot(path);
                      }}
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-sm shrink-0"
                      onClick={() => pdfRoot.trim() && openPdfLibraryRoot(pdfRoot)}
                      disabled={!pdfRoot.trim()}
                    >
                      Open folder
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-sm shrink-0"
                      onClick={() => syncLibraryPdfFolders().catch(() => {})}
                    >
                      Sync folders
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    PDFs from Daily Digest and Library use this root. Sync folders creates subfolders for each in-app library folder. Save settings to apply path changes.
                  </p>
                </div>

                <label className="flex items-center justify-between gap-4 py-2">
                  <span className="text-sm text-gray-300">Mirror library folders on disk</span>
                  <input
                    type="checkbox"
                    checked={mirrorFolders}
                    onChange={(e) => setMirrorFolders(e.target.checked)}
                    className="rounded border-surface-border"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 py-2">
                  <span className="text-sm text-gray-300">Auto-download PDF when saving to library</span>
                  <input
                    type="checkbox"
                    checked={autoDownloadOnSave}
                    onChange={(e) => setAutoDownloadOnSave(e.target.checked)}
                    className="rounded border-surface-border"
                  />
                </label>

                <div>
                  <span className="text-xs text-gray-500 mb-1 block">Unpaywall email (for DOI → open PDF)</span>
                  <input
                    className="input w-full text-sm"
                    value={unpaywallEmail}
                    onChange={(e) => setUnpaywallEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                  <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                    Optional. When you save or download a paper, Research Atlas first tries the source
                    (arXiv, ChemRxiv, etc.). If no direct PDF is available, it can ask{" "}
                    <button
                      type="button"
                      onClick={() => void openExternalUrl("https://unpaywall.org/products/api")}
                      className="text-primary-400 hover:underline"
                    >
                      Unpaywall
                    </button>{" "}
                    to find a legal open-access copy from the paper&apos;s DOI. Unpaywall requires a
                    contact email on API requests so they can reach you about heavy use — this is not
                    a login or account. Use an address you check; leave blank to use a generic
                    placeholder (may work, but a real email is preferred).
                  </p>
                </div>
              </div>
            </section>

            <ComponentsPanel />
          </div>
        )}

        {/* ── Appearance ── */}
        {activeTab === "appearance" && (
          <div className="max-w-lg space-y-6">
            <section>
              <h2 className="text-base font-semibold text-gray-100 mb-1">Text size</h2>
              <p className="text-sm text-gray-400 mb-4">
                Adjust interface font size across the app. Helpful if menus or labels feel too small.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {FONT_SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFontSize(opt.id)}
                    className={clsx(
                      "py-3 px-3 rounded-lg border text-sm font-medium transition-colors",
                      fontSize === opt.id
                        ? "border-primary-500 bg-primary-500/10 text-primary-200"
                        : "border-surface-border bg-surface-overlay text-gray-300 hover:border-primary-500/30",
                    )}
                  >
                    <Type size={14} className="inline mr-1.5 opacity-70" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-base font-semibold text-gray-100 mb-1">Theme</h2>
              <p className="text-sm text-gray-400 mb-4">Choose a color theme for the interface.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTheme(opt.id)}
                    className={clsx(
                      "py-3 rounded-lg border text-sm font-medium transition-colors",
                      theme === opt.id
                        ? "border-primary-500 bg-primary-500/10 text-primary-200"
                        : "border-surface-border bg-surface-overlay text-gray-300 hover:border-primary-500/30",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

      </div>
    </div>
  );
}
