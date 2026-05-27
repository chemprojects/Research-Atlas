import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, FileWarning, FileText, FolderOpen } from "lucide-react";
import clsx from "clsx";
import type { Paper } from "../api/client";
import {
  downloadPaperPdf,
  fetchPdfStatus,
  openPdfFile,
  revealPdfInFolder,
  type PdfStatus,
} from "../lib/pdfDownload";
import { subscribePdfStatusChanged } from "../lib/pdfEvents";

interface DownloadPdfButtonProps {
  paperId: string;
  paper?: Paper;
  folderId?: string;
  initialStatus?: PdfStatus;
  deferStatusFetch?: boolean;
  compact?: boolean;
  className?: string;
}

export function DownloadPdfButton({
  paperId,
  paper,
  folderId,
  initialStatus,
  deferStatusFetch = false,
  compact = false,
  className,
}: DownloadPdfButtonProps) {
  const [status, setStatus] = useState<"idle" | "saved" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [hostFolder, setHostFolder] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchPdfStatus(paperId, folderId);
      if (s.status === "saved" && s.path) {
        setStatus("saved");
        setSavedPath(s.path);
        setHostFolder(s.host_folder_name ?? null);
        setErrorMsg(null);
      } else {
        setStatus("idle");
        setSavedPath(null);
        setHostFolder(null);
      }
    } catch {
      setStatus("idle");
      setSavedPath(null);
      setHostFolder(null);
    }
  }, [paperId, folderId]);

  useEffect(() => {
    if (!initialStatus && !deferStatusFetch) {
      void refresh();
    }
  }, [deferStatusFetch, initialStatus, refresh]);

  useEffect(() => {
    if (!initialStatus) return;
    if (initialStatus.status === "saved" && initialStatus.path) {
      setStatus("saved");
      setSavedPath(initialStatus.path);
      setHostFolder(initialStatus.host_folder_name ?? null);
      setErrorMsg(null);
    } else {
      setStatus("idle");
      setSavedPath(null);
      setHostFolder(null);
    }
  }, [initialStatus]);

  useEffect(() => {
    return subscribePdfStatusChanged((id) => {
      if (id === String(paperId)) void refresh();
    });
  }, [paperId, refresh]);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (status === "loading") return;
    setStatus("loading");
    setErrorMsg(null);
    try {
      const result = await downloadPaperPdf(paperId, folderId, paper);
      setStatus("saved");
      setSavedPath(result.path ?? null);
      setHostFolder(result.host_folder_name ?? null);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleOpen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!savedPath) return;
    setErrorMsg(null);
    try {
      await openPdfFile(savedPath);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not open PDF");
    }
  };

  const handleReveal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!savedPath) return;
    setErrorMsg(null);
    try {
      await revealPdfInFolder(savedPath);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not show in folder");
    }
  };

  if (status === "saved" && savedPath) {
    const locationHint = hostFolder ? `In folder: ${hostFolder}` : savedPath;
    return (
      <div
        className={clsx("inline-flex flex-col", className)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={handleOpen}
            title={`Open in default PDF viewer — ${savedPath}`}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 text-green-400 text-xs font-medium transition-colors hover:bg-green-500/20",
              compact ? "px-2 py-1" : "px-2.5 py-1.5",
            )}
          >
            <FileText size={13} />
            {compact ? "Open" : "Open PDF"}
          </button>
          <button
            type="button"
            onClick={handleReveal}
            title={`Show in Finder — ${locationHint}`}
            className="p-1 rounded-lg border border-surface-border bg-surface-overlay text-gray-400 hover:text-gray-200 hover:bg-surface-raised transition-colors"
          >
            <FolderOpen size={13} />
          </button>
        </div>
        {errorMsg && (
          <p className="text-[10px] text-amber-400/90 mt-0.5 max-w-[220px] leading-tight">{errorMsg}</p>
        )}
      </div>
    );
  }

  const label =
    status === "loading"
      ? "Downloading…"
      : status === "error"
        ? "Retry PDF"
        : compact
          ? "PDF"
          : "Download PDF";

  return (
    <div className={clsx("inline-flex flex-col", className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={handleDownload}
        disabled={status === "loading"}
        title="Download open-access PDF to your library folder (see Settings → Components)"
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-colors",
          compact ? "px-2 py-1" : "px-2.5 py-1.5",
          status === "error"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
            : "border-surface-border bg-surface-overlay text-gray-300 hover:text-gray-100 hover:bg-surface-raised",
        )}
      >
        {status === "loading" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : status === "error" ? (
          <FileWarning size={13} />
        ) : (
          <Download size={13} />
        )}
        {label}
      </button>
      {status === "error" && errorMsg && (
        <p className="text-[10px] text-amber-400/90 mt-0.5 max-w-[200px] leading-tight">{errorMsg}</p>
      )}
    </div>
  );
}
