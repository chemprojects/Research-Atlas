import { Search, SortDesc, X } from "lucide-react";
import clsx from "clsx";

const DEFAULT_SOURCES = ["openalex", "arxiv", "pubmed", "crossref", "biorxiv", "medrxiv", "chemrxiv"];

interface DigestToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  sourceFilter: string;
  onSourceChange: (v: string) => void;
  sort: "relevance" | "date";
  onSortChange: (v: "relevance" | "date") => void;
  screeningDate: string;
  onScreeningDateChange: (v: string) => void;
  availableSources?: string[];
}

export function DigestToolbar({
  search,
  onSearchChange,
  sourceFilter,
  onSourceChange,
  sort,
  onSortChange,
  screeningDate,
  onScreeningDateChange,
  availableSources,
}: DigestToolbarProps) {
  const sourceList = availableSources && availableSources.length > 0 ? availableSources : DEFAULT_SOURCES;
  return (
    <div className="border-b border-surface-border bg-surface-raised px-6 py-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search papers by title, author, or journal…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="input pl-10 pr-10 text-sm w-full"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X size={14} />
            </button>
          )}
        </div>

          <>
          <select
            value={sourceFilter}
            onChange={(e) => onSourceChange(e.target.value)}
            className="input text-sm py-2 w-56 flex-shrink-0"
          >
            <option value="All Sources">All Sources</option>
            {sourceList.map((s: string) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 flex-shrink-0">
            <SortDesc size={15} className="text-gray-500" />
            <div className="flex rounded-lg overflow-hidden border border-surface-border">
              {(["relevance", "date"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSortChange(s)}
                  className={clsx(
                    "px-4 py-2 text-sm font-medium capitalize transition-colors",
                    sort === s
                      ? "bg-primary-500 text-white"
                      : "bg-surface-overlay text-gray-300 hover:text-gray-100",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          </>
      </div>
      <input
        type="date"
        value={screeningDate}
        onChange={(e) => onScreeningDateChange(e.target.value)}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
