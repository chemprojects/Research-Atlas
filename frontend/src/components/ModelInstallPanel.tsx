import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  Play,
  Terminal,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import type { CatalogModel } from "../lib/models";
import { openExternalUrl } from "../lib/externalLinks";

interface ModelInstallPanelProps {
  model: CatalogModel;
  role: "llm" | "embedding" | "runtime";
  isInstalled: boolean;
  isActive: boolean;
  isActiveFilter?: boolean;
  isActiveChat?: boolean;
  isInstalling: boolean;
  isStartingRuntime?: boolean;
  progress: number;
  installError?: string | null;
  ollamaRunning?: boolean;
  ollamaAppInstalled?: boolean;
  serviceRunning?: boolean;
  runtimeVersion?: string | null;
  storagePath?: string;
  onStoragePathChange?: (path: string) => void;
  onBrowseStorage?: () => void;
  onInstall: () => void;
  onStartRuntime?: () => void;
  onRemove: () => void;
  onSetActive?: () => void;
  onSetInactive?: () => void;
  onSetActiveFilter?: () => void;
  onSetActiveChat?: () => void;
  onRevealStorage?: () => void;
}

export function ModelInstallPanel({
  model,
  role,
  isInstalled,
  isActive,
  isActiveFilter,
  isActiveChat,
  isInstalling,
  isStartingRuntime = false,
  progress,
  installError,
  ollamaRunning = true,
  ollamaAppInstalled = true,
  serviceRunning,
  runtimeVersion,
  storagePath = "",
  onStoragePathChange,
  onBrowseStorage,
  onInstall,
  onStartRuntime,
  onRemove,
  onSetActive,
  onSetInactive,
  onSetActiveFilter,
  onSetActiveChat,
  onRevealStorage,
}: ModelInstallPanelProps) {
  const [pathwayOpen, setPathwayOpen] = useState(false);
  const suggestedPath = model.storage_path;
  const isRuntime = role === "runtime";
  const running = isRuntime ? (serviceRunning ?? false) : false;

  useEffect(() => {
    if (isRuntime || !onStoragePathChange) return;
    if (!storagePath && suggestedPath) {
      onStoragePathChange(suggestedPath);
    }
  }, [isRuntime, suggestedPath, storagePath, onStoragePathChange]);

  const canInstallInApp = isRuntime
    ? !isInstalled
    : role === "embedding" ||
      (role === "llm" && ollamaAppInstalled && ollamaRunning);

  const displayPath = storagePath || suggestedPath;
  const showActiveToggle = !isRuntime && onSetActive && onSetInactive;
  const showFilterChatButtons = role === "llm" && isInstalled && (onSetActiveFilter || onSetActiveChat);
  const openUrl = (url: string) => {
    void openExternalUrl(url);
  };

  return (
    <div
      className={clsx(
        "p-4 rounded-lg border transition-colors",
        (isActive || isActiveFilter || isActiveChat)
          ? "panel-active border"
          : "bg-surface-overlay border-surface-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-fg-secondary">{model.name}</span>
            {isRuntime && isInstalled && running && (
              <span className="tag border text-xs tag-success">Running</span>
            )}
            {isRuntime && isInstalled && !running && (
              <span className="tag border text-xs tag-warning">Stopped</span>
            )}
            {showFilterChatButtons ? (
              <>
                {isActiveFilter && (
                  <span className="tag border text-xs tag-success" title="Currently used for paper ranking">Active for Filter</span>
                )}
                {isActiveChat && (
                  <span className="tag border text-xs tag-primary" title="Currently used for chat">Active for Chat</span>
                )}
              </>
            ) : (
              <>
                {!isRuntime && isInstalled && isActive && (
                  <span className="tag border text-xs tag-primary">Active</span>
                )}
                {!isRuntime && isInstalled && !isActive && (
                  <span className="tag border text-xs tag-muted">Inactive</span>
                )}
              </>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-1">{model.description}</p>
          <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
            {!isRuntime && <span>{model.size_gb} GB</span>}
            {isRuntime && runtimeVersion && (
              <span className="font-mono text-gray-500">v{runtimeVersion}</span>
            )}
            {model.recommended_hardware && <span>{model.recommended_hardware}</span>}
          </div>
          {(model.recommended_for?.includes("filter") || model.recommended_for?.includes("chat")) && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {model.recommended_for.includes("filter") && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400/80">✓ Recommended for Paper Filter</span>
              )}
              {model.recommended_for.includes("chat") && (
                <span className="text-[11px] text-teal-600 dark:text-teal-400/80">✓ Recommended for Chat</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {isInstalling ? (
            <div className="flex items-center gap-2 min-w-[7rem] justify-end">
              <div className="w-24 h-1.5 bg-surface-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-500">{progress}%</span>
            </div>
          ) : (
            <>
              {showFilterChatButtons && (
                <>
                  <button
                    type="button"
                    onClick={onSetActiveFilter}
                    disabled={isActiveFilter}
                    className={clsx(
                      "btn-secondary text-xs px-2 py-1 min-w-[5.5rem]",
                      isActiveFilter && "opacity-50 cursor-default",
                    )}
                    title={isActiveFilter ? "Already used for paper filtering" : "Use this model for paper ranking & summarisation"}
                  >
                    {isActiveFilter ? "✓ For Filter" : "Use for Filter"}
                  </button>
                  <button
                    type="button"
                    onClick={onSetActiveChat}
                    disabled={isActiveChat}
                    className={clsx(
                      "btn-secondary text-xs px-2 py-1 min-w-[5.5rem]",
                      isActiveChat && "opacity-50 cursor-default",
                    )}
                    title={isActiveChat ? "Already used for chat" : "Use this model for the chat assistant"}
                  >
                    {isActiveChat ? "✓ For Chat" : "Use for Chat"}
                  </button>
                </>
              )}
              {isInstalled && showActiveToggle && !showFilterChatButtons && (
                <button
                  type="button"
                  onClick={isActive ? onSetInactive : onSetActive}
                  className={clsx(
                    "btn-secondary text-xs px-2 py-1 min-w-[5.5rem]",
                    isActive && "text-gray-400",
                  )}
                >
                  {isActive ? "Inactive" : "Set Active"}
                </button>
              )}
              {isInstalled ? (
                <>
                  {isRuntime && !running && onStartRuntime && (
                    <button
                      type="button"
                      onClick={onStartRuntime}
                      disabled={isStartingRuntime}
                      className="btn-secondary text-xs px-2 py-1 flex items-center gap-1 text-yellow-300 border-yellow-500/30 hover:bg-yellow-500/10 min-w-[5.5rem] justify-center"
                      title="Start the Ollama application"
                    >
                      {isStartingRuntime ? (
                        <span className="w-3 h-3 border border-yellow-300 border-t-transparent rounded-full animate-spin inline-block" />
                      ) : (
                        <Play size={12} />
                      )}
                      {isStartingRuntime ? "Starting" : "Start"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onRemove}
                    className="btn-secondary text-xs px-2 py-1 flex items-center gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10 min-w-[5.5rem] justify-center"
                    title={
                      isRuntime
                        ? "Remove the Ollama application"
                        : "Uninstall this model from disk"
                    }
                  >
                    <Trash2 size={12} /> Uninstall
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onInstall}
                  disabled={!canInstallInApp}
                  className="btn-secondary text-xs px-3 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed min-w-[5.5rem] justify-center"
                  title={
                    isRuntime
                      ? "Download and install the Ollama app"
                      : role === "llm" && !ollamaAppInstalled
                        ? "Install Ollama from the Runtime section first"
                        : role === "llm" && !ollamaRunning
                          ? "Start the Ollama app first"
                          : "Install via Research Atlas"
                  }
                >
                  <Download size={12} /> Install
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {installError && (
        <p className="mt-2 text-xs text-red-400">{installError}</p>
      )}

      {isInstalling && (
        <p className="mt-2 text-xs text-gray-500 flex items-center gap-1.5 leading-relaxed">
          <span className="w-3 h-3 border border-primary-400 border-t-transparent rounded-full animate-spin inline-block flex-shrink-0" />
          <span>
            {isRuntime ? "Installing" : "Downloading"} {model.name}…{" "}
            {role === "embedding"
              ? "Progress % is approximate; Hugging Face download may take 5–15 minutes on Wi‑Fi."
              : "This can take several minutes — keep Research Atlas open."}
          </span>
        </p>
      )}

      {isStartingRuntime && !isInstalling && (
        <p className="mt-2 text-xs text-gray-500 flex items-center gap-1.5 leading-relaxed">
          <span className="w-3 h-3 border border-yellow-300 border-t-transparent rounded-full animate-spin inline-block flex-shrink-0" />
          <span>Starting Ollama and waiting for the local API…</span>
        </p>
      )}

      <button
        type="button"
        onClick={() => setPathwayOpen((v) => !v)}
        className="mt-3 text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
      >
        {pathwayOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Manual installation (optional)
      </button>

      {pathwayOpen && (
        <div className="mt-2 p-3 rounded-lg bg-surface-raised border border-surface-border space-y-3 text-xs">
          <p className="text-gray-400 leading-relaxed">
            Use this only if you prefer to install outside Research Atlas — for example via Terminal,
            Ollama, or Hugging Face. The <span className="text-gray-300">Install</span> button above
            is the recommended in-app method.
          </p>

          <div>
            <p className="text-gray-400 font-medium mb-1.5">Manual steps</p>
            <ol className="list-decimal list-inside space-y-1 text-gray-400">
              {model.install_steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openUrl(model.install_url)}
              className="btn-secondary text-xs px-2 py-1 inline-flex items-center gap-1"
            >
              <ExternalLink size={11} />
            {isRuntime
              ? "Download from ollama.com"
              : role === "llm"
                ? "Ollama model page"
                : "Hugging Face model page"}
          </button>
            {role === "llm" && !isRuntime && (
              <button
                type="button"
                onClick={() => openUrl("https://ollama.com/download")}
                className="btn-secondary text-xs px-2 py-1 inline-flex items-center gap-1"
              >
                <ExternalLink size={11} /> Get Ollama
              </button>
            )}
            {onRevealStorage && (
              <button
                type="button"
                onClick={onRevealStorage}
                className="btn-secondary text-xs px-2 py-1 inline-flex items-center gap-1"
              >
                <FolderOpen size={11} /> Show on disk
              </button>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-gray-500 flex items-center gap-1">
              <Terminal size={11} /> Terminal command
            </p>
            <code className="block font-mono text-[11px] code-inline bg-surface-overlay px-2 py-1.5 rounded break-all">
              {model.install_command}
            </code>
          </div>

          {!isRuntime && onStoragePathChange && (
            <div className="space-y-1.5">
              <p className="text-gray-500">Storage folder</p>
              <p className="text-[11px] text-gray-600">
                Choose where this model should live on disk. The suggested default is pre-filled;
                change it if you use a custom location.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input font-mono text-[11px] flex-1"
                  value={displayPath}
                  placeholder={suggestedPath}
                  onChange={(e) => onStoragePathChange(e.target.value)}
                />
                {onBrowseStorage && (
                  <button
                    type="button"
                    onClick={onBrowseStorage}
                    className="btn-secondary text-xs px-2 shrink-0"
                    title="Choose folder"
                  >
                    <FolderOpen size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          {isRuntime && isInstalled && !running && (
            <p className="text-yellow-400/90">
              Ollama is installed but not running. Open the Ollama app from Applications or the menu
              bar, then install language models below.
            </p>
          )}

          {role === "llm" && !ollamaAppInstalled && !isInstalled && (
            <p className="ollama-warning-inline text-yellow-400/90">
              Install Ollama from the Runtime section above, then return here to pull this model.
            </p>
          )}

          {role === "llm" && ollamaAppInstalled && !ollamaRunning && !isInstalled && (
            <p className="ollama-warning-inline text-yellow-400/90">
              Ollama is not running. Open the app from{" "}
              <button
                type="button"
                onClick={() => openUrl("https://ollama.com/download")}
                className="underline"
              >
                ollama.com/download
              </button>{" "}
              or follow the manual steps above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
