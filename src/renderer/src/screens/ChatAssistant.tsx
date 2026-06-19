import React, { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";

const quickPrompts = [
  "Buatkan report untuk tiket ini",
  "Cari yang statusnya In Progress",
];

export default function ChatAssistant() {
  const {
    activeView,
    loading,
    status,
    chatMessages,
    setChatMessages,
    chatPrompt,
    setChatPrompt,
    submitChat,
    chatLoading,
    chatAttachments,
    setChatAttachments,
    setBanner,
    recentSummaries
  } = useApp();

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  if (loading || activeView !== "chat-assistant") {
    return null;
  }

  return (
    <section className="chat-layout">
      {/* ── Chat Center Panel ── */}
      <div className="chat-center">
        <div className="chat-history">
          {/* System Greeting */}
          <div className="chat-greeting" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div className="chat-greeting-pill">
              Chat session started • {status.jira.ok && status.confluence.ok ? "Jira & Confluence Connected" : "Waiting for connection..."}
            </div>
            {chatMessages.length > 1 && (
              <button
                className="icon-btn"
                onClick={() => setChatMessages([chatMessages[0]])}
                title="Clear chat"
                type="button"
                style={{ width: 28, height: 28, fontSize: 16, color: "var(--on-surface-variant)" }}
              >
                <span className="material-symbols">delete_sweep</span>
              </button>
            )}
          </div>

          {/* Messages */}
          {chatMessages.map((message, index) => (
            <div className={`chat-message-row ${message.role === "user" ? "user-row" : "ai-row"}`} key={`msg-${index}`}>
              {message.role === "assistant" && (
                <div className="ai-avatar">
                  <span className="material-symbols">robot_2</span>
                </div>
              )}
              <div className={`chat-bubble ${message.role === "user" ? "user-bubble" : "ai-bubble"}`}>
                <div className="bubble-content">
                  {message.role === "assistant" ? (
                    <div className="markdown-body" style={{ whiteSpace: "pre-wrap" }}>{message.text}</div>
                  ) : (
                    <p>{message.text}</p>
                  )}
                  
                  {message.role === "user" && message.attachments && message.attachments.length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {message.attachments.map((att, idx) => (
                        <div key={idx} style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.15)", padding: "4px 8px", borderRadius: 8, fontSize: 12, border: "1px solid rgba(255,255,255,0.2)" }}>
                          <span className="material-symbols" style={{ fontSize: 14, marginRight: 6 }}>description</span>
                          {att}
                        </div>
                      ))}
                    </div>
                  )}

                  {message.role === "assistant" && !message.response && index === chatMessages.length - 1 && (
                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                      <button
                        className="chip"
                        onClick={() => {
                          const lastUser = [...chatMessages].reverse().find(m => m.role === "user");
                          if (lastUser) void submitChat(lastUser.text);
                        }}
                        type="button"
                      >
                        <span className="material-symbols" style={{ fontSize: 14 }}>refresh</span> Coba lagi
                      </button>
                    </div>
                  )}

                  {message.response?.jql && (
                    <div className="code-box" style={{ marginTop: 12 }}>
                      <code>{message.response.jql}</code>
                      <button
                        className="icon-btn"
                        onClick={() => void navigator.clipboard.writeText(message.response?.jql || "")}
                        title="Copy to clipboard"
                        type="button"
                      >
                        <span className="material-symbols" style={{ fontSize: 16 }}>content_copy</span>
                      </button>
                    </div>
                  )}

                  {message.response?.issues && message.response.issues.length > 0 && (
                    <div className="chat-ticket-list" style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 14, marginBottom: 8 }}>Found {message.response.issues.length} matching tickets:</p>
                      {message.response.issues.map((issue) => (
                        <div 
                          className="chat-ticket-item" 
                          key={issue.id}
                          onClick={() => void window.qaBuddy.openExternal(issue.url)}
                        >
                          <span className={`dot ${issue.priority === "High" || issue.priority === "Critical" ? "error" : "warning"}`}></span>
                          <span className="key">{issue.key}</span>
                          <span className="title">{issue.summary}</span>
                          <span className="priority-tag">{issue.priority || "Medium"}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {message.response?.pages && message.response.pages.length > 0 && (
                    <div className="chat-ticket-list" style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 14, marginBottom: 8 }}>Relevant Confluence pages:</p>
                      {message.response.pages.map((page) => (
                        <div 
                          className="chat-ticket-item" 
                          key={page.id}
                          onClick={() => void window.qaBuddy.openExternal(page.url)}
                        >
                          <span className="dot" style={{ background: "var(--primary)" }}></span>
                          <span className="key" style={{ maxWidth: "none", flex: 1 }}>{page.title}</span>
                          <span className="priority-tag">Page</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {chatLoading && (
            <div className="chat-message-row ai-row">
              <div className="ai-avatar">
                <span className="material-symbols">robot_2</span>
              </div>
              <div className="chat-bubble ai-bubble" style={{ display: "flex", alignItems: "center", gap: 4, padding: "12px 20px" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--tertiary)", animation: "pulse 1.2s infinite" }} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--tertiary)", animation: "pulse 1.2s infinite 0.2s" }} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--tertiary)", animation: "pulse 1.2s infinite 0.4s" }} />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />

          {/* Suggestion Chips */}
          {chatMessages.length <= 3 && (
            <div className="suggestion-row" style={{ marginLeft: 44 }}>
              {quickPrompts.map((prompt) => (
                <button 
                  className="chip" 
                  key={prompt}
                  onClick={() => {
                    setChatPrompt(prompt);
                    void submitChat(prompt);
                  }}
                  type="button"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="chat-input-container">
          {/* Attachment Chips */}
          {chatAttachments.length > 0 && (
            <div style={{ display: "flex", gap: 8, padding: "8px 16px", flexWrap: "wrap", background: "var(--surface)", borderTop: "1px solid var(--outline-variant)" }}>
              {chatAttachments.map((att, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", background: "var(--surface-container-high)", padding: "6px 12px", borderRadius: 16, fontSize: 12, border: "1px solid var(--outline-variant)" }}>
                  <span className="material-symbols" style={{ fontSize: 16, marginRight: 6, color: "var(--on-surface-variant)" }}>description</span>
                  <span style={{ fontWeight: 500, color: "var(--on-surface)", marginRight: 8 }}>{att.name}</span>
                  <button 
                    type="button"
                    className="icon-btn"
                    style={{ width: 20, height: 20, padding: 0, minWidth: 0 }}
                    onClick={() => setChatAttachments(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <span className="material-symbols" style={{ fontSize: 14, color: "var(--error)" }}>close</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="chat-input-wrapper">
            <button 
              className="chat-input-add" 
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".txt,.log,.md,.csv,.json";
                input.onchange = async (e: any) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const limit = 20000;
                    const content = text.length > limit ? text.slice(0, limit) + "... (terpotong)" : text;
                    setChatAttachments((prev) => [...prev, { name: file.name, text: content }]);
                  } catch (err) {
                    setBanner({ tone: "error", text: "Gagal membaca isi file." });
                  }
                };
                input.click();
              }}
              type="button"
              title="Add Text Attachment"
            >
              <span className="material-symbols">add_circle</span>
            </button>
            <textarea
              onChange={(event) => setChatPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitChat();
                }
              }}
              placeholder="Tanya apa saja tentang Jira atau Confluence..."
              rows={3}
              style={{ resize: "vertical", minHeight: 44 }}
              value={chatPrompt}
            />
            <button className="chat-input-send" onClick={() => void submitChat()} type="button">
              <span className="material-symbols">{chatLoading ? "hourglass_top" : "send"}</span>
            </button>
          </div>
          <div className="chat-input-footer">
            <p className="hint"><span className="material-symbols" style={{ fontSize: 14 }}>info</span> AI can make mistakes. Verify important queries.</p>
            <div className="integrations-status">
              <span>Integrations:</span>
              <span className={`material-symbols ${status.jira.ok ? "connected" : "error"}`} title="Jira">{status.jira.ok ? "check_circle" : "cancel"}</span>
              <span className={`material-symbols ${status.confluence.ok ? "connected" : "error"}`} title="Confluence">{status.confluence.ok ? "check_circle" : "cancel"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Recent Summaries ── */}
      <aside className="chat-sidebar">
        <div className="sidebar-header">
          <span className="material-symbols" style={{ color: "var(--tertiary)" }}>article</span>
          <h3>Recent Summaries</h3>
        </div>
        <div className="sidebar-content">
          {recentSummaries.length > 0 ? (
            recentSummaries.map((summary, index) => {
              const page = summary.response?.pages?.[0];
              return (
                <div className="summary-card" key={`summary-${index}`}>
                  <div className="card-top">
                    <span className="type">Confluence Doc</span>
                    <span className="time">Just now</span>
                  </div>
                  {page ? (
                  <>
                    <h4>{page.title}</h4>
                    <p>{summary.text.length > 80 ? summary.text.slice(0, 80) + "..." : summary.text}</p>
                    <div 
                      className="card-hover-action" 
                      onClick={() => void window.qaBuddy.openExternal(page.url)}
                    >
                      <span className="material-symbols">arrow_forward</span>
                      <span>View Full Doc</span>
                    </div>
                  </>
                ) : (
                  <p>{summary.text.length > 80 ? summary.text.slice(0, 80) + "..." : summary.text}</p>
                )}
                </div>
              );
            })
          ) : (
            <div style={{ padding: 16, textAlign: "center", color: "var(--on-surface-variant)", fontSize: 13 }}>
              Belum ada ringkasan. Coba tanyakan dokumen Confluence ke asisten!
            </div>
          )}
        </div>
      </aside>
    </section>
  );
}
