import React, { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../context/AppContext";
import type { XrayExecutionDetails, XrayFolder } from "@shared/types";
import SearchableSelect from "../components/SearchableSelect";

type Tab = "monitoring" | "organizer";

function formatDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function flattenFolders(folders: XrayFolder[], pfx = ""): { value: string; label: string; id: number }[] {
  const result: { value: string; label: string; id: number }[] = [];
  for (const f of folders) {
    const path = pfx ? `${pfx}/${f.name}` : `/${f.name}`;
    result.push({ value: String(f.id), label: path, id: f.id });
    if (f.children) result.push(...flattenFolders(f.children, path));
  }
  return result;
}

export default function TestExecutions() {
  const { jiraProjects } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>("monitoring");

  // ── Monitoring tab state ──
  const [execKeyInput, setExecKeyInput] = useState("");
  const [execDetails, setExecDetails] = useState<XrayExecutionDetails | null>(null);
  const [execDetailsLoading, setExecDetailsLoading] = useState(false);
  const [execDetailsError, setExecDetailsError] = useState<string | null>(null);
  const [targetIssueKey, setTargetIssueKey] = useState("");
  const [injecting, setInjecting] = useState(false);
  const [injectResult, setInjectResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Organizer tab state ──
  const [orgProjectKey, setOrgProjectKey] = useState("");
  const [orgFolders, setOrgFolders] = useState<XrayFolder[]>([]);
  const [orgFolderLoading, setOrgFolderLoading] = useState(false);
  const [orgSelectedFolder, setOrgSelectedFolder] = useState("");
  const [orgIssues, setOrgIssues] = useState<{ key: string; summary: string }[]>([]);
  const [orgIssuesLoading, setOrgIssuesLoading] = useState(false);
  const [orgSelectedKeys, setOrgSelectedKeys] = useState<Set<string>>(new Set());
  const [orgExecKey, setOrgExecKey] = useState("");
  const [orgAdding, setOrgAdding] = useState(false);
  const [orgAddResult, setOrgAddResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── Load Xray folders when project changes (with sessionStorage cache, TTL 30 min) ──
  const XRAY_FOLDER_CACHE_TTL = 30 * 60 * 1000;
  const readXrayFolderCache = (projectKey: string): XrayFolder[] | null => {
    try {
      const raw = sessionStorage.getItem(`qa-buddy-xray-folders-${projectKey}`);
      if (!raw) return null;
      const { data, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp > XRAY_FOLDER_CACHE_TTL) {
        sessionStorage.removeItem(`qa-buddy-xray-folders-${projectKey}`);
        return null;
      }
      return data;
    } catch { return null; }
  };
  const writeXrayFolderCache = (projectKey: string, folders: XrayFolder[]) => {
    try {
      sessionStorage.setItem(`qa-buddy-xray-folders-${projectKey}`, JSON.stringify({ data: folders, timestamp: Date.now() }));
    } catch { /* quota */ }
  };

  useEffect(() => {
    if (!orgProjectKey) {
      setOrgFolders([]);
      setOrgSelectedFolder("");
      setOrgIssues([]);
      return;
    }
    const cached = readXrayFolderCache(orgProjectKey);
    if (cached) {
      setOrgFolders(cached);
      return;
    }
    setOrgFolderLoading(true);
    setOrgSelectedFolder("");
    setOrgIssues([]);
    window.qaBuddy.getXrayFolders(orgProjectKey)
      .then(f => { writeXrayFolderCache(orgProjectKey, f || []); setOrgFolders(f || []); })
      .catch(() => setOrgFolders([]))
      .finally(() => setOrgFolderLoading(false));
  }, [orgProjectKey]);

  // ── Load issues when folder changes ──
  useEffect(() => {
    if (!orgProjectKey || !orgSelectedFolder) {
      setOrgIssues([]);
      setOrgSelectedKeys(new Set());
      return;
    }
    const folderId = parseInt(orgSelectedFolder, 10);
    if (isNaN(folderId)) return;
    setOrgIssuesLoading(true);
    setOrgSelectedKeys(new Set());
    setOrgAddResult(null);
    window.qaBuddy.getXrayFolderIssues(orgProjectKey, folderId)
      .then(issues => setOrgIssues(issues || []))
      .catch(() => setOrgIssues([]))
      .finally(() => setOrgIssuesLoading(false));
  }, [orgProjectKey, orgSelectedFolder]);

  // ── Fetch execution details ──
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
        execDetails.history,
      );
      setInjectResult({ ok: true, msg: `Berhasil diinject ke ${targetIssueKey.trim().toUpperCase()}` });
    } catch (e: any) {
      setInjectResult({ ok: false, msg: e?.message || String(e) });
    } finally {
      setInjecting(false);
    }
  }, [execDetails, targetIssueKey]);

  // ── Add tests to execution ──
  const handleAddToExecution = useCallback(async () => {
    if (!orgExecKey.trim() || orgSelectedKeys.size === 0) return;
    setOrgAdding(true);
    setOrgAddResult(null);
    try {
      await window.qaBuddy.addTestsToExecution(orgExecKey.trim().toUpperCase(), Array.from(orgSelectedKeys));
      setOrgAddResult({ ok: true, msg: `${orgSelectedKeys.size} test case berhasil ditambahkan ke ${orgExecKey.trim().toUpperCase()}` });
    } catch (e: any) {
      setOrgAddResult({ ok: false, msg: e?.message || String(e) });
    } finally {
      setOrgAdding(false);
    }
  }, [orgExecKey, orgSelectedKeys]);

  const orgFolderOptions = flattenFolders(orgFolders);

  const formatSnapDate = (iso: string) => {
    try {
      return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    } catch { return iso; }
  };

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid var(--surface-container-high)" }}>
        {([
          { key: "monitoring", label: "Test Execution Monitoring", icon: "monitoring" },
          { key: "organizer", label: "Test Execution Organizer", icon: "playlist_add" },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            type="button"
            style={{
              flex: 1, padding: "10px 16px", border: "none",
              background: activeTab === tab.key ? "var(--secondary-container)" : "transparent",
              color: activeTab === tab.key ? "var(--on-secondary-container)" : "var(--on-surface)",
              fontWeight: 600, cursor: "pointer", borderRadius: "8px 8px 0 0", transition: "all 0.2s",
            }}
          >
            <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Test Execution Monitoring ── */}
      {activeTab === "monitoring" && (
        <div>
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

          {execDetailsLoading && (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--on-surface-variant)" }}>
              <span className="material-symbols" style={{ fontSize: 32, display: "block", marginBottom: 8, animation: "spin 1s linear infinite" }}>sync</span>
              Mengambil data dari Jira Xray...
            </div>
          )}

          {execDetailsError && !execDetailsLoading && (
            <div className="card" style={{ padding: 20, background: "var(--error-container)", color: "var(--on-error-container)", borderRadius: 12 }}>
              <span className="material-symbols" style={{ verticalAlign: "middle", marginRight: 8 }}>error</span>
              {execDetailsError}
            </div>
          )}

          {execDetails && !execDetailsLoading && (() => {
            const d = execDetails;
            const passRateColor = d.passRate >= 80 ? "var(--tertiary)" : d.passRate >= 50 ? "#f59e0b" : "var(--error)";
            return (
              <div>
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

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ height: 10, background: "var(--surface-container-high)", borderRadius: 6, overflow: "hidden", display: "flex" }}>
                      {d.passed > 0 && <div style={{ height: "100%", background: "var(--tertiary)", width: `${(d.passed / d.total) * 100}%` }} title={`Passed: ${d.passed}`} />}
                      {d.failed > 0 && <div style={{ height: "100%", background: "var(--error)", width: `${(d.failed / d.total) * 100}%` }} title={`Failed: ${d.failed}`} />}
                      {d.blocked > 0 && <div style={{ height: "100%", background: "#f59e0b", width: `${(d.blocked / d.total) * 100}%` }} title={`Blocked: ${d.blocked}`} />}
                      {d.inProgress > 0 && <div style={{ height: "100%", background: "var(--secondary)", width: `${(d.inProgress / d.total) * 100}%` }} title={`In Progress: ${d.inProgress}`} />}
                      {d.unexecuted > 0 && <div style={{ height: "100%", background: "var(--outline-variant)", width: `${(d.unexecuted / d.total) * 100}%` }} title={`To Do: ${d.unexecuted}`} />}
                    </div>
                  </div>

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

                <div className="card" style={{ padding: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
                    <h4 style={{ margin: 0, fontSize: 14 }}>
                      <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>history</span>
                      Historikal Eksekusi
                      <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: "var(--on-surface-variant)" }}>
                        — disimpan setiap kali data di-refresh
                      </span>
                    </h4>

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
                        <div style={{ alignSelf: "center" }}>
                          <div style={{ fontSize: 13, fontWeight: isLatest ? 700 : 500 }}>{formatSnapDate(snap.date)}</div>
                          {isLatest && <div style={{ fontSize: 10, color: "var(--primary)", fontWeight: 600, marginTop: 2 }}>Terbaru</div>}
                        </div>
                        <div style={{ alignSelf: "center" }}>
                          <div style={{ height: 8, background: "var(--surface-container-high)", borderRadius: 4, overflow: "hidden", display: "flex" }}>
                            {snap.passed > 0 && <div style={{ height: "100%", background: "var(--tertiary)", width: `${(snap.passed / snap.total) * 100}%` }} />}
                            {snap.failed > 0 && <div style={{ height: "100%", background: "var(--error)", width: `${(snap.failed / snap.total) * 100}%` }} />}
                            {snap.blocked > 0 && <div style={{ height: "100%", background: "#f59e0b", width: `${(snap.blocked / snap.total) * 100}%` }} />}
                            {snap.inProgress > 0 && <div style={{ height: "100%", background: "var(--secondary)", width: `${(snap.inProgress / snap.total) * 100}%` }} />}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--on-surface-variant)", marginTop: 2 }}>{pct.toFixed(0)}% done</div>
                        </div>
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

          {!execDetails && !execDetailsLoading && !execDetailsError && (
            <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--on-surface-variant)" }}>
              <span className="material-symbols" style={{ fontSize: 48, display: "block", marginBottom: 12, opacity: 0.4 }}>manage_search</span>
              <p style={{ margin: 0, fontSize: 14 }}>Masukkan Jira Test Execution key di atas untuk melihat detail eksekusi.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Test Execution Organizer ── */}
      {activeTab === "organizer" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Step 1: Project + Folder */}
          <div className="card" style={{ padding: 24 }}>
            <h4 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols" style={{ fontSize: 18, color: "var(--primary)" }}>folder_open</span>
              Pilih Project &amp; Folder Xray
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="field-group">
                <label>Jira Project</label>
                <SearchableSelect
                  options={jiraProjects.map((p: any) => ({ value: p.key, label: `${p.key} - ${p.name}` }))}
                  value={orgProjectKey}
                  onChange={setOrgProjectKey}
                  placeholder="-- Pilih Project --"
                />
              </div>
              <div className="field-group">
                <label>Xray Repository Folder</label>
                <SearchableSelect
                  options={orgFolderOptions.map(o => ({ value: o.value, label: o.label }))}
                  value={orgSelectedFolder}
                  onChange={setOrgSelectedFolder}
                  placeholder={orgFolderLoading ? "Loading folders..." : !orgProjectKey ? "-- Pilih Project Dulu --" : "-- Pilih Folder --"}
                  disabled={orgFolderLoading || !orgProjectKey}
                />
              </div>
            </div>
          </div>

          {/* Step 2: Test cases list */}
          {(orgIssuesLoading || orgIssues.length > 0 || orgSelectedFolder) && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container)" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {orgIssuesLoading ? "Memuat test cases..." : `${orgIssues.length} test case ditemukan`}
                </span>
                {orgIssues.length > 0 && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="secondary-button"
                      onClick={() => setOrgSelectedKeys(new Set(orgIssues.map(i => i.key)))}
                      style={{ padding: "4px 12px", fontSize: 12, borderRadius: 6 }}
                    >
                      Select All
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setOrgSelectedKeys(new Set())}
                      style={{ padding: "4px 12px", fontSize: 12, borderRadius: 6 }}
                    >
                      Deselect All
                    </button>
                    <span style={{ fontSize: 12, color: "var(--on-surface-variant)", alignSelf: "center" }}>
                      {orgSelectedKeys.size} dipilih
                    </span>
                  </div>
                )}
              </div>

              {orgIssuesLoading && (
                <div style={{ padding: 32, textAlign: "center", color: "var(--on-surface-variant)" }}>
                  <span className="material-symbols" style={{ fontSize: 28, display: "block", marginBottom: 8, animation: "spin 1s linear infinite" }}>sync</span>
                  Memuat test cases dari Xray...
                </div>
              )}

              {!orgIssuesLoading && orgIssues.length === 0 && orgSelectedFolder && (
                <div style={{ padding: 32, textAlign: "center", color: "var(--on-surface-variant)", fontSize: 13 }}>
                  Tidak ada test case di folder ini.
                </div>
              )}

              {!orgIssuesLoading && orgIssues.length > 0 && (
                <div style={{ maxHeight: 400, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead style={{ position: "sticky", top: 0, background: "var(--surface-container-low)", zIndex: 1 }}>
                      <tr>
                        <th style={{ padding: "8px 16px", textAlign: "left", width: 40, borderBottom: "1px solid var(--outline-variant)" }}>
                          <input
                            type="checkbox"
                            checked={orgSelectedKeys.size === orgIssues.length && orgIssues.length > 0}
                            onChange={e => setOrgSelectedKeys(e.target.checked ? new Set(orgIssues.map(i => i.key)) : new Set())}
                          />
                        </th>
                        <th style={{ padding: "8px 16px", textAlign: "left", borderBottom: "1px solid var(--outline-variant)", fontWeight: 600 }}>Key</th>
                        <th style={{ padding: "8px 16px", textAlign: "left", borderBottom: "1px solid var(--outline-variant)", fontWeight: 600 }}>Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orgIssues.map(issue => (
                        <tr
                          key={issue.key}
                          style={{ borderBottom: "1px solid var(--outline-variant)", background: orgSelectedKeys.has(issue.key) ? "rgba(var(--primary-rgb), 0.04)" : "transparent", cursor: "pointer" }}
                          onClick={() => setOrgSelectedKeys(prev => {
                            const next = new Set(prev);
                            if (next.has(issue.key)) next.delete(issue.key);
                            else next.add(issue.key);
                            return next;
                          })}
                        >
                          <td style={{ padding: "8px 16px" }}>
                            <input
                              type="checkbox"
                              checked={orgSelectedKeys.has(issue.key)}
                              onChange={() => {}}
                              onClick={e => e.stopPropagation()}
                            />
                          </td>
                          <td style={{ padding: "8px 16px", fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap", color: "var(--primary)" }}>{issue.key}</td>
                          <td style={{ padding: "8px 16px", color: "var(--on-surface-variant)" }}>{issue.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Add to execution */}
          <div className="card" style={{ padding: 24 }}>
            <h4 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols" style={{ fontSize: 18, color: "var(--primary)" }}>playlist_add</span>
              Tambahkan ke Test Execution
            </h4>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div className="field-group" style={{ flex: 1 }}>
                <label>Test Execution Key</label>
                <input
                  value={orgExecKey}
                  onChange={e => { setOrgExecKey(e.target.value); setOrgAddResult(null); }}
                  placeholder="e.g. PROJ-5678"
                  style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)", fontSize: 14, width: "100%" }}
                />
              </div>
              <button
                className="primary-button"
                onClick={handleAddToExecution}
                disabled={orgAdding || orgSelectedKeys.size === 0 || !orgExecKey.trim()}
                style={{ padding: "10px 24px", borderRadius: 8, fontSize: 14, whiteSpace: "nowrap", height: 44 }}
              >
                {orgAdding
                  ? <><span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 4, animation: "spin 1s linear infinite" }}>sync</span>Menambahkan...</>
                  : <><span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 4 }}>add_task</span>Tambahkan {orgSelectedKeys.size > 0 ? `(${orgSelectedKeys.size})` : ""} ke Execution</>
                }
              </button>
            </div>

            {orgAddResult && (
              <div style={{
                marginTop: 12, fontSize: 13, padding: "10px 14px", borderRadius: 8,
                background: orgAddResult.ok ? "var(--tertiary-container)" : "var(--error-container)",
                color: orgAddResult.ok ? "var(--on-tertiary-container)" : "var(--on-error-container)",
              }}>
                <span className="material-symbols" style={{ fontSize: 15, verticalAlign: "middle", marginRight: 6 }}>
                  {orgAddResult.ok ? "check_circle" : "error"}
                </span>
                {orgAddResult.msg}
              </div>
            )}

            <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--on-surface-variant)" }}>
              Pilih test case dari folder Xray di atas, lalu masukkan key Test Execution yang ingin diisi.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
