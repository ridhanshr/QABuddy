import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import { useApp } from "../context/AppContext";
import SearchableSelect from "../components/SearchableSelect";
import type { BRDTestCase, BRDGenerationResult, SemanticSearchResult, XrayFolder } from "@shared/types";

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
  const { testRepositoryProjects, config, jiraDisplayName } = useApp();

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

  // ── Reuse Test Case ──
  const [selectedResultKeys, setSelectedResultKeys] = useState<Set<string>>(new Set());
  const [showReuseModal, setShowReuseModal] = useState(false);

  // UQA projects from DB (filtered by logged-in user)
  const [reuseUqaProjects, setReuseUqaProjects] = useState<{ value: string; label: string; projectCode: string }[]>([]);
  const [reuseUqaLoading, setReuseUqaLoading] = useState(false);
  const [reuseUqaKey, setReuseUqaKey] = useState(""); // selected uqa_key
  const [reuseProjectCode, setReuseProjectCode] = useState(""); // e.g. "OCEPBCMLS"

  // TEs from DB filtered by project code prefix
  const [reuseTeList, setReuseTeList] = useState<{ value: string; label: string }[]>([]);
  const [reuseTeLoading, setReuseTeLoading] = useState(false);
  const [reuseTeKey, setReuseTeKey] = useState("");

  const [reuseLoading, setReuseLoading] = useState(false);
  const [reuseResult, setReuseResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const EXCLUDED_PROJECT_KEYWORDS = ["ncm ops", "ecm", "support"];

  const fetchReuseUqaProjects = useCallback(async () => {
    setReuseUqaLoading(true);
    setReuseUqaProjects([]);
    try {
      const all = await window.qaBuddy.getMyUqaProjects(config.jira.username, jiraDisplayName);
      const filtered = all.filter((p) => {
        const name = (p.project_name || "").toLowerCase();
        return !EXCLUDED_PROJECT_KEYWORDS.some((kw) => name.includes(kw));
      });
      // Parse: uqa_key = "UQA26-1234", project_name = "QCM - POTDYDSPRD - Priority 2 ..."
      // project_code = part after first " - " (e.g. "POTDYDSPRD")
      // display label = part after second " - " (e.g. "Priority 2 ...")
      const options = filtered.map((p) => {
        const parts = (p.project_name || "").split(" - ");
        const projectCode = parts[1]?.trim() || "";
        const projectDesc = parts.slice(2).join(" - ").trim() || parts[1]?.trim() || p.project_name || "";
        return {
          value: p.uqa_key,
          label: `${p.uqa_key} · ${projectCode} — ${projectDesc}`,
          projectCode,
        };
      });
      setReuseUqaProjects(options);
    } catch {
      setReuseUqaProjects([]);
    } finally {
      setReuseUqaLoading(false);
    }
  }, [config.jira.username, jiraDisplayName]);

  const handleReuseUqaChange = useCallback(async (uqaKey: string) => {
    setReuseUqaKey(uqaKey);
    setReuseTeKey("");
    setReuseTeList([]);
    const found = reuseUqaProjects.find((p) => p.value === uqaKey);
    const code = found?.projectCode || "";
    setReuseProjectCode(code);
    if (!code) return;
    setReuseTeLoading(true);
    try {
      const tes = await window.qaBuddy.getTeByProjectPrefix(code);
      setReuseTeList(tes.map((te) => ({
        value: te.te_jira_key,
        label: `${te.te_jira_key}${te.title ? ` — ${te.title}` : ""}`,
      })));
    } catch {
      setReuseTeList([]);
    } finally {
      setReuseTeLoading(false);
    }
  }, [reuseUqaProjects]);

  const handleReuseSubmit = useCallback(async () => {
    if (!reuseUqaKey || !reuseTeKey || selectedResultKeys.size === 0) return;
    setReuseLoading(true);
    setReuseResult(null);
    try {
      const keys = Array.from(selectedResultKeys);
      // 1. Add TCs to TE in Jira (Xray API)
      await window.qaBuddy.addTestsToExecution(reuseTeKey, keys);
      // 2. Fetch TC titles from Jira for DB enrichment
      const titleMap = await window.qaBuddy.getTestCaseTitles(keys).catch(() => ({} as Record<string, string>));
      // 3. Save to DB with title and id_jira_repo (prefix before last '-')
      await window.qaBuddy.saveTestCases(keys.map((k) => ({
        tc_key: k,
        te_jira_key: reuseTeKey,
        title: titleMap[k] || undefined,
        id_jira_repo: k.includes("-") ? k.substring(0, k.lastIndexOf("-")) : undefined,
      })));
      setReuseResult({ ok: true, msg: `${keys.length} test case berhasil ditambahkan ke ${reuseTeKey}` });
    } catch (e: any) {
      setReuseResult({ ok: false, msg: e?.message || String(e) });
    } finally {
      setReuseLoading(false);
    }
  }, [reuseUqaKey, reuseTeKey, selectedResultKeys]);

  const toggleResultKey = useCallback((key: string) => {
    setSelectedResultKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // clear selection when results change
  useEffect(() => { setSelectedResultKeys(new Set()); }, [searchResults]);

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

  // ── Bitbucket Creation Mode State ──
  const [creationMode, setCreationMode] = useState<"brd" | "bitbucket">("brd");
  const [bitbucketPrUrl, setBitbucketPrUrl] = useState("");
  const [bitbucketLoading, setBitbucketLoading] = useState(false);
  const [bitbucketGenerating, setBitbucketGenerating] = useState(false);
  const [bitbucketSummary, setBitbucketSummary] = useState<import("@shared/types").BitbucketDiffSummary | null>(null);
  const [bitbucketGenerateResult, setBitbucketGenerateResult] = useState<import("@shared/types").BitbucketGenerateResponse | null>(null);
  const [bitbucketError, setBitbucketError] = useState("");
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [filterRisk, setFilterRisk] = useState<string>("All");

  const handleFetchBitbucketPr = useCallback(async () => {
    if (!bitbucketPrUrl.trim()) return;
    setBitbucketLoading(true);
    setBitbucketError("");
    setBitbucketSummary(null);
    setBitbucketGenerateResult(null);
    try {
      const summary = await window.qaBuddy.getBitbucketPrDetails(bitbucketPrUrl);
      setBitbucketSummary(summary);
    } catch (e: any) {
      setBitbucketError(e?.message || String(e));
    } finally {
      setBitbucketLoading(false);
    }
  }, [bitbucketPrUrl]);

  const handleGenerateBitbucketScenarios = useCallback(async (forceRefresh = false) => {
    if (!bitbucketPrUrl.trim()) return;
    setBitbucketGenerating(true);
    setBitbucketError("");
    try {
      const res = await window.qaBuddy.generateTestScenariosFromBitbucket({
        prUrlOrId: bitbucketPrUrl,
        selectedFiles: bitbucketSummary ? bitbucketSummary.files.map(f => f.path) : [],
        forceRefreshCache: forceRefresh,
      });
      setBitbucketGenerateResult(res);
    } catch (e: any) {
      setBitbucketError(e?.message || String(e));
    } finally {
      setBitbucketGenerating(false);
    }
  }, [bitbucketPrUrl, bitbucketSummary]);

  // ── Xray Folder Selection ──
  const [xrayFolders, setXrayFolders] = useState<{ label: string; value: string }[]>([]);
  const [xrayFoldersLoading, setXrayFoldersLoading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState("");

  const doJiraSearch = useCallback(async (project: string, keyword: string, forceRefresh = false) => {
    const cacheKey = `${project}::${keyword}`;
    const now = Date.now();
    const cached = searchCache.current.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL && !forceRefresh) {
      return cached.data;
    }
    // Search directly on Jira — keyword goes into JQL so results are not capped by a local limit
    const keywordClause = keyword
      ? ` AND summary ~ "${keyword.replace(/"/g, '\\"')}"`
      : "";
    const jql = `project = "${project}" AND issuetype = "Test"${keywordClause} ORDER BY updated DESC`;
    const results = await window.qaBuddy.findIssuesByJql(jql, 200);
    searchCache.current.set(cacheKey, { data: results, ts: now });
    return results;
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
                options={testRepositoryProjects.map((p) => ({ value: p.key, label: `${p.key} - ${p.name}` }))}
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
                <button className="button primary" onClick={() => handleSearch()} disabled={searchLoading || !semanticQuery.trim()} type="button">
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
              {/* Toolbar: count + reuse action */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0 8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <h4 style={{ margin: 0 }}>Results ({searchResults.length})</h4>
                  {selectedResultKeys.size > 0 && (
                    <span style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>
                      {selectedResultKeys.size} dipilih
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {selectedResultKeys.size > 0 && (
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => { setReuseResult(null); setReuseUqaKey(""); setReuseTeKey(""); setReuseTeList([]); setShowReuseModal(true); void fetchReuseUqaProjects(); }}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontSize: 13 }}
                    >
                      <span className="material-symbols" style={{ fontSize: 16 }}>recycling</span>
                      Reuse Test Case ({selectedResultKeys.size})
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setSelectedResultKeys(prev => prev.size === searchResults.length ? new Set() : new Set(searchResults.map((r: any) => r.key || r.issueKey)))}
                    style={{ fontSize: 12, padding: "5px 10px" }}
                  >
                    {selectedResultKeys.size === searchResults.length ? "Deselect All" : "Select All"}
                  </button>
                </div>
              </div>

              <div className="table-wrapper" style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--surface-container-high)" }}>
                      <th style={{ padding: "8px 12px", width: 36 }} />
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
                    {searchResults.map((r: any, i: number) => {
                      const rowKey = r.key || r.issueKey || String(i);
                      const isSelected = selectedResultKeys.has(rowKey);
                      return (
                        <tr
                          key={rowKey}
                          style={{
                            borderBottom: "1px solid var(--surface-container-high)",
                            background: isSelected ? "color-mix(in srgb, var(--primary) 6%, transparent)" : "transparent",
                            cursor: "pointer",
                          }}
                          onClick={() => toggleResultKey(rowKey)}
                        >
                          <td style={{ padding: "8px 12px" }} onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleResultKey(rowKey)}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td style={{ padding: "8px 12px" }} onClick={e => e.stopPropagation()}>
                            <a
                              href="#"
                              onClick={(e) => { e.preventDefault(); window.qaBuddy.openExternal(r.url).catch(() => {}); }}
                              style={{ fontWeight: 600, color: "var(--primary)", textDecoration: "none", cursor: "pointer" }}
                              title={`Open ${rowKey} in Jira`}
                            >
                              {rowKey}
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
                      );
                    })}
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
          {/* Sub-tab mode selector */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className={`button ${creationMode === "brd" ? "primary" : "secondary"}`}
              onClick={() => setCreationMode("brd")}
              style={{ fontSize: 13, padding: "8px 16px", borderRadius: 20 }}
            >
              <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>description</span>
              Confluence BRD Generator
            </button>
            <button
              type="button"
              className={`button ${creationMode === "bitbucket" ? "primary" : "secondary"}`}
              onClick={() => setCreationMode("bitbucket")}
              style={{ fontSize: 13, padding: "8px 16px", borderRadius: 20 }}
            >
              <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>code</span>
              Bitbucket Code Diff Generator (AI SLM)
            </button>
          </div>

          {creationMode === "bitbucket" ? (
            <div className="card" style={{ padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="material-symbols" style={{ fontSize: 20, color: "var(--primary)" }}>code_blocks</span>
                  Generate Test Scenarios from Bitbucket Code Diff
                </h3>
                <span className="badge" style={{ background: "rgba(37, 99, 235, 0.1)", color: "var(--primary)", border: "1px solid currentColor", padding: "4px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                  Lightweight SLM Pipeline
                </span>
              </div>

              <p style={{ fontSize: 13, color: "var(--on-surface-variant)", marginTop: 0, marginBottom: 16 }}>
                Masukkan URL PR Bitbucket Server / Data Center internal. QA Buddy akan menganalisis <strong>Change Impact</strong>, mengekstrak <strong>Jira Acceptance Criteria</strong>, memfilter <strong>Existing Tests (Gap Analysis)</strong>, dan menghasilkan skenario lengkap dengan <strong>Confidence Score</strong>.
              </p>

              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--on-surface-variant)" }}>
                    Bitbucket Pull Request URL / ID
                  </label>
                  <input
                    className="input"
                    value={bitbucketPrUrl}
                    onChange={e => setBitbucketPrUrl(e.target.value)}
                    placeholder="https://bitbucket.internal.company.com/projects/PROJ/repos/repo/pull-requests/42"
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--outline)", background: "var(--surface)", color: "var(--on-surface)" }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                  <button
                    className="button secondary"
                    onClick={handleFetchBitbucketPr}
                    disabled={bitbucketLoading || !bitbucketPrUrl.trim()}
                    type="button"
                    style={{ height: 40 }}
                  >
                    {bitbucketLoading ? "Fetching PR..." : "Fetch PR & Diff"}
                  </button>
                  <button
                    className="button primary"
                    onClick={() => handleGenerateBitbucketScenarios(false)}
                    disabled={bitbucketGenerating || !bitbucketPrUrl.trim()}
                    type="button"
                    style={{ height: 40 }}
                  >
                    {bitbucketGenerating ? "AI Processing..." : "Generate Scenarios"}
                  </button>
                </div>
              </div>

              {bitbucketError && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--error-container)", color: "var(--on-error-container)", marginBottom: 16, fontSize: 13 }}>
                  <span className="material-symbols" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>error</span>
                  {bitbucketError}
                </div>
              )}

              {/* PR Summary Card */}
              {bitbucketSummary && (
                <div style={{ border: "1px solid var(--outline-variant)", borderRadius: 10, padding: 16, background: "var(--surface-container-low)", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>
                        {bitbucketSummary.title}
                      </h4>
                      <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
                        PR #{bitbucketSummary.prId} | Author: <strong>{bitbucketSummary.authorName}</strong> | Branch: <code>{bitbucketSummary.branchFrom}</code> → <code>{bitbucketSummary.branchTo}</code>
                      </span>
                    </div>
                    {bitbucketSummary.jiraTicketKey && (
                      <span className="badge" style={{ background: "var(--primary-container)", color: "var(--on-primary-container)", padding: "4px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
                        Ticket: {bitbucketSummary.jiraTicketKey}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--on-surface-variant)" }}>
                    <div>📁 Modified Files: <strong>{bitbucketSummary.files.length}</strong></div>
                    <div>🔑 Commit: <code>{bitbucketSummary.latestCommitHash.substring(0, 8)}</code></div>
                    {bitbucketSummary.cached && <div>⚡ Cache Key: Matched (PR_ID + CommitHash)</div>}
                  </div>
                </div>
              )}

              {/* Impact & Gap Analysis Section */}
              {bitbucketGenerateResult && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  {/* Impact Analysis Card */}
                  <div style={{ padding: 14, borderRadius: 8, background: "var(--surface-container)", border: "1px solid var(--outline-variant)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <h5 style={{ margin: 0, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="material-symbols" style={{ fontSize: 16, color: "var(--primary)" }}>analytics</span>
                        Change Impact Analysis
                      </h5>
                      <span style={{
                        padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: bitbucketGenerateResult.impact.regressionRiskLevel === "High" ? "var(--error-container)" : "var(--tertiary-container)",
                        color: bitbucketGenerateResult.impact.regressionRiskLevel === "High" ? "var(--on-error-container)" : "var(--on-tertiary-container)"
                      }}>
                        Risk: {bitbucketGenerateResult.impact.regressionRiskLevel}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, margin: "0 0 8px", color: "var(--on-surface-variant)" }}>
                      {bitbucketGenerateResult.impact.summaryNotes}
                    </p>
                    <div style={{ fontSize: 11, color: "var(--on-surface)" }}>
                      <strong>Affected Components:</strong> {bitbucketGenerateResult.impact.affectedComponents.join(", ") || "None"}
                    </div>
                  </div>

                  {/* Gap Analysis Card */}
                  <div style={{ padding: 14, borderRadius: 8, background: "var(--surface-container)", border: "1px solid var(--outline-variant)" }}>
                    <h5 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="material-symbols" style={{ fontSize: 16, color: "var(--tertiary)" }}>checklist</span>
                      Coverage Gap & Duplicate Detection
                    </h5>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--on-surface-variant)" }}>
                      {bitbucketGenerateResult.gap.missingCoverageAreas.slice(0, 3).map((gap, i) => (
                        <li key={i}>{gap}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Scenarios Header & Filter Toolbar */}
              {bitbucketGenerateResult && bitbucketGenerateResult.scenarios.length > 0 && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--outline-variant)" }}>
                    <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                      Generated Scenarios ({bitbucketGenerateResult.scenarios.length})
                    </h4>

                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <label style={{ fontSize: 12, color: "var(--on-surface-variant)", display: "flex", alignItems: "center", gap: 6 }}>
                        Min Confidence:
                        <select
                          value={minConfidence}
                          onChange={e => setMinConfidence(Number(e.target.value))}
                          style={{ padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
                        >
                          <option value={0}>All (0%+)</option>
                          <option value={70}>High Confidence (70%+)</option>
                          <option value={85}>Very High (85%+)</option>
                        </select>
                      </label>

                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => handleGenerateBitbucketScenarios(true)}
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        title="Force re-run AI generation without cache"
                      >
                        <span className="material-symbols" style={{ fontSize: 14, marginRight: 4, verticalAlign: "middle" }}>refresh</span>
                        Force Re-Analyze
                      </button>
                    </div>
                  </div>

                  {/* Scenario Cards */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {bitbucketGenerateResult.scenarios
                      .filter(s => s.confidence >= minConfidence)
                      .map((sc, idx) => (
                        <div key={idx} style={{ border: "1px solid var(--outline-variant)", borderRadius: 10, padding: 14, background: "var(--surface)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontWeight: 700, fontSize: 13, color: "var(--on-surface-variant)" }}>#{idx + 1}</span>
                              <h5 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{sc.scenario}</h5>
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              {/* Confidence Score Badge */}
                              <span style={{
                                padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 800,
                                background: sc.confidence >= 85 ? "rgba(16, 185, 129, 0.15)" : "rgba(234, 179, 8, 0.15)",
                                color: sc.confidence >= 85 ? "#059669" : "#d97706",
                                border: "1px solid currentColor"
                              }}>
                                Confidence: {sc.confidence}%
                              </span>
                              <span className="badge" style={{ background: "var(--surface-container-high)", fontSize: 11 }}>
                                {sc.scenarioType}
                              </span>
                            </div>
                          </div>

                          <div style={{ background: "var(--surface-container-low)", padding: "8px 12px", borderRadius: 6, fontSize: 12, color: "var(--on-surface-variant)", marginBottom: 10, borderLeft: "3px solid var(--primary)" }}>
                            <strong>Reasoning:</strong> {sc.reason}
                          </div>

                          {sc.preconditions.length > 0 && (
                            <div style={{ fontSize: 12, marginBottom: 8, color: "var(--on-surface-variant)" }}>
                              <strong>Preconditions:</strong> {sc.preconditions.join("; ")}
                            </div>
                          )}

                          {sc.steps.length > 0 && (
                            <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 4 }}>
                              <strong>Expected Result:</strong>
                              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                                {sc.steps.map((st, sIdx) => (
                                  <li key={sIdx}>{st.expected}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
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
                  options={testRepositoryProjects.map((p) => ({ value: p.key, label: `${p.key} - ${p.name}` }))}
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
                  <button
                    className="button"
                    onClick={() => {
                      setTestCases([]);
                      setGenerationResult(null);
                      setGeneratedTestExecId("");
                      setConfluencePageId("");
                      setGenerationProject("");
                      setSyncResult(null);
                      setSelectedFolder("");
                      setXrayFolders([]);
                    }}
                    disabled={syncing}
                    type="button"
                    title="Hapus semua test case — import ulang dari file lokal"
                    style={{ color: "var(--error)", borderColor: "var(--error)" }}
                  >
                    <span className="material-symbols" style={{ fontSize: 15, verticalAlign: "middle", marginRight: 4 }}>delete_sweep</span>
                    Clear All
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
              </p>
            </div>
          )}
            </>
          )}
        </div>
      )}

      {/* ── Reuse Test Case Modal ── */}
      {showReuseModal && ReactDOM.createPortal(
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 1000,
          }}
          onClick={() => { if (!reuseLoading) setShowReuseModal(false); }}
        >
          <div
            className="card"
            style={{ maxWidth: 520, width: "90%", padding: 32 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols" style={{ fontSize: 20, color: "var(--primary)" }}>recycling</span>
                Reuse Test Case
              </h3>
              <button
                type="button"
                onClick={() => setShowReuseModal(false)}
                disabled={reuseLoading}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)", padding: 4 }}
              >
                <span className="material-symbols" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>

            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--on-surface-variant)", lineHeight: 1.6 }}>
              <strong>{selectedResultKeys.size}</strong> test case akan ditambahkan ke Test Execution yang Anda pilih.
            </p>

            {/* Selected keys preview */}
            <div style={{
              fontSize: 12, fontFamily: "monospace", color: "var(--primary)",
              background: "color-mix(in srgb, var(--primary) 6%, transparent)",
              borderRadius: 6, padding: "8px 12px", marginBottom: 20,
              maxHeight: 72, overflowY: "auto", lineHeight: 1.8,
            }}>
              {Array.from(selectedResultKeys).join(", ")}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* UQA Project dropdown */}
              <div className="field-group">
                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  UQA Project <span style={{ color: "var(--error)" }}>*</span>
                  {reuseUqaLoading && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: "var(--on-surface-variant)" }}>Memuat...</span>
                  )}
                </label>
                <SearchableSelect
                  options={reuseUqaProjects}
                  value={reuseUqaKey}
                  onChange={handleReuseUqaChange}
                  placeholder={reuseUqaLoading ? "Memuat project..." : reuseUqaProjects.length === 0 ? "Tidak ada project" : "-- Pilih UQA Project --"}
                  disabled={reuseLoading || reuseUqaLoading}
                />
              </div>

              {/* TE dropdown */}
              <div className="field-group">
                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "block" }}>
                  Test Execution <span style={{ color: "var(--error)" }}>*</span>
                  {reuseTeLoading && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: "var(--on-surface-variant)" }}>Memuat...</span>
                  )}
                </label>
                <SearchableSelect
                  options={reuseTeList}
                  value={reuseTeKey}
                  onChange={setReuseTeKey}
                  placeholder={!reuseUqaKey ? "-- Pilih UQA Project dulu --" : reuseTeLoading ? "Memuat TE..." : reuseTeList.length === 0 ? "Tidak ada Test Execution" : "-- Pilih Test Execution --"}
                  disabled={reuseLoading || !reuseUqaKey || reuseTeLoading || reuseTeList.length === 0}
                />
              </div>
            </div>

            {reuseResult && (
              <div style={{
                marginTop: 16, padding: "10px 14px", borderRadius: 8, fontSize: 13,
                background: reuseResult.ok ? "var(--tertiary-container)" : "var(--error-container)",
                color: reuseResult.ok ? "var(--on-tertiary-container)" : "var(--on-error-container)",
                display: "flex", alignItems: "flex-start", gap: 8,
              }}>
                <span className="material-symbols" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                  {reuseResult.ok ? "check_circle" : "error"}
                </span>
                {reuseResult.msg}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowReuseModal(false)}
                disabled={reuseLoading}
                style={{ padding: "8px 18px", fontSize: 14 }}
              >
                {reuseResult?.ok ? "Tutup" : "Batal"}
              </button>
              {!reuseResult?.ok && (
                <button
                  type="button"
                  className="button primary"
                  onClick={handleReuseSubmit}
                  disabled={reuseLoading || !reuseUqaKey || !reuseTeKey}
                  style={{ padding: "8px 20px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}
                >
                  {reuseLoading
                    ? <><span className="material-symbols" style={{ fontSize: 16, animation: "spin 1s linear infinite" }}>sync</span>Memproses...</>
                    : <><span className="material-symbols" style={{ fontSize: 16 }}>add_task</span>Reuse</>
                  }
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
