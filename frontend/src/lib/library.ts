import { API_BASE as API } from "./apiBase";

export interface LibraryFolder {
  id: string;
  name: string;
  parent: string | null;
}

export interface LibraryEntry {
  paper_id: string;
  folder_id: string;
  comment?: string;
  comment_updated_at?: string;
}

export interface LibraryData {
  folders: LibraryFolder[];
  entries: LibraryEntry[];
}

export async function fetchLibrary(): Promise<LibraryData> {
  const r = await fetch(`${API}/library/`);
  if (!r.ok) throw new Error(`Library API error ${r.status}`);
  const d = await r.json();
  const folders = Array.isArray(d.folders) ? d.folders : [];
  const entries = Array.isArray(d.entries) ? d.entries : [];
  return {
    folders:
      folders.length > 0
        ? folders
        : [{ id: "default", name: "Reading List", parent: null }],
    entries,
  };
}

export async function createLibraryFolder(name: string): Promise<LibraryFolder> {
  const r = await fetch(`${API}/library/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return r.json();
}

export async function addPaperToLibrary(
  paperId: string,
  folderId: string,
): Promise<"added" | "already_exists"> {
  const r = await fetch(`${API}/library/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper_id: paperId, folder_id: folderId }),
  });
  const data = await r.json();
  return data.status === "already_exists" ? "already_exists" : "added";
}

export async function deleteLibraryFolder(
  folderId: string,
  deletePdfs = false,
): Promise<{ pdfs_deleted?: number }> {
  const qs = deletePdfs ? "?delete_pdfs=true" : "";
  const r = await fetch(`${API}/library/folders/${folderId}${qs}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`Delete folder failed ${r.status}`);
  return r.json();
}

export async function importPapersToFolder(
  paperIds: string[],
  folderId: string,
  existingEntries: LibraryEntry[],
): Promise<{ added: string[]; duplicates: string[] }> {
  const inFolder = new Set(
    existingEntries.filter((e) => e.folder_id === folderId).map((e) => e.paper_id),
  );
  const added: string[] = [];
  const duplicates: string[] = [];

  for (const paperId of paperIds) {
    const id = String(paperId);
    if (inFolder.has(id)) {
      duplicates.push(id);
      continue;
    }
    const status = await addPaperToLibrary(id, folderId);
    if (status === "already_exists") {
      duplicates.push(id);
      inFolder.add(id);
    } else {
      added.push(id);
      inFolder.add(id);
    }
  }
  return { added, duplicates };
}

export async function removePaperFromLibrary(paperId: string, folderId: string): Promise<void> {
  await fetch(`${API}/library/entries/${paperId}?folder_id=${encodeURIComponent(folderId)}`, {
    method: "DELETE",
  });
}

export async function fetchLibraryContextPapers(
  scope: "library" | "folder",
  folderId?: string,
): Promise<{ papers: unknown[]; count: number }> {
  const qs = new URLSearchParams({ scope });
  if (scope === "folder" && folderId) qs.set("folder_id", folderId);
  const r = await fetch(`${API}/library/context-papers?${qs}`);
  if (!r.ok) throw new Error("Failed to load context papers");
  return r.json();
}

export function foldersContainingPaper(entries: LibraryEntry[], paperId: string): Set<string> {
  return new Set(
    entries.filter((e) => e.paper_id === String(paperId)).map((e) => e.folder_id),
  );
}
