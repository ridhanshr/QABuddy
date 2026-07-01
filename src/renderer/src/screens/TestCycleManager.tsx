import React, { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../context/AppContext";
import type { TestPlan, TestExecution, ExecutionMonitoringData, XrayExecutionDetails, XrayExecutionSnapshot } from "@shared/types";

type Tab = "plan" | "monitoring";

const PHASES = ["SIT", "UAT", "DT"] as const;

function formatDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function TestCycleManager() {
  const { jiraProjects } = useApp();

  // ── Tab State ──
  const [activeTab, setActiveTab] = useState<Tab>("plan");

  // ── Plan Tab ──
  const [testPlans, setTestPlans] = useState<TestPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanDesc, setNewPlanDesc] = useState("");
  const [newPlanPhase, setNewPlanPhase] = useState<string>("SIT");
  const [newPlanUqaKey, setNewPlanUqaKey] = useState("");
  const [newPlanProject, setNewPlanProject] = useState("");
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [executions, setExecutions] = useState<TestExecution[]>([]);
  const [execLoading, setExecLoading] = useState(false);
  const [showCreateExec, setShowCreateExec] = useState(false);
  const [newExecName, setNewExecName] = useState("");
  const [newExecAssignee, setNewExecAssignee] = useState("");
  const [newExecFeature, setNewExecFeature] = useState("");

  // ── Monitoring Tab ──
  const [monitoringData, setMonitoringData] = useState<ExecutionMonitoringData[]>([]);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<"daily" | "weekly" | "monthly">("weekly");

  // ── Execution Details (by key) ──
  const [execKeyInput, setExecKeyInput] = useState("");
  const [execDetails, setExecDetails] = useState<XrayExecutionDetails | null>(null);
  const [execDetailsLoading, setExecDetailsLoading] = useState(false);
  const [execDetailsError, setExecDetailsError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Inject to Jira ──
  const [targetIssueKey, setTargetIssueKey] = useState("");
  const [injecting, setInjecting] = useState(false);
  const [injectResult, setInjectResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── Load Plans ──
  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const plans = await window.qaBuddy.getTestPlans();
      setTestPlans(plans || []);
    } catch (e) {
      console.error("Failed to load plans", e);
    } finally {
      setPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  // ── Load Monitoring Data ──
  const loadMonitoring = useCallback(async () => {
    setMonitoringLoading(true);
    try {
      const data = await window.qaBuddy.getExecutionMonitoringData(undefined);
      setMonitoringData(data || []);
    } catch (e) {
      console.error("Failed to load monitoring data", e);
    } finally {
      setMonitoringLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "monitoring") {
      loadMonitoring();
    }
  }, [activeTab, loadMonitoring]);

  // ── Fetch Execution Details ──
  const fetchExecDetails = useCallback(async (key: string) => {
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) {
      setExecDetails(null);
      setExecDetailsError(null);
      return;
    }
    setExecDetailsLoading(true);
    setExecDetailsError(null);
    try {
      const data = await window.qaBuddy.getXrayExecutionDetails(trimmed);
      setExecDetails(data);
    } catch (e: any) {
      setExecDetails(null);
      setExecDetailsError(e?.message || String(e));
    } finally {
      setExecDetailsLoading(false);
    }
  }, []);

  const handleExecKeyChange = useCallback((val: string) => {
    setExecKeyInput(val);
    setInjectResult(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchExecDetails(val), 600);
  }, [fetchExecDetails]);

  const handleInject = useCallback(async () => {
    if (!execDetails || !targetIssueKey.trim()) return;
    setInjecting(true);
    setInjectResult(null);
    try {
      await window.qaBuddy.injectExecutionReport(
        targetIssueKey.trim().toUpperCase(),
        execDetails.key,
        execDetails.summary,
        execDetails.history,
      );
      setInjectResult({ ok: true, msg: `Berhasil diinject ke ${targetIssueKey.trim().toUpperCase()}` });
    } catch (e: any) {
      setInjectResult({ ok: false, msg: e?.message || String(e) });
    } finally {
      setInjecting(false);
    }
  }, [execDetails, targetIssueKey]);

  // ── Create Plan ──
  const handleCreatePlan = useCallback(async () => {
    if (!newPlanName || !newPlanProject) return;
    try {
      await window.qaBuddy.createTestPlan(
        newPlanUqaKey || newPlanProject,
        newPlanPhase,
        newPlanName,
        newPlanDesc,
        newPlanProject,
      );
      setShowCreatePlan(false);
      setNewPlanName("");
      setNewPlanDesc("");
      setNewPlanUqaKey("");
      setNewPlanProject("");
      loadPlans();
    } catch (e: any) {
      console.error("Failed to create plan", e);
    }
  }, [newPlanName, newPlanDesc, newPlanPhase, newPlanUqaKey, newPlanProject, loadPlans]);

  // ── Delete Plan ──
  const handleDeletePlan = useCallback(async (id: string) => {
    if (!confirm("Delete this test plan and all associated executions?")) return;
    try {
      await window.qaBuddy.deleteTestPlan(id);
      loadPlans();
      if (expandedPlanId === id) {
        setExpandedPlanId(null);
        setExecutions([]);
      }
    } catch (e: any) {
      console.error("Failed to delete plan", e);
    }
  }, [expandedPlanId, loadPlans]);

  // ── Sync Plan to Jira ──
  const handleSyncPlan = useCallback(async (id: string) => {
    try {
      const result = await window.qaBuddy.syncTestPlanToJira(id);
      if (result) {
        loadPlans();
      }
    } catch (e: any) {
      console.error("Failed to sync plan", e);
    }
  }, [loadPlans]);

  // ── Toggle Plan Expansion ──
  const togglePlan = useCallback(async (planId: string) => {
    if (expandedPlanId === planId) {
      setExpandedPlanId(null);
      setExecutions([]);
      return;
    }
    setExpandedPlanId(planId);
    setExecLoading(true);
    try {
      const execs = await window.qaBuddy.getTestExecutions(planId);
      setExecutions(execs || []);
    } catch (e) {
      console.error("Failed to load executions", e);
    } finally {
      setExecLoading(false);
    }
  }, [expandedPlanId]);

  // ── Create Execution ──
  const handleCreateExec = useCallback(async () => {
    if (!expandedPlanId || !newExecName) return;
    try {
      const plan = testPlans.find(p => p.id === expandedPlanId);
      await window.qaBuddy.createTestExecution(
        expandedPlanId,
        newExecAssignee || "Unassigned",
        newExecName,
        plan?.projectKey || "",
        newExecFeature || "General",
      );
      setShowCreateExec(false);
      setNewExecName("");
      setNewExecAssignee("");
      setNewExecFeature("");
      const execs = await window.qaBuddy.getTestExecutions(expandedPlanId);
      setExecutions(execs || []);
    } catch (e: any) {
      console.error("Failed to create execution", e);
    }
  }, [expandedPlanId, newExecName, newExecAssignee, newExecFeature, testPlans]);

  // ── Sync Execution to Jira ──
  const handleSyncExec = useCallback(async (execId: string) => {
    try {
      const result = await window.qaBuddy.syncTestExecutionToJira(execId);
      if (result) {
        if (expandedPlanId) {
          const execs = await window.qaBuddy.getTestExecutions(expandedPlanId);
          setExecutions(execs || []);
        }
      }
    } catch (e: any) {
      console.error("Failed to sync execution", e);
    }
  }, [expandedPlanId]);

  // ── Delete Execution ──
  const handleDeleteExec = useCallback(async (execId: string) => {
    if (!confirm("Delete this test execution?")) return;
    try {
      await window.qaBuddy.deleteTestExecution(execId);
      if (expandedPlanId) {
        const execs = await window.qaBuddy.getTestExecutions(expandedPlanId);
        setExecutions(execs || []);
      }
    } catch (e: any) {
      console.error("Failed to delete execution", e);
    }
  }, [expandedPlanId]);

  const projectName = (key: string) => {
    const p = jiraProjects.find((p: any) => p.key === key);
    return p ? `${p.key} - ${p.name}` : key;
  };

  const phaseColor = (phase: string) => {
    switch (phase) {
      case "SIT": return { bg: "var(--tertiary-container)", fg: "var(--on-tertiary-container)" };
      case "UAT": return { bg: "var(--secondary-container)", fg: "var(--on-secondary-container)" };
      case "DT": return { bg: "var(--primary-container)", fg: "var(--on-primary-container)" };
      default: return { bg: "var(--surface-container-high)", fg: "var(--on-surface-variant)" };
    }
  };

  return (
    <div>
      <div className="tab-bar" style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid var(--surface-container-high)" }}>
        <button
          className={`tab-button ${activeTab === "plan" ? "active" : ""}`}
          onClick={() => setActiveTab("plan")}
          type="button"
          style={{
            flex: 1, padding: "10px 16px", border: "none", background: activeTab === "plan" ? "var(--secondary-container)" : "transparent",
            color: activeTab === "plan" ? "var(--on-secondary-container)" : "var(--on-surface)", fontWeight: 600, cursor: "pointer",
            borderRadius: "8px 8px 0 0", transition: "all 0.2s",
          }}
        >
          <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>fact_check</span>
          Plan & Execution
        </button>
        <button
          className={`tab-button ${activeTab === "monitoring" ? "active" : ""}`}
          onClick={() => setActiveTab("monitoring")}
          type="button"
          style={{
            flex: 1, padding: "10px 16px", border: "none", background: activeTab === "monitoring" ? "var(--secondary-container)" : "transparent",
            color: activeTab === "monitoring" ? "var(--on-secondary-container)" : "var(--on-surface)", fontWeight: 600, cursor: "pointer",
            borderRadius: "8px 8px 0 0", transition: "all 0.2s",
          }}
        >
          <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>monitoring</span>
          Execution Monitoring
        </button>
      </div>

      {activeTab === "plan" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>
              <span className="material-symbols" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>fact_check</span>
              Test Plans
            </h3>
            <button className="button primary" onClick={() => setShowCreatePlan(true)} type="button">
              <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 4 }}>add</span>
              New Plan
            </button>
          </div>

          {showCreatePlan && (
            <div className="card" style={{ padding: 20, marginBottom: 16, background: "var(--secondary-container)" }}>
              <h4 style={{ margin: "0 0 12px" }}>Create Test Plan</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>Plan Name *</label>
                  <input value={newPlanName} onChange={e => setNewPlanName(e.target.value)} placeholder="e.g. SIT Cycle 1" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>Project *</label>
                  <select value={newPlanProject} onChange={e => setNewPlanProject(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)" }}>
                    <option value="">Select project...</option>
                    {jiraProjects.map((p: any) => (
                      <option key={p.key} value={p.key}>{p.key} - {p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>Phase</label>
                  <select value={newPlanPhase} onChange={e => setNewPlanPhase(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)" }}>
                    {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>UQA Key (optional)</label>
                  <input value={newPlanUqaKey} onChange={e => setNewPlanUqaKey(e.target.value)} placeholder="e.g. PROJ-UQA-001" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)" }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>Description</label>
                  <textarea value={newPlanDesc} onChange={e => setNewPlanDesc(e.target.value)} placeholder="Plan description..." rows={2} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)", resize: "vertical" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="button primary" onClick={handleCreatePlan} disabled={!newPlanName || !newPlanProject} type="button">Create</button>
                <button className="ghost-button" onClick={() => setShowCreatePlan(false)} type="button">Cancel</button>
              </div>
            </div>
          )}

          {plansLoading && <div className="card" style={{ padding: 20, textAlign: "center" }}>Loading test plans...</div>}

          {!plansLoading && testPlans.length === 0 && (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--on-surface-variant)" }}>
              No test plans yet. Create one to get started.
            </div>
          )}

          {testPlans.map(plan => {
            const pc = phaseColor(plan.phase);
            const isExpanded = expandedPlanId === plan.id;
            return (
              <div key={plan.id} className="card" style={{ padding: 16, marginBottom: 12 }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={() => togglePlan(plan.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="material-symbols" style={{ color: "var(--on-surface-variant)", transition: "transform 0.2s", transform: isExpanded ? "rotate(90deg)" : "" }}>chevron_right</span>
                    <div>
                      <strong>{plan.name}</strong>
                      <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 2 }}>
                        {plan.description || projectName(plan.projectKey)}
                      </div>
                    </div>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: pc.bg, color: pc.fg }}>
                      {plan.phase}
                    </span>
                    {plan.jiraTestPlanKey && (
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "var(--tertiary-container)", color: "var(--on-tertiary-container)" }}>
                        {plan.jiraTestPlanKey}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                    {!plan.jiraTestPlanKey && (
                      <button className="ghost-button" onClick={() => handleSyncPlan(plan.id)} title="Sync to Jira" type="button" style={{ fontSize: 12 }}>
                        <span className="material-symbols" style={{ fontSize: 16 }}>cloud_upload</span>
                      </button>
                    )}
                    <button className="ghost-button" onClick={() => handleDeletePlan(plan.id)} title="Delete" type="button" style={{ color: "var(--error)", fontSize: 12 }}>
                      <span className="material-symbols" style={{ fontSize: 16 }}>delete</span>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 12, paddingLeft: 28 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <h5 style={{ margin: 0, fontSize: 14 }}>Test Executions</h5>
                      <button className="button secondary" onClick={() => setShowCreateExec(true)} type="button" style={{ fontSize: 12, padding: "4px 12px" }}>
                        <span className="material-symbols" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 4 }}>add</span>
                        Add Execution
                      </button>
                    </div>

                    {showCreateExec && (
                      <div style={{ padding: 12, background: "var(--surface-container-high)", borderRadius: 8, marginBottom: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 2 }}>Name *</label>
                            <input value={newExecName} onChange={e => setNewExecName(e.target.value)} placeholder="e.g. Login Feature" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)", fontSize: 13 }} />
                          </div>
                          <div>
                            <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 2 }}>Assignee</label>
                            <input value={newExecAssignee} onChange={e => setNewExecAssignee(e.target.value)} placeholder="Assignee name" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)", fontSize: 13 }} />
                          </div>
                          <div>
                            <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 2 }}>Feature Name</label>
                            <input value={newExecFeature} onChange={e => setNewExecFeature(e.target.value)} placeholder="e.g. User Authentication" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)", fontSize: 13 }} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                          <button className="button primary" onClick={handleCreateExec} disabled={!newExecName} type="button" style={{ fontSize: 12, padding: "4px 12px" }}>Create</button>
                          <button className="ghost-button" onClick={() => setShowCreateExec(false)} type="button" style={{ fontSize: 12 }}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {execLoading && <div style={{ padding: 16, textAlign: "center", color: "var(--on-surface-variant)", fontSize: 13 }}>Loading...</div>}

                    {!execLoading && executions.length === 0 && (
                      <div style={{ padding: 16, textAlign: "center", color: "var(--on-surface-variant)", fontSize: 13 }}>No executions yet.</div>
                    )}

                    {executions.map(exec => (
                      <div key={exec.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", marginBottom: 6, background: "var(--surface)", borderRadius: 8, border: "1px solid var(--surface-container-high)" }}>
                        <div>
                          <strong style={{ fontSize: 13 }}>{exec.name}</strong>
                          <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
                            {exec.featureName} | Assignee: {exec.assignee || "-"}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {exec.jiraTestExecKey ? (
                            <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 11, background: "var(--tertiary-container)", color: "var(--on-tertiary-container)" }}>
                              {exec.jiraTestExecKey}
                            </span>
                          ) : (
                            <button className="ghost-button" onClick={() => handleSyncExec(exec.id)} title="Sync to Jira" type="button" style={{ fontSize: 12 }}>
                              <span className="material-symbols" style={{ fontSize: 14 }}>cloud_upload</span>
                            </button>
                          )}
                          <button className="ghost-button" onClick={() => handleDeleteExec(exec.id)} title="Delete" type="button" style={{ color: "var(--error)", fontSize: 12 }}>
                            <span className="material-symbols" style={{ fontSize: 14 }}>delete</span>
                          </button>
                        </div>
                      </div>
                    ))}

                    <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 8 }}>
                      Last updated: {formatDate(plan.lastUpdated)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "monitoring" && (
        <div>
          <h3 style={{ margin: "0 0 16px" }}>
            <span className="material-symbols" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>monitoring</span>
            Execution Monitoring
          </h3>

          {/* ── Key Input ── */}
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--on-surface-variant)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Jira Test Execution Key
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={execKeyInput}
                onChange={e => handleExecKeyChange(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") fetchExecDetails(execKeyInput); }}
                placeholder="e.g. PROJ-1234"
                style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)", fontSize: 14 }}
              />
              <button
                className="button primary"
                onClick={() => fetchExecDetails(execKeyInput)}
                disabled={execDetailsLoading || !execKeyInput.trim()}
                type="button"
                style={{ padding: "10px 18px" }}
              >
                {execDetailsLoading
                  ? <span className="material-symbols" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span>
                  : <span className="material-symbols" style={{ fontSize: 18 }}>search</span>
                }
              </button>
              {execDetails && (
                <button
                  className="ghost-button"
                  onClick={() => fetchExecDetails(execKeyInput)}
                  disabled={execDetailsLoading}
                  type="button"
                  title="Refresh"
                  style={{ padding: "10px 12px" }}
                >
                  <span className="material-symbols" style={{ fontSize: 18 }}>refresh</span>
                </button>
              )}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--on-surface-variant)" }}>
              Masukkan Test Execution key dari Jira Xray untuk melihat status seluruh test case di dalamnya.
            </p>
          </div>

          {/* ── Loading ── */}
          {execDetailsLoading && (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--on-surface-variant)" }}>
              <span className="material-symbols" style={{ fontSize: 32, display: "block", marginBottom: 8, animation: "spin 1s linear infinite" }}>sync</span>
              Mengambil data dari Jira Xray...
            </div>
          )}

          {/* ── Error ── */}
          {execDetailsError && !execDetailsLoading && (
            <div className="card" style={{ padding: 20, background: "var(--error-container)", color: "var(--on-error-container)", borderRadius: 12 }}>
              <span className="material-symbols" style={{ verticalAlign: "middle", marginRight: 8 }}>error</span>
              {execDetailsError}
            </div>
          )}

          {/* ── Results ── */}
          {execDetails && !execDetailsLoading && (() => {
            const d = execDetails;
            const passRateColor = d.passRate >= 80 ? "var(--tertiary)" : d.passRate >= 50 ? "#f59e0b" : "var(--error)";

            const formatSnapDate = (iso: string) => {
              try {
                return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
              } catch { return iso; }
            };

            return (
              <div>
                {/* Summary header card */}
                <div className="card" style={{ padding: 20, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 18 }}>{d.key}</span>
                        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "var(--secondary-container)", color: "var(--on-secondary-container)" }}>
                          {d.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, color: "var(--on-surface-variant)" }}>{d.summary}</div>
                      {d.updated && (
                        <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 4 }}>
                          <span className="material-symbols" style={{ fontSize: 13, verticalAlign: "middle", marginRight: 3 }}>schedule</span>
                          Terakhir diperbarui: {formatDate(d.updated)}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "center", minWidth: 80 }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: passRateColor }}>{d.passRate.toFixed(1)}%</div>
                      <div style={{ fontSize: 11, color: "var(--on-surface-variant)" }}>Pass Rate</div>
                    </div>
                  </div>

                  {/* Current state bar */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ height: 10, background: "var(--surface-container-high)", borderRadius: 6, overflow: "hidden", display: "flex" }}>
                      {d.passed > 0 && <div style={{ height: "100%", background: "var(--tertiary)", width: `${(d.passed / d.total) * 100}%` }} title={`Passed: ${d.passed}`} />}
                      {d.failed > 0 && <div style={{ height: "100%", background: "var(--error)", width: `${(d.failed / d.total) * 100}%` }} title={`Failed: ${d.failed}`} />}
                      {d.blocked > 0 && <div style={{ height: "100%", background: "#f59e0b", width: `${(d.blocked / d.total) * 100}%` }} title={`Blocked: ${d.blocked}`} />}
                      {d.inProgress > 0 && <div style={{ height: "100%", background: "var(--secondary)", width: `${(d.inProgress / d.total) * 100}%` }} title={`In Progress: ${d.inProgress}`} />}
                      {d.unexecuted > 0 && <div style={{ height: "100%", background: "var(--outline-variant)", width: `${(d.unexecuted / d.total) * 100}%` }} title={`To Do: ${d.unexecuted}`} />}
                    </div>
                  </div>

                  {/* Legend */}
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
                    {[
                      { label: "To Do", count: d.unexecuted, color: "var(--on-surface-variant)" },
                      { label: "In Progress", count: d.inProgress, color: "var(--secondary)" },
                      { label: "Done", count: d.passed, color: "var(--tertiary)" },
                      { label: "Failed", count: d.failed, color: "var(--error)" },
                      { label: "Blocked", count: d.blocked, color: "#f59e0b" },
                    ].map(item => (
                      <span key={item.label} style={{ color: "var(--on-surface-variant)" }}>
                        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: item.color, marginRight: 4, verticalAlign: "middle" }} />
                        {item.label}: <strong style={{ color: "var(--on-surface)" }}>{item.count}</strong>
                      </span>
                    ))}
                    <span style={{ marginLeft: "auto", color: "var(--on-surface-variant)" }}>
                      Total: <strong style={{ color: "var(--on-surface)" }}>{d.total}</strong>
                    </span>
                  </div>
                </div>

                {/* History timeline */}
                <div className="card" style={{ padding: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
                    <h4 style={{ margin: 0, fontSize: 14 }}>
                      <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>history</span>
                      Historikal Eksekusi
                      <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: "var(--on-surface-variant)" }}>
                        — disimpan setiap kali data di-refresh
                      </span>
                    </h4>

                    {/* Inject to Jira panel */}
                    {d.history.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 320 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          Add to Daily Activity UQA
                        </label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            value={targetIssueKey}
                            onChange={e => { setTargetIssueKey(e.target.value); setInjectResult(null); }}
                            onKeyDown={e => { if (e.key === "Enter") handleInject(); }}
                            placeholder="e.g. UQA26-1234"
                            style={{ flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)", fontSize: 13 }}
                          />
                          <button
                            className="button primary"
                            onClick={handleInject}
                            disabled={injecting || !targetIssueKey.trim()}
                            type="button"
                            style={{ padding: "7px 14px", fontSize: 13, whiteSpace: "nowrap" }}
                          >
                            {injecting
                              ? <><span className="material-symbols" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 4, animation: "spin 1s linear infinite" }}>sync</span>Menginject...</>
                              : <><span className="material-symbols" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 4 }}>upload</span>Inject ke Jira</>
                            }
                          </button>
                        </div>
                        {injectResult && (
                          <div style={{
                            fontSize: 12, padding: "5px 10px", borderRadius: 6,
                            background: injectResult.ok ? "var(--tertiary-container)" : "var(--error-container)",
                            color: injectResult.ok ? "var(--on-tertiary-container)" : "var(--on-error-container)",
                          }}>
                            <span className="material-symbols" style={{ fontSize: 13, verticalAlign: "middle", marginRight: 4 }}>
                              {injectResult.ok ? "check_circle" : "error"}
                            </span>
                            {injectResult.msg}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {d.history.length === 0 && (
                    <div style={{ padding: 20, textAlign: "center", color: "var(--on-surface-variant)", fontSize: 13 }}>
                      Belum ada data historis. Refresh beberapa kali di hari berbeda untuk melihat perkembangan.
                    </div>
                  )}

                  {/* Header row */}
                  {d.history.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 60px 60px 60px 60px 60px", gap: 8, padding: "4px 12px 8px", borderBottom: "1px solid var(--outline-variant)", marginBottom: 4 }}>
                      {["Tanggal", "Progress", "Done", "Failed", "Blocked", "In Prog", "To Do"].map((h, i) => (
                        <span key={i} style={{ fontSize: 10, fontWeight: 700, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: i > 1 ? "center" : "left" }}>{h}</span>
                      ))}
                    </div>
                  )}

                  {[...d.history].reverse().map((snap, i) => {
                    const isLatest = i === 0;
                    const pct = snap.total > 0 ? (snap.passed / snap.total) * 100 : 0;
                    return (
                      <div
                        key={snap.date}
                        style={{
                          display: "grid", gridTemplateColumns: "140px 1fr 60px 60px 60px 60px 60px", gap: 8,
                          padding: "10px 12px", borderRadius: 8, marginBottom: 2,
                          background: isLatest ? "color-mix(in srgb, var(--primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--surface-container-low)",
                          border: isLatest ? "1px solid color-mix(in srgb, var(--primary) 20%, transparent)" : "1px solid transparent",
                        }}
                      >
                        {/* Date */}
                        <div style={{ alignSelf: "center" }}>
                          <div style={{ fontSize: 13, fontWeight: isLatest ? 700 : 500 }}>{formatSnapDate(snap.date)}</div>
                          {isLatest && <div style={{ fontSize: 10, color: "var(--primary)", fontWeight: 600, marginTop: 2 }}>Terbaru</div>}
                        </div>

                        {/* Stacked bar */}
                        <div style={{ alignSelf: "center" }}>
                          <div style={{ height: 8, background: "var(--surface-container-high)", borderRadius: 4, overflow: "hidden", display: "flex" }}>
                            {snap.passed > 0 && <div style={{ height: "100%", background: "var(--tertiary)", width: `${(snap.passed / snap.total) * 100}%` }} />}
                            {snap.failed > 0 && <div style={{ height: "100%", background: "var(--error)", width: `${(snap.failed / snap.total) * 100}%` }} />}
                            {snap.blocked > 0 && <div style={{ height: "100%", background: "#f59e0b", width: `${(snap.blocked / snap.total) * 100}%` }} />}
                            {snap.inProgress > 0 && <div style={{ height: "100%", background: "var(--secondary)", width: `${(snap.inProgress / snap.total) * 100}%` }} />}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--on-surface-variant)", marginTop: 2 }}>{pct.toFixed(0)}% done</div>
                        </div>

                        {/* Counts */}
                        {[
                          { val: snap.passed, color: "var(--tertiary)" },
                          { val: snap.failed, color: "var(--error)" },
                          { val: snap.blocked, color: "#f59e0b" },
                          { val: snap.inProgress, color: "var(--secondary)" },
                          { val: snap.unexecuted, color: "var(--on-surface-variant)" },
                        ].map((col, ci) => (
                          <div key={ci} style={{ alignSelf: "center", textAlign: "center", fontSize: 14, fontWeight: 600, color: col.val > 0 ? col.color : "var(--on-surface-variant)", opacity: col.val === 0 ? 0.35 : 1 }}>
                            {col.val}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Empty state (no key entered) */}
          {!execDetails && !execDetailsLoading && !execDetailsError && (
            <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--on-surface-variant)" }}>
              <span className="material-symbols" style={{ fontSize: 48, display: "block", marginBottom: 12, opacity: 0.4 }}>manage_search</span>
              <p style={{ margin: 0, fontSize: 14 }}>Masukkan Jira Test Execution key di atas untuk melihat detail eksekusi.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
