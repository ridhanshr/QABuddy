import type {
  AppBootstrap,
  AppConfig,
  AutoUqaGeneratedPayload,
  BugFormDraft,
  BugPreview,
  BulkOperationResult,
  ChatHistoryMessage,
  ChatResponse,
  ConfluenceTestImportEntry,
  ConnectionStatus,
  DashboardDigest,
  DashboardProjectData,
  ExtractedTestCase,
  ExtractionDepth,
  DefectCreateDraft,
  IntentClassification,
  JiraBoard,
  JiraIssueSummary,
  BugMetrics,
  JiraProject,
  JiraSprint,
  JiraStatus,
  JiraUser,
  ManualTestCase,
  OcrResult,
  ParseConfluenceEntriesOptions,
  ProjectInsightRequest,
  StepConflictCheck,
  StepConflictMode,
  UpdateProgress,
  UpdateTestCasesFromConfluenceResult,
  XrayFolder,
  FetchTestStepsResult,
} from "@shared/types";
import { ConfluenceService } from "./confluence-service";
import { JiraService } from "./jira-service";
import { OllamaService } from "./ollama-service";
import type { ProjectContext } from "./ollama-service";
import { IntentRouter } from "./intent-router";
import { OcrService } from "./ocr-service";
import { RagService } from "./rag-service";
import { logger } from "./logger";
import { stripHtml, fallbackBugPreview } from "./utils";

function demoDashboard(): DashboardDigest {
  return {
    isDemo: true,
    insight: "Hari ini ada peningkatan bug di modul Payment. Hubungkan Jira dan Ollama untuk insight real-time.",
    readyForQa: [
      {
        id: "1",
        key: "PAY-1042",
        summary: "Webhook timeout during Stripe 3D Secure verification",
        status: "Ready for QA",
        priority: "Highest",
        assignee: "Alice Smith",
        type: "Bug",
        url: "#",
      },
      {
        id: "2",
        key: "PAY-1045",
        summary: "Currency conversion rounding error in invoice PDF",
        status: "Ready for QA",
        priority: "High",
        assignee: "John Doe",
        type: "Bug",
        url: "#",
      },
      {
        id: "3",
        key: "AUTH-892",
        summary: "Session expires prematurely on mobile devices",
        status: "Ready for QA",
        priority: "Medium",
        assignee: "Emma Ray",
        type: "Bug",
        url: "#",
      },
    ],
    bugMetrics: {
      totalOpen: 12,
      critical: 1,
      high: 3,
      medium: 5,
      low: 3,
      resolvedThisSprint: 9,
      foundThisSprint: 14,
      epicTotal: 5,
      epicCompleted: 2,
      epicTasksTotal: 14,
      epicTasksResolved: 9,
    },
    sprintReport: {
      sprintName: "Sprint 24",
      sprintState: "active",
      totalIssues: 28,
      completedIssues: 15,
      toDoIssues: 7,
      inProgressIssues: 6,
      doneIssues: 15,
      completionPercent: 54,
    },
    projects: {},
  };
}

interface ProjectContextCache {
  data: ProjectContext;
  timestamp: number;
}

export class QaService {
  constructor(private ragService?: RagService) {}

  private contextCache: ProjectContextCache | null = null;
  private readonly CONTEXT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async bootstrap(config: AppConfig): Promise<AppBootstrap> {
    const status = await this.testConnections(config);
    const dashboard = await this.getDashboard(config, true);

    return { config, status, dashboard };
  }

  async testConnections(config: AppConfig): Promise<ConnectionStatus> {
    const jira = config.jira.baseUrl && config.jira.token ? new JiraService(config.jira) : null;
    const confluence =
      config.confluence.baseUrl && config.confluence.token
        ? new ConfluenceService(config.confluence)
        : null;
    const ollama = config.ollama.endpoint ? new OllamaService(config.ollama) : null;

    const [jiraResult, confluenceResult, ollamaResult] = await Promise.all([
      jira
        ? jira.validateConnection().then(
            (message) => ({ ok: true, message }),
            (error: any) => ({ ok: false, message: error.code ? `${error.message} (${error.code})` : error.message })
          )
        : Promise.resolve({ ok: false, message: "Jira belum dikonfigurasi" }),
      confluence
        ? confluence.validateConnection().then(
            (message) => ({ ok: true, message }),
            (error: any) => ({ ok: false, message: error.code ? `${error.message} (${error.code})` : error.message })
          )
        : Promise.resolve({ ok: false, message: "Confluence belum dikonfigurasi" }),
      ollama
        ? ollama.validateConnection().then(
            (message) => ({ ok: true, message }),
            (error: any) => ({ ok: false, message: error.code ? `${error.message} (${error.code})` : error.message })
          )
        : Promise.resolve({ ok: false, message: "Ollama belum dikonfigurasi" }),
    ]);

    return {
      jira: jiraResult,
      confluence: confluenceResult,
      ollama: ollamaResult,
    };
  }

  async healthcheck(config: AppConfig): Promise<{
    jira: { ok: boolean; message: string; projectKey?: string; issueCount?: number };
    confluence: { ok: boolean; message: string; spaceKey?: string };
    ollama: { ok: boolean; message: string; model?: string; responseTimeMs?: number };
    rag: { ok: boolean; totalChunks: number; confluencePages: number; jiraIssues: number };
    config: { ok: boolean; issues: string[] };
  }> {
    const issues: string[] = [];
    if (!config.jira.baseUrl) issues.push("Jira base URL kosong");
    if (!config.jira.token) issues.push("Jira token kosong");
    if (!config.jira.projectKey) issues.push("Jira project key kosong");
    if (!config.confluence.baseUrl) issues.push("Confluence base URL kosong");
    if (!config.confluence.token) issues.push("Confluence token kosong");
    if (!config.ollama.endpoint) issues.push("Ollama endpoint kosong");

    const [jiraCheck, confluenceCheck, ollamaCheck] = await Promise.all([
      (async () => {
        if (!config.jira.baseUrl || !config.jira.token) return { ok: false, message: "Konfigurasi tidak lengkap" };
        try {
          const jira = new JiraService(config.jira);
          const msg = await jira.validateConnection();
          const count = await jira.searchIssues(`project = "${config.jira.projectKey}"`, 1).then(r => r.length).catch(() => 0);
          return { ok: true, message: msg, projectKey: config.jira.projectKey, issueCount: count };
        } catch (e: any) {
          return { ok: false, message: e.message };
        }
      })(),
      (async () => {
        if (!config.confluence.baseUrl || !config.confluence.token) return { ok: false, message: "Konfigurasi tidak lengkap" };
        try {
          const confluence = new ConfluenceService(config.confluence);
          const msg = await confluence.validateConnection();
          return { ok: true, message: msg, spaceKey: config.confluence.spaceKey };
        } catch (e: any) {
          return { ok: false, message: e.message };
        }
      })(),
      (async () => {
        if (!config.ollama.endpoint) return { ok: false, message: "Endpoint tidak dikonfigurasi" };
        try {
          const ollama = new OllamaService(config.ollama);
          const start = Date.now();
          const models = await ollama.getAvailableModels();
          const elapsed = Date.now() - start;
          const hasModel = models.includes(config.ollama.model);
          return {
            ok: models.length > 0,
            message: `${models.length} model(s) tersedia${hasModel ? `, model "${config.ollama.model}" tersedia` : `, model "${config.ollama.model}" TIDAK ditemukan`}`,
            model: config.ollama.model,
            responseTimeMs: elapsed,
          };
        } catch (e: any) {
          return { ok: false, message: e.message };
        }
      })(),
    ]);

    let ragStatus = { ok: false, totalChunks: 0, confluencePages: 0, jiraIssues: 0 };
    try {
      if (this.ragService) {
        const stats = this.ragService.getStats();
        ragStatus = {
          ok: stats.totalChunks > 0,
          totalChunks: stats.totalChunks,
          confluencePages: stats.confluencePages,
          jiraIssues: stats.jiraIssues,
        };
      }
    } catch { /* RAG not configured */ }

    return {
      jira: jiraCheck,
      confluence: confluenceCheck,
      ollama: ollamaCheck,
      rag: ragStatus,
      config: { ok: issues.length === 0, issues },
    };
  }

  async getOllamaModels(endpoint: string): Promise<string[]> {
    if (!endpoint) {
      return [];
    }
    const ollama = new OllamaService({ endpoint, model: "" });
    return ollama.getAvailableModels();
  }

  async getDashboard(config: AppConfig, skipInsight = false): Promise<DashboardDigest> {
    if (!config.jira.baseUrl || !config.jira.token) {
      const demo = demoDashboard();
      return {
        ...demo,
        insight: "Jira belum dikonfigurasi. Dashboard ini menampilkan data demo. Hubungkan Jira untuk insight real-time dari project Anda.",
      };
    }

    const jira = new JiraService(config.jira);
    const ollama = !skipInsight && config.ollama.endpoint ? new OllamaService(config.ollama) : null;
    const firstProject = config.dashboard?.projects?.find(p => p.enabled);
    const mainProjectKey = firstProject?.projectKey || "";
    const mainIssueType = firstProject?.issueType || "";

    try {
      const [readyForQa, bugMetrics, sprintReport, recentIssues] = await Promise.all([
        jira.getReadyForQaIssues(mainProjectKey || undefined, mainIssueType || undefined, firstProject?.excludeLabels, firstProject?.includeLabels, firstProject?.excludeStatuses, firstProject?.includeStatuses).catch(() => [] as JiraIssueSummary[]),
        jira.getBugMetrics(mainProjectKey || undefined, mainIssueType || undefined, firstProject?.excludeLabels, firstProject?.includeLabels, firstProject?.excludeStatuses, firstProject?.includeStatuses).catch(() => ({ totalOpen: 0, critical: 0, high: 0, medium: 0, low: 0, resolvedThisSprint: 0, foundThisSprint: 0, epicTotal: 0, epicCompleted: 0, epicTasksTotal: 0, epicTasksResolved: 0 } as BugMetrics)),
        jira.getSprintReport().catch(() => null),
        mainProjectKey
          ? jira.searchIssues(`project = "${mainProjectKey}"${mainIssueType ? ` AND issuetype = "${mainIssueType}"` : ""} ORDER BY updated DESC`, 5).catch(() => [])
          : Promise.resolve([]),
      ]);

      // ─── Per-project data from dashboard config ─────────────────────
      const projects: Record<string, DashboardProjectData> = {};
      if (config.dashboard?.projects?.length > 0) {
        for (const pc of config.dashboard.projects.filter(p => p.enabled)) {
          try {
            const [pReadyForQa, pBugMetrics] = await Promise.all([
              jira.getReadyForQaIssues(pc.projectKey, pc.issueType, pc.excludeLabels, pc.includeLabels, pc.excludeStatuses, pc.includeStatuses),
              jira.getBugMetrics(pc.projectKey, pc.issueType, pc.excludeLabels, pc.includeLabels, pc.excludeStatuses, pc.includeStatuses),
            ]);
            projects[pc.projectKey] = { readyForQa: pReadyForQa, bugMetrics: pBugMetrics };
          } catch (e) {
            logger.warn("QA", `Failed to fetch project ${pc.projectKey}:`, e);
          }
        }
      }

      let insight: string;
      if (ollama) {
        insight = await ollama.buildDashboardInsight(
          JSON.stringify({
            readyForQa,
            bugMetrics,
            sprintReport,
            recentIssues: recentIssues.map((i: any) => ({ key: i.key, summary: i.summary, status: i.status, priority: i.priority })),
            projectKey: mainProjectKey,
            projects: Object.keys(projects),
          })
        );
      } else {
        const totalOpen = bugMetrics.totalOpen;
        const readyCount = readyForQa.length;
        const projectCount = Object.keys(projects).length;
        insight = sprintReport
          ? `Dashboard ${mainProjectKey} — Sprint ${sprintReport.sprintName}: ${sprintReport.completionPercent}% selesai (${sprintReport.completedIssues}/${sprintReport.totalIssues} issue). ${totalOpen} bug terbuka, ${readyCount} siap QA${projectCount > 0 ? `, ${projectCount} project tambahan dimonitor.` : "."} Hubungkan Ollama untuk insight yang lebih analitis.`
          : `Dashboard ${mainProjectKey} — ${totalOpen} bug terbuka (${bugMetrics.critical} kritis, ${bugMetrics.high} high). ${readyCount} issue siap QA${projectCount > 0 ? `, ${projectCount} project tambahan dimonitor.` : "."} Hubungkan Ollama untuk insight AI.`;
      }

      return {
        insight,
        readyForQa,
        bugMetrics,
        projects,
        sprintReport: sprintReport || undefined,
      };
    } catch (error) {
      logger.error("QA", "Dashboard fetch failed:", error);
      const demo = demoDashboard();
      return {
        ...demo,
        insight: "Gagal memuat data Jira. Periksa koneksi Jira di Settings. Menampilkan data demo sementara.",
      };
    }
  }

  async getProjectInsight(config: AppConfig, request: ProjectInsightRequest): Promise<string> {
    const ollama = config.ollama.endpoint ? new OllamaService(config.ollama) : null;
    if (ollama) {
      const aiInsight = await ollama.getProjectInsight(request.projectKey, request.bugMetrics, request.readyForQa);
      if (aiInsight) return aiInsight;
    }
    const totalOpen = request.bugMetrics.totalOpen;
    const readyCount = request.readyForQa.length;
    return `Dashboard ${request.projectKey} — ${totalOpen} bug terbuka (${request.bugMetrics.critical} kritis, ${request.bugMetrics.high} high). ${readyCount} issue siap QA.`;
  }

  async askAssistant(config: AppConfig, prompt: string, history: ChatHistoryMessage[] = []): Promise<ChatResponse> {
    const jiraConfigured = Boolean(config.jira.baseUrl && config.jira.token);
    const confluenceConfigured = Boolean(config.confluence.baseUrl && config.confluence.token);
    const ollama = config.ollama.endpoint ? new OllamaService(config.ollama) : null;
    const lowerPrompt = prompt.toLowerCase();

    // ─── Intent Router: deterministic classification first ──────────────
    const router = new IntentRouter();
    const intent: IntentClassification = router.classify(prompt);
    logger.info("QA", `Intent classified: route=${intent.route}, confidence=${intent.confidence.toFixed(2)}, reason=${intent.reason}`);

    // ─── Build project context for enriched prompts ─────────────────────
    let projectContext: ProjectContext | undefined;
    if (jiraConfigured) {
      projectContext = await this.buildProjectContext(config);
    }

    // ─── Confluence URL flow (direct page access) ───────────────────────
    if (confluenceConfigured && (prompt.includes(config.confluence.baseUrl) || /^(ringkas|summary|baca|lihat)\s+.*url/i.test(lowerPrompt))) {
      const confluence = new ConfluenceService(config.confluence);
      const urlRegex = new RegExp(`(https?:\\/\\/[^\\s]*${config.confluence.baseUrl.replace(/https?:\/\//, '')}[^\\s]*)`, 'gi');
      const foundUrl = prompt.match(urlRegex)?.[0];

      if (foundUrl) {
        const page = await confluence.getPageByUrl(foundUrl);
        let answer = "";
        if (ollama) {
          const summary = await ollama.summarizeConfluence(prompt, stripHtml(page.body?.storage?.value || ""));
          answer = summary || "Maaf, Ollama gagal memberikan ringkasan. Anda bisa melihat detail halaman di link bawah.";
        } else {
          answer = `Berikut adalah isi dari halaman **${page.title}**. Hubungkan Ollama untuk mendapatkan ringkasan otomatis.`;
        }
        return {
          mode: "confluence",
          answer,
          pages: [{
            id: page.id,
            title: page.title,
            spaceName: page.space?.name || "Unknown",
            url: foundUrl,
            excerpt: stripHtml(page.body?.storage?.value || "").slice(0, 200) + "..."
          }]
        };
      }
      const result = await confluence.summarize(prompt, ollama ?? undefined);
      return { mode: "confluence", answer: result.answer, pages: result.pages };
    }

    if (intent.route === "clarify" && !jiraConfigured && !confluenceConfigured) {
      return { mode: "error", answer: "Jira dan Confluence belum dikonfigurasi. Lengkapi koneksi di Settings terlebih dahulu." };
    }

    if (intent.route === "clarify" && ollama && jiraConfigured) {
      const jira = new JiraService(config.jira);
      const issues = await jira.searchIssues(`project = "${config.jira.projectKey}" ORDER BY updated DESC`, 3).catch(() => []);
      const jiraSummary = issues.map((i: any) => `${i.key} - "${i.summary}" (${i.status})`).join("; ") || "Tidak ada issue terbaru.";
      let clarificationAnswer: string | null = null;
      try {
        clarificationAnswer = await ollama.chat(
          "Anda adalah QA Buddy. User bertanya sesuatu yang tidak jelas arahnya. Berikut data Jira terkini sebagai konteks. Tawarkan bantuan: apakah user ingin mencari tiket Jira, mencari dokumen, atau mengekstrak test case? Jawab dalam Bahasa Indonesia yang ramah.",
          `Data Jira terkini: ${jiraSummary}\n\nPertanyaan user: ${prompt}`,
          history,
          0.5
        );
      } catch (e) {
        logger.warn("QA", "Ollama clarification failed:", e);
      }
      return { mode: "error", answer: clarificationAnswer || `Saya tidak yakin dengan yang Anda maksud. Apakah Anda ingin:\n1. Mencari tiket Jira?\n2. Mencari dokumen di Knowledge Base?\n3. Mengekstrak test case?\n\nSilakan sebutkan dengan lebih jelas.` };
    }

    if (!jiraConfigured && intent.route === "jira") {
      return { mode: "error", answer: "Jira belum dikonfigurasi. Isi URL, auth mode, dan token di Settings untuk mencari tiket." };
    }

    if (intent.route === "confluence" && !confluenceConfigured) {
      return { mode: "error", answer: "Confluence belum dikonfigurasi. Lengkapi koneksi di Settings." };
    }

    // ─── Jira Route ─────────────────────────────────────────────────────
    if (intent.route === "jira" && jiraConfigured) {
      const jira = new JiraService(config.jira);

      let jql: string;
      if (ollama) {
        jql = await ollama.generateJql(prompt, config.jira.projectKey, projectContext, history);
      } else {
        jql = `project = "${config.jira.projectKey}" ORDER BY updated DESC`;
      }

      const issues = await jira.searchIssues(jql, 6).catch(() => [] as JiraIssueSummary[]);

      if (issues.length === 0) {
        return {
          mode: "jira",
          answer: "Tidak ada issue yang cocok dengan kriteria tersebut di Jira.",
          jql,
          issues: [],
        };
      }

      if (ollama) {
        const issuesSummary = issues.map((i: any) =>
          `${i.key} - "${i.summary}" (Status: ${i.status}, Priority: ${i.priority}, Assignee: ${i.assignee}, Type: ${i.type})`
        ).join("; ");
        let chatAnswer: string | null = null;
        try {
          chatAnswer = await ollama.chatJiraFirst(
            `JQL: ${jql}\nHasil pencarian:\n${issuesSummary}`,
            prompt,
            config.jira.projectKey,
            history
          );
        } catch (e) {
          logger.warn("QA", "Ollama chatJiraFirst failed:", e);
        }
        return {
          mode: "jira",
          answer: `Sumber: Jira\n\n${chatAnswer || `Ditemukan ${issues.length} issue.`}`,
          jql,
          issues,
        };
      }

      return {
        mode: "jira",
        answer: `Sumber: Jira\n\nDitemukan ${issues.length} issue yang relevan.`,
        jql,
        issues,
      };
    }

    // ─── Confluence / Knowledge Base Route ──────────────────────────────
    if (intent.route === "confluence") {
      if (!ollama) {
        return {
          mode: "error",
          answer: "Ollama (AI) belum dikonfigurasi. Silakan aktifkan dan pilih model Ollama di Settings untuk mencari dokumen di Knowledge Base."
        };
      }

      if (this.ragService) {
        try {
          const ragResults = await this.ragService.search(prompt, config.ollama.endpoint, 5);
          if (ragResults.length > 0 && ragResults[0].score > 0.4) {
            const answerText = await ollama.chatKnowledgeBase(
              ragResults.map((r: any, i: number) =>
                `--- Document ${i + 1}: ${r.sourceTitle} ---\n${r.content}`
              ).join("\n\n"),
              prompt,
              history
            );
            const pages = ragResults.map((r: any) => {
              let safeUrl = r.sourceUrl;
              if (safeUrl.match(/\/pages\/\d+$/)) safeUrl = safeUrl.replace(/\/pages\/(\d+)$/, "/pages/viewpage.action?pageId=$1");
              return { id: r.sourceUrl, title: r.sourceTitle, spaceName: "Knowledge Base", url: safeUrl, excerpt: r.content.slice(0, 150) + "..." };
            }).filter((s: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.url === s.url) === i);

            return {
              mode: "confluence",
              answer: `Sumber: Confluence / RAG\n\n${answerText}`,
              pages,
            };
          }
        } catch { /* RAG search failed */ }
      }

      return {
        mode: "confluence",
        answer: "Tidak ditemukan dokumen yang relevan di Knowledge Base. Coba indeks halaman Confluence terlebih dahulu melalui menu Knowledge Base.",
      };
    }

    // ─── Mixed Route ────────────────────────────────────────────────────
    if (intent.route === "mixed" && jiraConfigured) {
      const jira = new JiraService(config.jira);

      let jql: string;
      if (ollama) {
        jql = await ollama.generateJql(prompt, config.jira.projectKey, projectContext, history);
      } else {
        jql = `project = "${config.jira.projectKey}" ORDER BY updated DESC`;
      }

      const [issues, ragResults] = await Promise.all([
        jira.searchIssues(jql, 6).catch(() => [] as JiraIssueSummary[]),
        (async () => {
          if (!ollama || !this.ragService) return [] as any[];
          try {
            return await this.ragService.search(prompt, config.ollama.endpoint, 5);
          } catch { return []; }
        })(),
      ]);

      const hasJira = issues.length > 0;
      const hasRag = ragResults.length > 0 && ragResults[0].score > 0.4;

      if (!hasJira && !hasRag) {
        return {
          mode: "hybrid",
          answer: "Tidak ditemukan data dari Jira maupun Knowledge Base untuk pertanyaan tersebut.",
          jql,
        };
      }

      if (ollama && hasJira && hasRag) {
        const jiraSummary = issues.map((i: any) =>
          `${i.key} - "${i.summary}" (Status: ${i.status}, Priority: ${i.priority}, Assignee: ${i.assignee})`
        ).join("; ");
        const contextText = ragResults.map((r: any, i: number) =>
          `--- Document ${i + 1}: ${r.sourceTitle} ---\n${r.content}`
        ).join("\n\n");

        let hybridAnswer: string | null = null;
        try {
          hybridAnswer = await ollama.chatHybrid(jiraSummary, contextText, prompt, history);
        } catch (e) {
          logger.warn("QA", "Ollama chatHybrid failed:", e);
        }
        const pages = ragResults.map((r: any) => ({
          id: r.sourceUrl,
          title: r.sourceTitle,
          spaceName: "Knowledge Base",
          url: r.sourceUrl,
          excerpt: r.content.slice(0, 150) + "..."
        }));

        return {
          mode: "hybrid",
          answer: hybridAnswer || `Ditemukan ${issues.length} issue dari Jira dan ${ragResults.length} dokumen dari Knowledge Base.`,
          jql,
          issues,
          pages,
        };
      }

      if (hasJira) {
        return {
          mode: "jira",
          answer: `Sumber: Jira\n\nDitemukan ${issues.length} issue yang relevan.`,
          jql,
          issues,
        };
      }

      return {
        mode: "confluence",
        answer: "Sumber: Confluence / RAG\n\nDitemukan dokumen yang relevan di Knowledge Base.",
        pages: ragResults.map((r: any) => ({ id: r.sourceUrl, title: r.sourceTitle, spaceName: "Knowledge Base", url: r.sourceUrl, excerpt: r.content.slice(0, 150) + "..." })),
      };
    }

    // ─── Fallback ───────────────────────────────────────────────────────
    return {
      mode: "error",
      answer: "Maaf, saya tidak dapat memproses pertanyaan Anda. Silakan coba lagi dengan pertanyaan yang lebih spesifik.",
    };
  }

  /**
   * Build project context by fetching Jira metadata.
   * This enriches AI prompts with real project data.
   * Results are cached for 5 minutes.
   */
  private async buildProjectContext(config: AppConfig): Promise<ProjectContext> {
    const now = Date.now();

    // Return cached context if still valid
    if (this.contextCache && (now - this.contextCache.timestamp) < this.CONTEXT_CACHE_TTL) {
      return this.contextCache.data;
    }

    const context: ProjectContext = { projectKey: config.jira.projectKey };
    if (config.confluence.spaceKey) {
      context.spaceKey = config.confluence.spaceKey;
    }

    try {
      const jira = new JiraService(config.jira);

      const [statuses, issueTypes, users, priorities, components, labels, boards, customFields] = await Promise.all([
        jira.getStatuses().catch(() => [] as JiraStatus[]),
        jira.getIssueTypes().catch(() => [] as string[]),
        jira.getUsers(config.jira.projectKey).catch(() => [] as JiraUser[]),
        jira.getPriorities().catch(() => [] as { id: string; name: string }[]),
        jira.getComponents(config.jira.projectKey).catch(() => [] as { id: string; name: string }[]),
        jira.getLabels().catch(() => [] as string[]),
        jira.getBoards(config.jira.projectKey).catch(() => [] as JiraBoard[]),
        jira.getCustomFields().catch(() => [] as { id: string; name: string; type: string; isCustom: boolean }[]),
      ]);

      context.statuses = statuses.map((s: any) => s.name || s);
      context.issueTypes = Array.isArray(issueTypes) ? issueTypes.map((t: any) => typeof t === 'string' ? t : t.name) : [];
      context.users = (users as JiraUser[]).slice(0, 20).map(u => ({ displayName: u.displayName, accountId: u.accountId }));
      context.priorities = priorities;
      context.components = components;
      context.labels = labels;
      context.customFields = customFields;

      // Get active sprint from first board
      if (boards.length > 0) {
        const sprints = await jira.getSprints(boards[0].id).catch(() => [] as JiraSprint[]);
        const activeSprint = sprints.find((s: JiraSprint) => s.state === "active");
        if (activeSprint) {
          context.activeSprint = { name: activeSprint.name, id: activeSprint.id, state: activeSprint.state };
        }
      }
    } catch {
      // If we can't fetch metadata, proceed without it
    }

    // Cache the result
    this.contextCache = { data: context, timestamp: now };

    return context;
  }

  async polishBugReport(config: AppConfig, draft: BugFormDraft): Promise<BugPreview> {
    if (!config.ollama.endpoint) {
      return fallbackBugPreview(draft);
    }
    const ollama = new OllamaService(config.ollama);
    return ollama.polishBugReport(draft);
  }

  async createBug(
    config: AppConfig,
    draft: BugFormDraft,
    preview: BugPreview
  ): Promise<{ key: string; url: string }> {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi. Simpan koneksi Jira di Settings sebelum submit bug.");
    }
    const jira = new JiraService(config.jira);
    return jira.createBug(draft, preview);
  }

  async createDefectIssue(
    config: AppConfig,
    draft: DefectCreateDraft
  ): Promise<{ key: string; url: string }> {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi. Simpan koneksi Jira di Settings sebelum membuat defect.");
    }
    const jira = new JiraService(config.jira);
    const description = [
      draft.description?.trim() || "",
      draft.stepsToReproduce?.trim() ? `h4. Steps to Reproduce\n${draft.stepsToReproduce.trim()}` : "",
      draft.expectedResult?.trim() ? `h4. Expected Result\n${draft.expectedResult.trim()}` : "",
      draft.actualResult?.trim() ? `h4. Actual Result\n${draft.actualResult.trim()}` : "",
      draft.environment?.trim() ? `h4. Environment\n${draft.environment.trim()}` : "",
      draft.component?.trim() ? `h4. Component\n${draft.component.trim()}` : "",
      draft.version?.trim() ? `h4. Version\n${draft.version.trim()}` : "",
      draft.severity?.trim() ? `h4. Severity\n${draft.severity.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const labels = draft.labels
      ? draft.labels
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean)
      : [];

    return jira.createIssue(draft.projectKey, draft.issueType, {
      summary: draft.summary.trim(),
      description,
      priority: draft.priority || "Medium",
      labels,
      environment: draft.environment || undefined,
      component: draft.component || undefined,
      version: draft.version || undefined,
      severity: draft.severity || undefined,
    });
  }

  async extractTestCases(
    config: AppConfig,
    url: string,
    depth: ExtractionDepth,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    if (!config.confluence.baseUrl || !config.confluence.token) {
      throw new Error("Confluence belum dikonfigurasi. Simpan koneksi Confluence di Settings sebelum ekstraksi.");
    }
    const confluence = new ConfluenceService(config.confluence);
    const ollama = config.ollama.endpoint ? new OllamaService(config.ollama) : undefined;
    const ocr = new OcrService();

    // Fetch Confluence page first to resolve friendly URLs and get correct Page ID
    const page = await confluence.getPageByUrl(url);
    const pageId = page?.id;

    // ─── RAG Enrichment: Fetch related context from knowledge base ────
    let ragContext: string | undefined;
    if (ollama && this.ragService) {
      try {
        const ragStats = this.ragService.getStats();
        if (ragStats.totalChunks > 0) {
          const maxContextLen = 500;
          const results: { content: string; sourceTitle: string; sourceUrl: string; score: number }[] = [];

          // 1. Exact match: find chunks belonging to this page
          if (pageId) {
            const exactChunks = this.ragService.getChunksBySourceId("confluence", pageId);
            results.push(...exactChunks);
          }

          // 2. Semantic search using page title hint from URL or page title
          const pageTitle = page?.title || "";
          const urlTitle = pageTitle || (url.split("/").pop() || "").replace(/[+]/g, " ");
          const query = `test cases requirements acceptance criteria ${urlTitle}`;
          const semanticResults = await this.ragService.search(query, config.ollama.endpoint, 5);

          // Deduplicate: add semantic results not already in exact matches
          for (const sr of semanticResults) {
            if (!results.some((r) => r.sourceUrl === sr.sourceUrl)) {
              results.push(sr);
            }
          }

          if (results.length > 0) {
            ragContext = results
              .map((r, i) => `[${i + 1}] ${r.sourceTitle}${r.score === 1 ? " (halaman ini)" : ""}\n${r.content.slice(0, maxContextLen)}`)
              .join("\n\n");
          }
        }
      } catch (ragError) {
        logger.error("RAG", "Enrichment for test extraction failed:", ragError);
      }
    }

    // ─── OCR: Extract text from image attachments on the page ─────────
    let ocrText: string | undefined;
    try {
      if (pageId) {
        const attachments = await confluence.getAttachments(pageId);
        const imageAttachments = attachments.filter((att: any) => {
          const ct = (att.contentType || att.mimeType || "").toLowerCase();
          const ext = (att.title || "").toLowerCase();
          return ct.startsWith("image/") || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(ext);
        });

        if (imageAttachments.length > 0) {
          logger.info("OCR", `Found ${imageAttachments.length} image attachments to OCR`);
          if (imageAttachments.length > 5) {
            logger.info("OCR", "OCR limit: processing only the first 5 images");
          }
          const ocrResults: OcrResult[] = [];

          for (const att of imageAttachments.slice(0, 5)) {
            try {
              const downloadUrl = att._links?.download || att.downloadUrl;
              if (downloadUrl) {
                const imageBuffer = await confluence.downloadAttachment(downloadUrl);
                const result = await ocr.extractText(imageBuffer, att.title, pageId);
                if (result) ocrResults.push(result);
              }
            } catch (attError) {
              logger.warn("OCR", `Failed to process attachment ${att.title}:`, attError);
            }
          }

          if (ocrResults.length > 0) {
            ocrText = ocrResults
              .map((r) => `[OCR dari ${r.sourceAttachment}] ${r.text}`)
              .join("\n\n");
            logger.info("OCR", `Total OCR text length: ${ocrText.length} chars`);
          }
        }
      }
    } catch (ocrError) {
      logger.warn("OCR", "OCR pipeline failed, continuing without OCR:", ocrError);
    }

    // ─── Choose extraction strategy based on available sources ────────
    return confluence.extractTestCases(url, depth, ollama, ragContext, ocrText, page);
  }

  async createTestCases(config: AppConfig, cases: ExtractedTestCase[]) {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi. Simpan koneksi Jira di Settings sebelum export test case.");
    }
    const jira = new JiraService(config.jira);
    return {
      created: await jira.createTestCases(
        cases
          .filter((item) => item.selected)
          .map((item) => ({
            title: item.title,
            objective: item.objective,
            priority: item.priority,
            category: item.category,
          }))
      ),
    };
  }

  async createManualTestCases(config: AppConfig, cases: ManualTestCase[]) {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi. Simpan koneksi Jira di Settings sebelum export test case.");
    }
    const jira = new JiraService(config.jira);
    return {
      created: await jira.createManualTestCases(cases)
    };
  }

  async organizeTestsIntoXray(config: AppConfig, source: string, folderPath: string, projectKey: string) {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi.");
    }
    const jira = new JiraService(config.jira);
    const count = await jira.organizeTestsIntoXray(source, folderPath, projectKey);
    return { count };
  }

  async getXrayFolders(config: AppConfig, projectKey: string): Promise<XrayFolder[]> {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi.");
    }
    const jira = new JiraService(config.jira);
    return jira.getXrayFolders(projectKey);
  }

  async fetchTestSteps(
    config: AppConfig,
    issueKey: string
  ): Promise<FetchTestStepsResult | null> {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi.");
    }
    const jira = new JiraService(config.jira);
    return jira.fetchTestSteps(issueKey);
  }

  async checkTestSteps(
    config: AppConfig,
    entries: ConfluenceTestImportEntry[]
  ): Promise<StepConflictCheck> {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi.");
    }
    const jira = new JiraService(config.jira);
    return jira.checkTestSteps(entries);
  }

  async updateTestCasesFromConfluence(
    config: AppConfig,
    entries: ConfluenceTestImportEntry[],
    mode?: StepConflictMode,
    onProgress?: (p: UpdateProgress) => void
  ): Promise<UpdateTestCasesFromConfluenceResult> {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi.");
    }
    const jira = new JiraService(config.jira);
    return jira.updateTestCasesFromConfluence(entries, mode, onProgress);
  }

  async findTestCasesByJql(
    config: AppConfig,
    jql: string,
    maxResults: number
  ): Promise<JiraIssueSummary[]> {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi.");
    }
    const jira = new JiraService(config.jira);
    return jira.findTestCasesByJql(jql, maxResults);
  }

  async previewSyncConfluence(
    config: AppConfig,
    pageId: string,
    payload: { entries: any[] }
  ): Promise<{ currentTitle: string; currentVersion: number; generatedTables: string; entryCount: number; existingEntryCount: number }> {
    if (!config.confluence.baseUrl || !config.confluence.token) {
      throw new Error("Confluence belum dikonfigurasi.");
    }
    if (!pageId) {
      throw new Error("Target Page ID belum diisi.");
    }
    const confluence = new ConfluenceService(config.confluence);
    return confluence.previewSyncXhtml(
      pageId,
      payload.entries,
      config.jira.baseUrl,
      config.confluence.jiraServerId
    );
  }

  async syncToConfluence(
    config: AppConfig,
    pageId: string,
    payload: { entries: any[]; deletedTableIndices?: number[] }
  ): Promise<{ pageTitle: string; pageUrl: string; entryCount: number; imageCount: number; attachmentCount: number }> {
    if (!config.confluence.baseUrl || !config.confluence.token) {
      throw new Error("Confluence belum dikonfigurasi.");
    }
    if (!pageId) {
      throw new Error("Target Page ID belum diisi. Atur di Documentation Sync > Sync Settings.");
    }
    const confluence = new ConfluenceService(config.confluence);
    return confluence.syncToConfluence(
      pageId,
      payload.entries,
      config.jira.baseUrl,
      config.confluence.jiraServerId,
      payload.deletedTableIndices
    );
  }

  async getJiraProjects(config: AppConfig) {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getProjects();
  }

  async getJiraBoards(config: AppConfig, projectKey: string) {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getBoards(projectKey);
  }

  async getJiraSprints(config: AppConfig, boardId: number) {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getSprints(boardId);
  }

  async getJiraStatuses(config: AppConfig) {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getStatuses();
  }

  async getXrayFolderIssues(
    config: AppConfig,
    projectKey: string,
    folderId: number
  ): Promise<{ key: string; summary: string }[]> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getIssuesInXrayFolder(projectKey, folderId);
  }

  async getJiraIssueTypes(config: AppConfig) {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getIssueTypes();
  }

  async getJiraUsers(config: AppConfig, projectKey: string) {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getUsers(projectKey);
  }

  async getJiraLabels(config: AppConfig) {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getLabels();
  }

  async getJiraCustomFields(config: AppConfig) {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getCustomFields();
  }

  async getConfluencePage(config: AppConfig, pageId: string) {
    if (!config.confluence.baseUrl || !config.confluence.token) {
      throw new Error("Confluence belum dikonfigurasi.");
    }
    const confluence = new ConfluenceService(config.confluence);
    return confluence.getPagePreview(pageId);
  }

  async parseConfluenceEntries(config: AppConfig, pageId: string, options?: ParseConfluenceEntriesOptions) {
    if (!config.confluence.baseUrl || !config.confluence.token) {
      throw new Error("Confluence belum dikonfigurasi.");
    }
    const confluence = new ConfluenceService(config.confluence);
    const result = await confluence.parseEntriesFromPage(pageId, options);

    if (result.entries.length > 0 && config.jira.baseUrl && config.jira.token) {
      const jiraService = new JiraService(config.jira);
      const keyToResolved = new Map<string, string | null>();

      for (const entry of result.entries) {
        const key = entry.scenarioIssueKey || entry.scenario?.match(/([A-Z]{2,}-\d{1,9})/)?.[1];
        if (key && !keyToResolved.has(key)) {
          const resolved = await jiraService.resolveIssueKey(key);
          keyToResolved.set(key, resolved);
        }
      }

      for (const entry of result.entries) {
        const entryKey = entry.scenarioIssueKey || entry.scenario?.match(/([A-Z]{2,}-\d{1,9})/)?.[1];
        if (!entryKey) continue;
        const resolved = keyToResolved.get(entryKey);
        if (resolved && resolved !== entryKey) {
          entry.scenarioIssueKey = resolved;
          entry.scenario = entry.scenario?.replace(entryKey, resolved) || resolved;
        }
      }
    }

    return result;
  }

  async findIssuesByJql(config: AppConfig, jql: string, maxResults: number) {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.findIssuesByJql(jql, maxResults);
  }

  async bulkTransition(config: AppConfig, issueKeys: string[], transitionId: string): Promise<BulkOperationResult> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.bulkTransition(issueKeys, transitionId);
  }

  async bulkAssign(config: AppConfig, issueKeys: string[], assigneeAccountId: string): Promise<BulkOperationResult> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.bulkAssign(issueKeys, assigneeAccountId);
  }

  async bulkAddLabels(config: AppConfig, issueKeys: string[], labels: string[]): Promise<BulkOperationResult> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.bulkAddLabels(issueKeys, labels);
  }

  async bulkMoveToXrayFolder(config: AppConfig, issueKeys: string[], folderPath: string): Promise<BulkOperationResult> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.bulkMoveToXrayFolder(issueKeys, folderPath);
  }

  async getCurrentUser(config: AppConfig): Promise<{ accountId: string; displayName: string; emailAddress: string }> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getCurrentUser();
  }

  async getUqaField(config: AppConfig): Promise<{ id: string; name: string; type: string; isCustom: boolean } | null> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.getCustomFieldByName("Product Tester");
  }

  async getUqaIssues(config: AppConfig, onProgress?: (current: number, total: number, message: string) => void): Promise<import("@shared/types").UqaIssue[]> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    let fieldId = config.uqa.productTesterFieldId;
    if (!fieldId) {
      const field = await jira.getCustomFieldByName("Product Tester");
      if (!field) throw new Error("Custom field 'Product Tester' tidak ditemukan di Jira. Cek Settings.");
      fieldId = field.id;
    }
    return jira.getUqaIssues(fieldId, config.uqa.searchMode, config.uqa.projectKeys, onProgress);
  }

  async getUqaTransitions(config: AppConfig, issueKey: string): Promise<import("@shared/types").UqaTransition[]> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    // Also fetch latest available transitions for a single issue
    return jira.getUqaTransitions(issueKey);
  }

  async appendUqaEntry(config: AppConfig, issueKey: string, date: string, activity: string): Promise<void> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.appendUqaEntry(issueKey, date, activity);
  }

  async appendUqaEntryWithNotes(config: AppConfig, issueKey: string, date: string, activity: string, notes: string): Promise<void> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.appendUqaEntryWithNotes(issueKey, date, activity, notes);
  }

  async transitionUqaIssue(config: AppConfig, issueKey: string, transitionId: string): Promise<void> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.transitionUqaIssue(issueKey, transitionId);
  }

  async autoGenerateUqaNotes(config: AppConfig, issueKey: string): Promise<AutoUqaGeneratedPayload> {
    this.assertJiraConfigured(config);
    const jira = new JiraService(config.jira);
    return jira.autoGenerateUqaNotes(issueKey);
  }

  private assertJiraConfigured(config: AppConfig) {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi. Isi URL, token, dan project key di Settings.");
    }
  }
}
