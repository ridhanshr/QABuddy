import { z } from "zod";

export type AuthMode = "bearer" | "basic";
export type ThemePreference = "light" | "dark" | "system";
export type ViewKey =
  | "dashboard"
  | "chat-assistant"
  | "bug-report"
  | "test-case-extractor"
  | "manual-test-case"
  | "documentation-sync"
  | "advanced-jira-organizer"
  | "knowledge-base"
  | "logs"
  | "settings"
  | "documentation";
export type ExtractionDepth = "comprehensive" | "happy-path" | "edge-case";

export interface AtlassianConnectionConfig {
  baseUrl: string;
  authMode: AuthMode;
  username: string;
  token: string;
}

export interface JiraConfig extends AtlassianConnectionConfig {
  projectKey: string;
  readyForQaJql: string;
  bugIssueType: string;
  testCaseIssueType: string;
}

export interface ConfluenceConfig extends AtlassianConnectionConfig {
  spaceKey: string;
  targetPageId: string;
  jiraServerId?: string;
}

export interface OllamaConfig {
  endpoint: string;
  model: string;
  jqlModel?: string;
  chatModel?: string;
  extractionModel?: string;
  insightModel?: string;
}

export interface AppConfig {
  jira: JiraConfig;
  confluence: ConfluenceConfig;
  ollama: OllamaConfig;
  preferences: {
    theme: ThemePreference;
    language: string;
  };
}

export interface ConnectionStatusItem {
  ok: boolean;
  message: string;
}

export interface ConnectionStatus {
  jira: ConnectionStatusItem;
  confluence: ConnectionStatusItem;
  ollama: ConnectionStatusItem;
}

export interface JiraIssueSummary {
  id: string;
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string;
  type: string;
  url: string;
}

export interface SprintReport {
  sprintName: string;
  sprintState: string;
  totalIssues: number;
  completedIssues: number;
  toDoIssues: number;
  inProgressIssues: number;
  doneIssues: number;
  completionPercent: number;
}

export interface BugMetrics {
  totalOpen: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  resolvedThisSprint: number;
  foundThisSprint: number;
  epicTotal: number;
  epicCompleted: number;
  epicTasksTotal: number;
  epicTasksResolved: number;
}

export interface DashboardDigest {
  insight: string;
  readyForQa: JiraIssueSummary[];
  bugMetrics: BugMetrics;
  sprintReport?: SprintReport;
}

export interface ConfluencePageSummary {
  id: string;
  title: string;
  spaceName: string;
  url: string;
  excerpt: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  mode: "jira" | "confluence" | "hybrid" | "error";
  answer: string;
  jql?: string;
  issues?: JiraIssueSummary[];
  pages?: ConfluencePageSummary[];
}

export interface BugFormDraft {
  title: string;
  stepsToReproduce: string;
  actualResult: string;
  expectedResult: string;
  environment: string;
  priority: string;
  labels: string;
}

export interface BugPreview {
  summary: string;
  description: string;
  priority: string;
  labels: string[];
}

export interface ExtractedTestCase {
  id: string;
  title: string;
  objective: string;
  priority: string;
  category: string;
  selected: boolean;
}

export interface ExtractedTestCaseResult {
  pageTitle: string;
  sourceUrl: string;
  testCases: ExtractedTestCase[];
}

export interface ManualTestCase {
  id: string;
  title: string;
  description: string;
  steps: string;
  expectedResult: string;
  xrayFolder: string;
  labels: string;
}

export interface AppBootstrap {
  config: AppConfig;
  status: ConnectionStatus;
  dashboard: DashboardDigest;
}

export interface RagStats {
  totalChunks: number;
  confluencePages: number;
  confluenceChunks: number;
  jiraIssues: number;
  jiraChunks: number;
  lastConfluenceSync: string | null;
  lastJiraSync: string | null;
}

export interface RagIndexProgress {
  source: "confluence" | "jira";
  status: "fetching" | "embedding" | "done" | "error";
  message: string;
  current: number;
  total: number;
}

export interface SyncToConfluenceResult {
  pageTitle: string;
  pageUrl: string;
  entryCount: number;
  imageCount: number;
  attachmentCount: number;
}

export interface ConfluencePreviewResult {
  currentTitle: string;
  currentVersion: number;
  generatedTables: string;
  entryCount: number;
  existingEntryCount: number;
}

export interface ParseConfluenceEntriesResult {
  pageId: string;
  pageTitle: string;
  contentLoaded: boolean;
  entries: any[];
  jiraServerId?: string;
  error?: string;
  debug?: ParseConfluenceParseDebugReport;
}

export interface ParseConfluenceEntriesOptions {
  debug?: boolean;
}

export interface ParseConfluenceParseDebugRow {
  label: string | null;
  status: "mapped" | "unmapped-label" | "missing-label" | "empty-value";
  mappedField?: string;
  reason?: string;
  rawHtml: string;
  valuePreview?: string;
}

export interface ParseConfluenceParseDebugTable {
  index: number;
  parsed: boolean;
  reason?: string;
  rawHtml: string;
  rows: ParseConfluenceParseDebugRow[];
  mappedFields: string[];
  entrySummary?: {
    testCaseNo: string;
    functionName: string;
    scenario: string;
    category: string;
    result: string;
    imageCount: number;
  };
}

export interface ParseConfluenceParseDebugChunk {
  index: number;
  reason: string;
  rawHtml: string;
}

export interface ParseConfluenceParseDebugReport {
  pageId: string;
  pageTitle?: string;
  rawPageContent: string;
  contentLength: number;
  tableCount: number;
  parsedTableCount: number;
  skippedTableCount: number;
  unmatchedHtmlChunks: ParseConfluenceParseDebugChunk[];
  tables: ParseConfluenceParseDebugTable[];
}

export interface SyncToConfluencePayload {
  entries: any[];
  deletedTableIndices?: number[];
}

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  url: string;
  publishedAt: string;
  checkedAt: string;
  error?: string;
}

export interface DesktopApi {
  bootstrap: () => Promise<AppBootstrap>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  checkForUpdates: () => Promise<UpdateInfo>;
  getUpdateStatus: () => Promise<UpdateInfo | null>;
  onUpdateStatusPushed: (callback: (info: UpdateInfo) => void) => () => void;
  testConnections: () => Promise<ConnectionStatus>;
  healthcheck: () => Promise<any>;
  getDashboard: () => Promise<DashboardDigest>;
  askAssistant: (prompt: string, history?: ChatHistoryMessage[]) => Promise<ChatResponse>;
  polishBugReport: (draft: BugFormDraft) => Promise<BugPreview>;
  createBug: (draft: BugFormDraft, preview: BugPreview) => Promise<{ key: string; url: string }>;
  extractTestCases: (
    url: string,
    depth: ExtractionDepth
  ) => Promise<ExtractedTestCaseResult>;
  createTestCases: (cases: ExtractedTestCase[]) => Promise<{ created: Array<{ key: string; url: string }> }>;
  createManualTestCases: (cases: ManualTestCase[]) => Promise<{ created: Array<{ key: string; url: string }> }>;
  organizeTestsIntoXray: (source: string, folderPath: string, projectKey: string) => Promise<{ count: number }>;
  getXrayFolders: (projectKey: string) => Promise<XrayFolder[]>;
  checkTestSteps: (entries: ConfluenceTestImportEntry[]) => Promise<StepConflictCheck>;
  updateTestCasesFromConfluence: (entries: ConfluenceTestImportEntry[], mode?: StepConflictMode) => Promise<UpdateTestCasesFromConfluenceResult>;
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void;
  findTestCasesByJql: (jql: string, maxResults: number) => Promise<JiraIssueSummary[]>;
  getXrayFolderIssues: (projectKey: string, folderId: number) => Promise<{ key: string; summary: string }[]>;
  syncToConfluence: (pageId: string, payload: SyncToConfluencePayload) => Promise<SyncToConfluenceResult>;
  previewConfluenceSync: (pageId: string, payload: { entries: any[] }) => Promise<ConfluencePreviewResult>;
  openExternal: (url: string) => Promise<void>;
  getOllamaModels: (endpoint: string) => Promise<string[]>;
  ragIndexConfluence: (spaceKey: string) => Promise<{ indexed: number; skipped: number }>;
  ragIndexJira: (projectKey: string) => Promise<{ indexed: number; skipped: number }>;
  ragSearch: (query: string) => Promise<{ content: string; sourceTitle: string; sourceUrl: string; score: number }[]>;
  ragGetStats: () => Promise<RagStats>;
  ragClearIndex: (source?: "confluence" | "jira") => Promise<void>;
  onRagProgress: (callback: (progress: RagIndexProgress) => void) => () => void;
  getJiraProjects: () => Promise<JiraProject[]>;
  getJiraBoards: (projectKey: string) => Promise<JiraBoard[]>;
  getJiraSprints: (boardId: number) => Promise<JiraSprint[]>;
  getJiraStatuses: () => Promise<JiraStatus[]>;
  getJiraIssueTypes: () => Promise<string[]>;
  getJiraUsers: (projectKey: string) => Promise<JiraUser[]>;
  getJiraLabels: () => Promise<string[]>;
  getJiraCustomFields: () => Promise<{ id: string; name: string; type: string; isCustom: boolean }[]>;
  findIssuesByJql: (jql: string, maxResults: number) => Promise<JiraIssueSummary[]>;
  getConfluencePage: (pageId: string) => Promise<{ title: string; content: string; version: number }>;
  parseConfluenceEntries: (pageId: string, options?: ParseConfluenceEntriesOptions) => Promise<ParseConfluenceEntriesResult>;
  bulkTransition: (issueKeys: string[], transitionId: string) => Promise<BulkOperationResult>;
  bulkAssign: (issueKeys: string[], assigneeAccountId: string) => Promise<BulkOperationResult>;
  bulkAddLabels: (issueKeys: string[], labels: string[]) => Promise<BulkOperationResult>;
  bulkMoveToXrayFolder: (issueKeys: string[], folderPath: string) => Promise<BulkOperationResult>;
  getLogs: () => Promise<any[]>;
  saveLogs: (logs: any[]) => Promise<void>;
  recordExecution: (execution: TestCaseExecution) => Promise<void>;
  getExecutionHistory: (testCaseId?: string) => Promise<TestCaseExecution[]>;
  getExecutionStats: () => Promise<{ totalExecutions: number; totalPassed: number; totalFailed: number; passRate: number }>;
  readLocalFile: (filePath: string, baseDir?: string) => Promise<{ name: string; data: string }>;
  getDirectoryName: (filePath: string) => Promise<string>;
  downloadAndInstallUpdate: () => Promise<void>;
  onDownloadProgress: (callback: (progress: { progress: number; downloaded: number; total: number }) => void) => () => void;
}

export interface JiraProject {
  key: string;
  name: string;
  id: string;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
}

export interface JiraStatus {
  id: string;
  name: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress: string;
}

export interface JqlBuilderFilters {
  project: string;
  sprint: string;
  status: string;
  assignee: string;
  labels: string;
}

export interface TestCaseExecution {
  id: string;
  testCaseId: string;
  testCaseTitle: string;
  result: "PASS" | "FAILED";
  executedBy: string;
  executedAt: string;
  sprint?: string;
  notes?: string;
  linkedIssueKey?: string;
}

export type ConfluenceImportMode = "auto" | "jql-match";

export interface ConfluenceTestImportEntry {
  id: string;
  issueKey: string;
  scenario: string;
  steps: string;
  expectedResult: string;
  functionName: string;
  testCaseNo: string;
  inputData: string;
  selected: boolean;
}

export type StepConflictMode = "replace" | "skip" | "append";

export type StepConflictCheck = {
  hasSteps: string[];
  noSteps: string[];
};

export interface UpdateProgress {
  current: number;
  total: number;
  currentKey: string;
  status: "processing" | "success" | "error";
  message?: string;
}

export interface XrayFolder {
  id: number;
  name: string;
  children?: XrayFolder[];
}

export interface UpdateTestCasesFromConfluenceResult {
  success: Array<{ key: string; message: string }>;
  failed: Array<{ key: string; error: string }>;
}

export interface BulkOperationResult {
  success: number;
  failed: number;
  errors: string[];
}

// ── Zod validation schemas ───────────────────────────────────────────

export const authModeSchema = z.enum(["bearer", "basic"]);
export const themeSchema = z.enum(["light", "dark", "system"]);

export const atlassianConnectionConfigSchema = z.object({
  baseUrl: z.string(),
  authMode: authModeSchema,
  username: z.string(),
  token: z.string(),
});

export const jiraConfigSchema = atlassianConnectionConfigSchema.extend({
  projectKey: z.string(),
  readyForQaJql: z.string(),
  bugIssueType: z.string(),
  testCaseIssueType: z.string(),
});

export const confluenceConfigSchema = atlassianConnectionConfigSchema.extend({
  spaceKey: z.string(),
  targetPageId: z.string(),
  jiraServerId: z.string().optional(),
});

export const ollamaConfigSchema = z.object({
  endpoint: z.string(),
  model: z.string(),
  jqlModel: z.string().optional(),
  chatModel: z.string().optional(),
  extractionModel: z.string().optional(),
  insightModel: z.string().optional(),
});

export const appConfigSchema = z.object({
  jira: jiraConfigSchema,
  confluence: confluenceConfigSchema,
  ollama: ollamaConfigSchema,
  preferences: z.object({
    theme: themeSchema,
    language: z.string(),
  }),
});

export const testCaseExecutionSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  testCaseTitle: z.string(),
  result: z.enum(["PASS", "FAILED"]),
  executedBy: z.string(),
  executedAt: z.string(),
  sprint: z.string().optional(),
  notes: z.string().optional(),
  linkedIssueKey: z.string().optional(),
});

export const defaultConfig: AppConfig = {
  jira: {
    baseUrl: "",
    authMode: "bearer",
    username: "",
    token: "",
    projectKey: "QA",
    readyForQaJql: "",
    bugIssueType: "Bug",
    testCaseIssueType: "Task",
  },
  confluence: {
    baseUrl: "",
    authMode: "bearer",
    username: "",
    token: "",
    spaceKey: "QA",
    targetPageId: "",
    jiraServerId: "",
  },
  ollama: {
    endpoint: "http://127.0.0.1:11434",
    model: "qwen2.5:7b",
    jqlModel: "",
    chatModel: "",
    extractionModel: "",
    insightModel: "",
  },
  preferences: {
    theme: "light",
    language: "id-ID",
  },
};
