import React, { useState, useCallback, useEffect } from "react";
import { useApp } from "../context/AppContext";
import type { JiraIssueSummary } from "@shared/types";

// ── Types ──────────────────────────────────────────────────────────────────

interface UqaTicket {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  productTester: string;
  projectKey: string; // extracted from summary
}

interface TestPlanItem {
  key: string;
  summary: string;
  status: string;
  projectKey: string;
}

interface TestExecutionItem {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  // populated after detail fetch
  total?: number;
  passed?: number;
  failed?: number;
  blocked?: number;
  unexecuted?: number;
  inProgress?: number;
  passRate?: number;
  detailLoaded?: boolean;
}

type SubView = "uqa" | "plans" | "executions";

// ── Helpers ────────────────────────────────────────────────────────────────

// Project keys that don't have a Jira project / test plans
const NON_JIRA_PROJECT_KEYS = new Set(["NCM OPS", "SUPPORT", "ECM"]);

function isNonJiraProject(projectKey: string): boolean {
  return NON_JIRA_PROJECT_KEYS.has(projectKey.toUpperCase());
}

function extractProjectKey(summary: string): string {
  // Format: "QCM - ENGBRICC - ..."  → second segment after splitting by " - "
  const parts = summary.split(" - ");
  if (parts.length >= 2) return parts[1].trim();
  // Fallback: first word-like token of ALL CAPS
  const m = summary.match(/\b([A-Z][A-Z0-9]{1,15})\b/);
  return m ? m[1] : "-";
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const color =
    s.includes("done") || s.includes("closed") || s.includes("resolved")
      ? "#16a34a"
      : s.includes("progress") || s.includes("testing")
      ? "#d97706"
      : s.includes("abort") || s.includes("bug") || s.includes("fail")
      ? "#dc2626"
      : "var(--on-surface-variant)";
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        background: color + "18",
        border: `1px solid ${color}40`,
        borderRadius: 4,
        padding: "2px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {status || "Unknown"}
    </span>
  );
}

function ExecProgressBar({ exec }: { exec: TestExecutionItem }) {
  if (!exec.detailLoaded || exec.total === undefined || exec.total === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--on-surface-variant)" }}>
        {exec.detailLoaded ? "Tidak ada test case" : "Memuat..."}
      </div>
    );
  }

  const { total, passed = 0, failed = 0, blocked = 0, inProgress = 0, unexecuted = 0 } = exec;
  const segments = [
    { label: "Passed", value: passed, color: "#16a34a" },
    { label: "Failed", value: failed, color: "#dc2626" },
    { label: "Blocked", value: blocked, color: "#9333ea" },
    { label: "In Progress", value: inProgress, color: "#d97706" },
    { label: "Unexecuted", value: unexecuted, color: "#6b7280" },
  ].filter((s) => s.value > 0);

  return (
    <div style={{ minWidth: 200 }}>
      <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", gap: 1, marginBottom: 5 }}>
        {segments.map((seg) => (
          <div
            key={seg.label}
            title={`${seg.label}: ${seg.value}`}
            style={{
              flex: seg.value / total,
              background: seg.color,
              transition: "flex 0.4s ease",
            }}
          />
        ))}
        {segments.length === 0 && (
          <div style={{ flex: 1, background: "var(--surface-container-high)" }} />
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px" }}>
        {segments.map((seg) => (
          <span key={seg.label} style={{ fontSize: 10, color: "var(--on-surface-variant)", display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: seg.color, display: "inline-block" }} />
            {seg.label}: <strong style={{ color: "var(--on-surface)" }}>{seg.value}</strong>
          </span>
        ))}
        <span style={{ fontSize: 10, color: "var(--on-surface-variant)", marginLeft: "auto" }}>
          {exec.passRate !== undefined ? `${Math.round(exec.passRate)}% pass` : ""}
        </span>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function ProjectManagement() {
  const { config } = useApp();

  const [subView, setSubView] = useState<SubView>("uqa");
  const [breadcrumb, setBreadcrumb] = useState<{ projectKey?: string; planKey?: string; planSummary?: string }>({});

  // UQA
  const [uqaItems, setUqaItems] = useState<UqaTicket[]>([]);
  const [uqaLoading, setUqaLoading] = useState(false);
  const [uqaError, setUqaError] = useState<string | null>(null);
  const uqaCacheRef = React.useRef<UqaTicket[] | null>(null);

  // Test Plans
  const [plans, setPlans] = useState<TestPlanItem[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planSearch, setPlanSearch] = useState("");

  // Test Executions
  const [executions, setExecutions] = useState<TestExecutionItem[]>([]);
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);

  // ── Fetch UQA ──
  const loadUqa = useCallback(async (force = false) => {
    // Return cached data immediately if available and not a forced refresh
    if (!force && uqaCacheRef.current !== null) {
      setUqaItems(uqaCacheRef.current);
      return;
    }
    setUqaLoading(true);
    setUqaError(null);
    try {
      const username = config.jira.username;
      // Run two queries in parallel instead of one slow OR query —
      // Jira OR across custom fields is significantly slower than two separate requests
      const jqlAssignee = `project = "UAT QA Activity 2026" AND assignee = "${username}" ORDER BY updated DESC`;
      const jqlTester = `project = "UAT QA Activity 2026" AND "Product Tester" = "${username}" ORDER BY updated DESC`;
      const [assigneeResults, testerResults] = await Promise.all([
        window.qaBuddy.findIssuesByJql(jqlAssignee, 50),
        window.qaBuddy.findIssuesByJql(jqlTester, 50),
      ]);
      // Merge and deduplicate by key
      const seen = new Set<string>();
      const merged: UqaTicket[] = [];
      for (const r of [...assigneeResults, ...testerResults]) {
        if (seen.has(r.key)) continue;
        seen.add(r.key);
        merged.push({
          key: r.key,
          summary: r.summary,
          status: r.status,
          assignee: r.assignee,
          productTester: "",
          projectKey: extractProjectKey(r.summary),
        });
      }
      // Sort by key descending (most recent UQA number first)
      merged.sort((a, b) => b.key.localeCompare(a.key, undefined, { numeric: true }));
      uqaCacheRef.current = merged;
      setUqaItems(merged);
    } catch (e: any) {
      setUqaError(e?.message ?? String(e));
    } finally {
      setUqaLoading(false);
    }
  }, [config.jira.username]);

  useEffect(() => {
    if (subView === "uqa") loadUqa();
  }, [subView, loadUqa]);

  // ── Fetch Test Plans ──
  const loadPlans = useCallback(async (input: string) => {
    if (!input) return;
    setPlansLoading(true);
    setPlansError(null);
    try {
      const trimmed = input.trim();
      // If input looks like an issue key (e.g. "TP-123", "ENGBRICC-41"), search by key directly.
      // Otherwise treat as a project key and filter by project.
      const isIssueKey = /^[A-Z][A-Z0-9]+-\d+$/i.test(trimmed);
      const jql = isIssueKey
        ? `key = "${trimmed.toUpperCase()}" AND issueType = "Test Plan"`
        : `project = "${trimmed.toUpperCase()}" AND issueType = "Test Plan" ORDER BY created DESC`;
      const raw: JiraIssueSummary[] = await window.qaBuddy.findIssuesByJql(jql, 50);
      // Extract project key from result keys (e.g. "ENGBRICC-41" → "ENGBRICC")
      setPlans(
        raw.map((r) => ({
          key: r.key,
          summary: r.summary,
          status: r.status,
          projectKey: r.key.split("-")[0],
        }))
      );
    } catch (e: any) {
      setPlansError(e?.message ?? String(e));
    } finally {
      setPlansLoading(false);
    }
  }, []);

  // ── Fetch Test Executions ──
  const loadExecutions = useCallback(async (planKey: string) => {
    setExecLoading(true);
    setExecError(null);
    try {
      const jql = `issue in linkedIssues("${planKey}") AND issuetype = "Test Execution" ORDER BY created DESC`;
      const raw: JiraIssueSummary[] = await window.qaBuddy.findIssuesByJql(jql, 100);
      const base: TestExecutionItem[] = raw.map((r) => ({
        key: r.key,
        summary: r.summary,
        status: r.status,
        assignee: r.assignee,
        detailLoaded: false,
      }));
      setExecutions(base);
      setExecLoading(false);

      // Fetch Xray details per item in parallel, update each as it resolves
      base.forEach(async (item) => {
        try {
          const detail = await window.qaBuddy.getXrayExecutionDetails(item.key);
          setExecutions((prev) =>
            prev.map((e) =>
              e.key === item.key
                ? {
                    ...e,
                    total: detail.total,
                    passed: detail.passed,
                    failed: detail.failed,
                    blocked: detail.blocked,
                    unexecuted: detail.unexecuted,
                    inProgress: detail.inProgress,
                    passRate: detail.passRate,
                    detailLoaded: true,
                  }
                : e
            )
          );
        } catch {
          setExecutions((prev) =>
            prev.map((e) => (e.key === item.key ? { ...e, detailLoaded: true } : e))
          );
        }
      });
    } catch (e: any) {
      setExecError(e?.message ?? String(e));
      setExecLoading(false);
    }
  }, []);

  // ── Navigation helpers ──
  const goToPlans = useCallback(
    (projectKey: string) => {
      setBreadcrumb((b) => ({ ...b, projectKey }));
      setPlanSearch("");
      setPlans([]);
      setSubView("plans");
      loadPlans(projectKey);
    },
    [loadPlans]
  );

  const goToExecutions = useCallback(
    (plan: TestPlanItem) => {
      setBreadcrumb((b) => ({ ...b, planKey: plan.key, planSummary: plan.summary }));
      setExecutions([]);
      setSubView("executions");
      loadExecutions(plan.key);
    },
    [loadExecutions]
  );

  const goBack = useCallback(() => {
    if (subView === "executions") {
      setSubView("plans");
    } else {
      setSubView("uqa");
      setBreadcrumb({});
    }
  }, [subView]);

  // ── Manual plan search ──
  const handleManualPlanSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (planSearch.trim()) loadPlans(planSearch.trim().toUpperCase());
    },
    [planSearch, loadPlans]
  );

  // ── Tab bar ──
  const tabs: { key: SubView; label: string; icon: string }[] = [
    { key: "uqa", label: "UQA Project", icon: "folder_open" },
    { key: "plans", label: "Test Plans", icon: "fact_check" },
    { key: "executions", label: "Test Executions", icon: "assignment_turned_in" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* ── Tab Bar ── */}
      <div
        style={{
          display: "flex",
          gap: 2,
          borderBottom: "1px solid var(--outline-variant)",
          paddingBottom: 0,
          marginBottom: 20,
          flexShrink: 0,
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              if (t.key === "plans" && subView !== "plans") {
                setPlans([]);
                setPlanSearch("");
                setBreadcrumb((b) => ({ ...b, planKey: undefined, planSummary: undefined }));
              }
              setSubView(t.key);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "10px 18px",
              background: "none",
              border: "none",
              borderBottom: subView === t.key ? "2px solid var(--primary)" : "2px solid transparent",
              color: subView === t.key ? "var(--primary)" : "var(--on-surface-variant)",
              fontWeight: subView === t.key ? 600 : 400,
              fontSize: 13,
              cursor: "pointer",
              borderRadius: 0,
              transition: "color 0.15s",
            }}
          >
            <span className="material-symbols" style={{ fontSize: 17 }}>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}

        {/* Breadcrumb trail */}
        {(breadcrumb.projectKey || breadcrumb.planKey) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--on-surface-variant)",
            }}
          >
            {breadcrumb.projectKey && (
              <>
                <span className="material-symbols" style={{ fontSize: 14 }}>
                  chevron_right
                </span>
                <span
                  style={{
                    background: "var(--primary-container)",
                    color: "var(--on-primary-container)",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontWeight: 600,
                    fontSize: 11,
                  }}
                >
                  {breadcrumb.projectKey}
                </span>
              </>
            )}
            {breadcrumb.planKey && (
              <>
                <span className="material-symbols" style={{ fontSize: 14 }}>
                  chevron_right
                </span>
                <span style={{ fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {breadcrumb.planKey}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* ── UQA Project ── */}
        {subView === "uqa" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>UQA yang Di-assign kepada Anda</div>
                <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 2 }}>
                  Project: UAT QA Activity 2026 · Akun: {config.jira.username}
                </div>
              </div>
              <button
                type="button"
                className="button-secondary"
                onClick={() => loadUqa(true)}
                disabled={uqaLoading}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
              >
                <span className={`material-symbols${uqaLoading ? " rotating" : ""}`} style={{ fontSize: 15 }}>
                  refresh
                </span>
                Refresh
              </button>
            </div>

            {uqaError && (
              <div className="card" style={{ color: "var(--error)", marginBottom: 12, fontSize: 13 }}>
                <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>error</span>
                {uqaError}
              </div>
            )}

            {uqaLoading && (
              <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>
                <span className="material-symbols rotating" style={{ fontSize: 24, display: "block", marginBottom: 8 }}>sync</span>
                Memuat data UQA dari Jira...
              </div>
            )}

            {!uqaLoading && !uqaError && uqaItems.length === 0 && (
              <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>
                Tidak ada tiket UQA yang ditemukan untuk akun ini.
              </div>
            )}

            {!uqaLoading && uqaItems.length > 0 && (() => {
              const jiraItems = uqaItems.filter((i) => !isNonJiraProject(i.projectKey));
              const nonJiraItems = uqaItems.filter((i) => isNonJiraProject(i.projectKey));

              const headers = ["UQA Key", "Judul UQA", "Jira Project", "Status", "Assignee"];

              const renderRow = (item: UqaTicket, idx: number, arr: UqaTicket[]) => {
                const nonJira = isNonJiraProject(item.projectKey);
                return (
                  <tr
                    key={item.key}
                    style={{
                      borderBottom: idx < arr.length - 1 ? "1px solid var(--outline-variant)" : "none",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-container)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={() => {
                          const base = config.jira.baseUrl?.replace(/\/+$/, "");
                          if (base) void window.qaBuddy.openExternal(`${base}/browse/${item.key}`);
                        }}
                        title={`Buka ${item.key} di Jira`}
                        style={{
                          fontWeight: 600,
                          color: "var(--primary)",
                          fontSize: 12,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          textDecoration: "underline",
                          textUnderlineOffset: 2,
                        }}
                      >
                        {item.key}
                      </button>
                    </td>
                    <td style={{ padding: "10px 14px", maxWidth: 320 }}>
                      <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {item.summary}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      {item.projectKey !== "-" ? (
                        nonJira ? (
                          <span
                            title="Project ini tidak memiliki Test Plan / Test Execution di Jira"
                            style={{
                              background: "var(--surface-container-high)",
                              color: "var(--on-surface-variant)",
                              border: "1px solid var(--outline-variant)",
                              borderRadius: 5,
                              padding: "3px 10px",
                              fontWeight: 600,
                              fontSize: 12,
                              fontFamily: "monospace",
                              cursor: "not-allowed",
                              display: "inline-block",
                            }}
                          >
                            {item.projectKey}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => goToPlans(item.projectKey)}
                            style={{
                              background: "var(--primary-container)",
                              color: "var(--on-primary-container)",
                              border: "none",
                              borderRadius: 5,
                              padding: "3px 10px",
                              fontWeight: 700,
                              fontSize: 12,
                              cursor: "pointer",
                              fontFamily: "monospace",
                            }}
                            title="Lihat Test Plans untuk project ini"
                          >
                            {item.projectKey}
                          </button>
                        )
                      ) : (
                        <span style={{ color: "var(--on-surface-variant)" }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      <StatusBadge status={item.status} />
                    </td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "var(--on-surface-variant)" }}>
                      {item.assignee || "-"}
                    </td>
                  </tr>
                );
              };

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {jiraItems.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--on-surface-variant)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="material-symbols" style={{ fontSize: 15, color: "var(--primary)" }}>link</span>
                        Project dengan Test Plan di Jira ({jiraItems.length})
                      </div>
                      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)" }}>
                              {headers.map((h) => (
                                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>{jiraItems.map((item, idx) => renderRow(item, idx, jiraItems))}</tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {nonJiraItems.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--on-surface-variant)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="material-symbols" style={{ fontSize: 15, color: "var(--on-surface-variant)" }}>link_off</span>
                        Project tanpa Test Plan di Jira ({nonJiraItems.length})
                        <span style={{ fontSize: 11, fontWeight: 400, color: "var(--on-surface-variant)", marginLeft: 4 }}>
                          — NCM OPS, Support, ECM, dan sejenisnya tidak memiliki Jira project / Test Execution
                        </span>
                      </div>
                      <div className="card" style={{ padding: 0, overflow: "hidden", opacity: 0.75 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)" }}>
                              {headers.map((h) => (
                                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>{nonJiraItems.map((item, idx) => renderRow(item, idx, nonJiraItems))}</tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Test Plans ── */}
        {subView === "plans" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>
                  Test Plans{breadcrumb.projectKey ? ` — ${breadcrumb.projectKey}` : ""}
                </div>
                <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 2 }}>
                  Cari berdasarkan Jira Project Key untuk melihat Test Plan yang tersedia
                </div>
              </div>
              <form onSubmit={handleManualPlanSearch} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Project Key atau Test Plan Key"
                  value={planSearch}
                  onChange={(e) => setPlanSearch(e.target.value)}
                  style={{
                    fontSize: 13,
                    padding: "7px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--outline-variant)",
                    background: "var(--surface-container)",
                    color: "var(--on-surface)",
                    width: 200,
                  }}
                />
                <button
                  type="submit"
                  className="button-primary"
                  disabled={plansLoading || !planSearch.trim()}
                  style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
                >
                  <span className={`material-symbols${plansLoading ? " rotating" : ""}`} style={{ fontSize: 15 }}>
                    {plansLoading ? "sync" : "search"}
                  </span>
                  Cari
                </button>
              </form>
            </div>

            {subView === "plans" && breadcrumb.projectKey && (
              <button
                type="button"
                onClick={goBack}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: "none",
                  border: "none",
                  color: "var(--on-surface-variant)",
                  fontSize: 12,
                  cursor: "pointer",
                  marginBottom: 12,
                  padding: 0,
                }}
              >
                <span className="material-symbols" style={{ fontSize: 16 }}>arrow_back</span>
                Kembali ke UQA Project
              </button>
            )}

            {plansError && (
              <div className="card" style={{ color: "var(--error)", marginBottom: 12, fontSize: 13 }}>
                <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>error</span>
                {plansError}
              </div>
            )}

            {plansLoading && (
              <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>
                <span className="material-symbols rotating" style={{ fontSize: 24, display: "block", marginBottom: 8 }}>sync</span>
                Memuat Test Plans...
              </div>
            )}

            {!plansLoading && !plansError && plans.length === 0 && (
              <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>
                {breadcrumb.projectKey
                  ? `Tidak ada Test Plan ditemukan di project ${breadcrumb.projectKey}.`
                  : "Masukkan Project Key lalu klik Cari, atau klik Jira Project Key dari tab UQA Project."}
              </div>
            )}

            {!plansLoading && plans.length > 0 && (
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)" }}>
                      {["Test Plan Key", "Judul Test Plan", "Status", "Jira Project"].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "10px 14px",
                            textAlign: "left",
                            fontWeight: 600,
                            fontSize: 11,
                            color: "var(--on-surface-variant)",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((plan, idx) => (
                      <tr
                        key={plan.key}
                        style={{
                          borderBottom: idx < plans.length - 1 ? "1px solid var(--outline-variant)" : "none",
                          cursor: "pointer",
                          transition: "background 0.1s",
                        }}
                        onClick={() => goToExecutions(plan)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-container)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                      >
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <span style={{ fontWeight: 600, color: "var(--primary)", fontSize: 12 }}>{plan.key}</span>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {plan.summary}
                            <span className="material-symbols" style={{ fontSize: 14, color: "var(--on-surface-variant)", marginLeft: "auto" }}>
                              chevron_right
                            </span>
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <StatusBadge status={plan.status} />
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>
                          {plan.projectKey}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Test Executions ── */}
        {subView === "executions" && (
          <div>
            <button
              type="button"
              onClick={goBack}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "none",
                border: "none",
                color: "var(--on-surface-variant)",
                fontSize: 12,
                cursor: "pointer",
                marginBottom: 12,
                padding: 0,
              }}
            >
              <span className="material-symbols" style={{ fontSize: 16 }}>arrow_back</span>
              Kembali ke Test Plans
            </button>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>
                Test Executions — {breadcrumb.planKey}
              </div>
              {breadcrumb.planSummary && (
                <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 2 }}>{breadcrumb.planSummary}</div>
              )}
            </div>

            {execError && (
              <div className="card" style={{ color: "var(--error)", marginBottom: 12, fontSize: 13 }}>
                <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>error</span>
                {execError}
              </div>
            )}

            {execLoading && (
              <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>
                <span className="material-symbols rotating" style={{ fontSize: 24, display: "block", marginBottom: 8 }}>sync</span>
                Memuat Test Executions...
              </div>
            )}

            {!execLoading && !execError && (
              <>
                {executions.length === 0 ? (
                  <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
                    Tidak ada Test Execution ditemukan dalam Test Plan ini.
                  </div>
                ) : (
                  <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)" }}>
                          {["Test Execution Key", "Judul Test Execution", "Status", "Assignee", "Progress Eksekusi"].map((h) => (
                            <th
                              key={h}
                              style={{
                                padding: "10px 14px",
                                textAlign: "left",
                                fontWeight: 600,
                                fontSize: 11,
                                color: "var(--on-surface-variant)",
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {executions.map((exec, idx) => (
                          <tr
                            key={exec.key}
                            style={{
                              borderBottom: idx < executions.length - 1 ? "1px solid var(--outline-variant)" : "none",
                              transition: "background 0.1s",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-container)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                          >
                            <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                              <span style={{ fontWeight: 600, color: "var(--primary)", fontSize: 12 }}>{exec.key}</span>
                            </td>
                            <td style={{ padding: "10px 14px" }}>{exec.summary}</td>
                            <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                              <StatusBadge status={exec.status} />
                            </td>
                            <td style={{ padding: "10px 14px", color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>
                              {exec.assignee || "-"}
                            </td>
                            <td style={{ padding: "10px 14px", minWidth: 220 }}>
                              <ExecProgressBar exec={exec} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
