import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppBootstrap,
  AppConfig,
  BugFormDraft,
  BugPreview,
  BulkOperationResult,
  ChatResponse,
  ConfluenceTestImportEntry,
  ConnectionStatus,
  ConnectionStatusItem,
  ConfluencePreviewResult,
  ParseConfluenceParseDebugReport,
  ParseConfluenceEntriesResult,
  DashboardDigest,
  ExtractedTestCase,
  ExtractionDepth,
  JiraBoard,
  JiraIssueSummary,
  JiraProject,
  JiraSprint,
  JiraStatus,
  ManualTestCase,
  RagIndexProgress,
  RagStats,
  StepConflictMode,
  TestCaseExecution,
  UpdateProgress,
  UpdateInfo,
  UpdateTestCasesFromConfluenceResult,
  ViewKey,
  ChatHistoryMessage,
  XrayFolder,
} from "@shared/types";
import { defaultConfig } from "@shared/types";
import * as XLSX from "xlsx";

import jiraIcon from "../assets/jira.png";
import confluenceIcon from "../assets/confluence.png";
import ollamaIcon from "../assets/ollama.png";

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  attachments?: string[];
};

export type LogEntry = {
  id: string;
  time: string;
  source: "Sync to Confluence" | "Submit to Jira" | "Xray Organizer" | "Advanced Jira Organizer" | "Update from Confluence";
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

const emptyPreview: BugPreview = {
  summary: "",
  description: "",
  priority: "Medium",
  labels: [],
};

const initialBugDraft: BugFormDraft = {
  title: "",
  stepsToReproduce: "",
  actualResult: "",
  expectedResult: "",
  environment: "",
  priority: "Medium",
  labels: "qa-buddy",
};

const emptyStatus: ConnectionStatus = {
  jira: { ok: false, message: "Belum diuji" },
  confluence: { ok: false, message: "Belum diuji" },
  ollama: { ok: false, message: "Belum diuji" },
};

function createEmptyConfEntry(isDirty = true) {
  return {
    id: crypto.randomUUID(),
    testCaseNo: "",
    functionName: "",
    scenario: "",
    category: "Positive",
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

export function useAppState() {
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
  const [bugDraft, setBugDraft] = useState<BugFormDraft>(initialBugDraft);
  const [bugPreview, setBugPreview] = useState<BugPreview>(emptyPreview);
  const [bugLoading, setBugLoading] = useState(false);
  const [extractUrl, setExtractUrl] = useState("");
  const [extractDepth, setExtractDepth] = useState<ExtractionDepth>("comprehensive");
  const [extractedCases, setExtractedCases] = useState<ExtractedTestCase[]>([]);
  const [extractMeta, setExtractMeta] = useState<{ title: string; sourceUrl: string } | null>(null);
  const [extractLoading, setExtractLoading] = useState(false);
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
  const [manualTab, setManualTab] = useState<"creator" | "organizer" | "update-from-conf">("creator");
  const [manualCases, setManualCases] = useState<ManualTestCase[]>([
    { id: crypto.randomUUID(), title: "", description: "", steps: "", expectedResult: "", xrayFolder: "", labels: "" }
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

  // Advanced Jira Organizer state
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [jiraBoards, setJiraBoards] = useState<JiraBoard[]>([]);
  const [jiraSprints, setJiraSprints] = useState<JiraSprint[]>([]);
  const [jiraStatuses, setJiraStatuses] = useState<JiraStatus[]>([]);
  const [jiraIssueTypes, setJiraIssueTypes] = useState<string[]>([]);
  const [jiraCustomFields, setJiraCustomFields] = useState<{ id: string; name: string; type: string; isCustom: boolean }[]>([]);
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

  const [confTab, setConfTab] = useState<"form" | "settings">("form");
  const [confLoading, setConfLoading] = useState(false);
  const [confProgressHidden, setConfProgressHidden] = useState(false);
  const [confPagePreview, setConfPagePreview] = useState<{ title: string; content: string; version: number } | null>(null);
  const [confPageLoading, setConfPageLoading] = useState(false);
  const [confSyncPreview, setConfSyncPreview] = useState<ConfluencePreviewResult | null>(null);
  const [confPreviewLoading, setConfPreviewLoading] = useState(false);
  const [confParseStatus, setConfParseStatus] = useState<ParseConfluenceEntriesResult | null>(null);
  const [confEntries, setConfEntries] = useState<any[]>([createEmptyConfEntry()]);
  const [confFetchingSteps, setConfFetchingSteps] = useState<Set<string>>(new Set());
  const [deletedConfTableIndices, setDeletedConfTableIndices] = useState<number[]>([]);
  const [draggedAttachment, setDraggedAttachment] = useState<{ entryId: string; attachmentId: string } | null>(null);

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

  const applyBootstrap = useCallback((bootstrap: AppBootstrap) => {
    setConfig(bootstrap.config);
    setStatus(bootstrap.status);
    setDashboard(bootstrap.dashboard);
    setRagSyncSpace(bootstrap.config.confluence.spaceKey || "");
    setRagSyncProject(bootstrap.config.jira.projectKey || "");
  }, []);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const bootstrap = await window.qaBuddy.bootstrap();
      applyBootstrap(bootstrap);
      const loadedLogs = await window.qaBuddy.getLogs();
      setLogs(loadedLogs || []);
      const info = await window.qaBuddy.getUpdateStatus().catch(() => null);
      if (info) setUpdateInfo(info);
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal memuat bootstrap aplikasi."),
      });
    } finally {
      setLoading(false);
    }
  }, [applyBootstrap]);

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
              for (const key of ["jqlModel", "chatModel", "extractionModel", "insightModel"] as const) {
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

  // Load Jira metadata when viewing Advanced Jira Organizer or Manual Test Case
  useEffect(() => {
    const needsProjects = activeView === "advanced-jira-organizer" ||
      (activeView === "manual-test-case");
    if (!needsProjects) return;
    if (!config.jira.baseUrl || !config.jira.token) return;

    setFiltersLoading(true);
    Promise.all([
      window.qaBuddy.getJiraProjects().catch(() => [] as JiraProject[]),
      window.qaBuddy.getJiraStatuses().catch(() => [] as JiraStatus[]),
      window.qaBuddy.getJiraIssueTypes().catch(() => [] as string[]),
      window.qaBuddy.getJiraCustomFields().catch(() => [] as { id: string; name: string; type: string; isCustom: boolean }[]),
    ]).then(([projects, statuses, issueTypes, customFields]) => {
      setJiraProjects(projects);
      setJiraStatuses(statuses);
      setJiraIssueTypes(issueTypes);
      setJiraCustomFields(customFields);
      setFiltersLoading(false);
    }).catch(() => setFiltersLoading(false));
  }, [activeView, config.jira.baseUrl, config.jira.token, config.jira.projectKey]);

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
    setOrganizeFolderLoading(true);
    setOrganizeFolder("");
    window.qaBuddy.getXrayFolders(organizeProjectKey)
      .then(setOrganizeXrayFolders)
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
    setConfImportFolderLoading(true);
    setConfImportSelectedFolder("");
    window.qaBuddy.getXrayFolders(confImportProjectKey)
      .then(setConfImportXrayFolders)
      .catch(() => setConfImportXrayFolders([]))
      .finally(() => setConfImportFolderLoading(false));
  }, [confImportProjectKey]);

  // Fetch Xray folders for Manual Test Case Creator when project changes
  useEffect(() => {
    if (!manualProjectKey) {
      setManualXrayFolders([]);
      return;
    }
    setManualFolderLoading(true);
    window.qaBuddy.getXrayFolders(manualProjectKey)
      .then(setManualXrayFolders)
      .catch(() => setManualXrayFolders([]))
      .finally(() => setManualFolderLoading(false));
  }, [manualProjectKey]);

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
    setChatMessages((current) => [...current, { role: "user", text: prompt, attachments: chatAttachments.map(a => a.name) }]);
    setChatPrompt("");

    let finalPrompt = prompt;
    if (chatAttachments.length > 0) {
      const attachmentsText = chatAttachments.map(a => `[Lampiran File: ${a.name}]\n${a.text}`).join("\n\n---\n\n");
      finalPrompt = `${attachmentsText}\n\n---\n\n${prompt}`.trim();
    }
    setChatAttachments([]);

    // Build conversation history from previous messages (last 10 pairs)
    const history = chatMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.text,
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

  async function polishBug() {
    setBugLoading(true);
    try {
      const preview = await window.qaBuddy.polishBugReport(bugDraft);
      setBugPreview(preview);
      setBanner({ tone: "success", text: "Preview bug report berhasil diperbarui." });
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal memproses preview bug report."),
      });
    } finally {
      setBugLoading(false);
    }
  }

  async function submitBug() {
    setBugLoading(true);
    try {
      const preview = bugPreview.summary ? bugPreview : await window.qaBuddy.polishBugReport(bugDraft);
      setBugPreview(preview);
      const result = await window.qaBuddy.createBug(bugDraft, preview);
      setBanner({ tone: "success", text: `Bug created: ${result.key}` });
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal membuat bug di Jira."),
      });
    } finally {
      setBugLoading(false);
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
      const result = await window.qaBuddy.createManualTestCases(casesToSubmit);
      setBanner({
        tone: "success",
        text: `Berhasil membuat ${result.created.length} test case di Jira.`
      });
      addLog("Submit to Jira", "success", `Berhasil membuat ${result.created.length} test case di Jira`, result.created.map(c => c.key).join(", "));
      setManualCases([{ id: crypto.randomUUID(), title: "", description: "", steps: "", expectedResult: "", xrayFolder: "", labels: "" }]);
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

    // Check duplicates before submit
    try {
      const allIssues = await window.qaBuddy.findTestCasesByJql(
        `project = "${manualProjectKey}" AND issuetype = Test`,
        500
      );

      const duplicates: Record<string, { key: string; summary: string; score: number }[]> = {};
      for (const c of manualCases) {
        if (!c.title.trim()) continue;
        const match = findBestMatch(c.title, allIssues);
        duplicates[c.id] = match ? [{ key: match.key, summary: match.summary, score: 1 }] : [];
      }

      const newResults: typeof manualDuplicateResults = {};
      for (const [id, matches] of Object.entries(duplicates)) {
        newResults[id] = { matches, checked: true };
      }
      setManualDuplicateResults(prev => ({ ...prev, ...newResults }));

      const hasDuplicates = Object.values(duplicates).some(arr => arr.length > 0);
      if (hasDuplicates) {
        setManualPendingDuplicates(duplicates);
        setShowManualDuplicateModal(true);
        return;
      }

      await doSubmitManualCases();
    } catch {
      // If duplicate check fails, allow direct submit
      setBanner({ tone: "info", text: "Pemeriksaan duplikat gagal — melanjutkan submit." });
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
      { id: crypto.randomUUID(), title: "", description: "", steps: "", expectedResult: "", xrayFolder: "", labels: "" }
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

  const checkManualDuplicate = async (id: string, title: string) => {
    if (!title.trim() || !manualProjectKey) {
      setManualDuplicateResults(prev => ({ ...prev, [id]: { matches: [], checked: true } }));
      return;
    }
    try {
      const escaped = title.replace(/["']/g, "").trim();
      const issues = await window.qaBuddy.findTestCasesByJql(
        `project = "${manualProjectKey}" AND issuetype = Test AND summary ~ "${escaped}"`,
        5
      );
      const match = findBestMatch(title, issues);
      setManualDuplicateResults(prev => ({
        ...prev,
        [id]: {
          matches: match ? [{ key: match.key, summary: match.summary, score: 1 }] : [],
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
    reader.onload = (e) => {
      try {
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
          labels: row.Labels || row.labels || row.Tags || row.tags || ""
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

  const downloadTemplate = () => {
    const templateData = [
      {
        Title: "Sample Test Case Title",
        Description: "Describe the objective of this test case",
        Steps: "1. Step one\n2. Step two\n3. Step three",
        ExpectedResult: "What should happen after the steps",
        Folder: "/Project/Folder/Path",
        Labels: "login, auth, p1"
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

  const downloadConfTemplate = () => {
    const templateData = [
      {
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
      const result = await window.qaBuddy.parseConfluenceEntries(pageId);
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
        };
      });

      setConfImportEntries(entries);
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
          id: "", key: i.key, summary: i.summary, status: "", priority: "", assignee: "", type: "", url: "",
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

  async function loadConfPagePreview() {
    const pageId = config.confluence.targetPageId.trim();
    if (!pageId) {
      setBanner({ tone: "error", text: "Masukkan Target Page ID terlebih dahulu." });
      return;
    }
    setConfPageLoading(true);
    setConfPagePreview(null);
    try {
      const preview = await window.qaBuddy.getConfluencePage(pageId);
      setConfPagePreview(preview);
      setBanner({ tone: "success", text: `Page "${preview.title}" berhasil dimuat.` });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal memuat page Confluence.") });
    } finally {
      setConfPageLoading(false);
    }
  }

  async function previewConfluenceSync() {
    const pageId = config.confluence.targetPageId.trim();
    if (!pageId) {
      setBanner({ tone: "error", text: "Masukkan Target Page ID terlebih dahulu." });
      return;
    }
    const previewEntries = confEntries.filter((entry) => entry.isDirty);
    setConfPreviewLoading(true);
    setConfSyncPreview(null);
    try {
      const result = await window.qaBuddy.previewConfluenceSync(pageId, {
        entries: previewEntries.length > 0 ? previewEntries : confEntries,
      });
      setConfSyncPreview(result);
      setBanner({ tone: "success", text: `Preview sync siap: ${result.entryCount} entry akan dikirim.` });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal menyiapkan preview sync Confluence.") });
    } finally {
      setConfPreviewLoading(false);
    }
  }

  async function parseConfPageEntries() {
    const pageId = config.confluence.targetPageId.trim();
    if (!pageId) {
      setBanner({ tone: "error", text: "Masukkan Target Page ID terlebih dahulu." });
      return;
    }
    const resolvedPageId = pageId;
    setConfPageLoading(true);
    setConfParseStatus(null);
    try {
      const result = await window.qaBuddy.parseConfluenceEntries(pageId);
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
        e.images = normalizeConfAttachments(
          (e.images || []).map((image: any, index: number) => ({
            id: image.id || crypto.randomUUID(),
            name: image.name,
            data: image.data || "",
            order: typeof image.order === "number" ? image.order : index + 1,
            note: image.note || "",
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
      setConfTab("form");
      setBanner({
        tone: "success",
        text: `Berhasil memuat ${entriesList.length} entry dari halaman "${effectiveResult.pageTitle || effectiveResult.pageId}".${effectiveResult.jiraServerId ? ` Jira Server ID terdeteksi: ${effectiveResult.jiraServerId}.` : ""}`,
      });
    } catch (error) {
      setBanner({ tone: "error", text: toErrorMessage(error, "Gagal parse entries dari Confluence.") });
    } finally {
      setConfPageLoading(false);
    }
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
    try {
      const result = await window.qaBuddy.syncToConfluence(pageId, {
        entries: dirtyEntries,
        deletedTableIndices: deletedConfTableIndices,
      });
      const refreshed = await window.qaBuddy.parseConfluenceEntries(pageId);
      const effectiveRefreshed = { ...refreshed, pageId: refreshed.pageId || pageId };
      setConfParseStatus(effectiveRefreshed);
      if (effectiveRefreshed.contentLoaded) {
        effectiveRefreshed.entries.forEach((entry: any) => {
          entry.id = crypto.randomUUID();
          entry.isDirty = false;
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
      setBanner(
        effectiveRefreshed.contentLoaded
          ? {
              tone: "success",
              text: `Berhasil sync ${result.entryCount} entry yang berubah (${result.imageCount} gambar, ${result.attachmentCount} lampiran) ke "${result.pageTitle}".`,
            }
          : {
              tone: "error",
              text: `Sync berhasil, tetapi page "${effectiveRefreshed.pageId}" tidak bisa dibaca ulang${effectiveRefreshed.error ? `: ${effectiveRefreshed.error}` : "."}`,
            }
      );
      addLog(
        "Sync to Confluence",
        effectiveRefreshed.contentLoaded ? "success" : "error",
        effectiveRefreshed.contentLoaded
          ? `Sync ${result.entryCount} entry yang berubah ke "${result.pageTitle}"`
          : `Sync berhasil, tetapi page "${effectiveRefreshed.pageId}" tidak bisa dibaca ulang`,
        effectiveRefreshed.contentLoaded
          ? `${result.imageCount} gambar, ${result.attachmentCount} lampiran diupload`
          : effectiveRefreshed.error || "Content not loaded"
      );
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

  const addConfEntry = () => {
    setConfEntries((current) => [
      ...current,
      createEmptyConfEntry()
    ]);
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
        setConfEntries((current) =>
          current.map((e) =>
            e.id === id ? { ...e, steps: result.steps, expectedResult: result.expectedResult, isDirty: true } : e
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
              createConfAttachment(`image-${Date.now()}.png`, data, images.length + 1),
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
    input.accept = ".png,.jpg,.jpeg,.gif,.pdf,.doc,.docx,.xls,.xlsx";
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = ev.target?.result as string;
        updateConfEntryImages(entryId, (images) => [
          ...images,
          createConfAttachment(file.name, data, images.length + 1),
        ]);
      };
      reader.readAsDataURL(file);
    };
    input.click();
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

  async function extractCases() {
    if (!extractUrl.trim()) {
      setBanner({ tone: "error", text: "Masukkan URL halaman Confluence terlebih dahulu." });
      return;
    }

    setExtractLoading(true);
    try {
      const result = await window.qaBuddy.extractTestCases(extractUrl, extractDepth);
      setExtractedCases(result.testCases);
      setExtractMeta({ title: result.pageTitle, sourceUrl: result.sourceUrl });
      setBanner({
        tone: "success",
        text: `Berhasil mengekstrak ${result.testCases.length} test case dari requirement.`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal mengekstrak test case dari Confluence."),
      });
    } finally {
      setExtractLoading(false);
    }
  }

  async function exportCases() {
    try {
      const result = await window.qaBuddy.createTestCases(extractedCases);
      const message = result.created.length
        ? `Created ${result.created.length} Jira issue(s): ${result.created.map((item) => item.key).join(", ")}`
        : "Tidak ada test case yang dipilih.";
      setBanner({ tone: "success", text: message });
      startTransition(() => setActiveView("settings"));
    } catch (error) {
      setBanner({
        tone: "error",
        text: toErrorMessage(error, "Gagal membuat test case di Jira."),
      });
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

  async function saveSettings() {
    setSaveAllLoading(true);
    try {
      const saved = await window.qaBuddy.saveConfig(config);
      setConfig(saved);
      setBanner({ tone: "success", text: "Konfigurasi berhasil disimpan." });

      // Refresh dashboard in background — don't block the save
      window.qaBuddy.getDashboard()
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
    bugDraft,
    setBugDraft,
    bugPreview,
    setBugPreview,
    bugLoading,
    setBugLoading,
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
    confTab,
    setConfTab,
    confLoading,
    confProgressHidden,
    setConfProgressHidden,
    confPagePreview,
    setConfPagePreview,
    confPageLoading,
    confSyncPreview,
    confPreviewLoading,
    confParseStatus,
    confEntries,
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
    refreshDashboard,
    runConnectionTest,
    runHealthcheck,
    recordExecution,
    loadExecutionTracking,
    submitChat,
    polishBug,
    submitBug,
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
    loadConfPagePreview,
    previewConfluenceSync,
    parseConfPageEntries,
    syncConfluence,
    handleConfFileUpload,
    addConfEntry,
    updateConfEntry,
    removeConfEntry,
    fetchConfSteps,
    confFetchingSteps,
    updateConfEntryImages,
    handleImagePaste,
    handleConfFileAttachment,
    removeImage,
    moveConfAttachment,
    moveConfAttachmentByOffset,
    updateConfAttachmentNote,
    extractCases,
    exportCases,
    handleJqlSearch,
    handleBulkTransition,
    handleBulkAssign,
    handleBulkAddLabels,
    toggleSelectAllIssues,
    toggleSelectIssue,
    saveSettings,
    downloadProgress,
    setDownloadProgress,
    downloadingUpdate,
    setDownloadingUpdate,
    showDetailedProgress,
    setShowDetailedProgress,
    handleDownloadAndInstall,
  };
}
