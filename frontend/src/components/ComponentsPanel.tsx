import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Trash2,
  Folder,
  ExternalLink,
  Loader2,
} from "lucide-react";
import clsx from "clsx";
import {
  fetchSystemComponents,
  purgeComponent,
  revealPath,
  type SystemComponent,
} from "../lib/models";
import { openExternalUrl } from "../lib/externalLinks";

export function ComponentsPanel() {
  const [components, setComponents] = useState<SystemComponent[]>([]);
  const [appDataDir, setAppDataDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSystemComponents();
      setComponents(data.components);
      setAppDataDir(data.app_data_dir);
    } catch {
      setError("Could not load component paths. Make sure Research Atlas is online.");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleDeleteOne = async (comp: SystemComponent) => {
    if (!comp.purge_key) return;
    if (
      !window.confirm(
        `Remove ${comp.label}? Research Atlas may stop working correctly until you reinstall or rescan. This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(comp.id);
    setError(null);
    try {
      await purgeComponent(comp.purge_key);
      await load();
    } catch {
      setError(`Failed to remove ${comp.label}.`);
    }
    setDeletingId(null);
  };

  const handleOpen = async (comp: SystemComponent) => {
    if (comp.id === "ollama" && comp.install_url) {
      await openExternalUrl(comp.install_url);
      return;
    }
    if (!comp.can_open) return;
    try {
      await revealPath(comp.path);
    } catch {
      setError("Could not open path in Finder.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="callout-warning p-4 rounded-lg flex gap-3">
        <AlertTriangle size={18} className="icon-warning flex-shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <p className="callout-warning-title text-sm">Leave these in place for normal use</p>
          <p className="callout-warning-body">
            You can delete individual components below, but doing so will break digests, chat, library
            search, or scans until you rebuild that data. Use{" "}
            <span className="font-medium">Uninstall</span> in the sidebar only when you want to remove
            Research Atlas entirely.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="card border border-surface-border">
        <p className="text-xs text-gray-400 mb-4">
          Data folder: <code className="font-mono text-gray-300">{appDataDir || "—"}</code>
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading paths…
          </div>
        ) : (
          <div className="space-y-2">
            {components.map((comp) => (
              <div
                key={comp.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-surface-raised border border-surface-border"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-200">{comp.label}</span>
                    <span
                      className={clsx("tag text-[10px] border", {
                        "bg-blue-500/10 text-blue-400 border-blue-500/20": comp.type === "data",
                        "bg-purple-500/10 text-purple-400 border-purple-500/20": comp.type === "model",
                        "bg-orange-500/10 text-orange-400 border-orange-500/20": comp.type === "app",
                        "bg-gray-500/10 text-gray-400 border-gray-500/20": comp.type === "config",
                      })}
                    >
                      {comp.type}
                    </span>
                    <span className="text-xs text-gray-500 ml-auto">{comp.size_label}</span>
                  </div>
                  <p className="text-xs text-gray-500 font-mono mt-0.5 break-all" title={comp.path}>
                    {comp.path}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {comp.id === "ollama" && comp.install_url ? (
                    <button
                      type="button"
                      onClick={() => void openExternalUrl(comp.install_url!)}
                      className="btn-ghost text-xs py-1 px-2 inline-flex items-center gap-1"
                      title="Ollama download page"
                    >
                      <ExternalLink size={12} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!comp.can_open}
                      onClick={() => handleOpen(comp)}
                      className="btn-ghost text-xs py-1 px-2 disabled:opacity-30"
                      title="Show in Finder"
                    >
                      <Folder size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!comp.can_delete || !comp.purge_key || deletingId === comp.id}
                    onClick={() => handleDeleteOne(comp)}
                    className="btn-ghost text-xs py-1 px-2 text-red-500 hover:bg-red-500/10 disabled:opacity-30"
                    title={comp.can_delete ? "Delete this component" : "Cannot delete from here"}
                  >
                    {deletingId === comp.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
