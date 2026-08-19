import React, { useState, useEffect, useCallback, useRef } from "react";
import type { MonitoringUqaProject, MonitoringTestExecution, MonitoringTestCase } from "@shared/types";

const TE_STATUSES = ["TODO", "EXECUTING", "PASS", "FAIL", "ABORTED"] as const;
const TC_STATUSES = ["TODO", "EXECUTING", "PASS", "FAIL", "ABORTED"] as const;

function statusColor(status: string | null): string {
  if (!status) return "var(--on-surface-variant)";
  const s = status.toLowerCase();
  if (s === "pass" || s === "done" || s === "closed") return "var(--green, #2e7d32)";
  if (s === "fail" || s === "failed") return "var(--error)";
  if (s === "aborted") return "var(--warning, #e65100)";
  if (s === "in progress" || s === "executing") return "var(--primary)";
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setLocalStatus(currentStatus); }, [currentStatus]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleSelect(status: string) {
    setOpen(false);
    if (status === localStatus) return;
    setLoading(true);
    try {
      await onSelect(status);
      setLocalStatus(status);
    } catch {
      // keep old status on error
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
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
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100,
          background: "var(--surface-container)", border: "1px solid var(--outline-variant)",
          borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", minWidth: 140, overflow: "hidden",
        }}>
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
              <span style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: statusColor(s),
              }} />
              {s}
              {s === localStatus && <span className="material-symbols" style={{ fontSize: 14, marginLeft: "auto" }}>check</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  username: string;
  displayName: string;
}

export default function MonitoringScreen({ username, displayName }: Props) {
  const [uqaProjects, setUqaProjects] = useState<MonitoringUqaProject[]>([]);
  const [testExecutions, setTestExecutions] = useState<MonitoringTestExecution[]>([]);
  const [testCases, setTestCases] = useState<MonitoringTestCase[]>([]);
  const [selectedTE, setSelectedTE] = useState<MonitoringTestExecution | null>(null);

  const [loadingUqa, setLoadingUqa] = useState(false);
  const [loadingTE, setLoadingTE] = useState(false);
  const [loadingTC, setLoadingTC] = useState(false);
  const [errorUqa, setErrorUqa] = useState<string | null>(null);
  const [errorTE, setErrorTE] = useState<string | null>(null);
  const [errorTC, setErrorTC] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!displayName) return;
    setLoadingUqa(true);
    setLoadingTE(true);
    setErrorUqa(null);
    setErrorTE(null);
    try {
      const [uqa, te] = await Promise.all([
        window.qaBuddy.getMyUqaProjects(displayName, displayName),
        window.qaBuddy.getMyTestExecutions(displayName, displayName),
      ]);
      setUqaProjects(uqa);
      setTestExecutions(te);
    } catch (e: any) {
      setErrorUqa(e?.message || String(e));
      setErrorTE(e?.message || String(e));
    } finally {
      setLoadingUqa(false);
      setLoadingTE(false);
    }
  }, [displayName]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSelectTE = useCallback(async (te: MonitoringTestExecution) => {
    setSelectedTE(te);
    setTestCases([]);
    setErrorTC(null);
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
    // Update Jira Xray (TE-level status tidak ada di Xray per TC, jadi cukup DB)
    await window.qaBuddy.updateTestExecutionStatus(te.te_jira_key, newStatus);
    setTestExecutions(prev =>
      prev.map(t => t.te_jira_key === te.te_jira_key ? { ...t, execution_status: newStatus } : t)
    );
    if (selectedTE?.te_jira_key === te.te_jira_key) {
      setSelectedTE(prev => prev ? { ...prev, execution_status: newStatus } : prev);
    }
  }

  async function handleChangeTcStatus(tc: MonitoringTestCase, newStatus: string) {
    // Update Xray API + DB
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

      {/* ── My UQA Projects ── */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span className="material-symbols" style={{ color: "var(--primary)", fontSize: 20 }}>folder_special</span>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>My UQA Projects</h3>
          <span style={{ fontSize: 12, color: "var(--on-surface-variant)", marginLeft: 4 }}>
            (sebagai Assignee atau Product Tester)
          </span>
          <button onClick={fetchAll} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--primary)", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <span className="material-symbols" style={{ fontSize: 16 }}>refresh</span>
            Refresh
          </button>
        </div>

        {errorUqa && <p style={{ color: "var(--error)", fontSize: 13 }}>{errorUqa}</p>}

        <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--outline-variant)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr>
                {["UQA Key", "Project Name", "Assignee", "Product Tester", "Status", "Start QA", "Finish QA", "Finish UAT"].map(h => (
                  <th key={h} style={header}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingUqa ? (
                <tr><td colSpan={8} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                  <span className="material-symbols spin" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>progress_activity</span>
                  Memuat...
                </td></tr>
              ) : uqaProjects.length === 0 ? (
                <tr><td colSpan={8} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                  Tidak ada UQA project yang ditemukan untuk <strong>{displayName || username}</strong>
                </td></tr>
              ) : uqaProjects.map(p => (
                <tr key={p.uqa_key} style={{ background: "var(--surface)" }}>
                  <td style={cell}><span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--primary)" }}>{p.uqa_key}</span></td>
                  <td style={cell}>{p.project_name || "—"}</td>
                  <td style={cell}>{p.assignee || "—"}</td>
                  <td style={cell}>{p.product_tester || "—"}</td>
                  <td style={cell}><StatusBadge status={p.status} /></td>
                  <td style={cell}>{p.start_qa || "—"}</td>
                  <td style={cell}>{p.finish_qa || "—"}</td>
                  <td style={cell}>{p.finish_uat || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── My Test Executions ── */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span className="material-symbols" style={{ color: "var(--secondary)", fontSize: 20 }}>fact_check</span>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>My Test Executions</h3>
          <span style={{ fontSize: 12, color: "var(--on-surface-variant)", marginLeft: 4 }}>
            (klik baris untuk lihat Test Cases)
          </span>
        </div>

        {errorTE && <p style={{ color: "var(--error)", fontSize: 13 }}>{errorTE}</p>}

        <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--outline-variant)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr>
                {["TE Key", "Title", "Test Plan", "Status Eksekusi", "Assignee", "Last Sync"].map(h => (
                  <th key={h} style={header}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingTE ? (
                <tr><td colSpan={6} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                  <span className="material-symbols spin" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>progress_activity</span>
                  Memuat...
                </td></tr>
              ) : testExecutions.length === 0 ? (
                <tr><td colSpan={6} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                  Tidak ada Test Execution ditemukan untuk <strong>{displayName || username}</strong>
                </td></tr>
              ) : testExecutions.map(te => {
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
                      <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--secondary)" }}>{te.te_jira_key}</span>
                      {isSelected && <span className="material-symbols" style={{ fontSize: 14, verticalAlign: "middle", marginLeft: 6, color: "var(--primary)" }}>chevron_right</span>}
                    </td>
                    <td style={cell}>{te.title || "—"}</td>
                    <td style={cell}><span style={{ fontFamily: "monospace", fontSize: 12 }}>{te.tp_jira_key || "—"}</span></td>
                    <td style={{ ...cell }} onClick={e => e.stopPropagation()}>
                      <StatusDropdown
                        currentStatus={te.execution_status}
                        options={TE_STATUSES}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span className="material-symbols" style={{ color: "var(--tertiary)", fontSize: 20 }}>assignment</span>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Test Cases — {selectedTE.te_jira_key}
            </h3>
            <span style={{ fontSize: 12, color: "var(--on-surface-variant)", marginLeft: 4 }}>
              dieksekusi oleh <strong>{displayName || username}</strong>
            </span>
            <button
              onClick={() => { setSelectedTE(null); setTestCases([]); }}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}
            >
              <span className="material-symbols" style={{ fontSize: 16 }}>close</span>
              Tutup
            </button>
          </div>

          {errorTC && <p style={{ color: "var(--error)", fontSize: 13 }}>{errorTC}</p>}

          <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--outline-variant)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr>
                  {["TC Key", "Title", "Status Run", "Executed By", "Executed At"].map(h => (
                    <th key={h} style={header}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingTC ? (
                  <tr><td colSpan={5} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                    <span className="material-symbols spin" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>progress_activity</span>
                    Memuat Test Cases...
                  </td></tr>
                ) : testCases.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...cell, textAlign: "center", color: "var(--on-surface-variant)" }}>
                    Tidak ada test case yang dieksekusi oleh <strong>{displayName || username}</strong> pada TE ini
                  </td></tr>
                ) : testCases.map(tc => (
                  <tr key={`${tc.tc_key}-${tc.te_jira_key}`} style={{ background: "var(--surface)" }}>
                    <td style={cell}><span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--tertiary)", fontSize: 12 }}>{tc.tc_key}</span></td>
                    <td style={{ ...cell, maxWidth: 300 }}>{tc.title || "—"}</td>
                    <td style={cell}>
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
    </div>
  );
}
