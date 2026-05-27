import { downloadTextFile } from "./export";
import type { ChatSession } from "./chats";

export type ChatExportFormat = "json" | "markdown" | "txt";

export function sessionToMarkdown(session: ChatSession, contextLabel?: string): string {
  const lines = [
    `# ${session.title}`,
    "",
    `- **Created:** ${session.created_at}`,
    `- **Updated:** ${session.updated_at}`,
  ];
  if (contextLabel) lines.push(`- **Context:** ${contextLabel}`);
  lines.push("", "---", "");
  for (const m of session.messages) {
    const who = m.role === "user" ? "You" : "Research Atlas";
    lines.push(`## ${who}`, "", m.content, "", "---", "");
  }
  return lines.join("\n").trim() + "\n";
}

export function sessionToPlainText(session: ChatSession, contextLabel?: string): string {
  const lines = [
    session.title,
    `Created: ${session.created_at}`,
    contextLabel ? `Context: ${contextLabel}` : "",
    "",
  ].filter(Boolean);
  for (const m of session.messages) {
    const who = m.role === "user" ? "You" : "Research Atlas";
    lines.push(`${who}:`, m.content, "");
  }
  return lines.join("\n").trim() + "\n";
}

export function sessionsToJson(sessions: ChatSession[]): string {
  return JSON.stringify(sessions, null, 2);
}

export function sessionsToMarkdown(sessions: ChatSession[], labelFor: (s: ChatSession) => string): string {
  return sessions.map((s) => sessionToMarkdown(s, labelFor(s))).join("\n\n");
}

export function sessionsToPlainText(sessions: ChatSession[], labelFor: (s: ChatSession) => string): string {
  return sessions.map((s) => sessionToPlainText(s, labelFor(s))).join("\n\n");
}

export function downloadChatExport(
  sessions: ChatSession[],
  format: ChatExportFormat,
  filenameBase: string,
  labelFor: (s: ChatSession) => string,
) {
  if (sessions.length === 0) return;

  let content: string;
  let ext: string;
  let mime: string;

  if (format === "json") {
    content = sessionsToJson(sessions);
    ext = "json";
    mime = "application/json";
  } else if (format === "markdown") {
    content = sessions.length === 1
      ? sessionToMarkdown(sessions[0], labelFor(sessions[0]))
      : sessionsToMarkdown(sessions, labelFor);
    ext = "md";
    mime = "text/markdown";
  } else {
    content = sessions.length === 1
      ? sessionToPlainText(sessions[0], labelFor(sessions[0]))
      : sessionsToPlainText(sessions, labelFor);
    ext = "txt";
    mime = "text/plain";
  }

  const name = sessions.length === 1
    ? `${sanitize(filenameBase || sessions[0].title)}.${ext}`
    : `research-atlas-chats-${sessions.length}.${ext}`;

  downloadTextFile(content, name, mime);
}

function sanitize(name: string): string {
  return name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 60) || "chat";
}
