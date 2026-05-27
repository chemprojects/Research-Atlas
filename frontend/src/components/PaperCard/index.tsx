import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import type { Paper } from "../../api/client";
import { openExternalUrl } from "../../lib/externalLinks";
import { renderRichText } from "../../lib/richText";

interface PaperCardProps {
  paper: Paper;
  variant?: "compact" | "full";
  onClick?: () => void;
  onDelete?: (paperId: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (paperId: string) => void;
  libraryActions?: React.ReactNode;
  pdfActions?: React.ReactNode;
}

const tierConfig = {
  unfiltered: {
    label: "Unfiltered",
    bg: "bg-violet-500/20",
    text: "text-violet-300",
    border: "border-violet-500/30",
  },
  must_read: {
    label: "Must Read",
    bg: "bg-red-500/20",
    text: "text-red-400",
    border: "border-red-500/30",
  },
  possibly_relevant: {
    label: "Possibly Relevant",
    bg: "bg-orange-500/20",
    text: "text-orange-400",
    border: "border-orange-500/30",
  },
  adjacent: {
    label: "Adjacent",
    bg: "bg-blue-500/20",
    text: "text-blue-400",
    border: "border-blue-500/30",
  },
  ignored: {
    label: "Ignored",
    bg: "bg-gray-600/20",
    text: "text-gray-500",
    border: "border-gray-600/30",
  },
};

export function PaperCard({
  paper,
  variant = "compact",
  onClick,
  onDelete,
  selectable = false,
  selected = false,
  onToggleSelect,
  libraryActions,
  pdfActions,
}: PaperCardProps) {
  const [expanded] = useState(true);
  const tier = tierConfig[paper.tier] ?? tierConfig.ignored;
  const showInlineDelete = variant !== "full";

  const displayAuthors = () => {
    if (paper.authors.length <= 3) return paper.authors.join(", ");
    return `${paper.authors.slice(0, 3).join(", ")} +${paper.authors.length - 3} more`;
  };

  const formattedDate = (() => {
    try {
      return format(new Date(paper.published_date), "MMM d, yyyy");
    } catch {
      return paper.published_date;
    }
  })();
  const paperLink = paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : "");
  const summaryText = (() => {
    const rawSummary = (paper.summary || "").trim();
    if (rawSummary && !/^summary unavailable/i.test(rawSummary)) return rawSummary;
    const abstract = (paper.abstract || "").trim();
    return abstract;
  })();

  return (
    <div
      className={clsx(
        "card border transition-all duration-150",
        tier.border,
        selected && "ring-2 ring-primary-500/50 bg-primary-500/5",
        onClick && "cursor-pointer hover:border-primary-500/40 hover:bg-surface-overlay",
        "animate-fade-in"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect?.(paper.id);
            }}
            onClick={(e) => e.stopPropagation()}
            className="mt-2 rounded border-surface-border flex-shrink-0"
          />
        )}
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="flex items-start gap-2 mb-1">
            <h3 className="text-sm font-semibold text-gray-100 leading-snug line-clamp-2 flex-1">
              {renderRichText(paper.title)}
            </h3>
            {onDelete && showInlineDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(paper.id);
                }}
                className="btn-secondary text-xs text-red-400 border-red-500/30 hover:bg-red-500/10 flex-shrink-0"
                title="Delete paper"
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mb-2">
            <span>{displayAuthors()}</span>
            <span className="text-gray-700">·</span>
            <span className="text-gray-400 font-medium">{paper.journal}</span>
            <span className="text-gray-700">·</span>
            <span>{formattedDate}</span>
          </div>

          {/* Summary (compact: 2 lines; full: all) */}
          {summaryText && (
            <p
              className={clsx(
                "text-xs text-gray-400 leading-relaxed mb-2",
                !expanded && "line-clamp-2"
              )}
            >
              {renderRichText(summaryText)}
            </p>
          )}

          {/* Why it matters (full only) */}
          {expanded && paper.tier === "must_read" && paper.why_it_matters && (
            <div className="mb-3 p-2.5 rounded-lg bg-primary-500/10 border border-primary-500/20">
              <p className="text-xs text-gray-300 leading-relaxed">{renderRichText(paper.why_it_matters)}</p>
            </div>
          )}

          {(libraryActions || pdfActions) && (
            <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {libraryActions}
              {pdfActions}
            </div>
          )}

          {/* Keywords / methods appear in popup mode only */}
          {variant === "full" && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {paper.methods?.map((m) => (
                <span
                  key={m}
                  className="tag bg-surface-overlay border border-surface-border text-gray-400"
                >
                  {m}
                </span>
              ))}
              {paper.keywords?.slice(0, 8).map((k) => (
                <span
                  key={k}
                  className="tag bg-accent-500/10 border border-accent-500/20 text-accent-500"
                >
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>
        {paperLink && (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
            onMouseUp={() => void openExternalUrl(paperLink)}
            className="p-1 rounded text-gray-600 hover:text-primary-400 transition-colors flex-shrink-0"
            title="Open paper"
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
