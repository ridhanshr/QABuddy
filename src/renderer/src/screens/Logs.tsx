import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import ConfluenceParseDebug from "../components/ConfluenceParseDebug";

const sourceIcon: Record<string, string> = {
  "Sync to Confluence": "cloud_upload",
  "Submit to Jira": "cloud_done",
  "Xray Organizer": "inventory",
  "Advanced Jira Organizer": "tune",
  "Update from Confluence": "sync",
  "Defect Repository": "bug_report",
};

const statusMeta: Record<string, { color: string; bg: string; label: string }> = {
  success: { color: "var(--success)", bg: "var(--success-container)", label: "Success" },
  error: { color: "var(--error)", bg: "var(--error-container)", label: "Error" },
  info: { color: "var(--info)", bg: "var(--info-container)", label: "Info" },
};

export default function Logs() {
  const {
    loading,
    activeView,
    logs,
    setLogs,
  } = useApp();

  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "error" | "info">("all");
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading || activeView !== "logs") {
    return null;
  }

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        return (
          log.message.toLowerCase().includes(q) ||
          (log.detail ?? "").toLowerCase().includes(q) ||
          log.source.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, statusFilter, query]);

  const counts = {
    all: logs.length,
    success: logs.filter((l) => l.status === "success").length,
    error: logs.filter((l) => l.status === "error").length,
    info: logs.filter((l) => l.status === "info").length,
  };

  return (
    <section style={{ maxWidth: 1000, margin: "0 auto", paddingBottom: 100 }}>
      <div className="page-header" style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="text-display">Logs</h2>
          <p className="text-body-lg">Activity history for sync, submit, and organize operations.</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => {
            if (logs.length === 0 || window.confirm(`Hapus semua ${logs.length} log? Tindakan ini tidak bisa dibatalkan.`)) {
              setLogs([]);
              void window.qaBuddy.saveLogs([]);
            }
          }}
          disabled={logs.length === 0}
          style={{ padding: "6px 16px", fontSize: 13, height: 36, color: logs.length > 0 ? "var(--error)" : undefined, borderColor: logs.length > 0 ? "color-mix(in srgb, var(--error) 40%, var(--outline-variant))" : undefined }}
          type="button"
        >
          <span className="material-symbols" style={{ fontSize: 16 }}>delete_sweep</span>
          Clear All
        </button>
      </div>

      {/* Toolbar: search + filter pills */}
      <div className="card" style={{ padding: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="search-box" style={{ flex: "1 1 240px", minWidth: 220 }}>
          <span className="material-symbols">search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari pesan, detail, atau sumber..."
            aria-label="Cari log"
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              style={{ position: "absolute", right: 4, width: 26, height: 26 }}
              onClick={() => setQuery("")}
              title="Hapus pencarian"
            >
              <span className="material-symbols" style={{ fontSize: 16 }}>close</span>
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "success", "error", "info"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`chip ${statusFilter === s ? "chip-active" : ""}`}
              style={{ textTransform: "capitalize" }}
            >
              {s === "all" ? "Semua" : statusMeta[s].label}
              <span style={{
                marginLeft: 6,
                fontSize: 10.5,
                fontWeight: 700,
                background: statusFilter === s ? "var(--tertiary-container)" : "var(--surface-container)",
                borderRadius: 999,
                padding: "1px 6px",
              }}>
                {counts[s]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <span className="material-symbols empty-icon">list_alt</span>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {logs.length === 0 ? "Belum ada aktivitas" : query || statusFilter !== "all" ? "Tidak ada hasil" : "Log kosong"}
          </h3>
          <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.5 }}>
            {logs.length === 0
              ? "Log akan muncul saat Anda sync ke Confluence, submit ke Jira, atau organize Xray."
              : "Coba ubah kata kunci pencarian atau reset filter status."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((log) => {
            const meta = statusMeta[log.status] ?? statusMeta.info;
            const isExpanded = expandedIds.has(log.id);
            const hasDetail = Boolean(log.detail || log.debug);
            return (
              <div
                key={log.id}
                className="card"
                onClick={() => { if (hasDetail) toggleExpanded(log.id); }}
                style={{ padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 14, cursor: hasDetail ? "pointer" : "default", userSelect: "none" }}
                title={hasDetail ? (isExpanded ? "Klik untuk menyembunyikan detail" : "Klik untuk melihat detail") : undefined}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "var(--radius-md)",
                    background: meta.bg,
                    color: meta.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span className="material-symbols" style={{ fontSize: 19 }}>
                    {log.status === "success" ? "check_circle" : log.status === "error" ? "cancel" : "info"}
                  </span>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: "var(--on-surface)" }}>
                      <span className="material-symbols" style={{ fontSize: 15, color: "var(--on-surface-variant)" }}>
                        {sourceIcon[log.source] ?? "history"}
                      </span>
                      {log.source}
                    </span>
                    <span className={`uqa-badge uqa-badge-${log.status === "success" ? "done" : log.status === "error" ? "failed" : "in-progress"}`} style={{ justifyContent: "flex-start" }}>
                      {meta.label}
                    </span>
                    {hasDetail && (
                      <span style={{ fontSize: 11, color: "var(--on-surface-variant)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                        <span className="material-symbols" style={{ fontSize: 14 }}>{isExpanded ? "unfold_less" : "unfold_more"}</span>
                        {isExpanded ? "Sembunyikan detail" : "Lihat detail"}
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--font-disabled)", fontFamily: "var(--font-mono)" }}>{log.time}</span>
                  </div>
                  <p style={{ fontSize: 13.5, color: "var(--on-surface)", margin: 0 }}>{log.message}</p>
                  {hasDetail && isExpanded && (
                    <>
                      {log.detail && (
                        <p style={{ fontSize: 12.5, color: "var(--on-surface-variant)", margin: "6px 0 0 0", lineHeight: 1.5, whiteSpace: "pre-line", fontFamily: "var(--font-mono)", userSelect: "text" }}>{log.detail}</p>
                      )}
                      {log.debug && <ConfluenceParseDebug report={log.debug} />}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
