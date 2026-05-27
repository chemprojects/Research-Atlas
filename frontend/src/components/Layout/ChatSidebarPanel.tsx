import { useEffect, useRef, useState } from "react";
import {
  Plus,
  MessageSquare,
  Trash2,
  Settings2,
  Download,
  CheckSquare,
  Square,
  Pencil,
  Check,
  X,
  Folder,
  FolderPlus,
  FileText,
  Upload,
  ChevronDown,
} from "lucide-react";
import clsx from "clsx";
import { useChat } from "../../contexts/ChatProvider";
import { ChatContextPicker } from "../ChatContextPicker";
import { ChatStorageModal } from "../ChatStorageModal";
import { API_BASE } from "../../lib/apiBase";
import { DigestModelSelector } from "../DigestModelSelector";

interface ChatSidebarPanelProps {
  className?: string;
}

export function ChatSidebarPanel({ className }: ChatSidebarPanelProps) {
  const {
    folders,
    libraryEntries,
    contextSelection,
    applyContextSelection,
    loadLibrary,
    handleNewChat,
    renameSession,
    canRenameSession,
    filteredSessions,
    selectMode,
    setSelectMode,
    exportSelection,
    setExportSelection,
    selectSession,
    activeId,
    handleDeleteSession,
    exportSessions,
    settingsOpen,
    setSettingsOpen,
    settings,
    storageInput,
    setStorageInput,
    saveStoragePath,
    resetStoragePath,
    sessions,
    exportFormat,
    setExportFormat,
    deleteAllChats,
    messages,
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
  } = useChat();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectRenameDraft, setProjectRenameDraft] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [aiOptionsOpen, setAiOptionsOpen] = useState(false);
  const [projectsMenuOpen, setProjectsMenuOpen] = useState(false);
  const projectsMenuRef = useRef<HTMLDivElement | null>(null);

  const startRename = (e: React.MouseEvent, sessionId: string, currentTitle: string) => {
    e.stopPropagation();
    if (!canRenameSession(sessionId)) return;
    setRenamingId(sessionId);
    setRenameDraft(currentTitle);
    setRenameError(null);
  };

  const cancelRename = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRenamingId(null);
    setRenameDraft("");
    setRenameError(null);
  };

  const commitRename = async (e?: React.MouseEvent | React.FormEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!renamingId) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenameError("Title cannot be empty");
      return;
    }
    try {
      await renameSession(renamingId, trimmed);
      cancelRename();
    } catch {
      setRenameError("Could not save title");
    }
  };

  const runProjectAction = async (action: () => Promise<void>) => {
    setProjectError(null);
    setProjectBusy(true);
    try {
      await action();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : "Project action failed");
    } finally {
      setProjectBusy(false);
    }
  };

  const handleCreateProject = () => {
    void runProjectAction(() => createProject("New Project"));
  };

  useEffect(() => {
    if (!projectsMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!projectsMenuRef.current?.contains(target)) {
        setProjectsMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [projectsMenuOpen]);

  useEffect(() => {
    if (chatMode !== "projects") {
      setProjectsMenuOpen(false);
    }
  }, [chatMode]);

  return (
    <div className={clsx("flex min-h-0 flex-col gap-2 rounded-none bg-surface px-3 py-3", className)}>
      <button
        type="button"
        onClick={() => void handleNewChat()}
        className="w-full flex items-center gap-2 px-4 py-2.5 rounded-none border border-primary-500/40 bg-primary-500/90 hover:bg-primary-500 text-sm font-semibold text-white transition-colors"
      >
        <Plus size={16} />
        New chat
      </button>

      <div className="grid grid-cols-3 rounded-xl border border-surface-border overflow-hidden bg-surface-raised">
        <button
          type="button"
          onClick={() => setChatMode("library")}
          className={clsx(
            "px-2.5 py-1.5 text-xs font-medium transition-colors",
            chatMode === "library" ? "bg-primary-500 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-surface-overlay",
          )}
        >
          Library
        </button>
        <button
          type="button"
          onClick={() => setChatMode("projects")}
          className={clsx(
            "px-2.5 py-1.5 text-xs font-medium transition-colors border-l border-surface-border",
            chatMode === "projects" ? "bg-primary-500 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-surface-overlay",
          )}
        >
          Projects
        </button>
        <button
          type="button"
          onClick={() => setChatMode("free")}
          className={clsx(
            "px-2.5 py-1.5 text-xs font-medium transition-colors border-l border-surface-border",
            chatMode === "free" ? "bg-primary-500 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-surface-overlay",
          )}
        >
          Free Chat
        </button>
      </div>

      {chatMode === "library" && (
        <ChatContextPicker
          folders={folders}
          entries={libraryEntries}
          selection={contextSelection}
          onChange={applyContextSelection}
          onRefresh={loadLibrary}
          compact
        />
      )}

      <div className={clsx("space-y-2 relative", chatMode === "projects" ? "" : "hidden")}>
        <div className="flex items-center justify-between">
          <p className="chat-sidebar-label mb-0">Projects</p>
        </div>
        <div
          className="relative"
          ref={projectsMenuRef}
        >
          <button
            type="button"
            onClick={() => setProjectsMenuOpen((v) => !v)}
            className="w-full inline-flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-surface-border bg-surface-raised text-sm text-gray-200 hover:bg-surface-overlay transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <Folder size={14} className="text-primary-300" />
              Projects menu
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              {projects.length}
              <ChevronDown size={13} className={clsx("transition-transform", projectsMenuOpen && "rotate-180")} />
            </span>
          </button>

          {projectsMenuOpen && (
            <div className="absolute left-full top-0 ml-2 z-[80] w-80 rounded-xl border border-surface-border bg-surface-raised shadow-2xl p-3 space-y-2">
              <button
                type="button"
                onClick={handleCreateProject}
                disabled={projectBusy}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-primary-500/25 bg-transparent hover:bg-primary-500/10 text-sm font-medium text-primary-300 transition-colors disabled:opacity-50"
              >
                <FolderPlus size={16} />
                New Project
              </button>
              {projectError && (
                <p className="rounded-md border border-red-500/25 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
                  {projectError}
                </p>
              )}
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {projects.length === 0 ? (
                  <p className="text-xs text-gray-500 px-1 py-2">No projects yet</p>
                ) : (
                  projects.map((project) => {
                    const active = project.id === activeProjectId;
                    return (
                      <div
                        key={project.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveProjectId(project.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setActiveProjectId(project.id);
                          }
                        }}
                        className={clsx(
                          "group rounded-xl border px-3 py-2.5 cursor-pointer",
                          active
                            ? "border-primary-500/35 bg-primary-500/15"
                            : "border-surface-border bg-surface-raised hover:bg-surface-overlay",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveProjectId(project.id)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-gray-300"
                            title="Use this project as chat context"
                          >
                            <Folder size={13} className={active ? "text-primary-400" : "text-gray-500"} />
                            {renamingProjectId === project.id ? (
                              <input
                                value={projectRenameDraft}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setProjectRenameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    void runProjectAction(() => renameProject(project.id, projectRenameDraft));
                                    setRenamingProjectId(null);
                                  }
                                  if (e.key === "Escape") setRenamingProjectId(null);
                                }}
                                className="input min-w-0 flex-1 px-1.5 py-0.5 text-xs"
                                autoFocus
                              />
                            ) : (
                              <span className="truncate">{project.name}</span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingProjectId(project.id);
                              setProjectRenameDraft(project.name);
                            }}
                            disabled={projectBusy}
                            className={clsx(
                              "p-0.5 text-gray-500 hover:text-primary-300 transition-opacity",
                              active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            )}
                            title="Rename project"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void runProjectAction(() => deleteProject(project.id));
                            }}
                            disabled={projectBusy}
                            className={clsx(
                              "p-0.5 text-gray-500 hover:text-red-400 disabled:opacity-40 transition-opacity",
                              active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            )}
                            title="Delete project"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {project.files.map((file) => (
                            <div key={file.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                              <FileText size={11} />
                              <a
                                href={`${API_BASE}/chats/attachments/${file.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="min-w-0 flex-1 truncate hover:text-primary-300"
                                title="Open file"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {file.name}
                              </a>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void runProjectAction(() => deleteProjectFile(project.id, file.id));
                                }}
                                disabled={projectBusy}
                                className="text-gray-600 hover:text-red-400 disabled:opacity-40"
                                title="Remove file"
                              >
                                <X size={11} />
                              </button>
                            </div>
                          ))}
                          <label
                            className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-xs text-primary-300 hover:text-primary-200"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Upload size={11} />
                            Add file
                            <input
                              type="file"
                              accept=".pdf,.txt,.md,.csv,.json,.xml,.html,.htm,.log"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void runProjectAction(() => uploadProjectFile(project.id, file));
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 pb-1">
        <p className="chat-sidebar-label mb-0">Chats</p>
        <button
          type="button"
          onClick={() => {
            setSelectMode((m) => !m);
            if (selectMode) setExportSelection(new Set());
          }}
          className={clsx(
            "text-xs px-2 py-0.5 rounded-md transition-colors",
            selectMode ? "bg-primary-500/20 text-primary-300" : "text-gray-500 hover:text-gray-300",
          )}
        >
          {selectMode ? "Done" : "Select"}
        </button>
      </div>

      {renameError && (
        <p className="text-[10px] text-red-400 px-2">{renameError}</p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {filteredSessions.length === 0 ? (
          <p className="text-xs text-gray-500 px-2 py-3 text-center">
            {sessions.length === 0 ? "No chats yet" : "No matching chats"}
          </p>
        ) : (
          filteredSessions.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (renamingId === s.id) return;
                void selectSession(s.id);
              }}
              onKeyDown={(e) => {
                if (renamingId === s.id) return;
                if (e.key === "Enter") void selectSession(s.id);
              }}
              className={clsx(
                "chat-session-item w-full group flex items-start gap-2 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer",
                !selectMode && activeId === s.id
                  ? "chat-session-item-active bg-primary-500/15 text-gray-100"
                  : "text-gray-300 hover:bg-surface-overlay/60 hover:text-gray-100",
                selectMode && exportSelection.has(s.id) && "bg-primary-500/10 ring-1 ring-primary-500/30",
                renamingId === s.id && "ring-1 ring-primary-500/40 bg-surface-overlay",
              )}
            >
              {selectMode ? (
                exportSelection.has(s.id) ? (
                  <CheckSquare size={15} className="shrink-0 mt-0.5 text-primary-400" />
                ) : (
                  <Square size={15} className="shrink-0 mt-0.5 opacity-50" />
                )
              ) : s.paper_id ? (
                <FileText size={15} className="shrink-0 mt-0.5 opacity-60 text-primary-300" />
              ) : (
                <MessageSquare size={15} className="shrink-0 mt-0.5 opacity-60" />
              )}

              {renamingId === s.id ? (
                <form
                  className="flex-1 flex items-center gap-1 min-w-0"
                  onSubmit={(e) => void commitRename(e)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    className="flex-1 min-w-0 input text-xs py-1 px-2"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelRename();
                    }}
                  />
                  <button
                    type="submit"
                    className="p-0.5 text-green-400 hover:text-green-300"
                    title="Save"
                  >
                    <Check size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={cancelRename}
                    className="p-0.5 text-gray-500 hover:text-gray-300"
                    title="Cancel"
                  >
                    <X size={13} />
                  </button>
                </form>
              ) : (
                <span className="flex-1 text-sm line-clamp-2 leading-snug">{s.title}</span>
              )}

              {!selectMode && renamingId !== s.id && (
                <div
                  className={clsx(
                    "flex items-center gap-0.5 shrink-0",
                    activeId === s.id ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => startRename(e, s.id, s.title)}
                    disabled={!canRenameSession(s.id)}
                    className="p-0.5 text-gray-500 hover:text-primary-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    title={
                      canRenameSession(s.id)
                        ? "Rename chat"
                        : "Send a message before renaming"
                    }
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => void handleDeleteSession(e, s.id)}
                    className="p-0.5 text-gray-500 hover:text-red-400 transition-all"
                    title="Delete chat"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-auto pt-2 space-y-2">
        {selectMode && exportSelection.size > 0 && (
          <button
            type="button"
            onClick={() => void exportSessions([...exportSelection])}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-primary-300 bg-primary-500/10 hover:bg-primary-500/20 transition-colors"
          >
            <Download size={13} />
            Export {exportSelection.size} selected
          </button>
        )}
        <div className="chat-ai-options-card rounded-xl border border-surface-border bg-surface-raised overflow-hidden">
          <button
            type="button"
            onClick={() => setAiOptionsOpen((v) => !v)}
            className={clsx(
              "chat-ai-options-toggle w-full px-3 py-2.5 inline-flex items-center justify-between text-left hover:bg-surface-overlay/60 transition-colors",
              aiOptionsOpen ? "rounded-t-xl rounded-b-none" : "rounded-xl",
            )}
            aria-expanded={aiOptionsOpen}
            title={aiOptionsOpen ? "Collapse AI options" : "Expand AI options"}
          >
            <span className="inline-flex items-center gap-2">
              <p className="chat-sidebar-label mb-0">AI options</p>
            </span>
            <span className="chat-ai-options-icons inline-flex items-center gap-2 text-gray-500">
              <Settings2 size={13} />
              <ChevronDown size={14} className={clsx("transition-transform", aiOptionsOpen && "rotate-180")} />
            </span>
          </button>
          {aiOptionsOpen && (
            <div className="chat-ai-options-body px-3 pb-3 space-y-3">
              <div className="grid grid-cols-1 gap-2">
                <DigestModelSelector compact context="chat" />
              </div>
              <div className="space-y-1">
                <p className="chat-ai-options-muted text-xs text-gray-500">Speed / quality</p>
                <div className="chat-ai-speed-control grid grid-cols-3 items-center rounded-xl border border-surface-border overflow-hidden">
                {(["fast", "balanced", "quality"] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setChatSpeedPreset(preset)}
                    className={clsx(
                      "chat-ai-speed-option px-2 py-1.5 text-[11px] font-medium uppercase transition-colors border-r border-surface-border last:border-r-0",
                      chatSpeedPreset === preset
                        ? "bg-primary-500 text-white"
                        : "text-gray-400 hover:text-gray-200 hover:bg-surface-overlay",
                    )}
                    title={`Chat speed preset: ${preset}`}
                  >
                    {preset}
                  </button>
                ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-none text-sm text-gray-400 hover:text-gray-200 hover:bg-surface-overlay transition-colors"
        >
          <Settings2 size={13} />
          Storage & export
        </button>
      </div>

      <ChatStorageModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        storageInput={storageInput}
        onStorageInputChange={setStorageInput}
        onSaveStorage={saveStoragePath}
        onResetStorage={resetStoragePath}
        sessionCount={sessions.length}
        exportFormat={exportFormat}
        onExportFormatChange={setExportFormat}
        onExportCurrent={() => activeId && void exportSessions([activeId])}
        onExportSelected={() => void exportSessions([...exportSelection])}
        onExportAll={() => void exportSessions(sessions.map((s) => s.id))}
        selectedExportCount={exportSelection.size}
        hasActiveChat={!!activeId && messages.length > 0}
        onDeleteAllChats={() => void deleteAllChats()}
      />
    </div>
  );
}
