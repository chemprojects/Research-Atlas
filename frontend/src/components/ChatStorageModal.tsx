import { useState } from "react";
import { X, FolderOpen, RotateCcw, Download, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { ChatSettings } from "../lib/chats";
import type { ChatExportFormat } from "../lib/chatExport";

const DEFAULT_STORAGE = "~/.research_atlas/chats";

interface ChatStorageModalProps {
  open: boolean;
  onClose: () => void;
  settings: ChatSettings | null;
  storageInput: string;
  onStorageInputChange: (v: string) => void;
  onSaveStorage: () => Promise<void>;
  onResetStorage: () => void;
  sessionCount: number;
  exportFormat: ChatExportFormat;
  onExportFormatChange: (f: ChatExportFormat) => void;
  onExportCurrent: () => void;
  onExportSelected: () => void;
  onExportAll: () => void;
  selectedExportCount: number;
  hasActiveChat: boolean;
  onDeleteAllChats: () => void;
}

export function ChatStorageModal({
  open,
  onClose,
  settings,
  storageInput,
  onStorageInputChange,
  onSaveStorage,
  onResetStorage,
  sessionCount,
  exportFormat,
  onExportFormatChange,
  onExportCurrent,
  onExportSelected,
  onExportAll,
  selectedExportCount,
  hasActiveChat,
  onDeleteAllChats,
}: ChatStorageModalProps) {
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveStorage();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-surface-border bg-surface-raised shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-surface-border sticky top-0 bg-surface-raised z-10">
          <h3 className="text-base font-semibold text-gray-100">Chat storage & export</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-500 hover:text-gray-200">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Storage location
            </h4>
            <div className="rounded-xl border border-surface-border bg-surface p-3 mb-3">
              <div className="flex items-start gap-2">
                <FolderOpen size={16} className="text-primary-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Current folder</p>
                  <p className="text-xs font-mono text-gray-200 break-all">
                    {settings?.resolved_storage_dir ?? settings?.storage_dir ?? DEFAULT_STORAGE}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">{sessionCount} saved conversation{sessionCount === 1 ? "" : "s"}</p>
                </div>
              </div>
            </div>
            <label className="text-xs text-gray-400 block mb-1">Change storage directory</label>
            <input
              type="text"
              value={storageInput}
              onChange={(e) => onStorageInputChange(e.target.value)}
              className="input text-xs font-mono mb-2"
              placeholder={DEFAULT_STORAGE}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleSave} disabled={saving} className="btn-primary text-xs">
                {saving ? "Saving…" : "Apply location"}
              </button>
              <button type="button" onClick={onResetStorage} className="btn-secondary text-xs inline-flex items-center gap-1">
                <RotateCcw size={12} />
                Reset to default
              </button>
            </div>
            <p className="text-[10px] text-gray-600 mt-2">
              Chats are stored as JSON files under <span className="font-mono">sessions/</span> in this folder.
              Changing location only affects new reads after save; existing files stay in the old folder.
            </p>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Export conversations
            </h4>
            <label className="text-xs text-gray-400 block mb-1">Format</label>
            <div className="flex gap-2 mb-3">
              {(["json", "markdown", "txt"] as ChatExportFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onExportFormatChange(f)}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    exportFormat === f
                      ? "border-primary-500/50 bg-primary-500/15 text-primary-300"
                      : "border-surface-border text-gray-400 hover:text-gray-200",
                  )}
                >
                  {f === "txt" ? "Plain text" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={onExportCurrent}
                disabled={!hasActiveChat}
                className="w-full btn-secondary text-xs justify-center disabled:opacity-40"
              >
                <Download size={13} />
                Export current chat
              </button>
              <button
                type="button"
                onClick={onExportSelected}
                disabled={selectedExportCount === 0}
                className="w-full btn-secondary text-xs justify-center disabled:opacity-40"
              >
                <Download size={13} />
                Export selected ({selectedExportCount})
              </button>
              <button
                type="button"
                onClick={onExportAll}
                disabled={sessionCount === 0}
                className="w-full btn-secondary text-xs justify-center disabled:opacity-40"
              >
                <Download size={13} />
                Export all chats ({sessionCount})
              </button>
            </div>
          </section>

          <section className="pt-2 border-t border-surface-border">
            <button
              type="button"
              onClick={onDeleteAllChats}
              disabled={sessionCount === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-red-400 border border-red-500/30 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 size={13} />
              Delete all conversations
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
