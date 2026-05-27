import { API_BASE as API } from "./apiBase";

export type ChatContextScope = "library" | "folder" | "free";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  project_id?: string | null;
  paper_id?: string | null;
  folder_id?: string | null;
  preview?: string;
  message_count?: number;
  context_scope?: ChatContextScope;
  context_folder_id?: string | null;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size_bytes: number;
  text: string;
  text_length: number;
}

export interface ChatProject {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  files: ChatAttachment[];
}

export interface ChatSession extends ChatSessionMeta {
  messages: ChatMessage[];
}

export interface ChatSettings {
  storage_dir: string;
  context_scope: ChatContextScope;
  context_folder_id: string | null;
  context_whole_library?: boolean;
  context_folder_ids?: string[];
  context_all_folders?: boolean;
  session_count?: number;
  resolved_storage_dir?: string;
}

export async function fetchChatSettings(): Promise<ChatSettings> {
  const r = await fetch(`${API}/chats/settings`);
  if (!r.ok) throw new Error("Failed to load chat settings");
  return r.json();
}

export async function updateChatSettings(patch: Partial<ChatSettings>): Promise<ChatSettings> {
  const r = await fetch(`${API}/chats/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("Failed to update chat settings");
  return r.json();
}

export async function fetchChatSessions(projectId?: string | null): Promise<ChatSessionMeta[]> {
  const qs = new URLSearchParams();
  if (projectId !== undefined) qs.set("project_id", projectId ?? "");
  const url = qs.toString() ? `${API}/chats/sessions?${qs.toString()}` : `${API}/chats/sessions`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to load chats");
  const data = await r.json();
  return data.sessions ?? [];
}

export async function createChatSession(body?: {
  title?: string;
  context_scope?: ChatContextScope;
  context_folder_id?: string | null;
  project_id?: string | null;
  paper_id?: string | null;
  folder_id?: string | null;
}): Promise<ChatSession> {
  const r = await fetch(`${API}/chats/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) throw new Error("Failed to create chat");
  return r.json();
}

export async function fetchChatSession(id: string): Promise<ChatSession> {
  const r = await fetch(`${API}/chats/sessions/${id}`);
  if (!r.ok) throw new Error("Failed to load chat");
  return r.json();
}

export async function saveChatSession(
  id: string,
  patch: { title?: string; messages?: ChatMessage[]; paper_id?: string | null },
): Promise<ChatSession> {
  const r = await fetch(`${API}/chats/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("Failed to save chat");
  return r.json();
}

export async function deleteChatSession(id: string): Promise<void> {
  const r = await fetch(`${API}/chats/sessions/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to delete chat");
}

export async function deleteAllChatSessions(): Promise<void> {
  const r = await fetch(`${API}/chats/sessions`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to delete all chats");
}

export async function fetchChatProjects(): Promise<ChatProject[]> {
  const r = await fetch(`${API}/chats/projects`);
  if (!r.ok) throw new Error("Failed to load projects");
  const data = await r.json();
  return data.projects ?? [];
}

async function projectError(response: Response, fallback: string): Promise<Error> {
  const data = (await response.json().catch(() => ({}))) as { detail?: string };
  return new Error(data.detail ?? fallback);
}

export async function createChatProject(name: string): Promise<ChatProject> {
  const r = await fetch(`${API}/chats/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw await projectError(r, "Failed to create project");
  return r.json();
}

export async function renameChatProject(id: string, name: string): Promise<ChatProject> {
  const r = await fetch(`${API}/chats/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw await projectError(r, "Failed to rename project");
  return r.json();
}

export async function deleteChatProject(id: string): Promise<void> {
  const r = await fetch(`${API}/chats/projects/${id}`, { method: "DELETE" });
  if (!r.ok) throw await projectError(r, "Failed to delete project");
}

export async function uploadChatProjectFile(id: string, file: File): Promise<ChatProject> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API}/chats/projects/${id}/files`, { method: "POST", body: form });
  if (!r.ok) throw await projectError(r, "Failed to upload project file");
  return r.json();
}

export async function deleteChatProjectFile(projectId: string, fileId: string): Promise<ChatProject> {
  const r = await fetch(`${API}/chats/projects/${projectId}/files/${fileId}`, { method: "DELETE" });
  if (!r.ok) throw await projectError(r, "Failed to delete project file");
  return r.json();
}

export async function fetchChatProjectContext(id: string): Promise<ChatAttachment[]> {
  const r = await fetch(`${API}/chats/projects/${id}/context`);
  if (!r.ok) throw new Error("Failed to load project context");
  const data = await r.json();
  return data.attachments ?? [];
}

export async function fetchChatSessionsFull(): Promise<ChatSession[]> {
  const metas = await fetchChatSessions();
  return Promise.all(metas.map((m) => fetchChatSession(m.id)));
}

export async function fetchPaperChatSessions(): Promise<ChatSessionMeta[]> {
  const all = await fetchChatSessions();
  return all.filter((s) => Boolean(s.paper_id));
}

export async function findPaperChatSession(paperId: string): Promise<ChatSession | null> {
  const all = await fetchChatSessions();
  const meta = all.find((s) => s.paper_id === paperId);
  if (!meta) return null;
  return fetchChatSession(meta.id);
}

export async function createPaperChatSession(
  paperId: string,
  title: string,
  folderId?: string,
): Promise<ChatSession> {
  return createChatSession({ paper_id: paperId, title, folder_id: folderId });
}

/** @param target `"library"` for all saved papers, one folder id, or comma-separated folder ids */
export async function fetchContextPapers(
  target: "library" | string,
  opts?: { paperIds?: string[]; limit?: number },
): Promise<{ papers: Record<string, unknown>[]; count: number }> {
  const qs = new URLSearchParams();
  if (target === "library") {
    qs.set("scope", "library");
  } else if (target.includes(",")) {
    qs.set("scope", "folder");
    qs.set("folder_ids", target);
  } else {
    qs.set("scope", "folder");
    qs.set("folder_id", target);
  }
  if (opts?.paperIds?.length) {
    qs.set("paper_ids", opts.paperIds.join(","));
  }
  if (typeof opts?.limit === "number" && Number.isFinite(opts.limit)) {
    qs.set("limit", String(Math.max(1, Math.min(200, Math.floor(opts.limit)))));
  }
  const r = await fetch(`${API}/library/context-papers?${qs}`);
  if (!r.ok) throw new Error("Failed to load library context");
  return r.json();
}

export async function uploadChatAttachment(file: File): Promise<ChatAttachment> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API}/chat/upload`, { method: "POST", body: form });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? "Upload failed");
  }
  return r.json();
}

export async function attachLibraryPaperPdf(
  paperId: string,
  folderId: string,
): Promise<ChatAttachment> {
  const r = await fetch(`${API}/chat/attach-library-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper_id: paperId, folder_id: folderId }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? "Could not load folder PDF into chat");
  }
  return r.json();
}

export async function streamChatMessage(body: {
  message: string;
  history: ChatMessage[];
  paper_context: Record<string, unknown>[];
  attachments?: ChatAttachment[];
  context_meta?: {
    scope?: string;
    selected_count?: number;
    available_count?: number;
  };
  speed_preset?: "fast" | "balanced" | "quality";
}, signal?: AbortSignal): Promise<Response> {
  const r = await fetch(`${API}/chat/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Chat request failed (${r.status})`);
  }
  return r;
}
