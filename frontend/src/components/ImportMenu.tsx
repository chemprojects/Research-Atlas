import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { Paper } from "../api/client";
import type { LibraryEntry, LibraryFolder } from "../lib/library";
import { createLibraryFolder, importPapersToFolder } from "../lib/library";
import {
  folderNameExists,
  parseImportFile,
  resolveImportRefs,
  type ImportPaperRef,
} from "../lib/import";

export interface ImportResult {
  folderId: string;
  folderName: string;
  added: Paper[];
  duplicates: Paper[];
  notFound: ImportPaperRef[];
}

interface ImportMenuProps {
  label?: string;
  scope: "folder" | "library";
  folderId?: string;
  folderName?: string;
  folders: LibraryFolder[];
  entries: LibraryEntry[];
  allPapers: Paper[];
  onOpen?: () => Promise<void> | void;
  onImported: (result: ImportResult) => void;
}

export function ImportMenu({
  label = "Import",
  scope,
  folderId,
  folderName,
  folders,
  entries,
  allPapers,
  onOpen,
  onImported,
}: ImportMenuProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [libraryModal, setLibraryModal] = useState<{
    resolved: Paper[];
    notFound: ImportPaperRef[];
  } | null>(null);
  const [destMode, setDestMode] = useState<"new" | "existing">("new");
  const [newFolderName, setNewFolderName] = useState("");
  const [existingFolderId, setExistingFolderId] = useState(folders[0]?.id ?? "default");

  const paperById = new Map(allPapers.map((p) => [String(p.id), p]));

  const applyImport = async (
    targetFolderId: string,
    targetFolderName: string,
    papers: Paper[],
    notFound: ImportPaperRef[],
  ) => {
    const { added: addedIds, duplicates: dupIds } = await importPapersToFolder(
      papers.map((p) => p.id),
      targetFolderId,
      entries,
    );
    onImported({
      folderId: targetFolderId,
      folderName: targetFolderName,
      added: addedIds.map((id) => paperById.get(id)!).filter(Boolean),
      duplicates: dupIds.map((id) => paperById.get(id)!).filter(Boolean),
      notFound,
    });
  };

  const processFile = async (file: File) => {
    setBusy(true);
    try {
      const content = await file.text();
      const refs = parseImportFile(content, file.name);
      const { resolved, notFound } = resolveImportRefs(refs, allPapers);

      if (scope === "folder" && folderId && folderName) {
        await applyImport(folderId, folderName, resolved, notFound);
        return;
      }

      if (resolved.length === 0 && notFound.length > 0) {
        onImported({
          folderId: "",
          folderName: "",
          added: [],
          duplicates: [],
          notFound,
        });
        return;
      }

      setLibraryModal({ resolved, notFound });
      setDestMode("new");
      setNewFolderName("");
      setExistingFolderId(folders[0]?.id ?? "default");
    } catch {
      onImported({
        folderId: "",
        folderName: "",
        added: [],
        duplicates: [],
        notFound: [],
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const confirmLibraryImport = async () => {
    if (!libraryModal) return;
    const { resolved, notFound } = libraryModal;
    let targetId = existingFolderId;
    let targetName = folders.find((f) => f.id === existingFolderId)?.name ?? "";

    if (destMode === "new") {
      const name = newFolderName.trim();
      if (!name) return;
      if (folderNameExists(folders, name)) {
        alert(
          `A folder named "${name}" already exists. Choose it under "Existing folder" or pick a different name.`,
        );
        return;
      }
      const folder = await createLibraryFolder(name);
      targetId = folder.id;
      targetName = folder.name;
    }

    setBusy(true);
    try {
      await applyImport(targetId, targetName, resolved, notFound);
      setLibraryModal(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.csv,.bib"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processFile(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onOpen?.();
            inputRef.current?.click();
          } finally {
            setBusy(false);
          }
        }}
        className="btn-secondary text-sm"
      >
        <Upload size={15} />
        {busy ? "Importing…" : label}
      </button>

      {libraryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card max-w-md w-full">
            <h3 className="text-base font-semibold text-gray-100 mb-1">Import to Library</h3>
            <p className="text-sm text-gray-400 mb-4">
              {libraryModal.resolved.length} paper{libraryModal.resolved.length !== 1 ? "s" : ""} matched
              in your database.
              {libraryModal.notFound.length > 0 &&
                ` ${libraryModal.notFound.length} could not be matched.`}
            </p>
            <p className="text-sm text-gray-500 mb-4">
              Create a <strong className="text-gray-300">new folder</strong> (use a name that does not exist yet), or
              import into an <strong className="text-gray-300">existing folder</strong> from the list below.
            </p>

            <div className="space-y-3 mb-4">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dest"
                  checked={destMode === "new"}
                  onChange={() => setDestMode("new")}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="text-sm text-gray-200 block">New folder</span>
                  <input
                    className="input text-sm mt-1.5 w-full"
                    placeholder="Folder name (must be unique)"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    disabled={destMode !== "new"}
                  />
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dest"
                  checked={destMode === "existing"}
                  onChange={() => setDestMode("existing")}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="text-sm text-gray-200 block">Existing folder</span>
                  <select
                    className="input text-sm mt-1.5 w-full"
                    value={existingFolderId}
                    onChange={(e) => setExistingFolderId(e.target.value)}
                    disabled={destMode !== "existing"}
                  >
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setLibraryModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || (destMode === "new" && !newFolderName.trim())}
                onClick={confirmLibraryImport}
              >
                Import {libraryModal.resolved.length} papers
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
