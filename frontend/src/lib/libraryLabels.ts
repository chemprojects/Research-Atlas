import type { LibraryFolder } from "./library";

/** Button label for papers saved in library folders. */
export function formatSavedFoldersLabel(
  folders: LibraryFolder[],
  savedFolderIds: Set<string>,
  maxLength = 32,
): string {
  const names = folders.filter((f) => savedFolderIds.has(f.id)).map((f) => f.name);
  if (names.length === 0) return "Save to folder";
  if (names.length === 1) return truncate(names[0], maxLength);
  if (names.length === 2) {
    const combined = `${names[0]}, ${names[1]}`;
    return truncate(combined, maxLength);
  }
  const combined = `${names[0]}, ${names[1]} +${names.length - 2}`;
  return truncate(combined, maxLength);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
