import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context/AppContext";
import type { DashboardProjectConfig, DashboardProjectData, JiraIssueSummary, ProjectInsightRequest } from "@shared/types";

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
    showDashboardConfig,
    setShowDashboardConfig,
    dashboardProjects,
    setDashboardProjects,
    saveDashboardConfig,
  } = useApp();

  const [activeProjectTab, setActiveProjectTab] = useState<string>("all");
  const [projectPage, setProjectPage] = useState(1);
  const projectRowsPerPage = 10;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [projectInsight, setProjectInsight] = useState<string | null>(null);
  const [projectInsightLoading, setProjectInsightLoading] = useState(false);
  const [labelExcludeDrafts, setLabelExcludeDrafts] = useState<string[]>([]);
  const [labelIncludeDrafts, setLabelIncludeDrafts] = useState<string[]>([]);
  const [statusExcludeDrafts, setStatusExcludeDrafts] = useState<string[]>([]);
  const [statusIncludeDrafts, setStatusIncludeDrafts] = useState<string[]>([]);

  useEffect(() => {
    if (showDashboardConfig) {
      document.body.style.overflow = "hidden";
      setTimeout(() => dialogRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [showDashboardConfig]);

  // Computed data based on active tab
  const projectKeys = Object.keys(dashboard?.projects || {});
  const hasProjects = projectKeys.length > 0;
  const activeProjectData: DashboardProjectData | undefined = activeProjectTab !== "all"
    ? dashboard?.projects?.[activeProjectTab]
    : undefined;

  // For "all" tab: aggregate bugMetrics and readyForQa from all projects
  const zeroMetrics = {
    totalOpen: 0, critical: 0, high: 0, medium: 0, low: 0,
    resolvedThisSprint: 0, foundThisSprint: 0,
    epicTotal: 0, epicCompleted: 0, epicTasksTotal: 0, epicTasksResolved: 0,
  };
  const activeBugMetrics = activeProjectTab === "all" && hasProjects
    ? projectKeys.reduce((acc, pk) => {
        const bm = dashboard?.projects?.[pk]?.bugMetrics;
        if (!bm) return acc;
        return {
          totalOpen: acc.totalOpen + bm.totalOpen,
          critical: acc.critical + bm.critical,
          high: acc.high + bm.high,
          medium: acc.medium + bm.medium,
          low: acc.low + bm.low,
          resolvedThisSprint: acc.resolvedThisSprint + bm.resolvedThisSprint,
          foundThisSprint: acc.foundThisSprint + bm.foundThisSprint,
          epicTotal: acc.epicTotal + bm.epicTotal,
          epicCompleted: acc.epicCompleted + bm.epicCompleted,
          epicTasksTotal: acc.epicTasksTotal + bm.epicTasksTotal,
          epicTasksResolved: acc.epicTasksResolved + bm.epicTasksResolved,
        };
      }, { ...zeroMetrics })
    : activeProjectData?.bugMetrics || dashboard?.bugMetrics || zeroMetrics;

  const activeReadyForQa = activeProjectTab === "all" && hasProjects
    ? (() => {
        const seen = new Set<string>();
        const merged: JiraIssueSummary[] = [];
        for (const pk of projectKeys) {
          const issues = dashboard?.projects?.[pk]?.readyForQa || [];
          for (const issue of issues) {
            if (!seen.has(issue.key)) {
              seen.add(issue.key);
              merged.push(issue);
            }
          }
        }
        return merged;
      })()
    : activeProjectData?.readyForQa || dashboard?.readyForQa || [];

  // Generate insight text for "all" tab from aggregated data
  const allProjectsInsight = activeProjectTab === "all" && hasProjects
    ? (() => {
        const sprint = dashboard?.sprintReport;
        if (sprint) {
          return `Dashboard All Projects — Sprint ${sprint.sprintName}: ${sprint.completionPercent}% selesai (${sprint.completedIssues}/${sprint.totalIssues} issue). ${activeBugMetrics.totalOpen} bug terbuka (${activeBugMetrics.critical} kritis, ${activeBugMetrics.high} high). ${activeReadyForQa.length} issue siap QA di ${projectKeys.length} project.`;
        }
        return `Dashboard All Projects — ${activeBugMetrics.totalOpen} bug terbuka (${activeBugMetrics.critical} kritis, ${activeBugMetrics.high} high). ${activeReadyForQa.length} issue siap QA di ${projectKeys.length} project.`;
      })()
    : null;

  // Local pagination for per-project QA table
  const projectFiltered = activeProjectData
    ? activeReadyForQa.filter((i) =>
        !ticketSearch || i.key.toLowerCase().includes(ticketSearch.toLowerCase()) || i.summary.toLowerCase().includes(ticketSearch.toLowerCase())
      )
    : activeProjectTab === "all" && hasProjects
      ? activeReadyForQa.filter((i) =>
          !ticketSearch || i.key.toLowerCase().includes(ticketSearch.toLowerCase()) || i.summary.toLowerCase().includes(ticketSearch.toLowerCase())
        )
      : [];
  const projectTotalPages = Math.max(1, Math.ceil(projectFiltered.length / projectRowsPerPage));
  const projectPaginated = projectFiltered.slice(
    (projectPage - 1) * projectRowsPerPage,
    projectPage * projectRowsPerPage
  );

  // Fetch per-project insight when switching tabs
  useEffect(() => {
    if (activeProjectTab === "all" || !activeProjectData) {
      setProjectInsight(null);
      return;
    }
    setProjectInsightLoading(true);
    const request: ProjectInsightRequest = {
      projectKey: activeProjectTab,
      bugMetrics: activeProjectData.bugMetrics,
      readyForQa: activeProjectData.readyForQa,
    };
    window.qaBuddy.getProjectInsight(request)
      .then((insight) => setProjectInsight(insight))
      .catch(() => setProjectInsight(null))
      .finally(() => setProjectInsightLoading(false));
  }, [activeProjectTab, activeProjectData]);

  if (loading || activeView !== "dashboard") {
    return null;
  }

  if (!dashboard) {
    return (
      <section className="dashboard-layout">
        <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "40px 0" }}>
          <div className="hero-insight-card" style={{ height: 140, opacity: 0.4 }}>
            <div className="insight-bg-graphic" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card" style={{ padding: 20, height: 100, opacity: 0.3 }} />
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div className="card" style={{ padding: 24, height: 180, opacity: 0.3 }} />
            <div className="card" style={{ padding: 24, height: 180, opacity: 0.3 }} />
          </div>
        </div>
        <p style={{ textAlign: "center", color: "var(--on-surface-variant)", fontSize: 14, marginTop: -20 }}>
          Memuat dashboard...
        </p>
      </section>
    );
  }

  return (
      <section className="dashboard-layout">
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .skeleton {
          background: linear-gradient(90deg, var(--surface-container-low) 25%, var(--surface-container-high) 50%, var(--surface-container-low) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
          border-radius: 6px;
        }
      `}</style>
      {/* Dashboard header with settings gear */}
      <div className="section-header-row" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="text-display" style={{ margin: 0 }}>Dashboard</h2>
        </div>
        <button className="icon-btn" onClick={() => {
          const projects = config.dashboard?.projects || [];
          setDashboardProjects(projects);
          setLabelExcludeDrafts(projects.map(p => p.excludeLabels.join(", ")));
          setLabelIncludeDrafts(projects.map(p => p.includeLabels.join(", ")));
          setStatusExcludeDrafts(projects.map(p => p.excludeStatuses.join(", ")));
          setStatusIncludeDrafts(projects.map(p => p.includeStatuses.join(", ")));
          setShowDashboardConfig(true);
        }} type="button" title="Dashboard Settings">
          <span className="material-symbols">settings</span>
        </button>
      </div>

      {/* Project tabs */}
      {hasProjects && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className={`chip ${activeProjectTab === "all" ? "chip-active" : ""}`}
            onClick={() => { setActiveProjectTab("all"); setProjectPage(1); }}
            type="button"
          >
            All
          </button>
          {projectKeys.map((pk) => (
            <button
              key={pk}
              className={`chip ${activeProjectTab === pk ? "chip-active" : ""}`}
              onClick={() => { setActiveProjectTab(pk); setProjectPage(1); }}
              type="button"
            >
              {pk}
            </button>
          ))}
        </div>
      )}

      {dashboard.isDemo && (
        <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", padding: "10px 16px", borderRadius: 10, marginBottom: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
          <span className="material-symbols filled" style={{ color: "var(--error)", fontSize: 20 }}>info</span>
          <span style={{ color: "var(--on-surface)" }}><strong>Data Demo</strong> — Koneksi Jira gagal. Periksa Settings &gt; Jira Configuration.</span>
        </div>
      )}
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
            <h3>AI Daily Insight{activeProjectTab !== "all" ? ` — ${activeProjectTab}` : ""}</h3>
            {activeProjectTab !== "all" && projectInsightLoading ? (
              <p style={{ color: "var(--on-surface-variant)" }}>
                <span className="material-symbols" style={{ fontSize: 16, animation: "spin 1s linear infinite", verticalAlign: "middle", marginRight: 6 }}>sync</span>
                Generating insight for {activeProjectTab}...
              </p>
            ) : (
              <p>{(activeProjectTab !== "all" && projectInsight ? projectInsight : allProjectsInsight || dashboard.insight || "Kualitas aplikasi stabil hari ini. Tidak ada anomali terdeteksi.").replace(/[*#|]/g, "").trim()}</p>
            )}
            <div className="button-row" style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button className="insight-btn primary" onClick={() => void refreshDashboard()} type="button">
                <span className="material-symbols" style={{ fontSize: 16 }}>summarize</span>
                {dashboardLoading ? "Refreshing..." : "Refresh"}
              </button>
              <button
                className="insight-btn secondary"
                onClick={() => {
                  const insightText = activeProjectTab !== "all" && projectInsight
                    ? projectInsight
                    : allProjectsInsight || dashboard.insight;
                  const reportText = `QA Daily Insight:\n${insightText}\n\nBug Metrics:\nTotal Open: ${activeBugMetrics.totalOpen}\nCritical: ${activeBugMetrics.critical}\nHigh: ${activeBugMetrics.high}\nMedium: ${activeBugMetrics.medium}\nLow: ${activeBugMetrics.low}\nEpics total: ${activeBugMetrics.epicTotal}\nEpics completed: ${activeBugMetrics.epicCompleted}`;
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
            <p className="section-subtitle">Overview of bug tracker statistics.{activeProjectTab !== "all" ? ` (${activeProjectTab})` : ""}</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          {(() => {
            const p = activeProjectTab !== "all" ? activeProjectTab : config.jira.projectKey;
            const base = config.jira.baseUrl.replace(/\/+$/, "");
            const baseJql = `project = "${p}" AND status NOT IN ("DROPPED/CANCELLED", "DEPLOYED") AND labels not in (NOT_DEFECT)`;
            return [
              { label: "Total Open", value: activeBugMetrics.totalOpen, icon: "bug_report", color: "var(--severity-total)", jql: baseJql },
              { label: "Critical", value: activeBugMetrics.critical, icon: "warning", color: "var(--severity-critical)", jql: `${baseJql} AND priority = Critical` },
              { label: "High", value: activeBugMetrics.high, icon: "arrow_upward", color: "var(--severity-high)", jql: `${baseJql} AND priority = High` },
              { label: "Medium", value: activeBugMetrics.medium, icon: "drag_handle", color: "var(--severity-medium)", jql: `${baseJql} AND priority = Medium` },
              { label: "Low", value: activeBugMetrics.low, icon: "arrow_downward", color: "var(--severity-low)", jql: `${baseJql} AND priority = Low` },
              { label: "Epic", value: activeBugMetrics.epicTotal, icon: "layers", color: "var(--severity-epic)", jql: `project = "${p}" AND issuetype = Epic` },
            ].map((metric) => (
              <div key={metric.label} className="card" style={{ padding: 20, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: base ? "pointer" : "default" }} onClick={() => { if (base) void window.qaBuddy.openExternal(`${base}/issues/?jql=${encodeURIComponent(metric.jql)}`); }}>
                <span className="material-symbols filled" style={{ fontSize: 28, color: metric.color }}>{metric.icon}</span>
                <div style={{ fontSize: 28, fontWeight: 700, color: "var(--on-surface)" }}>
                  {dashboardLoading
                    ? <div className="skeleton" style={{ height: 32, width: 60, margin: "0 auto" }} />
                    : metric.value}
                </div>
                <div style={{ fontSize: 12, color: "var(--on-surface-variant)", fontWeight: 500 }}>{metric.label}</div>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* Epic Progress + Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        <div className="card" style={{ padding: 24 }}>
            {dashboardLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div className="skeleton" style={{ height: 20, width: 160 }} />
                <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="skeleton" style={{ height: 14, width: "100%" }} />
                    <div className="skeleton" style={{ height: 8, width: "100%" }} />
                    <div className="skeleton" style={{ height: 14, width: "100%" }} />
                    <div className="skeleton" style={{ height: 8, width: "100%" }} />
                    <div className="skeleton" style={{ height: 14, width: "60%" }} />
                  </div>
                  <div className="skeleton" style={{ height: 48, width: 64 }} />
                </div>
              </div>
            ) : (<>
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
                <span style={{ fontWeight: 600 }}>{activeBugMetrics.epicCompleted} / {activeBugMetrics.epicTotal}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--surface-container-low)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, background: "var(--severity-epic)", width: `${Math.min(100, (activeBugMetrics.epicCompleted / Math.max(1, activeBugMetrics.epicTotal)) * 100)}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 16, marginBottom: 6 }}>
                <span style={{ color: "var(--on-surface-variant)" }}>Resolved Tasks</span>
                <span style={{ fontWeight: 600 }}>{activeBugMetrics.epicTasksResolved}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--surface-container-low)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, background: "var(--tertiary)", width: `${Math.min(100, (activeBugMetrics.epicTasksResolved / Math.max(1, activeBugMetrics.epicTasksTotal)) * 100)}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 16, marginBottom: 6 }}>
                <span style={{ color: "var(--on-surface-variant)" }}>Tasks under Epics</span>
                <span style={{ fontWeight: 600 }}>{activeBugMetrics.epicTasksTotal} total</span>
              </div>
            </div>
            <div style={{ textAlign: "center", padding: "0 8px" }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: activeBugMetrics.epicTotal > 0 && activeBugMetrics.epicCompleted >= activeBugMetrics.epicTotal ? "var(--tertiary)" : "var(--warning)" }}>
                {activeBugMetrics.epicTotal > 0 ? Math.round((activeBugMetrics.epicCompleted / activeBugMetrics.epicTotal) * 100) : 0}%
              </div>
              <div style={{ fontSize: 11, color: "var(--on-surface-variant)", marginTop: 2 }}>epic completion</div>
            </div>
            </div>
          </>
        )}
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Quick Actions</h4>
            <span className="material-symbols" style={{ fontSize: 24, color: "var(--primary)" }}>bolt</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "Add Defect", icon: "bug_report", color: "var(--error)", onClick: () => setActiveView("defect-repository") },
              { label: "Chat Assistant", icon: "chat_spark", color: "var(--severity-epic)", onClick: () => setActiveView("chat-assistant") },
              { label: "Sync Docs", icon: "description", color: "var(--info)", onClick: () => setActiveView("documentation-sync") },
              { label: "Extract Test Cases", icon: "terminal", color: "var(--tertiary)", onClick: () => setActiveView("manual-test-case") },
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
            <p className="section-subtitle">Tickets awaiting verification in the active sprint.{activeProjectTab !== "all" ? ` (${activeProjectTab})` : ""}</p>
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
              {dashboardLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td><div className="skeleton" style={{ height: 16, width: 80 }} /></td>
                    <td><div className="skeleton" style={{ height: 16, width: "90%" }} /></td>
                    <td><div className="skeleton" style={{ height: 16, width: 60 }} /></td>
                    <td><div className="skeleton" style={{ height: 16, width: 100 }} /></td>
                    <td><div className="skeleton" style={{ height: 16, width: 32, marginLeft: "auto" }} /></td>
                  </tr>
                ))
              ) : projectPaginated.length > 0 ? (
                projectPaginated.map((issue) => (
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
                disabled={!!activeProjectData || activeProjectTab === "all"}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span style={{ marginLeft: 8, color: "var(--on-surface-variant)" }}>
                {(activeProjectData || activeProjectTab === "all")
                  ? projectFiltered.length > 0
                    ? `${(projectPage - 1) * projectRowsPerPage + 1}–${Math.min(projectPage * projectRowsPerPage, projectFiltered.length)} of ${projectFiltered.length} issues`
                    : "0 of 0 issues"
                  : filteredReadyForQa.length > 0
                    ? `${(currentPage - 1) * rowsPerPage + 1}–${Math.min(currentPage * rowsPerPage, filteredReadyForQa.length)} of ${filteredReadyForQa.length} issues`
                    : "0 of 0 issues"
                }
              </span>
            </div>
            <div className="pagination" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {(activeProjectData || activeProjectTab === "all") ? (
                <>
                  <button disabled={projectPage <= 1} onClick={() => setProjectPage(1)} type="button" title="First page">
                    <span className="material-symbols">first_page</span>
                  </button>
                  <button disabled={projectPage <= 1} onClick={() => setProjectPage((p) => Math.max(1, p - 1))} type="button" title="Previous page">
                    <span className="material-symbols">chevron_left</span>
                  </button>
                  <span style={{ fontSize: 13, padding: "0 8px", color: "var(--on-surface)" }}>
                    Page {projectPage} of {projectTotalPages}
                  </span>
                  <button disabled={projectPage >= projectTotalPages} onClick={() => setProjectPage((p) => Math.min(projectTotalPages, p + 1))} type="button" title="Next page">
                    <span className="material-symbols">chevron_right</span>
                  </button>
                  <button disabled={projectPage >= projectTotalPages} onClick={() => setProjectPage(projectTotalPages)} type="button" title="Last page">
                    <span className="material-symbols">last_page</span>
                  </button>
                </>
              ) : (
                <>
                  <button disabled={currentPage <= 1} onClick={() => setCurrentPage(1)} type="button" title="First page">
                    <span className="material-symbols">first_page</span>
                  </button>
                  <button disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} type="button" title="Previous page">
                    <span className="material-symbols">chevron_left</span>
                  </button>
                  <span style={{ fontSize: 13, padding: "0 8px", color: "var(--on-surface)" }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} type="button" title="Next page">
                    <span className="material-symbols">chevron_right</span>
                  </button>
                  <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)} type="button" title="Last page">
                    <span className="material-symbols">last_page</span>
                  </button>
                </>
              )}
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

      {/* ── Dashboard Project Config Modal ── */}
      {showDashboardConfig && createPortal(
        <div className="dialog-overlay" onClick={() => { document.body.style.overflow = ""; setShowDashboardConfig(false); }}>
          <div className="dialog" ref={dialogRef} tabIndex={-1} style={{ width: 560, maxWidth: "90vw", outline: "none" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="dialog-header">
              <div className="dialog-header-info">
                <h3 className="dialog-title">Dashboard Project Settings</h3>
                <p className="dialog-subtitle">Configure additional Jira projects to monitor on the dashboard.</p>
              </div>
              <div className="dialog-header-actions">
                <button className="icon-btn" onClick={() => { document.body.style.overflow = ""; setShowDashboardConfig(false); }} type="button">×</button>
              </div>
            </div>
            <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {dashboardProjects.map((proj, index) => (
                <div key={index} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, opacity: proj.enabled ? 1 : 0.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 14 }}>Project {index + 1}</strong>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...dashboardProjects];
                          next[index] = { ...next[index], enabled: !next[index].enabled };
                          setDashboardProjects(next);
                        }}
                        style={{
                          padding: "4px 12px", borderRadius: 999, border: "none", cursor: "pointer",
                          fontSize: 11, fontWeight: 600, transition: "all 0.2s",
                          background: proj.enabled ? "var(--tertiary)" : "var(--surface-container-low)",
                          color: proj.enabled ? "#fff" : "var(--on-surface-variant)",
                        }}
                      >
                        {proj.enabled ? "ON" : "OFF"}
                      </button>
                      <button
                        className="chip"
                        onClick={() => {
                          setDashboardProjects(dashboardProjects.filter((_, i) => i !== index));
                          setLabelExcludeDrafts(labelExcludeDrafts.filter((_, i) => i !== index));
                          setLabelIncludeDrafts(labelIncludeDrafts.filter((_, i) => i !== index));
                          setStatusExcludeDrafts(statusExcludeDrafts.filter((_, i) => i !== index));
                          setStatusIncludeDrafts(statusIncludeDrafts.filter((_, i) => i !== index));
                        }}
                        type="button"
                        style={{ color: "var(--error)", borderColor: "var(--error)" }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="bug-form-row-2col">
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 12 }}>Project Key</span>
                      <input
                        value={proj.projectKey}
                        onChange={(e) => {
                          const next = [...dashboardProjects];
                          next[index] = { ...next[index], projectKey: e.target.value.toUpperCase() };
                          setDashboardProjects(next);
                        }}
                        placeholder="e.g. PROJ"
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 12 }}>Issue Type</span>
                      <input
                        value={proj.issueType}
                        onChange={(e) => {
                          const next = [...dashboardProjects];
                          next[index] = { ...next[index], issueType: e.target.value };
                          setDashboardProjects(next);
                        }}
                        placeholder='e.g. Bug'
                      />
                    </label>
                  </div>
                  <div className="bug-form-row-2col">
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 12 }}>Exclude Labels (comma-separated)</span>
                      <input
                        value={labelExcludeDrafts[index] || ""}
                        onChange={(e) => {
                          const next = [...labelExcludeDrafts];
                          next[index] = e.target.value;
                          setLabelExcludeDrafts(next);
                        }}
                        onBlur={(e) => {
                          const next = [...dashboardProjects];
                          next[index] = { ...next[index], excludeLabels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) };
                          setDashboardProjects(next);
                        }}
                        placeholder="NOT_DEFECT, automation"
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 12 }}>Include Labels (comma-separated)</span>
                      <input
                        value={labelIncludeDrafts[index] || ""}
                        onChange={(e) => {
                          const next = [...labelIncludeDrafts];
                          next[index] = e.target.value;
                          setLabelIncludeDrafts(next);
                        }}
                        onBlur={(e) => {
                          const next = [...dashboardProjects];
                          next[index] = { ...next[index], includeLabels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) };
                          setDashboardProjects(next);
                        }}
                        placeholder="regression, critical"
                      />
                    </label>
                  </div>
                  <div className="bug-form-row-2col">
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 12 }}>Exclude Statuses (comma-separated)</span>
                      <input
                        value={statusExcludeDrafts[index] || ""}
                        onChange={(e) => {
                          const next = [...statusExcludeDrafts];
                          next[index] = e.target.value;
                          setStatusExcludeDrafts(next);
                        }}
                        onBlur={(e) => {
                          const next = [...dashboardProjects];
                          next[index] = { ...next[index], excludeStatuses: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) };
                          setDashboardProjects(next);
                        }}
                        placeholder="Closed, Resolved"
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 12 }}>Include Statuses (comma-separated)</span>
                      <input
                        value={statusIncludeDrafts[index] || ""}
                        onChange={(e) => {
                          const next = [...statusIncludeDrafts];
                          next[index] = e.target.value;
                          setStatusIncludeDrafts(next);
                        }}
                        onBlur={(e) => {
                          const next = [...dashboardProjects];
                          next[index] = { ...next[index], includeStatuses: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) };
                          setDashboardProjects(next);
                        }}
                        placeholder="Open, In Progress, Reopened"
                      />
                    </label>
                  </div>
                </div>
              ))}
              <button
                className="chip"
                onClick={() => {
                  setDashboardProjects([...dashboardProjects, { projectKey: "", issueType: "Bug", excludeLabels: [], includeLabels: [], excludeStatuses: [], includeStatuses: [], enabled: true }]);
                  setLabelExcludeDrafts([...labelExcludeDrafts, ""]);
                  setLabelIncludeDrafts([...labelIncludeDrafts, ""]);
                  setStatusExcludeDrafts([...statusExcludeDrafts, ""]);
                  setStatusIncludeDrafts([...statusIncludeDrafts, ""]);
                }}
                type="button"
                style={{ alignSelf: "flex-start" }}
              >
                + Add Project
              </button>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button className="secondary-button" onClick={() => { document.body.style.overflow = ""; setShowDashboardConfig(false); }} type="button">Cancel</button>
                <button className="primary-button" onClick={() => {
                  const finalProjects = dashboardProjects.map((p, i) => ({
                    ...p,
                    excludeLabels: (labelExcludeDrafts[i] || "").split(",").map((s) => s.trim()).filter(Boolean),
                    includeLabels: (labelIncludeDrafts[i] || "").split(",").map((s) => s.trim()).filter(Boolean),
                    excludeStatuses: (statusExcludeDrafts[i] || "").split(",").map((s) => s.trim()).filter(Boolean),
                    includeStatuses: (statusIncludeDrafts[i] || "").split(",").map((s) => s.trim()).filter(Boolean),
                  }));
                  void saveDashboardConfig(finalProjects);
                }} type="button">Save</button>
              </div>
            </div>
          </div>
        </div>, document.body)}
    </section>
  );
}
