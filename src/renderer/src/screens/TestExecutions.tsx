import React, { useState, useCallback, useRef } from "react";
import type { XrayExecutionDetails } from "@shared/types";

type Tab = "monitoring";

function formatDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function TestExecutions() {
  const [activeTab] = useState<Tab>("monitoring");

  // ── Monitoring tab state ──
  const [execKeyInput, setExecKeyInput] = useState("");
  const [execDetails, setExecDetails] = useState<XrayExecutionDetails | null>(null);
  const [execDetailsLoading, setExecDetailsLoading] = useState(false);
  const [execDetailsError, setExecDetailsError] = useState<string | null>(null);
  const [targetIssueKey, setTargetIssueKey] = useState("");
  const [injecting, setInjecting] = useState(false);
  const [injectResult, setInjectResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [syncingDb, setSyncingDb] = useState(false);
  const [syncDbResult, setSyncDbResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleSyncToDb = useCallback(async () => {
    if (!execDetails) return;
    setSyncingDb(true);
    setSyncDbResult(null);
    try {
      const { count, truncated } = await window.qaBuddy.syncExecutionTestsToDb(execDetails.key);
      const msg = truncated
        ? `${count} test case disinkronkan, tapi TE ini melebihi batas 200 TC Xray — sebagian TC mungkin tidak tersync. Pertimbangkan memecah TE ini menjadi beberapa TE lebih kecil.`
        : `${count} test case berhasil disinkronkan ke database.`;
      setSyncDbResult({ ok: !truncated, msg });
    } catch (e: any) {
      setSyncDbResult({ ok: false, msg: e?.message || String(e) });
    } finally {
      setSyncingDb(false);
    }
  }, [execDetails]);

  const handleExecKeyChange = useCallback((val: string) => {
    setExecKeyInput(val);
    setInjectResult(null);
    setSyncDbResult(null);
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

  const formatSnapDate = (iso: string) => {
    try {
      return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    } catch { return iso; }
  };

  return (
    <div>
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

                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, alignItems: "center" }}>
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
                    <span style={{ color: "var(--on-surface-variant)" }}>
                      Total: <strong style={{ color: "var(--on-surface)" }}>{d.total}</strong>
                    </span>
                    <span style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <button
                        className="ghost-button"
                        onClick={handleSyncToDb}
                        disabled={syncingDb}
                        type="button"
                        title="Sync seluruh test case ke database"
                        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 12px" }}
                      >
                        {syncingDb
                          ? <><span className="material-symbols" style={{ fontSize: 14, animation: "spin 1s linear infinite" }}>sync</span>Menyimpan...</>
                          : <><span className="material-symbols" style={{ fontSize: 14 }}>save</span>Sync ke Database</>
                        }
                      </button>
                      {syncDbResult && (
                        <div style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 6,
                          background: syncDbResult.ok ? "var(--tertiary-container)" : "var(--error-container)",
                          color: syncDbResult.ok ? "var(--on-tertiary-container)" : "var(--on-error-container)",
                        }}>
                          <span className="material-symbols" style={{ fontSize: 12, verticalAlign: "middle", marginRight: 3 }}>
                            {syncDbResult.ok ? "check_circle" : "error"}
                          </span>
                          {syncDbResult.msg}
                        </div>
                      )}
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

    </div>
  );
}
