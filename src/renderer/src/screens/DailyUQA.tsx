import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { UqaIssue, UqaEntry, UqaTransition, AutoUqaGeneratedPayload } from "@shared/types";
import { useApp } from "../context/AppContext";

function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr + "T00:00:00");
  const diff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Hari ini";
  if (diff === 1) return "Kemarin";
  if (diff < 7) return `${diff} hari lalu`;
  return dateStr;
}

function lastEntryDate(entries?: UqaEntry[]): string | null {
  if (!entries || entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  return sorted[0].date;
}

interface QuickUpdateDialogProps {
  issue: UqaIssue;
  onClose: () => void;
  onSubmitted: (issueKey: string) => void;
}

function QuickUpdateDialog({ issue, onClose, onSubmitted }: QuickUpdateDialogProps) {
  const [activity, setActivity] = useState("");
  const [phase, setPhase] = useState<"SIT" | "UAT" | "DT" | "Others">("SIT");
  const [customPhase, setCustomPhase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [transitions, setTransitions] = useState<UqaTransition[]>([]);
  const [selectedTransition, setSelectedTransition] = useState("");
  const [transitionsLoading, setTransitionsLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [autoExpanded, setAutoExpanded] = useState(false);
  const [autoData, setAutoData] = useState<AutoUqaGeneratedPayload | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);

  useEffect(() => {
    window.qaBuddy.getUqaTransitions(issue.issueKey).then((t) => {
      setTransitions(t);
      setTransitionsLoading(false);
    }).catch(() => {
      setTransitionsLoading(false);
    });
  }, [issue.issueKey]);

  const handleSubmit = useCallback(async () => {
    if (!activity.trim()) return;
    const phaseLabel = phase === "Others" ? customPhase.trim() : phase;
    if (!phaseLabel) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      // Date=today, Activity=phase (SIT/UAT/DT/custom), Notes=user's activity text
      await window.qaBuddy.appendUqaEntry(issue.issueKey, today, phaseLabel, activity.trim());
      setActivity("");
      setCustomPhase("");
      setMessage({ type: "success", text: "Aktivitas berhasil dicatat!" });
      onSubmitted(issue.issueKey);
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "Gagal menyimpan aktivitas" });
    } finally {
      setSubmitting(false);
    }
  }, [activity, phase, customPhase, issue.issueKey, onSubmitted]);

  const handleTransition = useCallback(async () => {
    if (!selectedTransition) return;
    setTransitioning(true);
    setMessage(null);
    try {
      await window.qaBuddy.transitionUqaIssue(issue.issueKey, selectedTransition);
      // Resolve the target status name from the selected transition
      const targetTransition = transitions.find((t) => t.id === selectedTransition);
      const newStatus = targetTransition?.toStatus || targetTransition?.name || "";
      // Update DB — fire and forget, don't block UX on DB failure
      if (newStatus) {
        window.qaBuddy.updateUqaProjectStatus(issue.issueKey, newStatus).catch(() => {});
      }
      setMessage({ type: "success", text: "Status berhasil diupdate!" });
      onSubmitted(issue.issueKey);
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "Gagal mengubah status" });
    } finally {
      setTransitioning(false);
    }
  }, [selectedTransition, transitions, issue.issueKey, onSubmitted]);

  const handleAutoGenerate = useCallback(async () => {
    setAutoLoading(true);
    setAutoError(null);
    setAutoData(null);
    try {
      const data = await window.qaBuddy.autoGenerateUqaNotes(issue.issueKey);
      setAutoData(data);
      // Feed the generated notes into the single manual field below so the
      // user reviews/edits and submits with the one "Catat Aktivitas" button.
      setActivity(data.generatedNotes);
      const firstPhase = data.phases[0]?.phase?.toUpperCase();
      if (firstPhase === "SIT" || firstPhase === "UAT" || firstPhase === "DT") {
        setPhase(firstPhase);
      }
    } catch (err: any) {
      setAutoError(err?.message || "Gagal meng-generate notes dari Test Execution");
    } finally {
      setAutoLoading(false);
    }
  }, [issue.issueKey]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog uqa-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div className="dialog-header-info">
            <h3 className="dialog-title">{issue.issueKey}</h3>
            <p className="dialog-subtitle">{issue.summary}</p>
          </div>
          <div className="dialog-header-actions">
            <span className={`status-pill status-${issue.statusCategory?.toLowerCase() || "unknown"}`}>
              {issue.status}
            </span>
            <button className="ghost-button" onClick={onClose} type="button" title="Tutup">
              <span className="material-symbols">close</span>
            </button>
          </div>
        </div>

        <div className="dialog-body">
          {/* Section 1: Auto Generate - Collapsible */}
          <div className="uqa-section-card">
            <div
              className="uqa-section-header"
              onClick={() => setAutoExpanded((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") setAutoExpanded((v) => !v); }}
            >
              <span className="material-symbols">auto_awesome</span>
              <span>Auto Generate dari Test Execution</span>
              <span className="uqa-section-chevron material-symbols">
                {autoExpanded ? "expand_more" : "chevron_right"}
              </span>
            </div>

            {autoExpanded && (
              <div className="uqa-section-body">
                {!autoData && !autoLoading && !autoError && (
                  <button
                    className="uqa-auto-button"
                    onClick={handleAutoGenerate}
                    type="button"
                  >
                    <span className="material-symbols" style={{ fontSize: 18 }}>play_arrow</span>
                    Generate Notes
                  </button>
                )}

                {autoLoading && (
                  <div className="uqa-auto-loading">
                    <span className="uqa-auto-spinner" />
                    <span>Mengambil data Test Execution...</span>
                  </div>
                )}

                {autoError && (
                  <div className="uqa-auto-error">
                    <span className="material-symbols" style={{ fontSize: 16 }}>error</span>
                    {autoError}
                  </div>
                )}

                {autoData && (
                  <div className="uqa-auto-summary">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div className="uqa-auto-section-title" style={{ marginBottom: 0 }}>Ringkasan per Test Execution Hari Ini</div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                        padding: "2px 7px", borderRadius: 4,
                        background: autoData.source === "db" ? "color-mix(in srgb, var(--success) 13%, transparent)" : "color-mix(in srgb, var(--success) 13%, transparent)",
                        color: autoData.source === "db" ? "var(--primary)" : "var(--severity-epic)",
                        border: `1px solid ${autoData.source === "db" ? "color-mix(in srgb, var(--success) 25%, transparent)" : "color-mix(in srgb, var(--success) 25%, transparent)"}`,
                      }}>
                        {autoData.source === "db" ? "DB (last sync hari ini)" : "Xray API (live)"}
                      </span>
                    </div>

                    {autoData.phases.length === 0 && (
                      <div className="uqa-auto-phase-empty">
                        {autoData.noLinksFound
                          ? "Tidak ada Test Execution yang terhubung ke issue ini di DB. Pastikan Test Plan sudah di-sync ke DB dan Test Execution sudah di-sync hari ini."
                          : "Test Execution ditemukan namun belum memiliki test runs (data masih kosong)."}
                      </div>
                    )}

                    {autoData.phases.map((p) => (
                      <div key={p.testExecKey} className="uqa-auto-phase-row">
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span className="uqa-auto-phase-name">{p.phase}</span>
                            <span style={{ fontSize: 11, color: "var(--on-surface-variant)", fontWeight: 500 }}>{p.testExecKey}</span>
                          </div>
                          {p.testExecName && p.testExecName !== p.testExecKey && (
                            <span style={{ fontSize: 11, color: "var(--on-surface-variant)", opacity: 0.8, fontStyle: "italic" }}>{p.testExecName}</span>
                          )}
                        </div>
                        <span className="uqa-auto-phase-stats">
                          {p.todo > 0 && <span className="uqa-auto-stat uqa-auto-stat-todo">{p.todo} To Do</span>}
                          {p.inProgress > 0 && <span className="uqa-auto-stat uqa-auto-stat-progress">{p.inProgress} In Prog</span>}
                          {p.done > 0 && <span className="uqa-auto-stat uqa-auto-stat-done">{p.done} Done</span>}
                          {p.failed > 0 && <span className="uqa-auto-stat uqa-auto-stat-failed">{p.failed} Failed</span>}
                          {p.aborted > 0 && <span className="uqa-auto-stat uqa-auto-stat-aborted">{p.aborted} Aborted</span>}
                        </span>
                      </div>
                    ))}

                    <div className="uqa-auto-activity-pills">
                      {autoData.activity.map((a) => (
                        <span key={a} className="uqa-auto-activity-pill">{a}</span>
                      ))}
                    </div>

                    <div className="uqa-auto-generated-hint">
                      <span className="material-symbols" style={{ fontSize: 16 }}>arrow_downward</span>
                      Notes sudah diisi ke field "Aktivitas Hari Ini" di bawah — cek dan edit di sana, lalu klik Catat Aktivitas.
                    </div>

                    <div className="uqa-auto-actions">
                      <button
                        className="secondary-button"
                        onClick={() => { setAutoData(null); setAutoError(null); }}
                        type="button"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 2: Transition */}
          <div className="uqa-section-card uqa-section-card-compact">
            <div className="uqa-section-header">
              <span className="material-symbols">swap_horiz</span>
              <span>Transition</span>
            </div>
            <div className="uqa-section-body">
              {transitionsLoading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--on-surface-variant)" }}>
                  <span className="material-symbols spin" style={{ fontSize: 16 }}>progress_activity</span>
                  Memuat transisi...
                </div>
              ) : transitions.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--on-surface-variant)", fontStyle: "italic" }}>
                  Tidak ada transisi yang tersedia.
                </div>
              ) : (
                <div className="uqa-transition-row">
                  <select
                    className="input"
                    value={selectedTransition}
                    onChange={(e) => setSelectedTransition(e.target.value)}
                    disabled={transitioning}
                  >
                    <option value="">→ Pilih status...</option>
                    {transitions.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button
                    className="secondary-button"
                    onClick={handleTransition}
                    disabled={!selectedTransition || transitioning}
                    type="button"
                  >
                    {transitioning ? "..." : "Apply"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Section 5: Manual Input */}
          <div className="uqa-section-card">
            <div className="uqa-section-header">
              <span className="material-symbols">edit_note</span>
              <span>Aktivitas Hari Ini (Manual)</span>
            </div>
            <div className="uqa-section-body">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>
                  Fase:
                </label>
                {(["SIT", "UAT", "DT", "Others"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPhase(p)}
                    disabled={submitting}
                    style={{
                      padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      border: `1px solid ${phase === p ? "var(--primary)" : "var(--outline-variant)"}`,
                      background: phase === p ? "var(--primary)" : "transparent",
                      color: phase === p ? "var(--on-primary)" : "var(--on-surface-variant)",
                      transition: "all 0.15s",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {phase === "Others" && (
                <input
                  className="input"
                  value={customPhase}
                  onChange={(e) => setCustomPhase(e.target.value)}
                  placeholder="Sebutkan fase/kategori aktivitas..."
                  disabled={submitting}
                  style={{ marginBottom: 8 }}
                />
              )}
              <textarea
                className="input uqa-textarea"
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
                placeholder="Jelaskan aktivitas UQA hari ini..."
                rows={3}
                disabled={submitting}
              />
              <button
                className="primary-button"
                onClick={handleSubmit}
                disabled={!activity.trim() || (phase === "Others" && !customPhase.trim()) || submitting}
                type="button"
                style={{ marginTop: 8, alignSelf: "flex-start" }}
              >
                {submitting ? "Menyimpan..." : "Catat Aktivitas"}
              </button>
            </div>
          </div>

          {message && (
            <div className={`uqa-message ${message.type}`}>
              <span className="material-symbols" style={{ fontSize: 16 }}>
                {message.type === "success" ? "check_circle" : "error"}
              </span>
              {message.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DailyUQA() {
  const { setBanner, config, setConfig, saveSettings, uqaIssues, uqaSyncing, uqaSyncProgress, syncUqaIssues } = useApp();
  const [dialogIssue, setDialogIssue] = useState<UqaIssue | null>(null);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [savingUqaConfig, setSavingUqaConfig] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState("issueKey");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const statusOptions = useMemo(() => {
    const s = new Set(uqaIssues.map((i) => i.status));
    return Array.from(s).sort();
  }, [uqaIssues]);

  const processedIssues = useMemo(() => {
    let result = [...uqaIssues];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((i) => {
        const lastDate = lastEntryDate(i.entries);
        return (
          i.projectKey.toLowerCase().includes(q) ||
          i.issueKey.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          i.status.toLowerCase().includes(q) ||
          (lastDate != null && lastDate.includes(q))
        );
      });
    }

    if (statusFilter) {
      result = result.filter((i) => i.status === statusFilter);
    }

    // Sort
    result.sort((a, b) => {
      let va: string, vb: string;
      switch (sortKey) {
        case "projectKey":
          va = a.projectKey; vb = b.projectKey; break;
        case "issueKey":
          va = a.issueKey; vb = b.issueKey; break;
        case "summary":
          va = a.summary; vb = b.summary; break;
        case "status":
          va = a.status; vb = b.status; break;
        case "lastActivity":
          va = lastEntryDate(a.entries) || ""; vb = lastEntryDate(b.entries) || ""; break;
        default:
          va = a.issueKey; vb = b.issueKey;
      }
      const cmp = va.localeCompare(vb);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [uqaIssues, searchQuery, statusFilter, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: string }) =>
    sortKey === col ? (
      <span className="material-symbols uqa-sort-icon">{sortDir === "asc" ? "arrow_upward" : "arrow_downward"}</span>
    ) : null;

  const statusMeta: Record<string, { icon: string }> = {
    "Done": { icon: "check_circle" },
    "In Progress": { icon: "hourglass_top" },
    "To Do": { icon: "radio_button_unchecked" },
    "Aborted": { icon: "block" },
    "Failed": { icon: "error" },
  };

  const statusIcon = (s: string) => statusMeta[s]?.icon || "circle";

  useEffect(() => {
    const unsub = window.qaBuddy.onUqaReminder((issueKey) => {
      syncUqaIssues();
    });
    return unsub;
  }, [syncUqaIssues]);

  const handleSubmitted = useCallback((issueKey: string) => {
    setRefreshing((prev) => new Set(prev).add(issueKey));
    syncUqaIssues().then(() => {
      setRefreshing(new Set());
    });
  }, [syncUqaIssues]);

  return (
    <div className="daily-uqa">
      <div className="page-header">
        <div className="page-header-left">
          <h2 className="text-display">Daily Activities</h2>
        </div>
        <div className="page-header-right" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!uqaSyncing && (
            <button className="secondary-button" onClick={syncUqaIssues} type="button" title="Sync dari Jira">
              <span className="material-symbols">sync</span>
            </button>
          )}
          {uqaSyncing && (
            <button className="secondary-button" type="button" disabled>
              <span className="material-symbols spin">sync</span>
            </button>
          )}
          <button
            className={`icon-button ${showSettings ? "active" : ""}`}
            onClick={() => setShowSettings((v) => !v)}
            type="button"
            title="Pengaturan UQA"
          >
            <span className="material-symbols">
              {showSettings ? "close" : "settings"}
            </span>
          </button>
        </div>
       </div>

      {uqaSyncing && uqaSyncProgress && (
        <div className="card uqa-progress-card" style={{ margin: "16px 0", padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "var(--font-secondary)" }}>{uqaSyncProgress.message}</span>
            <span style={{ fontSize: 12, color: "var(--font-disabled)" }}>
              {uqaSyncProgress.current} / {uqaSyncProgress.total}
            </span>
          </div>
          <div style={{ height: 6, background: "var(--surface-secondary)", borderRadius: 3, overflow: "hidden" }}>
            <div
              className="uqa-progress-bar"
              style={{
                height: "100%",
                background: "var(--accent-primary)",
                borderRadius: 3,
                transition: "width 0.3s ease",
                width: uqaSyncProgress.total > 0 ? `${Math.min(100, (uqaSyncProgress.current / uqaSyncProgress.total) * 100)}%` : "0%",
              }}
            />
          </div>
          {uqaSyncProgress.status === "done" && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--success)" }}>Sinkronisasi selesai</div>
          )}
          {uqaSyncProgress.status === "error" && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--error)" }}>Sinkronisasi gagal</div>
          )}
        </div>
      )}

      {showSettings && (
        <div className="card uqa-settings-panel">
          <div className="uqa-settings-header">
            <span className="material-symbols">tune</span>
            <span>Pengaturan Daily UQA</span>
          </div>

          <div className="uqa-settings-section">
            <div className="uqa-settings-section-title">Metode Pencarian</div>
            <div className="uqa-settings-section-body">
              <div className="uqa-setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <div className="uqa-setting-info">
                  <span className="uqa-setting-label">Cari UQA issues berdasarkan</span>
                </div>
                <div className="uqa-search-mode-options">
                  {[
                    { v: "productTester" as const, l: "Product Tester" },
                    { v: "assignee" as const, l: "Assignee" },
                    { v: "both" as const, l: "Keduanya" },
                  ].map((opt) => (
                    <label key={opt.v} className="uqa-radio">
                      <input
                        type="radio"
                        name="uqa-search-mode"
                        checked={(config.uqa?.searchMode || "both") === opt.v}
                        onChange={() => setConfig({ ...config, uqa: { ...config.uqa, searchMode: opt.v } })}
                      />
                      <span className="uqa-radio-label">{opt.l}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="uqa-settings-divider" />

          <div className="uqa-settings-section">
            <div className="uqa-settings-section-title">Project Filter</div>
            <div className="uqa-settings-section-body">
              <div className="uqa-setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <div className="uqa-setting-info">
                  <span className="uqa-setting-label">Batasi ke project tertentu</span>
                  <span className="uqa-setting-desc">Ketik project key lalu Enter. Kosongkan untuk semua project.</span>
                </div>
                <div className="uqa-project-input-wrap">
                  <div className="uqa-project-tags">
                    {(config.uqa?.projectKeys || []).map((pk) => (
                      <span key={pk} className="uqa-project-tag">
                        {pk}
                        <button
                          className="uqa-project-tag-remove"
                          onClick={() =>
                            setConfig({
                              ...config,
                              uqa: { ...config.uqa, projectKeys: (config.uqa?.projectKeys || []).filter((k) => k !== pk) },
                            })
                          }
                          type="button"
                        >
                          <span className="material-symbols" style={{ fontSize: 12 }}>close</span>
                        </button>
                      </span>
                    ))}
                    <input
                      className="input uqa-project-input"
                      placeholder="Ketik project lalu Enter..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
                          if (val && !(config.uqa?.projectKeys || []).includes(val)) {
                            setConfig({
                              ...config,
                              uqa: { ...config.uqa, projectKeys: [...(config.uqa?.projectKeys || []), val] },
                            });
                          }
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="uqa-settings-footer">
            <button
              className="primary-button"
              onClick={async () => {
                setSavingUqaConfig(true);
                try {
                  await saveSettings();
                  await syncUqaIssues();
                  setBanner({ tone: "success", text: "Konfigurasi UQA tersimpan." });
                  setShowSettings(false);
                } catch (err: any) {
                  setBanner({ tone: "error", text: `Gagal menyimpan: ${err?.message || "Unknown"}` });
                } finally {
                  setSavingUqaConfig(false);
                }
              }}
              disabled={savingUqaConfig}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 16 }}>save</span>
              {savingUqaConfig ? "Menyimpan..." : "Simpan Pengaturan"}
            </button>
          </div>
        </div>
      )}

      {uqaIssues.length === 0 && uqaSyncing ? (
        <div className="card"><p>Memuat data UQA...</p></div>
      ) : uqaIssues.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="material-symbols empty-icon">fact_check</span>
            <p className="empty-text">Tidak ada UQA issues yang perlu diupdate.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="card uqa-table-shell">
              <div className="uqa-table-hero">
                <div className="uqa-table-hero-copy">
                <h4>Daily Activities board</h4>
                <p>Prioritizes issues that need attention today and keeps the latest activity easy to scan.</p>
              </div>
            </div>

            <div className="uqa-table-toolbar">
              <div className="uqa-table-controls">
                <label className="uqa-control-card uqa-search-wrap uqa-table-search-wrap">
                  <span className="uqa-control-label">Search</span>
                  <span className="uqa-search-input-row">
                    <span className="material-symbols uqa-search-prefix">search</span>
                    <input
                      className="input uqa-search-input"
                      placeholder="Cari issue, summary, project..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button className="uqa-search-clear" onClick={() => setSearchQuery("")} type="button">
                        <span className="material-symbols" style={{ fontSize: 16 }}>close</span>
                      </button>
                    )}
                  </span>
                </label>
                <label className="uqa-control-card uqa-status-filter-wrap">
                  <span className="uqa-control-label">Status</span>
                  <select
                    className="input uqa-status-filter"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">Semua Status</option>
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="uqa-table-scroll">
              <div className="uqa-table-header">
                <span className="uqa-th-project uqa-th-sortable" onClick={() => handleSort("projectKey")}>
                  Project<SortIcon col="projectKey" />
                </span>
                <span className="uqa-th-key uqa-th-sortable" onClick={() => handleSort("issueKey")}>
                  Issue<SortIcon col="issueKey" />
                </span>
                <span className="uqa-th-summary uqa-th-sortable" onClick={() => handleSort("summary")}>
                  Summary<SortIcon col="summary" />
                </span>
                <span className="uqa-th-last uqa-th-sortable" onClick={() => handleSort("lastActivity")}>
                  Last Activity<SortIcon col="lastActivity" />
                </span>
                <span className="uqa-th-status uqa-th-sortable" onClick={() => handleSort("status")}>
                  Status<SortIcon col="status" />
                </span>
              </div>
              <div className="uqa-table-body">
            {processedIssues.length === 0 ? (
              <div className="uqa-search-empty">
                <span className="material-symbols" style={{ fontSize: 24, color: "var(--font-disabled)" }}>search_off</span>
                <span style={{ color: "var(--font-secondary)", fontSize: 13 }}>Tidak ada hasil untuk "{searchQuery}"</span>
              </div>
            ) : processedIssues.map((issue) => {
              const lastDate = lastEntryDate(issue.entries);
              return (
                <div
                  key={issue.issueKey}
                  className={`uqa-table-row${refreshing.has(issue.issueKey) ? " refreshing" : ""}${issue.needsUpdate ? " needs-update" : ""}`}
                  onClick={() => setDialogIssue(issue)}
                >
                  <span className="uqa-issue-project">{issue.projectKey}</span>
                  <span className="uqa-issue-key">{issue.issueKey}</span>
                  <span className="uqa-issue-summary">{issue.summary}</span>
                  <span className="uqa-issue-last">
                    {lastDate ? relativeTime(lastDate) : "—"}
                  </span>
                  <span className={`uqa-badge uqa-badge-${issue.statusCategory?.toLowerCase().replace("_", "-") || "unknown"}`}>
                    <span className="material-symbols uqa-badge-icon">{statusIcon(issue.status)}</span>
                    {issue.status}
                  </span>
                </div>
              );
            })}
              </div>
            </div>
          </div>
        </>
      )}

      {dialogIssue && (
        <QuickUpdateDialog
          issue={dialogIssue}
          onClose={() => setDialogIssue(null)}
          onSubmitted={handleSubmitted}
        />
      )}
    </div>
  );
}
