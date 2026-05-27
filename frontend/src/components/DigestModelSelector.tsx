import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cpu, Loader2, Check, AlertCircle } from "lucide-react";
import clsx from "clsx";
import {
  fetchSystemConfig,
  updateSystemConfig,
  type SystemConfig,
} from "../api/client";
import { fetchModelCatalog, fetchModelsState, invalidateModelsStateCache } from "../lib/models";
const SETTINGS_MODELS_PATH = "/settings?tab=models";
const MODELS_TTL_MS = 60_000;
const LOAD_RETRY_MS = 4_000;

interface CatalogModel {
  id: string;
  name: string;
  role?: string;
}

interface DigestModelSelectorProps {
  onModelsChange?: (llm: string, embedding: string) => void;
  compact?: boolean;
  stackedCompact?: boolean;
  context?: "digest" | "chat";
}

interface SelectorLoadSnapshot {
  config: SystemConfig;
  llmOptions: CatalogModel[];
  embOptions: CatalogModel[];
  installed: string[];
  embeddingsInstalled: string[];
  llmReady: boolean;
  embeddingReady: boolean;
  loadError: boolean;
}

let selectorSnapshot: { at: number; data: SelectorLoadSnapshot } | null = null;
let selectorInflight: Promise<SelectorLoadSnapshot> | null = null;

function ModelStatusLink({
  installed,
  compact,
}: {
  installed: boolean;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const text = installed ? "Installed" : "Not Installed";

  return (
    <button
      type="button"
      onClick={() => navigate(SETTINGS_MODELS_PATH)}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border font-medium shrink-0 transition-colors hover:opacity-90",
        installed ? "model-status-installed" : "model-status-missing",
        compact ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
      )}
      title={`${text} — open AI Models in Settings`}
    >
      {installed ? (
        <Check size={compact ? 10 : 11} className="shrink-0" />
      ) : (
        <AlertCircle size={compact ? 10 : 11} className="shrink-0" />
      )}
      {text}
    </button>
  );
}

function ModelRow({
  label,
  value,
  options,
  installed,
  disabled,
  compact,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  installed: boolean;
  disabled?: boolean;
  compact?: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={clsx("text-gray-500 shrink-0", compact ? "text-xs" : "text-sm")}>{label}</span>
      <select
        className={clsx("input py-1.5 min-w-0", compact ? "text-xs w-[148px]" : "w-[180px]")}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ModelStatusLink installed={installed} compact={compact} />
    </div>
  );
}

export function DigestModelSelector({ onModelsChange, compact, stackedCompact, context = "digest" }: DigestModelSelectorProps) {
  const initialSnapshot = selectorSnapshot?.data ?? null;
  const [config, setConfig] = useState<SystemConfig | null>(initialSnapshot?.config ?? null);
  const [llmOptions, setLlmOptions] = useState<CatalogModel[]>(initialSnapshot?.llmOptions ?? []);
  const [embOptions, setEmbOptions] = useState<CatalogModel[]>(initialSnapshot?.embOptions ?? []);
  const [installed, setInstalled] = useState<string[]>(initialSnapshot?.installed ?? []);
  const [embeddingsInstalled, setEmbeddingsInstalled] = useState<string[]>(
    initialSnapshot?.embeddingsInstalled ?? [],
  );
  const [loading, setLoading] = useState(!initialSnapshot);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(Boolean(initialSnapshot?.loadError));
  const [thresholdPct, setThresholdPct] = useState<number>(
    Math.round((initialSnapshot?.config?.must_read_threshold ?? 0.68) * 100),
  );
  const [llmInstalled, setLlmInstalled] = useState(
    Boolean(
      initialSnapshot?.config?.llm_model &&
        initialSnapshot.installed.some((name) => name === initialSnapshot.config.llm_model),
    ),
  );
  const [embInstalled, setEmbInstalled] = useState(
    Boolean(
      initialSnapshot?.config?.embedding_model &&
        initialSnapshot.embeddingsInstalled.includes(initialSnapshot.config.embedding_model),
    ),
  );
  const [chatLlmInstalled, setChatLlmInstalled] = useState(
    Boolean(
      initialSnapshot?.config?.chat_llm_model &&
        initialSnapshot.installed.some((name) => name === initialSnapshot.config.chat_llm_model),
    ),
  );

  const llmIsInstalled = useCallback((modelId: string, names: string[]) => {
    const base = modelId.split(":")[0];
    return names.some((name) => name === modelId || name === base || name.startsWith(`${base}:`));
  }, []);

  const onModelsChangeRef = useRef(onModelsChange);
  useEffect(() => {
    onModelsChangeRef.current = onModelsChange;
  }, [onModelsChange]);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const now = Date.now();
      const useCached =
        selectorSnapshot &&
        !selectorSnapshot.data.loadError &&
        now - selectorSnapshot.at < MODELS_TTL_MS;
      const data = useCached && selectorSnapshot
        ? selectorSnapshot.data
        : await (selectorInflight ??
            (selectorInflight = (async (): Promise<SelectorLoadSnapshot> => {
              const [catalogResult, stateResult, configResult] = await Promise.allSettled([
                fetchModelCatalog(),
                fetchModelsState(),
                fetchSystemConfig(),
              ]);

              let cfg: SystemConfig = {
                llm_model: "",
                chat_llm_model: "",
                embedding_model: "allenai/specter2_base",
                ollama_base_url: "http://127.0.0.1:11434",
                ollama_models_path: "",
                must_read_threshold: 0.68,
              };
              let hadLoadError = false;
              const previousSnapshot = selectorSnapshot?.data;
              if (configResult.status === "fulfilled") {
                cfg.must_read_threshold = configResult.value.must_read_threshold ?? 0.68;
                cfg.ollama_base_url = configResult.value.ollama_base_url || cfg.ollama_base_url;
                cfg.ollama_models_path = configResult.value.ollama_models_path || cfg.ollama_models_path;
                cfg.chat_llm_model = configResult.value.chat_llm_model || "";
              }
              if (stateResult.status === "fulfilled") {
                cfg.llm_model = stateResult.value.active.llm_model || "";
                cfg.embedding_model = stateResult.value.active.embedding_model || cfg.embedding_model;
              } else {
                hadLoadError = !previousSnapshot;
                if (previousSnapshot?.config) {
                  cfg = previousSnapshot.config;
                } else if (config) {
                  cfg = config;
                }
              }

              const catalog =
                catalogResult.status === "fulfilled"
                  ? ({ llm: catalogResult.value.llm, embedding: catalogResult.value.embedding } as {
                      llm?: CatalogModel[];
                      embedding?: CatalogModel[];
                    })
                  : { llm: [], embedding: [] };
              const llmNames =
                stateResult.status === "fulfilled"
                  ? (stateResult.value.installed.llm ?? []).map((m) => m.name ?? "")
                  : (previousSnapshot?.installed ?? installed);
              const embInstalled =
                stateResult.status === "fulfilled"
                  ? (stateResult.value.installed.embedding ?? [])
                      .filter((m) => m.installed)
                      .map((m) => m.id)
                  : (previousSnapshot?.embeddingsInstalled ?? embeddingsInstalled);
              const fallbackLlmReady = previousSnapshot
                ? previousSnapshot.llmReady
                : llmIsInstalled(cfg.llm_model, llmNames.filter(Boolean));
              const fallbackEmbeddingReady = previousSnapshot
                ? previousSnapshot.embeddingReady
                : embInstalled.includes(cfg.embedding_model);
              const snapshot: SelectorLoadSnapshot = {
                config: cfg,
                llmOptions: catalog.llm ?? [],
                embOptions: catalog.embedding ?? [],
                installed: llmNames.filter(Boolean),
                embeddingsInstalled: embInstalled,
                llmReady:
                  stateResult.status === "fulfilled"
                    ? Boolean(stateResult.value.readiness.llm.ready)
                    : fallbackLlmReady,
                embeddingReady:
                  stateResult.status === "fulfilled"
                    ? Boolean(stateResult.value.readiness.embedding.ready)
                    : fallbackEmbeddingReady,
                loadError: hadLoadError,
              };
              selectorSnapshot = { at: Date.now(), data: snapshot };
              return snapshot;
            })().finally(() => {
              selectorInflight = null;
            })));

      setConfig(data.config);
      setInstalled(data.installed);
      setEmbeddingsInstalled(data.embeddingsInstalled);
      setLlmOptions(data.llmOptions);
      setEmbOptions(data.embOptions);
      setLoadError(data.loadError);
      setLlmInstalled(Boolean(data.llmReady));
      setEmbInstalled(Boolean(data.embeddingReady));
      setChatLlmInstalled(Boolean(
        data.config.chat_llm_model
          ? llmIsInstalled(data.config.chat_llm_model, data.installed)
          : data.llmReady,
      ));
      setThresholdPct(Math.round((data.config.must_read_threshold ?? 0.68) * 100));
      onModelsChangeRef.current?.(data.config.llm_model, data.config.embedding_model);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [config, embeddingsInstalled, installed, llmInstalled, llmIsInstalled]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loadError) return;
    const timer = window.setTimeout(() => {
      void load();
    }, LOAD_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [loadError, load]);

  const apply = async (patch: Partial<SystemConfig>) => {
    setSaving(true);
    try {
      invalidateModelsStateCache();
      const next = await updateSystemConfig(patch);
      setConfig(next);
      if (typeof next.must_read_threshold === "number") {
        setThresholdPct(Math.round(next.must_read_threshold * 100));
      }
      onModelsChangeRef.current?.(next.llm_model, next.embedding_model);
      if (typeof patch.llm_model === "string") {
        setLlmInstalled(llmIsInstalled(patch.llm_model, installed));
      }
      if (typeof patch.chat_llm_model === "string") {
        setChatLlmInstalled(llmIsInstalled(patch.chat_llm_model, installed));
      }
      if (typeof patch.embedding_model === "string") {
        setEmbInstalled(embeddingsInstalled.includes(patch.embedding_model));
      }
      selectorSnapshot = null;
    } catch {
      /* offline */
    } finally {
      setSaving(false);
    }
  };

  const llmSelectOptions = () => {
    const ids = new Set<string>();
    const opts: { id: string; label: string }[] = [];
    for (const m of llmOptions) {
      if (!ids.has(m.id) && llmIsInstalled(m.id, installed)) {
        ids.add(m.id);
        opts.push({ id: m.id, label: m.name });
      }
    }
    for (const name of installed) {
      if (!ids.has(name) && !llmOptions.some((c) => name.startsWith(c.id.split(":")[0]))) {
        opts.push({ id: name, label: name });
        ids.add(name);
      }
    }
    if (config?.llm_model && !ids.has(config.llm_model)) {
      opts.unshift({ id: config.llm_model, label: config.llm_model });
    }
    const chatId = config?.chat_llm_model;
    if (chatId && !ids.has(chatId)) {
      opts.push({ id: chatId, label: chatId });
    }
    if (opts.length === 0) {
      opts.push({ id: "", label: "No models installed — visit AI Models in Settings" });
    }
    return opts;
  };

  const embSelectOptions = () => {
    const ids = new Set<string>();
    const opts: { id: string; label: string }[] = [];
    for (const m of embOptions) {
      if (!ids.has(m.id)) {
        ids.add(m.id);
        opts.push({ id: m.id, label: m.name });
      }
    }
    if (config?.embedding_model && !ids.has(config.embedding_model)) {
      opts.unshift({ id: config.embedding_model, label: config.embedding_model });
    }
    return opts;
  };

  if (loading) {
    return (
      <div className={clsx("flex items-center gap-2 text-gray-500", compact ? "text-xs" : "text-sm")}>
        <Loader2 size={14} className="animate-spin" />
        Loading models…
      </div>
    );
  }

  if (compact && stackedCompact) {
    return (
      <div className="flex flex-col gap-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="flex items-center gap-1 text-gray-500 flex-shrink-0">
            <Cpu size={13} className="text-primary-400" />
            AI models
            {loadError && (
              <span className="text-amber-400/90" title="Offline — using defaults">
                (offline)
              </span>
            )}
          </span>
          {context === "digest" && (
            <ModelRow
              label="Filter LLM"
              value={config?.llm_model ?? ""}
              options={llmSelectOptions()}
              installed={llmInstalled}
              disabled={saving}
              compact
              onChange={(id) => apply({ llm_model: id })}
            />
          )}
          {context === "chat" && (
            <ModelRow
              label="Chat LLM"
              value={config?.chat_llm_model || config?.llm_model || ""}
              options={llmSelectOptions()}
              installed={chatLlmInstalled}
              disabled={saving}
              compact
              onChange={(id) => apply({ chat_llm_model: id })}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-16">
          <ModelRow
            label="Embedding"
            value={config?.embedding_model ?? ""}
            options={embSelectOptions()}
            installed={embInstalled}
            disabled={saving}
            compact
            onChange={(id) => apply({ embedding_model: id })}
          />
          {saving && <Loader2 size={12} className="animate-spin text-primary-400" />}
        </div>
        {context === "digest" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-16">
            <span className="text-gray-500 flex-shrink-0">Must Read ≥</span>
            <input
              type="range"
              min={10}
              max={95}
              step={1}
              value={thresholdPct}
              disabled={saving}
              onChange={(e) => setThresholdPct(Number(e.target.value))}
              onPointerUp={(e) => {
                const val = Number((e.target as HTMLInputElement).value);
                void apply({ must_read_threshold: val / 100 });
              }}
              className="w-24 accent-primary-400 cursor-pointer disabled:opacity-50"
              title={`Must Read threshold: ${thresholdPct}%`}
            />
            <span className="w-8 text-right font-medium text-primary-300">{thresholdPct}%</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-x-4 gap-y-2",
        compact ? "text-xs" : "text-sm",
      )}
    >
      <span className="flex items-center gap-1 text-gray-500 flex-shrink-0">
        <Cpu size={compact ? 13 : 15} className="text-primary-400" />
        AI models
        {loadError && (
          <span className="text-amber-400/90" title="Offline — using defaults">
            (offline)
          </span>
        )}
      </span>

      {context === "digest" && (
        <ModelRow
          label="Filter LLM"
          value={config?.llm_model ?? ""}
          options={llmSelectOptions()}
          installed={llmInstalled}
          disabled={saving}
          compact={compact}
          onChange={(id) => apply({ llm_model: id })}
        />
      )}

      {context === "chat" && (
        <ModelRow
          label="Chat LLM"
          value={config?.chat_llm_model || config?.llm_model || ""}
          options={llmSelectOptions()}
          installed={chatLlmInstalled}
          disabled={saving}
          compact={compact}
          onChange={(id) => apply({ chat_llm_model: id })}
        />
      )}

      <ModelRow
        label="Embedding"
        value={config?.embedding_model ?? ""}
        options={embSelectOptions()}
        installed={embInstalled}
        disabled={saving}
        compact={compact}
        onChange={(id) => apply({ embedding_model: id })}
      />

      {saving && <Loader2 size={12} className="animate-spin text-primary-400" />}
    </div>
  );
}
