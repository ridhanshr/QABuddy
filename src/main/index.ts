import { app, BrowserWindow, ipcMain, shell, Notification, Menu } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { ConfigStore } from "./config-store";
import { QaService } from "./services/qa-service";
import { RagService } from "./services/rag-service";
import { logger } from "./services/logger";
import { UpdateService } from "./services/update-service";
import { UqaScheduler } from "./services/uqa-scheduler";
import { DefectRepositoryService } from "./services/defect-repository/defect-repository-service";
import { DefectAutoSyncScheduler } from "./services/defect-repository/defect-auto-sync-scheduler";
import { OcrService } from "./services/ocr-service";
import type {
  AppConfig,
  BugFormDraft,
  BugPreview,
  DefectCreateDraft,
  ConfluenceTestImportEntry,
  ExtractedTestCase,
  ExtractionDepth,
  ManualTestCase,
  ParseConfluenceEntriesOptions,
  StepConflictCheck,
  StepConflictMode,
  TestCaseExecution,
  UpdateProgress,
  XrayFolder,
  FetchTestStepsResult,
  JiraProjectSource,
  DuplicateRelation,
  SearchFilters,
} from "@shared/types";
import { testCaseExecutionSchema } from "@shared/types";

const store = new ConfigStore();
const ragService = new RagService();
const qaService = new QaService(ragService);
const ocrService = new OcrService();
const updateService = new UpdateService();
const uqaScheduler = new UqaScheduler();
const defectRepoService = new DefectRepositoryService("http://127.0.0.1:11434");
const defectAutoSyncScheduler = new DefectAutoSyncScheduler();

const logsFilePath = path.join(app.getPath("userData"), "qa-buddy-logs.json");
const execFilePath = path.join(app.getPath("userData"), "qa-buddy-executions.json");

const logsTmpPath = logsFilePath + ".tmp";
const execTmpPath = execFilePath + ".tmp";

async function loadLogs(): Promise<any[]> {
  try {
    const raw = await fs.readFile(logsFilePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveLogs(logs: any[]): Promise<void> {
  await fs.mkdir(path.dirname(logsFilePath), { recursive: true });
  const data = JSON.stringify(logs, null, 2);
  await fs.writeFile(logsTmpPath, data, "utf8");
  await fs.rename(logsTmpPath, logsFilePath);
}

async function loadExecutions(): Promise<TestCaseExecution[]> {
  try {
    const raw = await fs.readFile(execFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item: any) => testCaseExecutionSchema.safeParse(item).success);
  } catch {
    return [];
  }
}

async function saveExecutions(execs: TestCaseExecution[]): Promise<void> {
  await fs.mkdir(path.dirname(execFilePath), { recursive: true });
  const data = JSON.stringify(execs, null, 2);
  await fs.writeFile(execTmpPath, data, "utf8");
  await fs.rename(execTmpPath, execFilePath);
}


let mainWindow: BrowserWindow | null = null;
let lastReadyForQaCount = 0;
const notifiedReadyForQaKeys = new Set<string>();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: "#f7f9fb",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses Node APIs; set to false for Electron APIs access
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // Forward RAG progress events to renderer
  ragService.onProgress((progress) => {
    mainWindow?.webContents.send("rag-progress", progress);
  });
}

async function getConfig(): Promise<AppConfig> {
  return store.load();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  ipcMain.handle("bootstrap", async () => {
    const config = await getConfig();
    return qaService.bootstrap(config);
  });

  ipcMain.handle("checkForUpdates", async () => {
    return updateService.checkForUpdates(app.getVersion(), false);
  });

  ipcMain.handle("getUpdateStatus", async () => {
    return updateService.getCachedStatus();
  });

  ipcMain.handle("downloadAndInstallUpdate", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return updateService.downloadAndInstallUpdate((progress) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("download-progress", progress);
      }
    });
  });

  ipcMain.handle("saveConfig", async (_, config: AppConfig) => {
    const saved = await store.save(config);
    if (config.uqa?.enabled) {
      uqaScheduler.restart(config.uqa);
    } else if (config.uqa && !config.uqa.enabled) {
      uqaScheduler.stop();
    }
    return saved;
  });
  ipcMain.handle("testConnections", async () => qaService.testConnections(await getConfig()));
  ipcMain.handle("healthcheck", async () => qaService.healthcheck(await getConfig()));
  ipcMain.handle("getDashboard", async (_, options?: { skipInsight?: boolean }) => {
    const dashboard = await qaService.getDashboard(await getConfig(), options?.skipInsight);
    if (dashboard.readyForQa && dashboard.readyForQa.length > 0) {
      const newIssues = dashboard.readyForQa.filter(i => !notifiedReadyForQaKeys.has(i.key));
      if (newIssues.length > 0 && lastReadyForQaCount > 0) {
        for (const issue of newIssues.slice(0, 3)) {
          const notif = new Notification({
            title: `New: ${issue.key} - ${issue.summary}`,
            body: `Status: ${issue.status} · Priority: ${issue.priority} · Assignee: ${issue.assignee}`,
            silent: false,
          });
          notif.on("click", () => {
            shell.openExternal(issue.url);
          });
          notif.show();
        }
        if (newIssues.length > 3) {
          const notif = new Notification({
            title: `+${newIssues.length - 3} more issues ready for QA`,
            body: `Total ${dashboard.readyForQa.length} issues waiting for QA in ${(await getConfig()).jira.projectKey}`,
          });
          notif.show();
        }
      }
      for (const issue of dashboard.readyForQa) {
        notifiedReadyForQaKeys.add(issue.key);
      }
      lastReadyForQaCount = dashboard.readyForQa.length;
    }
    return dashboard;
  });
  ipcMain.handle("askAssistant", async (_, prompt: string, history?: any[]) =>
    qaService.askAssistant(await getConfig(), prompt, history || [])
  );
  ipcMain.handle("polishBugReport", async (_, draft: BugFormDraft) =>
    qaService.polishBugReport(await getConfig(), draft)
  );
  ipcMain.handle("createBug", async (_, draft: BugFormDraft, preview: BugPreview) =>
    qaService.createBug(await getConfig(), draft, preview)
  );
  ipcMain.handle("createDefectIssue", async (_, draft: DefectCreateDraft) =>
    qaService.createDefectIssue(await getConfig(), draft)
  );
  ipcMain.handle("extractTestCases", async (_, url: string, depth: ExtractionDepth) =>
    qaService.extractTestCases(await getConfig(), url, depth)
  );
  ipcMain.handle("createTestCases", async (_, cases: ExtractedTestCase[]) =>
    qaService.createTestCases(await getConfig(), cases)
  );
  ipcMain.handle("createManualTestCases", async (_, cases: ManualTestCase[]) =>
    qaService.createManualTestCases(await getConfig(), cases)
  );
  ipcMain.handle("organizeTestsIntoXray", async (_, source: string, folderPath: string, projectKey: string) =>
    qaService.organizeTestsIntoXray(await getConfig(), source, folderPath, projectKey)
  );
  ipcMain.handle("getXrayFolders", async (_, projectKey: string): Promise<XrayFolder[]> =>
    qaService.getXrayFolders(await getConfig(), projectKey)
  );
  ipcMain.handle("checkTestSteps", async (_, entries: ConfluenceTestImportEntry[]): Promise<StepConflictCheck> =>
    qaService.checkTestSteps(await getConfig(), entries)
  );
  ipcMain.handle("fetchTestSteps", async (_, issueKey: string): Promise<FetchTestStepsResult | null> =>
    qaService.fetchTestSteps(await getConfig(), issueKey)
  );
  ipcMain.handle("updateTestCasesFromConfluence", async (event, entries: ConfluenceTestImportEntry[], mode?: StepConflictMode) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const sendProgress = (p: UpdateProgress) => win?.webContents.send("update-progress", p);
    return qaService.updateTestCasesFromConfluence(await getConfig(), entries, mode, sendProgress);
  });
  ipcMain.handle("findTestCasesByJql", async (_, jql: string, maxResults: number) =>
    qaService.findTestCasesByJql(await getConfig(), jql, maxResults)
  );
  ipcMain.handle("getXrayFolderIssues", async (_, projectKey: string, folderId: number) =>
    qaService.getXrayFolderIssues(await getConfig(), projectKey, folderId)
  );
  ipcMain.handle("openExternal", async (_, url: string) => {
    try {
      const parsed = new URL(url);
      const allowedProtocols = ["https:", "http:"];
      if (!allowedProtocols.includes(parsed.protocol)) {
        throw new Error(`Protocol "${parsed.protocol}" is not allowed.`);
      }
    } catch (err: any) {
      if (err.message?.includes("not allowed")) throw err;
      throw new Error(`Invalid URL: ${url}`);
    }
    await shell.openExternal(url);
  });
  ipcMain.handle("getOllamaModels", async (_, endpoint: string) => qaService.getOllamaModels(endpoint));
  ipcMain.handle("syncToConfluence", async (_, pageId: string, payload: { entries: any[]; deletedTableIndices?: number[] }) =>
    qaService.syncToConfluence(await getConfig(), pageId, payload)
  );
  ipcMain.handle("previewConfluenceSync", async (_, pageId: string, payload: { entries: any[] }) =>
    qaService.previewSyncConfluence(await getConfig(), pageId, payload)
  );

  // RAG handlers
  ipcMain.handle("ragIndexConfluence", async (_, spaceKey: string) => ragService.indexConfluence(await getConfig(), spaceKey));
  ipcMain.handle("ragIndexJira", async (_, projectKey: string) => ragService.indexJira(await getConfig(), projectKey));
  ipcMain.handle("ragSearch", async (_, query: string) => {
    const config = await getConfig();
    return ragService.search(query, config.ollama.endpoint);
  });
  ipcMain.handle("ragGetStats", async () => ragService.getStats());
  ipcMain.handle("ragClearIndex", async (_, source?: "confluence" | "jira") => ragService.clearIndex(source));

  // OCR handlers
  ipcMain.handle("ocrExtractFromFile", async (_, filePath: string) => {
    const fs = require("node:fs");
    const imageBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    return ocrService.extractText(imageBuffer, fileName, "file");
  });

  // Advanced Jira Organizer handlers
  ipcMain.handle("getJiraProjects", async () => qaService.getJiraProjects(await getConfig()));
  ipcMain.handle("getJiraBoards", async (_, projectKey: string) => qaService.getJiraBoards(await getConfig(), projectKey));
  ipcMain.handle("getJiraSprints", async (_, boardId: number) => qaService.getJiraSprints(await getConfig(), boardId));
  ipcMain.handle("getJiraStatuses", async () => qaService.getJiraStatuses(await getConfig()));
  ipcMain.handle("getJiraIssueTypes", async () => qaService.getJiraIssueTypes(await getConfig()));
  ipcMain.handle("getJiraUsers", async (_, projectKey: string) => qaService.getJiraUsers(await getConfig(), projectKey));
  ipcMain.handle("getJiraLabels", async () => qaService.getJiraLabels(await getConfig()));
  ipcMain.handle("getJiraCustomFields", async () => qaService.getJiraCustomFields(await getConfig()));
  // UQA handlers
  ipcMain.handle("getUqaIssues", async (): Promise<any[]> => {
    const config = await getConfig();
    return qaService.getUqaIssues(config);
  });
  ipcMain.handle("getUqaTransitions", async (_, issueKey: string): Promise<any[]> => {
    return qaService.getUqaTransitions(await getConfig(), issueKey);
  });
  ipcMain.handle("appendUqaEntry", async (_, issueKey: string, date: string, activity: string): Promise<void> => {
    return qaService.appendUqaEntry(await getConfig(), issueKey, date, activity);
  });
  ipcMain.handle("appendUqaEntryWithNotes", async (_, issueKey: string, date: string, activity: string, notes: string): Promise<void> => {
    return qaService.appendUqaEntryWithNotes(await getConfig(), issueKey, date, activity, notes);
  });
  ipcMain.handle("transitionUqaIssue", async (_, issueKey: string, transitionId: string): Promise<void> => {
    return qaService.transitionUqaIssue(await getConfig(), issueKey, transitionId);
  });
  ipcMain.handle("autoGenerateUqaNotes", async (_, issueKey: string): Promise<import("@shared/types").AutoUqaGeneratedPayload> => {
    return qaService.autoGenerateUqaNotes(await getConfig(), issueKey);
  });
  ipcMain.handle("getUqaField", async () => qaService.getUqaField(await getConfig()));
  ipcMain.handle("getCurrentUser", async () => qaService.getCurrentUser(await getConfig()));
  ipcMain.handle("updateUqaSchedule", async (_, uqaConfig: import("@shared/types").UqaConfig) => {
    const config = await getConfig();
    config.uqa = uqaConfig;
    await store.save(config);
    uqaScheduler.restart(config.uqa);
  });
  ipcMain.handle("getUqaSchedule", async (): Promise<import("@shared/types").UqaConfig> => {
    const config = await getConfig();
    return config.uqa;
  });
  ipcMain.handle("getPerUqaReminder", async (_, issueKey: string): Promise<import("@shared/types").PerIssueReminder | null> => {
    const config = await getConfig();
    return config.uqa.perIssueReminders?.[issueKey] ?? null;
  });
  ipcMain.handle("updatePerUqaReminder", async (_, issueKey: string, reminder: import("@shared/types").PerIssueReminder) => {
    const config = await getConfig();
    if (!config.uqa.perIssueReminders) {
      config.uqa.perIssueReminders = {};
    }
    config.uqa.perIssueReminders[issueKey] = reminder;
    await store.save(config);
    uqaScheduler.restart(config.uqa);
  });
  ipcMain.handle("checkUqaReminder", async () => {
    if (uqaScheduler.isRunning()) {
      uqaScheduler.restart((await getConfig()).uqa);
    }
  });

  // UQA reminder ready listener (for notification-click navigation)
  ipcMain.on("uqa-reminder-ready", async () => {
    const config = await store.load();
    if (config.uqa?.enabled) {
      uqaScheduler.start(config.uqa, async () => qaService.getUqaIssues(config), (issueKey, summary) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send("uqa-reminder-pushed", issueKey, summary);
        }
      });
    }
  });

  ipcMain.handle("getConfluencePage", async (_, pageId: string) => qaService.getConfluencePage(await getConfig(), pageId));
  ipcMain.handle("parseConfluenceEntries", async (_, pageId: string, options?: ParseConfluenceEntriesOptions) =>
    qaService.parseConfluenceEntries(await getConfig(), pageId, options)
  );
  ipcMain.handle("findIssuesByJql", async (_, jql: string, maxResults: number) => qaService.findIssuesByJql(await getConfig(), jql, maxResults));
  ipcMain.handle("bulkTransition", async (_, issueKeys: string[], transitionId: string) => qaService.bulkTransition(await getConfig(), issueKeys, transitionId));
  ipcMain.handle("bulkAssign", async (_, issueKeys: string[], assigneeAccountId: string) => qaService.bulkAssign(await getConfig(), issueKeys, assigneeAccountId));
  ipcMain.handle("bulkAddLabels", async (_, issueKeys: string[], labels: string[]) => qaService.bulkAddLabels(await getConfig(), issueKeys, labels));
  ipcMain.handle("bulkMoveToXrayFolder", async (_, issueKeys: string[], folderPath: string) => qaService.bulkMoveToXrayFolder(await getConfig(), issueKeys, folderPath));
  ipcMain.handle("getLogs", async () => loadLogs());
  ipcMain.handle("saveLogs", async (_, logs: any[]) => saveLogs(logs));
  ipcMain.handle("recordExecution", async (_, execution: import("@shared/types").TestCaseExecution) => {
    const execs = await loadExecutions();
    execs.push(execution);
    await saveExecutions(execs);
  });
  ipcMain.handle("getExecutionHistory", async (_, testCaseId?: string) => {
    const execs = await loadExecutions();
    if (testCaseId) return execs.filter((e: any) => e.testCaseId === testCaseId);
    return execs;
  });
  ipcMain.handle("getExecutionStats", async () => {
    const execs = await loadExecutions();
    const total = execs.length;
    const passed = execs.filter((e: any) => e.result === "PASS").length;
    const failed = execs.filter((e: any) => e.result === "FAILED").length;
    return { totalExecutions: total, totalPassed: passed, totalFailed: failed, passRate: total > 0 ? Math.round((passed / total) * 100) : 0 };
  });

  ipcMain.handle("readLocalFile", async (_, filePath: string, baseDir?: string) => {
    const permittedBase = path.resolve(baseDir || app.getPath("documents"));
    const resolvedPath = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(permittedBase, filePath);

    if (!resolvedPath.startsWith(permittedBase)) {
      throw new Error(`Access denied: path "${resolvedPath}" is outside permitted directory "${permittedBase}".`);
    }

    const fileData = await fs.readFile(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    let mimeType = "application/octet-stream";
    if (ext === ".png") mimeType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
    else if (ext === ".gif") mimeType = "image/gif";
    else if (ext === ".pdf") mimeType = "application/pdf";
    else if (ext === ".doc") mimeType = "application/msword";
    else if (ext === ".docx") mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else if (ext === ".xls") mimeType = "application/vnd.ms-excel";
    else if (ext === ".xlsx") mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const base64 = fileData.toString("base64");
    return {
      name: path.basename(resolvedPath),
      data: `data:${mimeType};base64,${base64}`,
    };
  });

  ipcMain.handle("getDirectoryName", async (_, filePath: string) => {
    return path.dirname(filePath);
  });

  // Defect Repository handlers
  ipcMain.handle("getDefectSources", async () => defectRepoService.getSources());
  ipcMain.handle("saveDefectSource", async (_, source: JiraProjectSource) => {
    const config = await getConfig();
    return defectRepoService.saveSource(config, source);
  });
  ipcMain.handle("deleteDefectSource", async (_, id: string) => defectRepoService.deleteSource(id));
  ipcMain.handle("syncDefectSource", async (_, projectKey: string) => {
    const config = await getConfig();
    return defectRepoService.syncSource(config, projectKey);
  });
  ipcMain.handle("findDefectDuplicateCandidates", async (_, filters: SearchFilters) => {
    const config = await getConfig();
    return defectRepoService.findDuplicateCandidates(filters, config);
  });
  ipcMain.handle("searchDefects", async (_, filters: SearchFilters) => defectRepoService.searchDefects(filters, await getConfig()));
  ipcMain.handle("getDefect", async (_, id: string) => defectRepoService.getDefect(id));
  ipcMain.handle("getDefectDuplicateRelations", async (_, defectId: string) => defectRepoService.getDuplicateRelations(defectId));
  ipcMain.handle("markDuplicateDefect", async (_, relation: Omit<DuplicateRelation, "id" | "createdAt">) => defectRepoService.markDuplicate(relation));
  ipcMain.handle("removeDuplicateDefectLink", async (_, id: string) => defectRepoService.removeDuplicateLink(id));
  ipcMain.handle("getDefectStats", async () => defectRepoService.getStats());
  ipcMain.handle("reindexAllDefects", async () => defectRepoService.reindexAll());

  createWindow();

  defectAutoSyncScheduler.start(
    () => defectRepoService.getSources(),
    async (projectKey: string) => {
      const config = await getConfig();
      await defectRepoService.syncSource(config, projectKey);
      await defectRepoService.recordAutoSync(projectKey, new Date().toISOString());
    }
  );

  // Check for updates automatically 5 seconds after launch
  setTimeout(async () => {
    try {
      const info = await updateService.checkForUpdates(app.getVersion(), true);
      if (info.updateAvailable && mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("update-status-pushed", info);
      }
    } catch (err) {
      logger.error("Failed to run automatic update check:", err);
    }
  }, 5000);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    defectAutoSyncScheduler.stop();
    app.quit();
  }
});
