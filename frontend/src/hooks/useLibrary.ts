import { useCallback, useRef, useState } from "react";
import {
  fetchLibrary,
  createLibraryFolder,
  addPaperToLibrary,
  removePaperFromLibrary,
  foldersContainingPaper,
  type LibraryData,
  type LibraryFolder,
} from "../lib/library";

export function useLibrary() {
  const [data, setData] = useState<LibraryData>({
    folders: [{ id: "default", name: "Reading List", parent: null }],
    entries: [],
  });
  const [loading, setLoading] = useState(false);
  const lastLoadedAtRef = useRef(0);
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  const load = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    const now = Date.now();
    if (!force && now - lastLoadedAtRef.current < 15000) return;
    if (!force && loadInFlightRef.current) {
      await loadInFlightRef.current;
      return;
    }
    const task = (async () => {
      setLoading(true);
      try {
        setData(await fetchLibrary());
        lastLoadedAtRef.current = Date.now();
      } catch {
        /* offline */
      } finally {
        setLoading(false);
      }
    })();
    loadInFlightRef.current = task;
    await task.finally(() => {
      if (loadInFlightRef.current === task) loadInFlightRef.current = null;
    });
  }, []);

  const savedFolderIds = useCallback(
    (paperId: string) => foldersContainingPaper(data.entries, paperId),
    [data.entries],
  );

  const togglePaperInFolder = useCallback(
    async (paperId: string, folderId: string) => {
      const saved = savedFolderIds(paperId).has(folderId);
      try {
        if (saved) {
          await removePaperFromLibrary(paperId, folderId);
          setData((prev) => ({
            ...prev,
            entries: prev.entries.filter(
              (e) => !(e.paper_id === String(paperId) && e.folder_id === folderId),
            ),
          }));
        } else {
          await addPaperToLibrary(paperId, folderId);
          setData((prev) => ({
            ...prev,
            entries: [...prev.entries, { paper_id: String(paperId), folder_id: folderId }],
          }));
        }
        return !saved;
      } catch {
        return saved;
      }
    },
    [savedFolderIds],
  );

  const createFolderAndSave = useCallback(
    async (paperId: string, name: string): Promise<LibraryFolder | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      try {
        const folder = await createLibraryFolder(trimmed);
        await addPaperToLibrary(paperId, folder.id);
        setData((prev) => ({
          ...prev,
          folders: [...prev.folders, folder],
          entries: [...prev.entries, { paper_id: String(paperId), folder_id: folder.id }],
        }));
        return folder;
      } catch {
        return null;
      }
    },
    [],
  );

  return {
    folders: data.folders,
    entries: data.entries,
    loading,
    load,
    savedFolderIds,
    togglePaperInFolder,
    createFolderAndSave,
  };
}
