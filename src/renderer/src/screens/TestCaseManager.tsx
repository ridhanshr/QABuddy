import React, { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../context/AppContext";
import SearchableSelect from "../components/SearchableSelect";
import type { JiraProject, BRDTestCase, BRDGenerationResult, SemanticSearchResult, XrayFolder } from "@shared/types";

type Tab = "search" | "creation";

const SCENARIO_TYPES = ["TC_HAPPY", "TC_UNHAPPY", "TC_REGRESSION"] as const;
const EXECUTION_STATUSES = ["Pass", "Fail", "Blocked", "Unexecuted"] as const;

const scenarioTypeStyle: Record<string, { bg: string; color: string }> = {
  TC_HAPPY: { bg: "#d4edda", color: "#1a5c2a" },
  TC_UNHAPPY: { bg: "var(--error-container)", color: "var(--on-error-container)" },
  TC_REGRESSION: { bg: "#e8d5f5", color: "#5c2a7a" },
  // legacy fallbacks
  Positive: { bg: "#d4edda", color: "#1a5c2a" },
  Negative: { bg: "var(--error-container)", color: "var(--on-error-container)" },
  Regression: { bg: "#e8d5f5", color: "#5c2a7a" },
};

/** Flatten an Xray folder tree into a list of { path, id } */
function flattenFolders(folders: XrayFolder[], prefix = ""): { label: string; value: string }[] {
  return folders.flatMap(f => {
    const path = prefix ? `${prefix}/${f.name}` : f.name;
    const self = { label: path, value: path };
    return f.children ? [self, ...flattenFolders(f.children, path)] : [self];
  });
}

const executionStatusStyle: Record<string, { bg: string; color: string }> = {
  Pass: { bg: "#d4edda", color: "#1a5c2a" },
  Fail: { bg: "var(--error-container)", color: "var(--on-error-container)" },
  Blocked: { bg: "#fff3cd", color: "#856404" },
  Unexecuted: { bg: "var(--surface-container-high)", color: "var(--on-surface-variant)" },
};

const syncStatusStyle: Record<string, { bg: string; color: string }> = {
  "Synced to Jira": { bg: "var(--tertiary-container)", color: "var(--on-tertiary-container)" },
  "Failed to Sync": { bg: "var(--error-container)", color: "var(--on-error-container)" },
  "Draft AI": { bg: "var(--secondary-container)", color: "var(--on-secondary-container)" },
};

function Badge({ label, style }: { label: string; style?: React.CSSProperties }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 11,
      fontWeight: 700, whiteSpace: "nowrap", ...style,
    }}>
      {label}
    </span>
  );
}

function TestCaseCard({
  tc, index, onUpdate, onDelete, onChange,
}: {
  tc: BRDTestCase;
  index: number;
  onUpdate: (tc: BRDTestCase) => void;
  onDelete: (id: string) => void;
  onChange: (index: number, field: string, value: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const stStyle = scenarioTypeStyle[tc.scenarioType] || scenarioTypeStyle.Positive;
  const exStyle = executionStatusStyle[tc.executionStatus] || executionStatusStyle.Unexecuted;
  const syncStyle = syncStatusStyle[tc.syncStatus] || syncStatusStyle["Draft AI"];

  return (
    <div style={{
      border: "1px solid var(--outline-variant, var(--surface-container-high))",
      borderRadius: 10, marginBottom: 8, background: "var(--surface)",
      overflow: "hidden", transition: "box-shadow 0.15s",
    }}>
      {/* Header row — always visible */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "28px 1fr auto auto auto auto auto",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          cursor: "pointer",
          background: expanded ? "var(--surface-container)" : "transparent",
          userSelect: "none",
        }}
        onClick={() => setExpanded(v => !v)}
      >
        {/* # */}
        <span style={{ fontWeight: 700, color: "var(--on-surface-variant)", fontSize: 13 }}>{index + 1}</span>

        {/* Name */}
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tc.name}
        </span>

        {/* Feature badge */}
        <span style={{ fontSize: 12, color: "var(--on-surface-variant)", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
          {tc.featureCategory}
        </span>

        {/* Type badge */}
        <Badge label={tc.scenarioType} style={{ background: stStyle.bg, color: stStyle.color }} />

        {/* Execution status badge */}
        <Badge label={tc.executionStatus} style={{ background: exStyle.bg, color: exStyle.color }} />

        {/* Sync status badge */}
        <Badge label={tc.syncStatus} style={{ background: syncStyle.bg, color: syncStyle.color }} />

        {/* Jira key + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={e => e.stopPropagation()}>
          {tc.jiraTestCaseKey ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)" }}>{tc.jiraTestCaseKey}</span>
          ) : (
            <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>—</span>
          )}
          <button
            type="button"
            title="Edit"
            onClick={() => { setExpanded(true); setEditing(v => !v); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 2 }}
          >
            <span className="material-symbols" style={{ fontSize: 16 }}>edit</span>
          </button>
          <button
            type="button"
            title="Delete"
            onClick={() => onDelete(tc.id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--error)", padding: 2 }}
          >
            <span className="material-symbols" style={{ fontSize: 16 }}>delete</span>
          </button>
          <span className="material-symbols" style={{ fontSize: 16, color: "var(--on-surface-variant)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            expand_more
          </span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--surface-container-high)" }}>
          {editing ? (
            /* Edit mode */
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "var(--on-surface-variant)" }}>Name</label>
                  <input
                    value={tc.name}
                    onChange={e => onChange(index, "name", e.target.value)}
                    onBlur={() => onUpdate(tc)}
                    style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--outline)", borderRadius: 6, background: "var(--surface)", color: "var(--on-surface)", fontSize: 13, boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "var(--on-surface-variant)" }}>Feature Category</label>
                  <input
                    value={tc.featureCategory}
                    onChange={e => onChange(index, "featureCategory", e.target.value)}
                    onBlur={() => onUpdate(tc)}
                    style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--outline)", borderRadius: 6, background: "var(--surface)", color: "var(--on-surface)", fontSize: 13, boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "var(--on-surface-variant)" }}>Type</label>
                  <select
                    value={tc.scenarioType}
                    onChange={e => { onChange(index, "scenarioType", e.target.value); setTimeout(() => onUpdate(tc), 100); }}
                    style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--outline)", borderRadius: 6, background: "var(--surface)", color: "var(--on-surface)", fontSize: 13 }}
                  >
                    {SCENARIO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "var(--on-surface-variant)" }}>Execution Status</label>
                  <select
                    value={tc.executionStatus}
                    onChange={e => { onChange(index, "executionStatus", e.target.value); setTimeout(() => onUpdate(tc), 100); }}
                    style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--outline)", borderRadius: 6, background: "var(--surface)", color: "var(--on-surface)", fontSize: 13 }}
                  >
                    {EXECUTION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => { onUpdate(tc); setEditing(false); }}
                style={{ alignSelf: "flex-start", fontSize: 12, padding: "5px 14px" }}
              >
                Done
              </button>
            </div>
          ) : (
            /* View mode — two-column layout */
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Steps */}
              <div>
                <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Test Steps</p>
                <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                  {tc.steps.map(s => (
                    <li key={s.stepNumber} style={{ fontSize: 13, color: "var(--on-surface)", lineHeight: 1.5 }}>{s.action}</li>
                  ))}
                </ol>
              </div>
              {/* Expected Results */}
              <div>
                <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Expected Results</p>
                <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                  {tc.expectedResult.map(r => (
                    <li key={r.stepNumber} style={{ fontSize: 13, color: "var(--on-surface)", lineHeight: 1.5 }}>{r.result}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
const CACHE_TTL = 15_000;

export default function TestCaseManager({ initialTab }: { initialTab?: Tab }) {
  const { jiraProjects } = useApp();

  // ── Tab State ──
  const [activeTab, setActiveTab] = useState<Tab>(initialTab || "search");
  const currentTab = initialTab || activeTab;

  // ── Search Tab ──
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const [searchProject, setSearchProject] = useState("");
  const [keywordQuery, setKeywordQuery] = useState("");
  const [semanticQuery, setSemanticQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchCache = useRef<Map<string, { data: any[]; ts: number }>>(new Map());

  // ── Creation Tab ── (generation state lives in global AppContext to survive navigation)
  const {
    brdGenerating: generating,
    brdTestCases: testCases,
    setBrdTestCases: setTestCases,
    brdGenerationResult: generationResult,
    setBrdGenerationResult: setGenerationResult,
    brdGeneratedExecId: generatedTestExecId,
    setBrdGeneratedExecId: setGeneratedTestExecId,
    brdChunkProgress: chunkProgress,
    handleBrdGenerate,
  } = useApp();

  const [confluencePageId, setConfluencePageId] = useState("");
  const [generationProject, setGenerationProject] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

  // ── Xray Folder Selection ──
  const [xrayFolders, setXrayFolders] = useState<{ label: string; value: string }[]>([]);
  const [xrayFoldersLoading, setXrayFoldersLoading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState("");

  const doJiraSearch = useCallback(async (project: string, keyword: string, forceRefresh = false) => {
    const cacheKey = `${project}::all`;
    const now = Date.now();
    const cached = searchCache.current.get(cacheKey);
    let all: any[] = [];
    if (cached && now - cached.ts < CACHE_TTL && !forceRefresh) {
      all = cached.data;
    } else {
      const jql = `project = "${project}" AND issuetype = "Test" ORDER BY updated DESC`;
      all = await window.qaBuddy.findIssuesByJql(jql, 100);
      searchCache.current.set(cacheKey, { data: all, ts: now });
    }
    if (!keyword) return all;
    const q = keyword.toLowerCase();
    return all.filter((i: any) => i.summary?.toLowerCase().includes(q));
  }, []);

  const handleSearch = useCallback(async (forceRefresh = false) => {
    if (!searchProject) {
      setSearchError("Please select a project");
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    try {
      if (searchMode === "keyword") {
        const results = await doJiraSearch(searchProject, keywordQuery.trim(), forceRefresh);
        setSearchResults(results || []);
      } else {
        const results = await window.qaBuddy.semanticSearchTestCases(semanticQuery, searchProject);
        setSearchResults(results || []);
      }
    } catch (e: any) {
      setSearchError(e?.message || String(e) || "Search failed");
    } finally {
      setSearchLoading(false);
    }
  }, [searchMode, searchProject, keywordQuery, semanticQuery, doJiraSearch]);

  const fetchXrayFolders = useCallback(async (projectKey: string) => {
    if (!projectKey) return;
    setXrayFoldersLoading(true);
    setXrayFolders([]);
    setSelectedFolder("");
    try {
      const tree = await window.qaBuddy.getXrayFolders(projectKey);
      setXrayFolders(flattenFolders(tree));
    } catch {
      setXrayFolders([]);
    } finally {
      setXrayFoldersLoading(false);
    }
  }, []);

  const handleGenerationProjectChange = useCallback((projectKey: string) => {
    setGenerationProject(projectKey);
    fetchXrayFolders(projectKey);
  }, [fetchXrayFolders]);

  const handleGenerate = useCallback(async () => {
    setSyncResult(null);
    await handleBrdGenerate(confluencePageId, generationProject);
  }, [confluencePageId, generationProject, handleBrdGenerate]);

  const handleUpdateTestCase = useCallback(async (tc: BRDTestCase) => {
    try {
      const updated = await window.qaBuddy.updateBRDTestCase(tc);
      setTestCases(prev => prev.map(t => t.id === updated.id ? updated : t));
    } catch (e: any) {
      console.error("Update failed", e);
    }
  }, []);

  const handleDeleteTestCase = useCallback(async (id: string) => {
    try {
      await window.qaBuddy.deleteBRDTestCase(id);
      setTestCases(prev => prev.filter(t => t.id !== id));
    } catch (e: any) {
      console.error("Delete failed", e);
    }
  }, []);

  const handleSyncToJira = useCallback(async () => {
    if (!generatedTestExecId || !generationProject) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await window.qaBuddy.syncBRDTestCasesToJira(
        generatedTestExecId,
        generationProject,
        selectedFolder || undefined,
      );
      setSyncResult(result);
      const refreshed = await window.qaBuddy.getGeneratedTestCases(generatedTestExecId);
      setTestCases(refreshed);
    } catch (e: any) {
      setSyncResult({ success: 0, failed: 0, errors: [e?.message || "Sync failed"] });
    } finally {
      setSyncing(false);
    }
  }, [generatedTestExecId, generationProject, selectedFolder]);

  const updateField = useCallback((index: number, field: string, value: any) => {
    setTestCases(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  return (
    <div>
      {!initialTab && (
        <div className="tab-bar" style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid var(--surface-container-high)" }}>
          <button
            className={`tab-button ${activeTab === "search" ? "active" : ""}`}
            onClick={() => setActiveTab("search")}
            type="button"
            style={{
              flex: 1, padding: "10px 16px", border: "none", background: activeTab === "search" ? "var(--secondary-container)" : "transparent",
              color: activeTab === "search" ? "var(--on-secondary-container)" : "var(--on-surface)", fontWeight: 600, cursor: "pointer",
              borderRadius: "8px 8px 0 0", transition: "all 0.2s",
            }}
          >
            <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>search</span>
            Search
          </button>
          <button
            className={`tab-button ${activeTab === "creation" ? "active" : ""}`}
            onClick={() => setActiveTab("creation")}
            type="button"
            style={{
              flex: 1, padding: "10px 16px", border: "none", background: activeTab === "creation" ? "var(--secondary-container)" : "transparent",
              color: activeTab === "creation" ? "var(--on-secondary-container)" : "var(--on-surface)", fontWeight: 600, cursor: "pointer",
              borderRadius: "8px 8px 0 0", transition: "all 0.2s",
            }}
          >
            <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>add_circle</span>
            Creation from BRD
          </button>
        </div>
      )}

      {currentTab === "search" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: "0 0 16px" }}>
            <span className="material-symbols" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>search</span>
            Test Case Search
          </h3>

          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>
                Target Project
              </label>
              <SearchableSelect
                value={searchProject}
                onChange={setSearchProject}
                options={jiraProjects.map((p: JiraProject) => ({ value: p.key, label: `${p.key} - ${p.name}` }))}
                placeholder="Select project..."
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>
                Search Mode
              </label>
              <SearchableSelect
                value={searchMode}
                onChange={(v: any) => setSearchMode(v)}
                options={[
                  { value: "keyword", label: "Keyword Search" },
                  { value: "semantic", label: "AI Semantic Search" },
                ]}
                placeholder="Select mode..."
              />
            </div>
          </div>

          {searchMode === "keyword" ? (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>
                Keyword
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  value={keywordQuery}
                  onChange={e => setKeywordQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
                  placeholder="Enter keyword to search test cases by summary..."
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)" }}
                />
                <button className="button primary" onClick={() => handleSearch()} disabled={searchLoading} type="button">
                  {searchLoading ? "Searching..." : "Search"}
                </button>
                <button className="button secondary" onClick={() => handleSearch(true)} disabled={searchLoading} type="button" title="Force refresh from Jira">
                  <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle" }}>refresh</span>
                </button>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--on-surface-variant)" }}>
                Searches test cases in <strong>{searchProject || "selected project"}</strong> where summary contains your keyword. Leave empty to list all test cases.
              </p>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>
                Natural Language Query
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  value={semanticQuery}
                  onChange={e => setSemanticQuery(e.target.value)}
                  placeholder='e.g. "Find test cases about user login with invalid password"'
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)" }}
                />
                <button className="button primary" onClick={handleSearch} disabled={searchLoading || !semanticQuery.trim()} type="button">
                  {searchLoading ? "Searching..." : "AI Search"}
                </button>
              </div>
            </div>
          )}

          {searchError && (
            <div className="banner error" style={{ padding: "8px 12px", borderRadius: 8, background: "var(--error-container)", color: "var(--on-error-container)", marginBottom: 12 }}>
              {searchError}
            </div>
          )}

          {searchResults.length > 0 && (
            <div>
              <h4 style={{ margin: "12px 0 8px" }}>Results ({searchResults.length})</h4>
              <div className="table-wrapper" style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--surface-container-high)" }}>
                      <th style={{ textAlign: "left", padding: "8px 12px" }}>Key</th>
                      <th style={{ textAlign: "left", padding: "8px 12px" }}>Summary</th>
                      {searchMode === "keyword" ? (
                        <>
                          <th style={{ textAlign: "left", padding: "8px 12px" }}>Status</th>
                          <th style={{ textAlign: "left", padding: "8px 12px" }}>Priority</th>
                        </>
                      ) : (
                        <>
                          <th style={{ textAlign: "left", padding: "8px 12px" }}>Score</th>
                          <th style={{ textAlign: "left", padding: "8px 12px" }}>Reason</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((r: any, i: number) => (
                      <tr key={r.key || r.issueKey || i} style={{ borderBottom: "1px solid var(--surface-container-high)" }}>
                        <td style={{ padding: "8px 12px" }}>
                          <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); window.qaBuddy.openExternal(r.url).catch(() => {}); }}
                            style={{ fontWeight: 600, color: "var(--primary)", textDecoration: "none", cursor: "pointer" }}
                            title={`Open ${r.key || r.issueKey} in Jira`}
                          >
                            {r.key || r.issueKey}
                            <span className="material-symbols" style={{ fontSize: 12, marginLeft: 4, verticalAlign: "middle" }}>open_in_new</span>
                          </a>
                        </td>
                        <td style={{ padding: "8px 12px" }}>{r.summary || r.title}</td>
                        {searchMode === "keyword" ? (
                          <>
                            <td style={{ padding: "8px 12px" }}>
                              <span style={{
                                padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                                background: r.status === "Done" || r.status === "Selesai" || r.status === "Closed" ? "var(--tertiary-container)" : r.status === "In Progress" || r.status === "Open" ? "var(--secondary-container)" : "var(--surface-container-high)",
                                color: r.status === "Done" || r.status === "Selesai" || r.status === "Closed" ? "var(--on-tertiary-container)" : r.status === "In Progress" || r.status === "Open" ? "var(--on-secondary-container)" : "var(--on-surface-variant)",
                              }}>
                                {r.status || "-"}
                              </span>
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              <span style={{
                                padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                                background: r.priority === "Highest" || r.priority === "High" ? "var(--error-container)" : r.priority === "Medium" ? "var(--secondary-container)" : "var(--surface-container-high)",
                                color: r.priority === "Highest" || r.priority === "High" ? "var(--on-error-container)" : r.priority === "Medium" ? "var(--on-secondary-container)" : "var(--on-surface-variant)",
                              }}>
                                {r.priority || "Medium"}
                              </span>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: "8px 12px" }}>
                              <span style={{
                                padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                                background: (() => {
                                  const s = Math.min(1, Math.max(0.5, r.score || 0.5));
                                  const hue = (1 - s) * 120;
                                  return `hsl(${hue}, 100%, 85%)`;
                                })(),
                                color: (() => {
                                  const s = Math.min(1, Math.max(0.5, r.score || 0.5));
                                  const hue = (1 - s) * 120;
                                  return `hsl(${hue}, 80%, 25%)`;
                                })(),
                              }}>
                                {((r.score || 0) * 100).toFixed(0)}%
                              </span>
                            </td>
                            <td style={{ padding: "8px 12px", fontSize: 13, color: "var(--on-surface-variant)" }}>
                              {r.matchReason || ""}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {searchResults.length === 0 && !searchLoading && (
            <div style={{ textAlign: "center", padding: 32, color: "var(--on-surface-variant)" }}>
              No results found. Try a different query or project.
            </div>
          )}
        </div>
      )}

      {currentTab === "creation" && (
        <div>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 16px" }}>
              <span className="material-symbols" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>auto_awesome</span>
              Generate Test Cases from BRD
            </h3>

            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>
                  Confluence Page ID / URL
                </label>
                <input
                  className="input"
                  value={confluencePageId}
                  onChange={e => setConfluencePageId(e.target.value)}
                  placeholder="Enter Confluence page ID or URL..."
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>
                  Jira Project
                </label>
                <SearchableSelect
                  value={generationProject}
                  onChange={handleGenerationProjectChange}
                  options={jiraProjects.map((p: JiraProject) => ({ value: p.key, label: `${p.key} - ${p.name}` }))}
                  placeholder="Select target project..."
                />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  className="button primary"
                  onClick={handleGenerate}
                  disabled={generating || !confluencePageId || !generationProject}
                  type="button"
                  style={{ height: 40 }}
                >
                  {generating ? "Generating..." : "Generate"}
                </button>
              </div>
            </div>

            {/* Xray Folder Selection — only shown once a project is selected */}
            {generationProject && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>
                  <span className="material-symbols" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 4 }}>folder</span>
                  Xray Test Repository Folder
                  <span style={{ fontWeight: 400, marginLeft: 6, color: "var(--on-surface-variant)" }}>(opsional — test case akan diletakkan di folder ini)</span>
                  {xrayFoldersLoading && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: "var(--primary)" }}>Loading folders...</span>
                  )}
                </label>
                {xrayFolders.length > 0 ? (
                  <SearchableSelect
                    value={selectedFolder}
                    onChange={setSelectedFolder}
                    options={[{ value: "", label: "— Tidak ada folder (root) —" }, ...xrayFolders]}
                    placeholder="Pilih folder Xray..."
                  />
                ) : (
                  !xrayFoldersLoading && (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--on-surface-variant)" }}>
                      Tidak ada folder ditemukan pada Xray Test Repository project ini. Test case akan dibuat di root.
                    </p>
                  )
                )}
              </div>
            )}

            {generating && (
              <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--secondary)" }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "var(--secondary-container)" }}>
                  <span className="material-symbols rotating" style={{ color: "var(--secondary)", flexShrink: 0 }}>sync</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {chunkProgress ? (
                      <>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
                          Menganalisa fitur {chunkProgress.done}/{chunkProgress.total}...
                        </p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {chunkProgress.currentFeature}
                        </p>
                      </>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13 }}>Membaca halaman Confluence dan mengidentifikasi fitur...</p>
                    )}
                  </div>
                  {chunkProgress && (
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--secondary)", flexShrink: 0 }}>
                      {Math.round((chunkProgress.done / chunkProgress.total) * 100)}%
                    </span>
                  )}
                </div>
                {/* Progress bar */}
                {chunkProgress && (
                  <div style={{ height: 4, background: "var(--surface-container-high)" }}>
                    <div style={{
                      height: "100%",
                      width: `${(chunkProgress.done / chunkProgress.total) * 100}%`,
                      background: "var(--secondary)",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {generationResult && !generationResult.success && (
            <div className="card" style={{ padding: 20, background: "var(--error-container)", color: "var(--on-error-container)" }}>
              <strong>Generation failed:</strong> {generationResult.error}
            </div>
          )}

          {/* Live cards during generation — show as soon as first chunk arrives */}
          {generating && testCases.length > 0 && (
            <div className="card" style={{ padding: 20, opacity: 0.92 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h4 style={{ margin: 0, color: "var(--on-surface-variant)" }}>
                  <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>hourglass_top</span>
                  Test case masuk secara bertahap — {testCases.length} test case sejauh ini...
                </h4>
              </div>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "28px 1fr auto auto auto auto auto", gap: 12, padding: "4px 14px 6px", marginBottom: 2 }}>
                {["#", "Name", "Feature", "Type", "Execution", "Sync", ""].map((h, i) => (
                  <span key={i} style={{ fontSize: 10, fontWeight: 700, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</span>
                ))}
              </div>
              <div>
                {testCases.map((tc, i) => (
                  <TestCaseCard
                    key={tc.id}
                    tc={tc}
                    index={i}
                    onUpdate={handleUpdateTestCase}
                    onDelete={handleDeleteTestCase}
                    onChange={updateField}
                  />
                ))}
              </div>
            </div>
          )}

          {generationResult && generationResult.success && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <h4 style={{ margin: "0 0 4px" }}>
                    <span className="material-symbols" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 6 }}>check_circle</span>
                    Generated Test Cases for: <strong>{generationResult.featureName}</strong>
                    <span style={{ marginLeft: 8, fontSize: 13, color: "var(--on-surface-variant)" }}>
                      ({testCases.length} cases)
                    </span>
                  </h4>
                  {selectedFolder && (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--on-surface-variant)" }}>
                      <span className="material-symbols" style={{ fontSize: 13, verticalAlign: "middle", marginRight: 3 }}>folder</span>
                      Folder: <strong>{selectedFolder}</strong>
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    className="button secondary"
                    onClick={handleSyncToJira}
                    disabled={syncing || testCases.length === 0 || !generatedTestExecId}
                    type="button"
                    title={!generatedTestExecId ? "Generate test cases first" : syncing ? "Syncing..." : "Upload all test cases to Jira Xray"}
                  >
                    <span className="material-symbols" style={{ fontSize: 15, verticalAlign: "middle", marginRight: 4 }}>
                      {syncing ? "sync" : "cloud_upload"}
                    </span>
                    {syncing ? "Syncing..." : "Sync to Jira"}
                  </button>
                </div>
              </div>

              {syncing && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--secondary-container)", borderRadius: 8, marginBottom: 12 }}>
                  <span className="material-symbols rotating" style={{ color: "var(--secondary)", fontSize: 20 }}>sync</span>
                  <span style={{ fontSize: 13 }}>
                    Sedang upload test cases ke Jira... Lihat terminal untuk progress detail.
                  </span>
                </div>
              )}

              {syncResult && !syncing && (
                <div style={{ marginBottom: 12 }}>
                  {/* Summary row */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: syncResult.errors.length > 0 ? "8px 8px 0 0" : 8,
                    background: syncResult.failed === 0 ? "var(--tertiary-container)" : syncResult.success > 0 ? "#fff3cd" : "var(--error-container)",
                    color: syncResult.failed === 0 ? "var(--on-tertiary-container)" : syncResult.success > 0 ? "#856404" : "var(--on-error-container)",
                  }}>
                    <span className="material-symbols" style={{ fontSize: 20 }}>
                      {syncResult.failed === 0 ? "check_circle" : syncResult.success > 0 ? "warning" : "error"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <strong>
                        {syncResult.failed === 0
                          ? `Berhasil! ${syncResult.success} test case berhasil diupload ke Jira.`
                          : `${syncResult.success} berhasil, ${syncResult.failed} gagal.`}
                      </strong>
                    </div>
                  </div>

                  {/* Per-case error list */}
                  {syncResult.errors.length > 0 && (
                    <div style={{
                      padding: "10px 14px", borderRadius: "0 0 8px 8px",
                      background: "var(--error-container)", color: "var(--on-error-container)",
                      borderTop: "1px solid rgba(0,0,0,0.08)",
                    }}>
                      <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Detail Error
                      </p>
                      <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 4 }}>
                        {syncResult.errors.map((e: string, i: number) => (
                          <li key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Column header labels */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr auto auto auto auto auto",
                gap: 12,
                padding: "4px 14px 6px",
                marginBottom: 2,
              }}>
                {["#", "Name", "Feature", "Type", "Execution", "Sync", ""].map((h, i) => (
                  <span key={i} style={{ fontSize: 10, fontWeight: 700, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</span>
                ))}
              </div>

              {/* Cards */}
              <div>
                {testCases.map((tc, i) => (
                  <TestCaseCard
                    key={tc.id}
                    tc={tc}
                    index={i}
                    onUpdate={handleUpdateTestCase}
                    onDelete={handleDeleteTestCase}
                    onChange={updateField}
                  />
                ))}
              </div>
            </div>
          )}

          {!generationResult && !generating && (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--on-surface-variant)" }}>
              <span className="material-symbols" style={{ fontSize: 40, display: "block", marginBottom: 12, opacity: 0.4 }}>auto_awesome</span>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Masukkan Confluence Page ID yang berisi BRD</p>
              <p style={{ margin: 0, fontSize: 13 }}>
                AI akan membaca section <strong>2.1 Proses Bisnis</strong> dan menggenerate test case
                untuk setiap fitur pada tabel <strong>2.1.3 Fungsi-Fungsi yang Diharapkan</strong>.
                Test case akan muncul secara bertahap per fitur.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
