import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import {
  ensureBackendStarted,
  getLauncherStatus,
  retryBackendStart,
  type LauncherStatus,
} from "../lib/tauriBackend";
import { useAppStore } from "../store";

function formatSetupHint(raw: string): string {
  if (/ModuleNotFoundError|No module named/i.test(raw)) {
    return "Installing Python packages — this can take 10–20 minutes on first launch. Tap Try again and keep the app open.";
  }
  if (/pip install failed|Could not find a version/i.test(raw)) {
    return "Still downloading packages. Check your internet connection, then tap Try again.";
  }
  if (/Python 3\.10\+ not found/i.test(raw)) {
    return raw.split("\n")[0] ?? raw;
  }
  if (/did not respond on port/i.test(raw)) {
    return "The engine is still starting. Tap Try again in a moment.";
  }
  const line =
    raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("File ") && !l.startsWith("Traceback")) ??
    raw;
  return line.length > 280 ? `${line.slice(0, 280)}…` : line;
}

function targetProgress(
  status: LauncherStatus | null,
  retrying: boolean,
): number {
  if (retrying) return 18;
  if (!status) return 10;
  switch (status.phase) {
    case "bootstrapping":
      return 52;
    case "starting":
      return 82;
    case "error":
      return 72;
    case "idle":
      return 14;
    default:
      return 36;
  }
}

function phaseLabel(status: LauncherStatus | null, needsRetry: boolean): string {
  if (needsRetry) return "Almost ready — one more step";
  if (!status) return "Setting up Research Atlas";
  switch (status.phase) {
    case "bootstrapping":
      return "Preparing your research workspace";
    case "starting":
      return "Starting Research Atlas";
    default:
      return "Setting up Research Atlas";
  }
}

/** Only mounted while the app is offline / setting up (see App.tsx). */
export function BackendSetupBanner() {
  const loadSystemStatus = useAppStore((s) => s.loadSystemStatus);
  const [status, setStatus] = useState<LauncherStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState(8);
  const syncedStatusRef = useRef(false);

  const bundled = Boolean(status?.bundled_python);
  const needsRetry = Boolean(status?.venv_ready && status?.error);
  const busy =
    retrying ||
    status?.phase === "bootstrapping" ||
    status?.phase === "starting" ||
    (!bundled && !status?.venv_ready && !needsRetry) ||
    (!status && !needsRetry);

  const refresh = useCallback(async () => {
    const s = await getLauncherStatus();
    setStatus(s);
    if (s?.backend_running && !syncedStatusRef.current) {
      syncedStatusRef.current = true;
      await loadSystemStatus();
    }
  }, [loadSystemStatus]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await ensureBackendStarted();
      if (!cancelled) await refresh();
    })();

    const pollMs = status?.venv_ready ? 2500 : 1500;
    const interval = setInterval(() => {
      void refresh();
    }, pollMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refresh, status?.venv_ready]);

  const target = targetProgress(status, retrying);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setProgress((p) => {
        if (p < target) return Math.min(p + 1.2, target);
        if (p > target) return Math.max(p - 2, target);
        if (busy && p < 92) return Math.min(p + 0.15, 92);
        return p;
      });
    }, 80);
    return () => window.clearInterval(tick);
  }, [target, busy]);

  const handleRetry = async () => {
    setRetrying(true);
    setProgress(12);
    syncedStatusRef.current = false;
    await retryBackendStart();
    await refresh();
    setRetrying(false);
  };

  const message =
    status?.message ??
    (bundled
      ? "Starting the built-in research engine…"
      : "First launch sets up a private Python environment on your Mac (one time only).");

  const hint = status?.error ? formatSetupHint(status.error) : null;

  return (
    <div className="flex-shrink-0 px-4 py-3 banner-setup" role="status" aria-live="polite">
      <div className="flex items-start gap-3 max-w-5xl mx-auto">
        <div
          className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500/15 border border-emerald-400/30"
          style={{ animation: busy ? "setup-pulse-soft 2s ease-in-out infinite" : undefined }}
        >
          <Sparkles className="w-4 h-4 text-emerald-400" aria-hidden />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1">
            <p className="text-sm font-semibold banner-setup-title tracking-tight">
              {phaseLabel(status, needsRetry)}
            </p>
            <span className="text-xs tabular-nums banner-setup-hint flex-shrink-0">
              {Math.round(progress)}%
            </span>
          </div>

          <p className="text-xs banner-setup-message leading-relaxed mb-2">{message}</p>

          <div
            className="setup-progress-track h-2 rounded-full overflow-hidden setup-progress-glow"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            role="progressbar"
          >
            <div
              className="setup-progress-fill h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(100, Math.max(4, progress))}%` }}
            />
          </div>

          {hint && (
            <p className="text-xs banner-setup-hint mt-2 leading-relaxed">{hint}</p>
          )}

          {needsRetry && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-400/50 disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={14} className={retrying ? "animate-spin" : ""} />
                Try again
              </button>
              {status?.log_path && (
                <span className="text-[10px] banner-setup-hint truncate max-w-full">
                  Details in launcher log
                </span>
              )}
            </div>
          )}

          {!needsRetry && !bundled && (
            <p className="text-[10px] banner-setup-hint mt-2">
              This runs locally on your machine — no cloud upload during setup.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
