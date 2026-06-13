import { contextBridge, ipcRenderer } from "electron";
import type {
  AppBootstrap,
  AppConfig,
  BugFormDraft,
  BugPreview,
  BulkOperationResult,
  ChatHistoryMessage,
  ChatResponse,
  ConfluenceTestImportEntry,
  ConnectionStatus,
  DashboardDigest,
  DesktopApi,
  ExtractedTestCase,
  ExtractedTestCaseResult,
  ExtractionDepth,
  JiraBoard,
  JiraIssueSummary,
  JiraProject,
  JiraSprint,
  JiraStatus,
  JiraUser,
  ManualTestCase,
  RagIndexProgress,
  RagStats,
  StepConflictCheck,
  StepConflictMode,
  TestCaseExecution,
  UpdateProgress,
  UpdateInfo,
  UpdateTestCasesFromConfluenceResult,
  SyncToConfluencePayload,
  SyncToConfluenceResult,
  ConfluencePreviewResult,
  ParseConfluenceEntriesOptions,
  ParseConfluenceEntriesResult,
  XrayFolder,
  FetchTestStepsResult,
  UqaIssue,
  UqaConfig,
  JiraProjectSource,
  DefectRecord,
  DuplicateRelation,
  SearchFilters,
  DefectRepositoryStats,
  DuplicateCandidate,
  DefectCreateDraft,
} from "@shared/types";

const api: DesktopApi = {
  bootstrap: () => ipcRenderer.invoke("bootstrap") as Promise<AppBootstrap>,
  saveConfig: (config: AppConfig) => ipcRenderer.invoke("saveConfig", config) as Promise<AppConfig>,
  testConnections: () => ipcRenderer.invoke("testConnections") as Promise<ConnectionStatus>,
  healthcheck: () => ipcRenderer.invoke("healthcheck") as Promise<any>,
  getDashboard: (options?: { skipInsight?: boolean }) => ipcRenderer.invoke("getDashboard", options) as Promise<DashboardDigest>,
  askAssistant: (prompt: string, history?: ChatHistoryMessage[]) =>
    ipcRenderer.invoke("askAssistant", prompt, history) as Promise<ChatResponse>,
  polishBugReport: (draft: BugFormDraft) =>
    ipcRenderer.invoke("polishBugReport", draft) as Promise<BugPreview>,
  createBug: (draft: BugFormDraft, preview: BugPreview) =>
    ipcRenderer.invoke("createBug", draft, preview) as Promise<{ key: string; url: string }>,
  createDefectIssue: (draft: DefectCreateDraft) =>
    ipcRenderer.invoke("createDefectIssue", draft) as Promise<{ key: string; url: string }>,
  extractTestCases: (url: string, depth: ExtractionDepth) =>
    ipcRenderer.invoke("extractTestCases", url, depth) as Promise<ExtractedTestCaseResult>,
  createTestCases: (cases: ExtractedTestCase[]) =>
    ipcRenderer.invoke("createTestCases", cases) as Promise<{ created: Array<{ key: string; url: string }> }>,
  createManualTestCases: (cases: ManualTestCase[]) =>
    ipcRenderer.invoke("createManualTestCases", cases) as Promise<{ created: Array<{ key: string; url: string }> }>,
  organizeTestsIntoXray: (source: string, folderPath: string, projectKey: string) =>
    ipcRenderer.invoke("organizeTestsIntoXray", source, folderPath, projectKey) as Promise<{ count: number }>,
  getXrayFolders: (projectKey: string) =>
    ipcRenderer.invoke("getXrayFolders", projectKey) as Promise<XrayFolder[]>,
  checkTestSteps: (entries: ConfluenceTestImportEntry[]) =>
    ipcRenderer.invoke("checkTestSteps", entries) as Promise<StepConflictCheck>,
  fetchTestSteps: (issueKey: string) =>
    ipcRenderer.invoke("fetchTestSteps", issueKey) as Promise<FetchTestStepsResult | null>,
  updateTestCasesFromConfluence: (entries: ConfluenceTestImportEntry[], mode?: StepConflictMode) =>
    ipcRenderer.invoke("updateTestCasesFromConfluence", entries, mode) as Promise<UpdateTestCasesFromConfluenceResult>,
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => {
    const handler = (_: any, p: UpdateProgress) => callback(p);
    ipcRenderer.on("update-progress", handler);
    return () => ipcRenderer.removeListener("update-progress", handler);
  },
  findTestCasesByJql: (jql: string, maxResults: number) =>
    ipcRenderer.invoke("findTestCasesByJql", jql, maxResults) as Promise<JiraIssueSummary[]>,
  getXrayFolderIssues: (projectKey: string, folderId: number) =>
    ipcRenderer.invoke("getXrayFolderIssues", projectKey, folderId) as Promise<{ key: string; summary: string }[]>,
  openExternal: (url: string) => ipcRenderer.invoke("openExternal", url) as Promise<void>,
  getOllamaModels: (endpoint: string) => ipcRenderer.invoke("getOllamaModels", endpoint) as Promise<string[]>,
  syncToConfluence: (pageId: string, payload: SyncToConfluencePayload) =>
    ipcRenderer.invoke("syncToConfluence", pageId, payload) as Promise<SyncToConfluenceResult>,
  previewConfluenceSync: (pageId: string, payload: { entries: any[] }) =>
    ipcRenderer.invoke("previewConfluenceSync", pageId, payload) as Promise<ConfluencePreviewResult>,
  ragIndexConfluence: (spaceKey: string) =>
    ipcRenderer.invoke("ragIndexConfluence", spaceKey) as Promise<{ indexed: number; skipped: number }>,
  ragIndexJira: (projectKey: string) =>
    ipcRenderer.invoke("ragIndexJira", projectKey) as Promise<{ indexed: number; skipped: number }>,
  ragSearch: (query: string) =>
    ipcRenderer.invoke("ragSearch", query) as Promise<{ content: string; sourceTitle: string; sourceUrl: string; score: number }[]>,
  ragGetStats: () =>
    ipcRenderer.invoke("ragGetStats") as Promise<RagStats>,
  ragClearIndex: (source?: "confluence" | "jira") =>
    ipcRenderer.invoke("ragClearIndex", source) as Promise<void>,
  onRagProgress: (callback: (progress: RagIndexProgress) => void) => {
    const handler = (_: any, progress: RagIndexProgress) => callback(progress);
    ipcRenderer.on("rag-progress", handler);
    return () => ipcRenderer.removeListener("rag-progress", handler);
  },
  getJiraProjects: () => ipcRenderer.invoke("getJiraProjects") as Promise<JiraProject[]>,
  getJiraBoards: (projectKey: string) => ipcRenderer.invoke("getJiraBoards", projectKey) as Promise<JiraBoard[]>,
  getJiraSprints: (boardId: number) => ipcRenderer.invoke("getJiraSprints", boardId) as Promise<JiraSprint[]>,
  getJiraStatuses: () => ipcRenderer.invoke("getJiraStatuses") as Promise<JiraStatus[]>,
  getJiraIssueTypes: () => ipcRenderer.invoke("getJiraIssueTypes") as Promise<string[]>,
  getJiraUsers: (projectKey: string) => ipcRenderer.invoke("getJiraUsers", projectKey) as Promise<JiraUser[]>,
  getJiraLabels: () => ipcRenderer.invoke("getJiraLabels") as Promise<string[]>,
  getJiraCustomFields: () =>
    ipcRenderer.invoke("getJiraCustomFields") as Promise<{ id: string; name: string; type: string; isCustom: boolean }[]>,
  findIssuesByJql: (jql: string, maxResults: number) => ipcRenderer.invoke("findIssuesByJql", jql, maxResults) as Promise<JiraIssueSummary[]>,
  getConfluencePage: (pageId: string) => ipcRenderer.invoke("getConfluencePage", pageId) as Promise<{ title: string; content: string; version: number }>,
  parseConfluenceEntries: (pageId: string, options?: ParseConfluenceEntriesOptions) =>
    ipcRenderer.invoke("parseConfluenceEntries", pageId, options) as Promise<ParseConfluenceEntriesResult>,
  bulkTransition: (issueKeys: string[], transitionId: string) => ipcRenderer.invoke("bulkTransition", issueKeys, transitionId) as Promise<BulkOperationResult>,
  bulkAssign: (issueKeys: string[], assigneeAccountId: string) => ipcRenderer.invoke("bulkAssign", issueKeys, assigneeAccountId) as Promise<BulkOperationResult>,
  bulkAddLabels: (issueKeys: string[], labels: string[]) => ipcRenderer.invoke("bulkAddLabels", issueKeys, labels) as Promise<BulkOperationResult>,
  bulkMoveToXrayFolder: (issueKeys: string[], folderPath: string) => ipcRenderer.invoke("bulkMoveToXrayFolder", issueKeys, folderPath) as Promise<BulkOperationResult>,
  getLogs: () => ipcRenderer.invoke("getLogs") as Promise<any[]>,
  saveLogs: (logs: any[]) => ipcRenderer.invoke("saveLogs", logs) as Promise<void>,
  recordExecution: (execution: TestCaseExecution) => ipcRenderer.invoke("recordExecution", execution) as Promise<void>,
  getExecutionHistory: (testCaseId?: string) => ipcRenderer.invoke("getExecutionHistory", testCaseId) as Promise<TestCaseExecution[]>,
  getExecutionStats: () => ipcRenderer.invoke("getExecutionStats") as Promise<{ totalExecutions: number; totalPassed: number; totalFailed: number; passRate: number }>,
  readLocalFile: (filePath: string, baseDir?: string) => ipcRenderer.invoke("readLocalFile", filePath, baseDir) as Promise<{ name: string; data: string }>,
  getDirectoryName: (filePath: string) => ipcRenderer.invoke("getDirectoryName", filePath) as Promise<string>,
  checkForUpdates: () => ipcRenderer.invoke("checkForUpdates") as Promise<UpdateInfo>,
  getUpdateStatus: () => ipcRenderer.invoke("getUpdateStatus") as Promise<UpdateInfo | null>,
  onUpdateStatusPushed: (callback: (info: UpdateInfo) => void) => {
    const handler = (_: any, info: UpdateInfo) => callback(info);
    ipcRenderer.on("update-status-pushed", handler);
    return () => ipcRenderer.removeListener("update-status-pushed", handler);
  },
  downloadAndInstallUpdate: () => ipcRenderer.invoke("downloadAndInstallUpdate") as Promise<void>,
  onDownloadProgress: (callback: (progress: { progress: number; downloaded: number; total: number }) => void) => {
    const handler = (_: any, p: { progress: number; downloaded: number; total: number }) => callback(p);
    ipcRenderer.on("download-progress", handler);
    return () => ipcRenderer.removeListener("download-progress", handler);
  },
  // UQA
  getUqaIssues: () => ipcRenderer.invoke("getUqaIssues") as Promise<UqaIssue[]>,
  getUqaTransitions: (issueKey: string) =>
    ipcRenderer.invoke("getUqaTransitions", issueKey) as Promise<import("@shared/types").UqaTransition[]>,
  appendUqaEntry: (issueKey: string, date: string, activity: string) =>
    ipcRenderer.invoke("appendUqaEntry", issueKey, date, activity) as Promise<void>,
  appendUqaEntryWithNotes: (issueKey: string, date: string, activity: string, notes: string) =>
    ipcRenderer.invoke("appendUqaEntryWithNotes", issueKey, date, activity, notes) as Promise<void>,
  transitionUqaIssue: (issueKey: string, transitionId: string) =>
    ipcRenderer.invoke("transitionUqaIssue", issueKey, transitionId) as Promise<void>,
  autoGenerateUqaNotes: (issueKey: string) =>
    ipcRenderer.invoke("autoGenerateUqaNotes", issueKey) as Promise<import("@shared/types").AutoUqaGeneratedPayload>,
  onUqaReminder: (callback: (issueKey: string, summary: string) => void) => {
    const handler = (_: any, issueKey: string, summary: string) => callback(issueKey, summary);
    ipcRenderer.on("uqa-reminder-pushed", handler);
    return () => ipcRenderer.removeListener("uqa-reminder-pushed", handler);
  },
  checkUqaOnStartup: () => ipcRenderer.invoke("checkUqaOnStartup") as Promise<UqaIssue[]>,
  getUqaField: () =>
    ipcRenderer.invoke("getUqaField") as Promise<{ id: string; name: string; type: string; isCustom: boolean } | null>,
  updateUqaSchedule: (config: UqaConfig) =>
    ipcRenderer.invoke("updateUqaSchedule", config) as Promise<void>,
  getUqaSchedule: () =>
    ipcRenderer.invoke("getUqaSchedule") as Promise<UqaConfig>,
  getPerUqaReminder: (issueKey: string) =>
    ipcRenderer.invoke("getPerUqaReminder", issueKey) as Promise<import("@shared/types").PerIssueReminder | null>,
  updatePerUqaReminder: (issueKey: string, reminder: import("@shared/types").PerIssueReminder) =>
    ipcRenderer.invoke("updatePerUqaReminder", issueKey, reminder) as Promise<void>,
  // Defect Repository
  getDefectSources: () => ipcRenderer.invoke("getDefectSources") as Promise<JiraProjectSource[]>,
  saveDefectSource: (source: JiraProjectSource) => ipcRenderer.invoke("saveDefectSource", source) as Promise<JiraProjectSource[]>,
  deleteDefectSource: (id: string) => ipcRenderer.invoke("deleteDefectSource", id) as Promise<JiraProjectSource[]>,
  syncDefectSource: (projectKey: string) => ipcRenderer.invoke("syncDefectSource", projectKey) as Promise<{ indexed: number; skipped: number }>,
  findDefectDuplicateCandidates: (filters: SearchFilters) =>
    ipcRenderer.invoke("findDefectDuplicateCandidates", filters) as Promise<DuplicateCandidate[]>,
  searchDefects: (filters: SearchFilters) => ipcRenderer.invoke("searchDefects", filters) as Promise<{ candidates: DuplicateCandidate[]; defects: DefectRecord[] }>,
  getDefect: (id: string) => ipcRenderer.invoke("getDefect", id) as Promise<DefectRecord | null>,
  getDefectDuplicateRelations: (defectId: string) => ipcRenderer.invoke("getDefectDuplicateRelations", defectId) as Promise<DuplicateRelation[]>,
  markDuplicateDefect: (relation: Omit<DuplicateRelation, "id" | "createdAt">) => ipcRenderer.invoke("markDuplicateDefect", relation) as Promise<DuplicateRelation>,
  removeDuplicateDefectLink: (id: string) => ipcRenderer.invoke("removeDuplicateDefectLink", id) as Promise<void>,
  getDefectStats: () => ipcRenderer.invoke("getDefectStats") as Promise<DefectRepositoryStats>,
  reindexAllDefects: () => ipcRenderer.invoke("reindexAllDefects") as Promise<void>,
  // OCR
  ocrExtractFromFile: (filePath: string) =>
    ipcRenderer.invoke("ocrExtractFromFile", filePath) as Promise<import("@shared/types").OcrResult | null>,
};

contextBridge.exposeInMainWorld("qaBuddy", api);
