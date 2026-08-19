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
  | "daily-uqa"
  | "knowledge-base"
  | "logs"
  | "settings"
  | "documentation"
  | "defect-repository"
  | "test-cycle-manager"
  | "project-management";
export type ExtractionDepth = "comprehensive" | "happy-path" | "edge-case";
export type IntentRoute = "jira" | "confluence" | "mixed" | "clarify";

export interface OcrResult {
  text: string;
  confidence: number;
  sourceAttachment: string;
  sourcePageId: string;
}

export interface IntentClassification {
  route: IntentRoute;
  confidence: number;
  reason: string;
  detectedKeywords: string[];
  projectKey?: string;
  statusHint?: string;
}

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

export interface BitbucketConfig extends AtlassianConnectionConfig {
  defaultProjectKey?: string;
  defaultRepoSlug?: string;
}

export interface OllamaConfig {
  endpoint: string;
  model: string;
  jqlModel?: string;
  chatModel?: string;
  extractionModel?: string;
  insightModel?: string;
  defectEmbeddingModel?: string;
  defectExplanationModel?: string;
}

export interface BitbucketFileChange {
  path: string;
  changeType: string;
  linesAdded: number;
  linesDeleted: number;
}

export interface BitbucketDiffSummary {
  projectKey: string;
  repoSlug: string;
  prId: number;
  title: string;
  latestCommitHash: string;
  authorName: string;
  branchFrom: string;
  branchTo: string;
  files: BitbucketFileChange[];
  jiraTicketKey?: string;
  jiraSummary?: string;
  jiraDescription?: string;
  cached: boolean;
}

export interface ImpactAnalysisResult {
  affectedComponents: string[];
  modifiedFunctions: string[];
  apiRoutesChanged: string[];
  regressionRiskLevel: "High" | "Medium" | "Low";
  summaryNotes: string;
}

export interface GapAnalysisResult {
  existingTestCount: number;
  missingCoverageAreas: string[];
  duplicateRiskNotes: string[];
}

export interface TestStepItem {
  step: number;
  action: string;
  expected: string;
}

export interface BitbucketTestScenario {
  scenario: string;
  confidence: number;
  reason: string;
  scenarioType: string;
  riskLevel: string;
  preconditions: string[];
  steps: TestStepItem[];
}

export interface BitbucketGenerateRequest {
  prUrlOrId: string;
  selectedFiles: string[];
  forceRefreshCache: boolean;
}

export interface BitbucketGenerateResponse {
  prId: number;
  commitHash: string;
  cacheHit: boolean;
  impact: ImpactAnalysisResult;
  gap: GapAnalysisResult;
  scenarios: BitbucketTestScenario[];
}

export interface UqaEntry {
  date: string;
  activity: string;
  notes?: string;
}

export interface UqaTransition {
  id: string;
  name: string;
  toStatus: string;
}

export interface PerIssueReminder {
  issueKey?: string;
  remindTime?: string;
  remindDays?: number[];
  note?: string;
  enabled?: boolean;
}

export interface UqaConfig {
  enabled: boolean;
  remindTime: string;
  remindDays: number[];
  productTesterFieldId?: string | null;
  lastNotifiedDate?: Record<string, string>;
  perIssueReminders?: Record<string, PerIssueReminder>;
  searchMode: string;
  projectKeys: string[];
}

export interface UqaIssue {
  key?: string;
  issueKey: string;
  projectKey: string;
  projectName?: string;
  summary: string;
  status: string;
  statusCategory?: string;
  assignee?: string;
  productTester?: string;
  lastUpdated?: string | null;
  needsUpdate?: boolean;
  availableTransitions?: UqaTransition[];
  lastUpdateAuthor?: string;
  lastUpdateDate?: string;
  entries?: UqaEntry[];
}

export interface UqaSyncProgress {
  current: number;
  total: number;
  statusText?: string;
  status?: string;
  message?: string;
}

export interface AppConfig {
  jira: JiraConfig;
  confluence: ConfluenceConfig;
  ollama: OllamaConfig;
  preferences: {
    theme: ThemePreference;
    language: string;
  };
  uqa: UqaConfig;
  dashboard: {
    projects: DashboardProjectConfig[];
  };
  bitbucket: BitbucketConfig;
}

export interface ConnectionStatusItem {
  ok: boolean;
  message: string;
}

export interface ConnectionStatus {
  jira: ConnectionStatusItem;
  confluence: ConnectionStatusItem;
  ollama: ConnectionStatusItem;
  bitbucket?: ConnectionStatusItem;
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

export interface DashboardProjectConfig {
  projectKey: string;
  issueType: string;
  customJql?: string;
  excludeLabels: string[];
  includeLabels: string[];
  excludeStatuses: string[];
  includeStatuses: string[];
  enabled: boolean;
}

export interface DashboardProjectData {
  bugMetrics: BugMetrics;
  readyForQa: JiraIssueSummary[];
}

export interface ProjectInsightRequest {
  projectKey: string;
  bugMetrics: BugMetrics;
  readyForQa: JiraIssueSummary[];
  sprintReport?: SprintReport | null;
}

export interface DashboardDigest {
  insight: string;
  readyForQa: JiraIssueSummary[];
  bugMetrics: BugMetrics;
  projects: Record<string, DashboardProjectData>;
  sprintReport?: SprintReport;
  isDemo?: boolean;
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

export interface DefectCreateDraft {
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  environment: string;
  priority: string;
  labels: string;
  component: string;
  version: string;
  severity: string;
}

export interface ExtractedTestCase {
  id: string;
  title: string;
  objective: string;
  priority: string;
  category: string;
  selected: boolean;
  sourceEvidence?: string;
  confidence?: number;
}

export const VALID_PRIORITIES = ["P1", "P2", "P3"] as const;
export const VALID_CATEGORIES = [
  "Functional", "UI/UX", "Security", "Performance", "Integration",
  "Data Validation", "Accessibility", "Error Handling", "Edge Case", "Manual Review"
] as const;

export function validateExtractedTestCase(tc: any): tc is ExtractedTestCase {
  if (!tc || typeof tc !== "object") return false;
  if (typeof tc.id !== "string" || !/^TC-\d{3,}$/.test(tc.id)) return false;
  if (typeof tc.title !== "string" || tc.title.trim().length === 0) return false;
  if (typeof tc.objective !== "string" || tc.objective.trim().length === 0) return false;
  if (!VALID_PRIORITIES.includes(tc.priority as any)) return false;
  if (typeof tc.category !== "string" || tc.category.trim().length === 0) return false;
  if (typeof tc.selected !== "boolean") return false;
  return true;
}

export function sanitizeExtractedTestCase(tc: any): ExtractedTestCase | null {
  if (!validateExtractedTestCase(tc)) return null;
  return {
    id: tc.id,
    title: tc.title.trim(),
    objective: tc.objective.trim(),
    priority: tc.priority,
    category: tc.category.trim(),
    selected: tc.selected,
    sourceEvidence: typeof tc.sourceEvidence === "string" ? tc.sourceEvidence.trim() : undefined,
    confidence: typeof tc.confidence === "number" ? tc.confidence : undefined,
  };
}

export interface ExtractedTestCaseResult {
  pageTitle: string;
  sourceUrl: string;
  testCases: ExtractedTestCase[];
  isFallback?: boolean;
}

export interface ManualTestCase {
  id: string;
  title: string;
  description: string;
  steps: string;
  expectedResult: string;
  xrayFolder: string;
  labels: string;
  projectKey?: string;
  testExecutionKey?: string;
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
  includeImages?: boolean;
  includeJiraServerId?: boolean;
  /** Parse in "Update from Confluence" mode: keep the raw scenario with its Jira issue key. */
  updateFromConfluence?: boolean;
}

export interface ConfluenceParseProgress {
  stage: "fetch_page" | "parse_tables" | "detect_jira" | "fetch_attachments" | "download_images" | "done" | "error";
  message: string;
  current: number;
  total: number;
  detail?: string;
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
  getDashboard: (options?: { skipInsight?: boolean }) => Promise<DashboardDigest>;
  getProjectInsight: (request: ProjectInsightRequest) => Promise<string>;
  askAssistant: (prompt: string, history?: ChatHistoryMessage[]) => Promise<ChatResponse>;
  polishBugReport: (draft: BugFormDraft) => Promise<BugPreview>;
  createBug: (draft: BugFormDraft, preview: BugPreview) => Promise<{ key: string; url: string }>;
  createDefectIssue: (draft: DefectCreateDraft) => Promise<{ key: string; url: string }>;
  extractTestCases: (
    url: string,
    depth: ExtractionDepth
  ) => Promise<ExtractedTestCaseResult>;
  createTestCases: (cases: ExtractedTestCase[]) => Promise<{ created: Array<{ key: string; url: string }> }>;
  createManualTestCases: (cases: ManualTestCase[], assignee?: string) => Promise<{ created: Array<{ key: string; url: string }> }>;
  organizeTestsIntoXray: (source: string, folderPath: string, projectKey: string) => Promise<{ count: number }>;
  getXrayFolders: (projectKey: string) => Promise<XrayFolder[]>;
  checkTestSteps: (entries: ConfluenceTestImportEntry[]) => Promise<StepConflictCheck>;
  fetchTestSteps: (issueKey: string) => Promise<FetchTestStepsResult | null>;
  pushEntryToJira: (input: { issueKey: string; steps: string; expectedResult: string; inputData: string; category: string }) => Promise<void>;
  updateTestCasesFromConfluence: (entries: ConfluenceTestImportEntry[], mode?: StepConflictMode) => Promise<UpdateTestCasesFromConfluenceResult>;
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void;
  findTestCasesByJql: (jql: string, maxResults: number) => Promise<JiraIssueSummary[]>;
  getXrayFolderIssues: (projectKey: string, folderId: number) => Promise<{ key: string; summary: string }[]>;
  addTestsToExecution: (execKey: string, testKeys: string[]) => Promise<void>;
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
  onConfluenceParseProgress: (callback: (progress: ConfluenceParseProgress) => void) => () => void;
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
  getXrayExecutionDetails: (execKey: string) => Promise<XrayExecutionDetails>;
  getXrayExecutionHistory: (execKey: string) => Promise<XrayExecutionSnapshot[]>;
  injectExecutionReport: (targetIssueKey: string, execKey: string, snapshots: XrayExecutionSnapshot[]) => Promise<void>;
  getLogs: () => Promise<any[]>;
  saveLogs: (logs: any[]) => Promise<void>;
  recordExecution: (execution: TestCaseExecution) => Promise<void>;
  getExecutionHistory: (testCaseId?: string) => Promise<TestCaseExecution[]>;
  getExecutionStats: () => Promise<{ totalExecutions: number; totalPassed: number; totalFailed: number; passRate: number }>;
  readLocalFile: (filePath: string, baseDir?: string) => Promise<{ name: string; data: string }>;
  getDirectoryName: (filePath: string) => Promise<string>;
  downloadAndInstallUpdate: () => Promise<void>;
  onDownloadProgress: (callback: (progress: { progress: number; downloaded: number; total: number }) => void) => () => void;
  // UQA
  getUqaIssues: () => Promise<UqaIssue[]>;
  getUqaTransitions: (issueKey: string) => Promise<UqaTransition[]>;
  appendUqaEntry: (issueKey: string, date: string, phase: string, activity: string) => Promise<void>;
  appendUqaEntryWithNotes: (issueKey: string, date: string, activity: string, notes: string) => Promise<void>;
  transitionUqaIssue: (issueKey: string, transitionId: string) => Promise<void>;
  onUqaReminder: (callback: (issueKey: string, summary: string) => void) => () => void;
  checkUqaOnStartup: () => Promise<UqaIssue[]>;
  cancelRequest: (requestId: string) => void;
  onExtractionProgress: (callback: (msg: string) => void) => () => void;
  onBrdChunkProgress: (callback: (progress: BrdChunkProgress) => void) => () => void;
  getUqaField: () => Promise<{ id: string; name: string; type: string; isCustom: boolean } | null>;
  updateUqaSchedule: (config: UqaConfig) => Promise<void>;
  getUqaSchedule: () => Promise<UqaConfig>;
  autoGenerateUqaNotes: (issueKey: string) => Promise<AutoUqaGeneratedPayload>;
  getUqaDbExecutionSummary: (uqaKey: string) => Promise<DbTeSummary[]>;
  getPerUqaReminder: (issueKey: string) => Promise<PerIssueReminder | null>;
  updatePerUqaReminder: (issueKey: string, reminder: PerIssueReminder) => Promise<void>;
  getUqaIssuesFromStore: () => Promise<UqaIssue[]>;
  syncUqaIssues: () => Promise<UqaIssue[]>;
  onUqaSyncProgress: (callback: (progress: UqaSyncProgress) => void) => () => void;
  // Defect Repository
  getDefectSources: (username: string, displayName: string) => Promise<JiraProjectSource[]>;
  saveDefectSource: (source: JiraProjectSource) => Promise<JiraProjectSource[]>;
  deleteDefectSource: (id: string) => Promise<JiraProjectSource[]>;
  syncDefectSource: (projectKey: string) => Promise<{ indexed: number; skipped: number }>;
  findDefectDuplicateCandidates: (filters: SearchFilters) => Promise<DuplicateCandidate[]>;
  searchDefects: (filters: SearchFilters) => Promise<{ candidates: DuplicateCandidate[]; defects: DefectRecord[] }>;
  getDefect: (id: string) => Promise<DefectRecord | null>;
  getDefectDuplicateRelations: (defectId: string) => Promise<DuplicateRelation[]>;
  markDuplicateDefect: (relation: Omit<DuplicateRelation, "id" | "createdAt">) => Promise<DuplicateRelation>;
  removeDuplicateDefectLink: (id: string) => Promise<void>;
  getDefectStats: () => Promise<DefectRepositoryStats>;
  reindexAllDefects: () => Promise<void>;
  syncDefectToDb: (defectKey: string, judulDefect: string) => Promise<void>;
  getCurrentUser: () => Promise<Record<string, unknown>>;
  loginUser: (pn: string, password: string) => Promise<{ success: boolean; role: string | null; jira_api_token: string | null; confluence_api_token: string | null; message: string }>;
  registerUser: (pn: string, password: string, role: string) => Promise<{ success: boolean; role: string | null; message: string }>;
  updateUserTokens: (pn: string, jiraApiToken: string, confluenceApiToken: string) => Promise<void>;
  getMyUqaProjects: (username: string, displayName: string) => Promise<MonitoringUqaProject[]>;
  getMyTestExecutions: (username: string, displayName: string) => Promise<MonitoringTestExecution[]>;
  getMyTestCasesByExecution: (teJiraKey: string, username: string) => Promise<MonitoringTestCase[]>;
  getTestCasesByTeKey: (teJiraKey: string) => Promise<MonitoringTestCase[]>;
  fetchTcDetailsBatch: (tcKeys: string[]) => Promise<FetchTestStepsResult[]>;
  updateTestRunStatus: (teKey: string, tcKey: string, status: string) => Promise<void>;
  updateTestCaseRunStatus: (tcKey: string, teJiraKey: string, testRunStatus: string, executedBy: string) => Promise<void>;
  updateTestExecutionStatus: (teJiraKey: string, executionStatus: string) => Promise<void>;
  getTestCaseTitles: (tcKeys: string[]) => Promise<Record<string, string>>;
  // BRD / Test Management
  generateTestCasesFromBRD: (request: BRDGenerationRequest) => Promise<BRDGenerationResult>;
  getGeneratedTestCases: (testExecutionId: string) => Promise<BRDTestCase[]>;
  updateBRDTestCase: (testCase: BRDTestCase) => Promise<BRDTestCase>;
  deleteBRDTestCase: (id: string) => Promise<void>;
  syncBRDTestCasesToJira: (testExecutionId: string, projectKey: string, folderPath?: string) => Promise<{ success: number; failed: number; errors: string[] }>;
  // Test Plans
  getTestPlans: () => Promise<TestPlan[]>;
  createTestPlan: (uqaKey: string, phase: string, name: string, description: string, projectKey: string) => Promise<TestPlan>;
  updateTestPlan: (plan: TestPlan) => Promise<TestPlan>;
  deleteTestPlan: (id: string) => Promise<void>;
  syncTestPlanToJira: (planId: string) => Promise<{ key: string; url: string } | null>;
  // Test Executions
  getTestExecutions: (testPlanId?: string) => Promise<TestExecution[]>;
  createTestExecution: (testPlanId: string, assignee: string, name: string, projectKey: string, featureName: string) => Promise<TestExecution>;
  updateTestExecution: (execution: TestExecution) => Promise<TestExecution>;
  deleteTestExecution: (id: string) => Promise<void>;
  syncTestExecutionToJira: (executionId: string) => Promise<{ key: string; url: string } | null>;
  // Execution Monitoring
  getExecutionMonitoringData: (testExecutionId?: string) => Promise<ExecutionMonitoringData[]>;
  // Semantic Search
  semanticSearchTestCases: (query: string, projectKey: string) => Promise<SemanticSearchResult[]>;
  // OCR
  ocrExtractFromFile: (filePath: string) => Promise<OcrResult | null>;

  // ── Central Database ──────────────────────────────────────────────────
  checkDbConnection: () => Promise<string>;
  saveUqaTestPlan: (input: SaveTestPlanInput) => Promise<void>;
  getDbTestPlans: () => Promise<DbTestPlan[]>;
  checkTestPlansInDb: (tpKeys: string[]) => Promise<string[]>;
  saveTestExecutions: (executions: SaveTestExecutionInput[]) => Promise<void>;
  checkTestExecutionsInDb: (teKeys: string[]) => Promise<string[]>;
  saveTestRepositories: (repositories: SaveTestRepositoryInput[]) => Promise<void>;
  getTestRepositoriesInDb: () => Promise<DbTestRepository[]>;
  fetchUqaWithDates: () => Promise<UqaWithDates[]>;
  saveUqaProjects: (projects: SaveUqaProjectInput[]) => Promise<void>;
  resyncUqaProject: (project: SaveUqaProjectInput) => Promise<void>;
  checkUqaProjectsInDb: (uqaKeys: string[]) => Promise<string[]>;
  saveTestCases: (cases: SaveTestCaseInput[]) => Promise<void>;
  syncExecutionTestsToDb: (execKey: string) => Promise<number>;
  // Bitbucket Self-Hosted
  getBitbucketPrDetails: (prUrlOrId: string) => Promise<BitbucketDiffSummary>;
  fetchBitbucketDiff: (prUrlOrId: string) => Promise<string>;
  generateTestScenariosFromBitbucket: (request: BitbucketGenerateRequest) => Promise<BitbucketGenerateResponse>;
}

export interface UqaWithDates {
  uqaKey: string;
  summary: string;
  status: string;
  assignee: string;
  productTester: string;
  startSit: string | null;
  finishSit: string | null;
  startUat: string | null;
}

export interface SaveUqaProjectInput {
  uqa_key: string;
  project_name: string;
  assignee?: string;
  product_tester?: string;
  status?: string;
  start_sit?: string;
  finish_sit?: string;
  start_uat?: string;
}

export interface DbUqaProject {
  uqa_key: string;
  project_name: string;
  assignee: string | null;
  product_tester: string | null;
  status: string | null;
  start_sit: string | null;
  finish_sit: string | null;
  start_uat: string | null;
  last_sync: string | null;
}

export interface SaveTestRepositoryInput {
  project_key: string;
  project_name: string;
}

export interface DbTestRepository {
  project_key: string;
  project_name: string;
  last_sync: string | null;
}

export interface SaveTestExecutionInput {
  te_jira_key: string;
  title: string;
  tp_jira_key: string;
  assignee?: string;
  execution_status?: string;
}

export interface DbTestPlan {
  tp_jira_key: string;
  title: string;
  uqa_key: string;
  assignee: string | null;
  last_sync: string | null;
}

export interface SaveTestPlanInput {
  uqa_key: string;
  tp_jira_key: string;
  title?: string;
  assignee?: string;
}

export interface SaveTestCaseInput {
  tc_key: string;
  te_jira_key: string;
  scenario?: string;
  category?: string;
  steps?: string;
  expected_result?: string;
  input_data?: string;
  function_name?: string;
  test_case_no?: string;
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

export interface FetchTestStepsResult {
  issueKey: string;
  summary: string;
  steps: string;
  expectedResult: string;
  inputData: string;
  labels?: string[];
  functionName?: string;
}

export interface ConfluenceEntryImage {
  id: string;
  name: string;
  data: string; // data URI: "data:image/png;base64,..."
  order: number;
  note: string;
  expandGroup?: string;
}

export interface ConfluenceTestImportEntry {
  id: string;
  issueKey: string;
  scenario: string;
  scenarioTitle?: string;
  steps: string;
  expectedResult: string;
  functionName: string;
  testCaseNo: string;
  inputData: string;
  selected: boolean;
  screenCaptureFilenames: string[];
  images: ConfluenceEntryImage[];
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
  parentId?: number;
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

export type XrayTestStatus = "TODO" | "EXECUTING" | "PASS" | "FAIL" | "ABORTED";

export interface XrayTestRun {
  id: number;
  key: string;
  status: XrayTestStatus;
  defects?: Array<{ key: string; summary: string }>;
}

export interface XrayExecutionSnapshot {
  date: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  unexecuted: number;
  inProgress: number;
}

export interface XrayExecutionDetails {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  updated: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  unexecuted: number;
  inProgress: number;
  passRate: number;
  history: XrayExecutionSnapshot[];
}

export interface PhaseTestSummary {
  phase: string;
  testExecKey: string;
  testExecName: string;
  todo: number;
  inProgress: number;
  done: number;
  failed: number;
  aborted: number;
  failedDetails: Array<{ testKey: string; defects: string[] }>;
}

export interface AutoUqaGeneratedPayload {
  date: string;
  activity: string[];
  phases: PhaseTestSummary[];
  generatedNotes: string;
  noLinksFound?: boolean;
  /** "db" = came from local DB (today's synced TEs), "jira" = live Xray API */
  source?: "db" | "jira";
}

export interface DbTeSummary {
  teJiraKey: string;
  teTitle?: string;
  executionStatus: string;
  lastSync?: string;
  total: number;
  done: number;
  failed: number;
  aborted: number;
  inProgress: number;
  todo: number;
}

export interface UqaIssueLink {
  issueKey: string;
  issueTypeName: string;
  summary: string;
}

// ── Defect Repository Types ──────────────────────────────────────────

export type DefectSyncMode = "initial" | "incremental";
export type DefectSyncStatus = "idle" | "syncing" | "success" | "error";

export interface JiraProjectSource {
  id: string;
  projectKey: string;
  projectName: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  autoSyncEnabled?: boolean;
  autoSyncDays?: number[];
  autoSyncTime?: string;
  issueTypes?: string[];
  lastAutoSyncAt?: string | null;
  syncMode: DefectSyncMode;
  syncStatus: DefectSyncStatus;
  errorMessage?: string;
}

export interface JiraIssueSource {
  id: string;
  jiraIssueKey: string;
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  status: string;
  priority: string;
  severity: string;
  component: string;
  version: string;
  reporter: string;
  assignee: string;
  labels: string[];
  resolution: string;
  createdAt: string;
  updatedAt: string;
  comments: string;
  attachmentsMetadata: string;
}

export interface DefectRecord {
  id: string;
  sourceIssueKey: string;
  sourceProjectKey: string;
  issueType: string;
  normalizedTitle: string;
  normalizedDescription: string;
  searchText: string;
  status: string;
  component: string;
  version: string;
  severity: string;
  priority: string;
  similarityFingerprint: string;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateRelation {
  id: string;
  primaryDefectId: string;
  duplicateDefectId: string;
  reason: string;
  confidenceScore: number;
  createdBy: string;
  createdAt: string;
}

export interface SyncState {
  id: string;
  projectKey: string;
  lastCursor: string;
  lastSyncAt: string;
  lastSyncStatus: string;
  errorMessage: string;
}

export interface DuplicateCandidate {
  defect: DefectRecord;
  score: number;
  reasons: string[];
}

export interface SearchFilters {
  query: string;
  projectKeys?: string[];
  issueTypes?: string[];
  statuses?: string[];
  components?: string[];
  versions?: string[];
  severities?: string[];
  useAI?: boolean;
}

export interface DefectRepositoryStats {
  totalDefects: number;
  totalDuplicates: number;
  defectsPerProject: { projectKey: string; count: number }[];
  duplicatesPerProject: { projectKey: string; count: number }[];
  topComponents: { component: string; count: number }[];
  topIssueTypes: { issueType: string; count: number }[];
}

export interface DefectRepositoryApi {
  getSources: () => Promise<JiraProjectSource[]>;
  saveSource: (source: JiraProjectSource) => Promise<JiraProjectSource[]>;
  deleteSource: (id: string) => Promise<JiraProjectSource[]>;
  syncSource: (projectKey: string) => Promise<{ indexed: number; skipped: number }>;
  findDuplicateCandidates: (filters: SearchFilters) => Promise<DuplicateCandidate[]>;
  searchDefects: (filters: SearchFilters) => Promise<{ candidates: DuplicateCandidate[]; defects: DefectRecord[] }>;
  getDefect: (id: string) => Promise<DefectRecord | null>;
  getDuplicateRelations: (defectId: string) => Promise<DuplicateRelation[]>;
  markDuplicate: (relation: Omit<DuplicateRelation, "id" | "createdAt">) => Promise<DuplicateRelation>;
  removeDuplicateLink: (id: string) => Promise<void>;
  getStats: () => Promise<DefectRepositoryStats>;
  reindexAll: () => Promise<void>;
}

// ── BRD / Test Management Types ─────────────────────────────────────

export type ScenarioType = "Positive" | "Negative" | "Regression";
export type ExecutionStatusType = "Pass" | "Fail" | "Blocked" | "Unexecuted";
export type TestCaseSyncStatus = "Draft AI" | "Synced to Jira" | "Failed to Sync";
export type TestPhase = "SIT" | "UAT" | "DT";

export interface BRDTestCaseStep {
  stepNumber: number;
  action: string;
}

export interface BRDTestCaseExpectedResult {
  stepNumber: number;
  result: string;
}

export interface BRDTestCase {
  id: string;
  testExecutionId: string;
  name: string;
  featureCategory: string;
  scenarioType: ScenarioType;
  steps: BRDTestCaseStep[];
  expectedResult: BRDTestCaseExpectedResult[];
  assignee: string;
  executionStatus: ExecutionStatusType;
  syncStatus: TestCaseSyncStatus;
  jiraTestCaseKey: string | null;
  lastUpdated: string;
}

export interface BRDGenerationRequest {
  confluencePageId: string;
  projectKey: string;
}

export interface BRDGenerationResult {
  success: boolean;
  featureName: string;
  testCases: BRDTestCase[];
  testExecutionId?: string;
  error?: string;
}

export interface BrdChunkProgress {
  featureIndex: number;
  featureTotal: number;
  featureName: string;
  testCases: BRDTestCase[];
  testExecutionId: string;
}

export interface TestPlan {
  id: string;
  jiraTestPlanKey: string | null;
  uqaKey: string;
  phase: TestPhase;
  name: string;
  description: string;
  projectKey: string;
  lastUpdated: string;
}

export interface TestExecution {
  id: string;
  jiraTestExecKey: string | null;
  testPlanId: string;
  assignee: string;
  name: string;
  projectKey: string;
  featureName: string;
  lastUpdated: string;
}

export interface BRDStoreData {
  testPlans: TestPlan[];
  testExecutions: TestExecution[];
  testCases: BRDTestCase[];
}

export interface ExecutionMonitoringData {
  testExecutionId: string;
  testExecutionName: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  unexecuted: number;
  passRate: number;
}

export interface SemanticSearchResult {
  issueKey: string;
  summary: string;
  score: number;
  matchReason: string;
}

// ── Monitoring screen types ──────────────────────────────────────────────

export interface MonitoringUqaProject {
  uqa_key: string;
  project_name: string | null;
  assignee: string | null;
  product_tester: string | null;
  status: string | null;
  start_qa: string | null;
  finish_qa: string | null;
  finish_uat: string | null;
  last_sync: string | null;
}

export interface MonitoringTestExecution {
  te_jira_key: string;
  title: string | null;
  tp_jira_key: string | null;
  assignee: string | null;
  execution_status: string | null;
  last_sync: string | null;
}

export interface MonitoringTestCase {
  tc_key: string;
  te_jira_key: string;
  title: string | null;
  test_run_status: string | null;
  executed_by: string | null;
  executed_at: string | null;
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
  defectEmbeddingModel: z.string().optional(),
  defectExplanationModel: z.string().optional(),
});

export const uqaConfigSchema = z.object({
  enabled: z.boolean(),
  remindTime: z.string(),
  remindDays: z.array(z.number()),
  productTesterFieldId: z.string().nullable(),
  lastNotifiedDate: z.record(z.string()),
  perIssueReminders: z.record(z.object({
    enabled: z.boolean(),
    remindTime: z.string().optional(),
    remindDays: z.array(z.number()).optional(),
  })),
  searchMode: z.enum(["productTester", "assignee", "both"]),
  projectKeys: z.array(z.string()),
});

export const appConfigSchema = z.object({
  jira: jiraConfigSchema,
  confluence: confluenceConfigSchema,
  ollama: ollamaConfigSchema,
  preferences: z.object({
    theme: themeSchema,
    language: z.string(),
  }),
  uqa: uqaConfigSchema,
  dashboard: z.object({
      projects: z.array(z.object({
        projectKey: z.string(),
        issueType: z.string(),
        excludeLabels: z.array(z.string()),
        includeLabels: z.array(z.string()),
        excludeStatuses: z.array(z.string()),
        includeStatuses: z.array(z.string()),
        enabled: z.boolean(),
      })),
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
    defectEmbeddingModel: "embeddinggemma",
    defectExplanationModel: "",
  },
  preferences: {
    theme: "light",
    language: "id-ID",
  },
  uqa: {
    enabled: false,
    remindTime: "16:00",
    remindDays: [1, 2, 3, 4, 5],
    productTesterFieldId: null,
    lastNotifiedDate: {},
    perIssueReminders: {},
    searchMode: "both",
    projectKeys: [],
  },
  dashboard: {
    projects: [],
  },
  bitbucket: {
    baseUrl: "",
    authMode: "bearer",
    username: "",
    token: "",
    defaultProjectKey: "",
    defaultRepoSlug: "",
  },
};
