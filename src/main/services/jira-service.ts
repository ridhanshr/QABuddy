import type {
  AutoUqaGeneratedPayload,
  BugFormDraft,
  BugMetrics,
  BugPreview,
  BulkOperationResult,
  ConfluenceTestImportEntry,
  JiraBoard,
  JiraConfig,
  JiraIssueSummary,
  JiraProject,
  JiraSprint,
  JiraStatus,
  JiraUser,
  ManualTestCase,
  PhaseTestSummary,
  StepConflictCheck,
  StepConflictMode,
  UpdateProgress,
  UpdateTestCasesFromConfluenceResult,
  XrayFolder,
  FetchTestStepsResult,
} from "@shared/types";
import { JiraClient } from "./jira/jira-client";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function mapQaPriorityToJiraPriority(priority: string): string {
  switch (priority.trim().toUpperCase()) {
    case "P1":
      return "High";
    case "P2":
      return "Medium";
    case "P3":
      return "Low";
    default:
      return priority || "Medium";
  }
}

function mapIssueToSummary(
  issue: any,
  baseUrl: string
): JiraIssueSummary {
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name || "-",
    priority: issue.fields.priority?.name || "-",
    assignee: issue.fields.assignee?.displayName || "Unassigned",
    type: issue.fields.issuetype?.name || "-",
    url: `${baseUrl.replace(/\/+$/, "")}/browse/${issue.key}`,
  };
}

// ---------------------------------------------------------------------------
// JiraService
// ---------------------------------------------------------------------------

export class JiraService {
  private readonly config: JiraConfig;
  private readonly client: JiraClient;

  constructor(config: JiraConfig) {
    this.config = config;
    this.client = new JiraClient(config);
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async validateConnection(): Promise<string> {
    const response = await this.client.api.get("/myself");
    const name =
      response.data?.displayName || response.data?.name || "connected";
    return `Connected as ${name}`;
  }

  // -------------------------------------------------------------------------
  // JQL helper methods
  // -------------------------------------------------------------------------

  private buildLabelFilters(exclude: string[], include: string[]): string {
    const parts: string[] = [];
    if (exclude.length > 0)
      parts.push(`AND labels NOT IN (${exclude.map((l) => `"${l}"`).join(", ")})`);
    if (include.length > 0)
      parts.push(`AND labels IN (${include.map((l) => `"${l}"`).join(", ")})`);
    return parts.join(" ");
  }

  private buildStatusFilters(exclude: string[], include: string[]): string {
    const parts: string[] = [];
    if (exclude.length > 0)
      parts.push(`AND status NOT IN (${exclude.map((s) => `"${s}"`).join(", ")})`);
    if (include.length > 0)
      parts.push(`AND status IN (${include.map((s) => `"${s}"`).join(", ")})`);
    return parts.join(" ");
  }

  // -------------------------------------------------------------------------
  // Issue search / query
  // -------------------------------------------------------------------------

  async searchIssues(
    jql: string,
    maxResults = 8
  ): Promise<JiraIssueSummary[]> {
    logger.debug("Jira", `searchIssues: ${jql}`);
    const response = await this.client.api.get("/search", {
      params: {
        jql,
        maxResults,
        fields: "summary,status,priority,assignee,issuetype",
      },
    });
    return response.data.issues.map((issue: any) =>
      mapIssueToSummary(issue, this.config.baseUrl)
    );
  }

  async findIssuesByJql(
    jql: string,
    maxResults = 200
  ): Promise<JiraIssueSummary[]> {
    return this.searchIssues(jql, maxResults);
  }

  async getReadyForQaIssues(
    projectKey?: string,
    issueType?: string,
    excludeLabels?: string[],
    includeLabels?: string[],
    excludeStatuses?: string[],
    includeStatuses?: string[]
  ): Promise<JiraIssueSummary[]> {
    const pk = projectKey || this.config.projectKey;
    const it = issueType || this.config.bugIssueType;
    if (!pk || !it) {
      logger.warn("Jira", "getReadyForQaIssues: projectKey or issueType is empty, returning []");
      return [];
    }
    const labelFilter = this.buildLabelFilters(excludeLabels || [], includeLabels || []);
    const statusFilter = this.buildStatusFilters(excludeStatuses || [], includeStatuses || []);
    const baseJql =
      this.config.readyForQaJql.trim() ||
      `project = "${pk}" AND issuetype = "${it}" ORDER BY priority DESC, updated DESC`;

    const orderMatch = baseJql.match(/^(.*?)\s*(ORDER\s+BY\s+.*)$/i);
    const filterPart = orderMatch ? orderMatch[1] : baseJql;
    const orderPart = orderMatch ? ` ${orderMatch[2]}` : "";
    const jql = `${filterPart} ${labelFilter} ${statusFilter}${orderPart}`;

    return this.searchIssues(jql, 1000);
  }

  // -------------------------------------------------------------------------
  // Metrics & reports
  // -------------------------------------------------------------------------

  async getBugMetrics(
    projectKey?: string,
    issueType?: string,
    excludeLabels?: string[],
    includeLabels?: string[],
    excludeStatuses?: string[],
    includeStatuses?: string[]
  ): Promise<BugMetrics> {
    const project = projectKey || this.config.projectKey;
    const it = issueType || this.config.bugIssueType;
    if (!project || !it) {
      logger.warn("Jira", "getBugMetrics: projectKey or issueType is empty, returning zeroed metrics");
      return { totalOpen: 0, critical: 0, high: 0, medium: 0, low: 0, resolvedThisSprint: 0, foundThisSprint: 0, epicTotal: 0, epicCompleted: 0, epicTasksTotal: 0, epicTasksResolved: 0 };
    }
    const typeFilter = `AND issuetype = "${it}"`;
    const labelFilter = this.buildLabelFilters(excludeLabels || [], includeLabels || []);
    const statusFilter = this.buildStatusFilters(excludeStatuses || [], includeStatuses || []);
    const search = (jql: string) => this.client.countByJql(jql);

    const [
      totalOpen,
      critical,
      high,
      medium,
      low,
    ] = await Promise.all([
      search(`project = "${project}" ${typeFilter} ${statusFilter} ${labelFilter}`).catch(() => 0),
      search(`project = "${project}" ${typeFilter} ${statusFilter} AND priority = Critical ${labelFilter}`).catch(() => 0),
      search(`project = "${project}" ${typeFilter} ${statusFilter} AND priority = High ${labelFilter}`).catch(() => 0),
      search(`project = "${project}" ${typeFilter} ${statusFilter} AND priority = Medium ${labelFilter}`).catch(() => 0),
      search(`project = "${project}" ${typeFilter} ${statusFilter} AND priority = Low ${labelFilter}`).catch(() => 0),
    ]);
    const resolvedThisSprint = 0;
    const foundThisSprint = 0;

    let [epicTotal, epicCompleted, epicTasksTotal, epicTasksResolved] = [
      0, 0, 0, 0,
    ];

    try {
      const [totalEpics, completedEpics] = await Promise.all([
        search(`project = "${project}" AND issuetype = Epic`),
        search(`project = "${project}" AND issuetype = Epic AND resolution != Unresolved`),
      ]);
      epicTotal = totalEpics;
      epicCompleted = completedEpics;
    } catch {
      /* Epic queries not supported */
    }

    try {
      const epicKeys = await this.searchIssues(
        `project = "${project}" AND issuetype = Epic AND resolution = Unresolved`,
        200
      );
      if (epicKeys.length > 0) {
        const keys = epicKeys.map((i) => i.key).join(", ");
        [epicTasksTotal, epicTasksResolved] = await Promise.all([
          search(`project = "${project}" AND issuetype = Task AND "Epic Link" in (${keys}) ${labelFilter}`),
          search(`project = "${project}" AND issuetype = Task AND resolution != Unresolved AND "Epic Link" in (${keys}) ${labelFilter}`),
        ]);
      }
    } catch {
      /* Epic Link field not supported — show 0 */
    }

    return {
      totalOpen,
      critical,
      high,
      medium,
      low,
      resolvedThisSprint,
      foundThisSprint,
      epicTotal,
      epicCompleted,
      epicTasksTotal,
      epicTasksResolved,
    };
  }

  async getSprintReport(): Promise<import("@shared/types").SprintReport | null> {
    try {
      const boards = await this.getBoards(this.config.projectKey);
      if (boards.length === 0) return null;

      const sprints = await this.getSprints(boards[0].id);
      const activeSprint = sprints.find((s) => s.state === "active");
      if (!activeSprint) return null;

      const response = await this.client.agile.get(
        `/sprint/${activeSprint.id}/issue`,
        { params: { maxResults: 200, fields: "status" } }
      );

      const issues = response.data.issues || [];
      let completedIssues = 0,
        toDoIssues = 0,
        inProgressIssues = 0,
        doneIssues = 0;

      for (const issue of issues) {
        const statusName =
          issue.fields?.status?.name?.toLowerCase() || "";
        if (
          statusName === "done" ||
          statusName === "closed" ||
          statusName === "resolved"
        ) {
          doneIssues++;
          completedIssues++;
        } else if (
          statusName === "in progress" ||
          statusName === "in analyze" ||
          statusName === "in review" ||
          statusName === "in development"
        ) {
          inProgressIssues++;
        } else {
          toDoIssues++;
        }
      }

      return {
        sprintName: activeSprint.name,
        sprintState: activeSprint.state,
        totalIssues: issues.length,
        completedIssues,
        toDoIssues,
        inProgressIssues,
        doneIssues,
        completionPercent:
          issues.length > 0
            ? Math.round((completedIssues / issues.length) * 100)
            : 0,
      };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Project metadata
  // -------------------------------------------------------------------------

  async getProjects(): Promise<JiraProject[]> {
    const response = await this.client.api.get("/project");
    return (response.data as any[]).map((p) => ({
      key: p.key,
      name: p.name,
      id: p.id,
    }));
  }

  async getBoards(projectKey: string): Promise<JiraBoard[]> {
    const response = await this.client.agile.get("/board", {
      params: { projectKeyOrId: projectKey, maxResults: 50 },
    });
    return (response.data.values as any[]).map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
    }));
  }

  async getSprints(boardId: number): Promise<JiraSprint[]> {
    const response = await this.client.agile.get(
      `/board/${boardId}/sprint`,
      { params: { state: "active,future,closed", maxResults: 200 } }
    );
    return (response.data.values as any[]).map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
    }));
  }

  async getStatuses(): Promise<JiraStatus[]> {
    const response = await this.client.api.get("/status");
    return (response.data as any[]).map((s) => ({
      id: s.id,
      name: s.name,
    }));
  }

  async getIssueTypes(): Promise<string[]> {
    try {
      const response = await this.client.api.get("/issuetype");
      return (response.data as any[]).map((t) => t.name);
    } catch (err) {
      logger.warn("Jira", "Failed to fetch issue types:", err);
      return [];
    }
  }

  async getUsers(projectKey: string): Promise<JiraUser[]> {
    const response = await this.client.api.get("/user/assignable/search", {
      params: { project: projectKey, maxResults: 100 },
    });
    return (response.data as any[]).map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      emailAddress: u.emailAddress || "",
    }));
  }

  async getLabels(): Promise<string[]> {
    try {
      const response = await this.client.api.get("/label", {
        params: { maxResults: 500 },
      });
      return (response.data.values as any[]).map((l) => l.label);
    } catch (err) {
      logger.warn("Jira", "Failed to fetch labels:", err);
      return [];
    }
  }

  async getPriorities(): Promise<{ id: string; name: string }[]> {
    try {
      const response = await this.client.api.get("/priority");
      return (response.data as any[]).map((p) => ({
        id: p.id,
        name: p.name,
      }));
    } catch (err) {
      logger.warn("Jira", "Failed to fetch priorities:", err);
      return [];
    }
  }

  async getComponents(
    projectKey: string
  ): Promise<{ id: string; name: string }[]> {
    try {
      const response = await this.client.api.get(
        `/project/${projectKey}/components`
      );
      return (response.data as any[]).map((c) => ({
        id: c.id,
        name: c.name,
      }));
    } catch (err) {
      logger.warn("Jira", `Failed to fetch components for ${projectKey}:`, err);
      return [];
    }
  }

  async getCustomFields(): Promise<
    { id: string; name: string; type: string; isCustom: boolean }[]
  > {
    try {
      const response = await this.client.api.get("/field");
      return (response.data as any[]).map((f) => ({
        id: f.id,
        name: f.name,
        type: f.schema?.type || "unknown",
        isCustom: f.custom || false,
      }));
    } catch (err) {
      logger.warn("Jira", "Failed to fetch custom fields:", err);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Issue creation
  // -------------------------------------------------------------------------

  async createBug(
    draft: BugFormDraft,
    preview: BugPreview
  ): Promise<{ key: string; url: string }> {
    this.assertConfigured();
    return this.createIssue(this.config.projectKey, this.config.bugIssueType || "Bug", {
      summary: preview.summary,
      description: preview.description,
      priority: preview.priority || "Medium",
      labels: preview.labels,
      environment: draft.environment || undefined,
    });
  }

  async createIssue(
    projectKey: string,
    issueType: string,
    fields: {
      summary: string;
      description: string;
      priority?: string;
      labels?: string[];
      environment?: string;
      component?: string;
      version?: string;
      severity?: string;
    }
  ): Promise<{ key: string; url: string }> {
    this.assertConfigured();
    const response = await this.client.api.post("/issue", {
      fields: {
        project: { key: projectKey },
        summary: fields.summary,
        issuetype: { name: issueType },
        description: fields.description,
        priority: { name: fields.priority || "Medium" },
        labels: fields.labels || [],
        environment: fields.environment || undefined,
      },
    });
    const issueKey = response.data.key as string;
    return { key: issueKey, url: this.client.issueUrl(issueKey) };
  }

  async createTestCases(
    cases: {
      title: string;
      objective: string;
      priority: string;
      category: string;
    }[]
  ): Promise<{ key: string; url: string }[]> {
    this.assertConfigured();
    const created: { key: string; url: string }[] = [];

    for (const item of cases) {
      try {
        const response = await this.client.api.post("/issue", {
          fields: {
            project: { key: this.config.projectKey },
            summary: item.title,
            issuetype: { name: this.config.testCaseIssueType || "Task" },
            description: `Objective:\n${item.objective}\n\nCategory: ${item.category}`,
            priority: { name: mapQaPriorityToJiraPriority(item.priority) },
            labels: [
              "qa-buddy",
              "test-case",
              item.category.toLowerCase().replace(/\s+/g, "-"),
            ],
          },
        });
        const issueKey = response.data.key as string;
        created.push({ key: issueKey, url: this.client.issueUrl(issueKey) });
      } catch (err) {
        // Rollback: delete previously created issues
        for (const c of created) {
          try {
            await this.client.api.delete(`/issue/${c.key}`);
          } catch { /* best-effort rollback */ }
        }
        throw err;
      }
    }

    return created;
  }

  async createManualTestCases(
    cases: ManualTestCase[]
  ): Promise<{ key: string; url: string }[]> {
    this.assertConfigured();
    const created: { key: string; url: string }[] = [];

    // Use per-item projectKey if provided, otherwise fall back to config
    let allFolders: any[] | null = null;

    for (const item of cases) {
      const projectKey = item.projectKey || this.config.projectKey;
      const fullDescription = [
        item.description,
        "",
        "h4. Steps to Reproduce",
        item.steps,
        "",
        "h4. Expected Result",
        item.expectedResult,
      ].join("\n");

      const customLabels = item.labels
        ? item.labels
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean)
        : [];

      const response = await this.client.api.post("/issue", {
        fields: {
          project: { key: projectKey },
          summary: item.title,
          issuetype: { name: "Test" },
          description: fullDescription,
          labels: customLabels,
        },
      });

      const issueKey = response.data.key as string;
      created.push({ key: issueKey, url: this.client.issueUrl(issueKey) });

      // Add test steps to Xray (single step with all content, like update from confluence)
      if (item.steps?.trim()) {
        try {
          const formatBullets = (text: string) =>
            text
              .split("\n")
              .map((line) => `- ${line.trim()}`)
              .join("\n");

          const step = {
            step: formatBullets(item.steps),
            data: "",
            result: item.expectedResult ? formatBullets(item.expectedResult) : "",
          };

          await this.client.xray.put(`/test/${issueKey}/step`, step);
        } catch (err) {
          logger.error("Jira", `Failed to add test steps for ${issueKey}:`, err);
        }
      }

      // Move to Xray folder if specified
      if (item.xrayFolder?.trim()) {
        try {
          if (!allFolders) {
            allFolders = await this.client.getXrayFolders(projectKey);
          }
          const pathParts = this.client.splitFolderPath(item.xrayFolder);
          const folderId = this.client.findFolderId(allFolders, pathParts);
          if (folderId) {
            await this.client.addTestsToFolder(projectKey, folderId, [issueKey]);
          }
        } catch (err) {
          logger.error(
            "Jira",
            `Failed to move test ${issueKey} to folder:`,
            err
          );
        }
      }
    }

    return created;
  }

  // -------------------------------------------------------------------------
  // UQA (Daily Activity)
  // -------------------------------------------------------------------------

  async getCurrentUser(): Promise<{ accountId: string; displayName: string; emailAddress: string }> {
    return this.client.getCurrentUser();
  }

  async getCustomFieldByName(
    name: string
  ): Promise<{ id: string; name: string; type: string; isCustom: boolean } | null> {
    return this.client.getCustomFieldByName(name);
  }

  async getUqaIssues(
    fieldId: string,
    searchMode: "productTester" | "assignee" | "both" = "both",
    projectKeys: string[] = [],
    onProgress?: (current: number, total: number, message: string) => void
  ): Promise<import("@shared/types").UqaIssue[]> {
    this.assertConfigured();
    const num = fieldId.replace(/^customfield_/i, "");

    let userCondition: string;
    switch (searchMode) {
      case "productTester":
        userCondition = `cf[${num}] = currentUser()`;
        break;
      case "assignee":
        userCondition = `assignee = currentUser()`;
        break;
      case "both":
      default:
        userCondition = `(cf[${num}] = currentUser() OR assignee = currentUser())`;
        break;
    }

    let jql = `${userCondition} AND status NOT IN (SELESAI, DONE)`;

    if (projectKeys.length > 0) {
      const projects = projectKeys.map((k) => `"${k}"`).join(", ");
      jql += ` AND project IN (${projects})`;
    }

    jql += " ORDER BY updated DESC";

    const issues = await this.client.searchIssuesFull(jql, 100, [
      "summary",
      "status",
      "description",
      "updated",
      "updateAuthor",
      "project",
      "assignee",
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const results: import("@shared/types").UqaIssue[] = [];

    onProgress?.(0, issues.length, "Mengambil daftar issue...");
    
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      onProgress?.(i, issues.length, `Memproses ${issue.key} (${i + 1}/${issues.length})...`);
      
      const detail = await this.client.getIssueDetail(issue.key);
      if (!detail) continue;

      const entries = this.parseUqaTable(detail.description);
      const needsUpdate = !entries.some((e) => e.date === today);

      results.push({
        projectKey: issue.fields.project?.key || "",
        projectName: issue.fields.project?.name || "",
        issueKey: issue.key,
        summary: issue.fields.summary || "",
        entries,
        lastUpdated: entries.length > 0 ? entries[entries.length - 1].date : null,
        needsUpdate,
        status: detail.status,
        statusCategory: detail.statusCategory,
        availableTransitions: [],
        lastUpdateAuthor: detail.updateAuthor,
        lastUpdateDate: detail.updated,
      });
    }

    onProgress?.(issues.length, issues.length, "Menyimpan ke store...");
    
    return results;
  }

  async getUqaTransitions(issueKey: string): Promise<import("@shared/types").UqaTransition[]> {
    return this.client.getTransitions(issueKey);
  }

  async appendUqaEntry(issueKey: string, date: string, activity: string): Promise<void> {
    const row = `|${date}|${activity}|`;
    await this.client.appendToDescription(issueKey, row);
  }

  async appendUqaEntryWithNotes(issueKey: string, date: string, activity: string, notes: string): Promise<void> {
    await this.client.appendToDescriptionWithNotes(issueKey, date, activity, notes);
  }

  async transitionUqaIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.client.executeTransition(issueKey, transitionId);
  }

  /**
   * Auto-generate UQA notes by fetching linked Test Executions from the
   * UQA ticket and aggregating their Xray test-run statuses.
   */
  async autoGenerateUqaNotes(issueKey: string): Promise<AutoUqaGeneratedPayload> {
    this.assertConfigured();

    const date = new Date().toISOString().slice(0, 10);
    const links = await this.client.getIssueLinks(issueKey);

    const phases: PhaseTestSummary[] = [];

    if (links.length === 0) {
      return { date, activity: [], phases, generatedNotes: "", noLinksFound: true };
    }

    for (const link of links) {
      const phase = detectPhaseFromName(link.summary);
      const testRuns = await this.client.getXrayTestExecutionTests(link.issueKey);
      if (testRuns.length === 0) continue;

      const todo = testRuns.filter((t) => t.status === "TODO").length;
      const inProgress = testRuns.filter((t) => t.status === "EXECUTING").length;
      const done = testRuns.filter((t) => t.status === "PASS").length;
      const failed = testRuns.filter((t) => t.status === "FAIL").length;
      const aborted = testRuns.filter((t) => t.status === "ABORTED").length;

      const failedDetails = testRuns
        .filter((t) => t.status === "FAIL" || t.status === "ABORTED")
        .map((t) => ({
          testKey: t.key,
          defects: (t.defects || []).map((d) => `${d.key}: ${d.summary}`),
        }));

      phases.push({
        phase,
        testExecKey: link.issueKey,
        testExecName: link.summary,
        todo,
        inProgress,
        done,
        failed,
        aborted,
        failedDetails,
      });
    }

    const activity = phases
      .filter((p) => p.phase !== "UNKNOWN")
      .map((p) => p.phase)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort(phaseSortOrder);

    const generatedNotes = formatUqaNotes(phases);

    return { date, activity, phases, generatedNotes };
  }

  /**
   * Parse a Jira issue description and extract UQA table rows.
   * Supports Confluence HTML tables and wiki markup (backward compat).
   * Supports both YYYY-MM-DD and YYYYMMDD date formats.
   */
  private parseUqaTable(description: any): import("@shared/types").UqaEntry[] {
    if (!description) return [];

    let text: string;
    let source = "unknown";
    if (typeof description === "string") {
      source = "string";
      text = description;
    } else if (description?.type === "doc") {
      source = "adf";
      text = this.client.adfToPlainText(description);
    } else {
      return [];
    }


    // Try HTML table first (backup for HTML-stored descriptions)
    const tableMatch = text.match(/<table\s+class="confluenceTable">(.*?)<\/table>/s);
    if (tableMatch) {
      return this.parseHtmlUqaTable(tableMatch[1]);
    }

    return this.parseWikiUqaTable(text);
  }

  /** Parse a Confluence HTML table body (<tbody> content) into UQA entries. */
  private parseHtmlUqaTable(tableHtml: string): import("@shared/types").UqaEntry[] {
    const entries: import("@shared/types").UqaEntry[] = [];
    const rowRegex = /<tr>(.*?)<\/tr>/gs;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const row = rowMatch[1].trim();
      if (!row) continue;
      // Skip header rows
      if (/<th[\s>]/i.test(row)) continue;

      const cells: string[] = [];
      const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(row)) !== null) {
        cells.push(cellMatch[1].trim());
      }
      if (cells.length < 2) continue;

      // Date is first cell — strip HTML tags to get plain text
      const dateText = cells[0].replace(/<[^>]+>/g, "").trim();
      const dateMatch = dateText.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
      if (!dateMatch) continue;
      const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      // Activity is second cell — keep HTML content for rendering
      const activity = cells[1];
      const notes = cells.length > 2 ? cells[2] : undefined;

      entries.push({ date, activity, notes });
    }
    return entries;
  }

  /** Normalize 8-digit date string to YYYY-MM-DD. Supports YYYYMMDD and DDMMYYYY. */
  private normalizeUqaDate(s: string): string | null {
    const d = s.replace(/-/g, "");
    if (d.length !== 8) return null;
    // Try YYYYMMDD first
    let y = d.slice(0, 4), m = d.slice(4, 6), day = d.slice(6, 8);
    const mn = Number(m), dn = Number(day);
    if (mn >= 1 && mn <= 12 && dn >= 1 && dn <= 31) return `${y}-${m}-${day}`;
    // Try DDMMYYYY
    day = d.slice(0, 2); m = d.slice(2, 4); y = d.slice(4, 8);
    const dn2 = Number(day), mn2 = Number(m);
    if (mn2 >= 1 && mn2 <= 12 && dn2 >= 1 && dn2 <= 31) return `${y}-${m}-${day}`;
    return null;
  }

  /** Parse wiki-markup table rows into UQA entries. Supports dual date format, 3-column rows, and multi-line notes. */
  private parseWikiUqaTable(text: string): import("@shared/types").UqaEntry[] {
    const entries: import("@shared/types").UqaEntry[] = [];

    // Strip CR from CRLF line endings so regex $ matches correctly
    text = text.replace(/\r/g, "");

    // Join multi-line rows: lines that don't start with '|' are continuations
    const lines = text.split("\n");
    const joinedRows: string[] = [];
    let current = "";
    for (const line of lines) {
      if (line.trim().startsWith("|") && current) {
        joinedRows.push(current);
        current = line;
      } else if (line.trim().startsWith("|")) {
        current = line;
      } else if (current) {
        current += "\n" + line;
      }
    }
    if (current) joinedRows.push(current);

    for (const row of joinedRows) {
      // Strip trailing whitespace/NBSP so regex $ can match the final pipe
      const cleaned = row.replace(/[\s\xa0]+$/, "");
      // Try 3-column row: |date|activity|notes|
      const match3 = cleaned.match(/^\|(\d{4}-?\d{2}-?\d{2})\|(.+?)\|(.*)\|$/s);
      if (match3) {
        const dateStr = this.normalizeUqaDate(match3[1]);
        if (dateStr) entries.push({ date: dateStr, activity: match3[2].trim(), notes: match3[3].trim() || undefined });
        continue;
      }
      // Fallback 2-column row: |date|activity|
      const match2 = cleaned.match(/^\|(\d{4}-?\d{2}-?\d{2})\|(.+)\|$/s);
      if (match2) {
        const dateStr = this.normalizeUqaDate(match2[1]);
        if (dateStr) entries.push({ date: dateStr, activity: match2[2].trim() });
      }
    }
    return entries;
  }

  // -------------------------------------------------------------------------
  // Xray organisation
  // -------------------------------------------------------------------------

  async getXrayFolders(projectKey: string): Promise<XrayFolder[]> {
    return this.client.getXrayFolders(projectKey);
  }

  async organizeTestsIntoXray(
    source: string,
    folderPath: string,
    projectKey: string
  ): Promise<number> {
    this.assertConfigured();

    let issueKeys: string[];

    if (
      source.trim().toUpperCase().startsWith("PROJECT") ||
      source.trim().includes("=")
    ) {
      // JQL query
      const response = await this.client.api.get("/search", {
        params: { jql: source, fields: "key", maxResults: 1000 },
      });
      issueKeys = response.data.issues.map((i: any) => i.key);
    } else {
      // Comma / whitespace / newline separated keys
      issueKeys = source
        .split(/[,\s\n]+/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
    }

    if (issueKeys.length === 0) return 0;

    await this.client.moveTestsToXrayFolder(projectKey, folderPath, issueKeys);
    return issueKeys.length;
  }

  // -------------------------------------------------------------------------
  // Bulk operations
  // -------------------------------------------------------------------------

  async bulkTransition(
    issueKeys: string[],
    transitionId: string
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };
    const results = await Promise.allSettled(
      issueKeys.map((key) =>
        this.client.api.post(`/issue/${key}/transitions`, {
          transition: { id: transitionId },
        })
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(
          r.reason?.response?.data?.errorMessages?.[0] ||
            r.reason?.message ||
            "Unknown error"
        );
      }
    }
    return result;
  }

  async bulkAssign(
    issueKeys: string[],
    assigneeName: string
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };
    const results = await Promise.allSettled(
      issueKeys.map((key) =>
        this.client.api.put(`/issue/${key}/assignee`, { name: assigneeName })
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(
          r.reason?.response?.data?.errorMessages?.[0] ||
            r.reason?.message ||
            "Unknown error"
        );
      }
    }
    return result;
  }

  async bulkAddLabels(
    issueKeys: string[],
    labels: string[]
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };
    const results = await Promise.allSettled(
      issueKeys.map((key) =>
        this.client.api
          .get(`/issue/${key}`, { params: { fields: "labels" } })
          .then((res) => {
            const existing: string[] = res.data.fields?.labels || [];
            const merged = [...new Set([...existing, ...labels])];
            return this.client.api.put(`/issue/${key}`, {
              fields: { labels: merged },
            });
          })
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(
          r.reason?.response?.data?.errorMessages?.[0] ||
            r.reason?.message ||
            "Unknown error"
        );
      }
    }
    return result;
  }

  async bulkMoveToXrayFolder(
    issueKeys: string[],
    folderPath: string
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };
    await this.client.moveTestsToXrayFolder(
      this.config.projectKey,
      folderPath,
      issueKeys
    );
    result.success = issueKeys.length;
    return result;
  }

  // -------------------------------------------------------------------------
  // Confluence → Jira Test update
  // -------------------------------------------------------------------------

  async fetchTestSteps(
    issueKey: string
  ): Promise<FetchTestStepsResult | null> {
    const raw = await this.client.fetchTestSteps(issueKey);
    if (!raw) return null;
    return {
      issueKey,
      steps: raw.steps.join("\n"),
      expectedResult: raw.results.join("\n"),
    };
  }

  async checkTestSteps(
    entries: ConfluenceTestImportEntry[]
  ): Promise<StepConflictCheck> {
    const result: StepConflictCheck = { hasSteps: [], noSteps: [] };
    const valid = entries.filter(e => e.selected && e.issueKey);

    const checks = await Promise.allSettled(
      valid.map(async (entry) => {
        try {
          const res = await this.client.xray.get(`/test/${entry.issueKey}/step`);
          const steps = res.data;
          const hasExisting = Array.isArray(steps) ? steps.length > 0 : !!steps;
          return { issueKey: entry.issueKey, hasSteps: hasExisting };
        } catch {
          return { issueKey: entry.issueKey, hasSteps: false };
        }
      })
    );

    for (const r of checks) {
      if (r.status === "fulfilled") {
        if (r.value.hasSteps) {
          result.hasSteps.push(r.value.issueKey);
        } else {
          result.noSteps.push(r.value.issueKey);
        }
      }
    }

    return result;
  }

  async updateTestCasesFromConfluence(
    entries: ConfluenceTestImportEntry[],
    mode: StepConflictMode = "replace",
    onProgress?: (p: UpdateProgress) => void
  ): Promise<UpdateTestCasesFromConfluenceResult> {
    this.assertConfigured();
    const result: UpdateTestCasesFromConfluenceResult = { success: [], failed: [] };
    const valid = entries.filter(e => e.selected && e.issueKey);
    const total = valid.length;

    const formatBullets = (text: string) =>
      text
        .split("\n")
        .map(line => `- ${line.trim()}`)
        .join("\n");

    for (let i = 0; i < total; i++) {
      const entry = valid[i];
      const newStepText = entry.steps ? formatBullets(entry.steps) : "";
      const newResultText = entry.expectedResult ? formatBullets(entry.expectedResult) : "";

      onProgress?.({ current: i + 1, total, currentKey: entry.issueKey!, status: "processing" });

      try {
        if (mode === "skip") {
          const res = await this.client.xray.get(`/test/${entry.issueKey}/step`);
          const existing = res.data;
          const hasExisting = Array.isArray(existing) ? existing.length > 0 : !!existing;
          if (hasExisting) {
            result.success.push({ key: entry.issueKey!, message: "Skipped (already has steps)" });
            onProgress?.({ current: i + 1, total, currentKey: entry.issueKey!, status: "success" });
            continue;
          }
        }

        if (mode === "append") {
          try {
            const res = await this.client.xray.get(`/test/${entry.issueKey}/step`);
            const existing = res.data;

            if (Array.isArray(existing) && existing.length > 0) {
              const lastStep = existing[existing.length - 1];
              const existingStep = lastStep?.step || "";
              const existingResult = lastStep?.result || "";

              const step = {
                step: [existingStep, newStepText].filter(Boolean).join("\n"),
                data: lastStep?.data || "",
                result: [existingResult, newResultText].filter(Boolean).join("\n"),
              };
              await this.client.xray.put(`/test/${entry.issueKey}/step`, step);
              result.success.push({ key: entry.issueKey!, message: "Updated successfully (appended)" });
              onProgress?.({ current: i + 1, total, currentKey: entry.issueKey!, status: "success" });
              continue;
            }
          } catch {
            // No existing steps - fall through to default PUT
          }
        }

        // ponies: DELETE existing steps before PUT to actually replace
        if (mode === "replace") {
          try {
            const res = await this.client.xray.get(`/test/${entry.issueKey}/step`);
            const existing = res.data;
            if (Array.isArray(existing)) {
              for (const step of existing) {
                if (step.id) {
                  await this.client.xray.delete(`/test/${entry.issueKey}/step/${step.id}`);
                }
              }
            }
          } catch {
            // ignore - might not have existing steps
          }
        }

        const step = {
          step: newStepText,
          data: "",
          result: newResultText,
        };
        await this.client.xray.put(`/test/${entry.issueKey}/step`, step);
        result.success.push({ key: entry.issueKey!, message: "Updated successfully" });
        onProgress?.({ current: i + 1, total, currentKey: entry.issueKey!, status: "success" });
      } catch (err: any) {
        const errMsg =
          err?.response?.data?.errorMessages?.[0] ||
          err?.response?.data?.message ||
          err?.message ||
          "Unknown error";
        logger.error("Jira", `Failed to update test steps for ${entry.issueKey}: ${errMsg}`, err);
        result.failed.push({ key: entry.issueKey!, error: errMsg });
        onProgress?.({ current: i + 1, total, currentKey: entry.issueKey!, status: "error", message: errMsg });
      }
    }

    return result;
  }

  async findTestCasesByJql(
    jql: string,
    maxResults: number = 200
  ): Promise<JiraIssueSummary[]> {
    this.assertConfigured();
    try {
      const response = await this.client.api.get("/search", {
        params: {
          jql,
          maxResults,
          fields: "summary,status,priority,assignee,issuetype",
        },
      });
      return (response.data.issues || []).map((issue: any) =>
        mapIssueToSummary(issue, this.config.baseUrl)
      );
    } catch (err: any) {
      const jiraMsg = err?.response?.data?.errorMessages?.[0] || err?.message || "Unknown error";
      logger.error("Jira", `JQL search failed: ${jql} — ${jiraMsg}`, err);
      throw new Error(`JQL tidak valid: ${jiraMsg}`);
    }
  }

  async getIssuesInXrayFolder(
    projectKey: string,
    folderId: number
  ): Promise<{ key: string; summary: string }[]> {
    this.assertConfigured();
    return this.client.getIssuesInXrayFolder(projectKey, folderId);
  }

  async resolveIssueKey(issueKey: string): Promise<string | null> {
    try {
      const response = await this.client.api.get(`/issue/${issueKey}`, {
        params: { fields: "key" },
        timeout: 10000,
      });
      return response.data?.key || issueKey;
    } catch (err: any) {
      if (err?.response?.status === 404) {
        logger.warn("Jira", `Issue ${issueKey} not found (may have been deleted).`);
      } else {
        logger.warn("Jira", `Failed to resolve issue key ${issueKey}: ${err?.message || err}`);
      }
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Private guards
  // -------------------------------------------------------------------------

  private assertConfigured(): void {
    if (
      !this.config.baseUrl ||
      !this.config.token ||
      !this.config.projectKey
    ) {
      throw new Error(
        "Konfigurasi Jira belum lengkap. Isi URL, token, dan project key di Settings."
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function detectPhaseFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("system integration") || lower.includes("sit")) return "SIT";
  if (lower.includes("user acceptance") || lower.includes("uat")) return "UAT";
  if (lower.includes("deployment") || lower.includes("dt")) return "DT";
  return "UNKNOWN";
}

const PHASE_ORDER: Record<string, number> = { SIT: 0, UAT: 1, DT: 2 };

function phaseSortOrder(a: string, b: string): number {
  return (PHASE_ORDER[a] ?? 99) - (PHASE_ORDER[b] ?? 99);
}

/**
 * Format aggregated phase data into UQA notes in wiki markup.
 */
function formatUqaNotes(phases: PhaseTestSummary[]): string {
  const parts: string[] = [];

  const sorted = [...phases].sort((a, b) => phaseSortOrder(a.phase, b.phase));

  for (const p of sorted) {
    const lineItems: string[] = [];

    // Phase header
    lineItems.push(`*${p.phase}*`);

    // Summary per test execution
    const statusParts: string[] = [];
    if (p.todo > 0) statusParts.push(`To Do ${p.todo} TC`);
    if (p.inProgress > 0) statusParts.push(`In Progress ${p.inProgress} TC`);
    if (p.done > 0) statusParts.push(`Done ${p.done} TC`);
    if (p.failed > 0) statusParts.push(`Failed ${p.failed} TC`);
    if (p.aborted > 0) statusParts.push(`Aborted ${p.aborted} TC`);

    lineItems.push(`${p.testExecKey}: ${statusParts.join(", ")}`);

    // Failed details (defects)
    for (const fd of p.failedDetails) {
      if (fd.defects.length > 0) {
        for (const defect of fd.defects) {
          lineItems.push(`  Failed - ${fd.testKey}: ${defect}`);
        }
      }
    }

    parts.push(lineItems.join("\n"));
  }

  return parts.join("\n\n");
}
