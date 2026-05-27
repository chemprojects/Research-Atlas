import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import type { Paper } from "../api/client";
import { fetchLibrary, type LibraryData, type LibraryFolder, type LibraryEntry, foldersContainingPaper } from "../lib/library";
import {
  fetchChatSettings,
  updateChatSettings,
  fetchChatSessions,
  createChatSession,
  fetchChatSession,
  saveChatSession,
  deleteChatSession,
  deleteAllChatSessions,
  streamChatMessage,
  uploadChatAttachment,
  attachLibraryPaperPdf,
  type ChatAttachment,
  type ChatMessage,
  type ChatSessionMeta,
  type ChatSettings,
  type ChatSession,
  type ChatProject,
  fetchChatProjects,
  createChatProject,
  renameChatProject,
  deleteChatProject,
  uploadChatProjectFile,
  deleteChatProjectFile,
  fetchChatProjectContext,
} from "../lib/chats";
import { API_BASE } from "../lib/apiBase";
import { downloadChatExport, type ChatExportFormat } from "../lib/chatExport";
import {
  selectionFromSettings,
  selectionToSettingsPayload,
  selectionLabel,
  mergeLibraryFolders,
  defaultSelection,
  type ContextSelection,
} from "../components/ChatContextPicker";
import {
  resolveContextPapers,
  contextEntryCount,
  selectRelevantContextPapers,
} from "../lib/chatContext";

const DEFAULT_STORAGE = "~/.research_atlas/chats";
const CHAT_SPEED_PRESET_KEY = "research_atlas_chat_speed_preset_v1";
const LIBRARY_CACHE_TTL_MS = 20_000;
const SESSION_LIST_CACHE_TTL_MS = 8_000;
const PROJECT_CONTEXT_CACHE_TTL_MS = 30_000;

type ChatSpeedPreset = "fast" | "balanced" | "quality";
type ChatMode = "library" | "projects" | "free";

type Message = ChatMessage & { streaming?: boolean };


interface ChatContextValue {
  booting: boolean;
  messages: Message[];
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  chatPhase: string;
  sendMessage: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  contextName: string;
  displayPaperCount: number;
  folders: LibraryFolder[];
  libraryEntries: LibraryEntry[];
  contextSelection: ContextSelection;
  applyContextSelection: (sel: ContextSelection) => Promise<void>;
  loadLibrary: () => Promise<void>;
  sessions: ChatSessionMeta[];
  activeId: string | null;
  selectSession: (id: string) => Promise<void>;
  handleNewChat: () => Promise<void>;
  handleDeleteSession: (e: React.MouseEvent, id: string) => Promise<void>;
  selectMode: boolean;
  setSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  exportSelection: Set<string>;
  setExportSelection: React.Dispatch<React.SetStateAction<Set<string>>>;
  chatSearch: string;
  setChatSearch: (v: string) => void;
  filteredSessions: ChatSessionMeta[];
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  settings: ChatSettings | null;
  storageInput: string;
  setStorageInput: (v: string) => void;
  saveStoragePath: () => Promise<void>;
  resetStoragePath: () => void;
  exportFormat: ChatExportFormat;
  setExportFormat: (f: ChatExportFormat) => void;
  exportSessions: (ids: string[]) => Promise<void>;
  deleteAllChats: () => Promise<void>;
  attachments: ChatAttachment[];
  uploadingAttachment: boolean;
  uploadAttachment: (file: File) => Promise<ChatAttachment | null>;
  removeAttachment: (id: string) => void;
  stickyAttachments: ChatAttachment[];
  addStickyAttachment: (att: ChatAttachment) => void;
  removeStickyAttachment: (id: string) => void;
  stopStreaming: () => void;
  editMessage: (index: number, content: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  canRenameSession: (id: string) => boolean;
  isCurrentChatEmpty: boolean;
  projects: ChatProject[];
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;
  createProject: (name: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  uploadProjectFile: (projectId: string, file: File) => Promise<void>;
  deleteProjectFile: (projectId: string, fileId: string) => Promise<void>;
  chatSpeedPreset: ChatSpeedPreset;
  setChatSpeedPreset: (preset: ChatSpeedPreset) => void;
  suggestedPdfAttachment: { paperId: string; folderId: string | null } | null;
  attachSuggestedPdf: () => Promise<void>;
  dismissPdfSuggestion: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [contextSelection, setContextSelection] = useState<ContextSelection>(defaultSelection());
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatPhase, setChatPhase] = useState("");
  const [folders, setFolders] = useState<LibraryFolder[]>([
    { id: "default", name: "Reading List", parent: null },
  ]);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [contextPapers, setContextPapers] = useState<Paper[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storageInput, setStorageInput] = useState("");
  const [booting, setBooting] = useState(true);
  const [exportFormat, setExportFormat] = useState<ChatExportFormat>("markdown");
  const [exportSelection, setExportSelection] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [stickyAttachments, setStickyAttachments] = useState<ChatAttachment[]>([]);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [chatMode, setChatModeState] = useState<ChatMode>("library");
  const [projectContextCache, setProjectContextCache] = useState<Record<string, ChatAttachment[]>>({});
  const [chatSpeedPreset, setChatSpeedPresetState] = useState<ChatSpeedPreset>(() => {
    if (typeof window === "undefined") return "balanced";
    const raw = window.localStorage.getItem(CHAT_SPEED_PRESET_KEY);
    return raw === "fast" || raw === "balanced" || raw === "quality" ? raw : "balanced";
  });
  const [suggestedPdfAttachment, setSuggestedPdfAttachment] = useState<{ paperId: string; folderId: string | null } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextLoadMetaRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const contextLoadSeqRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);
  const libraryFetchRef = useRef<{ at: number; inFlight: Promise<LibraryData> | null }>({ at: 0, inFlight: null });
  const librarySnapshotRef = useRef<LibraryData>({
    folders: [{ id: "default", name: "Reading List", parent: null }],
    entries: [],
  });
  const sessionListCacheRef = useRef(new Map<string, { at: number; list: ChatSessionMeta[] }>());
  const sessionListInFlightRef = useRef(new Map<string, Promise<ChatSessionMeta[]>>());
  const projectContextMetaRef = useRef(new Map<string, number>());
  const projectContextInFlightRef = useRef(new Map<string, Promise<ChatAttachment[]>>());
  const [chatApiReady, setChatApiReady] = useState(false);

  const loadContextPapers = useCallback(async (
    selection: ContextSelection,
    entries: LibraryEntry[],
    force = false,
  ) => {
    const folderIds = Array.from(selection.folderIds).sort().join(",");
    const key = `${selection.wholeLibrary ? "all" : "folders"}:${folderIds}|entries:${entries.length}`;
    const now = Date.now();
    const last = contextLoadMetaRef.current;
    if (!force && last.key === key && now - last.at < 15_000) return;
    contextLoadMetaRef.current = { key, at: now };
    const seq = ++contextLoadSeqRef.current;
    setContextLoading(true);
    try {
      const next = await resolveContextPapers(selection, entries);
      if (seq === contextLoadSeqRef.current) {
        setContextPapers(next);
      }
    } catch {
      if (seq === contextLoadSeqRef.current) {
        setContextPapers([]);
      }
    } finally {
      if (seq === contextLoadSeqRef.current) {
        setContextLoading(false);
      }
    }
  }, []);

  const loadLibrary = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - libraryFetchRef.current.at < LIBRARY_CACHE_TTL_MS && libraryEntries.length > 0) {
      return;
    }
    if (libraryFetchRef.current.inFlight) {
      const pending = await libraryFetchRef.current.inFlight;
      const next = { folders: pending.folders ?? [], entries: pending.entries ?? [] };
      librarySnapshotRef.current = next;
      setFolders(next.folders);
      setLibraryEntries(next.entries);
      return;
    }
    const req = fetchLibrary();
    libraryFetchRef.current.inFlight = req;
    try {
      const lib = await req;
      libraryFetchRef.current.at = Date.now();
      const next = { folders: lib.folders ?? [], entries: lib.entries ?? [] };
      librarySnapshotRef.current = next;
      setFolders(next.folders);
      setLibraryEntries(next.entries);
    } finally {
      libraryFetchRef.current.inFlight = null;
    }
  }, [libraryEntries.length]);

  const sessionsCacheKey = (projectId?: string | null) => projectId ?? "__library__";

  const filterSessionsByMode = useCallback((list: ChatSessionMeta[], mode: ChatMode): ChatSessionMeta[] => {
    if (mode === "projects") return list.filter((item) => Boolean(item.project_id));
    if (mode === "free") {
      return list.filter((item) => String(item.context_scope || "").toLowerCase() === "free" && !item.paper_id && !item.project_id);
    }
    // library mode: exclude free chats and project chats, but include paper chats
    return list.filter((item) => String(item.context_scope || "").toLowerCase() !== "free" && !item.project_id);
  }, []);

  const getSessionSeedContext = useCallback((mode: ChatMode) => {
    if (mode === "free") {
      return { context_scope: "free" as const, context_folder_id: null as string | null };
    }
    const payload = selectionToSettingsPayload(contextSelection);
    return {
      context_scope: payload.context_scope,
      context_folder_id: payload.context_folder_id,
    };
  }, [contextSelection]);

  const fetchSessionsCached = useCallback(async (
    projectId?: string | null,
    force = false,
  ): Promise<ChatSessionMeta[]> => {
    const key = sessionsCacheKey(projectId);
    const now = Date.now();
    const cached = sessionListCacheRef.current.get(key);
    if (!force && cached && now - cached.at < SESSION_LIST_CACHE_TTL_MS) {
      return cached.list;
    }
    const inFlight = sessionListInFlightRef.current.get(key);
    if (inFlight) return inFlight;
    const req = fetchChatSessions(projectId)
      .then((list) => {
        sessionListCacheRef.current.set(key, { at: Date.now(), list });
        return list;
      })
      .finally(() => {
        sessionListInFlightRef.current.delete(key);
      });
    sessionListInFlightRef.current.set(key, req);
    return req;
  }, []);

  const refreshSessions = useCallback(async (projectId?: string | null, force = false) => {
    setSessions(await fetchSessionsCached(projectId, force));
  }, [fetchSessionsCached]);

  const ensureProjectContext = useCallback(async (projectId: string, force = false): Promise<ChatAttachment[]> => {
    const cached = projectContextCache[projectId];
    const cachedAt = projectContextMetaRef.current.get(projectId) ?? 0;
    if (!force && cached && Date.now() - cachedAt < PROJECT_CONTEXT_CACHE_TTL_MS) {
      return cached;
    }
    const inFlight = projectContextInFlightRef.current.get(projectId);
    if (inFlight) return inFlight;
    const req = fetchChatProjectContext(projectId)
      .then((files) => {
        setProjectContextCache((prev) => ({ ...prev, [projectId]: files }));
        projectContextMetaRef.current.set(projectId, Date.now());
        return files;
      })
      .finally(() => {
        projectContextInFlightRef.current.delete(projectId);
      });
    projectContextInFlightRef.current.set(projectId, req);
    return req;
  }, [projectContextCache]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const lib = await fetchLibrary();
        if (!cancelled) {
          const next = { folders: lib.folders ?? [], entries: lib.entries ?? [] };
          librarySnapshotRef.current = next;
          setFolders(next.folders);
          setLibraryEntries(next.entries);
        }
      } catch {
        /* library offline */
      }

      // Chat backend can be late on cold app starts. Retry briefly so persisted
      // projects/sessions are not mistaken as "missing" after relaunch.
      let ready = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const [prefs, projectList] = await Promise.all([
            fetchChatSettings(),
            fetchChatProjects(),
          ]);
          if (cancelled) return;
          const list = await fetchSessionsCached(null, true);
          if (cancelled) return;
          setSettings(prefs);
          setStorageInput(prefs.storage_dir);
          const sel = selectionFromSettings(prefs);
          setContextSelection(sel);
          const initialList = filterSessionsByMode(list, "library");
          setSessions(initialList);
          setProjects(projectList);
          setActiveProjectId(null);
          setChatModeState("library");
          setChatApiReady(true);
          ready = true;
          if (initialList.length > 0) {
            const session = await fetchChatSession(initialList[0].id);
            if (cancelled) return;
            setActiveId(session.id);
            setMessages(session.messages.map((m) => ({ ...m })));
          }
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!ready && !cancelled) {
        setChatApiReady(false);
      }
      if (!cancelled) setBooting(false);
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [fetchSessionsCached]);

  useEffect(() => {
    if (booting || chatApiReady) return;
    let cancelled = false;
    const recoverProjects = async () => {
      try {
        const [prefs, projectList] = await Promise.all([
          fetchChatSettings(),
          fetchChatProjects(),
        ]);
        if (cancelled) return;
        setSettings(prefs);
        setStorageInput(prefs.storage_dir);
        setProjects(projectList);
        setChatApiReady(true);
      } catch {
        /* keep silent and try again on next state tick */
      }
    };
    void recoverProjects();
    return () => {
      cancelled = true;
    };
  }, [booting, chatApiReady]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth" });
  }, [messages, loading]);

  const persistMessages = async (id: string, msgs: Message[]) => {
    const clean = msgs
      .filter((m) => !m.streaming)
      .map(({ role, content, attachments }) => ({
        role,
        content,
        ...(attachments?.length ? { attachments } : {}),
      }));
    const meta = sessions.find((s) => s.id === id);
    const updated = await saveChatSession(id, { messages: clean, title: meta?.title });
    setSessions((prev) => {
      const rest = prev.filter((s) => s.id !== id);
      return [
        {
          id: updated.id,
          title: updated.title,
          created_at: updated.created_at,
          updated_at: updated.updated_at,
          preview: clean[clean.length - 1]?.content?.slice(0, 120) ?? "",
          message_count: clean.length,
          context_scope: updated.context_scope,
          context_folder_id: updated.context_folder_id,
        },
        ...rest,
      ].sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
    });
  };

  const applyContextSelection = async (sel: ContextSelection) => {
    setContextSelection(sel);
    let entries = librarySnapshotRef.current.entries;
    try {
      if (libraryEntries.length === 0) {
        await loadLibrary(true);
      } else {
        await loadLibrary(false);
      }
      entries = librarySnapshotRef.current.entries;
    } catch {
      /* cached */
    }
    await loadContextPapers(sel, entries, true);
    try {
      setSettings(await updateChatSettings(selectionToSettingsPayload(sel)));
    } catch {
      /* keep local */
    }
  };

  const selectSession = async (id: string) => {
    if (selectMode) {
      setExportSelection((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    const session = await fetchChatSession(id);
    if (session.paper_id) {
      // Open paper chat in main chat window instead of navigating to paper detail
      if (id === activeId) return;
      setActiveId(session.id);
      setMessages(session.messages.map((m) => ({ ...m })));
      setChatModeState("library");
      // Set folder context from session folder_id or find it from library entries
      let folderId = session.folder_id;
      if (!folderId) {
        const paperFolders = foldersContainingPaper(libraryEntries, session.paper_id);
        folderId = paperFolders.size > 0 ? (Array.from(paperFolders)[0] as string) : null;
      }
      if (folderId) {
        const sel: ContextSelection = {
          wholeLibrary: false,
          folderIds: new Set([folderId]),
        };
        setContextSelection(sel);
        void loadContextPapers(sel, libraryEntries, true);
      } else {
        const sel = defaultSelection();
        setContextSelection(sel);
        void loadContextPapers(sel, libraryEntries, true);
      }
      setInput("");
      setAttachments([]);
      setStickyAttachments([]);
      // Check if paper has PDF and suggest attachment
      setSuggestedPdfAttachment(null);
      if (folderId) {
        try {
          const r = await fetch(`${API_BASE}/library/papers/${session.paper_id}/pdf-status?folder_id=${folderId}`);
          if (r.ok) {
            const data = await r.json();
            if (data.status === "saved") {
              setSuggestedPdfAttachment({ paperId: session.paper_id, folderId });
            }
          }
        } catch {
          // Ignore PDF check errors
        }
      }
      return;
    }
    // Clear PDF suggestion for non-paper chats
    setSuggestedPdfAttachment(null);
    if (id === activeId) return;
    setActiveId(session.id);
    setMessages(session.messages.map((m) => ({ ...m })));
    if (session.project_id) {
      setChatModeState("projects");
      if (session.project_id !== activeProjectId) {
        setActiveProjectId(session.project_id);
      }
      setInput("");
      setAttachments([]);
      setStickyAttachments([]);
      return;
    }
    if ((session.context_scope || "").toLowerCase() === "free") {
      setChatModeState("free");
    } else {
      setChatModeState("library");
    }
    if (session.context_scope === "folder" && session.context_folder_id) {
      const sel: ContextSelection = {
        wholeLibrary: false,
        folderIds: new Set([session.context_folder_id]),
      };
      setContextSelection(sel);
      void loadContextPapers(sel, libraryEntries, true);
    } else if (session.context_scope === "library") {
      const sel = defaultSelection();
      setContextSelection(sel);
      void loadContextPapers(sel, libraryEntries, true);
    }
    setInput("");
    setAttachments([]);
    setStickyAttachments([]);
  };

  const sessionHasMessages = (s: ChatSessionMeta) =>
    (s.message_count ?? 0) > 0 || Boolean(s.preview?.trim());

  const isCurrentChatEmpty = !activeId || messages.filter((m) => !m.streaming).length === 0;

  const handleNewChat = async () => {
    if (isCurrentChatEmpty && activeId) {
      inputRef.current?.focus();
      return;
    }
    const seedContext = getSessionSeedContext(chatMode);
    const session = await createChatSession({
      project_id: activeProjectId,
      context_scope: seedContext.context_scope,
      context_folder_id: seedContext.context_folder_id,
    });
    setActiveId(session.id);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setStickyAttachments([]);
    await refreshSessions(activeProjectId, true);
    inputRef.current?.focus();
  };

  const renameSession = async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed || !canRenameSession(id)) return;
    const updated = await saveChatSession(id, { title: trimmed });
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              title: updated.title,
              updated_at: updated.updated_at,
            }
          : s,
      ),
    );
  };

  const canRenameSession = (id: string) => {
    if (id === activeId) {
      return messages.filter((m) => !m.streaming).length > 0;
    }
    const meta = sessions.find((s) => s.id === id);
    return meta ? sessionHasMessages(meta) : false;
  };

  const uploadAttachment = async (file: File): Promise<ChatAttachment | null> => {
    setUploadingAttachment(true);
    try {
      const att = await uploadChatAttachment(file);
      setAttachments((prev) => [...prev, att]);
      return att;
    } catch {
      return null;
    } finally {
      setUploadingAttachment(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const addStickyAttachment = (att: ChatAttachment) => {
    setStickyAttachments((prev) => {
      if (prev.some((a) => a.id === att.id)) return prev;
      return [...prev, att];
    });
  };

  const removeStickyAttachment = (id: string) => {
    setStickyAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const attachSuggestedPdf = async () => {
    if (!suggestedPdfAttachment) return;
    try {
      const att = await attachLibraryPaperPdf(suggestedPdfAttachment.paperId, suggestedPdfAttachment.folderId || "default");
      addStickyAttachment(att);
      setSuggestedPdfAttachment(null);
    } catch (e) {
      console.error("Failed to attach PDF:", e);
    }
  };

  const dismissPdfSuggestion = () => {
    setSuggestedPdfAttachment(null);
  };

  const slimAttachmentsForChat = (items: ChatAttachment[]): ChatAttachment[] => {
    const limits = {
      fast: { files: 2, chars: 4000 },
      balanced: { files: 3, chars: 6000 },
      quality: { files: 4, chars: 9000 },
    }[chatSpeedPreset];
    return items.slice(0, limits.files).map((att) => {
      const text = String(att.text ?? "");
      const clipped = text.length > limits.chars ? `${text.slice(0, limits.chars)}\n\n[…truncated…]` : text;
      return {
        ...att,
        text: clipped,
        text_length: clipped.length,
      };
    });
  };

  const editMessage = async (index: number, content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !activeId || loading) return;
    // Truncate history: keep messages up to and including the edited one
    const truncated: Message[] = messages
      .slice(0, index)
      .concat({ ...messages[index], content: trimmed });
    setMessages([...truncated, { role: "assistant", content: "", streaming: true }]);
    setLoading(true);
    setChatPhase(activeProjectId ? "Preparing project files..." : "Preparing context...");
    try {
      let projectAttachments: ChatAttachment[] = [];
      if (activeProjectId) {
        try {
          projectAttachments = await ensureProjectContext(activeProjectId);
        } catch {
          projectAttachments = [];
        }
      }
      const limits = {
        fast: { papers: 3, history: 4 },
        balanced: { papers: 5, history: 7 },
        quality: { papers: 7, history: 10 },
      }[chatSpeedPreset];
      let liveContextPapers = contextPapers;
      if (!activeProjectId && chatMode !== "free") {
        liveContextPapers = await resolveContextPapers(contextSelection, libraryEntries);
        setContextPapers(liveContextPapers);
      } else if (chatMode === "free") {
        liveContextPapers = [];
      }
      const stableMessages = truncated.filter((m) => !m.streaming);
      const history = stableMessages
        .slice(-limits.history)
        .map(({ role, content: c, attachments: a }) => ({ role, content: c, attachments: a }));
      const relevantPapers = selectRelevantContextPapers(
        trimmed,
        liveContextPapers,
        limits.papers,
      ) as unknown as Record<string, unknown>[];
      const controller = new AbortController();
      streamAbortRef.current = controller;
      setChatPhase("Contacting local model...");
      const userAttachments = messages[index]?.attachments ?? [];
      const resp = await streamChatMessage({
        message: trimmed,
        history: history.slice(0, -1),
        paper_context: relevantPapers,
        attachments: slimAttachmentsForChat([...projectAttachments, ...userAttachments]),
        context_meta: {
          scope: chatMode === "free"
            ? "General AI"
            : activeProjectId
            ? `Project: ${projects.find((p) => p.id === activeProjectId)?.name ?? "Project"}`
            : contextName,
          selected_count: relevantPapers.length,
          available_count: activeProjectId
            ? (projectAttachments.length + userAttachments.length)
            : chatMode === "free"
            ? 0
            : contextEntryCount(contextSelection, libraryEntries),
        },
        speed_preset: chatSpeedPreset,
      }, controller.signal);
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");
      let assistantText = "";
      let renderedText = "";
      let buffered = "";
      let lastFlush = 0;
      let firstTokenSeen = false;
      let streamError: Error | null = null;
      const flushAssistant = (force = false) => {
        const now = Date.now();
        if (!force && now - lastFlush < 80) return;
        if (renderedText === assistantText) return;
        renderedText = assistantText;
        lastFlush = now;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: renderedText };
          }
          return next;
        });
      };
      const processLine = (line: string) => {
        if (!line.startsWith("data: ")) return;
        const data = JSON.parse(line.slice(6));
        if (data.error) {
          throw new Error(String(data.error));
        }
        if (data.done) {
          if (typeof data.final === "string" && data.final.trim()) {
            assistantText = data.final;
            flushAssistant(true);
          }
          return;
        }
        if (data.token) {
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            setChatPhase("Writing response...");
          }
          assistantText += data.token;
          flushAssistant(false);
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          try {
            processLine(line);
          } catch (error) {
            streamError = error instanceof Error ? error : new Error("Chat stream failed");
            break;
          }
        }
        if (streamError) break;
      }
      if (streamError) throw streamError;
      if (buffered.trim()) {
        try {
          processLine(buffered.trim());
        } catch (error) {
          throw error instanceof Error ? error : new Error("Chat stream failed");
        }
      }
      flushAssistant(true);
      const finalMessages: Message[] = [
        ...truncated,
        { role: "assistant", content: assistantText || "No response." },
      ];
      setMessages(finalMessages);
      await persistMessages(activeId, finalMessages);
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            role: "assistant",
            content: "Sorry, I couldn't reach the AI model. Make sure Ollama is running.",
          };
        }
        return next;
      });
    } finally {
      streamAbortRef.current = null;
      setLoading(false);
      setChatPhase("");
      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteChatSession(id);
    setExportSelection((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    const projectScope = chatMode === "projects" ? activeProjectId : null;
    const list = await fetchSessionsCached(projectScope, true);
    const visible = filterSessionsByMode(list, chatMode);
    setSessions(visible);
    if (activeId === id) {
      if (visible.length > 0) {
        const session = await fetchChatSession(visible[0].id);
        setActiveId(session.id);
        setMessages(session.messages.map((m) => ({ ...m })));
      } else {
        setActiveId(null);
        setMessages([]);
      }
    }
  };

  const ensureSession = async (): Promise<string> => {
    if (activeId) return activeId;
    const seedContext = getSessionSeedContext(chatMode);
    const session = await createChatSession({
      project_id: activeProjectId,
      context_scope: seedContext.context_scope,
      context_folder_id: seedContext.context_folder_id,
    });
    setActiveId(session.id);
    await refreshSessions(activeProjectId, true);
    return session.id;
  };

  const sendMessage = async () => {
    const userMsg = input.trim();
    const hasAttachments = attachments.length > 0 || stickyAttachments.length > 0;
    if ((!userMsg && !hasAttachments) || loading) return;
    const sessionId = await ensureSession();
    const sentAttachments = [...attachments];
    const allAttachments = [...stickyAttachments, ...sentAttachments];
    let projectAttachments: ChatAttachment[] = [];
    if (activeProjectId) {
      try {
        projectAttachments = await ensureProjectContext(activeProjectId);
      } catch {
        projectAttachments = [];
      }
    }
    setInput("");
    setAttachments([]);
    const displayContent =
      userMsg ||
      `Attached: ${allAttachments.map((a) => a.name).join(", ")}`;
    const stableMessages = messages.filter((m) => !m.streaming);
    const nextUser: Message[] = [
      ...messages,
      {
        role: "user",
        content: displayContent,
        ...(allAttachments.length ? { attachments: allAttachments } : {}),
      },
    ];
    setMessages([...nextUser, { role: "assistant", content: "", streaming: true }]);
    setLoading(true);
    setChatPhase(activeProjectId ? "Preparing project files..." : "Preparing context...");
    try {
      const startedAt = performance.now();
      const limits = {
        fast: { papers: 3, history: 4 },
        balanced: { papers: 5, history: 7 },
        quality: { papers: 7, history: 10 },
      }[chatSpeedPreset];
      let liveContextPapers = contextPapers;
      if (!activeProjectId && chatMode !== "free") {
        liveContextPapers = await resolveContextPapers(contextSelection, libraryEntries);
        setContextPapers(liveContextPapers);
      } else if (chatMode === "free") {
        liveContextPapers = [];
      }
      const history = stableMessages
        .slice(-limits.history)
        .map(({ role, content, attachments }) => ({ role, content, attachments }));
      const relevantPapers = selectRelevantContextPapers(
        userMsg || displayContent,
        liveContextPapers,
        limits.papers,
      ) as unknown as Record<string, unknown>[];
      const controller = new AbortController();
      streamAbortRef.current = controller;
      setChatPhase("Contacting local model...");
      const resp = await streamChatMessage({
        message: userMsg,
        history,
        paper_context: relevantPapers,
        attachments: slimAttachmentsForChat([...projectAttachments, ...allAttachments]),
        context_meta: {
          scope: chatMode === "free"
            ? "General AI"
            : activeProjectId
            ? `Project: ${projects.find((p) => p.id === activeProjectId)?.name ?? "Project"}`
            : contextName,
          selected_count: relevantPapers.length,
          available_count: activeProjectId
            ? (projectAttachments.length + sentAttachments.length)
            : chatMode === "free"
            ? 0
            : contextEntryCount(contextSelection, libraryEntries),
        },
        speed_preset: chatSpeedPreset,
      }, controller.signal);
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");
      let assistantText = "";
      let renderedText = "";
      let buffered = "";
      let lastFlush = 0;
      let firstTokenSeen = false;
      let streamError: Error | null = null;
      const flushAssistant = (force = false) => {
        const now = Date.now();
        if (!force && now - lastFlush < 80) return;
        if (renderedText === assistantText) return;
        renderedText = assistantText;
        lastFlush = now;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: renderedText };
          }
          return next;
        });
      };
      const processLine = (line: string) => {
        if (!line.startsWith("data: ")) return;
        const data = JSON.parse(line.slice(6));
        if (data.error) {
          throw new Error(String(data.error));
        }
        if (data.done) {
          if (typeof data.final === "string" && data.final.trim()) {
            assistantText = data.final;
            flushAssistant(true);
          }
          return;
        }
        if (data.token) {
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            setChatPhase("Writing response...");
            if (import.meta.env.DEV) {
              console.debug(`[chat] time to first token ${Math.round(performance.now() - startedAt)}ms`);
            }
          }
          assistantText += data.token;
          flushAssistant(false);
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          try {
            processLine(line);
          } catch (error) {
            streamError = error instanceof Error ? error : new Error("Chat stream failed");
            break;
          }
        }
        if (streamError) break;
      }
      if (streamError) throw streamError;
      if (buffered.trim()) {
        try {
          processLine(buffered.trim());
        } catch (error) {
          throw error instanceof Error ? error : new Error("Chat stream failed");
        }
      }
      flushAssistant(true);
      const finalMessages: Message[] = [
        ...nextUser,
        { role: "assistant", content: assistantText || "No response." },
      ];
      setMessages(finalMessages);
      await persistMessages(sessionId, finalMessages);
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            role: "assistant",
            content: "Sorry, I couldn't reach the AI model. Make sure Ollama is running.",
          };
        }
        return next;
      });
    } finally {
      streamAbortRef.current = null;
      setLoading(false);
      setChatPhase("");
      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    }
  };

  const stopStreaming = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
      setLoading(false);
      setChatPhase("");
      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const labelForSession = (s: ChatSession) => {
    if ((s.context_scope || "").toLowerCase() === "free") {
      return "General AI";
    }
    if (s.context_scope === "folder" && s.context_folder_id) {
      return folders.find((f) => f.id === s.context_folder_id)?.name ?? "Folder";
    }
    return "Whole library";
  };

  const exportSessions = async (ids: string[]) => {
    if (ids.length === 0) return;
    const full = await Promise.all(ids.map((id) => fetchChatSession(id)));
    downloadChatExport(
      full,
      exportFormat,
      full.length === 1 ? full[0].title : "chats",
      labelForSession,
    );
  };

  const saveStoragePath = async () => {
    const prefs = await updateChatSettings({ storage_dir: storageInput.trim() });
    setSettings(prefs);
    setStorageInput(prefs.storage_dir);
    await refreshSessions(activeProjectId);
  };

  const deleteAllChats = async () => {
    if (!confirm("Delete all saved conversations? This cannot be undone.")) return;
    await deleteAllChatSessions();
    setSessions([]);
    setActiveId(null);
    setMessages([]);
    setExportSelection(new Set());
  };

  const createProject = async (name: string) => {
    const project = await createChatProject(name.trim() || "New Project");
    setProjects((prev) => [project, ...prev]);
    setChatModeState("projects");
    setActiveProjectId(project.id);
    setProjectContextCache((prev) => ({ ...prev, [project.id]: [] }));
    const list = await fetchSessionsCached(project.id, true);
    setSessions(list);
    setActiveId(list[0]?.id ?? null);
    setMessages([]);
  };

  const renameProject = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const updated = await renameChatProject(id, trimmed);
    setProjects((prev) => prev.map((project) => (project.id === id ? updated : project)));
  };

  const deleteProject = async (id: string) => {
    await deleteChatProject(id);
    const next = projects.filter((project) => project.id !== id);
    setProjects(next);
    setProjectContextCache((prev) => {
      const out = { ...prev };
      delete out[id];
      return out;
    });
    const nextProjectId = activeProjectId === id ? (next[0]?.id ?? null) : activeProjectId;
    setActiveProjectId(nextProjectId);
    if (!nextProjectId) {
      setChatModeState("library");
    }
    const list = await fetchSessionsCached(nextProjectId, true);
    setSessions(list);
    if (list.length > 0) {
      const session = await fetchChatSession(list[0].id);
      setActiveId(session.id);
      setMessages(session.messages.map((m) => ({ ...m })));
    } else {
      setActiveId(null);
      setMessages([]);
    }
  };

  const uploadProjectFile = async (projectId: string, file: File) => {
    const updated = await uploadChatProjectFile(projectId, file);
    setProjects((prev) => prev.map((project) => (project.id === projectId ? updated : project)));
    try {
      await ensureProjectContext(projectId, true);
    } catch {
      /* keep existing cache */
    }
  };

  const deleteProjectFile = async (projectId: string, fileId: string) => {
    const updated = await deleteChatProjectFile(projectId, fileId);
    setProjects((prev) => prev.map((project) => (project.id === projectId ? updated : project)));
    try {
      await ensureProjectContext(projectId, true);
    } catch {
      setProjectContextCache((prev) => {
        const existing = prev[projectId] ?? [];
        return {
          ...prev,
          [projectId]: existing.filter((a) => a.id !== fileId),
        };
      });
    }
  };

  const setChatMode = useCallback((mode: ChatMode) => {
    setChatModeState(mode);
  }, []);

  useEffect(() => {
    if (chatMode !== "projects" && activeProjectId !== null) {
      setActiveProjectId(null);
    }
    if (chatMode === "projects" && activeProjectId === null && projects.length > 0) {
      setActiveProjectId(projects[0].id);
    }
  }, [chatMode, activeProjectId, projects]);

  useEffect(() => {
    if (booting) return;
    void (async () => {
      const projectScope = chatMode === "projects" ? activeProjectId : null;
      const list = await fetchSessionsCached(projectScope, true);
      const visible = filterSessionsByMode(list, chatMode);
      setSessions(visible);
      if (visible.length === 0) {
        setActiveId(null);
        setMessages([]);
        return;
      }
      if (!activeId || !visible.some((item) => item.id === activeId)) {
        const session = await fetchChatSession(visible[0].id);
        setActiveId(session.id);
        setMessages(session.messages.map((m) => ({ ...m })));
      }
    })();
  }, [activeProjectId, activeId, booting, chatMode, fetchSessionsCached, filterSessionsByMode]);

  const setChatSpeedPreset = (preset: ChatSpeedPreset) => {
    setChatSpeedPresetState(preset);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CHAT_SPEED_PRESET_KEY, preset);
    }
  };

  const displayFolders = useMemo(
    () => mergeLibraryFolders(folders, libraryEntries),
    [folders, libraryEntries],
  );
  const entryCount = contextEntryCount(contextSelection, libraryEntries);
  const displayPaperCount = contextPapers.length > 0 ? contextPapers.length : entryCount;
  const activeProjectName = useMemo(
    () => projects.find((p) => p.id === activeProjectId)?.name ?? "",
    [projects, activeProjectId],
  );
  const contextName = chatMode === "free"
    ? "General AI"
    : activeProjectId
    ? `Project: ${activeProjectName || "Project"}`
    : selectionLabel(contextSelection, displayFolders);

  const filteredSessions = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, chatSearch]);

  const value: ChatContextValue = {
    booting,
    messages,
    input,
    setInput,
    loading,
    chatPhase,
    sendMessage,
    handleKeyDown,
    inputRef,
    messagesEndRef,
    contextName,
    displayPaperCount,
    folders,
    libraryEntries,
    contextSelection,
    applyContextSelection,
    loadLibrary,
    suggestedPdfAttachment,
    attachSuggestedPdf,
    dismissPdfSuggestion,
    sessions,
    activeId,
    selectSession,
    handleNewChat,
    handleDeleteSession,
    selectMode,
    setSelectMode,
    exportSelection,
    setExportSelection,
    chatSearch,
    setChatSearch,
    filteredSessions,
    settingsOpen,
    setSettingsOpen,
    settings,
    storageInput,
    setStorageInput,
    saveStoragePath,
    resetStoragePath: () => setStorageInput(DEFAULT_STORAGE),
    exportFormat,
    setExportFormat,
    exportSessions,
    deleteAllChats,
    attachments,
    uploadingAttachment,
    uploadAttachment,
    removeAttachment,
    stickyAttachments,
    addStickyAttachment,
    removeStickyAttachment,
    stopStreaming,
    editMessage,
    renameSession,
    canRenameSession,
    isCurrentChatEmpty,
    projects,
    activeProjectId,
    setActiveProjectId,
    chatMode,
    setChatMode,
    createProject,
    renameProject,
    deleteProject,
    uploadProjectFile,
    deleteProjectFile,
    chatSpeedPreset,
    setChatSpeedPreset,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
