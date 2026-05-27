import { useState, useRef, useEffect } from "react";
import { Download, ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { Paper } from "../api/client";
import {
  downloadTextFile,
  papersToCsv,
  papersToJson,
  fetchBibtexForPapers,
  sanitizeFilename,
} from "../lib/export";
import { AnchoredMenuPortal } from "./AnchoredMenuPortal";

export type ExportFormat = "bibtex" | "csv" | "json";

interface ExportMenuProps {
  papers: Paper[];
  label?: string;
  filenameBase: string;
}

export function ExportMenu({ papers, label = "Export", filenameBase }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const runExport = async (format: ExportFormat) => {
    if (papers.length === 0) return;
    setExporting(true);
    setOpen(false);
    const base = sanitizeFilename(filenameBase);
    try {
      if (format === "csv") {
        downloadTextFile(papersToCsv(papers), `${base}.csv`, "text/csv");
      } else if (format === "json") {
        downloadTextFile(papersToJson(papers), `${base}.json`, "application/json");
      } else {
        const bib = await fetchBibtexForPapers(papers);
        downloadTextFile(bib, `${base}.bib`, "text/plain");
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={papers.length === 0 || exporting}
        onClick={() => setOpen((v) => !v)}
        className="btn-secondary text-sm"
      >
        <Download size={15} />
        {exporting ? "Exporting…" : label}
        <ChevronDown size={12} className={clsx("transition-transform", open && "rotate-180")} />
      </button>
      <AnchoredMenuPortal open={open} anchorRef={ref} onClose={() => setOpen(false)} width={176}>
        {(
          [
            { id: "bibtex" as const, label: "BibTeX (.bib)" },
            { id: "csv" as const, label: "CSV (.csv)" },
            { id: "json" as const, label: "JSON (.json)" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => runExport(opt.id)}
            className="w-full px-3 py-2 text-sm text-left text-gray-200 hover:bg-surface-overlay"
          >
            {opt.label}
          </button>
        ))}
      </AnchoredMenuPortal>
    </div>
  );
}
