/**
 * Tauri bridge — implements the `DesktopApi` interface against the Rust backend
 * using `@tauri-apps/api`'s `invoke`/`listen`, and assigns it to
 * `window.qaBuddy` so the existing renderer code (which calls `window.qaBuddy.*`)
 * works unchanged after the Electron → Tauri migration.
 *
 * Each method maps 1:1 to a `#[tauri::command]` in `src-tauri/src/commands/`.
 * Push events are delivered via Tauri event channels whose names match the old
 * Electron IPC channels (`rag-progress`, `uqa-reminder-pushed`, …).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import type {
  AppBootstrap,
  AppConfig,
  AutoUqaGeneratedPayload,
  BugFormDraft,
  BugPreview,
  BulkOperationResult,
  ChatHistoryMessage,
  ChatResponse,
  ConfluencePreviewResult,
  ConfluenceTestImportEntry,
  ConnectionStatus,
  DashboardDigest,
  DefectCreateDraft,
  DefectRecord,
  DefectRepositoryStats,
  DuplicateCandidate,
  DuplicateRelation,
  ExtractedTestCase,
  ExtractedTestCaseResult,
  ExtractionDepth,
  FetchTestStepsResult,
  JiraBoard,
  JiraIssueSummary,
  BRDGenerationRequest,
  BRDGenerationResult,
  BRDTestCase,
  BrdChunkProgress,
  ExecutionMonitoringData,
  JiraProject,
  JiraProjectSource,
  SemanticSearchResult,
  TestExecution,
  TestPlan,
  JiraSprint,
  JiraStatus,
  JiraUser,
  ManualTestCase,
  OcrResult,
  ParseConfluenceEntriesOptions,
  ParseConfluenceEntriesResult,
  PerIssueReminder,
  ProjectInsightRequest,
  RagIndexProgress,
  RagStats,
  SearchFilters,
  StepConflictCheck,
  StepConflictMode,
  SyncToConfluencePayload,
  SyncToConfluenceResult,
  TestCaseExecution,
  UqaConfig,
  UqaIssue,
  UqaSyncProgress,
  UqaTransition,
  UpdateInfo,
  UpdateProgress,
  UpdateTestCasesFromConfluenceResult,
  XrayExecutionDetails,
  XrayExecutionSnapshot,
  XrayFolder,
} from "@shared/types";

/** Subscribe to a Tauri event, returning an unsubscribe function. */
function on<T>(event: string, callback: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  listen<T>(event, (e) => callback(e.payload))
    .then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    })
    .catch(() => {
      /* swallow — event backend may not be registered yet */
    });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Invoke a command, converting snake_case command names automatically. */
function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(name, args);
}

// ── The DesktopApi implementation ───────────────────────────────────────

const api = {
  // Bootstrap / config
  bootstrap: () => cmd<AppBootstrap>("bootstrap"),
  saveConfig: (config: AppConfig) => cmd<AppConfig>("save_config", { config }),
  testConnections: () => cmd<ConnectionStatus>("test_connections"),
  healthcheck: () => cmd<unknown>("healthcheck"),

  // Dashboard
  getDashboard: (options?: { skipInsight?: boolean }) =>
    cmd<DashboardDigest>("get_dashboard", { skipInsight: options?.skipInsight ?? false }),
  getProjectInsight: (request: ProjectInsightRequest) =>
    cmd<string>("get_project_insight", { request }),

  // Chat assistant
  askAssistant: (prompt: string, history?: ChatHistoryMessage[]) =>
    cmd<ChatResponse>("ask_assistant", { prompt, history: history ?? [] }),
  polishBugReport: (draft: BugFormDraft) => cmd<BugPreview>("polish_bug_report", { draft }),
  createBug: (draft: BugFormDraft, preview: BugPreview) =>
    cmd<{ key: string; url: string }>("create_bug", { draft, preview }),
  createDefectIssue: (draft: DefectCreateDraft) =>
    cmd<{ key: string; url: string }>("create_defect_issue", { draft }),

  // Test-case extraction
  extractTestCases: (url: string, depth: ExtractionDepth) =>
    cmd<ExtractedTestCaseResult>("extract_test_cases", { url, depth }),
  createTestCases: (cases: ExtractedTestCase[]) =>
    cmd<{ created: Array<{ key: string; url: string }> }>("create_test_cases", { cases }),
  createManualTestCases: (cases: ManualTestCase[]) =>
    cmd<{ created: Array<{ key: string; url: string }> }>("create_manual_test_cases", { cases }),
  organizeTestsIntoXray: (source: string, folderPath: string, projectKey: string) =>
    cmd<{ count: number }>("organize_tests_into_xray", { source, folderPath, projectKey }),
  getXrayFolders: (projectKey: string) => cmd<XrayFolder[]>("get_xray_folders", { projectKey }),
  getXrayFolderIssues: (projectKey: string, folderId: number) =>
    cmd<{ key: string; summary: string }[]>("get_xray_folder_issues", { projectKey, folderId }),
  addTestsToExecution: (execKey: string, testKeys: string[]) =>
    cmd<void>("add_tests_to_execution", { execKey, testKeys }),
  checkTestSteps: (entries: ConfluenceTestImportEntry[]) =>
    cmd<StepConflictCheck>("check_test_steps", { entries }),
  fetchTestSteps: (issueKey: string) =>
    cmd<FetchTestStepsResult | null>("fetch_test_steps", { issueKey }),
  updateTestCasesFromConfluence: (entries: ConfluenceTestImportEntry[], mode?: StepConflictMode) =>
    cmd<UpdateTestCasesFromConfluenceResult>("update_test_cases_from_confluence", {
      entries,
      mode: mode ?? "replace",
    }),
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) =>
    on<UpdateProgress>("update-progress", callback),
  findTestCasesByJql: (jql: string, maxResults: number) =>
    cmd<JiraIssueSummary[]>("find_test_cases_by_jql", { jql, maxResults }),
  semanticSearchTestCases: (query: string, projectKey: string) =>
    cmd<SemanticSearchResult[]>("semantic_search_test_cases", { query, projectKey }),

  // Confluence sync
  syncToConfluence: (pageId: string, payload: SyncToConfluencePayload) =>
    cmd<SyncToConfluenceResult>("sync_to_confluence", { pageId, payload }),
  previewConfluenceSync: (pageId: string, payload: { entries: unknown[] }) =>
    cmd<ConfluencePreviewResult>("preview_confluence_sync", { pageId, payload }),
  getConfluencePage: (pageId: string) =>
    cmd<{ title: string; content: string; version: number }>("get_confluence_page", { pageId }),
  parseConfluenceEntries: (pageId: string, options?: ParseConfluenceEntriesOptions) =>
    cmd<ParseConfluenceEntriesResult>("parse_confluence_entries", {
      pageId,
      debug: options?.debug ?? false,
    }),

  // RAG
  ragIndexConfluence: (spaceKey: string) =>
    cmd<{ indexed: number; skipped: number }>("rag_index_confluence", { spaceKey }),
  ragIndexJira: (projectKey: string) =>
    cmd<{ indexed: number; skipped: number }>("rag_index_jira", { projectKey }),
  ragSearch: (query: string) =>
    cmd<{ content: string; sourceTitle: string; sourceUrl: string; score: number }[]>(
      "rag_search",
      { query }
    ),
  ragGetStats: () => cmd<RagStats>("rag_get_stats"),
  ragClearIndex: (source?: "confluence" | "jira") =>
    cmd<void>("rag_clear_index", { source: source ?? null }),
  onRagProgress: (callback: (progress: RagIndexProgress) => void) =>
    on<RagIndexProgress>("rag-progress", callback),

  // Jira metadata
  getJiraProjects: () => cmd<JiraProject[]>("get_jira_projects"),
  getJiraBoards: (projectKey: string) => cmd<JiraBoard[]>("get_jira_boards", { projectKey }),
  getJiraSprints: (boardId: number) => cmd<JiraSprint[]>("get_jira_sprints", { boardId }),
  getJiraStatuses: () => cmd<JiraStatus[]>("get_jira_statuses"),
  getJiraIssueTypes: () => cmd<string[]>("get_jira_issue_types"),
  getJiraUsers: (projectKey: string) => cmd<JiraUser[]>("get_jira_users", { projectKey }),
  getJiraLabels: () => cmd<string[]>("get_jira_labels"),
  getJiraCustomFields: () =>
    cmd<{ id: string; name: string; type: string; isCustom: boolean }[]>("get_jira_custom_fields"),
  findIssuesByJql: (jql: string, maxResults: number) =>
    cmd<JiraIssueSummary[]>("find_issues_by_jql", { jql, maxResults }),

  // Bulk operations
  bulkTransition: (issueKeys: string[], transitionId: string) =>
    cmd<BulkOperationResult>("bulk_transition", { issueKeys, transitionId }),
  bulkAssign: (issueKeys: string[], assigneeAccountId: string) =>
    cmd<BulkOperationResult>("bulk_assign", { issueKeys, assigneeAccountId }),
  bulkAddLabels: (issueKeys: string[], labels: string[]) =>
    cmd<BulkOperationResult>("bulk_add_labels", { issueKeys, labels }),
  bulkMoveToXrayFolder: (issueKeys: string[], folderPath: string) =>
    cmd<BulkOperationResult>("bulk_move_to_xray_folder", { issueKeys, folderPath }),
  getXrayExecutionDetails: (execKey: string) =>
    cmd<XrayExecutionDetails>("get_xray_execution_details", { execKey }),
  getXrayExecutionHistory: (execKey: string) =>
    cmd<XrayExecutionSnapshot[]>("get_xray_execution_history", { execKey }),
  injectExecutionReport: (targetIssueKey: string, execKey: string, snapshots: XrayExecutionSnapshot[]) =>
    cmd<void>("inject_execution_report", { targetIssueKey, execKey, snapshots }),

  // Ollama
  getOllamaModels: (endpoint: string) => cmd<string[]>("get_ollama_models", { endpoint }),

  // Logging / executions / files
  getLogs: () => cmd<unknown[]>("get_logs"),
  saveLogs: (logs: unknown[]) => cmd<void>("save_logs", { logs }),
  recordExecution: (execution: TestCaseExecution) =>
    cmd<void>("record_execution", { execution }),
  getExecutionHistory: (testCaseId?: string) =>
    cmd<TestCaseExecution[]>("get_execution_history", { testCaseId: testCaseId ?? null }),
  getExecutionStats: () =>
    cmd<{ totalExecutions: number; totalPassed: number; totalFailed: number; passRate: number }>(
      "get_execution_stats"
    ),
  readLocalFile: (filePath: string, baseDir?: string) =>
    cmd<{ name: string; data: string }>("read_local_file", { filePath, baseDir: baseDir ?? null }),
  getDirectoryName: (filePath: string) => cmd<string>("get_directory_name", { filePath }),

  // External / misc
  openExternal: (url: string) => open(url),
  cancelRequest: (requestId: string) => {
    void invoke("cancel_request", { requestId });
  },
  onExtractionProgress: (callback: (msg: string) => void) =>
    on<string>("extraction-progress", callback),
  onBrdChunkProgress: (callback: (progress: BrdChunkProgress) => void) =>
    on<BrdChunkProgress>("brd-chunk-progress", callback),

  // ── BRD / Test Case Manager ─────────────────────────────────────────
  generateTestCasesFromBRD: (request: BRDGenerationRequest) =>
    cmd<BRDGenerationResult>("generate_test_cases_from_brd", { request }),
  getGeneratedTestCases: (testExecutionId: string) =>
    cmd<BRDTestCase[]>("get_generated_test_cases", { testExecutionId }),
  updateBRDTestCase: (testCase: BRDTestCase) =>
    cmd<BRDTestCase>("update_brd_test_case", { testCase }),
  deleteBRDTestCase: (id: string) => cmd<void>("delete_brd_test_case", { id }),
  syncBRDTestCasesToJira: (testExecutionId: string, projectKey: string, folderPath?: string) =>
    cmd<{ success: number; failed: number; errors: string[] }>("sync_brd_test_cases_to_jira", {
      testExecutionId,
      projectKey,
      folderPath: folderPath ?? null,
    }),

  // ── BRD / Test Cycle Manager ────────────────────────────────────────
  getTestPlans: () => cmd<TestPlan[]>("get_test_plans"),
  createTestPlan: (uqaKey: string, phase: string, name: string, description: string, projectKey: string) =>
    cmd<TestPlan>("create_test_plan", { uqaKey, phase, name, description, projectKey }),
  updateTestPlan: (plan: TestPlan) => cmd<TestPlan>("update_test_plan", { plan }),
  deleteTestPlan: (id: string) => cmd<void>("delete_test_plan", { id }),
  syncTestPlanToJira: (planId: string) =>
    cmd<{ key: string; url: string } | null>("sync_test_plan_to_jira", { planId }),
  getTestExecutions: (testPlanId?: string) =>
    cmd<TestExecution[]>("get_test_executions", { testPlanId: testPlanId ?? null }),
  createTestExecution: (testPlanId: string, assignee: string, name: string, projectKey: string, featureName: string) =>
    cmd<TestExecution>("create_test_execution", { testPlanId, assignee, name, projectKey, featureName }),
  updateTestExecution: (execution: TestExecution) =>
    cmd<TestExecution>("update_test_execution", { execution }),
  deleteTestExecution: (id: string) => cmd<void>("delete_test_execution", { id }),
  syncTestExecutionToJira: (executionId: string) =>
    cmd<{ key: string; url: string } | null>("sync_test_execution_to_jira", { executionId }),
  getExecutionMonitoringData: (testExecutionId?: string) =>
    cmd<ExecutionMonitoringData[]>("get_execution_monitoring_data", {
      testExecutionId: testExecutionId ?? null,
    }),

  // ── Updates ──────────────────────────────────────────────────────────
  checkForUpdates: () => cmd<UpdateInfo>("check_for_updates"),
  getUpdateStatus: () => cmd<UpdateInfo | null>("get_update_status"),
  onUpdateStatusPushed: (callback: (info: UpdateInfo) => void) =>
    on<UpdateInfo>("update-status-pushed", callback),
  downloadAndInstallUpdate: () => cmd<void>("download_and_install_update"),
  onDownloadProgress: (callback: (progress: { progress: number; downloaded: number; total: number }) => void) =>
    on<{ progress: number; downloaded: number; total: number }>("download-progress", callback),

  // ── UQA ──────────────────────────────────────────────────────────────
  getUqaIssues: () => cmd<UqaIssue[]>("get_uqa_issues"),
  getUqaTransitions: (issueKey: string) =>
    cmd<UqaTransition[]>("get_uqa_transitions", { issueKey }),
  appendUqaEntry: (issueKey: string, date: string, activity: string) =>
    cmd<void>("append_uqa_entry", { issueKey, date, activity }),
  appendUqaEntryWithNotes: (issueKey: string, date: string, activity: string, notes: string) =>
    cmd<void>("append_uqa_entry_with_notes", { issueKey, date, activity, notes }),
  transitionUqaIssue: (issueKey: string, transitionId: string) =>
    cmd<void>("transition_uqa_issue", { issueKey, transitionId }),
  autoGenerateUqaNotes: (issueKey: string) =>
    cmd<AutoUqaGeneratedPayload>("auto_generate_uqa_notes", { issueKey }),
  onUqaReminder: (callback: (issueKey: string, summary: string) => void) =>
    on<{ issueKey: string; summary: string }>("uqa-reminder-pushed", (p) =>
      callback(p.issueKey, p.summary)
    ),
  checkUqaOnStartup: () => cmd<UqaIssue[]>("check_uqa_on_startup"),
  getUqaField: () =>
    cmd<{ id: string; name: string; type: string; isCustom: boolean } | null>("get_uqa_field"),
  updateUqaSchedule: (config: UqaConfig) => cmd<void>("update_uqa_schedule", { config }),
  getUqaSchedule: () => cmd<UqaConfig>("get_uqa_schedule"),
  getUqaIssuesFromStore: () => cmd<UqaIssue[]>("get_uqa_issues_from_store"),
  syncUqaIssues: () => cmd<UqaIssue[]>("sync_uqa_issues"),
  onUqaSyncProgress: (callback: (progress: UqaSyncProgress) => void) =>
    on<UqaSyncProgress>("uqa-sync-progress", callback),
  getPerUqaReminder: (issueKey: string) =>
    cmd<PerIssueReminder | null>("get_per_uqa_reminder", { issueKey }),
  updatePerUqaReminder: (issueKey: string, reminder: PerIssueReminder) =>
    cmd<void>("update_per_uqa_reminder", { issueKey, reminder }),

  // ── Defect Repository ────────────────────────────────────────────────
  getDefectSources: () => cmd<JiraProjectSource[]>("get_defect_sources"),
  saveDefectSource: (source: JiraProjectSource) =>
    cmd<JiraProjectSource[]>("save_defect_source", { source }),
  deleteDefectSource: (id: string) => cmd<JiraProjectSource[]>("delete_defect_source", { id }),
  syncDefectSource: (projectKey: string) =>
    cmd<{ indexed: number; skipped: number }>("sync_defect_source", { projectKey }),
  findDefectDuplicateCandidates: (filters: SearchFilters) =>
    cmd<DuplicateCandidate[]>("find_defect_duplicate_candidates", { filters }),
  searchDefects: (filters: SearchFilters) =>
    cmd<{ candidates: DuplicateCandidate[]; defects: DefectRecord[] }>("search_defects", { filters }),
  getDefect: (id: string) => cmd<DefectRecord | null>("get_defect", { id }),
  getDefectDuplicateRelations: (defectId: string) =>
    cmd<DuplicateRelation[]>("get_defect_duplicate_relations", { defectId }),
  markDuplicateDefect: (relation: Omit<DuplicateRelation, "id" | "createdAt">) =>
    cmd<DuplicateRelation>("mark_duplicate_defect", { relation }),
  removeDuplicateDefectLink: (id: string) => cmd<void>("remove_duplicate_defect_link", { id }),
  getDefectStats: () => cmd<DefectRepositoryStats>("get_defect_stats"),
  reindexAllDefects: () => cmd<void>("reindex_all_defects"),

  // ── OCR ──────────────────────────────────────────────────────────────
  ocrExtractFromFile: (filePath: string) =>
    cmd<OcrResult | null>("ocr_extract_from_file", { filePath }),
};

export type TauriApi = typeof api;

/**
 * Install the Tauri-backed `DesktopApi` onto `window.qaBuddy`. Must run before
 * the React app mounts. No-op when not inside Tauri (e.g. plain browser dev).
 */
export async function installTauriApi(): Promise<void> {
  const w = window as unknown as { qaBuddy?: unknown };
  if (w.qaBuddy) {
    // Already installed (HMR) or running under Electron preload.
    return;
  }
  w.qaBuddy = api;
}
