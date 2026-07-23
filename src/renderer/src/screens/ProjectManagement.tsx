import React, { useState, useCallback, useEffect } from "react";
import { useApp } from "../context/AppContext";
import SearchableSelect from "../components/SearchableSelect";
import type { JiraIssueSummary, DbTestPlan, SaveTestPlanInput, SaveTestExecutionInput, DbTestRepository, SaveTestRepositoryInput, UqaWithDates, SaveUqaProjectInput } from "@shared/types";

// ── Types ──────────────────────────────────────────────────────────────────

interface UqaTicket {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  productTester: string;
  projectKey: string; // extracted from summary
  startSit?: string | null;
  finishSit?: string | null;
  startUat?: string | null;
  inDb?: boolean;
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

type SubView = "repository" | "uqa" | "plans" | "executions";
type PlanSyncMode = "manual" | "auto";

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
  const { config, jiraProjects } = useApp();

  const [subView, setSubView] = useState<SubView>("repository");
  const [breadcrumb, setBreadcrumb] = useState<{ projectKey?: string; planKey?: string; planSummary?: string }>({});

  // Test Repository
  const [repoProjects, setRepoProjects] = useState<{ key: string; name: string }[]>([]);
  const [repoProjectsInDb, setRepoProjectsInDb] = useState<Set<string>>(new Set());
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoSyncing, setRepoSyncing] = useState(false);
  const [repoSyncResult, setRepoSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [repoDropdownValue, setRepoDropdownValue] = useState("");

  // UQA
  const [uqaItems, setUqaItems] = useState<UqaTicket[]>([]);
  const [uqaLoading, setUqaLoading] = useState(false);
  const [uqaError, setUqaError] = useState<string | null>(null);
  const uqaCacheRef = React.useRef<UqaTicket[] | null>(null);

  // UQA DB sync
  const [uqaSyncing, setUqaSyncing] = useState(false);
  const [uqaSyncResult, setUqaSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [uqaInDb, setUqaInDb] = useState<Set<string>>(new Set());

  // Test Plans
  const [plans, setPlans] = useState<TestPlanItem[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planSearch, setPlanSearch] = useState("");
  const [planSyncMode, setPlanSyncMode] = useState<PlanSyncMode>("auto");

  // Sync Manually modal
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualUqaKey, setManualUqaKey] = useState("");
  const [manualTpKey, setManualTpKey] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualSaveResult, setManualSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Sync Automatically — DB status per Test Plan key
  const [plansInDb, setPlansInDb] = useState<Set<string>>(new Set());
  const [selectedForSync, setSelectedForSync] = useState<Set<string>>(new Set());
  const [syncingToDb, setSyncingToDb] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // UQA key to associate when syncing — pre-filled from breadcrumb if navigated from UQA tab
  const [syncUqaKey, setSyncUqaKey] = useState("");

  // Test Executions
  const [executions, setExecutions] = useState<TestExecutionItem[]>([]);
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);

  // Test Execution DB sync state
  const [execsInDb, setExecsInDb] = useState<Set<string>>(new Set());
  const [selectedExecsForSync, setSelectedExecsForSync] = useState<Set<string>>(new Set());
  const [syncingExecs, setSyncingExecs] = useState(false);
  const [execSyncResult, setExecSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);

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
      // Check which ones are already in DB
      window.qaBuddy.checkUqaProjectsInDb(merged.map((m) => m.key))
        .then((inDb) => setUqaInDb(new Set(inDb)))
        .catch(() => {});
    } catch (e: any) {
      setUqaError(e?.message ?? String(e));
    } finally {
      setUqaLoading(false);
    }
  }, [config.jira.username]);

  // ── Load Test Repository ──
  const loadRepository = useCallback(async () => {
    setRepoLoading(true);
    try {
      const inDb = await window.qaBuddy.getTestRepositoriesInDb();
      setRepoProjectsInDb(new Set(inDb.map((r) => r.project_key)));
    } catch {
      // non-fatal
    } finally {
      setRepoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subView === "uqa") loadUqa();
    if (subView === "repository") loadRepository();
  }, [subView, loadUqa, loadRepository]);

  // ── Fetch Test Plans ──
  const loadPlans = useCallback(async (input: string) => {
    if (!input) return;
    setPlansLoading(true);
    setPlansError(null);
    setSelectedForSync(new Set());
    setSyncResult(null);
    try {
      const trimmed = input.trim();
      const isIssueKey = /^[A-Z][A-Z0-9]+-\d+$/i.test(trimmed);
      const jql = isIssueKey
        ? `key = "${trimmed.toUpperCase()}" AND issueType = "Test Plan"`
        : `project = "${trimmed.toUpperCase()}" AND issueType = "Test Plan" ORDER BY created DESC`;
      const raw: JiraIssueSummary[] = await window.qaBuddy.findIssuesByJql(jql, 50);
      const fetched = raw.map((r) => ({
        key: r.key,
        summary: r.summary,
        status: r.status,
        projectKey: r.key.split("-")[0],
      }));
      setPlans(fetched);
      // In "auto" mode, check which plans already exist in DB
      if (fetched.length > 0) {
        try {
          const inDb = await window.qaBuddy.checkTestPlansInDb(fetched.map((p) => p.key));
          setPlansInDb(new Set(inDb));
        } catch {
          setPlansInDb(new Set());
        }
      }
    } catch (e: any) {
      setPlansError(e?.message ?? String(e));
    } finally {
      setPlansLoading(false);
    }
  }, []);

  // ── Save manual relation to DB ──
  const handleManualSave = useCallback(async () => {
    const uqaKey = manualUqaKey.trim().toUpperCase();
    const tpKey = manualTpKey.trim().toUpperCase();
    if (!uqaKey || !tpKey) return;
    setManualSaving(true);
    setManualSaveResult(null);
    try {
      const input: SaveTestPlanInput = { uqa_key: uqaKey, tp_jira_key: tpKey };
      await window.qaBuddy.saveUqaTestPlan(input);
      setManualSaveResult({ ok: true, msg: `Relasi ${uqaKey} ↔ ${tpKey} berhasil disimpan ke database.` });
      setManualUqaKey("");
      setManualTpKey("");
    } catch (e: any) {
      setManualSaveResult({ ok: false, msg: e?.message ?? String(e) });
    } finally {
      setManualSaving(false);
    }
  }, [manualUqaKey, manualTpKey]);

  // ── Sync selected plans (auto mode) to DB ──
  const handleSyncSelected = useCallback(async () => {
    if (selectedForSync.size === 0) return;
    setSyncingToDb(true);
    setSyncResult(null);
    let failed = 0;
    // Resolve UQA key: from state (pre-filled when navigating from UQA tab),
    // or fallback search uqaItems by projectKey
    const resolvedUqaKey = syncUqaKey ||
      (breadcrumb.projectKey
        ? uqaItems.find((u) => u.projectKey === breadcrumb.projectKey)?.key ?? ""
        : "");
    for (const key of Array.from(selectedForSync)) {
      const plan = plans.find((p) => p.key === key);
      if (!plan) continue;
      try {
        const input: SaveTestPlanInput = {
          uqa_key: resolvedUqaKey,
          tp_jira_key: plan.key,
          title: plan.summary,
        };
        await window.qaBuddy.saveUqaTestPlan(input);
      } catch {
        failed++;
      }
    }
    // Refresh DB status
    try {
      const inDb = await window.qaBuddy.checkTestPlansInDb(plans.map((p) => p.key));
      setPlansInDb(new Set(inDb));
    } catch {}
    const synced = selectedForSync.size - failed;
    setSyncResult({
      ok: failed === 0,
      msg: failed === 0
        ? `${synced} Test Plan berhasil disimpan ke database.`
        : `${synced} berhasil, ${failed} gagal.`,
    });
    setSelectedForSync(new Set());
    setSyncingToDb(false);
  }, [selectedForSync, plans, breadcrumb.projectKey, uqaItems]);

  // ── Sync selected Test Executions to DB ──
  const handleSyncExecs = useCallback(async () => {
    if (selectedExecsForSync.size === 0 || !breadcrumb.planKey) return;
    setSyncingExecs(true);
    setExecSyncResult(null);
    let failed = 0;
    const toSync: SaveTestExecutionInput[] = Array.from(selectedExecsForSync)
      .flatMap((key) => {
        const exec = executions.find((e) => e.key === key);
        if (!exec) return [];
        const item: SaveTestExecutionInput = {
          te_jira_key: exec.key,
          title: exec.summary,
          tp_jira_key: breadcrumb.planKey!,
          assignee: exec.assignee || undefined,
          execution_status: exec.status || undefined,
        };
        return [item];
      });

    try {
      await window.qaBuddy.saveTestExecutions(toSync);
    } catch {
      failed = toSync.length;
    }

    // Refresh DB status
    try {
      const inDb = await window.qaBuddy.checkTestExecutionsInDb(executions.map((e) => e.key));
      setExecsInDb(new Set(inDb));
    } catch {}

    const synced = toSync.length - failed;
    setExecSyncResult({
      ok: failed === 0,
      msg: failed === 0
        ? `${synced} Test Execution berhasil disimpan ke database.`
        : `${synced} berhasil, ${failed} gagal.`,
    });
    setSelectedExecsForSync(new Set());
    setSyncingExecs(false);
  }, [selectedExecsForSync, executions, breadcrumb.planKey]);

  // ── Sync UQA to DB ──
  const handleSyncUqaToDb = useCallback(async () => {
    setUqaSyncing(true);
    setUqaSyncResult(null);
    try {
      // Fetch with date fields from Jira
      const withDates: UqaWithDates[] = await window.qaBuddy.fetchUqaWithDates();
      const toSave: SaveUqaProjectInput[] = withDates.map((u) => ({
        uqa_key: u.uqaKey,
        project_name: u.summary,
        assignee: u.assignee || undefined,
        product_tester: u.productTester || undefined,
        status: u.status || undefined,
        start_sit: u.startSit ?? undefined,
        finish_sit: u.finishSit ?? undefined,
        start_uat: u.startUat ?? undefined,
      }));
      await window.qaBuddy.saveUqaProjects(toSave);
      const inDb = await window.qaBuddy.checkUqaProjectsInDb(toSave.map((p) => p.uqa_key));
      setUqaInDb(new Set(inDb));
      setUqaSyncResult({ ok: true, msg: `${toSave.length} UQA berhasil disimpan ke database.` });
    } catch (e: unknown) {
      setUqaSyncResult({ ok: false, msg: `Gagal: ${e instanceof Error ? e.message : String(e)}` });
    }
    setUqaSyncing(false);
  }, []);

  // ── Sync Test Repository to DB ──
  const handleSyncRepository = useCallback(async () => {
    const toSync: SaveTestRepositoryInput[] = repoProjects
      .filter((p) => !repoProjectsInDb.has(p.key))
      .map((p) => ({ project_key: p.key, project_name: p.name }));
    if (toSync.length === 0) return;
    setRepoSyncing(true);
    setRepoSyncResult(null);
    let errorMsg = "";
    try {
      await window.qaBuddy.saveTestRepositories(toSync);
      try {
        const inDb = await window.qaBuddy.getTestRepositoriesInDb();
        setRepoProjectsInDb(new Set(inDb.map((r) => r.project_key)));
      } catch {}
      setRepoSyncResult({ ok: true, msg: `${toSync.length} project berhasil disimpan ke database.` });
    } catch (e: unknown) {
      errorMsg = e instanceof Error ? e.message : String(e);
      setRepoSyncResult({ ok: false, msg: `Gagal: ${errorMsg}` });
    }
    setRepoSyncing(false);
  }, [repoProjects, repoProjectsInDb]);

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
      setSelectedExecsForSync(new Set());
      setExecSyncResult(null);

      // Check which executions already exist in DB
      if (base.length > 0) {
        window.qaBuddy.checkTestExecutionsInDb(base.map((e) => e.key))
          .then((inDb) => setExecsInDb(new Set(inDb)))
          .catch(() => setExecsInDb(new Set()));
      }

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
    (projectKey: string, fromUqaKey?: string) => {
      setBreadcrumb((b) => ({ ...b, projectKey }));
      setPlanSearch("");
      setPlans([]);
      setSubView("plans");
      // Pre-fill the UQA key so sync auto knows which UQA to associate
      if (fromUqaKey) setSyncUqaKey(fromUqaKey);
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
    { key: "repository", label: "Test Repository", icon: "storage" },
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
        {/* ── Test Repository ── */}
        {subView === "repository" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>Test Repository</div>
                <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 2 }}>
                  Tambahkan Jira project ke list, lalu sync ke database sebagai Test Repository.
                </div>
              </div>
              <button
                type="button"
                onClick={loadRepository}
                disabled={repoLoading}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "1px solid var(--outline-variant)", background: "var(--surface-container)", cursor: "pointer", fontSize: 13 }}
              >
                <span className={`material-symbols${repoLoading ? " rotating" : ""}`} style={{ fontSize: 15 }}>
                  {repoLoading ? "sync" : "refresh"}
                </span>
                Refresh
              </button>
            </div>

            {/* Dropdown to add project */}
            <div className="card" style={{ padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Tambah Jira Project</div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <SearchableSelect
                    value={repoDropdownValue}
                    onChange={setRepoDropdownValue}
                    options={jiraProjects
                      .filter((p) => !repoProjects.some((r) => r.key === p.key))
                      .map((p) => ({ value: p.key, label: `${p.key} - ${p.name}` }))}
                    placeholder="-- Pilih Jira Project --"
                  />
                </div>
                <button
                  type="button"
                  className="button-primary"
                  disabled={!repoDropdownValue}
                  onClick={() => {
                    const proj = jiraProjects.find((p) => p.key === repoDropdownValue);
                    if (proj && !repoProjects.some((r) => r.key === proj.key)) {
                      setRepoProjects((prev) => [...prev, { key: proj.key, name: proj.name }]);
                    }
                    setRepoDropdownValue("");
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 16px" }}
                >
                  <span className="material-symbols" style={{ fontSize: 15 }}>add</span>
                  Tambah
                </button>
              </div>
            </div>

            {/* List */}
            {repoProjects.length > 0 && (
              <>
                {/* Sync toolbar */}
                {repoProjects.some((p) => !repoProjectsInDb.has(p.key)) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: "10px 14px", background: "var(--surface-container)", borderRadius: 8, border: "1px solid var(--outline-variant)" }}>
                    <span style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>
                      {repoProjects.filter((p) => !repoProjectsInDb.has(p.key)).length} project belum ada di database
                    </span>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                      {repoSyncResult && (
                        <span style={{ fontSize: 12, color: repoSyncResult.ok ? "#16a34a" : "var(--error)", display: "flex", alignItems: "center", gap: 5 }}>
                          <span className="material-symbols" style={{ fontSize: 15 }}>{repoSyncResult.ok ? "check_circle" : "error"}</span>
                          {repoSyncResult.msg}
                        </span>
                      )}
                      <button
                        type="button"
                        className="button-primary"
                        onClick={handleSyncRepository}
                        disabled={repoSyncing}
                        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
                      >
                        <span className={`material-symbols${repoSyncing ? " rotating" : ""}`} style={{ fontSize: 15 }}>
                          {repoSyncing ? "sync" : "cloud_upload"}
                        </span>
                        {repoSyncing ? "Menyimpan..." : "Sync ke DB"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)" }}>
                        {["Project Key", "Nama Project", "Status DB", "Aksi"].map((h) => (
                          <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {repoProjects.map((proj, idx) => {
                        const inDb = repoProjectsInDb.has(proj.key);
                        return (
                          <tr
                            key={proj.key}
                            style={{ borderBottom: idx < repoProjects.length - 1 ? "1px solid var(--outline-variant)" : "none" }}
                          >
                            <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--primary)", fontSize: 12 }}>{proj.key}</td>
                            <td style={{ padding: "10px 14px" }}>{proj.name}</td>
                            <td style={{ padding: "10px 14px" }}>
                              {inDb ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#16a34a", background: "#16a34a18", border: "1px solid #16a34a40", borderRadius: 4, padding: "2px 8px" }}>
                                  <span className="material-symbols" style={{ fontSize: 13 }}>check_circle</span>
                                  Sudah di DB
                                </span>
                              ) : (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--on-surface-variant)", background: "var(--surface-container-high)", border: "1px solid var(--outline-variant)", borderRadius: 4, padding: "2px 8px" }}>
                                  <span className="material-symbols" style={{ fontSize: 13 }}>radio_button_unchecked</span>
                                  Belum di DB
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              <button
                                type="button"
                                onClick={() => setRepoProjects((prev) => prev.filter((p) => p.key !== proj.key))}
                                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--outline-variant)", background: "transparent", cursor: "pointer", fontSize: 12, color: "var(--on-surface-variant)" }}
                              >
                                <span className="material-symbols" style={{ fontSize: 14 }}>delete</span>
                                Hapus
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {repoProjects.length === 0 && !repoLoading && (
              <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>
                Belum ada project yang ditambahkan. Gunakan dropdown di atas untuk menambah Jira project.
              </div>
            )}
          </div>
        )}

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

            {!uqaLoading && uqaItems.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: "10px 14px", background: "var(--surface-container)", borderRadius: 8, border: "1px solid var(--outline-variant)" }}>
                <div style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>
                  {uqaItems.length} UQA ditemukan
                  {uqaInDb.size > 0 && ` · ${uqaInDb.size} sudah di DB`}
                </div>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                  {uqaSyncResult && (
                    <span style={{ fontSize: 12, color: uqaSyncResult.ok ? "#16a34a" : "var(--error)", display: "flex", alignItems: "center", gap: 5 }}>
                      <span className="material-symbols" style={{ fontSize: 15 }}>{uqaSyncResult.ok ? "check_circle" : "error"}</span>
                      {uqaSyncResult.msg}
                    </span>
                  )}
                  <button
                    type="button"
                    className="button-primary"
                    onClick={handleSyncUqaToDb}
                    disabled={uqaSyncing}
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
                  >
                    <span className={`material-symbols${uqaSyncing ? " rotating" : ""}`} style={{ fontSize: 15 }}>
                      {uqaSyncing ? "sync" : "cloud_upload"}
                    </span>
                    {uqaSyncing ? "Menyinkronkan..." : "Sync Semua ke DB"}
                  </button>
                </div>
              </div>
            )}

            {!uqaLoading && uqaItems.length > 0 && (() => {
              const jiraItems = uqaItems.filter((i) => !isNonJiraProject(i.projectKey));
              const nonJiraItems = uqaItems.filter((i) => isNonJiraProject(i.projectKey));

              const headers = ["UQA Key", "Judul UQA", "Jira Project", "Status", "Assignee", "Status DB"];

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
                            onClick={() => goToPlans(item.projectKey, item.key)}
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
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      {uqaInDb.has(item.key) ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#16a34a", background: "#16a34a18", border: "1px solid #16a34a40", borderRadius: 4, padding: "2px 8px" }}>
                          <span className="material-symbols" style={{ fontSize: 13 }}>check_circle</span>
                          Sudah di DB
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--on-surface-variant)", background: "var(--surface-container-high)", border: "1px solid var(--outline-variant)", borderRadius: 4, padding: "2px 8px" }}>
                          <span className="material-symbols" style={{ fontSize: 13 }}>radio_button_unchecked</span>
                          Belum di DB
                        </span>
                      )}
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
            {/* Back button */}
            {breadcrumb.projectKey && (
              <button
                type="button"
                onClick={goBack}
                style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "var(--on-surface-variant)", fontSize: 12, cursor: "pointer", marginBottom: 14, padding: 0 }}
              >
                <span className="material-symbols" style={{ fontSize: 16 }}>arrow_back</span>
                Kembali ke UQA Project
              </button>
            )}

            {/* Sync mode toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 20, background: "var(--surface-container-high)", borderRadius: 8, padding: 4, width: "fit-content" }}>
              {(["auto", "manual"] as PlanSyncMode[]).map((mode) => {
                const label = mode === "auto" ? "Sync Automatically" : "Sync Manually";
                const icon = mode === "auto" ? "cloud_sync" : "edit_note";
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => { setPlanSyncMode(mode); setSyncResult(null); setManualSaveResult(null); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "8px 16px", borderRadius: 6, border: "none",
                      background: planSyncMode === mode ? "var(--surface)" : "transparent",
                      color: planSyncMode === mode ? "var(--primary)" : "var(--on-surface-variant)",
                      fontWeight: planSyncMode === mode ? 600 : 400,
                      fontSize: 13, cursor: "pointer",
                      boxShadow: planSyncMode === mode ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                      transition: "all 0.15s",
                    }}
                  >
                    <span className="material-symbols" style={{ fontSize: 16 }}>{icon}</span>
                    {label}
                  </button>
                );
              })}
            </div>

            {/* ── Sync Manually ── */}
            {planSyncMode === "manual" && (
              <div style={{ maxWidth: 520 }}>
                <div className="card" style={{ padding: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Input Relasi Manual</div>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginBottom: 20 }}>
                    Masukkan Jira UQA Key dan Test Plan Key secara manual untuk disimpan ke database.
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--on-surface-variant)", display: "block", marginBottom: 6 }}>
                        Jira UQA Key <span style={{ color: "var(--error)" }}>*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Contoh: UQAQA2026-42"
                        value={manualUqaKey}
                        onChange={(e) => setManualUqaKey(e.target.value)}
                        style={{ width: "100%", fontSize: 13, padding: "9px 12px", borderRadius: 6, border: "1px solid var(--outline-variant)", background: "var(--surface-container)", color: "var(--on-surface)", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--on-surface-variant)", display: "block", marginBottom: 6 }}>
                        Jira Test Plan Key <span style={{ color: "var(--error)" }}>*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Contoh: ENGBRICC-41"
                        value={manualTpKey}
                        onChange={(e) => setManualTpKey(e.target.value)}
                        style={{ width: "100%", fontSize: 13, padding: "9px 12px", borderRadius: 6, border: "1px solid var(--outline-variant)", background: "var(--surface-container)", color: "var(--on-surface)", boxSizing: "border-box" }}
                      />
                    </div>
                  </div>

                  {manualSaveResult && (
                    <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 6, background: manualSaveResult.ok ? "#16a34a18" : "var(--error-container)", color: manualSaveResult.ok ? "#16a34a" : "var(--on-error-container)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols" style={{ fontSize: 16 }}>{manualSaveResult.ok ? "check_circle" : "error"}</span>
                      {manualSaveResult.msg}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => { setManualUqaKey(""); setManualTpKey(""); setManualSaveResult(null); }}
                      disabled={manualSaving}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="button-primary"
                      onClick={handleManualSave}
                      disabled={manualSaving || !manualUqaKey.trim() || !manualTpKey.trim()}
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span className={`material-symbols${manualSaving ? " rotating" : ""}`} style={{ fontSize: 15 }}>
                        {manualSaving ? "sync" : "save"}
                      </span>
                      {manualSaving ? "Menyimpan..." : "Simpan ke Database"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Sync Automatically ── */}
            {planSyncMode === "auto" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>
                      Test Plans{breadcrumb.projectKey ? ` — ${breadcrumb.projectKey}` : ""}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 2 }}>
                      Cari Test Plan dari Jira, lalu pilih yang belum ada di database untuk disync.
                    </div>
                  </div>
                  <form onSubmit={handleManualPlanSearch} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="text"
                      placeholder="Project Key atau Test Plan Key"
                      value={planSearch}
                      onChange={(e) => setPlanSearch(e.target.value)}
                      style={{ fontSize: 13, padding: "7px 12px", borderRadius: 6, border: "1px solid var(--outline-variant)", background: "var(--surface-container)", color: "var(--on-surface)", width: 200 }}
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

                {plansError && (
                  <div className="card" style={{ color: "var(--error)", marginBottom: 12, fontSize: 13 }}>
                    <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>error</span>
                    {plansError}
                  </div>
                )}

                {plansLoading && (
                  <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>
                    <span className="material-symbols rotating" style={{ fontSize: 24, display: "block", marginBottom: 8 }}>sync</span>
                    Memuat Test Plans dari Jira...
                  </div>
                )}

                {!plansLoading && !plansError && plans.length === 0 && (
                  <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>
                    {breadcrumb.projectKey
                      ? `Tidak ada Test Plan ditemukan di project ${breadcrumb.projectKey}.`
                      : "Masukkan Project Key lalu klik Cari, atau klik Jira Project Key dari tab UQA Project."}
                  </div>
                )}

                {!plansLoading && plans.length > 0 && (() => {
                  const notInDb = plans.filter((p) => !plansInDb.has(p.key));
                  const allNotInDbSelected = notInDb.length > 0 && notInDb.every((p) => selectedForSync.has(p.key));
                  return (
                    <div>
                      {/* Sync toolbar */}
                      {notInDb.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12, padding: "12px 14px", background: "var(--surface-container)", borderRadius: 8, border: "1px solid var(--outline-variant)" }}>
                          {/* UQA Key input */}
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>
                              UQA Key:
                            </span>
                            <input
                              type="text"
                              placeholder="Isi UQA Key terkait (misal: UQAQA2026-42)"
                              value={syncUqaKey}
                              onChange={(e) => setSyncUqaKey(e.target.value.toUpperCase())}
                              style={{ fontSize: 12, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--outline-variant)", background: "var(--surface)", color: "var(--on-surface)", width: 260 }}
                            />
                            {!syncUqaKey && (
                              <span style={{ fontSize: 11, color: "var(--on-surface-variant)" }}>
                                (opsional — isi jika ingin menghubungkan ke UQA)
                              </span>
                            )}
                          </div>
                          {/* Select all + sync button row */}
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={allNotInDbSelected}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedForSync(new Set(notInDb.map((p) => p.key)));
                                  else setSelectedForSync(new Set());
                                }}
                                style={{ cursor: "pointer" }}
                              />
                              Pilih semua yang belum ada di DB ({notInDb.length})
                            </label>
                            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                              {syncResult && (
                                <span style={{ fontSize: 12, color: syncResult.ok ? "#16a34a" : "var(--error)", display: "flex", alignItems: "center", gap: 5 }}>
                                  <span className="material-symbols" style={{ fontSize: 15 }}>{syncResult.ok ? "check_circle" : "error"}</span>
                                  {syncResult.msg}
                                </span>
                              )}
                              <button
                                type="button"
                                className="button-primary"
                                onClick={handleSyncSelected}
                                disabled={syncingToDb || selectedForSync.size === 0}
                                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
                              >
                                <span className={`material-symbols${syncingToDb ? " rotating" : ""}`} style={{ fontSize: 15 }}>
                                  {syncingToDb ? "sync" : "cloud_upload"}
                                </span>
                                {syncingToDb ? "Menyimpan..." : `Sync ke DB (${selectedForSync.size})`}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)" }}>
                              <th style={{ padding: "10px 14px", width: 40 }} />
                              {["Test Plan Key", "Judul Test Plan", "Status", "Project", "Status DB"].map((h) => (
                                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {plans.map((plan, idx) => {
                              const inDb = plansInDb.has(plan.key);
                              const checked = selectedForSync.has(plan.key);
                              return (
                                <tr
                                  key={plan.key}
                                  style={{ borderBottom: idx < plans.length - 1 ? "1px solid var(--outline-variant)" : "none", cursor: inDb ? "default" : "pointer", transition: "background 0.1s" }}
                                  onClick={() => {
                                    if (inDb) return;
                                    setSelectedForSync((prev) => {
                                      const next = new Set(prev);
                                      checked ? next.delete(plan.key) : next.add(plan.key);
                                      return next;
                                    });
                                  }}
                                  onMouseEnter={(e) => { if (!inDb) e.currentTarget.style.background = "var(--surface-container)"; }}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                                >
                                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                                    {!inDb && (
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        readOnly
                                        style={{ cursor: "pointer" }}
                                      />
                                    )}
                                  </td>
                                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); goToExecutions(plan); }}
                                      style={{ fontWeight: 600, color: "var(--primary)", fontSize: 12, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 2 }}
                                    >
                                      {plan.key}
                                    </button>
                                  </td>
                                  <td style={{ padding: "10px 14px" }}>{plan.summary}</td>
                                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                                    <StatusBadge status={plan.status} />
                                  </td>
                                  <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>
                                    {plan.projectKey}
                                  </td>
                                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                                    {inDb ? (
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#16a34a", background: "#16a34a18", border: "1px solid #16a34a40", borderRadius: 4, padding: "2px 8px" }}>
                                        <span className="material-symbols" style={{ fontSize: 13 }}>check_circle</span>
                                        Sudah di DB
                                      </span>
                                    ) : (
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--on-surface-variant)", background: "var(--surface-container-high)", border: "1px solid var(--outline-variant)", borderRadius: 4, padding: "2px 8px" }}>
                                        <span className="material-symbols" style={{ fontSize: 13 }}>radio_button_unchecked</span>
                                        Belum di DB
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
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
                ) : (() => {
                  const notInDb = executions.filter((e) => !execsInDb.has(e.key));
                  const allNotInDbSelected = notInDb.length > 0 && notInDb.every((e) => selectedExecsForSync.has(e.key));
                  return (
                    <div>
                      {/* Sync toolbar */}
                      {notInDb.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: "10px 14px", background: "var(--surface-container)", borderRadius: 8, border: "1px solid var(--outline-variant)" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={allNotInDbSelected}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedExecsForSync(new Set(notInDb.map((ex) => ex.key)));
                                else setSelectedExecsForSync(new Set());
                              }}
                              style={{ cursor: "pointer" }}
                            />
                            Pilih semua yang belum ada di DB ({notInDb.length})
                          </label>
                          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                            {execSyncResult && (
                              <span style={{ fontSize: 12, color: execSyncResult.ok ? "#16a34a" : "var(--error)", display: "flex", alignItems: "center", gap: 5 }}>
                                <span className="material-symbols" style={{ fontSize: 15 }}>{execSyncResult.ok ? "check_circle" : "error"}</span>
                                {execSyncResult.msg}
                              </span>
                            )}
                            <button
                              type="button"
                              className="button-primary"
                              onClick={handleSyncExecs}
                              disabled={syncingExecs || selectedExecsForSync.size === 0}
                              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
                            >
                              <span className={`material-symbols${syncingExecs ? " rotating" : ""}`} style={{ fontSize: 15 }}>
                                {syncingExecs ? "sync" : "cloud_upload"}
                              </span>
                              {syncingExecs ? "Menyimpan..." : `Sync ke DB (${selectedExecsForSync.size})`}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)" }}>
                              <th style={{ padding: "10px 14px", width: 40 }} />
                              {["Test Execution Key", "Judul Test Execution", "Status", "Assignee", "Progress Eksekusi", "Status DB"].map((h) => (
                                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {executions.map((exec, idx) => {
                              const inDb = execsInDb.has(exec.key);
                              const checked = selectedExecsForSync.has(exec.key);
                              return (
                                <tr
                                  key={exec.key}
                                  style={{ borderBottom: idx < executions.length - 1 ? "1px solid var(--outline-variant)" : "none", cursor: inDb ? "default" : "pointer", transition: "background 0.1s" }}
                                  onClick={() => {
                                    if (inDb) return;
                                    setSelectedExecsForSync((prev) => {
                                      const next = new Set(prev);
                                      checked ? next.delete(exec.key) : next.add(exec.key);
                                      return next;
                                    });
                                  }}
                                  onMouseEnter={(e) => { if (!inDb) e.currentTarget.style.background = "var(--surface-container)"; }}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                                >
                                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                                    {!inDb && (
                                      <input type="checkbox" checked={checked} readOnly style={{ cursor: "pointer" }} />
                                    )}
                                  </td>
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
                                  <td style={{ padding: "10px 14px", minWidth: 220 }} onClick={(e) => e.stopPropagation()}>
                                    <ExecProgressBar exec={exec} />
                                  </td>
                                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                                    {inDb ? (
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#16a34a", background: "#16a34a18", border: "1px solid #16a34a40", borderRadius: 4, padding: "2px 8px" }}>
                                        <span className="material-symbols" style={{ fontSize: 13 }}>check_circle</span>
                                        Sudah di DB
                                      </span>
                                    ) : (
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--on-surface-variant)", background: "var(--surface-container-high)", border: "1px solid var(--outline-variant)", borderRadius: 4, padding: "2px 8px" }}>
                                        <span className="material-symbols" style={{ fontSize: 13 }}>radio_button_unchecked</span>
                                        Belum di DB
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
