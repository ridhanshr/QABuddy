import React from "react";
import { useApp } from "../context/AppContext";

import jiraIcon from "../assets/jira.png";
import confluenceIcon from "../assets/confluence.png";
import ollamaIcon from "../assets/ollama.png";

export default function Dashboard() {
  const {
    loading,
    activeView,
    dashboard,
    refreshDashboard,
    dashboardLoading,
    setBanner,
    config,
    setActiveView,
    ticketSearch,
    setTicketSearch,
    paginatedReadyForQa,
    rowsPerPage,
    setRowsPerPage,
    setCurrentPage,
    filteredReadyForQa,
    currentPage,
    totalPages,
    logs,
    status,
    ragStats,
    updateInfo,
    setSettingsTab,
  } = useApp();

  if (loading || activeView !== "dashboard" || !dashboard) {
    return null;
  }

  return (
    <section className="dashboard-layout">
      {updateInfo?.updateAvailable && (
        <div 
          className="card" 
          style={{ 
            background: "linear-gradient(135deg, rgba(249, 115, 22, 0.1) 0%, rgba(239, 68, 68, 0.1) 100%)", 
            border: "1px solid rgba(249, 115, 22, 0.25)", 
            padding: "16px 20px", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "space-between", 
            marginBottom: 20, 
            borderRadius: 12,
            boxShadow: "0 4px 20px -2px rgba(249, 115, 22, 0.08)",
            animation: "fadeIn 0.3s ease-in-out"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="material-symbols filled" style={{ color: "var(--warning, #f97316)", fontSize: 24 }}>system_update</span>
            <div>
              <strong style={{ fontSize: 14, color: "var(--on-surface)" }}>Update Baru Tersedia!</strong>
              <div style={{ fontSize: 13, color: "var(--on-surface-variant)", marginTop: 2 }}>
                Versi <strong>v{updateInfo.latestVersion}</strong> sekarang tersedia di GitHub. Unduh sekarang untuk mendapatkan fitur terbaru dan perbaikan bug.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button 
              className="insight-btn primary" 
              onClick={() => {
                if (updateInfo.url) {
                  window.qaBuddy.openExternal(updateInfo.url).catch(() => {});
                }
              }}
              style={{ background: "var(--warning, #f97316)", color: "#fff", borderColor: "transparent", fontSize: 12, fontWeight: 600, padding: "8px 16px", cursor: "pointer" }}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 16 }}>download</span>
              Unduh
            </button>
            <button 
              className="insight-btn secondary" 
              onClick={() => {
                setSettingsTab("updates");
                setActiveView("settings");
              }}
              style={{ fontSize: 12, padding: "8px 16px", cursor: "pointer" }}
              type="button"
            >
              Lihat Detail
            </button>
          </div>
        </div>
      )}
      {/* AI Daily Insight Card */}
      <div className="hero-insight-card">
        <div className="insight-bg-graphic" />
        <div className="insight-content">
          <div className="insight-icon">
            <span className="material-symbols filled">insights</span>
          </div>
          <div className="insight-copy" style={{ flex: 1 }}>
            <h3>AI Daily Insight</h3>
            <p>{(dashboard.insight || "Kualitas aplikasi stabil hari ini. Tidak ada anomali terdeteksi.").replace(/[*#|]/g, "").trim()}</p>
            <div className="button-row" style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button className="insight-btn primary" onClick={() => void refreshDashboard()} type="button">
                <span className="material-symbols" style={{ fontSize: 16 }}>summarize</span>
                {dashboardLoading ? "Refreshing..." : "Refresh"}
              </button>
              <button
                className="insight-btn secondary"
                onClick={() => {
                  const reportText = `QA Daily Insight:\n${dashboard.insight}\n\nBug Metrics:\nTotal Open: ${dashboard.bugMetrics.totalOpen}\nCritical: ${dashboard.bugMetrics.critical}\nHigh: ${dashboard.bugMetrics.high}\nMedium: ${dashboard.bugMetrics.medium}\nLow: ${dashboard.bugMetrics.low}\nEpics total: ${dashboard.bugMetrics.epicTotal}\nEpics completed: ${dashboard.bugMetrics.epicCompleted}`;
                  navigator.clipboard.writeText(reportText).then(() => {
                    setBanner({ tone: "success", text: "Report disalin ke clipboard." });
                  }).catch(() => {
                    setBanner({ tone: "error", text: "Gagal menyalin report." });
                  });
                }}
                type="button"
              >
                <span className="material-symbols" style={{ fontSize: 16 }}>share</span>
                Share Report
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bug Metrics Cards */}
      <div className="dashboard-section">
        <div className="section-header-row">
          <div>
            <h3 className="section-title">Bug Metrics</h3>
            <p className="section-subtitle">Overview of bug tracker statistics.</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          {(() => {
            const p = config.jira.projectKey;
            const base = config.jira.baseUrl.replace(/\/+$/, "");
            const baseJql = `project = "${p}" AND issuetype = Task AND resolution = Unresolved AND status NOT IN ("DROPPED/CANCELLED", "DEPLOYED") AND labels not in (NOT_DEFECT)`;
            return [
              { label: "Total Open", value: dashboard.bugMetrics.totalOpen, icon: "bug_report", color: "var(--severity-total)", jql: baseJql },
              { label: "Critical", value: dashboard.bugMetrics.critical, icon: "warning", color: "var(--severity-critical)", jql: `${baseJql} AND priority = Critical` },
              { label: "High", value: dashboard.bugMetrics.high, icon: "arrow_upward", color: "var(--severity-high)", jql: `${baseJql} AND priority = High` },
              { label: "Medium", value: dashboard.bugMetrics.medium, icon: "drag_handle", color: "var(--severity-medium)", jql: `${baseJql} AND priority = Medium` },
              { label: "Low", value: dashboard.bugMetrics.low, icon: "arrow_downward", color: "var(--severity-low)", jql: `${baseJql} AND priority = Low` },
              { label: "Epic", value: dashboard.bugMetrics.epicTotal, icon: "layers", color: "var(--severity-epic)", jql: `project = "${p}" AND issuetype = Epic` },
            ].map((metric) => (
              <div key={metric.label} className="card" style={{ padding: 20, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: base ? "pointer" : "default" }} onClick={() => { if (base) void window.qaBuddy.openExternal(`${base}/issues/?jql=${encodeURIComponent(metric.jql)}`); }}>
                <span className="material-symbols filled" style={{ fontSize: 28, color: metric.color }}>{metric.icon}</span>
                <div style={{ fontSize: 28, fontWeight: 700, color: "var(--on-surface)" }}>{metric.value}</div>
                <div style={{ fontSize: 12, color: "var(--on-surface-variant)", fontWeight: 500 }}>{metric.label}</div>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* Epic Progress + Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Epic Progress</h4>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--on-surface-variant)" }}>Completed Epics vs Tasks under open Epics</p>
            </div>
            <span className="material-symbols" style={{ fontSize: 24, color: "var(--primary)" }}>layers</span>
          </div>
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: "var(--on-surface-variant)" }}>Completed Epics</span>
                <span style={{ fontWeight: 600 }}>{dashboard.bugMetrics.epicCompleted} / {dashboard.bugMetrics.epicTotal}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--surface-container-low)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, background: "var(--severity-epic)", width: `${Math.min(100, (dashboard.bugMetrics.epicCompleted / Math.max(1, dashboard.bugMetrics.epicTotal)) * 100)}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 16, marginBottom: 6 }}>
                <span style={{ color: "var(--on-surface-variant)" }}>Resolved Tasks</span>
                <span style={{ fontWeight: 600 }}>{dashboard.bugMetrics.epicTasksResolved}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--surface-container-low)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, background: "var(--tertiary)", width: `${Math.min(100, (dashboard.bugMetrics.epicTasksResolved / Math.max(1, dashboard.bugMetrics.epicTasksTotal)) * 100)}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 16, marginBottom: 6 }}>
                <span style={{ color: "var(--on-surface-variant)" }}>Tasks under Epics</span>
                <span style={{ fontWeight: 600 }}>{dashboard.bugMetrics.epicTasksTotal} total</span>
              </div>
            </div>
            <div style={{ textAlign: "center", padding: "0 8px" }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: dashboard.bugMetrics.epicCompleted >= dashboard.bugMetrics.epicTotal ? "var(--tertiary)" : "var(--warning)" }}>
                {dashboard.bugMetrics.epicTotal > 0 ? Math.round((dashboard.bugMetrics.epicCompleted / dashboard.bugMetrics.epicTotal) * 100) : 100}%
              </div>
              <div style={{ fontSize: 11, color: "var(--on-surface-variant)", marginTop: 2 }}>epic completion</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Quick Actions</h4>
            <span className="material-symbols" style={{ fontSize: 24, color: "var(--primary)" }}>bolt</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "New Bug Report", icon: "bug_report", color: "var(--error)", onClick: () => setActiveView("bug-report") },
              { label: "Chat Assistant", icon: "chat_spark", color: "var(--severity-epic)", onClick: () => setActiveView("chat-assistant") },
              { label: "Sync Docs", icon: "description", color: "var(--info)", onClick: () => setActiveView("documentation-sync") },
              { label: "Extract Test Cases", icon: "terminal", color: "var(--tertiary)", onClick: () => setActiveView("test-case-extractor") },
            ].map((action) => (
              <button
                key={action.label}
                onClick={action.onClick}
                type="button"
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 10, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)", cursor: "pointer", color: "var(--on-surface)", fontSize: 13, fontWeight: 500, textAlign: "left", transition: "all 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = action.color; (e.currentTarget as HTMLElement).style.background = "var(--surface-container-high)" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--outline-variant)"; (e.currentTarget as HTMLElement).style.background = "var(--surface-container-low)" }}
              >
                <span className="material-symbols" style={{ fontSize: 22, color: action.color }}>{action.icon}</span>
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ready for QA Section */}
      <div className="dashboard-section">
        <div className="section-header-row">
          <div>
            <h3 className="section-title">Ready for QA</h3>
            <p className="section-subtitle">Tickets awaiting verification in the active sprint.</p>
          </div>
          <div className="search-box">
            <span className="material-symbols">search</span>
            <input
              onChange={(event) => setTicketSearch(event.target.value)}
              placeholder="Search tickets..."
              type="text"
              value={ticketSearch}
            />
          </div>
        </div>

        <div className="data-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Summary</th>
                <th>Priority</th>
                <th>Assignee</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedReadyForQa.length > 0 ? (
                paginatedReadyForQa.map((issue) => (
                  <tr key={issue.id}>
                    <td className="key-cell">
                      <button onClick={() => void window.qaBuddy.openExternal(issue.url)} type="button">
                        {issue.key}
                      </button>
                    </td>
                    <td className="summary-cell">{issue.summary}</td>
                    <td className="priority-cell">
                      <div className="priority-pill-inner">
                        {issue.priority === "Highest" || issue.priority === "Critical" ? (
                          <span className="material-symbols filled" style={{ color: "var(--severity-critical)", fontSize: 18 }}>keyboard_double_arrow_up</span>
                        ) : issue.priority === "High" ? (
                          <span className="material-symbols filled" style={{ color: "var(--severity-high)", fontSize: 18 }}>keyboard_arrow_up</span>
                        ) : issue.priority === "Low" ? (
                          <span className="material-symbols filled" style={{ color: "var(--severity-low)", fontSize: 18 }}>keyboard_arrow_down</span>
                        ) : (
                          <span className="material-symbols filled" style={{ color: "var(--severity-medium)", fontSize: 18 }}>drag_handle</span>
                        )}
                        <span>{issue.priority}</span>
                      </div>
                    </td>
                    <td>
                      <div className="assignee-cell">
                        <div className="assignee-avatar">
                          {issue.assignee?.charAt(0) || "U"}
                        </div>
                        <span>{issue.assignee}</span>
                      </div>
                    </td>
                    <td className="actions-cell">
                      <button className="icon-btn" onClick={() => void window.qaBuddy.openExternal(issue.url)} type="button">
                        <span className="material-symbols">open_in_new</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "48px", color: "var(--on-surface-variant)" }}>
                    Tidak ada tiket yang ditemukan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="table-footer">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Rows per page:</span>
              <select
                value={rowsPerPage}
                onChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)", color: "var(--on-surface)", fontSize: 13 }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span style={{ marginLeft: 8, color: "var(--on-surface-variant)" }}>
                {(currentPage - 1) * rowsPerPage + 1}–{Math.min(currentPage * rowsPerPage, filteredReadyForQa.length)} of {filteredReadyForQa.length} issues
              </span>
            </div>
            <div className="pagination" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button 
                disabled={currentPage <= 1} 
                onClick={() => setCurrentPage(1)} 
                type="button" 
                title="First page"
              >
                <span className="material-symbols">first_page</span>
              </button>
              <button 
                disabled={currentPage <= 1} 
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} 
                type="button" 
                title="Previous page"
              >
                <span className="material-symbols">chevron_left</span>
              </button>
              <span style={{ fontSize: 13, padding: "0 8px", color: "var(--on-surface)" }}>
                Page {currentPage} of {totalPages}
              </span>
              <button 
                disabled={currentPage >= totalPages} 
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} 
                type="button" 
                title="Next page"
              >
                <span className="material-symbols">chevron_right</span>
              </button>
              <button 
                disabled={currentPage >= totalPages} 
                onClick={() => setCurrentPage(totalPages)} 
                type="button" 
                title="Last page"
              >
                <span className="material-symbols">last_page</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Recent Activity + Connection Status + KB Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Recent Activity</h4>
            <span className="material-symbols" style={{ fontSize: 20, color: "var(--on-surface-variant)" }}>history</span>
          </div>
          {logs.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {logs.slice(0, 5).map((log) => (
                <div key={log.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12, padding: "8px 10px", borderRadius: 8, background: "var(--surface-container-low)" }}>
                  <span className="material-symbols" style={{ fontSize: 16, color: log.status === "success" ? "var(--tertiary)" : log.status === "error" ? "var(--error)" : "var(--outline)", marginTop: 1 }}>
                    {log.status === "success" ? "check_circle" : log.status === "error" ? "error" : "info"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, color: "var(--on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.message}</div>
                    <div style={{ color: "var(--on-surface-variant)", marginTop: 2 }}>{log.time}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--on-surface-variant)", fontStyle: "italic" }}>Belum ada aktivitas.</p>
          )}
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Connection Status</h4>
            <span className="material-symbols" style={{ fontSize: 20, color: "var(--on-surface-variant)" }}>wifi</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "Jira", ok: status.jira.ok, message: status.jira.message, icon: jiraIcon },
              { label: "Confluence", ok: status.confluence.ok, message: status.confluence.message, icon: confluenceIcon },
              { label: "Ollama", ok: status.ollama.ok, message: status.ollama.message, icon: ollamaIcon },
            ].map((svc) => (
              <div key={svc.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, background: "var(--surface-container-low)" }}>
                <img src={svc.icon} alt={svc.label} style={{ width: 24, height: 24, objectFit: "contain" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{svc.label}</div>
                  <div style={{ fontSize: 11, color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{svc.message}</div>
                </div>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: svc.ok ? "var(--tertiary)" : "var(--error)", flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Knowledge Base</h4>
            <span className="material-symbols" style={{ fontSize: 20, color: "var(--on-surface-variant)" }}>database</span>
          </div>
          {ragStats ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
                <div style={{ flex: "1 1 0", padding: "12px", borderRadius: 8, background: "var(--surface-container-low)", textAlign: "center", overflow: "hidden" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ragStats.totalChunks}</div>
                  <div style={{ fontSize: 11, color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Total Chunks</div>
                </div>
                <div style={{ flex: "1 1 0", padding: "12px", borderRadius: 8, background: "var(--surface-container-low)", textAlign: "center", overflow: "hidden" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ragStats.confluencePages}</div>
                  <div style={{ fontSize: 11, color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Pages</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
                <div style={{ flex: "1 1 0", padding: "12px", borderRadius: 8, background: "var(--surface-container-low)", textAlign: "center", overflow: "hidden" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ragStats.jiraIssues}</div>
                  <div style={{ fontSize: 11, color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Jira Issues</div>
                </div>
                <div style={{ flex: "1 1 0", padding: "12px", borderRadius: 8, background: "var(--surface-container-low)", textAlign: "center", overflow: "hidden" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ragStats.confluenceChunks + ragStats.jiraChunks}</div>
                  <div style={{ fontSize: 11, color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Embeddings</div>
                </div>
              </div>
              {(ragStats.lastConfluenceSync || ragStats.lastJiraSync) && (
                <div style={{ fontSize: 11, color: "var(--on-surface-variant)" }}>
                  {ragStats.lastConfluenceSync && <div>Confluence: {new Date(ragStats.lastConfluenceSync).toLocaleString("id-ID")}</div>}
                  {ragStats.lastJiraSync && <div>Jira: {new Date(ragStats.lastJiraSync).toLocaleString("id-ID")}</div>}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <span className="material-symbols" style={{ fontSize: 32, color: "var(--on-surface-variant)", display: "block", marginBottom: 8 }}>storage</span>
              <p style={{ fontSize: 13, color: "var(--on-surface-variant)", fontStyle: "italic" }}>Belum ada data. Index di Settings {">"} Knowledge Base.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
