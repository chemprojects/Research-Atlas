import { useState, useRef, useEffect } from "react";
import { FolderPlus, Folder, Check, ChevronDown, Loader2 } from "lucide-react";
import clsx from "clsx";
import type { LibraryFolder } from "../lib/library";
import { formatSavedFoldersLabel } from "../lib/libraryLabels";
import { AnchoredMenuPortal } from "./AnchoredMenuPortal";

interface SaveToLibraryMenuProps {
  folders: LibraryFolder[];
  savedFolderIds: Set<string>;
  onToggleFolder: (folderId: string) => Promise<boolean>;
  onCreateFolderAndSave: (name: string) => Promise<LibraryFolder | null>;
  compact?: boolean;
}

export function SaveToLibraryMenu({
  folders,
  savedFolderIds,
  onToggleFolder,
  onCreateFolderAndSave,
  compact = false,
}: SaveToLibraryMenuProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const savedLabel = formatSavedFoldersLabel(
    folders,
    savedFolderIds,
    compact ? 22 : 36,
  );
  const isSaved = savedFolderIds.size > 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleToggle = async (folderId: string) => {
    setBusy(folderId);
    await onToggleFolder(folderId);
    setBusy(null);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy("__new__");
    await onCreateFolderAndSave(name);
    setNewName("");
    setCreating(false);
    setBusy(null);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={clsx(
          compact ? "btn-secondary text-xs px-2 py-1 max-w-[200px]" : "btn-secondary text-sm max-w-[260px]",
          isSaved && "border-primary-500/40 text-primary-300",
        )}
        title={isSaved ? `Saved in: ${formatSavedFoldersLabel(folders, savedFolderIds, 120)}` : "Save to library folder"}
      >
        <Folder size={compact ? 13 : 15} className="flex-shrink-0" />
        <span className="truncate">{savedLabel}</span>
        <ChevronDown size={12} className={clsx("flex-shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      <AnchoredMenuPortal open={open} anchorRef={ref} onClose={() => setOpen(false)} width={224}>
        <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-surface-border">
          Library folders
        </p>
        <div className="max-h-48 overflow-y-auto py-1">
          {folders.map((f) => {
            const saved = savedFolderIds.has(f.id);
            return (
              <button
                key={f.id}
                type="button"
                disabled={busy === f.id}
                onClick={() => handleToggle(f.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-200 hover:bg-surface-overlay transition-colors"
              >
                {busy === f.id ? (
                  <Loader2 size={14} className="animate-spin text-primary-400" />
                ) : saved ? (
                  <Check size={14} className="text-primary-400" />
                ) : (
                  <Folder size={14} className="text-gray-500" />
                )}
                <span className="flex-1 truncate">{f.name}</span>
                {saved && <span className="text-xs text-primary-400">Saved</span>}
              </button>
            );
          })}
        </div>
        <div className="border-t border-surface-border p-2">
          {creating ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreate();
              }}
              className="flex gap-1"
            >
              <input
                autoFocus
                className="input text-xs py-1 flex-1"
                placeholder="New folder name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="submit" className="btn-primary text-xs px-2" disabled={busy === "__new__"}>
                {busy === "__new__" ? <Loader2 size={12} className="animate-spin" /> : "Add"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-primary-300 hover:bg-primary-500/10 rounded-lg"
            >
              <FolderPlus size={14} />
              Create folder & save
            </button>
          )}
        </div>
      </AnchoredMenuPortal>
    </div>
  );
}
