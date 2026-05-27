import { useEffect, useRef, useState, type Ref } from "react";
import { Send, Sparkles, Loader2, Paperclip, X, Pencil, Check, Square, Pin } from "lucide-react";
import clsx from "clsx";
import { useChat } from "../../contexts/ChatProvider";
import { API_BASE } from "../../lib/apiBase";
import { renderRichText } from "../../lib/richText";
import { perfEnd, perfStart } from "../../lib/perf";

export default function Chat() {
  const {
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
    attachments,
    uploadingAttachment,
    uploadAttachment,
    removeAttachment,
    stickyAttachments,
    addStickyAttachment,
    removeStickyAttachment,
    stopStreaming,
    editMessage,
    suggestedPdfAttachment,
    attachSuggestedPdf,
    dismissPdfSuggestion,
  } = useChat();

  const pinnedIds = new Set(stickyAttachments.map((a) => a.id));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bootMarkStartedRef = useRef(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  useEffect(() => {
    if (!bootMarkStartedRef.current) {
      perfStart("chat.boot");
      bootMarkStartedRef.current = true;
    }
    if (!booting) {
      perfEnd("chat.boot", { messages: messages.length });
    }
  }, [booting, messages.length]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const att = await uploadAttachment(file);
        if (att) {
          addStickyAttachment(att);
          removeAttachment(att.id);
        }
      } catch (e) {
        alert(e instanceof Error ? e.message : "Upload failed");
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-surface flex-col relative">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-4 pt-12 pb-44 min-h-full flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 my-auto">
              <div className="w-12 h-12 rounded-2xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary-400" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-100 tracking-tight">
                What are we exploring in your research today?
              </h2>
              <p className="text-sm text-gray-500 max-w-md">
                Chatting with{" "}
                <span className="text-gray-300 font-medium">{contextName}</span>
              </p>
            </div>
          ) : (
            <div className="space-y-8 py-4">
              {messages.map((msg, i) => (
                <div key={i}>
                  {msg.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="group max-w-[85%] rounded-3xl bg-surface-raised border border-surface-border px-5 py-3 text-sm text-gray-100 leading-relaxed shadow-sm">
                        {editingIndex === i ? (
                          <div className="space-y-2">
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              className="input min-h-[80px] resize-y"
                              autoFocus
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingIndex(null);
                                  setEditDraft("");
                                }}
                                className="btn-secondary text-xs px-2 py-1"
                              >
                                <X size={13} /> Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void editMessage(i, editDraft);
                                  setEditingIndex(null);
                                  setEditDraft("");
                                }}
                                className="btn-primary text-xs px-2 py-1"
                              >
                                <Check size={13} /> Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start gap-2">
                              <div className="flex-1">{renderRichText(msg.content)}</div>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingIndex(i);
                                  setEditDraft(msg.content);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-surface-overlay transition-all"
                                title="Edit message"
                              >
                                <Pencil size={13} />
                              </button>
                            </div>
                            {msg.attachments?.length ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {msg.attachments.map((att) => (
                                  <a
                                    key={att.id}
                                    href={`${API_BASE}/chats/attachments/${att.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-surface-overlay border border-surface-border text-gray-300"
                                    title={`Open ${att.name} (${att.text_length} extracted characters)`}
                                  >
                                    {stickyAttachments.some((s) => s.id === att.id)
                                      ? <Pin size={10} className="text-primary-400" />
                                      : <Paperclip size={10} />}
                                    {att.name}
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3 max-w-[95%]">
                      <div className="w-8 h-8 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center shrink-0">
                        <Sparkles className="w-4 h-4 text-primary-400" />
                      </div>
                      <div className="flex-1 text-sm text-gray-200 leading-relaxed pt-0.5 min-w-0">
                        {msg.content === "" && msg.streaming ? (
                          <span className="flex items-center gap-1.5 text-gray-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse" />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse [animation-delay:150ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse [animation-delay:300ms]" />
                          </span>
                        ) : (
                          <>
                            {renderRichText(msg.content)}
                            {msg.streaming && (
                              <span className="inline-block w-1.5 h-4 bg-primary-400 ml-0.5 animate-pulse align-middle" />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div ref={messagesEndRef as Ref<HTMLDivElement>} />
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-4 pb-6 pt-10 chat-composer-dock pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto">
          {suggestedPdfAttachment && (
            <div className="flex items-center gap-3 mb-3 px-4 py-3 rounded-xl bg-primary-500/10 border border-primary-500/30 text-sm">
              <div className="flex-1">
                <p className="text-primary-200 font-medium">Paper PDF available</p>
                <p className="text-gray-400 text-xs mt-0.5">Attach this paper's PDF to include it in the conversation?</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void attachSuggestedPdf()}
                  className="px-3 py-1.5 rounded-lg bg-primary-500/20 hover:bg-primary-500/30 text-primary-200 text-xs font-medium transition-colors"
                >
                  Attach PDF
                </button>
                <button
                  type="button"
                  onClick={dismissPdfSuggestion}
                  className="p-1.5 rounded-lg hover:bg-primary-500/10 text-primary-300/60 hover:text-primary-200 transition-colors"
                  title="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          {(stickyAttachments.length > 0 || attachments.length > 0) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {stickyAttachments.map((att) => (
                <span
                  key={`sticky-${att.id}`}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary-500/15 border border-primary-500/30 text-primary-200"
                  title="Pinned — sent with every message"
                >
                  <Pin size={11} className="text-primary-400" />
                  <a
                    href={`${API_BASE}/chats/attachments/${att.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-[10rem] truncate hover:text-primary-100"
                  >
                    {att.name}
                  </a>
                  <button
                    type="button"
                    onClick={() => removeStickyAttachment(att.id)}
                    className="text-primary-400/60 hover:text-red-400"
                    title="Unpin attachment"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {attachments.filter((att) => !pinnedIds.has(att.id)).map((att) => (
                <span
                  key={att.id}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-surface-raised border border-surface-border text-gray-300"
                >
                  <Paperclip size={11} className="opacity-70" />
                  <a
                    href={`${API_BASE}/chats/attachments/${att.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-[10rem] truncate hover:text-primary-300"
                    title="Open attachment"
                  >
                    {att.name}
                  </a>
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="text-gray-500 hover:text-red-400"
                    title="Remove attachment"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-3xl border border-surface-border bg-surface-raised shadow-md px-4 py-3 focus-within:border-primary-500/40 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.csv,.json,.xml,.html,.htm,.log"
              multiple
              className="hidden"
              onChange={(e) => void onPickFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || uploadingAttachment}
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-gray-400 hover:text-gray-200 hover:bg-surface-overlay disabled:opacity-40"
              title="Attach PDF or text file"
            >
              {uploadingAttachment ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            <textarea
              ref={inputRef as Ref<HTMLTextAreaElement>}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything …"
              rows={1}
              disabled={loading}
              className="flex-1 resize-none bg-transparent text-sm text-gray-100 placeholder-gray-500 focus:outline-none min-h-[24px] max-h-40 py-1"
            />
            <button
              type="button"
              onClick={() => {
                if (loading) {
                  stopStreaming();
                  return;
                }
                void sendMessage();
              }}
              disabled={(!input.trim() && attachments.length === 0 && stickyAttachments.length === 0) && !loading}
              className={clsx(
                "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors",
                ((input.trim() || attachments.length > 0 || stickyAttachments.length > 0) && !loading) || loading
                  ? "bg-primary-500 hover:bg-primary-600 text-white"
                  : "bg-surface-overlay text-gray-600 cursor-not-allowed",
              )}
            >
              {loading ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </button>
            {loading && (
              <button
                type="button"
                onClick={stopStreaming}
                className="px-2 h-9 rounded-full border border-surface-border bg-surface-overlay text-xs text-gray-200 hover:bg-surface"
              >
                Stop
              </button>
            )}
          </div>
          <p className="text-[10px] text-gray-600 mt-2 text-center pointer-events-none min-h-[14px]">
            {loading && chatPhase ? chatPhase : "Enter to send · Shift+Enter for new line · Attach PDF or text files"}
          </p>
        </div>
      </div>
    </div>
  );
}
