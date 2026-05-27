import { CheckCircle2, AlertCircle, X } from "lucide-react";
import type { ImportResult } from "./ImportMenu";

interface ImportResultModalProps {
  result: ImportResult | null;
  onClose: () => void;
}

export function ImportResultModal({ result, onClose }: ImportResultModalProps) {
  if (!result) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card max-w-lg w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-100">Import complete</h3>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5">
            <X size={16} />
          </button>
        </div>

        {result.folderName && (
          <p className="text-sm text-gray-400 mb-4">
            Target folder: <span className="text-gray-200 font-medium">{result.folderName}</span>
          </p>
        )}

        <div className="overflow-y-auto space-y-4 flex-1 min-h-0">
          {result.added.length > 0 && (
            <section>
              <p className="text-sm font-medium text-green-400 flex items-center gap-1.5 mb-2">
                <CheckCircle2 size={16} />
                {result.added.length} added
              </p>
              <ul className="text-sm text-gray-400 space-y-1 pl-1 max-h-32 overflow-y-auto">
                {result.added.map((p) => (
                  <li key={p.id} className="line-clamp-1">
                    {p.title}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.duplicates.length > 0 && (
            <section>
              <p className="text-sm font-medium text-amber-400 flex items-center gap-1.5 mb-2">
                <AlertCircle size={16} />
                {result.duplicates.length} already in folder (skipped)
              </p>
              <ul className="text-sm text-gray-400 space-y-1 pl-1 max-h-32 overflow-y-auto">
                {result.duplicates.map((p) => (
                  <li key={p.id} className="line-clamp-1">
                    {p.title}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.notFound.length > 0 && (
            <section>
              <p className="text-sm font-medium text-red-400 flex items-center gap-1.5 mb-2">
                <AlertCircle size={16} />
                {result.notFound.length} not found in your paper database
              </p>
              <p className="text-xs text-gray-500 mb-2">
                Only papers already scanned or saved in Research Atlas can be imported. Run a scan first, or export/import JSON from this app.
              </p>
              <ul className="text-sm text-gray-500 space-y-1 pl-1 max-h-32 overflow-y-auto">
                {result.notFound.map((ref, i) => (
                  <li key={i} className="line-clamp-1">
                    {ref.title || ref.doi || "Unknown entry"}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.added.length === 0 &&
            result.duplicates.length === 0 &&
            result.notFound.length === 0 && (
              <p className="text-sm text-gray-500">No papers found in the file.</p>
            )}
        </div>

        <button type="button" className="btn-primary mt-4 w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
