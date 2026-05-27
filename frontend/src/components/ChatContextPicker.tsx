import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Library, FolderOpen, Check } from "lucide-react";
import clsx from "clsx";
import { AnchoredMenuPortal } from "./AnchoredMenuPortal";
import type { LibraryFolder, LibraryEntry } from "../lib/library";

export interface ContextSelection {
  wholeLibrary: boolean;
  folderIds: Set<string>;
}

interface ChatContextPickerProps {
  folders: LibraryFolder[];
  entries: LibraryEntry[];
  selection: ContextSelection;
  onChange: (next: ContextSelection) => void;
  onRefresh?: () => void | Promise<void>;
  compact?: boolean;
}

function entryCount(entries: LibraryEntry[], folderId?: string): number {
  const list = folderId
    ? entries.filter((e) => e.folder_id === folderId)
    : entries;
  return new Set(list.map((e) => e.paper_id)).size;
}

export function selectionLabel(
  selection: ContextSelection,
  folders: LibraryFolder[],
): string {
  if (selection.wholeLibrary) return "Whole library";
  const names = folders
    .filter((f) => selection.folderIds.has(f.id))
    .map((f) => f.name);
  if (names.length === 0) return "Select folders…";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]} +${names.length - 1} more`;
}

export function defaultSelection(): ContextSelection {
  return { wholeLibrary: true, folderIds: new Set() };
}

export function selectionFromSettings(
  prefs: {
    context_whole_library?: boolean;
    context_all_folders?: boolean;
    context_folder_ids?: string[];
    context_scope?: string;
    context_folder_id?: string | null;
  } | null,
): ContextSelection {
  if (!prefs) return defaultSelection();
  if (prefs.context_whole_library || prefs.context_all_folders) {
    return { wholeLibrary: true, folderIds: new Set() };
  }
  if (prefs.context_folder_ids?.length) {
    return {
      wholeLibrary: false,
      folderIds: new Set(prefs.context_folder_ids),
    };
  }
  if (prefs.context_scope === "folder" && prefs.context_folder_id) {
    return {
      wholeLibrary: false,
      folderIds: new Set([prefs.context_folder_id]),
    };
  }
  return defaultSelection();
}

export function selectionToSettingsPayload(selection: ContextSelection) {
  if (selection.wholeLibrary) {
    return {
      context_whole_library: true,
      context_all_folders: false,
      context_folder_ids: [],
      context_scope: "library" as const,
      context_folder_id: null,
    };
  }
  const ids = [...selection.folderIds];
  return {
    context_whole_library: false,
    context_all_folders: false,
    context_folder_ids: ids,
    context_scope: "folder" as const,
    context_folder_id: ids[0] ?? null,
  };
}

export function paperIdsForSelection(
  selection: ContextSelection,
  entries: LibraryEntry[],
): Set<string> {
  if (selection.wholeLibrary) {
    return new Set(entries.map((e) => e.paper_id));
  }
  const ids = new Set<string>();
  for (const e of entries) {
    if (selection.folderIds.has(e.folder_id)) ids.add(e.paper_id);
  }
  return ids;
}

/** Merge API folders with any folder ids referenced in entries (never miss a folder). */
export function mergeLibraryFolders(
  folders: LibraryFolder[],
  entries: LibraryEntry[],
): LibraryFolder[] {
  const byId = new Map<string, LibraryFolder>();
  for (const f of folders) byId.set(f.id, f);
  for (const e of entries) {
    if (!byId.has(e.folder_id)) {
      byId.set(e.folder_id, {
        id: e.folder_id,
        name: e.folder_id === "default" ? "Reading List" : e.folder_id,
        parent: null,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function ChatContextPicker({
  folders,
  entries,
  selection,
  onChange,
  onRefresh,
  compact = false,
}: ChatContextPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const displayFolders = useMemo(() => mergeLibraryFolders(folders, entries), [folders, entries]);

  useEffect(() => {
    if (!open) return;
    void onRefresh?.();
  }, [open, onRefresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleFolder = (folderId: string) => {
    const nextIds = new Set(selection.folderIds);
    if (nextIds.has(folderId)) nextIds.delete(folderId);
    else nextIds.add(folderId);
    if (nextIds.size === 0) {
      onChange({ wholeLibrary: true, folderIds: new Set() });
      return;
    }
    onChange({
      wholeLibrary: false,
      folderIds: nextIds,
    });
  };

  const wholeCount = entryCount(entries);
  const pad = compact ? "px-1" : "px-3";

  return (
    <div ref={wrapRef} className={clsx("relative pb-2", pad)}>
      <p className={clsx("chat-sidebar-label mb-1.5", compact ? "px-1" : "px-1")}>Library</p>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-surface-border bg-surface-raised text-sm text-left text-gray-200 hover:bg-surface-overlay transition-colors"
      >
        <FolderOpen size={16} className="text-primary-400 shrink-0" />
        <span className="flex-1 truncate font-medium">{selectionLabel(selection, displayFolders)}</span>
        <ChevronDown size={14} className={clsx("text-gray-500 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      <AnchoredMenuPortal
        open={open}
        anchorRef={buttonRef}
        onClose={() => setOpen(false)}
        width="anchor"
        align="start"
        className="max-h-64 overflow-y-auto"
      >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange({ wholeLibrary: true, folderIds: new Set() });
              setOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-surface-overlay"
          >
            <span
              className={clsx(
                "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                selection.wholeLibrary
                  ? "bg-primary-500 border-primary-500"
                  : "border-surface-border",
              )}
            >
              {selection.wholeLibrary && <Check size={10} className="text-white" />}
            </span>
            <Library size={15} className="text-primary-400 shrink-0" />
            <span className="flex-1 font-medium text-gray-200">Whole library</span>
            <span className="text-xs text-gray-500 tabular-nums">{wholeCount}</span>
          </button>

          {displayFolders.length > 0 && (
            <div className="border-t border-surface-border my-1" />
          )}

          {displayFolders.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">No folders yet — create one in Library.</p>
          ) : (
            displayFolders.map((f) => {
              const checked = !selection.wholeLibrary && selection.folderIds.has(f.id);
              const n = entryCount(entries, f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggleFolder(f.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-surface-overlay"
                >
                  <span
                    className={clsx(
                      "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                      checked ? "bg-primary-500 border-primary-500" : "border-surface-border",
                    )}
                  >
                    {checked && <Check size={10} className="text-white" />}
                  </span>
                  <FolderOpen size={15} className="text-gray-500 shrink-0" />
                  <span className="flex-1 truncate text-gray-300">{f.name}</span>
                  <span className="text-xs text-gray-500 tabular-nums">{n}</span>
                </button>
              );
            })
          )}
      </AnchoredMenuPortal>
    </div>
  );
}
