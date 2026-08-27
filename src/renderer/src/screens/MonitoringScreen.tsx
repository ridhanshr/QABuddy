import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { MonitoringUqaProject, MonitoringTestExecution, MonitoringTestCase, FetchTestStepsResult } from "@shared/types";

// Workflow: OPEN → IN PROGRESS → DONE → OPEN
const TE_WORKFLOW: Record<string, readonly string[]> = {
  "OPEN":        ["IN PROGRESS"],
  "IN PROGRESS": ["DONE"],
  "DONE":        ["OPEN"],
};
const TE_ALL_STATUSES = ["OPEN", "IN PROGRESS", "DONE"] as const;

function teNextStatuses(current: string | null): readonly string[] {
  if (!current) return TE_ALL_STATUSES;
  const key = current.toUpperCase();
  return TE_WORKFLOW[key] ?? TE_ALL_STATUSES;
}
const TC_STATUSES = ["TODO", "EXECUTING", "PASS", "FAIL", "ABORTED"] as const;

function statusColor(status: string | null): string {
  if (!status) return "var(--on-surface-variant)";
  const s = status.toLowerCase();
  if (s === "done" || s === "pass" || s === "closed") return "var(--green, #2e7d32)";
  if (s === "in progress" || s === "executing") return "#3b82f6";
  if (s === "fail" || s === "failed") return "var(--error)";
  if (s === "aborted") return "var(--warning, #e65100)";
  if (s === "open") return "var(--on-surface-variant)";
  return "var(--on-surface-variant)";
}

function StatusBadge({ status }: { status: string | null }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      background: `color-mix(in srgb, ${statusColor(status)} 15%, transparent)`,
      color: statusColor(status),
      border: `1px solid color-mix(in srgb, ${statusColor(status)} 30%, transparent)`,
    }}>
      {status || "—"}
    </span>
  );
}

interface StatusDropdownProps {
  currentStatus: string | null;
  options: readonly string[];
  onSelect: (status: string) => Promise<void>;
}

function StatusDropdown({ currentStatus, options, onSelect }: StatusDropdownProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localStatus, setLocalStatus] = useState(currentStatus);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setLocalStatus(currentStatus); }, [currentStatus]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.closest("[data-status-dropdown]")?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", handler);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  async function handleSelect(status: string) {
    setOpen(false);
    if (status === localStatus) return;
    setLoading(true);
    try {
      await onSelect(status);
      setLocalStatus(status);
    } catch (err) {
      console.error("[StatusDropdown] onSelect failed:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(o => !o);
  }

  const menu = open ? createPortal(
    <div
      data-status-dropdown-menu
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: "fixed", top: menuPos.top, left: menuPos.left, zIndex: 9999,
        background: "var(--surface-container)", border: "1px solid var(--outline-variant)",
        borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.18)", minWidth: 150, overflow: "hidden",
      }}
    >
      {options.map(s => (
        <button
          key={s}
          type="button"
          onClick={(e) => { e.stopPropagation(); void handleSelect(s); }}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
            background: s === localStatus ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
            border: "none", cursor: "pointer", textAlign: "left", fontSize: 13,
            color: s === localStatus ? "var(--primary)" : "var(--on-surface)",
            fontWeight: s === localStatus ? 600 : 400,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: statusColor(s) }} />
          {s}
          {s === localStatus && <span className="material-symbols" style={{ fontSize: 14, marginLeft: "auto" }}>check</span>}
        </button>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <div data-status-dropdown style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        disabled={loading}
        title="Ganti status"
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 6px 2px 2px", borderRadius: 12, border: "1px solid var(--outline-variant)",
          background: "var(--surface-container-low)", cursor: "pointer",
          fontSize: 12, color: "var(--on-surface)", transition: "all 0.15s",
        }}
      >
        {loading
          ? <span className="material-symbols spin" style={{ fontSize: 14 }}>progress_activity</span>
          : <><StatusBadge status={localStatus} /><span className="material-symbols" style={{ fontSize: 14, color: "var(--on-surface-variant)" }}>expand_more</span></>
        }
      </button>
      {menu}
    </div>
  );
}

interface ProjectFilterDropdownProps {
  projects: MonitoringUqaProject[];
  selectedKey: string | null;
  onChange: (key: string | null) => void;
}

function ProjectFilterDropdown({ projects, selectedKey, onChange }: ProjectFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = selectedKey ? projects.find(p => p.uqa_key === selectedKey) : null;
  const label = selected ? `${selected.uqa_key} — ${selected.project_name || ""}`.trim() : "Semua Project";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 12px", borderRadius: 8,
          border: "1px solid var(--outline-variant)",
          background: selectedKey ? "color-mix(in srgb, var(--primary) 10%, var(--surface-container-low))" : "var(--surface-container-low)",
          cursor: "pointer", fontSize: 13, color: selectedKey ? "var(--primary)" : "var(--on-surface)",
          fontWeight: selectedKey ? 600 : 400, maxWidth: 280, whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        <span className="material-symbols" style={{ fontSize: 16, flexShrink: 0 }}>filter_list</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span className="material-symbols" style={{ fontSize: 14, flexShrink: 0, color: "var(--on-surface-variant)" }}>expand_more</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
          background: "var(--surface-container)", border: "1px solid var(--outline-variant)",
          borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.18)", minWidth: 320, maxHeight: 360,
          overflowY: "auto",
        }}>
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
              background: !selectedKey ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
              border: "none", borderBottom: "1px solid var(--outline-variant)",
              cursor: "pointer", textAlign: "left", fontSize: 13,
              color: !selectedKey ? "var(--primary)" : "var(--on-surface)",
              fontWeight: !selectedKey ? 700 : 400,
            }}
          >
            <span className="material-symbols" style={{ fontSize: 16 }}>all_inclusive</span>
            Semua Project
            {!selectedKey && <span className="material-symbols" style={{ fontSize: 14, marginLeft: "auto" }}>check</span>}
          </button>
          {projects.map(p => (
            <button
              key={p.uqa_key}
              type="button"
              onClick={() => { onChange(p.uqa_key); setOpen(false); }}
              style={{
                width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start",
                gap: 2, padding: "8px 14px",
                background: selectedKey === p.uqa_key ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
                border: "none", borderBottom: "1px solid var(--outline-variant)",
                cursor: "pointer", textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "var(--primary)" }}>{p.uqa_key}</span>
                {selectedKey === p.uqa_key && <span className="material-symbols" style={{ fontSize: 14, marginLeft: "auto", color: "var(--primary)" }}>check</span>}
              </div>
              <span style={{ fontSize: 12, color: "var(--on-surface-variant)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280 }}>
                {p.project_name || "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TcDetailModal({ tc, jiraBaseUrl, onClose }: {
  tc: MonitoringTestCase;
  jiraBaseUrl: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<FetchTestStepsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    window.qaBuddy.fetchTestSteps(tc.tc_key)
      .then(r => setDetail(r))
      .catch(e => setError(e?.message || String(e)))
      .finally(() => setLoading(false));
  }, [tc.tc_key]);

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8,
    color: "var(--on-surface-variant)", marginBottom: 6,
  };
  const blockStyle: React.CSSProperties = {
    background: "var(--surface-container-low)", borderRadius: 8, padding: "12px 14px",
    fontSize: 13, color: "var(--on-surface)", lineHeight: 1.6, whiteSpace: "pre-wrap",
    border: "1px solid var(--outline-variant)", minHeight: 40,
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--surface)", borderRadius: 14, boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column",
          border: "1px solid var(--outline-variant)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid var(--outline-variant)", flexShrink: 0 }}>
          <span className="material-symbols" style={{ color: "var(--tertiary)", fontSize: 20 }}>assignment</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {jiraBaseUrl ? (
                <span
                  onClick={() => void window.qaBuddy.openExternal(`${jiraBaseUrl}/browse/${tc.tc_key}`)}
                  style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "var(--tertiary)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
                >
                  {tc.tc_key}
                </span>
              ) : (
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "var(--tertiary)" }}>{tc.tc_key}</span>
              )}
              {tc.test_run_status && (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                  background: `color-mix(in srgb, ${statusColor(tc.test_run_status)} 15%, transparent)`,
                  color: statusColor(tc.test_run_status),
                  border: `1px solid color-mix(in srgb, ${statusColor(tc.test_run_status)} 30%, transparent)`,
                }}>{tc.test_run_status}</span>
              )}
            </div>
            {detail?.summary && (
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--on-surface)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {detail.summary}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)", padding: 4, display: "flex" }}>
            <span className="material-symbols" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--on-surface-variant)", fontSize: 13 }}>
              <span className="material-symbols spin" style={{ fontSize: 18 }}>progress_activity</span>
              Memuat detail dari Jira...
            </div>
          ) : error ? (
            <div style={{ color: "var(--error)", fontSize: 13 }}>{error}</div>
          ) : detail ? (
            <>
              {detail.steps && (
                <div>
                  <div style={labelStyle}>Steps to Reproduce</div>
                  <div style={blockStyle}>{detail.steps}</div>
                </div>
              )}
              {detail.inputData && (
                <div>
                  <div style={labelStyle}>Data</div>
                  <div style={blockStyle}>{detail.inputData}</div>
                </div>
              )}
              {detail.expectedResult && (
                <div>
                  <div style={labelStyle}>Expected Result</div>
                  <div style={blockStyle}>{detail.expectedResult}</div>
                </div>
              )}
              {!detail.steps && !detail.inputData && !detail.expectedResult && (
                <div style={{ color: "var(--on-surface-variant)", fontSize: 13 }}>Tidak ada detail steps pada TC ini.</div>
              )}
            </>
          ) : (
            <div style={{ color: "var(--on-surface-variant)", fontSize: 13 }}>Tidak ada data.</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

interface Props {
  username: string;
  displayName: string;
  jiraBaseUrl: string;
}

export default function MonitoringScreen({ username, displayName, jiraBaseUrl }: Props) {
  const [uqaProjects, setUqaProjects] = useState<MonitoringUqaProject[]>([]);
  const [testExecutions, setTestExecutions] = useState<MonitoringTestExecution[]>([]);
  const [testCases, setTestCases] = useState<MonitoringTestCase[]>([]);
  const [selectedTE, setSelectedTE] = useState<MonitoringTestExecution | null>(null);
  const [selectedTc, setSelectedTc] = useState<MonitoringTestCase | null>(null);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const [teTypeFilter, setTeTypeFilter] = useState<"all" | "sit" | "uat" | "dt">("all");
  const [teSearch, setTeSearch] = useState("");
  const [teSearchFocused, setTeSearchFocused] = useState(false);
  const [tcSearch, setTcSearch] = useState("");
  const [tcSearchFocused, setTcSearchFocused] = useState(false);

  const [loadingTE, setLoadingTE] = useState(false);
  const [loadingTC, setLoadingTC] = useState(false);
  const [errorTE, setErrorTE] = useState<string | null>(null);
  const [errorTC, setErrorTC] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!displayName) return;
    setLoadingTE(true);
    setErrorTE(null);
    try {
      const [uqa, te] = await Promise.all([
        window.qaBuddy.getMyUqaProjects(displayName, displayName),
        window.qaBuddy.getMyTestExecutions(displayName, displayName),
      ]);
      setUqaProjects(uqa);
      setTestExecutions(te);
    } catch (e: any) {
      setErrorTE(e?.message || String(e));
    } finally {
      setLoadingTE(false);
    }
  }, [displayName]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSelectTE = useCallback(async (te: MonitoringTestExecution) => {
    setSelectedTE(te);
    setTestCases([]);
    setErrorTC(null);
    setTcSearch("");
    setLoadingTC(true);
    try {
      const tcs = await window.qaBuddy.getMyTestCasesByExecution(te.te_jira_key, username);
      setTestCases(tcs);
    } catch (e: any) {
      setErrorTC(e?.message || String(e));
    } finally {
      setLoadingTC(false);
    }
  }, [username]);

  async function handleChangeTeStatus(te: MonitoringTestExecution, newStatus: string) {
    // Update DB
    console.log("[MonitoringScreen] Saving to DB:", te.te_jira_key, "→", JSON.stringify(newStatus));
    await window.qaBuddy.updateTestExecutionStatus(te.te_jira_key, newStatus);
    console.log("[MonitoringScreen] DB save done");

    // Update Jira via transition — non-blocking, find transition whose to_status matches
    window.qaBuddy.getUqaTransitions(te.te_jira_key)
      .then(transitions => {
        console.log("[MonitoringScreen] Jira transitions for", te.te_jira_key, ":", JSON.stringify(transitions));
        const target = newStatus.toLowerCase();
        const match = transitions.find(t => {
          const ts = (t.toStatus ?? "").toLowerCase();
          const tn = (t.name ?? "").toLowerCase();
          return ts === target || tn === target || ts.includes(target) || target.includes(ts);
        });
        if (match) {
          console.log("[MonitoringScreen] Transitioning via:", match);
          return window.qaBuddy.transitionUqaIssue(te.te_jira_key, match.id);
        } else {
          console.warn("[MonitoringScreen] No matching transition for:", newStatus, "| Available:", transitions.map(t => `${t.name} → ${t.toStatus}`));
        }
      })
      .catch(err => console.warn("[MonitoringScreen] Jira transition error:", err));

    setTestExecutions(prev =>
      prev.map(t => t.te_jira_key === te.te_jira_key ? { ...t, execution_status: newStatus } : t)
    );
    if (selectedTE?.te_jira_key === te.te_jira_key) {
      setSelectedTE(prev => prev ? { ...prev, execution_status: newStatus } : prev);
    }
  }

  async function handleChangeTcStatus(tc: MonitoringTestCase, newStatus: string) {
    await Promise.all([
      window.qaBuddy.updateTestRunStatus(tc.te_jira_key, tc.tc_key, newStatus),
      window.qaBuddy.updateTestCaseRunStatus(tc.tc_key, tc.te_jira_key, newStatus, displayName),
    ]);
    setTestCases(prev =>
      prev.map(t => t.tc_key === tc.tc_key && t.te_jira_key === tc.te_jira_key
        ? { ...t, test_run_status: newStatus, executed_by: displayName }
        : t
      )
    );
  }

  const teSearchLower = teSearch.toLowerCase().trim();
  const tcSearchLower = tcSearch.toLowerCase().trim();

  const filteredTestExecutions = testExecutions.filter(te => {
    if (selectedProjectKey && te.uqa_key !== selectedProjectKey) return false;
    if (teTypeFilter !== "all") {
      const t = (te.title || "").toLowerCase();
      if (teTypeFilter === "sit" && !t.includes("system integration test")) return false;
      if (teTypeFilter === "uat" && !t.includes("user acceptance test")) return false;
      if (teTypeFilter === "dt"  && !t.includes("deployment test")) return false;
    }
    if (teSearchLower) {
      const key = te.te_jira_key.toLowerCase();
      const title = (te.title || "").toLowerCase();
      const assignee = (te.assignee || "").toLowerCase();
      if (!key.includes(teSearchLower) && !title.includes(teSearchLower) && !assignee.includes(teSearchLower)) return false;
    }
    return true;
  });

  const filteredTestCases = testCases.filter(tc => {
    if (!tcSearchLower) return true;
    return tc.tc_key.toLowerCase().includes(tcSearchLower) ||
      (tc.title || "").toLowerCase().includes(tcSearchLower) ||
      (tc.executed_by || "").toLowerCase().includes(tcSearchLower);
  });

  const cell: React.CSSProperties = {
    padding: "10px 12px",
    borderBottom: "1px solid var(--outline-variant)",
    fontSize: 13,
    color: "var(--on-surface)",
    verticalAlign: "middle",
  };
  const header: React.CSSProperties = {
    ...cell,
    fontWeight: 700,
    fontSize: 12,
    color: "var(--on-surface-variant)",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    background: "var(--surface-container)",
    position: "sticky",
    top: 0,
    zIndex: 1,
  };

  if (!displayName) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 40, color: "var(--on-surface-variant)", fontSize: 14 }}>
        <span className="material-symbols spin" style={{ fontSize: 20 }}>progress_activity</span>
        Memuat informasi user...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

      {/* ── My Test Executions ── */}
      <section>
        {/* Row 1: title + pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span className="material-symbols" style={{ color: "var(--secondary)", fontSize: 20 }}>fact_check</span>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>My Test Executions</h3>
          <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
            (klik baris untuk lihat Test Cases)
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
            {(["all", "sit", "uat", "dt"] as const).map(type => {
              const labels: Record<string, string> = { all: "All", sit: "SIT", uat: "UAT", dt: "DT" };
              const active = teTypeFilter === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setTeTypeFilter(type); setSelectedTE(null); setTestCases([]); }}
                  style={{
                    padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: active ? 700 : 400,
                    border: `1px solid ${active ? "var(--secondary)" : "var(--outline-variant)"}`,
                    background: active ? "color-mix(in srgb, var(--secondary) 15%, transparent)" : "transparent",
                    color: active ? "var(--secondary)" : "var(--on-surface-variant)",
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  {labels[type]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: search (grows) + project filter + refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 8,
            border: `1px solid ${teSearchFocused ? "var(--primary)" : "var(--outline-variant)"}`,
            background: "var(--surface-container-low)", transition: "border-color 0.15s",
          }}>
            <span className="material-symbols" style={{ fontSize: 16, color: "var(--on-surface-variant)", flexShrink: 0 }}>search</span>
            <input
              type="text"
              placeholder="Cari TE key, judul, assignee..."
              value={teSearch}
              onChange={e => setTeSearch(e.target.value)}
              onFocus={() => setTeSearchFocused(true)}
              onBlur={() => setTeSearchFocused(false)}
              style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 13, color: "var(--on-surface)", minWidth: 0 }}
            />
            {teSearch && (
              <button
                type="button"
                onClick={() => setTeSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--on-surface-variant)", flexShrink: 0 }}
              >
                <span className="material-symbols" style={{ fontSize: 14 }}>close</span>
              </button>
            )}
          </div>
          <ProjectFilterDropdown
            projects={uqaProjects}
            selectedKey={selectedProjectKey}
            onChange={(key) => { setSelectedProjectKey(key); setSelectedTE(null); setTestCases([]); }}
          />
          <button
            onClick={fetchAll}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", display: "flex", alignItems: "center", gap: 4, fontSize: 13, padding: "6px 8px", flexShrink: 0 }}
          >
            <span className="material-symbols" style={{ fontSize: 16 }}>refresh</span>
            Refresh
          </button>
        </div>

        {errorTE && <p style={{ color: "var(--error)", fontSize: 13 }}>{errorTE}</p>}

        <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--outline-variant)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "14%" }} />
              <col style={{ width: "34%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr>
                {["TE Key", "Title", "Test Plan", "Status", "Assignee", "Last Sync"].map(h => (
                  <th key={h} style={{ ...header, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingTE ? (
                <tr><td colSpan={6} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                  <span className="material-symbols spin" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>progress_activity</span>
                  Memuat...
                </td></tr>
              ) : filteredTestExecutions.length === 0 ? (
                <tr><td colSpan={6} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                  {selectedProjectKey
                    ? <>Tidak ada Test Execution untuk project <strong>{selectedProjectKey}</strong></>
                    : <>Tidak ada Test Execution ditemukan untuk <strong>{displayName || username}</strong></>
                  }
                </td></tr>
              ) : filteredTestExecutions.map(te => {
                const isSelected = selectedTE?.te_jira_key === te.te_jira_key;
                return (
                  <tr
                    key={te.te_jira_key}
                    onClick={() => handleSelectTE(te)}
                    style={{
                      cursor: "pointer",
                      background: isSelected ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "var(--surface)",
                      outline: isSelected ? "2px solid var(--primary)" : undefined,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "var(--surface-container-low)"; }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "var(--surface)"; }}
                  >
                    <td style={cell}>
                      <span
                        onClick={e => { e.stopPropagation(); if (jiraBaseUrl) void window.qaBuddy.openExternal(`${jiraBaseUrl}/browse/${te.te_jira_key}`); }}
                        title={jiraBaseUrl ? `Buka ${te.te_jira_key} di Jira` : te.te_jira_key}
                        style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--secondary)", cursor: jiraBaseUrl ? "pointer" : "default", textDecoration: jiraBaseUrl ? "underline" : "none", textUnderlineOffset: 2 }}
                      >
                        {te.te_jira_key}
                      </span>
                      {isSelected && <span className="material-symbols" style={{ fontSize: 14, verticalAlign: "middle", marginLeft: 6, color: "var(--primary)" }}>chevron_right</span>}
                    </td>
                    <td style={{ ...cell, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={te.title || ""}>{te.title || "—"}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}><span style={{ fontFamily: "monospace", fontSize: 12 }}>{te.tp_jira_key || "—"}</span></td>
                    <td style={{ ...cell }} onClick={e => e.stopPropagation()}>
                      <StatusDropdown
                        currentStatus={te.execution_status}
                        options={teNextStatuses(te.execution_status)}
                        onSelect={(s) => handleChangeTeStatus(te, s)}
                      />
                    </td>
                    <td style={cell}>{te.assignee || "—"}</td>
                    <td style={{ ...cell, fontSize: 12, color: "var(--on-surface-variant)" }}>{te.last_sync || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Test Cases for selected TE ── */}
      {selectedTE && (
        <section>
          {/* TC header row 1: title + close */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="material-symbols" style={{ color: "var(--tertiary)", fontSize: 20 }}>assignment</span>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Test Cases — {selectedTE.te_jira_key}
            </h3>
            <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
              dieksekusi oleh <strong>{displayName || username}</strong>
            </span>
            <button
              onClick={() => { setSelectedTE(null); setTestCases([]); setTcSearch(""); }}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}
            >
              <span className="material-symbols" style={{ fontSize: 16 }}>close</span>
              Tutup
            </button>
          </div>

          {/* TC header row 2: search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginBottom: 12,
            padding: "6px 12px", borderRadius: 8,
            border: `1px solid ${tcSearchFocused ? "var(--tertiary)" : "var(--outline-variant)"}`,
            background: "var(--surface-container-low)", transition: "border-color 0.15s",
          }}>
            <span className="material-symbols" style={{ fontSize: 16, color: "var(--on-surface-variant)", flexShrink: 0 }}>search</span>
            <input
              type="text"
              placeholder="Cari TC key, judul, executed by..."
              value={tcSearch}
              onChange={e => setTcSearch(e.target.value)}
              onFocus={() => setTcSearchFocused(true)}
              onBlur={() => setTcSearchFocused(false)}
              style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 13, color: "var(--on-surface)", minWidth: 0 }}
            />
            {tcSearch && (
              <button
                type="button"
                onClick={() => setTcSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--on-surface-variant)", flexShrink: 0 }}
              >
                <span className="material-symbols" style={{ fontSize: 14 }}>close</span>
              </button>
            )}
          </div>

          {errorTC && <p style={{ color: "var(--error)", fontSize: 13 }}>{errorTC}</p>}

          <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--outline-variant)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "14%" }} />
                <col style={{ width: "40%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "14%" }} />
              </colgroup>
              <thead>
                <tr>
                  {["TC Key", "Title", "Status Run", "Executed By", "Executed At"].map(h => (
                    <th key={h} style={{ ...header, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingTC ? (
                  <tr><td colSpan={5} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                    <span className="material-symbols spin" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>progress_activity</span>
                    Memuat Test Cases...
                  </td></tr>
                ) : filteredTestCases.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                    {tcSearchLower ? <>Tidak ada TC yang cocok dengan "<strong>{tcSearch}</strong>"</> : <>Tidak ada test case yang dieksekusi oleh <strong>{displayName || username}</strong> pada TE ini</>}
                  </td></tr>
                ) : filteredTestCases.map(tc => (
                  <tr
                    key={`${tc.tc_key}-${tc.te_jira_key}`}
                    onClick={() => setSelectedTc(tc)}
                    style={{ background: "var(--surface)", cursor: "pointer", transition: "background 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface-container-low)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface)"; }}
                  >
                    <td style={cell}>
                      <span
                        onClick={() => { if (jiraBaseUrl) void window.qaBuddy.openExternal(`${jiraBaseUrl}/browse/${tc.tc_key}`); }}
                        title={jiraBaseUrl ? `Buka ${tc.tc_key} di Jira` : tc.tc_key}
                        style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--tertiary)", fontSize: 12, cursor: jiraBaseUrl ? "pointer" : "default", textDecoration: jiraBaseUrl ? "underline" : "none", textUnderlineOffset: 2 }}
                      >
                        {tc.tc_key}
                      </span>
                    </td>
                    <td style={{ ...cell, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tc.title || ""}>{tc.title || "—"}</td>
                    <td style={cell} onClick={e => e.stopPropagation()}>
                      <StatusDropdown
                        currentStatus={tc.test_run_status}
                        options={TC_STATUSES}
                        onSelect={(s) => handleChangeTcStatus(tc, s)}
                      />
                    </td>
                    <td style={cell}>{tc.executed_by || "—"}</td>
                    <td style={{ ...cell, fontSize: 12, color: "var(--on-surface-variant)" }}>{tc.executed_at || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedTc && (
        <TcDetailModal
          tc={selectedTc}
          jiraBaseUrl={jiraBaseUrl}
          onClose={() => setSelectedTc(null)}
        />
      )}
    </div>
  );
}
