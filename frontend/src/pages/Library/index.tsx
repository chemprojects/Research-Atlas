import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  FolderPlus,
  Trash2,
  ExternalLink,
  BookMarked,
  Check,
  Edit2,
  ChevronRight,
  Search,
  StickyNote,
  MoreHorizontal,
  Loader2,
  AlertCircle,
  X,
  Send,
  Paperclip,
  Download,
  Upload,
  Sparkles,
  ArrowUpDown,
} from "lucide-react";
import { SaveToLibraryMenu } from "../../components/SaveToLibraryMenu";
import {
  addPaperToLibrary,
  createLibraryFolder,
  foldersContainingPaper,
  removePaperFromLibrary,
  type LibraryFolder,
} from "../../lib/library";
import clsx from "clsx";
import { fetchPapers, mapPaper, type Paper } from "../../api/client";
import { MOCK_PAPERS } from "../../store";
import { ExportMenu } from "../../components/ExportMenu";
import { ImportMenu, type ImportResult } from "../../components/ImportMenu";
import { ImportResultModal } from "../../components/ImportResultModal";
import { DeleteFolderDialog } from "../../components/DeleteFolderDialog";
import { AnchoredMenuPortal } from "../../components/AnchoredMenuPortal";
import { DownloadPdfButton } from "../../components/DownloadPdfButton";
import { sanitizeFilename } from "../../lib/export";
import { deleteLibraryFolder } from "../../lib/library";
import { fetchContextPapers } from "../../lib/chats";
import { formatCitation } from "../../lib/citation";
import {
  streamChatMessage,
  attachLibraryPaperPdf,
  findPaperChatSession,
  createPaperChatSession,
  saveChatSession,
  type ChatAttachment,
  type ChatMessage,
} from "../../lib/chats";
import { fetchBulkPdfStatuses, fetchPdfStatus, type PdfStatus } from "../../lib/pdfDownload";
import { perfEnd, perfStart } from "../../lib/perf";
import {
  downloadPaperPdf,
  uploadPaperPdf,
} from "../../lib/pdfDownload";

import { API_BASE as API } from "../../lib/apiBase";
import { openExternalUrl } from "../../lib/externalLinks";
import { renderRichText } from "../../lib/richText";

const LIBRARY_PAGE_SIZE = 80;

function formatSavedTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const createFolderApi = (name: string) =>
  fetch(`${API}/library/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

const renameFolderApi = (id: string, name: string) =>
  fetch(`${API}/library/folders/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

const removeEntryApi = (paperId: string, folderId: string) =>
  fetch(`${API}/library/entries/${paperId}?folder_id=${folderId}`, { method: "DELETE" });

const saveCommentApi = (paperId: string, folderId: string, comment: string) =>
  fetch(`${API}/library/entries/${paperId}/comment?folder_id=${encodeURIComponent(folderId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment }),
  });

interface LibraryEntry {
  paper_id: string;
  folder_id: string;
  comment?: string;
  comment_updated_at?: string;
}

export default function Library() {
  const [folders, setFolders] = useState<LibraryFolder[]>([
    { id: "default", name: "Reading List", parent: null },
  ]);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [selectedFolder, setSelectedFolder] = useState("default");
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "relevance_desc">("date_desc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [citationStyle, setCitationStyle] = useState<"apa" | "bibtex" | "mla">("apa");
  const [commentText, setCommentText] = useState("");
  const [commentBaseline, setCommentBaseline] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentSaved, setCommentSaved] = useState(false);
  const [commentSaveError, setCommentSaveError] = useState("");
  const [citationNotice, setCitationNotice] = useState("");
  const [pdfStatuses, setPdfStatuses] = useState<Record<string, PdfStatus>>({});
  const [paperChatSessionId, setPaperChatSessionId] = useState<string | null>(null);
  const [paperChatSessionTitle, setPaperChatSessionTitle] = useState<string | null>(null);
  const [paperChatMessages, setPaperChatMessages] = useState<ChatMessage[]>([]);
  const [paperChatInput, setPaperChatInput] = useState("");
  const [paperChatLoading, setPaperChatLoading] = useState(false);
  const [includeFolderPdf, setIncludeFolderPdf] = useState(false);
  const [paperChatAttachment, setPaperChatAttachment] = useState<ChatAttachment | null>(null);
  const [paperChatAttachmentLoading, setPaperChatAttachmentLoading] = useState(false);
  const [paperHasSavedPdf, setPaperHasSavedPdf] = useState(false);
  const [paperPdfHintOpen, setPaperPdfHintOpen] = useState(false);
  const [pdfUploadModalOpen, setPdfUploadModalOpen] = useState(false);
  const [pdfUploadStep, setPdfUploadStep] = useState<"confirm_download" | "upload">("confirm_download");
  const [pdfUploadFile, setPdfUploadFile] = useState<File | null>(null);
  const [pdfUploadDragging, setPdfUploadDragging] = useState(false);
  const [pdfUploadBusy, setPdfUploadBusy] = useState(false);
  const [pdfUploadError, setPdfUploadError] = useState("");
  const [paperChatError, setPaperChatError] = useState("");
  const [allPapers, setAllPapers] = useState<Paper[]>(MOCK_PAPERS);
  const [allPapersLoaded, setAllPapersLoaded] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<LibraryFolder | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(LIBRARY_PAGE_SIZE);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const paperChatEndRef = useRef<HTMLDivElement>(null);
  const paperDetailsScrollRef = useRef<HTMLDivElement>(null);
  const contextFetchMetaRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const paperId = searchParams.get("paper");
    if (!paperId) return;
    const paper = allPapers.find((p) => String(p.id) === paperId);
    if (paper) {
      setSelectedPaper(paper);
      // Clear the query param so refresh doesn't force-reselect
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, allPapers, setSearchParams]);

  const loadLibrary = useCallback(async () => {
    perfStart("library.load");
    try {
      const d = await fetch(`${API}/library/`).then((r) => r.json());
      setFolders(d.folders ?? []);
      setEntries(d.entries ?? []);
    } catch { /* offline */ }
    finally {
      perfEnd("library.load");
    }
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    const entryKey = entries
      .map((e) => `${e.folder_id}:${e.paper_id}`)
      .sort()
      .join("|");
    const now = Date.now();
    const last = contextFetchMetaRef.current;
    if (last.key === entryKey && now - last.at < 5_000) return;
    contextFetchMetaRef.current = { key: entryKey, at: now };

    perfStart("library.context_papers");
    fetchContextPapers("library")
      .then((data) => {
        const savedPapers = (data.papers as Record<string, unknown>[]).map(mapPaper);
        setAllPapers((prev) => {
          if (savedPapers.length === 0) return prev;
          if (!allPapersLoaded) return savedPapers;
          const byId = new Map(prev.map((p) => [String(p.id), p]));
          for (const paper of savedPapers) byId.set(String(paper.id), paper);
          return Array.from(byId.values());
        });
      })
      .catch(() => {})
      .finally(() => {
        perfEnd("library.context_papers");
      });
  }, [entries, allPapersLoaded]);

  const ensureAllPapersLoaded = useCallback(async () => {
    if (allPapersLoaded) return;
    perfStart("library.all_papers_fetch");
    const { papers } = await fetchPapers({ limit: 500 });
    setAllPapers((prev) => {
      const byId = new Map(prev.map((p) => [String(p.id), p]));
      for (const paper of papers) byId.set(String(paper.id), paper);
      return Array.from(byId.values());
    });
    setAllPapersLoaded(true);
    perfEnd("library.all_papers_fetch", { fetched: papers.length });
  }, [allPapersLoaded]);

  const paperById = useMemo(() => {
    const map = new Map<string, Paper>();
    for (const p of allPapers) map.set(String(p.id), p);
    return map;
  }, [allPapers]);

  const allPapersList = useMemo(() => Array.from(paperById.values()), [paperById]);

  useEffect(() => {
    if (folders.length > 0 && !folders.find((f) => f.id === selectedFolder)) {
      setSelectedFolder(folders[0].id);
    }
  }, [folders, selectedFolder]);

  useEffect(() => {
    if (!selectedPaper) {
      setCommentText("");
      setCommentBaseline("");
      setCommentSaved(false);
      setCommentSaveError("");
      return;
    }
    const entry = entries.find(
      (e) => e.paper_id === String(selectedPaper.id) && e.folder_id === selectedFolder,
    );
    const stored = entry?.comment ?? "";
    setCommentText(stored);
    setCommentBaseline(stored);
    setCommentSaved(false);
    setCommentSaveError("");
  }, [selectedPaper, selectedFolder, entries]);

  const saveCurrentComment = useCallback(async () => {
    if (!selectedPaper || commentText === commentBaseline || commentSaving) return;

    setCommentSaving(true);
    setCommentSaveError("");
    try {
      const res = await saveCommentApi(String(selectedPaper.id), selectedFolder, commentText);
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      const saved = data.comment ?? "";
      setEntries((prev) =>
        prev.map((e) =>
          e.paper_id === String(selectedPaper.id) && e.folder_id === selectedFolder
            ? {
                ...e,
                comment: saved || undefined,
                comment_updated_at: data.comment_updated_at,
              }
            : e,
        ),
      );
      setCommentBaseline(saved);
      setCommentSaved(true);
      window.setTimeout(() => setCommentSaved(false), 2000);
    } catch {
      setCommentSaveError("Could not save. Try again.");
    } finally {
      setCommentSaving(false);
    }
  }, [commentBaseline, commentSaving, commentText, selectedFolder, selectedPaper]);

  useEffect(() => {
    if (!selectedPaper || commentText === commentBaseline) return;

    const timer = window.setTimeout(() => {
      void saveCurrentComment();
    }, 700);

    return () => window.clearTimeout(timer);
  }, [commentText, commentBaseline, selectedPaper, saveCurrentComment]);

  const entriesByFolder = useMemo(() => {
    const map = new Map<string, LibraryEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.folder_id) ?? [];
      list.push(entry);
      map.set(entry.folder_id, list);
    }
    return map;
  }, [entries]);

  const entryByPaperAndFolder = useMemo(() => {
    const map = new Map<string, LibraryEntry>();
    for (const entry of entries) {
      map.set(`${entry.folder_id}:${entry.paper_id}`, entry);
    }
    return map;
  }, [entries]);

  const folderCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      map.set(entry.folder_id, (map.get(entry.folder_id) ?? 0) + 1);
    }
    return map;
  }, [entries]);

  const folderEntries = useMemo(
    () => entriesByFolder.get(selectedFolder) ?? [],
    [entriesByFolder, selectedFolder],
  );
  const selectedFolderName =
    folders.find((f) => f.id === selectedFolder)?.name ?? "folder";

  const allLibraryPapers = useMemo(() => {
    const ids = new Set(entries.map((e) => e.paper_id));
    return [...ids]
      .map((id) => paperById.get(id))
      .filter((p): p is Paper => !!p);
  }, [entries, paperById]);

  const folderPapers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = folderEntries
      .map((e) => paperById.get(e.paper_id))
      .filter((p): p is Paper => !!p)
      .filter((p) => {
        if (!query) return true;
        return (
          p.title.toLowerCase().includes(query) ||
          p.authors.some((a) => a.toLowerCase().includes(query)) ||
          (p.journal?.toLowerCase().includes(query) ?? false)
        );
      });

    return [...filtered].sort((a, b) => {
      if (sortBy === "date_desc") {
        return (b.published_date || "").localeCompare(a.published_date || "");
      }
      if (sortBy === "date_asc") {
        return (a.published_date || "").localeCompare(b.published_date || "");
      }
      if (sortBy === "relevance_desc") {
        return (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
      }
      return 0;
    });
  }, [folderEntries, paperById, search, sortBy]);

  const visibleFolderPapers = useMemo(
    () => folderPapers.slice(0, visibleCount),
    [folderPapers, visibleCount],
  );

  useEffect(() => {
    let cancelled = false;
    const ids = visibleFolderPapers.map((paper) => String(paper.id));
    if (ids.length === 0) {
      setPdfStatuses({});
      return;
    }
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
  }, [visibleFolderPapers]);

  const countInFolder = useCallback((id: string) => folderCounts.get(id) ?? 0, [folderCounts]);

  useEffect(() => {
    setVisibleCount(LIBRARY_PAGE_SIZE);
  }, [selectedFolder, search, sortBy]);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await createFolderApi(name);
      await loadLibrary();
    } catch { /* offline */ }
    setCreatingFolder(false);
    setNewFolderName("");
  };

  const papersInFolder = (folderId: string) =>
    entries
      .filter((e) => e.folder_id === folderId)
      .map((e) => paperById.get(e.paper_id))
      .filter((p): p is Paper => !!p);

  const confirmDeleteFolder = async (deletePdfs: boolean) => {
    if (!folderToDelete) return;
    try {
      await deleteLibraryFolder(folderToDelete.id, deletePdfs);
      const remaining = folders.filter((f) => f.id !== folderToDelete.id);
      await loadLibrary();
      if (selectedFolder === folderToDelete.id && remaining.length > 0) {
        setSelectedFolder(remaining[0].id);
      }
      setSelectedPaper(null);
    } catch { /* offline */ }
    setFolderToDelete(null);
  };

  const handleImported = async (result: ImportResult) => {
    await loadLibrary();
    if (result.folderId) setSelectedFolder(result.folderId);
    setImportResult(result);
  };

  const handleRemoveEntry = async (paperId: string) => {
    try {
      await removeEntryApi(paperId, selectedFolder);
      await loadLibrary();
      if (selectedPaper && String(selectedPaper.id) === paperId) setSelectedPaper(null);
    } catch { /* offline */ }
  };

  const savedFolderIdsForPaper = (paperId: string) =>
    foldersContainingPaper(entries, paperId);

  const togglePaperInFolder = async (paperId: string, folderId: string) => {
    const saved = savedFolderIdsForPaper(paperId).has(folderId);
    try {
      if (saved) {
        await removePaperFromLibrary(paperId, folderId);
      } else {
        await addPaperToLibrary(paperId, folderId);
      }
      await loadLibrary();
      if (saved && folderId === selectedFolder && String(selectedPaper?.id) === paperId) {
        setSelectedPaper(null);
      }
      return !saved;
    } catch {
      return saved;
    }
  };

  const createFolderAndSavePaper = async (paperId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      const folder = await createLibraryFolder(trimmed);
      await addPaperToLibrary(paperId, folder.id);
      await loadLibrary();
      setSelectedFolder(folder.id);
      return folder;
    } catch {
      return null;
    }
  };

  const selectedEntry = selectedPaper
    ? entryByPaperAndFolder.get(`${selectedFolder}:${selectedPaper.id}`)
    : undefined;
  const selectedPaperId = selectedPaper ? String(selectedPaper.id) : "";
  const commentDirty = commentText !== commentBaseline;
  const commentSavedAt = formatSavedTime(selectedEntry?.comment_updated_at);
  const commentStatus = commentSaveError
    ? commentSaveError
    : commentSaving
      ? "Saving..."
      : commentDirty
        ? "Unsaved changes"
        : commentSaved
          ? "Saved"
          : commentSavedAt
            ? `Saved ${commentSavedAt}`
            : "Auto-saved locally";

  const copyCitationForStyle = async (style: "apa" | "bibtex" | "mla") => {
    if (!selectedPaper) return;
    setCitationStyle(style);
    try {
      const text = formatCitation(selectedPaper, style);
      await navigator.clipboard.writeText(text);
      setCitationNotice(`${style.toUpperCase()} copied to clipboard`);
    } catch {
      setCitationNotice("Could not copy citation");
    }
    window.setTimeout(() => setCitationNotice(""), 1800);
  };

  useEffect(() => {
    const parent = paperChatEndRef.current?.parentElement;
    if (parent) {
      parent.scrollTop = parent.scrollHeight;
    }
  }, [paperChatMessages, paperChatLoading]);

  useLayoutEffect(() => {
    if (selectedPaper) {
      paperDetailsScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [selectedPaper?.id, selectedFolder]);

  useEffect(() => {
    if (!selectedPaper) {
      setPaperChatSessionId(null);
      setPaperChatSessionTitle(null);
      setPaperChatMessages([]);
      setIncludeFolderPdf(false);
      setPaperChatAttachment(null);
      setPaperChatError("");
      setPaperHasSavedPdf(false);
      setPaperPdfHintOpen(false);
      setPdfUploadModalOpen(false);
      setPdfUploadStep("confirm_download");
      setPdfUploadFile(null);
      setPdfUploadDragging(false);
      setPdfUploadBusy(false);
      setPdfUploadError("");
      return;
    }
    // Keep per-paper behavior deterministic: users opt in to PDF context per paper.
    setIncludeFolderPdf(false);
    setPaperHasSavedPdf(false);
    setPaperChatAttachment(null);
    setPaperPdfHintOpen(false);
    setPdfUploadModalOpen(false);
    setPdfUploadStep("confirm_download");
    setPdfUploadFile(null);
    setPdfUploadDragging(false);
    setPdfUploadBusy(false);
    setPdfUploadError("");
    let cancelled = false;
    const checkPdfAvailability = async () => {
      try {
        const status = await fetchPdfStatus(String(selectedPaper.id));
        if (cancelled) return;
        const hasPdf = status.status === "saved";
        setPaperHasSavedPdf(hasPdf);
        if (hasPdf) {
          setPaperPdfHintOpen(false);
          return;
        }
      } catch {
        if (!cancelled) {
          setPaperHasSavedPdf(false);
        }
      }
    };
    void checkPdfAvailability();
    return () => {
      cancelled = true;
    };
  }, [selectedPaper?.id, selectedFolder]);

  useEffect(() => {
    if (!selectedPaper) {
      setPaperChatSessionId(null);
      setPaperChatSessionTitle(null);
      setPaperChatMessages([]);
      return;
    }
    let cancelled = false;
    const loadSession = async () => {
      try {
        const existing = await findPaperChatSession(String(selectedPaper.id));
        if (cancelled) return;
        if (existing) {
          setPaperChatSessionId(existing.id);
          setPaperChatSessionTitle(existing.title);
          setPaperChatMessages(existing.messages.map((m) => ({ ...m })));
        } else {
          const title = `Chat: ${selectedPaper.title.slice(0, 40)}${selectedPaper.title.length > 40 ? "…" : ""}`;
          const session = await createPaperChatSession(String(selectedPaper.id), title, selectedFolder);
          if (cancelled) return;
          setPaperChatSessionId(session.id);
          setPaperChatSessionTitle(session.title);
          setPaperChatMessages([]);
        }
      } catch {
        if (!cancelled) {
          setPaperChatSessionId(null);
          setPaperChatMessages([]);
        }
      }
    };
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [selectedPaper?.id]);

  useEffect(() => {
    if (!selectedPaper) {
      setPaperChatAttachment(null);
      setPaperChatError("");
      return;
    }
    setPaperChatError("");
    setPaperChatAttachment(null);
    if (!includeFolderPdf) return;
    if (!paperHasSavedPdf) return;

    let cancelled = false;
    const loadPdfAttachment = async () => {
      setPaperChatAttachmentLoading(true);
      try {
        const status = await fetchPdfStatus(String(selectedPaper.id));
        if (cancelled) return;
        if (status.status !== "saved") {
          setPaperChatAttachment(null);
          return;
        }
        const attachment = await attachLibraryPaperPdf(String(selectedPaper.id), selectedFolder);
        if (cancelled) return;
        setPaperChatAttachment(attachment);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Could not load folder PDF";
        if (message.toLowerCase().includes("no saved pdf") || message.toLowerCase().includes("not found")) {
          setPaperChatAttachment(null);
          return;
        }
        setPaperChatAttachment(null);
        setPaperChatError(message);
      } finally {
        setPaperChatAttachmentLoading(false);
      }
    };
    void loadPdfAttachment();
    return () => {
      cancelled = true;
      setPaperChatAttachmentLoading(false);
    };
  }, [includeFolderPdf, selectedFolder, selectedPaper?.id, paperHasSavedPdf]);

  const sendPaperChatMessage = async () => {
    if (!selectedPaper || paperChatLoading) return;
    const prompt = paperChatInput.trim();
    if (!prompt) return;
    if (includeFolderPdf && paperHasSavedPdf) {
      if (paperChatAttachmentLoading) {
        setPaperChatError("PDF context is still loading. Please wait a moment and send again.");
        return;
      }
      if (!paperChatAttachment) {
        setPaperChatError("PDF context is not attached yet. Toggle Load folder PDF off/on and retry.");
        return;
      }
    }
    setPaperChatInput("");
    setPaperChatError("");
    const base = paperChatMessages;
    const userMessage: ChatMessage = { role: "user", content: prompt };
    const nextMessages: ChatMessage[] = [...base, userMessage];
    const streamingAssistant: ChatMessage = { role: "assistant", content: "" };
    setPaperChatMessages([...nextMessages, streamingAssistant]);
    setPaperChatLoading(true);

    let finalMessages: ChatMessage[] = [];
    try {
      const history = nextMessages.slice(-10);
      const resp = await streamChatMessage({
        message: prompt,
        history,
        paper_context: [selectedPaper] as unknown as Record<string, unknown>[],
        attachments: paperChatAttachment ? [paperChatAttachment] : [],
        speed_preset: "quality",
      });
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No stream returned");
      const decoder = new TextDecoder();
      let assistantText = "";
      let buffered = "";

      const setAssistant = (content: string) => {
        setPaperChatMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content };
          return updated;
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6)) as { token?: string; error?: string };
          if (data.error) throw new Error(data.error);
          if (data.token) {
            assistantText += data.token;
            setAssistant(assistantText);
          }
        }
      }

      finalMessages = [
        ...nextMessages,
        { role: "assistant", content: assistantText || "No response." },
      ];
      setPaperChatMessages(finalMessages);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not reach AI model";
      setPaperChatError(message);
      finalMessages = [
        ...nextMessages,
        { role: "assistant", content: "Sorry, I couldn't answer right now. Please make sure Ollama is running." },
      ];
      setPaperChatMessages(finalMessages);
    } finally {
      setPaperChatLoading(false);
      if (paperChatSessionId && finalMessages.length > 0) {
        try {
          await saveChatSession(paperChatSessionId, { messages: finalMessages, title: paperChatSessionTitle || undefined });
        } catch {
          // offline
        }
      }
    }
  };

  const handleToggleLoadPdf = async () => {
    if (!selectedPaper) return;
    if (!paperHasSavedPdf) {
      // Re-check on click so quick folder/paper switches don't leave stale
      // "not found" state when a PDF is actually saved.
      try {
        const status = await fetchPdfStatus(String(selectedPaper.id));
        if (status.status === "saved") {
          setPaperHasSavedPdf(true);
          setPaperPdfHintOpen(false);
          setIncludeFolderPdf(true);
          return;
        }
      } catch {
        // fall through to upload flow
      }
      setIncludeFolderPdf(false);
      setPaperPdfHintOpen(true);
      setPdfUploadStep("confirm_download");
      setPdfUploadModalOpen(true);
      return;
    }
    setPaperPdfHintOpen(false);
    setIncludeFolderPdf((v) => !v);
  };

  const pickPdfFile = (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setPdfUploadError("Please upload a PDF file.");
      return;
    }
    setPdfUploadError("");
    setPdfUploadFile(file);
  };

  const handleAttemptSourceDownload = async () => {
    if (!selectedPaper || pdfUploadBusy) return;
    setPdfUploadBusy(true);
    setPdfUploadError("");
    try {
      const result = await downloadPaperPdf(String(selectedPaper.id), selectedFolder, selectedPaper);
      if (result.status === "saved") {
        setPaperHasSavedPdf(true);
        setIncludeFolderPdf(true);
        setPaperPdfHintOpen(false);
        setPdfUploadModalOpen(false);
        setPdfUploadFile(null);
        return;
      }
      setPdfUploadStep("upload");
      setPdfUploadError("Automatic source download did not find a usable PDF. Upload manually.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Automatic source download failed.";
      setPdfUploadStep("upload");
      setPdfUploadError(`${message} Please upload the PDF manually.`);
    } finally {
      setPdfUploadBusy(false);
    }
  };

  const handleUploadPdf = async () => {
    if (!selectedPaper || !pdfUploadFile || pdfUploadBusy) return;
    setPdfUploadBusy(true);
    setPdfUploadError("");
    try {
      const result = await uploadPaperPdf(String(selectedPaper.id), pdfUploadFile, {
        folderId: selectedFolder,
        folderName: selectedFolderName,
        paper: selectedPaper,
      });
      const hasPdf = result.status === "saved";
      setPaperHasSavedPdf(hasPdf);
      setPaperPdfHintOpen(!hasPdf);
      setIncludeFolderPdf(hasPdf);
      setPdfUploadModalOpen(false);
      setPdfUploadFile(null);
      setPaperChatError("");
    } catch (e) {
      setPdfUploadError(e instanceof Error ? e.message : "Could not upload PDF");
    } finally {
      setPdfUploadBusy(false);
    }
  };

  const closePdfUploadModal = () => {
    if (pdfUploadBusy) return;
    setPdfUploadModalOpen(false);
    setPdfUploadStep("confirm_download");
    setPdfUploadFile(null);
    setPdfUploadDragging(false);
    setPdfUploadError("");
    setPaperChatAttachmentLoading(false);
  };

  const openPaperDetails = (paper: Paper) => {
    // Prevent the browser from keeping a bottom input (comment/chat) in view
    // when switching papers.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setSelectedPaper(paper);
    requestAnimationFrame(() => {
      paperDetailsScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
      window.setTimeout(() => {
        paperDetailsScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
      }, 0);
    });
  };

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-surface-border bg-surface-raised px-5 py-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
              <BookMarked size={22} className="text-primary-400" />
              Library
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {entries.length} saved papers across {folders.length} folders
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            <ImportMenu
              scope="library"
              folders={folders}
              entries={entries}
              allPapers={allPapersList}
              onOpen={ensureAllPapersLoaded}
              onImported={handleImported}
            />
            <ImportMenu
              scope="folder"
              label="Import to folder"
              folderId={selectedFolder}
              folderName={selectedFolderName}
              folders={folders}
              entries={entries}
              allPapers={allPapersList}
              onOpen={ensureAllPapersLoaded}
              onImported={handleImported}
            />
            <ExportMenu
              papers={allLibraryPapers}
              label="Export library"
              filenameBase="research_atlas_library"
            />
            <ExportMenu
              papers={folderPapers}
              label="Export folder"
              filenameBase={sanitizeFilename(selectedFolderName)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pb-1">
          <div className="flex items-center gap-2 overflow-x-auto min-w-0">
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setSelectedFolder(f.id);
                  setSelectedPaper(null);
                  setFolderMenuOpen(false);
                }}
                className={clsx(
                  "flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium border transition-colors",
                  selectedFolder === f.id
                    ? "bg-primary-500/20 border-primary-500/40 text-primary-200"
                    : "bg-surface-overlay border-surface-border text-gray-300 hover:text-gray-100",
                )}
              >
                {f.name}
                <span className="ml-2 text-gray-500">{countInFolder(f.id)}</span>
              </button>
            ))}
            {creatingFolder ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreateFolder();
                }}
                className="flex-shrink-0"
              >
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onBlur={() => {
                    if (!newFolderName.trim()) setCreatingFolder(false);
                    else handleCreateFolder();
                  }}
                  placeholder="Folder name"
                  className="input text-sm py-1.5 w-36"
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreatingFolder(true)}
                className="flex-shrink-0 p-2 rounded-full border border-dashed border-surface-border text-gray-400 hover:text-primary-300 hover:border-primary-500/40"
                title="New folder"
              >
                <FolderPlus size={16} />
              </button>
            )}
          </div>
          <div className="relative flex-shrink-0" ref={folderMenuRef}>
            <button
              type="button"
              onClick={() => setFolderMenuOpen((v) => !v)}
              className="btn-secondary text-xs px-2 py-1.5"
              title="Folder options"
            >
              <MoreHorizontal size={14} />
              Folder
            </button>
            <AnchoredMenuPortal
              open={folderMenuOpen}
              anchorRef={folderMenuRef}
              onClose={() => setFolderMenuOpen(false)}
              width={176}
              align="end"
            >
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-200 hover:bg-surface-overlay"
                    onClick={() => {
                      setEditingId(selectedFolder);
                      setEditName(folders.find((f) => f.id === selectedFolder)?.name ?? "");
                      setFolderMenuOpen(false);
                    }}
                  >
                    <Edit2 size={14} /> Rename folder
                  </button>
                  {folders.length > 1 && (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-400 hover:bg-red-500/10"
                      onClick={() => {
                        setFolderToDelete(folders.find((f) => f.id === selectedFolder) ?? null);
                        setFolderMenuOpen(false);
                      }}
                    >
                      <Trash2 size={14} /> Delete folder
                    </button>
                  )}

            </AnchoredMenuPortal>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="w-full md:w-[42%] lg:w-[38%] border-r border-surface-border flex flex-col min-h-0">
          <div className="p-3 border-b border-surface-border flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input pl-9 text-sm w-full"
                placeholder="Search saved papers…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="relative shrink-0 flex items-center">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="input text-xs py-1.5 pl-2 pr-6 appearance-none bg-surface-raised cursor-pointer border border-surface-border rounded-xl font-medium"
                title="Sort papers"
              >
                <option value="date_desc">Newest</option>
                <option value="date_asc">Oldest</option>
                <option value="relevance_desc">Relevance</option>
              </select>
              <ArrowUpDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {folderPapers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 px-6 text-center">
                <p className="text-sm text-gray-400">No papers in this folder.</p>
                <p className="text-sm text-gray-500 mt-1">
                  Save papers from Daily Digest using &ldquo;Save to folder&rdquo;.
                </p>
              </div>
            ) : (
              <ul>
                {visibleFolderPapers.map((paper) => {
                  const active = selectedPaper?.id === paper.id;
                  const entry = entryByPaperAndFolder.get(`${selectedFolder}:${paper.id}`);
                  const hasComment = Boolean(entry?.comment?.trim());
                  const sourceHref = paper.doi
                    ? `https://doi.org/${paper.doi}`
                    : paper.url || "";
                  const sourceLabel = paper.doi ? `DOI: ${paper.doi}` : sourceHref ? "Source link" : "";
                  return (
                    <li key={paper.id}>
                      <button
                        type="button"
                        onClick={() => openPaperDetails(paper)}
                        className={clsx(
                          "w-full text-left px-4 py-3 border-b border-surface-border/60 transition-colors",
                          active
                            ? "bg-primary-500/10 border-l-2 border-l-primary-400"
                            : "hover:bg-surface-overlay border-l-2 border-l-transparent",
                        )}
                      >
                        <p className={clsx("text-sm font-medium leading-snug line-clamp-2", active ? "text-gray-100" : "text-gray-200")}>
                          {renderRichText(paper.title)}
                        </p>
                        <p className="text-xs text-gray-500 mt-1 truncate">
                          {paper.authors.slice(0, 2).join(", ")}
                          {paper.authors.length > 2 ? " et al." : ""}
                          {paper.published_date ? ` · ${paper.published_date.slice(0, 10)}` : ""}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {sourceHref && (
                            <button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseUp={() => void openExternalUrl(sourceHref)}
                              className="text-xs text-primary-300 hover:text-primary-200 hover:underline truncate max-w-[220px] text-left"
                              title={sourceLabel}
                            >
                              {sourceLabel}
                            </button>
                          )}
                          {hasComment && (
                            <StickyNote size={12} className="text-amber-400/90" aria-label="Has a comment" />
                          )}
                          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
                            <DownloadPdfButton
                              paperId={String(paper.id)}
                              paper={paper}
                              folderId={selectedFolder}
                              initialStatus={pdfStatuses[String(paper.id)]}
                              deferStatusFetch
                              compact
                            />
                          </span>
                          <ChevronRight size={14} className={clsx("text-gray-600", active && "text-primary-400")} />
                        </div>
                      </button>
                    </li>
                  );
                })}
                {visibleCount < folderPapers.length && (
                  <li className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((count) => count + LIBRARY_PAGE_SIZE)}
                      className="btn-secondary w-full justify-center text-sm"
                    >
                      Show more ({folderPapers.length - visibleCount} remaining)
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="hidden md:flex flex-1 flex-col min-h-0 bg-surface">
          {selectedPaper ? (
            <>
              <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-surface-border">
                <h2 className="text-base font-semibold text-gray-100 leading-snug pr-4 self-center">
                  {renderRichText(selectedPaper.title)}
                </h2>
                <div className="flex flex-col items-end gap-2 flex-shrink-0 max-w-[58%]">
                  <div className="flex items-center justify-end gap-2 w-full">
                    <SaveToLibraryMenu
                      compact
                      folders={folders}
                      savedFolderIds={savedFolderIdsForPaper(String(selectedPaper.id))}
                      onToggleFolder={(folderId) =>
                        togglePaperInFolder(String(selectedPaper.id), folderId)
                      }
                      onCreateFolderAndSave={(name) =>
                        createFolderAndSavePaper(String(selectedPaper.id), name)
                      }
                    />
                    <DownloadPdfButton
                      paperId={String(selectedPaper.id)}
                      paper={selectedPaper}
                      folderId={selectedFolder}
                      initialStatus={pdfStatuses[String(selectedPaper.id)]}
                      deferStatusFetch
                      compact
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveEntry(String(selectedPaper.id))}
                      className="btn-secondary text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                      title={`Remove from ${selectedFolderName} only`}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                  <div className="flex items-center justify-end gap-2 w-full">
                    {(selectedPaper.url || selectedPaper.doi) && (
                      <button
                        type="button"
                        onClick={() =>
                          void openExternalUrl(selectedPaper.url || `https://doi.org/${selectedPaper.doi}`)
                        }
                        className="btn-secondary text-xs inline-flex"
                      >
                        <ExternalLink size={13} /> Open paper
                      </button>
                    )}
                    <div className="inline-flex items-center rounded-lg border border-surface-border overflow-hidden">
                      {(["apa", "bibtex", "mla"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void copyCitationForStyle(s)}
                          className={clsx(
                            "px-2.5 py-1 text-xs font-medium uppercase transition-colors border-r border-surface-border last:border-r-0",
                            citationStyle === s
                              ? "bg-primary-500 text-white"
                              : "text-gray-400 hover:text-gray-200 hover:bg-surface-overlay",
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    {citationNotice && (
                      <span className="text-xs text-green-400 whitespace-nowrap">{citationNotice}</span>
                    )}
                  </div>
                </div>
              </div>

              <div ref={paperDetailsScrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                <p className="text-sm text-gray-400">
                  {selectedPaper.authors.join(", ")}
                  {selectedPaper.journal ? (
                    <>
                      {" · "}
                      <em>{selectedPaper.journal}</em>
                    </>
                  ) : null}
                  {selectedPaper.published_date ? ` · ${selectedPaper.published_date.slice(0, 10)}` : ""}
                </p>

                {(selectedPaper.summary?.trim() || selectedPaper.abstract?.trim()) && (
                  <section>
                    <p className="text-sm text-gray-300 leading-relaxed">
                      {renderRichText(selectedPaper.summary?.trim() || selectedPaper.abstract?.trim() || "")}
                    </p>
                  </section>
                )}

                {selectedPaper.why_it_matters?.trim() && (
                  <p className="text-sm text-primary-200 italic leading-relaxed rounded-lg border border-primary-500/20 bg-primary-500/10 px-3 py-2">
                    {selectedPaper.why_it_matters.trim()}
                  </p>
                )}

                {(selectedPaper.keywords?.length || selectedPaper.methods?.length) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {[...(selectedPaper.methods ?? []), ...(selectedPaper.keywords ?? [])].map((tag) => (
                      <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-surface-overlay border border-surface-border text-gray-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                <section className="library-ai-panel rounded-xl border border-surface-border bg-surface-raised overflow-hidden">
                  <div className="library-divider px-4 py-3 border-b border-surface-border/70 flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">AI Paper Chat</h3>
                    <div className="inline-flex items-center gap-3 text-xs text-gray-300">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={includeFolderPdf && paperHasSavedPdf}
                        onClick={handleToggleLoadPdf}
                        className={clsx(
                          "relative rounded-full transition-colors",
                          includeFolderPdf && paperHasSavedPdf ? "bg-primary-500" : "bg-surface-border",
                        )}
                        style={{ width: 40, height: 22 }}
                        title={paperHasSavedPdf ? (includeFolderPdf ? "Disable PDF loading" : "Enable PDF loading") : "No saved PDF in folder"}
                      >
                        <div
                          className="absolute top-0.5 rounded-full bg-white shadow transition-transform"
                          style={{
                            width: 18,
                            height: 18,
                            transform: includeFolderPdf && paperHasSavedPdf ? "translateX(20px)" : "translateX(2px)",
                          }}
                        />
                      </button>
                      <span>Load folder PDF</span>
                      {includeFolderPdf && paperChatAttachment && (
                        <span className="inline-flex items-center gap-1.5 text-green-400">
                          <Paperclip size={12} />
                          PDF loaded ({Math.max(0, Math.floor((paperChatAttachment.text_length || 0) / 1000))}k chars)
                        </span>
                      )}
                    </div>
                  </div>
                  {(paperChatAttachmentLoading || paperChatError || paperPdfHintOpen) && (
                  <div className="library-divider px-4 py-2 border-b border-surface-border/70">
                    {paperChatAttachmentLoading ? (
                      <p className="text-xs text-gray-400 inline-flex items-center gap-1.5">
                        <Loader2 size={12} className="animate-spin" />
                        Loading PDF context…
                      </p>
                    ) : null}
                    {paperChatError && <p className="text-xs text-red-400 mt-1">{paperChatError}</p>}
                    {paperPdfHintOpen && (
                      <div className="mt-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                        <p className="text-xs text-amber-300 leading-relaxed">
                          No saved PDF found for this paper yet. Upload one now to link it directly to this paper for AI context.
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPdfUploadModalOpen(true)}
                            className="btn-secondary text-xs px-2.5 py-1.5"
                          >
                            Upload PDF
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  )}
                  <div className="library-divider px-4 py-2 border-b border-surface-border/70">
                    <div className="library-ai-response rounded-lg border border-surface-border bg-surface-raised px-3 py-2 min-h-[180px] max-h-[320px] overflow-y-auto text-sm text-gray-200 space-y-3">
                      {paperChatMessages.length === 0 ? (
                        <span className="text-gray-500">No messages yet.</span>
                      ) : (
                        paperChatMessages.map((msg, i) => (
                          <div key={i} className={clsx(msg.role === "user" ? "flex justify-end" : "flex gap-2")}>
                            {msg.role === "assistant" && (
                              <div className="w-6 h-6 rounded bg-primary-500/10 border border-primary-500/20 flex items-center justify-center shrink-0 mt-0.5">
                                <Sparkles size={12} className="text-primary-400" />
                              </div>
                            )}
                            <div className={clsx(
                              msg.role === "user"
                                ? "max-w-[85%] rounded-2xl bg-surface-overlay border border-surface-border px-3 py-2 text-gray-100"
                                : "flex-1 text-gray-200 leading-relaxed"
                            )}>
                              {msg.content === "" && paperChatLoading && i === paperChatMessages.length - 1 ? (
                                <span className="flex items-center gap-1 text-gray-500">
                                  <span className="w-1 h-1 rounded-full bg-gray-500 animate-pulse" />
                                  <span className="w-1 h-1 rounded-full bg-gray-500 animate-pulse [animation-delay:150ms]" />
                                  <span className="w-1 h-1 rounded-full bg-gray-500 animate-pulse [animation-delay:300ms]" />
                                </span>
                              ) : (
                                renderRichText(msg.content)
                              )}
                            </div>
                          </div>
                        ))
                      )}
                      <div ref={paperChatEndRef} />
                    </div>
                  </div>
                  <div className="p-2.5">
                    <div className="library-ai-composer flex items-center gap-2 rounded-xl border border-surface-border bg-surface-raised px-3 py-2 focus-within:border-primary-500/40">
                      <textarea
                        value={paperChatInput}
                        onChange={(e) => setPaperChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void sendPaperChatMessage();
                          }
                        }}
                        placeholder={paperChatLoading ? "Running …" : "Ask AI about this paper…"}
                        rows={1}
                        disabled={paperChatLoading}
                        className={clsx(
                          "flex-1 resize-none bg-transparent text-sm focus:outline-none min-h-[30px] max-h-28 leading-6 py-1",
                          paperChatLoading ? "text-red-400 placeholder-red-400" : "text-gray-200 placeholder-gray-500"
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => void sendPaperChatMessage()}
                        disabled={!paperChatInput.trim() || paperChatLoading}
                        className={clsx(
                          "h-10 w-10 rounded-full inline-flex items-center justify-center transition-colors",
                          !paperChatInput.trim() || paperChatLoading
                            ? "bg-surface-overlay text-gray-600 cursor-not-allowed"
                            : "bg-primary-500 hover:bg-primary-600 text-white",
                        )}
                        title="Send"
                      >
                        {paperChatLoading ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Send size={15} />
                        )}
                      </button>
                    </div>
                  </div>
                </section>

                <section className="border-t border-surface-border pt-4">
                  <div className="library-comment-panel rounded-lg border border-surface-border bg-surface-raised overflow-hidden">
                    <div className="library-divider flex items-center justify-between gap-3 px-3 py-2 border-b border-surface-border/70">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                        <StickyNote size={14} className="text-amber-400/90" />
                        Your comment
                      </h3>
                      <span
                        className={clsx(
                          "inline-flex items-center gap-1.5 text-xs font-medium",
                          commentSaveError
                            ? "text-red-400"
                            : commentSaving || commentDirty
                              ? "text-amber-300"
                              : "text-green-400",
                        )}
                      >
                        {commentSaveError ? (
                          <AlertCircle size={13} />
                        ) : commentSaving ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : !commentDirty ? (
                          <Check size={13} />
                        ) : null}
                        {commentStatus}
                      </span>
                    </div>
                    <textarea
                      className="library-comment-textarea w-full min-h-[44px] max-h-[72px] resize-y bg-surface px-3 py-2 text-sm leading-relaxed text-gray-200 placeholder:text-gray-500 outline-none focus:bg-surface-overlay"
                      placeholder="What should you remember about this paper?"
                      value={commentText}
                      onChange={(e) => {
                        setCommentText(e.target.value);
                        setCommentSaved(false);
                        setCommentSaveError("");
                      }}
                    />
                    {commentDirty && (
                      <div className="library-divider px-3 py-2 border-t border-surface-border/60 text-xs">
                        <button
                          type="button"
                          onClick={() => void saveCurrentComment()}
                          disabled={commentSaving}
                          className="text-primary-300 hover:text-primary-200 disabled:opacity-50"
                        >
                          Save now
                        </button>
                      </div>
                    )}
                  </div>
                </section>

              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-center px-8">
              <BookMarked size={48} className="text-gray-700 mb-4" />
              <p className="text-base font-medium text-gray-300">Select a paper</p>
              <p className="text-sm text-gray-500 mt-2 max-w-sm">
                Choose an item from the list to read its summary and details here.
              </p>
            </div>
          )}
        </div>
      </div>

      {pdfUploadModalOpen && selectedPaper && (
        <div
          className="fixed inset-0 z-[80] bg-black/45 flex items-center justify-center p-4"
          onClick={closePdfUploadModal}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-surface-border bg-surface-raised shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-100">Upload PDF For This Paper</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closePdfUploadModal}
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-400">
                We first try automatic source download with your permission. If unavailable, upload a PDF and we will link it to this paper.
              </p>
              {pdfUploadStep === "confirm_download" ? (
                <div className="rounded-lg border border-surface-border bg-surface px-4 py-4">
                  <p className="text-sm text-gray-200">
                    Try to download PDF from the paper source for:
                  </p>
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{selectedPaper.title}</p>
                  <button
                    type="button"
                    className="btn-primary mt-3"
                    disabled={pdfUploadBusy}
                    onClick={() => void handleAttemptSourceDownload()}
                  >
                    {pdfUploadBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    Try Source Download
                  </button>
                </div>
              ) : (
                <>
                  <label
                    className={clsx(
                      "block rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors cursor-pointer",
                      pdfUploadDragging
                        ? "border-primary-400 bg-primary-500/10"
                        : "border-surface-border hover:border-primary-400/70 hover:bg-surface-overlay",
                    )}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setPdfUploadDragging(true);
                    }}
                    onDragLeave={() => setPdfUploadDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setPdfUploadDragging(false);
                      pickPdfFile(e.dataTransfer.files?.[0] ?? null);
                    }}
                  >
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => pickPdfFile(e.target.files?.[0] ?? null)}
                    />
                    <Upload size={18} className="mx-auto mb-2 text-primary-300" />
                    <div className="text-sm text-gray-200">Drag & drop PDF or click to browse</div>
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">{selectedPaper.title}</div>
                  </label>
                  {pdfUploadFile && (
                    <div className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs text-gray-300 flex items-center justify-between">
                      <span className="truncate pr-3">{pdfUploadFile.name}</span>
                      <button
                        type="button"
                        onClick={() => setPdfUploadFile(null)}
                        className="text-gray-400 hover:text-gray-200"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </>
              )}
              {pdfUploadError && <p className="text-xs text-red-400">{pdfUploadError}</p>}
            </div>
            <div className="px-4 py-3 border-t border-surface-border flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={closePdfUploadModal}
                disabled={pdfUploadBusy}
              >
                Cancel
              </button>
              {pdfUploadStep === "upload" ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!pdfUploadFile || pdfUploadBusy}
                  onClick={() => void handleUploadPdf()}
                >
                  {pdfUploadBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Upload & Link
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={pdfUploadBusy}
                  onClick={() => setPdfUploadStep("upload")}
                >
                  Skip To Manual Upload
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {folderToDelete && (
        <DeleteFolderDialog
          folderId={folderToDelete.id}
          folderName={folderToDelete.name}
          paperCount={countInFolder(folderToDelete.id)}
          papers={papersInFolder(folderToDelete.id)}
          isLastFolder={folders.length <= 1}
          onCancel={() => setFolderToDelete(null)}
          onConfirm={confirmDeleteFolder}
        />
      )}

      <ImportResultModal result={importResult} onClose={() => setImportResult(null)} />

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            className="card max-w-sm w-full"
            onSubmit={(e) => {
              e.preventDefault();
              renameFolderApi(editingId, editName).then(loadLibrary);
              setEditingId(null);
            }}
          >
            <h3 className="text-sm font-semibold text-gray-200 mb-3">Rename folder</h3>
            <input
              autoFocus
              className="input mb-3"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
