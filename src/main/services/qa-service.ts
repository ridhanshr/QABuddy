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
  ExtractedTestCase,
  ExtractionDepth,
  JiraBoard,
  JiraIssueSummary,
  JiraProject,
  JiraSprint,
  JiraStatus,
  JiraUser,
  ManualTestCase,
  ParseConfluenceEntriesOptions,
  StepConflictCheck,
  StepConflictMode,
  UpdateProgress,
  UpdateTestCasesFromConfluenceResult,
  XrayFolder,
} from "@shared/types";
import { defaultConfig } from "@shared/types";
import { ConfluenceService } from "./confluence-service";
import { JiraService } from "./jira-service";
import { OllamaService } from "./ollama-service";
import type { ProjectContext } from "./ollama-service";
import { RagService } from "./rag-service";
import { logger } from "./logger";
import { stripHtml } from "./utils";

function demoDashboard(): DashboardDigest {
  return {
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
    const dashboard = await this.getDashboard(config);

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

  async getDashboard(config: AppConfig): Promise<DashboardDigest> {
    if (!config.jira.baseUrl || !config.jira.token) {
      return demoDashboard();
    }

    const jira = new JiraService(config.jira);
    const ollama = config.ollama.endpoint ? new OllamaService(config.ollama) : null;

    try {
      const [readyForQa, bugMetrics, sprintReport] = await Promise.all([
        jira.getReadyForQaIssues(),
        jira.getBugMetrics(),
        jira.getSprintReport(),
      ]);
      const insight = ollama
        ? await ollama.buildDashboardInsight(
            JSON.stringify({ readyForQa, bugMetrics, sprintReport, projectKey: config.jira.projectKey })
          )
        : demoDashboard().insight;

      return {
        insight,
        readyForQa,
        bugMetrics,
        sprintReport: sprintReport || undefined,
      };
    } catch {
      return demoDashboard();
    }
  }

  async askAssistant(config: AppConfig, prompt: string, history: ChatHistoryMessage[] = []): Promise<ChatResponse> {
    const jiraConfigured = Boolean(config.jira.baseUrl && config.jira.token);
    const confluenceConfigured = Boolean(config.confluence.baseUrl && config.confluence.token);
    const ollama = config.ollama.endpoint ? new OllamaService(config.ollama) : null;
    const lowerPrompt = prompt.toLowerCase();
    
    // Bypass RAG if user explicitly wants to search live Jira tickets
    const explicitJiraIntent = /(cari|tampilkan|temukan|list|daftar|cek|buat|generate|bikin)\w*\s+.*(jql|tiket|ticket|issue|bug|task|story|epic|jira)/i.test(lowerPrompt) || 
                               /(jql|tiket|ticket|issue|bug|task|story|epic|jira)\s+.*(status|type|tipe|issuetype|assignee|reporter|sprint|epic|prioritas|priority|project)/i.test(lowerPrompt);

    // ─── Build project context for enriched prompts ─────────────────────
    let projectContext: ProjectContext | undefined;
    if (jiraConfigured) {
      projectContext = await this.buildProjectContext(config);
    }

    // ─── Build system prompt ────────────────────────────────────────────
    const systemPromptParts: string[] = [
      "Anda adalah QA Buddy, seorang asisten QA engineer ahli yang terintegrasi dengan Jira dan Confluence.",
      "Tugas Anda adalah membantu QA engineer menemukan bug, menulis test case, menganalisis requirement, dan menghasilkan query JQL.",
      "PENTING: Selalu berikan jawaban dan penjelasan dalam Bahasa Indonesia yang profesional, ramah, dan mudah dipahami.",
      "Jadilah asisten yang ringkas namun mendalam. Saat merujuk ke issue Jira, selalu sertakan kunci issue (issue key) seperti [PROJ-123].",
      "",
      "=== ATURAN ANTI-HALUSINASI ===",
      "- Jawab HANYA berdasarkan data yang diberikan (issue Jira, dokumen Confluence, atau Knowledge Base). JANGAN mengarang issue key, nama tiket, status, atau data yang tidak ada.",
      "- Jika data tidak mencukupi untuk menjawab pertanyaan, katakan secara jujur bahwa informasinya belum tersedia dan sarankan langkah selanjutnya.",
      "- JANGAN mengarang URL, nama orang, statistik, atau tren yang tidak ada di data yang diberikan.",
      "- Pisahkan dengan jelas antara fakta dari data dan analisis/saran Anda.",
    ];
    if (config.jira.projectKey) {
      systemPromptParts.push(`Current Jira project: ${config.jira.projectKey}`);
    }
    if (config.confluence.spaceKey) {
      systemPromptParts.push(`Current Confluence space: ${config.confluence.spaceKey}`);
    }
    if (projectContext?.statuses && projectContext.statuses.length > 0) {
      systemPromptParts.push(`Available Jira statuses: ${projectContext.statuses.join(", ")}`);
    }
    if (projectContext?.issueTypes && projectContext.issueTypes.length > 0) {
      systemPromptParts.push(`Available Jira issue types: ${projectContext.issueTypes.join(", ")}`);
    }
    const systemPrompt = systemPromptParts.join("\n");

    // ─── Confluence URL flow (skip hybrid) ──────────────────────────────
    if (confluenceConfigured && (/(confluence|dokumentasi|documentation|page|doc)/i.test(lowerPrompt) || prompt.includes(config.confluence.baseUrl))) {
      const confluence = new ConfluenceService(config.confluence);
      const urlRegex = new RegExp(`(https?:\\/\\/[^\\s]*${config.confluence.baseUrl.replace(/https?:\/\//, '')}[^\\s]*)`, 'gi');
      const foundUrl = prompt.match(urlRegex)?.[0];

      if (foundUrl) {
        const page = await confluence.getPageByUrl(foundUrl);
        let answer = "";
        if (ollama) {
          const summary = await ollama.summarizeConfluence(prompt, stripHtml(page.body?.storage?.value || ""));
          answer = summary || "Maaf, Ollama gagal memberikan ringkasan (Koneksi terputus atau memori penuh). Anda bisa melihat detail halaman di link bawah.";
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

    if (!jiraConfigured && !confluenceConfigured) {
      return { mode: "error", answer: "Jira dan Confluence belum dikonfigurasi. Lengkapi koneksi di Settings terlebih dahulu." };
    }
    if (!jiraConfigured) {
      return { mode: "error", answer: "Jira belum dikonfigurasi. Isi URL, auth mode, dan token di Settings." };
    }

    const jira = new JiraService(config.jira);

    // ─── Generate JQL first, then run RAG + Jira search in parallel ─────
    let jql: string;
    if (ollama) {
      jql = await ollama.generateJql(prompt, config.jira.projectKey, projectContext, history);
    } else {
      jql = `project = "${config.jira.projectKey}" ORDER BY updated DESC`;
    }

    const [ragResults, issues] = await Promise.all([
      (async () => {
        if (!ollama || !this.ragService) return { results: [] as any[], hasRelevant: false };
        try {
          const results = await this.ragService.search(prompt, config.ollama.endpoint, 5);
          return {
            results,
            hasRelevant: results.length > 0 && results[0].score > 0.4,
          };
        } catch { return { results: [] as any[], hasRelevant: false }; }
      })(),
      (async () => {
        try {
          return await jira.searchIssues(jql, 6);
        } catch {
          return [] as import("@shared/types").JiraIssueSummary[];
        }
      })(),
    ]);

    const hasJiraResults = issues.length > 0;
    const hasRagResults = ragResults.hasRelevant;

    // ─── Build combined answer ──────────────────────────────────────────
    let answer: string;
    let mode: "jira" | "confluence" | "hybrid" = "jira";
    let pages: import("@shared/types").ConfluencePageSummary[] | undefined;

    if (hasRagResults) {
      const sources = ragResults.results.map((r: any) => {
        let safeUrl = r.sourceUrl;
        if (safeUrl.match(/\/pages\/\d+$/)) safeUrl = safeUrl.replace(/\/pages\/(\d+)$/, "/pages/viewpage.action?pageId=$1");
        return { id: r.sourceUrl, title: r.sourceTitle, spaceName: "Knowledge Base", url: safeUrl, excerpt: r.content.slice(0, 150) + "..." };
      });
      pages = sources.filter((s: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.url === s.url) === i);
    }

    if (hasRagResults && hasJiraResults && ollama) {
      // Hybrid: both sources available
      mode = "hybrid";
      const contextText = ragResults.results.map((c: any, i: number) =>
        `--- Document ${i + 1}: ${c.sourceTitle} ---\n${c.content}`
      ).join("\n\n");
      const issuesSummary = issues.map((i: any) =>
        `${i.key} - "${i.summary}" (Status: ${i.status}, Priority: ${i.priority}, Assignee: ${i.assignee})`
      ).join("; ");

      const hybridAnswer = await ollama.chat(
        systemPrompt + "\n\nAnda akan menerima data dari DUA sumber: Knowledge Base (dokumen internal) dan Jira (issue tracker).\nSintesis kedua sumber menjadi satu jawaban yang koheren dalam Bahasa Indonesia.\n\nATURAN: Gunakan HANYA data dari kedua sumber di bawah. JANGAN mengarang issue key, nama dokumen, atau fakta yang tidak ada di data. Jika ada informasi yang kurang, katakan secara jujur.",
        `=== KNOWLEDGE BASE ===\n${contextText}\n\n=== JIRA SEARCH ===\nJQL: ${jql}\nIssues found: ${issuesSummary}\n\nPertanyaan pengguna: ${prompt}\n\nGabungkan informasi dari kedua sumber untuk memberikan jawaban yang lengkap. Jangan menambahkan data yang tidak ada di sumber.`,
        history,
        0.5
      );
      answer = hybridAnswer || `Ditemukan ${issues.length} issue dari Jira dan ${ragResults.results.length} dokumen dari Knowledge Base.`;
    } else if (hasRagResults && ollama) {
      // RAG only
      mode = "confluence";
      const answerText = await ollama.answerWithContext(prompt, ragResults.results, history);
      answer = `📚 *Dijawab dari Knowledge Base*\n\n${answerText}`;
    } else if (hasJiraResults && ollama && history.length > 0) {
      // Jira only with chat
      const issuesSummary = issues.map((i: any) =>
        `${i.key} - "${i.summary}" (Status: ${i.status}, Priority: ${i.priority}, Assignee: ${i.assignee}, Type: ${i.type})`
      ).join("; ");
      const chatAnswer = await ollama.chat(
        systemPrompt,
        `Saya telah mencari Jira menggunakan JQL: ${jql}\nHasil: ${issuesSummary}\n\nPertanyaan asli pengguna: ${prompt}\n\nBerikan ringkasan yang jelas dan ringkas mengenai hasil pencarian ini dalam Bahasa Indonesia. HANYA gunakan data issue yang tercantum di atas. JANGAN mengarang issue key, status, atau informasi yang tidak ada di daftar hasil.`,
        history,
        0.5
      );
      answer = chatAnswer || `Saya menemukan ${issues.length} issue yang relevan.`;
    } else {
      answer = hasJiraResults
        ? `Saya menemukan ${issues.length} issue yang relevan. JQL sudah saya buat dan hasilnya saya tampilkan di bawah.`
        : "Tidak ada issue yang cocok dengan query tersebut.";
    }

    return { mode, answer, jql, issues, pages };
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
      const fallback = new OllamaService(defaultConfig.ollama);
      return fallback.polishBugReport(draft);
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

  async extractTestCases(
    config: AppConfig,
    url: string,
    depth: ExtractionDepth
  ) {
    if (!config.confluence.baseUrl || !config.confluence.token) {
      throw new Error("Confluence belum dikonfigurasi. Simpan koneksi Confluence di Settings sebelum ekstraksi.");
    }
    const confluence = new ConfluenceService(config.confluence);
    const ollama = config.ollama.endpoint ? new OllamaService(config.ollama) : undefined;

    // ─── RAG Enrichment: Fetch related context from knowledge base ────
    let ragContext: string | undefined;
    if (ollama && this.ragService) {
      try {
        const ragStats = this.ragService.getStats();
        if (ragStats.totalChunks > 0) {
          const maxContextLen = 500;
          const results: { content: string; sourceTitle: string; sourceUrl: string; score: number }[] = [];

          // 1. Exact match: find chunks belonging to this page
          const pageIdMatch = url.match(/(?:pages\/|pageId=)(\d+)/);
          if (pageIdMatch) {
            const exactChunks = this.ragService.getChunksBySourceId("confluence", pageIdMatch[1]);
            results.push(...exactChunks);
          }

          // 2. Semantic search using page title hint from URL
          const urlTitle = (url.split("/").pop() || "").replace(/[+]/g, " ");
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

    return confluence.extractTestCases(url, depth, ollama, ragContext);
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

  private assertJiraConfigured(config: AppConfig) {
    if (!config.jira.baseUrl || !config.jira.token) {
      throw new Error("Jira belum dikonfigurasi. Isi URL, token, dan project key di Settings.");
    }
  }
}
