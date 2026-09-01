import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppBootstrap,
  AppConfig,
  BulkOperationResult,
  ChatResponse,
  ConfluenceParseProgress,
  ConfluenceSyncProgress,
  ConfluenceTestImportEntry,
  ConnectionStatus,
  ConnectionStatusItem,
  DashboardProjectConfig,
  ParseConfluenceParseDebugReport,
  ParseConfluenceEntriesResult,
  DashboardDigest,
  ExtractedTestCase,
  ExtractionDepth,
  FetchTestStepsResult,
  JiraBoard,
  JiraIssueSummary,
  JiraProject,
  JiraSprint,
  JiraStatus,
  ManualTestCase,
  RagIndexProgress,
  RagStats,
  UqaSyncProgress,
  StepConflictMode,
  TestCaseExecution,
  UpdateProgress,
  UpdateInfo,
  UpdateTestCasesFromConfluenceResult,
  ViewKey,
  ChatHistoryMessage,
  XrayFolder,
  UqaIssue,
  BRDTestCase,
  BRDGenerationResult,
  BrdChunkProgress,
} from "@shared/types";
import { defaultConfig } from "@shared/types";

import jiraIcon from "../assets/jira.png";
import confluenceIcon from "../assets/confluence.png";
import ollamaIcon from "../assets/ollama.png";

const loadXlsx = () => import("xlsx");

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  sentText?: string;
  response?: ChatResponse;
  attachments?: string[];
};

export type LogEntry = {
  id: string;
  time: string;
  source: "Sync to Confluence" | "Submit to Jira" | "Xray Organizer" | "Advanced Jira Organizer" | "Update from Confluence" | "Defect Repository";
  status: "success" | "error" | "info";
  message: string;
  detail?: string;
  debug?: ParseConfluenceParseDebugReport;
};

export type ConfAttachment = {
  id: string;
  name: string;
  data: string;
  order: number;
  note?: string;
  expandGroup?: string;
};

export type HealthcheckResult = {
  jira: { ok: boolean; message: string; projectKey?: string; issueCount?: number };
  confluence: { ok: boolean; message: string; spaceKey?: string };
  ollama: { ok: boolean; message: string; model?: string; responseTimeMs?: number };
  rag: { ok: boolean; totalChunks: number; confluencePages: number; jiraIssues: number };
  config: { ok: boolean; issues: string[] };
};

export type ExecutionStats = {
  totalExecutions: number;
  totalPassed: number;
  totalFailed: number;
  passRate: number;
};

export type BannerState = {
  tone: "info" | "success" | "error";
  text: string;
};

export type ExtractStatus = "idle" | "loading" | "success" | "fallback" | "empty" | "error";

export type ExtractMeta = {
  title: string;
  sourceUrl: string;
  status: ExtractStatus;
  count: number;
  isFallback?: boolean;
};

const emptyStatus: ConnectionStatus = {
  jira: { ok: false, message: "Belum diuji" },
  confluence: { ok: false, message: "Belum diuji" },
  ollama: { ok: false, message: "Belum diuji" },
};

function createEmptyConfEntry(isDirty = true, section = "") {
  return {
    id: crypto.randomUUID(),
    section,
    testCaseNo: "",
    functionName: "",
    scenario: "",
    category: "TC_HAPPY",
    inputData: "",
    steps: "",
    expectedResult: "",
    result: "PASS",
    images: [] as ConfAttachment[],
    issueKey: "",
    isDirty,
  };
}

function normalizeConfAttachments(attachments: ConfAttachment[], sortByOrder = false): ConfAttachment[] {
  const arr = [...attachments];
  if (sortByOrder) {
    arr.sort((a, b) => a.order - b.order);
  }
  return arr.map((attachment, index) => ({
    ...attachment,
    order: index + 1,
  }));
}

function createConfAttachment(name: string, data: string, order: number): ConfAttachment {
  return {
    id: crypto.randomUUID(),
    name,
    data,
    order,
    note: "",
  };
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function findBestMatch(scenario: string, issues: JiraIssueSummary[]): JiraIssueSummary | null {
  if (!scenario || issues.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "");
  const normScenario = norm(scenario);

  const exact = issues.find(i => norm(i.summary) === normScenario);
  if (exact) return exact;

  const contains = issues.find(i =>
    normScenario.includes(norm(i.summary)) || norm(i.summary).includes(normScenario)
  );
  if (contains) return contains;

  const stopWords = new Set(["the","and","for","with","from","this","that","are","was","been","have","has","had","not","but","can","all","each","its","than","then","they","will","into","more","some","such","also","should","would","could"]);
  const scenarioWords = normScenario.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
  if (scenarioWords.length === 0) {
    scenarioWords.push(...normScenario.split(/\s+/).filter(w => w.length > 1));
  }
  const scenarioWordSet = new Set(scenarioWords);

  let bestScore = 0;
  let bestMatch: JiraIssueSummary | null = null;
  for (const issue of issues) {
    const summaryWords = new Set(norm(issue.summary).split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w)));
    let overlap = 0;
    for (const word of scenarioWordSet) {
      if (summaryWords.has(word)) overlap++;
    }
    const total = Math.max(scenarioWordSet.size, summaryWords.size);
    const score = total > 0 ? overlap / total : 0;
    if (score > bestScore && score >= 0.25) {
      bestScore = score;
      bestMatch = issue;
    }
  }
  return bestMatch;
}

export function useAppState(loggedInUser: string = "", jiraToken: string = "", confToken: string = "") {
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [settingsTab, setSettingsTab] = useState<"general" | "knowledge-base" | "updates">("general");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [showDetailedProgress, setShowDetailedProgress] = useState(true);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [status, setStatus] = useState<ConnectionStatus>(emptyStatus);
  const [dashboard, setDashboard] = useState<DashboardDigest | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [saveAllLoading, setSaveAllLoading] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Tanya apa saja tentang Jira atau Confluence. Saya akan bantu buat JQL, ringkasan dokumentasi, atau daftar issue yang relevan.",
    },
  ]);
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [extractUrl, setExtractUrl] = useState("");
  const [extractDepth, setExtractDepth] = useState<ExtractionDepth>("comprehensive");
  const [extractedCases, setExtractedCases] = useState<ExtractedTestCase[]>([]);
  const [extractMeta, setExtractMeta] = useState<ExtractMeta | null>(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [healthcheckLoading, setHealthcheckLoading] = useState(false);
  const [healthcheckResult, setHealthcheckResult] = useState<HealthcheckResult | null>(null);
  const [executionStats, setExecutionStats] = useState<ExecutionStats | null>(null);
  const [executionHistory, setExecutionHistory] = useState<TestCaseExecution[]>([]);
  const [executionLoading, setExecutionLoading] = useState(false);
  const [executionForm, setExecutionForm] = useState({
    testCaseId: "",
    testCaseTitle: "",
    result: "PASS" as "PASS" | "FAILED",
    executedBy: "",
    sprint: "",
    notes: "",
    linkedIssueKey: "",
  });
  const [showJiraToken, setShowJiraToken] = useState(false);
  const [showConfluenceToken, setShowConfluenceToken] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [chatAttachments, setChatAttachments] = useState<{ name: string; text: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);
  const [progressHidden, setProgressHidden] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [manualTab, setManualTab] = useState<"creator" | "generate-with-ai" | "organizer" | "update-from-conf" | "extractor" | "search" | "monitoring">("creator");
  const [jiraDisplayName, setJiraDisplayName] = useState<string>("");
  const [manualCases, setManualCases] = useState<ManualTestCase[]>([
    { id: crypto.randomUUID(), title: "", description: "", steps: "", expectedResult: "", xrayFolder: "", labels: "", testExecutionKey: "" }
  ]);
  const [organizeSource, setOrganizeSource] = useState("");
  const [organizeFolder, setOrganizeFolder] = useState("");
  const [organizeProjectKey, setOrganizeProjectKey] = useState("");
  const [organizeXrayFolders, setOrganizeXrayFolders] = useState<XrayFolder[]>([]);
  const [organizeFolderLoading, setOrganizeFolderLoading] = useState(false);
  const [manualProjectKey, setManualProjectKey] = useState("");
  const [manualXrayFolders, setManualXrayFolders] = useState<XrayFolder[]>([]);
  const [manualFolderLoading, setManualFolderLoading] = useState(false);
  const [manualDuplicateResults, setManualDuplicateResults] = useState<Record<string, { matches: { key: string; summary: string; score: number }[]; checked: boolean }>>({});
  const [manualPendingDuplicates, setManualPendingDuplicates] = useState<Record<string, { key: string; summary: string; score: number }[]> | null>(null);
  const [showManualDuplicateModal, setShowManualDuplicateModal] = useState(false);
  const [showDashboardConfig, setShowDashboardConfig] = useState(false);
  const [dashboardProjects, setDashboardProjects] = useState<DashboardProjectConfig[]>([]);

  // Update from Confluence state
  const [confImportMode, setConfImportMode] = useState<"auto" | "jql-match" | "xray-folder">("auto");
  const [confImportUrl, setConfImportUrl] = useState("");
  const [confImportJql, setConfImportJql] = useState("");
  const [confImportEntries, setConfImportEntries] = useState<ConfluenceTestImportEntry[]>([]);
  const [confImportLoading, setConfImportLoading] = useState(false);
  const [confImportResult, setConfImportResult] = useState<UpdateTestCasesFromConfluenceResult | null>(null);
  const [confImportJqlMatched, setConfImportJqlMatched] = useState(false);
  const [confImportJqlMatchedIds, setConfImportJqlMatchedIds] = useState<Set<string>>(new Set());
  const [confImportProjectKey, setConfImportProjectKey] = useState("");
  const [confImportXrayFolders, setConfImportXrayFolders] = useState<XrayFolder[]>([]);
  const [confImportFolderLoading, setConfImportFolderLoading] = useState(false);
  const [confImportFetchingSteps, setConfImportFetchingSteps] = useState<Set<string>>(new Set());
  const [confImportSelectedFolder, setConfImportSelectedFolder] = useState("");
  const [stepConflictCheck, setStepConflictCheck] = useState<{ hasSteps: string[]; noSteps: string[] } | null>(null);
  const [stepConflictMode, setStepConflictMode] = useState<StepConflictMode>("replace");
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [showUpdateProgress, setShowUpdateProgress] = useState(false);

  // Test Repository projects fetched from DB (used for project dropdowns in Test Case Management)
  const [testRepositoryProjects, setTestRepositoryProjects] = useState<{ key: string; name: string }[]>([]);

  // Advanced Jira Organizer state
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [jiraBoards, setJiraBoards] = useState<JiraBoard[]>([]);
  const [jiraSprints, setJiraSprints] = useState<JiraSprint[]>([]);
  const [jiraStatuses, setJiraStatuses] = useState<JiraStatus[]>([]);
  const [jiraIssueTypes, setJiraIssueTypes] = useState<string[]>([]);
  const [jiraCustomFields, setJiraCustomFields] = useState<{ id: string; name: string; type: string; isCustom: boolean }[]>([]);
  // Cache Jira metadata in sessionStorage so it survives login/logout within
  // the same app session. TTL: 30 minutes.
  const JIRA_CACHE_KEY = "qa-buddy-jira-meta-cache";
  const JIRA_CACHE_TTL = 30 * 60 * 1000;

  const readJiraCache = (): { projects: JiraProject[]; statuses: JiraStatus[]; issueTypes: string[]; customFields: { id: string; name: string; type: string; isCustom: boolean }[] } | null => {
    try {
      const raw = sessionStorage.getItem(JIRA_CACHE_KEY);
      if (!raw) return null;
      const { data, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp > JIRA_CACHE_TTL) {
        sessionStorage.removeItem(JIRA_CACHE_KEY);
        return null;
      }
      return data;
    } catch { return null; }
  };

  const writeJiraCache = (data: { projects: JiraProject[]; statuses: JiraStatus[]; issueTypes: string[]; customFields: { id: string; name: string; type: string; isCustom: boolean }[] }) => {
    try {
      sessionStorage.setItem(JIRA_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
    } catch { /* sessionStorage quota — silently ignore */ }
  };

  const _jiraMetaInit = (() => {
    const cached = readJiraCache();
    return cached ? { data: cached, timestamp: Date.now() } : { data: null as null, timestamp: 0 };
  })();
  const jiraMetadataCache = useRef(_jiraMetaInit);

  // localStorage cache for Xray folders (per project key), TTL 30 min — persists across restarts
  const XRAY_FOLDER_CACHE_TTL = 30 * 60 * 1000;
  const xrayFolderCacheKey = (projectKey: string) => `qa-buddy-xray-folders-${projectKey}`;
  const readXrayFolderCache = (projectKey: string): XrayFolder[] | null => {
    try {
      const raw = localStorage.getItem(xrayFolderCacheKey(projectKey));
      if (!raw) return null;
      const { data, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp > XRAY_FOLDER_CACHE_TTL) {
        localStorage.removeItem(xrayFolderCacheKey(projectKey));
        return null;
      }
      return data;
    } catch { return null; }
  };
  const writeXrayFolderCache = (projectKey: string, folders: XrayFolder[]) => {
    try {
      localStorage.setItem(xrayFolderCacheKey(projectKey), JSON.stringify({ data: folders, timestamp: Date.now() }));
    } catch { /* quota — silently ignore */ }
  };
  const clearXrayFolderCache = (projectKey: string) => {
    try { localStorage.removeItem(xrayFolderCacheKey(projectKey)); } catch { /* ignore */ }
  };

  const [jqlProject, setJqlProject] = useState<string[]>([]);
  const [jqlBoard, setJqlBoard] = useState<string[]>([]);
  const [jqlSprint, setJqlSprint] = useState<string[]>([]);
  const [jqlStatus, setJqlStatus] = useState<string[]>([]);
  const [jqlIssueType, setJqlIssueType] = useState<string[]>([]);
  const [jqlAssignee, setJqlAssignee] = useState("");
  const [jqlCustomFieldFilters, setJqlCustomFieldFilters] = useState<{ fieldId: string; operator: "=" | "!=" | "~"; value: string }[]>([
    { fieldId: "", operator: "=", value: "" }
  ]);
  const [jqlLabelFilters, setJqlLabelFilters] = useState<{ operator: "=" | "!="; value: string }[]>([
    { operator: "=", value: "" }
  ]);
  const [jqlKey, setJqlKey] = useState("");
  const [generatedJql, setGeneratedJql] = useState("");
  const [searchResults, setSearchResults] = useState<JiraIssueSummary[]>([]);
  const [selectedIssueKeys, setSelectedIssueKeys] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [resultsPage, setResultsPage] = useState(1);
  const RESULTS_PER_PAGE = 10;
  const [jqlMaxResults, setJqlMaxResults] = useState<number>(200);
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [bulkTransitionId, setBulkTransitionId] = useState("");

  const customFieldOptions = useMemo(
    () =>
      jiraCustomFields
        .filter((field) => field.isCustom)
        .map((field) => ({
          value: field.id,
          label: `${field.name} (${field.id})`,
        })),
    [jiraCustomFields]
  );

  // Knowledge Base (RAG) state
  const [ragStats, setRagStats] = useState<RagStats | null>(null);
  const [ragLoading, setRagLoading] = useState<"confluence" | "jira" | null>(null);
  const [ragProgress, setRagProgress] = useState<RagIndexProgress | null>(null);
  const [ragSyncSpace, setRagSyncSpace] = useState("");
  const [ragSyncProject, setRagSyncProject] = useState("");

  const [confLoading, setConfLoading] = useState(false);
  const [confProgressHidden, setConfProgressHidden] = useState(false);
  // Max width (px) gambar yang diupload ke Confluence. 0 = kirim resolusi asli.
  const confImageWidth = Math.max(0, config.confluence.imageMaxWidth ?? 1920);
  const [confPageLoading, setConfPageLoading] = useState(false);
  const [confAttachmentHydrating, setConfAttachmentHydrating] = useState(false);
  const [confParseStatus, setConfParseStatus] = useState<ParseConfluenceEntriesResult | null>(null);
  const [confParseProgress, setConfParseProgress] = useState<ConfluenceParseProgress | null>(null);
  const [confEntries, setConfEntries] = useState<any[]>([{ ...createEmptyConfEntry(), testCaseNo: "TC001" }]);
  const [confFetchingSteps, setConfFetchingSteps] = useState<Set<string>>(new Set());
  const [confPushingSteps, setConfPushingSteps] = useState<Set<string>>(new Set());
  const [deletedConfTableIndices, setDeletedConfTableIndices] = useState<number[]>([]);
  const [draggedAttachment, setDraggedAttachment] = useState<{ entryId: string; attachmentId: string } | null>(null);
  const confParseProgressClearTimer = useRef<number | null>(null);

  const confSections = useMemo(() => {
    const sections = confEntries.map(e => e.section || "").filter(Boolean);
    return [...new Set(sections)];
  }, [confEntries]);

  const filteredReadyForQa = useMemo(() => {
    if (!dashboard) {
      return [];
    }
    const query = ticketSearch.trim().toLowerCase();
    if (!query) {
      return dashboard.readyForQa;
    }
    return dashboard.readyForQa.filter((issue) =>
      [issue.key, issue.summary, issue.priority, issue.assignee, issue.status]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [dashboard, ticketSearch]);

  // Reset to page 1 when search or data changes
  useEffect(() => {
    setCurrentPage(1);
  }, [ticketSearch, dashboard]);

  const totalPages = Math.max(1, Math.ceil(filteredReadyForQa.length / rowsPerPage));
  const paginatedReadyForQa = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredReadyForQa.slice(start, start + rowsPerPage);
  }, [filteredReadyForQa, currentPage, rowsPerPage]);

  const addLog = useCallback((source: LogEntry["source"], status: LogEntry["status"], message: string, detail?: string, debug?: ParseConfluenceParseDebugReport) => {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      time: new Date().toLocaleString("id-ID"),
      source,
      status,
      message,
      detail,
      debug,
    };
    setLogs((prev) => {
      const updated = [entry, ...prev];
      void window.qaBuddy.saveLogs(updated);
      return updated;
    });
  }, []);

  const recentSummaries = useMemo(() => {
    return chatMessages
      .filter((msg) => msg.role === "assistant" && msg.response?.mode === "confluence" && msg.response.pages && msg.response.pages.length > 0)
      .reverse(); // Show most recent first
  }, [chatMessages]);

  const selectedCaseCount = useMemo(
    () => extractedCases.filter((item) => item.selected).length,
    [extractedCases]
  );

  const pageResults = useMemo(
    () => searchResults.slice((resultsPage - 1) * RESULTS_PER_PAGE, resultsPage * RESULTS_PER_PAGE),
    [searchResults, resultsPage]
  );

  const jqlTotalPages = useMemo(
    () => Math.max(1, Math.ceil(searchResults.length / RESULTS_PER_PAGE)),
    [searchResults.length]
  );

  const applyBootstrap = useCallback((bootstrap: AppBootstrap, dbJiraToken: string, dbConfToken: string) => {
    const cfg: typeof bootstrap.config = {
      ...bootstrap.config,
      jira: {
        ...bootstrap.config.jira,
        username: loggedInUser || bootstrap.config.jira.username,
        // DB token takes priority over file config token
        token: dbJiraToken || bootstrap.config.jira.token,
      },
      confluence: {
        ...bootstrap.config.confluence,
        username: loggedInUser || bootstrap.config.confluence.username,
        token: dbConfToken || bootstrap.config.confluence.token,
      },
    };
    setConfig(cfg);
    setStatus(bootstrap.status);
    setDashboard(bootstrap.dashboard);
    setDashboardProjects(cfg.dashboard?.projects || []);
    setRagSyncSpace(cfg.confluence.spaceKey || "");
    setRagSyncProject(cfg.jira.projectKey || "");
  }, [loggedInUser]);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      // bootstrap() now returns immediately (no network calls) — UI shows instantly
      const [bootstrap, loadedLogs] = await Promise.all([
        window.qaBuddy.bootstrap(),
        window.qaBuddy.getLogs().catch(() => [] as typeof logs),
      ]);
      applyBootstrap(bootstrap, jiraToken, confToken);
      setLogs(loadedLogs || []);

      // All heavy/network work runs in background after UI is already visible
      void window.qaBuddy.getUpdateStatus().catch(() => null).then((info) => {
        if (info) setUpdateInfo(info);
      });
      // Defect data loaded lazily when user opens defect-repository view

      // Build effective config with DB tokens
      const effectiveJiraToken = jiraToken || bootstrap.config.jira.token;
      const effectiveConfToken = confToken || bootstrap.config.confluence.token;
      const cfgWithTokens = {
        ...bootstrap.config,
        jira: {
          ...bootstrap.config.jira,
          username: loggedInUser || bootstrap.config.jira.username,
          token: effectiveJiraToken,
        },
        confluence: {
          ...bootstrap.config.confluence,
          username: loggedInUser || bootstrap.config.confluence.username,
          token: effectiveConfToken,
        },
      };

      // Save config with DB tokens then test connections — all in background
      void window.qaBuddy.saveConfig(cfgWithTokens)
        .then(() => window.qaBuddy.testConnections())
        .then((nextStatus) => setStatus(nextStatus))
        .catch(() => {});

      // Fetch Jira display name in background
      void window.qaBuddy.getCurrentUser()
        .then((user) => setJiraDisplayName((user.displayName as string) || ""))
        .catch(() => {});

      // Preload Jira metadata from cache (instant) or network (background)
      const cachedMeta = readJiraCache();
      if (cachedMeta) {
        jiraMetadataCache.current = { data: cachedMeta, timestamp: Date.now() };
        applyJiraMetadata(cachedMeta);
      } else if (effectiveJiraToken) {
        fetchAndCacheJiraMetadata();
      }
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal memuat bootstrap aplikasi."),
      });
    } finally {
      setLoading(false);
    }
  }, [applyBootstrap, jiraToken, confToken]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    const cleanup = window.qaBuddy.onUpdateStatusPushed((info) => {
      setUpdateInfo(info);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = config.preferences.theme;
    const shouldUseDark = theme === "dark" || (theme === "system" && prefersDark);
    root.classList.toggle("theme-dark", shouldUseDark);
  }, [config.preferences.theme]);

  useEffect(() => {
    if (activeView === "settings") {
      if (typeof window.qaBuddy.getOllamaModels === "function") {
        setModelsLoading(true);
        void window.qaBuddy.getOllamaModels(config.ollama.endpoint)
          .then((models) => {
            setOllamaModels(models);

            // Auto-correct model if the saved value doesn't exist in the fetched list.
            // This prevents a silent mismatch where the dropdown shows one model
            // but the config still holds a stale/non-existent model name.
            if (models.length > 0) {
              const updates: Partial<typeof config.ollama> = {};
              if (!models.includes(config.ollama.model)) {
                updates.model = models[0];
              }
              // Also fix specialized models if they reference a non-existent model
              for (const key of ["jqlModel", "chatModel", "extractionModel", "insightModel", "defectEmbeddingModel"] as const) {
                const val = config.ollama[key];
                if (val && !models.includes(val)) {
                  updates[key] = "";
                }
              }
              if (Object.keys(updates).length > 0) {
                setConfig((prev) => ({
                  ...prev,
                  ollama: { ...prev.ollama, ...updates },
                }));
              }
            }

            setModelsLoading(false);
          })
          .catch(() => {
            setOllamaModels([]);
            setModelsLoading(false);
          });
      }
    }
  }, [activeView, config.ollama.endpoint]);

  const loadRagStats = useCallback(async () => {
    try {
      const stats = await window.qaBuddy.ragGetStats();
      setRagStats(stats);
    } catch {
      // ignore
    }
  }, []);

  // Load RAG stats when viewing knowledge base
  useEffect(() => {
    if (activeView === "settings" && settingsTab === "knowledge-base") {
      void loadRagStats();
    }
  }, [activeView, settingsTab, loadRagStats]);


  const loadExecutionTracking = useCallback(async () => {
    setExecutionLoading(true);
    try {
      const [stats, history] = await Promise.all([
        window.qaBuddy.getExecutionStats().catch(() => null),
        window.qaBuddy.getExecutionHistory().catch(() => []),
      ]);
      if (stats) setExecutionStats(stats);
      setExecutionHistory(history.slice(0, 20));
    } finally {
      setExecutionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === "logs") {
      void loadExecutionTracking();
    }
  }, [activeView, loadExecutionTracking]);

  // Load Jira metadata for all views that need projects/statuses.
  // Uses sessionStorage cache (30-min TTL) so data survives login/logout
  // within the same app session — no re-fetch until cache expires.
  const VIEWS_NEEDING_PROJECTS = new Set([
    "advanced-jira-organizer",
    "manual-test-case",
    "project-management",
    "test-cycle-manager",
    "defect-repository",
  ]);

  const applyJiraMetadata = (data: { projects: JiraProject[]; statuses: JiraStatus[]; issueTypes: string[]; customFields: { id: string; name: string; type: string; isCustom: boolean }[] }) => {
    setJiraProjects(data.projects);
    setJiraStatuses(data.statuses);
    setJiraIssueTypes(data.issueTypes);
    setJiraCustomFields(data.customFields);
  };

  const fetchAndCacheJiraMetadata = () => {
    setFiltersLoading(true);
    Promise.all([
      window.qaBuddy.getJiraProjects().catch(() => [] as JiraProject[]),
      window.qaBuddy.getJiraStatuses().catch(() => [] as JiraStatus[]),
      window.qaBuddy.getJiraIssueTypes().catch(() => [] as string[]),
      window.qaBuddy.getJiraCustomFields().catch(() => [] as { id: string; name: string; type: string; isCustom: boolean }[]),
    ]).then(([projects, statuses, issueTypes, customFields]) => {
      const data = { projects, statuses, issueTypes, customFields };
      jiraMetadataCache.current = { data, timestamp: Date.now() };
      writeJiraCache(data);
      applyJiraMetadata(data);
      setFiltersLoading(false);
    }).catch(() => setFiltersLoading(false));
  };

  useEffect(() => {
    if (!VIEWS_NEEDING_PROJECTS.has(activeView)) return;
    if (!config.jira.baseUrl || !config.jira.token) return;

    const cache = jiraMetadataCache.current;
    if (cache.data && Date.now() - cache.timestamp < JIRA_CACHE_TTL) {
      applyJiraMetadata(cache.data);
      setFiltersLoading(false);
      return;
    }

    fetchAndCacheJiraMetadata();
  }, [activeView, config.jira.baseUrl, config.jira.token]);

  // Fetch test repository projects from DB for views that use the project dropdown
  useEffect(() => {
    if (activeView !== "manual-test-case" && activeView !== "documentation-sync") return;
    window.qaBuddy.getTestRepositoriesInDb()
      .then((repos) => setTestRepositoryProjects(repos.map((r) => ({ key: r.project_key, name: r.project_name }))))
      .catch(() => {});
  }, [activeView]);

  // Load boards when project changes
  useEffect(() => {
    if (jqlProject.length === 0) {
      setJiraBoards([]);
      setJiraSprints([]);
      return;
    }
    setFiltersLoading(true);
    window.qaBuddy.getJiraBoards(jqlProject[0]).then((boards) => {
      setJiraBoards(boards);
      setFiltersLoading(false);
    }).catch(() => {
      setJiraBoards([]);
      setFiltersLoading(false);
    });
  }, [jqlProject]);

  // Load sprints when board changes
  useEffect(() => {
    if (jqlBoard.length === 0) {
      setJiraSprints([]);
      return;
    }
    setFiltersLoading(true);
    window.qaBuddy.getJiraSprints(Number(jqlBoard[0])).then((sprints) => {
      setJiraSprints(sprints);
      setFiltersLoading(false);
    }).catch(() => {
      setJiraSprints([]);
      setFiltersLoading(false);
    });
  }, [jqlBoard]);

  // Build JQL automatically when filters change
  useEffect(() => {
    const parts: string[] = [];
    if (jqlProject.length === 1) parts.push(`project = "${jqlProject[0]}"`);
    else if (jqlProject.length > 1) parts.push(`project in (${jqlProject.map(p => `"${p}"`).join(",")})`);
    if (jqlSprint.length === 1) parts.push(`sprint = ${jqlSprint[0]}`);
    else if (jqlSprint.length > 1) parts.push(`sprint in (${jqlSprint.join(",")})`);
    if (jqlStatus.length === 1) parts.push(`status = "${jqlStatus[0]}"`);
    else if (jqlStatus.length > 1) parts.push(`status in (${jqlStatus.map(s => `"${s}"`).join(",")})`);
    if (jqlIssueType.length === 1) parts.push(`issuetype = "${jqlIssueType[0]}"`);
    else if (jqlIssueType.length > 1) parts.push(`issuetype in (${jqlIssueType.map(t => `"${t}"`).join(",")})`);
    if (jqlAssignee) parts.push(`assignee = "${jqlAssignee}"`);
    for (const filter of jqlCustomFieldFilters) {
      const field = jiraCustomFields.find((item) => item.isCustom && item.id === filter.fieldId);
      if (!field) continue;

      const fieldRef = `cf[${field.id.replace(/^customfield_/i, "")}]`;
      const value = filter.value.trim();
      if (!value) {
        parts.push(`${fieldRef} is not EMPTY`);
      } else if (filter.operator === "~") {
        parts.push(`${fieldRef} ~ "${value.replace(/"/g, '\\"')}"`);
      } else {
        parts.push(`${fieldRef} ${filter.operator} "${value.replace(/"/g, '\\"')}"`);
      }
    }
    
    // Build label query from dynamic filters list
    const includes: string[] = [];
    const excludes: string[] = [];

    for (const filter of jqlLabelFilters) {
      const val = filter.value.trim();
      if (!val) continue;
      if (filter.operator === "=") {
        includes.push(val);
      } else {
        excludes.push(val);
      }
    }

    if (includes.length === 1) {
      parts.push(`labels = "${includes[0]}"`);
    } else if (includes.length > 1) {
      parts.push(`labels in (${includes.map(l => `"${l}"`).join(",")})`);
    }

    if (excludes.length === 1) {
      parts.push(`labels != "${excludes[0]}"`);
    } else if (excludes.length > 1) {
      parts.push(`labels not in (${excludes.map(l => `"${l}"`).join(",")})`);
    }

    if (jqlKey.trim()) {
      const keyArr = jqlKey.split(",").map(k => k.trim()).filter(Boolean);
      if (keyArr.length === 1) {
        parts.push(`key = "${keyArr[0]}"`);
      } else if (keyArr.length > 1) {
        parts.push(`key in (${keyArr.map(k => `"${k}"`).join(",")})`);
      }
    }
    setGeneratedJql(parts.length > 0 ? parts.join(" AND ") : "");
  }, [jqlProject, jqlSprint, jqlStatus, jqlIssueType, jqlAssignee, jqlLabelFilters, jqlKey, jqlCustomFieldFilters, jiraCustomFields]);

  // Listen for RAG progress events
  useEffect(() => {
    const cleanup = window.qaBuddy.onRagProgress((progress) => {
      setRagProgress(progress);
      if (progress.status === "done" || progress.status === "error") {
        setRagLoading(null);
        void loadRagStats();
      }
    });
    return cleanup;
  }, [loadRagStats]);

  useEffect(() => {
    const cleanup = window.qaBuddy.onConfluenceParseProgress((progress) => {
      if (confParseProgressClearTimer.current !== null) {
        window.clearTimeout(confParseProgressClearTimer.current);
        confParseProgressClearTimer.current = null;
      }
      setConfParseProgress(progress);
      if (progress.stage === "done") {
        confParseProgressClearTimer.current = window.setTimeout(() => {
          setConfParseProgress(null);
          confParseProgressClearTimer.current = null;
        }, 1500);
      }
    });
    return () => {
      if (confParseProgressClearTimer.current !== null) {
        window.clearTimeout(confParseProgressClearTimer.current);
      }
      cleanup();
    };
  }, []);

  // ── Confluence Sync Progress (live sidebar during Sync to Confluence) ──
  const [confSyncProgress, setConfSyncProgress] = useState<ConfluenceSyncProgress | null>(null);
  const [confSyncSteps, setConfSyncSteps] = useState<string[]>([]);
  const confSyncProgressClearTimer = useRef<number | null>(null);

  useEffect(() => {
    const cleanup = window.qaBuddy.onConfluenceSyncProgress((progress) => {
      if (confSyncProgressClearTimer.current !== null) {
        window.clearTimeout(confSyncProgressClearTimer.current);
        confSyncProgressClearTimer.current = null;
      }
      setConfSyncProgress(progress);
      if (progress.stage !== "fetch_page" && progress.stage !== "collect") {
        setConfSyncSteps((steps) => [...steps.slice(-49), progress.message]);
      }
      if (progress.stage === "done" || progress.stage === "error") {
        confSyncProgressClearTimer.current = window.setTimeout(() => {
          setConfSyncProgress(null);
          setConfSyncSteps([]);
          confSyncProgressClearTimer.current = null;
        }, 4000);
      }
    });
    return () => {
      if (confSyncProgressClearTimer.current !== null) {
        window.clearTimeout(confSyncProgressClearTimer.current);
      }
      cleanup();
    };
  }, []);

  // ── Defect Repository State ──────────────────────────────────────────
  const [defectSources, setDefectSources] = useState<import("@shared/types").JiraProjectSource[]>([]);
  const [defectSearchQuery, setDefectSearchQuery] = useState("");
  const [defectCandidates, setDefectCandidates] = useState<import("@shared/types").DuplicateCandidate[]>([]);
  const [defectSearchResults, setDefectSearchResults] = useState<import("@shared/types").DefectRecord[]>([]);
  const [defectSearching, setDefectSearching] = useState(false);
  const [defectSyncing, setDefectSyncing] = useState<string | null>(null);
  const [defectStats, setDefectStats] = useState<import("@shared/types").DefectRepositoryStats | null>(null);
  const [defectViewDefect, setDefectViewDefect] = useState<import("@shared/types").DefectRecord | null>(null);
  const [defectViewRelations, setDefectViewRelations] = useState<import("@shared/types").DuplicateRelation[]>([]);
  const [defectShowNewSource, setDefectShowNewSource] = useState(false);
  const [defectFilters, setDefectFilters] = useState<import("@shared/types").SearchFilters>({ query: "" });
  const [defectTab, setDefectTab] = useState<"repository" | "sources" | "detail" | "stats">("repository");
  const [defectDuplicateTab, setDefectDuplicateTab] = useState(false);

  const loadDefectSources = useCallback(async () => {
    try {
      const sources = await window.qaBuddy.getDefectSources(loggedInUser, jiraDisplayName);
      setDefectSources(sources);
    } catch {
      // ignore
    }
  }, [loggedInUser, jiraDisplayName]);

  const loadDefectStats = useCallback(async () => {
    try {
      const stats = await window.qaBuddy.getDefectStats();
      setDefectStats(stats);
    } catch {
      // ignore
    }
  }, []);

  const loadAllDefects = useCallback(async () => {
    setDefectSearching(true);
    try {
      const result = await window.qaBuddy.searchDefects({ query: "" });
      setDefectCandidates(result.candidates);
      setDefectSearchResults(result.defects);
    } catch {
      // silent — data kosong saat pertama kali
    } finally {
      setDefectSearching(false);
    }
  }, []);

  // Lazy-load defect data only when user opens defect-repository view
  const defectDataLoadedRef = useRef(false);
  useEffect(() => {
    if (activeView !== "defect-repository") return;
    if (defectDataLoadedRef.current) return;
    defectDataLoadedRef.current = true;
    void Promise.all([loadDefectSources(), loadDefectStats(), loadAllDefects()]).catch(() => {});
  }, [activeView, loadDefectSources, loadDefectStats, loadAllDefects]);

  const handleDefectSync = useCallback(async (projectKey: string) => {
    setDefectSyncing(projectKey);
    try {
      const result = await window.qaBuddy.syncDefectSource(projectKey);
      setBanner({ tone: "success", text: `Sync ${projectKey}: ${result.indexed} diindeks, ${result.skipped} dilewati.` });
      await loadDefectSources();
      await loadDefectStats();
      loadAllDefects();
    } catch (error: any) {
      setBanner({ tone: "error", text: `Sync gagal: ${error.message}` });
    } finally {
      setDefectSyncing(null);
    }
  }, [loadDefectSources, loadDefectStats, loadAllDefects, setBanner]);

  const handleDefectSearch = useCallback(async (query?: string, filters?: import("@shared/types").SearchFilters) => {
    const q = query ?? defectSearchQuery;
    const f = filters ?? defectFilters;
    if (!q.trim() && !f.projectKeys?.length && !f.issueTypes?.length && !f.statuses?.length && !f.components?.length && !f.versions?.length && !f.severities?.length) return;
    setDefectSearching(true);
    try {
      const result = await window.qaBuddy.searchDefects({ ...f, query: q });
      setDefectCandidates(result.candidates);
      setDefectSearchResults(result.defects);
    } catch (error: any) {
      setBanner({ tone: "error", text: `Search gagal: ${error.message}` });
    } finally {
      setDefectSearching(false);
    }
  }, [defectSearchQuery, defectFilters, setBanner]);

  const handleDefectViewDetail = useCallback(async (id: string) => {
    try {
      const [defect, relations] = await Promise.all([
        window.qaBuddy.getDefect(id),
        window.qaBuddy.getDefectDuplicateRelations(id),
      ]);
      if (defect) {
        setDefectViewDefect(defect);
        setDefectViewRelations(relations);
        setDefectTab("detail");
      }
    } catch {
      // ignore
    }
  }, []);

  const handleDefectMarkDuplicate = useCallback(async (duplicateDefectId: string, primaryDefectId: string, reason: string) => {
    try {
      await window.qaBuddy.markDuplicateDefect({
        primaryDefectId,
        duplicateDefectId,
        reason,
        confidenceScore: 0,
        createdBy: "user",
      });
      setBanner({ tone: "success", text: "Defect ditandai sebagai duplicate." });
      if (defectViewDefect) {
        await handleDefectViewDetail(defectViewDefect.id);
      }
    } catch (error: any) {
      setBanner({ tone: "error", text: `Gagal menandai duplicate: ${error.message}` });
    }
  }, [defectViewDefect, handleDefectViewDetail, setBanner]);

  const handleDefectRemoveDuplicate = useCallback(async (relationId: string) => {
    try {
      await window.qaBuddy.removeDuplicateDefectLink(relationId);
      setBanner({ tone: "success", text: "Link duplicate dihapus." });
      if (defectViewDefect) {
        await handleDefectViewDetail(defectViewDefect.id);
      }
    } catch (error: any) {
      setBanner({ tone: "error", text: `Gagal menghapus link duplicate: ${error.message}` });
    }
  }, [defectViewDefect, handleDefectViewDetail, setBanner]);

  const handleDefectSaveSource = useCallback(async (source: import("@shared/types").JiraProjectSource) => {
    await window.qaBuddy.saveDefectSource(source);
    setDefectShowNewSource(false);
    await loadDefectSources();
    setBanner({ tone: "success", text: `Source ${source.projectKey} berhasil disimpan.` });
  }, [loadDefectSources, setBanner]);

  const handleDefectDeleteSource = useCallback(async (id: string) => {
    try {
      await window.qaBuddy.deleteDefectSource(id);
      await loadDefectSources();
      await loadDefectStats();
      setDefectTab("repository");
      setDefectCandidates([]);
      setDefectSearchResults([]);
      loadAllDefects();
      setBanner({ tone: "success", text: "Source berhasil dihapus." });
    } catch (error: any) {
      setBanner({ tone: "error", text: `Gagal menghapus source: ${error.message}` });
    }
  }, [loadDefectSources, loadDefectStats, loadAllDefects, setBanner, setDefectTab, setDefectCandidates, setDefectSearchResults]);

  // ── BRD Generation State (global — survives navigation) ──────────────
  const [brdGenerating, setBrdGenerating] = useState(false);
  const [brdTestCases, setBrdTestCases] = useState<BRDTestCase[]>([]);
  const [brdGenerationResult, setBrdGenerationResult] = useState<BRDGenerationResult | null>(null);
  const [brdGeneratedExecId, setBrdGeneratedExecId] = useState<string>(() =>
    localStorage.getItem("brd_last_exec_id") ?? ""
  );
  const [brdChunkProgress, setBrdChunkProgress] = useState<{
    done: number; total: number; currentFeature: string;
  } | null>(null);

  const handleBrdGenerate = useCallback(async (confluencePageId: string, projectKey: string) => {
    if (!confluencePageId || !projectKey) return;
    setBrdGenerating(true);
    setBrdGenerationResult(null);
    setBrdTestCases([]);
    setBrdChunkProgress(null);
    localStorage.removeItem("brd_last_exec_id");

    const unlisten = window.qaBuddy.onBrdChunkProgress((progress: BrdChunkProgress) => {
      setBrdTestCases(prev => {
        const existingIds = new Set(prev.map(tc => tc.id));
        const newCases = progress.testCases.filter(tc => !existingIds.has(tc.id));
        return [...prev, ...newCases];
      });
      if (progress.testExecutionId) {
        setBrdGeneratedExecId(progress.testExecutionId);
        localStorage.setItem("brd_last_exec_id", progress.testExecutionId);
      }
      setBrdChunkProgress({
        done: progress.featureIndex,
        total: progress.featureTotal,
        currentFeature: progress.featureName,
      });
    });

    try {
      const result = await window.qaBuddy.generateTestCasesFromBRD({ confluencePageId, projectKey });
      setBrdGenerationResult(result);
      if (result.success && result.testCases.length > 0) {
        setBrdTestCases(result.testCases);
        if (result.testExecutionId) {
          setBrdGeneratedExecId(result.testExecutionId);
          localStorage.setItem("brd_last_exec_id", result.testExecutionId);
        }
      }
    } catch (e: any) {
      const errMsg = typeof e === "string" ? e : e?.message || String(e) || "Generation failed";
      setBrdGenerationResult({ success: false, featureName: "", testCases: [], error: errMsg });
    } finally {
      unlisten();
      setBrdGenerating(false);
      setBrdChunkProgress(null);
    }
  }, []);

  // On first load: restore previously generated test cases if any
  useEffect(() => {
    const savedId = localStorage.getItem("brd_last_exec_id");
    if (savedId && !brdGenerating) {
      window.qaBuddy.getGeneratedTestCases(savedId)
        .then(cases => { if (cases?.length > 0) setBrdTestCases(cases); })
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── UQA Store State ───────────────────────────────────────────────────
  const [uqaIssues, setUqaIssues] = useState<UqaIssue[]>([]);
  const [uqaSyncing, setUqaSyncing] = useState(false);
  const [uqaSyncProgress, setUqaSyncProgress] = useState<UqaSyncProgress | null>(null);

  const loadUqaIssuesFromStore = useCallback(async () => {
    // Wait until we have at least one identity to search by
    if (!loggedInUser && !jiraDisplayName) return;
    try {
      const dbUqaRows = await window.qaBuddy.getMyUqaProjects(loggedInUser, jiraDisplayName).catch(() => []);
      // Don't wipe existing results if the query returned nothing (likely a race before displayName resolved)
      if (dbUqaRows.length === 0) return;
      const dbIssues: UqaIssue[] = dbUqaRows.map((row) => ({
        projectKey: row.uqa_key.split("-")[0] ?? "",
        projectName: row.project_name ?? "",
        issueKey: row.uqa_key,
        summary: row.project_name ?? "",
        entries: [],
        lastUpdated: row.last_sync ?? null,
        needsUpdate: false,
        status: row.status ?? "Unknown",
        statusCategory: row.status ?? "Unknown",
        availableTransitions: [],
        lastUpdateAuthor: row.assignee ?? "",
        lastUpdateDate: row.last_sync ?? "",
      }));
      setUqaIssues(dbIssues);
    } catch {
      // silent
    }
  }, [loggedInUser, jiraDisplayName]);

  const syncUqaIssues = useCallback(async () => {
    setUqaSyncing(true);
    setUqaSyncProgress({ status: "fetching", message: "Memulai...", current: 0, total: 0 });
    try {
      const dbUqaRows = await window.qaBuddy.getMyUqaProjects(loggedInUser, jiraDisplayName).catch(() => []);
      const dbIssues: UqaIssue[] = dbUqaRows.map((row) => ({
        projectKey: row.uqa_key.split("-")[0] ?? "",
        projectName: row.project_name ?? "",
        issueKey: row.uqa_key,
        summary: row.project_name ?? "",
        entries: [],
        lastUpdated: row.last_sync ?? null,
        needsUpdate: false,
        status: row.status ?? "Unknown",
        statusCategory: row.status ?? "Unknown",
        availableTransitions: [],
        lastUpdateAuthor: row.assignee ?? "",
        lastUpdateDate: row.last_sync ?? "",
      }));
      setUqaIssues(dbIssues);
    } catch {
      // silent
    } finally {
      setUqaSyncing(false);
      setUqaSyncProgress(null);
    }
  }, [loggedInUser, jiraDisplayName]);

  // Listen for UQA sync progress events
  useEffect(() => {
    const cleanup = window.qaBuddy.onUqaSyncProgress((progress) => {
      setUqaSyncProgress(progress);
    });
    return cleanup;
  }, []);

  // Load UQA issues from store on mount
  useEffect(() => {
    loadUqaIssuesFromStore();
  }, [loadUqaIssuesFromStore]);

  // Auto-sync dashboard projects from UQA DB whenever jiraDisplayName becomes available
  useEffect(() => {
    if (!loggedInUser || !jiraDisplayName) return;

    const EXCLUDED = ["support", "ecm", "ncm ops"];

    function extractProjectKey(projectName: string): string | null {
      const afterFirst = projectName.split(" - ").slice(1).join(" - ").trim();
      const segment = afterFirst.split(" - ")[0]?.trim() || "";
      if (EXCLUDED.includes(segment.toLowerCase())) return null;
      if (/^[A-Z0-9]+$/.test(segment) && /[A-Z]/.test(segment)) return segment;
      return null;
    }

    void (async () => {
      try {
        const uqaRows = await window.qaBuddy.getMyUqaProjects(loggedInUser, jiraDisplayName).catch(() => []);
        if (uqaRows.length === 0) return;

        const seen = new Set<string>();
        const projects: DashboardProjectConfig[] = [];
        for (const row of uqaRows) {
          const key = extractProjectKey(row.project_name || "");
          if (!key || seen.has(key)) continue;
          seen.add(key);
          projects.push({
            projectKey: key,
            issueType: "Bug",
            excludeLabels: [],
            includeLabels: [],
            excludeStatuses: [],
            includeStatuses: [],
            enabled: true,
          });
        }
        if (projects.length === 0) return;

        const newConfig = { ...config, dashboard: { projects } };
        const saved = await window.qaBuddy.saveConfig(newConfig);
        setConfig(saved);
        setDashboardProjects(projects);

        // Fetch dashboard data silently
        setDashboardLoading(true);
        window.qaBuddy.getDashboard({ skipInsight: true })
          .then((nextDashboard) => { setDashboard(nextDashboard); })
          .catch(() => {})
          .finally(() => { setDashboardLoading(false); });
      } catch {
        // Non-critical — dashboard will still show with existing config
      }
    })();
  // Run once when jiraDisplayName first becomes available
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jiraDisplayName]);

  // Listen for update progress events
  useEffect(() => {
    const cleanup = window.qaBuddy.onUpdateProgress((progress) => {
      setUpdateProgress(progress);
      setShowUpdateProgress(true);
    });
    return cleanup;
  }, []);

  // Fetch Xray folders when project changes
  useEffect(() => {
    if (!organizeProjectKey) {
      setOrganizeXrayFolders([]);
      setOrganizeFolder("");
      return;
    }
    const cached = readXrayFolderCache(organizeProjectKey);
    if (cached) {
      setOrganizeXrayFolders(cached);
      return;
    }
    setOrganizeFolderLoading(true);
    setOrganizeFolder("");
    window.qaBuddy.getXrayFolders(organizeProjectKey)
      .then(f => { writeXrayFolderCache(organizeProjectKey, f); setOrganizeXrayFolders(f); })
      .catch(() => setOrganizeXrayFolders([]))
      .finally(() => setOrganizeFolderLoading(false));
  }, [organizeProjectKey]);

  // Fetch folders for Xray Folder mode when project changes
  useEffect(() => {
    if (!confImportProjectKey) {
      setConfImportXrayFolders([]);
      setConfImportSelectedFolder("");
      return;
    }
    const cached = readXrayFolderCache(confImportProjectKey);
    if (cached) {
      setConfImportXrayFolders(cached);
      return;
    }
    setConfImportFolderLoading(true);
    setConfImportSelectedFolder("");
    window.qaBuddy.getXrayFolders(confImportProjectKey)
      .then(f => { writeXrayFolderCache(confImportProjectKey, f); setConfImportXrayFolders(f); })
      .catch(() => setConfImportXrayFolders([]))
      .finally(() => setConfImportFolderLoading(false));
  }, [confImportProjectKey]);

  // Fetch Xray folders for Manual Test Case Creator when project changes
  useEffect(() => {
    if (!manualProjectKey) {
      setManualXrayFolders([]);
      return;
    }
    const cached = readXrayFolderCache(manualProjectKey);
    if (cached) {
      setManualXrayFolders(cached);
      return;
    }
    setManualFolderLoading(true);
    window.qaBuddy.getXrayFolders(manualProjectKey)
      .then(f => { writeXrayFolderCache(manualProjectKey, f); setManualXrayFolders(f); })
      .catch(() => setManualXrayFolders([]))
      .finally(() => setManualFolderLoading(false));
  }, [manualProjectKey]);

  const refreshManualXrayFolders = () => {
    if (!manualProjectKey) return;
    clearXrayFolderCache(manualProjectKey);
    setManualFolderLoading(true);
    window.qaBuddy.getXrayFolders(manualProjectKey)
      .then(f => { writeXrayFolderCache(manualProjectKey, f); setManualXrayFolders(f); })
      .catch(() => setManualXrayFolders([]))
      .finally(() => setManualFolderLoading(false));
  };

  const connectionPills = useMemo(
    () => [
      { label: "Jira", item: status.jira, icon: jiraIcon },
      { label: "Confluence", item: status.confluence, icon: confluenceIcon },
      { label: "Ollama", item: status.ollama, icon: ollamaIcon },
    ],
    [status]
  );

  async function handleRagIndexConfluence() {
    if (!ragSyncSpace) return;
    setRagLoading("confluence");
    setRagProgress(null);
    try {
      const result = await window.qaBuddy.ragIndexConfluence(ragSyncSpace);
      setBanner({ tone: "success", text: `Knowledge Base: ${result.indexed} halaman Confluence berhasil diindeks.` });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal mengindeks Confluence.") });
      setRagLoading(null);
    }
  }

  async function handleRagIndexJira() {
    if (!ragSyncProject) return;
    setRagLoading("jira");
    setRagProgress(null);
    try {
      const result = await window.qaBuddy.ragIndexJira(ragSyncProject);
      setBanner({ tone: "success", text: `Knowledge Base: ${result.indexed} issue Jira berhasil diindeks.` });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal mengindeks Jira.") });
      setRagLoading(null);
    }
  }

  async function handleRagClear(source?: "confluence" | "jira") {
    try {
      await window.qaBuddy.ragClearIndex(source);
      setBanner({ tone: "success", text: source ? `Index ${source} berhasil dihapus.` : "Semua index berhasil dihapus." });
      void loadRagStats();
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal menghapus index.") });
    }
  }

  async function handleRagClearBitbucket() {
    try {
      const result = await window.qaBuddy.ragClearBitbucket();
      setBanner({
        tone: "success",
        text: `Cache Bitbucket dihapus (${result.removed} chunks dihapus, ${result.pruned} expired dibersihkan).`,
      });
      void loadRagStats();
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal menghapus cache Bitbucket.") });
    }
  }

  async function refreshDashboard() {
    setDashboardLoading(true);
    try {
      const [nextDashboard, ragStatsResult, savedLogs] = await Promise.all([
        window.qaBuddy.getDashboard(),
        window.qaBuddy.ragGetStats().catch(() => null),
        window.qaBuddy.getLogs().catch(() => []),
      ]);
      setDashboard(nextDashboard);
      if (ragStatsResult) setRagStats(ragStatsResult);
      if (savedLogs?.length > 0) setLogs(savedLogs);
      setBanner({ tone: "success", text: "Dashboard berhasil diperbarui." });
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal memuat dashboard."),
      });
    } finally {
      setDashboardLoading(false);
    }
  }

  async function runConnectionTest() {
    setConnectionLoading(true);
    try {
      const nextStatus = await window.qaBuddy.testConnections();
      setStatus(nextStatus);
      setBanner({ tone: "info", text: "Koneksi layanan sudah diuji ulang." });
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal menguji koneksi."),
      });
    } finally {
      setConnectionLoading(false);
    }
  }

  async function runHealthcheck() {
    setHealthcheckLoading(true);
    try {
      const result = await window.qaBuddy.healthcheck();
      setHealthcheckResult(result);
      setBanner({ tone: "success", text: "Healthcheck selesai." });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal menjalankan healthcheck.") });
    } finally {
      setHealthcheckLoading(false);
    }
  }

  async function recordExecution() {
    if (!executionForm.testCaseId.trim() || !executionForm.testCaseTitle.trim()) {
      setBanner({ tone: "error", text: "Isi Test Case ID dan judul sebelum menyimpan execution." });
      return;
    }

    setExecutionLoading(true);
    try {
      const payload: TestCaseExecution = {
        id: crypto.randomUUID(),
        testCaseId: executionForm.testCaseId.trim(),
        testCaseTitle: executionForm.testCaseTitle.trim(),
        result: executionForm.result,
        executedBy: executionForm.executedBy.trim() || "Unknown",
        executedAt: new Date().toISOString(),
        sprint: executionForm.sprint.trim() || undefined,
        notes: executionForm.notes.trim() || undefined,
        linkedIssueKey: executionForm.linkedIssueKey.trim() || undefined,
      };
      await window.qaBuddy.recordExecution(payload);
      setBanner({ tone: "success", text: `Execution untuk ${payload.testCaseId} tersimpan.` });
      setExecutionForm((current) => ({
        ...current,
        testCaseId: "",
        testCaseTitle: "",
        notes: "",
        linkedIssueKey: "",
      }));
      await loadExecutionTracking();
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal menyimpan execution test case.") });
    } finally {
      setExecutionLoading(false);
    }
  }

  async function submitChat(prefilledPrompt?: string) {
    const prompt = (prefilledPrompt ?? chatPrompt).trim();
    if ((!prompt && chatAttachments.length === 0) || chatLoading) {
      return;
    }

    setChatLoading(true);
    let finalPrompt = prompt;
    if (chatAttachments.length > 0) {
      const attachmentsText = chatAttachments.map(a => `[Lampiran File: ${a.name}]\n${a.text}`).join("\n\n---\n\n");
      finalPrompt = `${attachmentsText}\n\n---\n\n${prompt}`.trim();
    }
    setChatMessages((current) => [...current, { role: "user", text: prompt, sentText: finalPrompt, attachments: chatAttachments.map(a => a.name) }]);
    setChatPrompt("");
    setChatAttachments([]);

    // Build conversation history from previous messages (last 10 pairs)
    const history = chatMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.sentText || m.text,
      }));

    try {
      const response = await window.qaBuddy.askAssistant(finalPrompt, history);
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: response.answer,
          response,
        },
      ]);
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: toErrorMessage(error, "Permintaan chat gagal diproses."),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  const doSubmitManualCases = async () => {
    setManualLoading(true);
    setProgressHidden(false);
    try {
      const casesToSubmit = manualCases.map(c => ({
        ...c,
        projectKey: manualProjectKey || config.jira.projectKey,
      }));
      const result = await window.qaBuddy.createManualTestCases(casesToSubmit, loggedInUser || undefined);

      // Group newly created test case keys by their target Test Execution key
      const execMap: Record<string, string[]> = {};
      result.created.forEach((created, idx) => {
        const teKey = (manualCases[idx]?.testExecutionKey || "").trim();
        if (teKey) {
          if (!execMap[teKey]) execMap[teKey] = [];
          execMap[teKey].push(created.key);
        }
      });

      // Attach test cases to their respective Test Executions
      const execEntries = Object.entries(execMap);
      const attachResults = await Promise.allSettled(
        execEntries.map(([execKey, testKeys]) =>
          window.qaBuddy.addTestsToExecution(execKey, testKeys)
        )
      );

      const attachedCount = attachResults.filter(r => r.status === "fulfilled").length;
      const failedExecs = execEntries
        .filter((_, i) => attachResults[i].status === "rejected")
        .map(([k]) => k);

      // Assign each newly attached test run to the current user (fire-and-forget)
      if (config.jira.username) {
        const attachedExecKeys = new Set(
          execEntries.filter((_, i) => attachResults[i].status === "fulfilled").map(([k]) => k)
        );
        const assigneePairs = execEntries
          .filter(([execKey]) => attachedExecKeys.has(execKey))
          .flatMap(([execKey, testKeys]) => testKeys.map(tcKey => [execKey, tcKey] as const));
        await Promise.allSettled(
          assigneePairs.map(([execKey, tcKey]) =>
            window.qaBuddy.updateTestRunAssignee(execKey, tcKey, config.jira.username)
          )
        );
      }

      // Save to DB — fire and forget, don't block UX on DB availability
      try {
        const dbPayload = result.created.map((created, idx) => ({
          tc_key: created.key,
          te_jira_key: (manualCases[idx]?.testExecutionKey || "").trim(),
          title: manualCases[idx]?.title || created.key,
          assignee: config.jira.username || undefined,
        }));
        await window.qaBuddy.saveTestCases(dbPayload);
      } catch {
        // DB save failure is non-critical — Jira create already succeeded
      }

      let bannerText = `Berhasil membuat ${result.created.length} test case di Jira.`;
      if (execEntries.length > 0) {
        bannerText += ` ${attachedCount}/${execEntries.length} Test Execution berhasil dilampirkan.`;
        if (failedExecs.length > 0) bannerText += ` Gagal: ${failedExecs.join(", ")}.`;
      }

      setBanner({ tone: failedExecs.length > 0 ? "error" : "success", text: bannerText });
      addLog("Submit to Jira", failedExecs.length > 0 ? "error" : "success",
        `Berhasil membuat ${result.created.length} test case di Jira`,
        result.created.map(c => c.key).join(", ")
      );
      setManualCases([{ id: crypto.randomUUID(), title: "", description: "", steps: "", expectedResult: "", xrayFolder: "", labels: "", testExecutionKey: "" }]);
      setManualDuplicateResults({});
    } catch (error: any) {
      setBanner({ tone: "error", text: `Gagal membuat test case: ${error.message}` });
      addLog("Submit to Jira", "error", "Gagal membuat test case", error.message);
    } finally {
      setManualLoading(false);
    }
  };

  const submitManualCases = async () => {
    if (manualCases.some(c => !c.title.trim())) {
      setBanner({ tone: "error", text: "Semua skenario harus memiliki judul." });
      return;
    }
    if (!manualProjectKey) {
      setBanner({ tone: "error", text: "Pilih project terlebih dahulu." });
      return;
    }

    // Check duplicates before submit — embedding-based when possible,
    // falls back to keyword matching if the AI check is unavailable.
    setManualLoading(true);
    setProgressHidden(false);
    try {
      let duplicates: Record<string, { key: string; summary: string; score: number }[]> = {};

      try {
        const results = await window.qaBuddy.findTestCaseDuplicateCandidates(
          manualProjectKey,
          manualCases.map(c => ({ title: c.title, folderPath: c.xrayFolder }))
        );
        manualCases.forEach((c, idx) => {
          const matches = results[idx]?.matches ?? [];
          if (c.title.trim()) duplicates[c.id] = matches;
        });
      } catch {
        const allIssues = await window.qaBuddy.findTestCasesByJql(
          `project = "${manualProjectKey}" AND issuetype = Test`,
          500
        );
        for (const c of manualCases) {
          if (!c.title.trim()) continue;
          const match = findBestMatch(c.title, allIssues);
          duplicates[c.id] = match ? [{ key: match.key, summary: match.summary, score: 1 }] : [];
        }
      }

      const newResults: typeof manualDuplicateResults = {};
      for (const [id, matches] of Object.entries(duplicates)) {
        newResults[id] = { matches, checked: true };
      }
      setManualDuplicateResults(prev => ({ ...prev, ...newResults }));

      const hasDuplicates = Object.values(duplicates).some(arr => arr.length > 0);
      if (hasDuplicates) {
        setManualLoading(false);
        setManualPendingDuplicates(duplicates);
        setShowManualDuplicateModal(true);
        return;
      }

      await doSubmitManualCases();
    } catch (error) {
      // If duplicate check fails, allow direct submit
      const reason = toErrorMessage(error, "error tidak diketahui");
      setBanner({ tone: "info", text: `Pemeriksaan duplikat gagal — melanjutkan submit. Alasan: ${reason}` });
      addLog("Submit to Jira", "info", "Pemeriksaan duplikat gagal", reason);
      await doSubmitManualCases();
    }
  };

  const confirmManualSubmitWithDuplicates = async () => {
    setShowManualDuplicateModal(false);
    setManualPendingDuplicates(null);
    await doSubmitManualCases();
  };

  const addManualCase = () => {
    setManualCases([
      ...manualCases,
      { id: crypto.randomUUID(), title: "", description: "", steps: "", expectedResult: "", xrayFolder: "", labels: "", testExecutionKey: "" }
    ]);
  };

  const removeManualCase = (id: string) => {
    if (manualCases.length <= 1) return;
    setManualCases(manualCases.filter(c => c.id !== id));
  };

  const updateManualCase = (id: string, field: keyof ManualTestCase, value: string) => {
    setManualCases(manualCases.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const generateWithAi = async (id: string) => {
    const target = manualCases.find(c => c.id === id);
    if (!target || !target.title.trim()) {
      setBanner({ tone: "info", text: "Tulis judul skenario terlebih dahulu agar AI bisa membantu." });
      return;
    }

    setAiLoading(true);
    try {
      const prompt = `Buatkan deskripsi, langkah-langkah, dan hasil yang diharapkan untuk test case berjudul: "${target.title}". Balas dalam format JSON: {"description": "...", "steps": "...", "expectedResult": "..."}`;
      const response = await window.qaBuddy.askAssistant(prompt);
      
      try {
        const cleanJson = response.answer.substring(response.answer.indexOf('{'), response.answer.lastIndexOf('}') + 1);
        const data = JSON.parse(cleanJson);
        setManualCases(manualCases.map(c => c.id === id ? { 
          ...c, 
          description: data.description || c.description,
          steps: data.steps || c.steps,
          expectedResult: data.expectedResult || c.expectedResult
        } : c));
      } catch {
        setManualCases(manualCases.map(c => c.id === id ? { ...c, description: response.answer } : c));
      }
    } catch (err) {
      setBanner({ tone: "error", text: "AI gagal memproses permintaan." });
    } finally {
      setAiLoading(false);
    }
  };

  const checkManualDuplicate = async (id: string, title: string, folderPath?: string) => {
    if (!title.trim() || !manualProjectKey) {
      setManualDuplicateResults(prev => ({ ...prev, [id]: { matches: [], checked: true } }));
      return;
    }
    try {
      let matches: { key: string; summary: string; score: number }[] = [];
      try {
        const results = await window.qaBuddy.findTestCaseDuplicateCandidates(
          manualProjectKey,
          [{ title, folderPath }]
        );
        matches = results[0]?.matches ?? [];
      } catch {
        const escaped = title.replace(/["']/g, "").trim();
        const issues = await window.qaBuddy.findTestCasesByJql(
          `project = "${manualProjectKey}" AND issuetype = Test AND summary ~ "${escaped}"`,
          5
        );
        const match = findBestMatch(title, issues);
        matches = match ? [{ key: match.key, summary: match.summary, score: 1 }] : [];
      }
      setManualDuplicateResults(prev => ({
        ...prev,
        [id]: {
          matches,
          checked: true,
        }
      }));
    } catch {
      setManualDuplicateResults(prev => ({ ...prev, [id]: { matches: [], checked: true } }));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await loadXlsx();
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        const importedCases: ManualTestCase[] = jsonData.map(row => ({
          id: crypto.randomUUID(),
          title: row.Title || row.title || row.Summary || "",
          description: row.Description || row.description || "",
          steps: row.Steps || row.steps || row.StepsToReproduce || "",
          expectedResult: row.ExpectedResult || row.expectedResult || row.Expected || "",
          xrayFolder: row.XrayFolder || row.xrayFolder || row.Folder || "",
          labels: row.Labels || row.labels || row.Tags || row.tags || "",
          testExecutionKey: row.TestExecutionKey || row.testExecutionKey || row["Test Execution Key"] || "",
        })).filter(c => c.title);

        if (importedCases.length > 0) {
          setManualCases(importedCases);
          setBanner({ tone: "success", text: `Berhasil mengimpor ${importedCases.length} skenario dari file.` });
        } else {
          setBanner({ tone: "error", text: "Tidak ditemukan data skenario yang valid di file tersebut." });
        }
      } catch (err) {
        setBanner({ tone: "error", text: "Gagal membaca file. Pastikan format file benar (CSV/XLSX)." });
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = ""; // Reset input
  };

  const downloadTemplate = async () => {
    const XLSX = await loadXlsx();
    const templateData = [
      {
        Title: "Sample Test Case Title",
        Description: "Describe the objective of this test case",
        Steps: "1. Step one\n2. Step two\n3. Step three",
        ExpectedResult: "What should happen after the steps",
        Folder: "/Project/Folder/Path",
        Labels: "login, auth, p1",
        TestExecutionKey: "PROJ-123"
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
    
    // Generate buffer and trigger download
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const data = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = window.URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "QABuddy_TestCase_Template.xlsx");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadConfTemplate = async () => {
    const XLSX = await loadXlsx();
    const templateData = [
      {
        Section: "Login Module",
        "No. Test Case": "TC001",
        Function: "Login",
        Scenario: "Validasi login dengan data benar",
        Kategori: "Positive",
        "Input Data": "user@email.com",
        Steps: "1. Buka halaman login\n2. Masukkan email dan password\n3. Klik tombol Login",
        "Expected Result": "User berhasil masuk ke dashboard",
        Result: "PASS",
        Attachment: "images/screenshot1.png, images/screenshot2.png"
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const data = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = window.URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "QABuddy_Confluence_Sync_Template.xlsx");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const submitOrganize = async () => {
    if (!organizeSource.trim()) {
      setBanner({ tone: "error", text: "Masukkan JQL atau daftar Issue Key terlebih dahulu." });
      return;
    }
    if (!organizeFolder.trim()) {
      setBanner({ tone: "error", text: "Pilih target folder Xray." });
      return;
    }
    if (!organizeProjectKey) {
      setBanner({ tone: "error", text: "Pilih project terlebih dahulu." });
      return;
    }

    setManualLoading(true);
    setProgressHidden(false);
    try {
      const result = await window.qaBuddy.organizeTestsIntoXray(organizeSource, organizeFolder, organizeProjectKey);
      setBanner({
        tone: "success",
        text: `Berhasil memindahkan ${result.count} tiket ke folder: ${organizeFolder}`
      });
      addLog("Xray Organizer", "success", `Memindahkan ${result.count} tiket ke folder: ${organizeFolder}`);
      setOrganizeSource("");
    } catch (error: any) {
      setBanner({ tone: "error", text: `Gagal memindahkan tiket: ${error.message}` });
      addLog("Xray Organizer", "error", "Gagal memindahkan tiket", error.message);
    } finally {
      setManualLoading(false);
    }
  };

  // ── Update from Confluence ───────────────────────────────────────────

  const fetchConfImportEntries = async () => {
    const pageUrl = confImportUrl.trim();
    if (!pageUrl) {
      setBanner({ tone: "error", text: "Masukkan URL Confluence page terlebih dahulu." });
      return;
    }
    setConfImportLoading(true);
    setConfImportResult(null);
    setConfImportEntries([]);
    try {
      const pageIdMatch = pageUrl.match(/pages\/(\d+)/) || pageUrl.match(/[?&]pageId=(\d+)/);
      if (!pageIdMatch) {
        setBanner({ tone: "error", text: "URL Confluence tidak valid. Tidak dapat menemukan Page ID." });
        setConfImportLoading(false);
        return;
      }
      const pageId = pageIdMatch[1];
      setConfParseProgress(null);
      const result = await window.qaBuddy.parseConfluenceEntries(pageId, {
        updateFromConfluence: true,
        includeImages: false,
        includeJiraServerId: false,
      });
      if (!result.contentLoaded || result.entries.length === 0) {
        setBanner({ tone: "info", text: "Tidak ada entry yang ditemukan di halaman Confluence tersebut." });
        setConfImportLoading(false);
        return;
      }

      const extractKey = (text: string) => {
        const m = text.match(/([A-Z]{2,}-\d{1,9})/);
        return m ? m[1] : "";
      };
      const entries: ConfluenceTestImportEntry[] = result.entries.map((entry: any) => {
        const issueKey = entry.scenarioIssueKey || extractKey(entry.scenario || "");
        return {
          id: crypto.randomUUID(),
          issueKey,
          scenario: entry.scenario || "",
          steps: entry.steps || "",
          expectedResult: entry.expectedResult || "",
          functionName: entry.functionName || "",
          testCaseNo: entry.testCaseNo || "",
          inputData: entry.inputData || "",
          selected: issueKey.length > 0,
          screenCaptureFilenames: entry.screenCaptureFilenames || [],
          images: entry.images || [],
        };
      });

      // Fetch titles from DB for all entries that have an issueKey
      const keysToFetch = entries.map(e => e.issueKey).filter(k => k.length > 0);
      const titleMap = keysToFetch.length > 0
        ? await window.qaBuddy.getTestCaseTitles(keysToFetch).catch(() => ({} as Record<string, string>))
        : {};

      // Batch-fetch steps/expected from Xray for all entries with an issue key,
      // in parallel (max 8 concurrent), so the user doesn't have to fetch one-by-one.
      const detailMap: Record<string, FetchTestStepsResult> = {};
      if (keysToFetch.length > 0) {
        try {
          const details = await window.qaBuddy.fetchTcDetailsBatch(keysToFetch);
          for (const d of details) {
            detailMap[d.issueKey] = d;
          }
        } catch {
          // non-fatal — entries still load with the Confluence steps
        }
      }

      const entriesWithTitles = entries.map(e => {
        const detail = e.issueKey ? detailMap[e.issueKey] : undefined;
        // Only fill steps/expected from Xray when the Confluence entry has none —
        // existing Confluence steps are the source pushed to Jira on update.
        const fillSteps = detail?.steps && !(e.steps ?? "").trim();
        const fillExpected = detail?.expectedResult && !(e.expectedResult ?? "").trim();
        return {
          ...e,
          scenarioTitle: titleMap[e.issueKey] || undefined,
          steps: fillSteps ? detail.steps : e.steps,
          expectedResult: fillExpected ? detail.expectedResult : e.expectedResult,
        };
      });

      setConfImportEntries(entriesWithTitles);
      setBanner({
        tone: "success",
        text: `Ditemukan ${entries.length} entry dari "${result.pageTitle}". ${entries.filter(e => e.issueKey).length} entry memiliki Issue Key.`,
      });
    } catch (error: any) {
      setBanner({ tone: "error", text: `Gagal fetch entries: ${error.message}` });
    } finally {
      setConfImportLoading(false);
    }
  };

  const searchJiraForImport = async () => {
    if (confImportMode === "xray-folder") {
      if (!confImportProjectKey || !confImportSelectedFolder) {
        setBanner({ tone: "error", text: "Pilih Project dan Folder Xray terlebih dahulu." });
        return;
      }
      setConfImportLoading(true);
      try {
        const collectChildIds = (folders: XrayFolder[]): number[] =>
          folders.flatMap(f => [f.id, ...(f.children ? collectChildIds(f.children) : [])]);
        const folders = confImportXrayFolders;
        const pathParts = confImportSelectedFolder.split("/").filter(Boolean);
        let currentLevel: XrayFolder[] = folders;
        let foundFolder: XrayFolder | null = null;
        for (const part of pathParts) {
          const m = currentLevel.find(f => f.name.toLowerCase() === part.toLowerCase());
          if (m) { foundFolder = m; currentLevel = m.children || []; }
          else { foundFolder = null; break; }
        }
        if (!foundFolder) throw new Error("Folder tidak ditemukan.");
        const allFolderIds = [foundFolder.id, ...collectChildIds(foundFolder.children || [])];
        const rawIssuesList = await Promise.all(
          allFolderIds.map(id => window.qaBuddy.getXrayFolderIssues(confImportProjectKey, id))
        );
        const seen = new Set<string>();
        const rawIssues = rawIssuesList.flat().filter(i => { const dup = seen.has(i.key); seen.add(i.key); return !dup; });
        const issues: JiraIssueSummary[] = rawIssues.map(i => ({
          id: "", key: i.key, summary: i.summary, status: "", priority: "", assignee: "", reporter: "", type: "", url: "",
        }));
        const matchedIds = new Set<string>();
        const cleanScenario = (s: string) =>
          s.replace(/^[A-Z]+-\d+\s*[-–:—]?\s*/i, "").trim();
        const updated = confImportEntries.map(entry => {
          const cleaned = cleanScenario(entry.scenario);
          const match = findBestMatch(cleaned, issues);
          if (match) {
            matchedIds.add(entry.id);
            return { ...entry, issueKey: match.key, selected: true };
          }
          return { ...entry, selected: false };
        });
        setConfImportEntries(updated);
        setConfImportJqlMatched(true);
        setConfImportJqlMatchedIds(matchedIds);
        setBanner({
          tone: matchedIds.size > 0 ? "success" : "info",
          text: matchedIds.size > 0
            ? `Folder: ${issues.length} issues. ${matchedIds.size} entry cocok — Issue key diperbarui.`
            : `Folder memiliki ${issues.length} issues, tapi tidak ada entry yang cocok.`,
        });
      } catch (error: any) {
        setBanner({ tone: "error", text: `Gagal fetch folder: ${error.message}` });
      } finally {
        setConfImportLoading(false);
      }
      return;
    }

    const jql = confImportJql.trim();
    if (!jql) {
      setConfImportJqlMatched(false);
      setConfImportJqlMatchedIds(new Set());
      setConfImportEntries(prev =>
        prev.map(e => ({ ...e, selected: !!e.issueKey }))
      );
      setBanner({ tone: "info", text: "JQL kosong — menampilkan semua entries." });
      return;
    }
    setConfImportLoading(true);
    try {
      const issues = await window.qaBuddy.findTestCasesByJql(jql, 500);
      const matchedIds = new Set<string>();
      const updated = confImportEntries.map(entry => {
        const cleaned = entry.scenario.replace(/^[A-Z]+-\d+\s*[-–:—]?\s*/i, "").trim();
        const match = findBestMatch(cleaned, issues);
        if (match) {
          matchedIds.add(entry.id);
          return { ...entry, issueKey: match.key, selected: true };
        }
        return { ...entry, selected: false };
      });
      setConfImportEntries(updated);
      setConfImportJqlMatched(true);
      setConfImportJqlMatchedIds(matchedIds);
      setBanner({
        tone: matchedIds.size > 0 ? "success" : "info",
        text: matchedIds.size > 0
          ? `JQL menemukan ${issues.length} issues. ${matchedIds.size} entry cocok — Issue key diperbarui.`
          : `JQL menemukan ${issues.length} issues, tapi tidak ada entry yang cocok dengan scenario.`,
      });
    } catch (error: any) {
      setBanner({ tone: "error", text: `Gagal search Jira: ${error.message}` });
    } finally {
      setConfImportLoading(false);
    }
  };

  const toggleConfImportEntry = (id: string) => {
    setConfImportEntries(prev =>
      prev.map(e => e.id === id ? { ...e, selected: !e.selected } : e)
    );
  };

  const toggleAllConfImportEntries = (selected: boolean) => {
    setConfImportEntries(prev =>
      prev.map(e => ({ ...e, selected: e.issueKey ? selected : false }))
    );
  };

  const updateConfImportEntryKey = (id: string, newKey: string) => {
    setConfImportEntries(prev =>
      prev.map(e => e.id === id ? { ...e, issueKey: newKey, selected: !!newKey } : e)
    );
  };

  const fetchAndSetStepsForEntry = async (id: string, issueKey: string) => {
    if (!issueKey) return;
    setConfImportFetchingSteps(prev => new Set(prev).add(id));
    try {
      const result = await window.qaBuddy.fetchTestSteps(issueKey);
      if (result) {
        setConfImportEntries(prev =>
          prev.map(e =>
            e.id === id
              ? { ...e, steps: result.steps, expectedResult: result.expectedResult }
              : e
          )
        );
        const stepsCount = result.steps.split("\n").filter(Boolean).length;
        const resultCount = result.expectedResult.split("\n").filter(Boolean).length;
        addLog("Update from Confluence", "info", `${issueKey}: ${stepsCount} steps, ${resultCount} expected result berhasil di-fetch dari Xray.`);
        setBanner({ tone: "success", text: `${issueKey}: ${stepsCount} steps, ${resultCount} expected result berhasil di-fetch.` });
      } else {
        addLog("Update from Confluence", "info", `${issueKey}: Tidak ada test steps di Xray.`);
        setBanner({ tone: "info", text: `${issueKey}: Tidak ada test steps di Xray.` });
      }
    } catch {
      addLog("Update from Confluence", "error", `${issueKey}: Gagal fetch steps dari Xray.`);
      setBanner({ tone: "error", text: `${issueKey}: Gagal fetch steps dari Xray.` });
    } finally {
      setConfImportFetchingSteps(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const confirmStepConflictUpdate = async (mode: StepConflictMode) => {
    setStepConflictCheck(null);
    setConfImportLoading(true);
    setConfImportResult(null);
    setShowUpdateProgress(true);
    setUpdateProgress(null);
    const selected = confImportEntries.filter(e => e.selected && e.issueKey);
    try {
      const result = await window.qaBuddy.updateTestCasesFromConfluence(selected, mode);
      setConfImportResult(result);
      setBanner({
        tone: result.success.length > 0 ? "success" : "error",
        text: `${result.success.length} berhasil diupdate. ${result.failed.length} gagal.`,
      });
      addLog("Update from Confluence", "success", `Updated ${result.success.length} test cases`, `Failed: ${result.failed.length}`);
    } catch (error: any) {
      setBanner({ tone: "error", text: `Gagal update: ${error.message}` });
    } finally {
      setConfImportLoading(false);
    }
  };

  const submitUpdateFromConfluence = async () => {
    const selected = confImportEntries.filter(e => e.selected && e.issueKey);
    if (selected.length === 0) {
      setBanner({ tone: "error", text: "Pilih minimal satu entry dengan Issue Key yang valid." });
      return;
    }
    setConfImportLoading(true);
    setConfImportResult(null);
    try {
      const check = await window.qaBuddy.checkTestSteps(selected);
      if (check.hasSteps.length > 0) {
        setStepConflictCheck(check);
        setConfImportLoading(false);
        return;
      }
      setShowUpdateProgress(true);
      setUpdateProgress(null);
      const result = await window.qaBuddy.updateTestCasesFromConfluence(selected, "replace");
      setConfImportResult(result);
      setBanner({
        tone: result.success.length > 0 ? "success" : "error",
        text: `${result.success.length} berhasil diupdate. ${result.failed.length} gagal.`,
      });
      addLog("Update from Confluence", "success", `Updated ${result.success.length} test cases`, `Failed: ${result.failed.length}`);
    } catch (error: any) {
      setBanner({ tone: "error", text: `Gagal update: ${error.message}` });
    } finally {
      setConfImportLoading(false);
    }
  };

  async function parseConfPageEntries() {
    const pageId = config.confluence.targetPageId.trim();
    if (!pageId) {
      setBanner({ tone: "error", text: "Masukkan Target Page ID terlebih dahulu." });
      return;
    }
    const resolvedPageId = pageId;
    setConfPageLoading(true);
    setConfParseStatus(null);
    setConfParseProgress(null);
    try {
      const result = await window.qaBuddy.parseConfluenceEntries(pageId, {
        includeImages: true,
        includeJiraServerId: true,
      });
      const effectiveResult = { ...result, pageId: result.pageId || resolvedPageId };
      setConfParseStatus(effectiveResult);
      if (!effectiveResult.contentLoaded) {
        setBanner({
          tone: "error",
          text: `Page "${effectiveResult.pageId}" tidak bisa diambil${effectiveResult.error ? `: ${effectiveResult.error}` : "."}`,
        });
        addLog("Sync to Confluence", "error", `Page "${effectiveResult.pageId}" tidak bisa diambil`, effectiveResult.error || "Content not loaded");
        return;
      }
      const entriesList = effectiveResult.entries;
      if (entriesList.length === 0) {
        setBanner({ tone: "info", text: "Tidak ditemukan tabel QA Buddy yang bisa diparsing di halaman ini." });
        return;
      }
      entriesList.forEach((e: any) => {
        e.id = crypto.randomUUID();
        e.isDirty = false;
        e.issueKey = e.issueKey || "";
        e.screenCaptureFilenames = e.screenCaptureFilenames || [];
        e.images = normalizeConfAttachments(
          (e.images || []).map((image: any, index: number) => ({
            id: image.id || crypto.randomUUID(),
            name: image.name,
            data: image.data || "",
            order: typeof image.order === "number" ? image.order : index + 1,
            note: image.note || "",
            expandGroup: image.expandGroup || "",
          })),
          true
        );
      });
      setConfEntries(entriesList);
      setDeletedConfTableIndices([]);
      if (effectiveResult.jiraServerId && effectiveResult.jiraServerId !== config.confluence.jiraServerId) {
        setConfig((current) => ({
          ...current,
          confluence: { ...current.confluence, jiraServerId: effectiveResult.jiraServerId },
        }));
      }
      setBanner({
        tone: "success",
        text: `Berhasil memuat ${entriesList.length} entry dari halaman "${effectiveResult.pageTitle || effectiveResult.pageId}".`,
      });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal parse entries dari Confluence.") });
    } finally {
      setConfPageLoading(false);
    }
  }

  async function loadConfPageAttachments(options?: { silent?: boolean }) {
    const pageId = config.confluence.targetPageId.trim();
    if (!pageId) {
      setBanner({ tone: "error", text: "Masukkan Target Page ID terlebih dahulu." });
      return;
    }
    setConfAttachmentHydrating(true);
    setConfParseProgress(null);
    try {
      const result = await window.qaBuddy.parseConfluenceEntries(pageId, {
        includeImages: true,
        includeJiraServerId: true,
      });
      const hydratedEntries = result.entries || [];
      setConfEntries((current) =>
        current.map((entry, index) => {
          const hydrated = hydratedEntries[index];
          if (!hydrated) {
            return entry;
          }
          return {
            ...entry,
            screenCaptureFilenames: hydrated.screenCaptureFilenames || entry.screenCaptureFilenames || [],
            images: normalizeConfAttachments(
              (hydrated.images || []).map((image: any, imageIndex: number) => ({
                id: image.id || crypto.randomUUID(),
                name: image.name,
                data: image.data || "",
                order: typeof image.order === "number" ? image.order : imageIndex + 1,
                note: image.note || "",
                expandGroup: image.expandGroup || "",
              })),
              true
            ),
          };
        })
      );
      if (result.jiraServerId && result.jiraServerId !== config.confluence.jiraServerId) {
        setConfig((current) => ({
          ...current,
          confluence: { ...current.confluence, jiraServerId: result.jiraServerId },
        }));
      }
      if (!options?.silent) {
        setBanner({
          tone: "success",
          text: "Attachment existing dari page berhasil dimuat ke editor.",
        });
      }
    } catch (error) {
      if (!options?.silent) {
        setBanner({ tone: "error", text: toErrorMessage(error, "Gagal memuat attachment existing dari Confluence.") });
      }
    } finally {
      setConfAttachmentHydrating(false);
    }
  }

  async function resizeImageDataUri(dataUri: string, maxWidth: number): Promise<string> {
    if (maxWidth <= 0) return dataUri;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (img.width <= maxWidth) { resolve(dataUri); return; }
        const ratio  = maxWidth / img.width;
        const canvas = document.createElement("canvas");
        canvas.width  = maxWidth;
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(dataUri);
      img.src = dataUri;
    });
  }

  async function syncConfluence() {
    const pageId = config.confluence.targetPageId;
    if (!pageId.trim()) {
      setBanner({ tone: "error", text: "Target Page ID belum diisi. Atur di Sync Settings terlebih dahulu." });
      return;
    }
    if (confEntries.some(e => !e.testCaseNo.trim())) {
      setBanner({ tone: "error", text: "Semua entry harus memiliki No. Test Case." });
      return;
    }

    const dirtyEntries = confEntries.filter((entry) => entry.isDirty);
    if (dirtyEntries.length === 0 && deletedConfTableIndices.length === 0) {
      setBanner({ tone: "info", text: "Tidak ada perubahan pada tabel. Edit atau hapus entry terlebih dahulu sebelum sync." });
      return;
    }

    setConfLoading(true);
    setConfProgressHidden(false);
    setConfSyncProgress(null);
    setConfSyncSteps([]);
    try {
      // Resize images to confImageWidth before uploading
      const resizedEntries = await Promise.all(
        dirtyEntries.map(async (entry) => ({
          ...entry,
          images: await Promise.all(
            (entry.images ?? []).map(async (img: any) => ({
              ...img,
              data: img.data?.startsWith("data:image/")
                ? await resizeImageDataUri(img.data, confImageWidth)
                : img.data,
            }))
          ),
        }))
      );

      const result = await window.qaBuddy.syncToConfluence(pageId, {
        entries: resizedEntries,
        deletedTableIndices: deletedConfTableIndices,
      });

      // Update Xray test run status + DB for entries that have a teJiraKey (imported entries).
      // Fire-and-forget in background — don't block the UI on Xray API latency.
      const importedDirty = dirtyEntries.filter(
        (e) => e.teJiraKey && e.issueKey && (e.result === "PASS" || e.result === "FAILED")
      );
      if (importedDirty.length > 0) {
        void Promise.all(
          importedDirty.map((e) => {
            const xrayStatus = e.result === "PASS" ? "PASS" : "FAIL";
            return Promise.all([
              window.qaBuddy.updateTestRunStatus(e.teJiraKey as string, e.issueKey as string, xrayStatus),
              window.qaBuddy.updateTestCaseRunStatus(e.issueKey as string, e.teJiraKey as string, xrayStatus, loggedInUser),
            ]);
          })
        ).catch((e) => console.error("[syncConfluence] update test run status failed:", e));
      }

      const refreshed = await window.qaBuddy.parseConfluenceEntries(pageId);
      const effectiveRefreshed = { ...refreshed, pageId: refreshed.pageId || pageId };
      setConfParseStatus(effectiveRefreshed);
      if (effectiveRefreshed.contentLoaded) {
        // Build a lookup from testCaseNo → import metadata so teJiraKey/issueKey
        // survive the round-trip parse from Confluence (which drops custom fields).
        const importMeta: Record<string, { teJiraKey?: string; issueKey?: string }> = {};
        for (const e of dirtyEntries) {
          if (e.teJiraKey && e.issueKey && e.testCaseNo) {
            importMeta[String(e.testCaseNo).trim()] = {
              teJiraKey: e.teJiraKey as string,
              issueKey: e.issueKey as string,
            };
          }
        }
        effectiveRefreshed.entries.forEach((entry: any) => {
          entry.id = crypto.randomUUID();
          entry.isDirty = false;
          const meta = importMeta[String(entry.testCaseNo ?? "").trim()];
          if (meta) {
            entry.teJiraKey = meta.teJiraKey;
            entry.issueKey = meta.issueKey;
          }
        });
        setConfEntries(effectiveRefreshed.entries);
        setDeletedConfTableIndices([]);
        if (effectiveRefreshed.jiraServerId && effectiveRefreshed.jiraServerId !== config.confluence.jiraServerId) {
          setConfig((current) => ({
            ...current,
            confluence: { ...current.confluence, jiraServerId: effectiveRefreshed.jiraServerId },
          }));
        }
      }
      // One log card per sync run — detail lists upload status of every
      // attachment grouped per table entry (success and failures).
      const uploadResults = result.uploadResults ?? [];
      const failedCount = uploadResults.filter((r) => !r.success).length;
      const okCount = uploadResults.length - failedCount;

      let syncDetail = effectiveRefreshed.contentLoaded
        ? `${result.imageCount} gambar, ${result.attachmentCount} lampiran diupload`
        : effectiveRefreshed.error || "Content not loaded";
      if (uploadResults.length > 0) {
        const groups = new Map<string, { tc: string; scenario: string; rows: string[]; ok: number; fail: number }>();
        for (const r of uploadResults) {
          let g = groups.get(r.entryId);
          if (!g) {
            g = { tc: r.testCaseNo, scenario: r.scenario, rows: [], ok: 0, fail: 0 };
            groups.set(r.entryId, g);
          }
          if (r.success) {
            g.ok++;
            g.rows.push(`  ✓ ${r.uploadName}`);
          } else {
            g.fail++;
            g.rows.push(`  ✗ ${r.uploadName} — ${r.error ?? "unknown error"}`);
          }
        }
        syncDetail = [...groups.values()]
          .map((g) => `${g.tc} (${g.scenario}): ${g.ok}/${g.ok + g.fail} gambar sukses\n${g.rows.join("\n")}`)
          .join("\n\n");
      }

      setBanner(
        effectiveRefreshed.contentLoaded
          ? {
              tone: failedCount > 0 ? "info" : "success",
              text: `Berhasil sync ${result.entryCount} entry yang berubah (${okCount} gambar terupload${failedCount > 0 ? `, ${failedCount} gagal` : ""}) ke "${result.pageTitle}".${failedCount > 0 ? " Cek detail di menu Log." : ""}`,
            }
          : {
              tone: "error",
              text: `Sync berhasil, tetapi page "${effectiveRefreshed.pageId}" tidak bisa dibaca ulang${effectiveRefreshed.error ? `: ${effectiveRefreshed.error}` : "."}`,
            }
      );
      addLog(
        "Sync to Confluence",
        effectiveRefreshed.contentLoaded ? (failedCount > 0 ? "error" : "success") : "error",
        effectiveRefreshed.contentLoaded
          ? `Sync ${result.entryCount} entry ke "${result.pageTitle}" — ${okCount}/${uploadResults.length} gambar sukses${failedCount > 0 ? `, ${failedCount} gagal` : ""}`
          : `Sync berhasil, tetapi page "${effectiveRefreshed.pageId}" tidak bisa dibaca ulang`,
        syncDetail
      );

      // Auto-push ke Jira untuk setiap dirty entry yang punya issueKey
      const entriesToPush = dirtyEntries.filter(e => e.issueKey?.trim());
      if (entriesToPush.length > 0) {
        let jiraPushOk = 0, jiraPushFail = 0;
        await Promise.allSettled(
          entriesToPush.map(async (entry) => {
            try {
              await window.qaBuddy.pushEntryToJira({
                issueKey: entry.issueKey!,
                steps: entry.steps || "",
                expectedResult: entry.expectedResult || "",
                inputData: entry.inputData || "",
                category: entry.category || "",
              });
              jiraPushOk++;
            } catch {
              jiraPushFail++;
            }
          })
        );
        const jiraMsg = jiraPushFail === 0
          ? `${jiraPushOk} TC berhasil di-update ke Jira.`
          : `${jiraPushOk} TC berhasil, ${jiraPushFail} gagal di-update ke Jira.`;
        addLog("Sync to Confluence", jiraPushFail === 0 ? "info" : "error", jiraMsg);
        setBanner({ tone: jiraPushFail === 0 ? "success" : "error", text: jiraMsg });
      }
    } catch (error: any) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal sync ke Confluence."),
      });
      addLog("Sync to Confluence", "error", "Gagal sync ke Confluence", error instanceof Error ? error.message : String(error));
    } finally {
      setConfLoading(false);
    }
  }

  const handleConfFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Electron exposes the real file path
    const filePath = (file as any).path || "";

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await loadXlsx();
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

        let baseDir = "";
        if (filePath) {
          try {
            baseDir = await window.qaBuddy.getDirectoryName(filePath);
          } catch (dirErr) {
            console.error("Failed to get directory name of excel file:", dirErr);
          }
        }

        const imported = [];
        let failedAttachmentsCount = 0;

        for (const row of jsonData) {
          const entry = {
            ...createEmptyConfEntry(),
            section: row.Section || row.section || "",
            testCaseNo: row.TestCaseNo || row["No. Test Case"] || "",
            functionName: row.FunctionName || row.Function || "",
            scenario: row.Scenario || "",
            category: row.Category || row.Kategori || "Positive",
            inputData: row.InputData || row["Input Data"] || "",
            steps: row.Steps || "",
            expectedResult: row.ExpectedResult || row["Expected Result"] || "",
            result: row.Result || "PASS",
            images: [] as ConfAttachment[]
          };

          // Process attachments
          const attachmentString = row.Attachment || row.Lampiran || row.Images || row.Image || row.images || "";
          if (attachmentString && typeof attachmentString === "string") {
            const paths = attachmentString.split(/[,;]/).map((p: string) => p.trim()).filter(Boolean);
            const attachments: ConfAttachment[] = [];
            let order = 1;

            for (const p of paths) {
              try {
                const fileResult = await window.qaBuddy.readLocalFile(p, baseDir);
                attachments.push({
                  id: crypto.randomUUID(),
                  name: fileResult.name,
                  data: fileResult.data,
                  order: order++,
                  note: ""
                });
              } catch (err: any) {
                failedAttachmentsCount++;
                console.error(`Failed to load attachment from path "${p}":`, err);
                addLog("Sync to Confluence", "error", `Gagal memuat lampiran: "${p}"`, err instanceof Error ? err.message : String(err));
              }
            }
            entry.images = attachments;
          }

          imported.push(entry);
        }

        if (imported.length > 0) {
          setConfEntries(imported);
          setDeletedConfTableIndices([]);
          if (failedAttachmentsCount > 0) {
            setBanner({
              tone: "info",
              text: `Berhasil mengimpor ${imported.length} baris data, tetapi ${failedAttachmentsCount} lampiran gagal dimuat (cek menu Logs untuk detail).`
            });
          } else {
            setBanner({
              tone: "success",
              text: `Berhasil mengimpor ${imported.length} baris data.`
            });
          }
        }
      } catch (err: any) {
        console.error("Failed to parse Excel file:", err);
        setBanner({
          tone: "error",
          text: `Gagal membaca file Excel: ${err.message || String(err)}`
        });
      }
    };
    reader.readAsBinaryString(file);
    event.target.value = "";
  };

  const addConfEntry = (section?: string) => {
    setConfEntries((current) => [
      ...current,
      { ...createEmptyConfEntry(true, section || ""), testCaseNo: `TC${String(current.length + 1).padStart(3, "0")}` },
    ]);
  };

  const clearConfEntries = async () => {
    setConfEntries([{ ...createEmptyConfEntry(), testCaseNo: "TC001" }]);
    // Clear All hanya mengosongkan tabel — config (Target Page ID, Jira Server ID) dipertahankan.
    setConfig({ ...config });
  };

  const updateConfEntry = (id: string, field: string, value: any) => {
    setConfEntries((current) => current.map((e) => e.id === id ? { ...e, [field]: value, isDirty: true } : e));
  };

  const removeConfEntry = (id: string) => {
    setConfEntries((current) => {
      const entry = current.find((item) => item.id === id);
      if (typeof entry?.sourceTableIndex === "number") {
        setDeletedConfTableIndices((indices) =>
          indices.includes(entry.sourceTableIndex) ? indices : [...indices, entry.sourceTableIndex]
        );
      }
      return current.filter((e) => e.id !== id);
    });
  };

  const fetchConfSteps = async (id: string, issueKey: string) => {
    if (!issueKey) return;
    setConfFetchingSteps(prev => new Set(prev).add(id));
    try {
      const result = await window.qaBuddy.fetchTestSteps(issueKey);
      if (result) {
        const VALID_CATEGORIES = ["TC_HAPPY", "TC_UNHAPPY", "TC_REGRESSION"];
        const matchedCategory = result.labels?.find((l) => VALID_CATEGORIES.includes(l));
        const jiraBaseUrl = config?.jira?.baseUrl?.replace(/\/$/, "") ?? "";
        const browseUrl = jiraBaseUrl ? `${jiraBaseUrl}/browse/${issueKey}` : issueKey;
        const scenarioLines = [result.summary, browseUrl].filter((s) => s && s.trim());
        setConfEntries((current) =>
          current.map((e) =>
            e.id === id
              ? {
                  ...e,
                  steps: result.steps,
                  expectedResult: result.expectedResult,
                  // Preserve an existing scenario the user already edited so
                  // the table match (and in-place sync) isn't broken — but if
                  // it's still empty, fill it with summary + Jira macro URL.
                  ...(e.scenario ? {} : { scenario: scenarioLines.join("\n") }),
                  ...(matchedCategory ? { category: matchedCategory } : {}),
                  ...(e.functionName ? {} : (result.functionName ? { functionName: result.functionName } : {})),
                  isDirty: true,
                }
              : e
          )
        );
        const stepsCount = result.steps.split("\n").filter(Boolean).length;
        const resultCount = result.expectedResult.split("\n").filter(Boolean).length;
        addLog("Sync to Confluence", "info", `${issueKey}: ${stepsCount} steps, ${resultCount} expected result berhasil di-fetch dari Xray.`);
        setBanner({ tone: "success", text: `${issueKey}: ${stepsCount} steps, ${resultCount} expected result berhasil di-fetch.` });
      } else {
        addLog("Sync to Confluence", "info", `${issueKey}: Tidak ada test steps di Xray.`);
        setBanner({ tone: "info", text: `${issueKey}: Tidak ada test steps di Xray.` });
      }
    } catch {
      addLog("Sync to Confluence", "error", `${issueKey}: Gagal fetch steps dari Xray.`);
      setBanner({ tone: "error", text: `${issueKey}: Gagal fetch steps dari Xray.` });
    } finally {
      setConfFetchingSteps(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const pushConfEntryToJira = async (id: string, entry: any) => {
    if (!entry.issueKey) return;
    setConfPushingSteps(prev => new Set(prev).add(id));
    try {
      await window.qaBuddy.pushEntryToJira({
        issueKey: entry.issueKey,
        steps: entry.steps || "",
        expectedResult: entry.expectedResult || "",
        inputData: entry.inputData || "",
        category: entry.category || "",
      });

      // Update DB — fire and forget
      try {
        await window.qaBuddy.saveTestCases([{
          tc_key: entry.issueKey,
          te_jira_key: "",
          title: entry.scenario || entry.issueKey,
        }]);
      } catch {
        // DB update failure is non-critical
      }

      addLog("Sync to Confluence", "info", `${entry.issueKey}: Steps & kategori berhasil di-push ke Jira.`);
      setBanner({ tone: "success", text: `${entry.issueKey}: Berhasil di-update ke Jira.` });
    } catch (err: any) {
      addLog("Sync to Confluence", "error", `${entry.issueKey}: Gagal push ke Jira — ${err?.message ?? err}`);
      setBanner({ tone: "error", text: `${entry.issueKey}: Gagal update ke Jira.` });
    } finally {
      setConfPushingSteps(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const updateConfEntryImages = (entryId: string, updater: (images: ConfAttachment[]) => ConfAttachment[]) => {
    setConfEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId) return entry;
        return {
          ...entry,
          images: normalizeConfAttachments(updater(entry.images || [])),
          isDirty: true,
        };
      })
    );
  };

  const handleImagePaste = (id: string, event: React.ClipboardEvent) => {
    const items = event.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const data = e.target?.result as string;
            updateConfEntryImages(id, (images) => [
              ...images,
              createConfAttachment(`image-${Date.now()}-${i}.png`, data, images.length + 1),
            ]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleConfFileAttachment = (entryId: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".png,.jpg,.jpeg,.gif,.pdf,.doc,.docx,.xls,.xlsx";
    input.onchange = (e: any) => {
      const files: FileList | undefined = e.target?.files;
      if (!files?.length) return;
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const data = ev.target?.result as string;
          updateConfEntryImages(entryId, (images) => [
            ...images,
            createConfAttachment(file.name, data, images.length + 1),
          ]);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const handleConfFileDrop = (entryId: string, fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = ev.target?.result as string;
        updateConfEntryImages(entryId, (images) => [
          ...images,
          createConfAttachment(file.name, data, images.length + 1),
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (entryId: string, attachmentId: string) => {
    updateConfEntryImages(entryId, (images) => images.filter((image) => image.id !== attachmentId));
  };

  const moveConfAttachment = (entryId: string, draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    updateConfEntryImages(entryId, (images) => {
      const ordered = normalizeConfAttachments(images);
      const fromIndex = ordered.findIndex((image) => image.id === draggedId);
      const toIndex = ordered.findIndex((image) => image.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return ordered;
      const nextImages = [...ordered];
      const [moved] = nextImages.splice(fromIndex, 1);
      nextImages.splice(toIndex, 0, moved);
      return nextImages;
    });
  };

  const moveConfAttachmentByOffset = (entryId: string, attachmentId: string, offset: -1 | 1) => {
    updateConfEntryImages(entryId, (images) => {
      const ordered = normalizeConfAttachments(images);
      const fromIndex = ordered.findIndex((image) => image.id === attachmentId);
      const toIndex = fromIndex + offset;
      if (fromIndex === -1 || toIndex < 0 || toIndex >= ordered.length) return ordered;
      const nextImages = [...ordered];
      const [moved] = nextImages.splice(fromIndex, 1);
      nextImages.splice(toIndex, 0, moved);
      return nextImages;
    });
  };

  const updateConfAttachmentNote = (entryId: string, attachmentId: string, note: string) => {
    updateConfEntryImages(entryId, (images) =>
      images.map((image) => image.id === attachmentId ? { ...image, note } : image)
    );
  };

  const updateConfAttachmentExpandGroup = (entryId: string, attachmentId: string, expandGroup: string) => {
    updateConfEntryImages(entryId, (images) =>
      images.map((image) => image.id === attachmentId ? { ...image, expandGroup } : image)
    );
  };

  async function extractCases() {
    if (!extractUrl.trim()) {
      setBanner({ tone: "error", text: "Masukkan URL halaman Confluence terlebih dahulu." });
      return;
    }

    const unsubProgress = window.qaBuddy.onExtractionProgress((msg) => setExtractionProgress(msg));
    setExtractLoading(true);
    setExtractedCases([]);
    setExtractMeta({
      title: "Memuat halaman Confluence...",
      sourceUrl: extractUrl.trim(),
      status: "loading",
      count: 0,
    });
    setExtractionProgress("Memulai ekstraksi...");
    try {
      const result = await window.qaBuddy.extractTestCases(extractUrl, extractDepth);
      setExtractedCases(result.testCases);
      const status = result.testCases.length === 0 ? "empty" : result.isFallback ? "fallback" : "success";
      setExtractMeta({
        title: result.pageTitle || "Confluence Page",
        sourceUrl: result.sourceUrl || extractUrl.trim(),
        status,
        count: result.testCases.length,
        isFallback: result.isFallback,
      });
      setBanner(
        status === "fallback"
          ? {
              tone: "info",
              text: `Rule-based fallback mengekstrak ${result.testCases.length} test case karena Ollama tidak tersedia.`,
            }
          : status === "empty"
            ? {
                tone: "info",
                text: "Ekstraksi selesai, tetapi tidak ada test case yang berhasil dibentuk dari halaman tersebut.",
              }
            : {
                tone: "success",
                text: `Berhasil mengekstrak ${result.testCases.length} test case dari requirement.`,
              }
      );
    } catch (error) {
      setExtractMeta({
        title: "Ekstraksi gagal",
        sourceUrl: extractUrl.trim(),
        status: "error",
        count: 0,
      });
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal mengekstrak test case dari Confluence."),
      });
    } finally {
      setExtractLoading(false);
      setExtractionProgress(null);
      unsubProgress();
    }
  }

  async function exportCases() {
    const selected = extractedCases.filter((c) => c.selected);
    if (selected.length === 0) {
      setBanner({ tone: "error", text: "Pilih minimal satu test case untuk di-export." });
      return;
    }
    if (!window.confirm(`Export ${selected.length} test case(s) ke Jira?`)) return;
    setExportLoading(true);
    try {
      const result = await window.qaBuddy.createTestCases(selected);
      const message = result.created.length
        ? `Created ${result.created.length} Jira issue(s): ${result.created.map((item) => item.key).join(", ")}`
        : "Tidak ada test case yang dipilih.";
      setBanner({ tone: "success", text: message });
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal membuat test case di Jira."),
      });
    } finally {
      setExportLoading(false);
    }
  }

  async function handleJqlSearch() {
    if (!generatedJql) return;
    setSearchLoading(true);
    try {
      const issues = await window.qaBuddy.findIssuesByJql(generatedJql, jqlMaxResults);
      setSearchResults(issues);
      setResultsPage(1);
      setSelectedIssueKeys([]);
      setBanner({ tone: "info", text: `Ditemukan ${issues.length} issue.` });
    } catch (error: any) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal mencari issue.") });
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleBulkTransition() {
    if (selectedIssueKeys.length === 0 || !bulkTransitionId) {
      setBanner({ tone: "error", text: "Pilih minimal satu issue dan status transisi." });
      return;
    }
    setBulkLoading("transition");
    try {
      const result = await window.qaBuddy.bulkTransition(selectedIssueKeys, bulkTransitionId);
      addLog("Advanced Jira Organizer", result.failed > 0 ? "error" : "success", `Bulk transition: ${result.success} sukses, ${result.failed} gagal`);
      setBanner({ tone: result.failed > 0 ? "error" : "success", text: `Transition: ${result.success} sukses, ${result.failed} gagal.` });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal bulk transition.") });
    } finally {
      setBulkLoading(null);
    }
  }

  async function handleBulkAssign(assigneeName: string) {
    if (selectedIssueKeys.length === 0 || !assigneeName) {
      setBanner({ tone: "error", text: "Pilih minimal satu issue dan assignee." });
      return;
    }
    setBulkLoading("assign");
    try {
      const result = await window.qaBuddy.bulkAssign(selectedIssueKeys, assigneeName);
      addLog("Advanced Jira Organizer", result.failed > 0 ? "error" : "success", `Bulk assign: ${result.success} sukses, ${result.failed} gagal`);
      setBanner({ tone: result.failed > 0 ? "error" : "success", text: `Assign: ${result.success} sukses, ${result.failed} gagal.` });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal bulk assign.") });
    } finally {
      setBulkLoading(null);
    }
  }

  async function handleBulkAddLabels(labels: string) {
    if (selectedIssueKeys.length === 0 || !labels.trim()) {
      setBanner({ tone: "error", text: "Pilih minimal satu issue dan masukkan label." });
      return;
    }
    setBulkLoading("labels");
    try {
      const labelArr = labels.split(",").map(l => l.trim()).filter(Boolean);
      const result = await window.qaBuddy.bulkAddLabels(selectedIssueKeys, labelArr);
      addLog("Advanced Jira Organizer", result.failed > 0 ? "error" : "success", `Bulk labels: ${result.success} sukses, ${result.failed} gagal`);
      setBanner({ tone: result.failed > 0 ? "error" : "success", text: `Labels: ${result.success} sukses, ${result.failed} gagal.` });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal bulk labels.") });
    } finally {
      setBulkLoading(null);
    }
  }

  function toggleSelectAllIssues() {
    if (selectedIssueKeys.length === searchResults.length) {
      setSelectedIssueKeys([]);
    } else {
      setSelectedIssueKeys(searchResults.map(i => i.key));
    }
  }

  function toggleSelectIssue(key: string) {
    setSelectedIssueKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  async function flushTokensOnLogout() {
    try {
      const clearedConfig = {
        ...config,
        jira: { ...config.jira, token: "" },
        confluence: { ...config.confluence, token: "" },
      };
      await window.qaBuddy.saveConfig(clearedConfig);
    } catch {
      // best-effort — logout proceeds regardless
    }
  }

  async function saveSettings() {
    setSaveAllLoading(true);
    try {
      const saved = await window.qaBuddy.saveConfig(config);
      setConfig(saved);

      // Sync API tokens to users table in DB
      if (loggedInUser) {
        void window.qaBuddy.updateUserTokens(
          loggedInUser,
          config.jira.token,
          config.confluence.token,
        ).catch(() => { /* best-effort */ });
      }

      setBanner({ tone: "success", text: "Konfigurasi berhasil disimpan." });

      // Refresh dashboard in background — don't block the save
      window.qaBuddy.getDashboard({ skipInsight: true })
        .then((nextDashboard) => setDashboard(nextDashboard))
        .catch(() => { /* dashboard refresh is best-effort */ });
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal menyimpan konfigurasi."),
      });
    } finally {
      setSaveAllLoading(false);
    }
  }

  async function saveDashboardConfig(projects: DashboardProjectConfig[]) {
    const newConfig = { ...config, dashboard: { projects } };
    try {
      const saved = await window.qaBuddy.saveConfig(newConfig);
      setConfig(saved);
      setDashboardProjects(projects);
      document.body.style.overflow = "";
      setShowDashboardConfig(false);
      setBanner({ tone: "success", text: "Konfigurasi Dashboard berhasil disimpan." });
      setDashboardLoading(true);
      window.qaBuddy.getDashboard({ skipInsight: true })
        .then((nextDashboard) => {
          setDashboard(nextDashboard);
          setDashboardLoading(false);
        })
        .catch(() => {
          setDashboardLoading(false);
        });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal menyimpan konfigurasi Dashboard.") });
    }
  }

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateChecking(true);
    try {
      const info = await window.qaBuddy.checkForUpdates();
      setUpdateInfo(info);
      if (info.updateAvailable) {
        setBanner({ tone: "success", text: `Update baru tersedia: versi ${info.latestVersion}.` });
      } else if (info.error) {
        setBanner({ tone: "error", text: info.error });
      } else {
        setBanner({ tone: "success", text: "Aplikasi sudah menggunakan versi terbaru." });
      }
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal memeriksa update.") });
    } finally {
      setUpdateChecking(false);
    }
  }, []);

  const handleDownloadAndInstall = useCallback(async () => {
    setDownloadingUpdate(true);
    setDownloadProgress(0);
    setShowDetailedProgress(true);

    const cleanup = window.qaBuddy.onDownloadProgress((p) => {
      setDownloadProgress(p.progress);
    });

    try {
      await window.qaBuddy.downloadAndInstallUpdate();
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal mengunduh dan memasang update."),
      });
      setDownloadingUpdate(false);
      setDownloadProgress(null);
    } finally {
      cleanup();
    }
  }, []);

  return {
    activeView,
    setActiveView,
    settingsTab,
    setSettingsTab,
    updateInfo,
    setUpdateInfo,
    updateChecking,
    handleCheckForUpdates,
    loading,
    setLoading,
    config,
    setConfig,
    status,
    setStatus,
    dashboard,
    setDashboard,
    dashboardLoading,
    setDashboardLoading,
    connectionLoading,
    setConnectionLoading,
    saveAllLoading,
    setSaveAllLoading,
    ticketSearch,
    setTicketSearch,
    currentPage,
    setCurrentPage,
    rowsPerPage,
    setRowsPerPage,
    chatMessages,
    setChatMessages,
    chatPrompt,
    setChatPrompt,
    chatLoading,
    setChatLoading,
    extractUrl,
    setExtractUrl,
    extractDepth,
    setExtractDepth,
    extractedCases,
    setExtractedCases,
    extractMeta,
    setExtractMeta,
    extractLoading,
    setExtractLoading,
    exportLoading,
    setExportLoading,
    extractionProgress,
    banner,
    setBanner,
    logs,
    setLogs,
    healthcheckLoading,
    setHealthcheckLoading,
    healthcheckResult,
    setHealthcheckResult,
    executionStats,
    setExecutionStats,
    executionHistory,
    setExecutionHistory,
    executionLoading,
    setExecutionLoading,
    executionForm,
    setExecutionForm,
    showJiraToken,
    setShowJiraToken,
    showConfluenceToken,
    setShowConfluenceToken,
    ollamaModels,
    setOllamaModels,
    chatAttachments,
    setChatAttachments,
    modelsLoading,
    setModelsLoading,
    manualLoading,
    setManualLoading,
    progressHidden,
    setProgressHidden,
    aiLoading,
    setAiLoading,
    manualTab,
    setManualTab,
    jiraDisplayName,
    loggedInUser,
    manualCases,
    setManualCases,
    organizeSource,
    setOrganizeSource,
    organizeFolder,
    setOrganizeFolder,
    organizeProjectKey,
    setOrganizeProjectKey,
    organizeXrayFolders,
    organizeFolderLoading,
    manualProjectKey,
    setManualProjectKey,
    manualXrayFolders,
    manualFolderLoading,
    refreshManualXrayFolders,
    manualDuplicateResults,
    manualPendingDuplicates,
    setManualPendingDuplicates,
    showManualDuplicateModal,
    setShowManualDuplicateModal,
    checkManualDuplicate,
    confirmManualSubmitWithDuplicates,
    confImportMode,
    setConfImportMode,
    confImportUrl,
    setConfImportUrl,
    confImportJql,
    setConfImportJql,
    confImportEntries,
    setConfImportEntries,
    confImportLoading,
    setConfImportLoading,
    confImportResult,
    setConfImportResult,
    confImportJqlMatched,
    setConfImportJqlMatched,
    confImportJqlMatchedIds,
    setConfImportJqlMatchedIds,
    updateConfImportEntryKey,
    fetchAndSetStepsForEntry,
    confImportFetchingSteps,
    confImportProjectKey,
    setConfImportProjectKey,
    confImportXrayFolders,
    confImportFolderLoading,
    confImportSelectedFolder,
    setConfImportSelectedFolder,
    testRepositoryProjects,
    jiraProjects,
    setJiraProjects,
    jiraBoards,
    setJiraBoards,
    jiraSprints,
    setJiraSprints,
    jiraStatuses,
    setJiraStatuses,
    jiraIssueTypes,
    setJiraIssueTypes,
    jiraCustomFields,
    setJiraCustomFields,
    jqlProject,
    setJqlProject,
    jqlBoard,
    setJqlBoard,
    jqlSprint,
    setJqlSprint,
    jqlStatus,
    setJqlStatus,
    jqlIssueType,
    setJqlIssueType,
    jqlAssignee,
    setJqlAssignee,
    jqlCustomFieldFilters,
    setJqlCustomFieldFilters,
    jqlLabelFilters,
    setJqlLabelFilters,
    jqlKey,
    setJqlKey,
    generatedJql,
    setGeneratedJql,
    searchResults,
    setSearchResults,
    selectedIssueKeys,
    setSelectedIssueKeys,
    searchLoading,
    setSearchLoading,
    filtersLoading,
    setFiltersLoading,
    resultsPage,
    setResultsPage,
    jqlMaxResults,
    setJqlMaxResults,
    bulkLoading,
    setBulkLoading,
    bulkTransitionId,
    setBulkTransitionId,
    customFieldOptions,
    ragStats,
    ragLoading,
    ragProgress,
    ragSyncSpace,
    setRagSyncSpace,
    ragSyncProject,
    setRagSyncProject,
    confLoading,
    confProgressHidden,
    setConfProgressHidden,
    confPageLoading,
    confAttachmentHydrating,
    confParseStatus,
    confParseProgress,
    confSyncProgress,
    confSyncSteps,
    confEntries,
    confSections,
    setConfEntries,
    deletedConfTableIndices,
    setDeletedConfTableIndices,
    draggedAttachment,
    setDraggedAttachment,
    filteredReadyForQa,
    totalPages,
    paginatedReadyForQa,
    addLog,
    recentSummaries,
    selectedCaseCount,
    pageResults,
    jqlTotalPages,
    connectionPills,
    handleRagIndexConfluence,
    handleRagIndexJira,
    handleRagClear,
    handleRagClearBitbucket,
    refreshDashboard,
    runConnectionTest,
    runHealthcheck,
    recordExecution,
    loadExecutionTracking,
    submitChat,
    submitManualCases,
    addManualCase,
    removeManualCase,
    updateManualCase,
    generateWithAi,
    handleFileUpload,
    downloadTemplate,
    downloadConfTemplate,
    submitOrganize,
    fetchConfImportEntries,
    searchJiraForImport,
    toggleConfImportEntry,
    toggleAllConfImportEntries,
    submitUpdateFromConfluence,
    confirmStepConflictUpdate,
    stepConflictCheck,
    setStepConflictCheck,
    stepConflictMode,
    setStepConflictMode,
    updateProgress,
    showUpdateProgress,
    setShowUpdateProgress,
    parseConfPageEntries,
    loadConfPageAttachments,
    syncConfluence,
    handleConfFileUpload,
    addConfEntry,
    clearConfEntries,
    updateConfEntry,
    removeConfEntry,
    fetchConfSteps,
    confFetchingSteps,
    pushConfEntryToJira,
    confPushingSteps,
    updateConfEntryImages,
    handleImagePaste,
    handleConfFileAttachment,
    handleConfFileDrop,
    removeImage,
    moveConfAttachment,
    moveConfAttachmentByOffset,
    updateConfAttachmentNote,
    updateConfAttachmentExpandGroup,
    extractCases,
    exportCases,
    handleJqlSearch,
    handleBulkTransition,
    handleBulkAssign,
    handleBulkAddLabels,
    toggleSelectAllIssues,
    toggleSelectIssue,
    flushTokensOnLogout,
    saveSettings,
    downloadProgress,
    setDownloadProgress,
    downloadingUpdate,
    setDownloadingUpdate,
    showDetailedProgress,
    setShowDetailedProgress,
    showDashboardConfig,
    setShowDashboardConfig,
    dashboardProjects,
    setDashboardProjects,
    saveDashboardConfig,
    handleDownloadAndInstall,
    defectSources,
    defectSearchQuery,
    setDefectSearchQuery,
    defectCandidates,
    defectSearchResults,
    defectSearching,
    defectSyncing,
    defectStats,
    defectViewDefect,
    defectViewRelations,
    defectShowNewSource,
    setDefectShowNewSource,
    defectFilters,
    setDefectFilters,
    defectTab,
    setDefectTab,
    defectDuplicateTab,
    setDefectDuplicateTab,
    loadDefectSources,
    loadDefectStats,
    handleDefectSync,
    handleDefectSearch,
    loadAllDefects,
    handleDefectViewDetail,
    handleDefectMarkDuplicate,
    handleDefectRemoveDuplicate,
    handleDefectSaveSource,
    handleDefectDeleteSource,
    uqaIssues,
    uqaSyncing,
    uqaSyncProgress,
    loadUqaIssuesFromStore,
    syncUqaIssues,
    brdGenerating,
    brdTestCases,
    setBrdTestCases,
    brdGenerationResult,
    setBrdGenerationResult,
    brdGeneratedExecId,
    setBrdGeneratedExecId,
    brdChunkProgress,
    handleBrdGenerate,
  };
}
