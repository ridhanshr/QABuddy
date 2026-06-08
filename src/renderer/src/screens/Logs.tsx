import React from "react";
import { useApp } from "../context/AppContext";
import ConfluenceParseDebug from "../components/ConfluenceParseDebug";

export default function Logs() {
  const {
    loading,
    activeView,
    logs,
    setLogs,
    executionLoading,
    loadExecutionTracking,
    executionStats,
    executionHistory,
    executionForm,
    setExecutionForm,
    recordExecution,
  } = useApp();

  if (loading || activeView !== "logs") {
    return null;
  }

  return (
    <section style={{ maxWidth: 1000, margin: "0 auto", paddingBottom: 100 }}>
      <div className="page-header" style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 className="text-display">Logs</h2>
          <p className="text-body-lg">Activity history for sync, submit, and organize operations.</p>
        </div>
        <button 
          className="secondary-button" 
          onClick={() => { setLogs([]); void window.qaBuddy.saveLogs([]); }} 
          style={{ padding: "6px 16px", fontSize: 13, height: 36 }} 
          type="button"
        >
          <span className="material-symbols" style={{ fontSize: 16, marginRight: 4 }}>delete_sweep</span>
          Clear All
        </button>
      </div>

      {false && (
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Test Case Execution Tracking</h3>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--on-surface-variant)" }}>Catat hasil eksekusi test case dan lihat pass rate per sprint.</p>
            </div>
            <button 
              className="secondary-button" 
              type="button" 
              onClick={() => void loadExecutionTracking()} 
              disabled={executionLoading}
            >
              <span className="material-symbols" style={{ fontSize: 18, marginRight: 6 }}>refresh</span>
              Refresh
            </button>
          </div>

          {executionStats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
              {[
                { label: "Executions", value: executionStats?.totalExecutions ?? 0 },
                { label: "Passed", value: executionStats?.totalPassed ?? 0 },
                { label: "Failed", value: executionStats?.totalFailed ?? 0 },
                { label: "Pass Rate", value: `${executionStats?.passRate ?? 0}%` },
              ].map((item) => (
                <div key={item.label} style={{ padding: 16, borderRadius: 12, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)" }}>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginBottom: 6 }}>{item.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{item.value}</div>
                </div>
              ))}
            </div>
          )}

          <div className="bug-form-row-2col" style={{ gap: 12 }}>
            <label>
              <span>Test Case ID</span>
              <input
                value={executionForm.testCaseId}
                onChange={(event) => setExecutionForm((current) => ({ ...current, testCaseId: event.target.value }))}
                placeholder="TC-001"
              />
            </label>
            <label>
              <span>Test Case Title</span>
              <input
                value={executionForm.testCaseTitle}
                onChange={(event) => setExecutionForm((current) => ({ ...current, testCaseTitle: event.target.value }))}
                placeholder="Checkout payment happy path"
              />
            </label>
          </div>

          <div className="bug-form-row-2col" style={{ gap: 12, marginTop: 12 }}>
            <label>
              <span>Result</span>
              <select
                value={executionForm.result}
                onChange={(event) => setExecutionForm((current) => ({ ...current, result: event.target.value as "PASS" | "FAILED" }))}
              >
                <option value="PASS">PASS</option>
                <option value="FAILED">FAILED</option>
              </select>
            </label>
            <label>
              <span>Executed By</span>
              <input
                value={executionForm.executedBy}
                onChange={(event) => setExecutionForm((current) => ({ ...current, executedBy: event.target.value }))}
                placeholder="QA Engineer"
              />
            </label>
          </div>

          <div className="bug-form-row-2col" style={{ gap: 12, marginTop: 12 }}>
            <label>
              <span>Sprint</span>
              <input
                value={executionForm.sprint}
                onChange={(event) => setExecutionForm((current) => ({ ...current, sprint: event.target.value }))}
                placeholder="Sprint 24"
              />
            </label>
            <label>
              <span>Linked Issue Key</span>
              <input
                value={executionForm.linkedIssueKey}
                onChange={(event) => setExecutionForm((current) => ({ ...current, linkedIssueKey: event.target.value }))}
                placeholder="PAY-1042"
              />
            </label>
          </div>

          <label style={{ display: "block", marginTop: 12 }}>
            <span>Notes</span>
            <textarea
              value={executionForm.notes}
              onChange={(event) => setExecutionForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Tambahkan catatan eksekusi, evidence, atau blocker."
              rows={3}
              style={{ width: "100%", resize: "vertical" }}
            />
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="primary-button" type="button" onClick={() => void recordExecution()} disabled={executionLoading}>
              <span className="material-symbols" style={{ fontSize: 18, marginRight: 6 }}>check_circle</span>
              {executionLoading ? "Saving..." : "Record Execution"}
            </button>
          </div>

          {executionHistory.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>Recent Executions</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {executionHistory.slice(0, 8).map((item) => (
                  <div key={item.id} className="card" style={{ padding: 14, borderLeft: `4px solid ${item.result === "PASS" ? "#16a34a" : "#dc2626"}`, background: "var(--surface-container-low)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.testCaseId} - {item.testCaseTitle}</div>
                        <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 4 }}>
                          {item.executedBy} • {new Date(item.executedAt).toLocaleString("id-ID")}
                          {item.sprint ? ` • ${item.sprint}` : ""}
                          {item.linkedIssueKey ? ` • ${item.linkedIssueKey}` : ""}
                        </div>
                      </div>
                      <span className="status-pill" style={item.result === "PASS" ? { background: "rgba(22, 163, 74, 0.12)", color: "#16a34a" } : { background: "rgba(220, 38, 38, 0.12)", color: "#dc2626" }}>
                        {item.result}
                      </span>
                    </div>
                    {item.notes && (
                      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--on-surface-variant)" }}>{item.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {logs.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--on-surface-variant)" }}>
          <span className="material-symbols" style={{ fontSize: 48, display: "block", marginBottom: 12, opacity: 0.4 }}>list_alt</span>
          <p style={{ fontSize: 14 }}>Belum ada aktivitas. Log akan muncul saat Anda sync ke Confluence, submit ke Jira, atau organize Xray.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {logs.map((log) => (
            <div key={log.id} className="card" style={{ padding: 16, display: "flex", alignItems: "flex-start", gap: 12, borderLeft: `4px solid ${log.status === "success" ? "var(--tertiary)" : log.status === "error" ? "var(--error)" : "var(--outline)"}` }}>
              <span className="material-symbols" style={{ fontSize: 20, color: log.status === "success" ? "var(--tertiary)" : log.status === "error" ? "var(--error)" : "var(--outline)", marginTop: 2 }}>
                {log.status === "success" ? "check_circle" : log.status === "error" ? "cancel" : "info"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span className="log-source-badge">{log.source}</span>
                  <span style={{ fontSize: 11, color: "var(--on-surface-variant)" }}>{log.time}</span>
                </div>
                <p style={{ fontSize: 13, color: "var(--on-surface)", margin: 0 }}>{log.message}</p>
                {log.detail && <p style={{ fontSize: 12, color: "var(--on-surface-variant)", margin: "4px 0 0 0" }}>{log.detail}</p>}
                {log.debug && <ConfluenceParseDebug report={log.debug} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
