import type { Paper } from "../api/client";
import type { ContextMenuEntry } from "../components/ContextMenu";
import { openExternalUrl } from "./externalLinks";

export interface PaperContextMenuOptions {
  paper: Paper;
  onDelete?: (paperId: string) => void;
  onSaveToLibrary?: (paperId: string) => void;
  onIgnore?: (paperId: string) => void;
}

export function buildPaperContextMenu({
  paper,
  onDelete,
  onSaveToLibrary,
  onIgnore,
}: PaperContextMenuOptions): ContextMenuEntry[] {
  const paperLink = paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : "");
  const items: ContextMenuEntry[] = [];

  if (paperLink) {
    items.push({
      label: "Open in Browser",
      onClick: () => void openExternalUrl(paperLink),
    });
  }

  items.push({
    label: "Copy Title",
    onClick: () => void navigator.clipboard.writeText(paper.title),
  });

  if (paper.doi) {
    items.push({
      label: "Copy DOI",
      onClick: () => void navigator.clipboard.writeText(paper.doi!),
    });
  }

  if (paperLink) {
    items.push({
      label: "Copy Link",
      onClick: () => void navigator.clipboard.writeText(paperLink),
    });
  }

  items.push({ separator: true });

  if (onSaveToLibrary) {
    items.push({
      label: "Save to Library",
      onClick: () => onSaveToLibrary(paper.id),
    });
  }

  if (onIgnore && paper.tier !== "ignored") {
    items.push({
      label: "Ignore Paper",
      onClick: () => onIgnore(paper.id),
    });
  }

  if (onDelete) {
    items.push({ separator: true });
    items.push({
      label: "Delete Paper",
      onClick: () => onDelete(paper.id),
      danger: true,
    });
  }

  return items;
}

export interface LibraryContextMenuOptions {
  paper: Paper;
  onRemoveFromLibrary?: (paperId: string) => void;
  onMoveToFolder?: (paperId: string) => void;
}

export function buildLibraryPaperContextMenu({
  paper,
  onRemoveFromLibrary,
  onMoveToFolder,
}: LibraryContextMenuOptions): ContextMenuEntry[] {
  const paperLink = paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : "");
  const items: ContextMenuEntry[] = [];

  if (paperLink) {
    items.push({
      label: "Open in Browser",
      onClick: () => void openExternalUrl(paperLink),
    });
  }

  items.push({
    label: "Copy Title",
    onClick: () => void navigator.clipboard.writeText(paper.title),
  });

  if (paper.doi) {
    items.push({
      label: "Copy DOI",
      onClick: () => void navigator.clipboard.writeText(paper.doi!),
    });
  }

  items.push({ separator: true });

  if (onMoveToFolder) {
    items.push({
      label: "Move to Folder…",
      onClick: () => onMoveToFolder(paper.id),
    });
  }

  if (onRemoveFromLibrary) {
    items.push({
      label: "Remove from Library",
      onClick: () => onRemoveFromLibrary(paper.id),
      danger: true,
    });
  }

  return items;
}

export interface ChatMessageContextMenuOptions {
  messageText: string;
  onCopy?: () => void;
  onEdit?: () => void;
}

export function buildChatMessageContextMenu({
  messageText,
  onCopy,
  onEdit,
}: ChatMessageContextMenuOptions): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [];

  items.push({
    label: "Copy Message",
    onClick: onCopy ?? (() => void navigator.clipboard.writeText(messageText)),
  });

  if (onEdit) {
    items.push({
      label: "Edit Message",
      onClick: onEdit,
    });
  }

  return items;
}
