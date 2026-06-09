import type {
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
  // Issue search / query
  // -------------------------------------------------------------------------

  async searchIssues(
    jql: string,
    maxResults = 8
  ): Promise<JiraIssueSummary[]> {
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

  async getReadyForQaIssues(): Promise<JiraIssueSummary[]> {
    const baseJql =
      this.config.readyForQaJql.trim() ||
      `project = "${this.config.projectKey}" AND issuetype = Task AND status NOT IN ("DEPLOY", "DROPPED/CANCELLED") ORDER BY priority DESC, updated DESC`;

    // Strip trailing ORDER BY so we can append filters before it
    const orderMatch = baseJql.match(/^(.*?)\s*(ORDER\s+BY\s+.*)$/i);
    const filterPart = orderMatch ? orderMatch[1] : baseJql;
    const orderPart = orderMatch ? ` ${orderMatch[2]}` : "";
    const jql = `${filterPart} AND labels not in (NOT_DEFECT)${orderPart}`;

    return this.searchIssues(jql, 1000);
  }

  // -------------------------------------------------------------------------
  // Metrics & reports
  // -------------------------------------------------------------------------

  async getBugMetrics(): Promise<BugMetrics> {
    const project = this.config.projectKey;
    const search = (jql: string) => this.client.countByJql(jql);

    const statusFilter = `status NOT IN ("DROPPED/CANCELLED", "DEPLOYED")`;
    const [
      totalOpen,
      critical,
      high,
      medium,
      low,
      resolvedThisSprint,
      foundThisSprint,
    ] = await Promise.all([
      search(`project = "${project}" AND issuetype = Task AND resolution = Unresolved AND ${statusFilter} AND labels not in (NOT_DEFECT)`),
      search(`project = "${project}" AND issuetype = Task AND resolution = Unresolved AND ${statusFilter} AND priority = Critical AND labels not in (NOT_DEFECT)`),
      search(`project = "${project}" AND issuetype = Task AND resolution = Unresolved AND ${statusFilter} AND priority = High AND labels not in (NOT_DEFECT)`),
      search(`project = "${project}" AND issuetype = Task AND resolution = Unresolved AND ${statusFilter} AND priority = Medium AND labels not in (NOT_DEFECT)`),
      search(`project = "${project}" AND issuetype = Task AND resolution = Unresolved AND ${statusFilter} AND priority = Low AND labels not in (NOT_DEFECT)`),
      search(`project = "${project}" AND issuetype = Task AND resolution != Unresolved AND sprint in openSprints() AND ${statusFilter} AND labels not in (NOT_DEFECT)`),
      search(`project = "${project}" AND issuetype = Task AND sprint in openSprints() AND ${statusFilter} AND labels not in (NOT_DEFECT)`),
    ]);

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
          search(`project = "${project}" AND issuetype = Task AND "Epic Link" in (${keys}) AND labels not in (NOT_DEFECT)`),
          search(`project = "${project}" AND issuetype = Task AND resolution != Unresolved AND "Epic Link" in (${keys}) AND labels not in (NOT_DEFECT)`),
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
    const response = await this.client.api.post("/issue", {
      fields: {
        project: { key: this.config.projectKey },
        summary: preview.summary,
        issuetype: { name: this.config.bugIssueType || "Bug" },
        description: preview.description,
        priority: { name: preview.priority || "Medium" },
        labels: preview.labels,
        environment: draft.environment || undefined,
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

      // Move to Xray folder if specified
      if (item.xrayFolder?.trim()) {
        try {
          if (!allFolders) {
            allFolders = await this.client.getXrayFolders(projectKey);
          }
          const pathParts = this.client.splitFolderPath(item.xrayFolder);
          const folderId = this.client.findFolderId(allFolders, pathParts);
          if (folderId) {
            await this.client.xray.post(
              `/testrepository/${projectKey}/folders/${folderId}/tests`,
              { add: [issueKey] }
            );
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
