import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Paper } from "../api/client";
import { ExportMenu } from "./ExportMenu";
import { sanitizeFilename } from "../lib/export";
import { fetchFolderPdfCount } from "../lib/pdfDownload";

interface DeleteFolderDialogProps {
  folderId: string;
  folderName: string;
  paperCount: number;
  papers: Paper[];
  isLastFolder: boolean;
  onCancel: () => void;
  onConfirm: (deletePdfs: boolean) => void;
}

export function DeleteFolderDialog({
  folderId,
  folderName,
  paperCount,
  papers,
  isLastFolder,
  onCancel,
  onConfirm,
}: DeleteFolderDialogProps) {
  const isEmpty = paperCount === 0;
  const [pdfCount, setPdfCount] = useState(0);
  const [deletePdfs, setDeletePdfs] = useState(false);

  useEffect(() => {
    void fetchFolderPdfCount(folderId).then(setPdfCount);
  }, [folderId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card max-w-md w-full">
        <h3 className="text-base font-semibold text-gray-100 mb-2">Delete folder?</h3>

        {isLastFolder ? (
          <p className="text-sm text-amber-400 mb-4">
            You need at least one folder in your library. Create another folder before deleting this one.
          </p>
        ) : isEmpty ? (
          <p className="text-sm text-gray-400 mb-4">
            Delete <span className="text-gray-200 font-medium">&ldquo;{folderName}&rdquo;</span>? This folder is empty.
          </p>
        ) : (
          <>
            <div className="flex gap-2 rounded-lg bg-amber-500/10 border border-amber-500/25 p-3 mb-4">
              <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-300">
                <span className="font-medium text-gray-100">&ldquo;{folderName}&rdquo;</span> contains{" "}
                <strong>{paperCount}</strong> saved paper{paperCount !== 1 ? "s" : ""}.
                {pdfCount > 0 && (
                  <>
                    {" "}
                    <strong>{pdfCount}</strong> PDF{pdfCount !== 1 ? "s" : ""} on disk in your library folder.
                  </>
                )}
                {" "}Export or back up before deleting — library entries cannot be undone.
              </p>
            </div>
            <div className="mb-4">
              <ExportMenu
                papers={papers}
                label="Export folder backup"
                filenameBase={sanitizeFilename(folderName)}
              />
            </div>
            {pdfCount > 0 && (
              <label className="flex items-start gap-2 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deletePdfs}
                  onChange={(e) => setDeletePdfs(e.target.checked)}
                  className="mt-1 rounded border-surface-border"
                />
                <span className="text-sm text-gray-300">
                  Also delete <strong>{pdfCount}</strong> downloaded PDF file{pdfCount !== 1 ? "s" : ""} from your
                  local library folder
                </span>
              </label>
            )}
          </>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          {!isLastFolder && (
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
              onClick={() => onConfirm(deletePdfs)}
            >
              {isEmpty ? "Delete folder" : deletePdfs ? "Delete folder & PDFs" : "Delete folder only"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
