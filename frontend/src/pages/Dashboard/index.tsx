import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  Clock,
  FileText,
  Newspaper,
  Loader2,
  ExternalLink,
  X,
  EyeOff,
  CheckSquare,
  Square,
  Trash2,
  Calendar,
} from "lucide-react";
import clsx from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import { useAppStore, MOCK_STATUS } from "../../store";
import { PaperCard } from "../../components/PaperCard";
import { DigestToolbar } from "../../components/DigestToolbar";
import { SaveToLibraryMenu } from "../../components/SaveToLibraryMenu";
import { DownloadPdfButton } from "../../components/DownloadPdfButton";
import { openExternalUrl } from "../../lib/externalLinks";
import { DigestModelSelector } from "../../components/DigestModelSelector";
import { useLibrary } from "../../hooks/useLibrary";
import {
  fetchPapers,
  fetchPaperStats,
  fetchSources,
  bulkIgnorePapers,
  bulkDeletePapers,
  bulkResetIgnored,
} from "../../api/client";
import type { Paper } from "../../api/client";
import { fetchBulkPdfStatuses, type PdfStatus } from "../../lib/pdfDownload";
import { perfEnd, perfStart } from "../../lib/perf";

const TIER_CONFIG = {
  must_read: {
    label: "Must Read",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    dot: "bg-red-400",
  },
  possibly_relevant: {
    label: "Possibly Relevant",
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/20",
    dot: "bg-orange-400",
  },
  adjacent: {
    label: "Adjacent",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    dot: "bg-blue-400",
  },
  ignored: {
    label: "Ignored",
    color: "text-gray-500",
    bg: "bg-gray-600/10 border-gray-600/20",
    dot: "bg-gray-500",
  },
  unfiltered: {
    label: "Unfiltered",
    color: "text-violet-300",
    bg: "bg-violet-500/10 border-violet-500/20",
    dot: "bg-violet-300",
  },
} as const;

type TierKey = keyof typeof TIER_CONFIG;
const TIER_ORDER: TierKey[] = ["must_read", "possibly_relevant", "adjacent", "ignored", "unfiltered"];
const DIGEST_PAGE_SIZE = 40;

function toInputDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function filterFallbackPapers(
  papers: Paper[],
  options: {
    tier: TierKey;
    source: string;
    search: string;
    sort: "relevance" | "date";
  },
) {
  const query = options.search.trim().toLowerCase();
  return papers
    .filter((paper) => paper.tier === options.tier)
    .filter((paper) => options.source === "All Sources" || paper.source === options.source)
    .filter((paper) => {
      if (!query) return true;
      return (
        paper.title.toLowerCase().includes(query) ||
        paper.authors.some((author) => author.toLowerCase().includes(query)) ||
        paper.journal.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (options.sort === "date") {
        return new Date(b.published_date).getTime() - new Date(a.published_date).getTime();
      }
      return b.relevance_score - a.relevance_score;
    });
}

export default function DailyDigest() {
  const systemStatus = useAppStore((s) => s.systemStatus) ?? MOCK_STATUS;
  const backendReady = Boolean(systemStatus.backend_ready);
  const runScan = useAppStore((s) => s.runScan);
  const runFilter = useAppStore((s) => s.runFilter);
  const scanRunning = useAppStore((s) => s.scanRunning);
  const scanMode = useAppStore((s) => s.scanMode);
  const stopScanRun = useAppStore((s) => s.stopScanRun);
  const scanProgress = useAppStore((s) => s.scanProgress);
  const scanMessage = useAppStore((s) => s.scanMessage);
  const library = useLibrary();
  const previousBackendReadyRef = useRef(backendReady);
  const previousScanRunningRef = useRef(scanRunning);

  const [papers, setPapers] = useState<Paper[]>([]);
  const [tierCounts, setTierCounts] = useState<Record<TierKey, number>>({
    unfiltered: 0,
    must_read: 0,
    possibly_relevant: 0,
    adjacent: 0,
    ignored: 0,
  });
  const [pdfStatuses, setPdfStatuses] = useState<Record<string, PdfStatus>>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [activeTab, setActiveTab] = useState<TierKey>("must_read");

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sourceFilter, setSourceFilter] = useState("All Sources");
  const [sort, setSort] = useState<"relevance" | "date">("relevance");
  const [screeningDate, setScreeningDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scanModels, setScanModels] = useState<{ llm: string; embedding: string }>({
    llm: "",
    embedding: "",
  });
  const [scanFromDate, setScanFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return toInputDate(d);
  });
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [, setLastScanTick] = useState(0);
  const [resetIgnoredLoading, setResetIgnoredLoading] = useState(false);

  const loadPapers = useCallback(async () => {
    perfStart("digest.load_papers");
    setLoading(true);
    try {
      const { papers: fetched } = await fetchPapers({
        tier: activeTab,
        source: sourceFilter === "All Sources" ? undefined : sourceFilter,
        search: deferredSearch.trim() || undefined,
        limit: DIGEST_PAGE_SIZE,
        offset: 0,
        sort,
        exclude_saved: true,
      });
      setHasMore(fetched.length === DIGEST_PAGE_SIZE);
      setPapers(fetched);
    } catch {
      /* keep current list when offline */
    } finally {
      setLoading(false);
      perfEnd("digest.load_papers", {
        tier: activeTab,
        search: deferredSearch.trim().length > 0,
      });
    }
  }, [activeTab, deferredSearch, sort, sourceFilter]);

  const loadMorePapers = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    perfStart("digest.load_more");
    setLoadingMore(true);
    try {
      const { papers: fetched } = await fetchPapers({
        tier: activeTab,
        source: sourceFilter === "All Sources" ? undefined : sourceFilter,
        search: deferredSearch.trim() || undefined,
        limit: DIGEST_PAGE_SIZE,
        offset: papers.length,
        sort,
        exclude_saved: true,
      });
      setPapers((prev) => {
        const byId = new Map(prev.map((paper) => [paper.id, paper]));
        for (const paper of fetched) byId.set(paper.id, paper);
        return Array.from(byId.values());
      });
      setHasMore(fetched.length === DIGEST_PAGE_SIZE);
    } catch {
      /* keep current list when offline */
    } finally {
      setLoadingMore(false);
      perfEnd("digest.load_more", { tier: activeTab });
    }
  }, [
    activeTab,
    deferredSearch,
    hasMore,
    loading,
    loadingMore,
    papers.length,
    sort,
    sourceFilter,
  ]);

  const loadTierCounts = useCallback(async () => {
    perfStart("digest.load_tier_counts");
    try {
      const stats = await fetchPaperStats({ exclude_saved: true });
      setTierCounts({
        unfiltered: stats.unfiltered ?? 0,
        must_read: stats.must_read ?? 0,
        possibly_relevant: stats.possibly_relevant ?? 0,
        adjacent: stats.adjacent ?? 0,
        ignored: stats.ignored ?? 0,
      });
    } catch {
      /* keep current counts when offline */
    } finally {
      perfEnd("digest.load_tier_counts");
    }
  }, []);

  useEffect(() => {
    loadPapers();
    library.load();
    loadTierCounts();
    fetchSources().then((srcs) => {
      const names = srcs.map((s) => s.type ?? (s as unknown as Record<string, string>).name).filter(Boolean);
      if (names.length) setAvailableSources([...new Set(names)]);
    }).catch(() => {});
  }, [loadPapers, library.load, loadTierCounts]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLastScanTick((v) => v + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!scanRunning) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await Promise.all([loadTierCounts(), loadPapers()]);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => {
      void refresh();
    }, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadPapers, loadTierCounts, scanRunning]);

  useEffect(() => {
    const wasReady = previousBackendReadyRef.current;
    if (!wasReady && backendReady) {
      void loadPapers();
      void library.load();
      void loadTierCounts();
    }
    previousBackendReadyRef.current = backendReady;
  }, [backendReady, loadPapers, library.load, loadTierCounts]);

  useEffect(() => {
    const wasRunning = previousScanRunningRef.current;
    if (wasRunning && !scanRunning) {
      // Two-step refresh avoids post-scan race where DB commit just completed
      // but the first immediate fetch still returns stale rows/counts.
      void (async () => {
        await Promise.all([loadPapers(), loadTierCounts(), library.load({ force: true })]);
        window.setTimeout(() => {
          void loadPapers();
          void loadTierCounts();
        }, 800);
      })();
    }
    previousScanRunningRef.current = scanRunning;
  }, [scanRunning, loadPapers, loadTierCounts, library.load]);

  useEffect(() => {
    let cancelled = false;
    const ids = papers.map((p) => String(p.id));
    fetchBulkPdfStatuses(ids)
      .then((statuses) => {
        if (!cancelled) setPdfStatuses(statuses);
      })
      .catch(() => {
        if (!cancelled) setPdfStatuses({});
      });
    return () => {
      cancelled = true;
    };
  }, [papers]);

  const filteredPapers = papers;
  const visibleTierCounts = tierCounts;

  const savePaperToFolder = useCallback(
    async (paperId: string, folderId: string) => {
      const saved = await library.togglePaperInFolder(paperId, folderId);
      if (saved) {
        setSelectedPaper((paper) => (paper?.id === paperId ? null : paper));
        void loadPapers();
        void loadTierCounts();
      }
      return saved;
    },
    [library.togglePaperInFolder, loadPapers, loadTierCounts],
  );

  const createFolderAndSavePaper = useCallback(
    async (paperId: string, name: string) => {
      const folder = await library.createFolderAndSave(paperId, name);
      if (folder) {
        setSelectedPaper((paper) => (paper?.id === paperId ? null : paper));
        void loadPapers();
        void loadTierCounts();
      }
      return folder;
    },
    [library.createFolderAndSave, loadPapers, loadTierCounts],
  );

  const lastScanText = systemStatus.last_scan
    ? formatDistanceToNow(new Date(systemStatus.last_scan), { addSuffix: true })
    : "Never";

  const applyIgnoreLocally = (ids: string[]) => {
    const idSet = new Set(ids);
    setPapers((prev) =>
      prev.map((p) => (idSet.has(p.id) ? { ...p, tier: "ignored" as const } : p)),
    );
    setSelectedIds(new Set());
  };

  const handleIgnoreSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    applyIgnoreLocally(ids);
    try {
      await bulkIgnorePapers({ paper_ids: ids });
      void loadTierCounts();
    } catch { /* offline */ }
  };

  const handleIgnoreVisible = async () => {
    const ids = filteredPapers.map((p) => p.id);
    if (ids.length === 0) return;
    if (!confirm(`Ignore all ${ids.length} papers in ${TIER_CONFIG[activeTab].label}?`)) return;
    applyIgnoreLocally(ids);
    try {
      await bulkIgnorePapers({ paper_ids: ids, tier: activeTab });
      void loadTierCounts();
    } catch { /* offline */ }
  };

  const handleIgnoreByDate = async () => {
    if (!screeningDate) return;
    const onDate = filteredPapers.filter((p) => p.published_date?.slice(0, 10) === screeningDate);
    if (
      !confirm(
        `Ignore ${onDate.length} paper(s) in ${TIER_CONFIG[activeTab].label} published on ${screeningDate}?`,
      )
    ) {
      return;
    }
    applyIgnoreLocally(onDate.map((p) => p.id));
    try {
      await bulkIgnorePapers({ date: screeningDate, tier: activeTab });
      void loadTierCounts();
    } catch { /* offline */ }
  };

  const handleDeleteSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} selected paper(s)? This cannot be undone.`)) return;
    setPapers((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    setSelectedPaper((paper) => (paper && selectedIds.has(paper.id) ? null : paper));
    setSelectedIds(new Set());
    try {
      await bulkDeletePapers({ paper_ids: ids });
      void loadTierCounts();
    } catch { /* offline */ }
  };

  const handleDeleteOne = async (paperId: string) => {
    if (!confirm("Permanently delete this paper? This cannot be undone.")) return;
    setPapers((prev) => prev.filter((paper) => paper.id !== paperId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(paperId);
      return next;
    });
    setSelectedPaper((paper) => (paper?.id === paperId ? null : paper));
    try {
      await bulkDeletePapers({ paper_ids: [paperId] });
      void loadTierCounts();
    } catch { /* offline */ }
  };

  const toggleSelect = (paperId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredPapers.map((p) => p.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleResetIgnored = async () => {
    if (!confirm("Move all Ignored papers back to Unfiltered so they can be re-filtered? This cannot be undone.")) return;
    setResetIgnoredLoading(true);
    try {
      await bulkResetIgnored();
      setActiveTab("unfiltered");
      void loadTierCounts();
    } catch { /* offline */ } finally {
      setResetIgnoredLoading(false);
    }
  };

  const allVisibleSelected =
    filteredPapers.length > 0 && filteredPapers.every((paper) => selectedIds.has(paper.id));

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-surface-border bg-surface-raised px-6 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
              <Newspaper size={22} className="text-primary-400" />
              Daily Digest
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
          </div>
          <div className="flex items-start gap-4 flex-shrink-0 flex-wrap justify-end">
            <DigestModelSelector
              compact
              stackedCompact
              onModelsChange={(llm, embedding) => setScanModels({ llm, embedding })}
            />
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    runScan({
                      embedding_model: scanModels.embedding || undefined,
                      from_date: scanFromDate || undefined,
                    })
                  }
                  disabled={scanRunning}
                  className={clsx("btn-primary", scanRunning && "opacity-75")}
                >
                  {scanRunning && scanMode === "scan" ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Scanning...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={15} /> Scan
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    runFilter({
                      llm_model: scanModels.llm || undefined,
                      embedding_model: scanModels.embedding || undefined,
                    })
                  }
                  disabled={scanRunning}
                  className={clsx("btn-secondary", scanRunning && "opacity-75")}
                >
                  {scanRunning && scanMode === "filter" ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Filtering...
                    </>
                  ) : (
                    <>
                      <FileText size={15} /> Filter
                    </>
                  )}
                </button>
                {scanRunning && (
                  <button
                    type="button"
                    onClick={() => void stopScanRun()}
                    className="btn-secondary text-red-300 border-red-400/40 hover:bg-red-500/10"
                  >
                    Stop
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-end gap-2 text-[11px] text-gray-500">
                <span>From</span>
                <input
                  type="date"
                  value={scanFromDate}
                  onChange={(e) => setScanFromDate(e.target.value)}
                  className="input h-7 py-0 px-2 text-[11px] w-[132px]"
                  disabled={scanRunning}
                />
              </div>
              {scanRunning && (
                <div className="mt-1.5 w-[250px]">
                  <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
                    <div
                      className="h-full bg-primary-500 transition-all duration-500"
                      style={{ width: `${Math.max(2, Math.min(100, scanProgress || 0))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500 text-right">
                    {scanMessage ||
                      `${scanMode === "filter" ? "Filtering" : "Scanning"}... ${Math.round(scanProgress || 0)}%`}
                  </p>
                </div>
              )}
              <span className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500">
                <Clock size={11} className="opacity-70" />
                Last scan {lastScanText}
              </span>
            </div>
          </div>
        </div>
      </div>

      <DigestToolbar
        search={search}
        onSearchChange={setSearch}
        sourceFilter={sourceFilter}
        onSourceChange={setSourceFilter}
        sort={sort}
        onSortChange={setSort}
        screeningDate={screeningDate}
        onScreeningDateChange={setScreeningDate}
        availableSources={availableSources}
      />

      <div className="border-b border-surface-border px-6 flex items-center justify-between gap-3">
        <div className="flex gap-0 overflow-x-auto">
          {TIER_ORDER.map((tier) => {
              const cfg = TIER_CONFIG[tier];
              const isActive = activeTab === tier;
              return (
                <button
                  key={tier}
                  type="button"
                  onClick={() => {
                    setActiveTab(tier);
                    clearSelection();
                  }}
                  className={clsx(
                    "tier-tab",
                    tier === "unfiltered" && "unfiltered-tier-tab",
                    isActive ? `tier-tab-active ${cfg.color}` : "tier-tab-inactive",
                  )}
                >
                  <div className={clsx("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                  {cfg.label}
                  {visibleTierCounts[tier] > 0 && (
                    <span className={clsx("tag text-xs font-bold", cfg.bg, cfg.color)}>
                      {visibleTierCounts[tier]}
                    </span>
                  )}
                </button>
              );
            },
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {activeTab === "ignored" && (
            <button
              type="button"
              onClick={() => void handleResetIgnored()}
              disabled={resetIgnoredLoading || scanRunning}
              className="btn-secondary text-xs text-violet-300 border-violet-500/30 hover:bg-violet-500/10 disabled:opacity-50"
              title="Move all Ignored papers back to Unfiltered"
            >
              {resetIgnoredLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Reset Ignored
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (allVisibleSelected || selectedIds.size > 0) clearSelection();
              else selectAllVisible();
            }}
            className={clsx(
              "btn-secondary text-sm",
              selectedIds.size > 0 && "bg-primary-500/20 border-primary-500/30 text-primary-300",
            )}
          >
            {selectedIds.size > 0 ? <CheckSquare size={15} /> : <Square size={15} />}
            {selectedIds.size > 0 ? "Clear selection" : "Select all"}
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="px-6 py-2.5 border-b border-surface-border bg-surface-overlay flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-400 mr-1">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={handleIgnoreSelected}
            className="btn-secondary text-xs"
          >
            <EyeOff size={13} /> Ignore selected
          </button>
          <button type="button" onClick={handleIgnoreVisible} className="btn-secondary text-xs">
            <EyeOff size={13} /> Ignore all in tab
          </button>
          <button type="button" onClick={handleIgnoreByDate} className="btn-secondary text-xs">
            <Calendar size={13} /> Ignore by date
          </button>
          <button
            type="button"
            onClick={handleDeleteSelected}
            className="btn-secondary text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
          >
            <Trash2 size={13} /> Delete selected
          </button>
          <button type="button" onClick={clearSelection} className="btn-ghost text-xs ml-auto">
            Clear
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-primary-400" size={28} />
          </div>
        ) : filteredPapers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-500">
            <FileText size={32} className="mb-3 opacity-30" />
            <p className="text-sm">No {TIER_CONFIG[activeTab].label.toLowerCase()} papers match your filters.</p>
            <p className="text-sm text-gray-600 mt-1">Run a scan or adjust search and filters.</p>
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl">
            {filteredPapers.map((paper) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                variant="compact"
                onClick={() => setSelectedPaper(paper)}
                onDelete={handleDeleteOne}
                selectable
                selected={selectedIds.has(paper.id)}
                onToggleSelect={toggleSelect}
                libraryActions={
                  <>
                    <SaveToLibraryMenu
                      compact
                      folders={library.folders}
                      savedFolderIds={library.savedFolderIds(paper.id)}
                      onToggleFolder={(folderId) => savePaperToFolder(paper.id, folderId)}
                      onCreateFolderAndSave={(name) => createFolderAndSavePaper(paper.id, name)}
                    />
                    <DownloadPdfButton
                      paperId={paper.id}
                      paper={paper}
                      initialStatus={pdfStatuses[String(paper.id)]}
                      deferStatusFetch
                      compact
                    />
                  </>
                }
              />
            ))}
            {(hasMore || loadingMore) && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => void loadMorePapers()}
                  disabled={loadingMore}
                  className="btn-secondary w-full justify-center disabled:opacity-60"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Loading more papers...
                    </>
                  ) : (
                    "Load more papers"
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedPaper && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setSelectedPaper(null)}
        >
          <div
            className="w-full max-w-2xl bg-surface-raised border border-surface-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-gray-300">Paper Details</h2>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <SaveToLibraryMenu
                  folders={library.folders}
                  savedFolderIds={library.savedFolderIds(selectedPaper.id)}
                  onToggleFolder={(folderId) =>
                    savePaperToFolder(selectedPaper.id, folderId)
                  }
                  onCreateFolderAndSave={(name) =>
                    createFolderAndSavePaper(selectedPaper.id, name)
                  }
                />
                <DownloadPdfButton
                  paperId={selectedPaper.id}
                  paper={selectedPaper}
                  initialStatus={pdfStatuses[String(selectedPaper.id)]}
                  deferStatusFetch
                  compact
                />
                <button
                  type="button"
                  onClick={() => handleDeleteOne(selectedPaper.id)}
                  className="btn-secondary text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                >
                  <Trash2 size={14} /> Delete
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPaper(null)}
                  className="btn-ghost p-1.5"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-5">
              <PaperCard
                paper={selectedPaper}
                variant="full"
                onDelete={handleDeleteOne}
              />
              {(selectedPaper.url || selectedPaper.doi) && (
                <button
                  type="button"
                  onClick={() =>
                    void openExternalUrl(selectedPaper.url || `https://doi.org/${selectedPaper.doi}`)
                  }
                  className="btn-secondary mt-4 w-full justify-center"
                >
                  <ExternalLink size={14} />
                  Open paper
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
