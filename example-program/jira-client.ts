import axios, { AxiosInstance } from "axios";

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: any;
    status: { name: string };
    priority?: { name: string };
    assignee?: { displayName: string; emailAddress: string };
    reporter?: { displayName: string };
    issuetype: { name: string };
    project: { key: string; name: string };
    labels?: string[];
    comment?: { comments: JiraComment[] };
    created: string;
    updated: string;
    fixVersions?: { name: string }[];
    components?: { name: string }[];
    customfield_10020?: { id: number; name: string; state: string }; // Sprint
  };
}

export interface JiraComment {
  id: string;
  author: { displayName: string };
  body: any;
  created: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

export interface CreateIssuePayload {
  project: string;
  summary: string;
  description?: string;
  issuetype?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  components?: string[];
  environment?: string;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
}

export class JiraClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string, pat: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.client = axios.create({
      baseURL: `${this.baseUrl}/rest/api/2`,
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  // ─── ISSUE OPERATIONS ────────────────────────────────────────────

  async getMyIssues(maxResults = 20): Promise<JiraIssue[]> {
    const jql = `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`;
    return this.searchIssues(jql, maxResults);
  }

  async getSprintIssues(projectKey: string, maxResults = 50): Promise<JiraIssue[]> {
    const jql = `project = "${projectKey}" AND sprint in openSprints() ORDER BY priority ASC, updated DESC`;
    return this.searchIssues(jql, maxResults);
  }

  async searchIssues(jql: string, maxResults = 30): Promise<JiraIssue[]> {
    const res = await this.client.get("/search", {
      params: {
        jql,
        maxResults,
        fields:
          "summary,description,status,priority,assignee,reporter,issuetype,project,labels,comment,created,updated,fixVersions,components,customfield_10020",
      },
    });
    return res.data.issues;
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    const res = await this.client.get(`/issue/${issueKey}`, {
      params: {
        fields:
          "summary,description,status,priority,assignee,reporter,issuetype,project,labels,comment,created,updated,fixVersions,components,customfield_10020",
      },
    });
    return res.data;
  }

  async createBug(payload: CreateIssuePayload): Promise<{ key: string; id: string; url: string }> {
    // Build ADF-compatible description
    const descriptionText = this.buildBugDescription(payload);

    const body: any = {
      fields: {
        project: { key: payload.project },
        summary: payload.summary,
        issuetype: { name: payload.issuetype || "Bug" },
        description: descriptionText,
      },
    };

    if (payload.priority) body.fields.priority = { name: payload.priority };
    if (payload.labels?.length) body.fields.labels = payload.labels;
    if (payload.assignee) body.fields.assignee = { name: payload.assignee };
    if (payload.components?.length)
      body.fields.components = payload.components.map((c) => ({ name: c }));

    const res = await this.client.post("/issue", body);
    return {
      key: res.data.key,
      id: res.data.id,
      url: `${this.baseUrl}/browse/${res.data.key}`,
    };
  }

  private buildBugDescription(payload: CreateIssuePayload): string {
    const parts: string[] = [];
    if (payload.environment) parts.push(`*Environment:*\n${payload.environment}`);
    if (payload.stepsToReproduce) parts.push(`*Steps to Reproduce:*\n${payload.stepsToReproduce}`);
    if (payload.expectedResult) parts.push(`*Expected Result:*\n${payload.expectedResult}`);
    if (payload.actualResult) parts.push(`*Actual Result:*\n${payload.actualResult}`);
    if (payload.description) parts.push(`*Additional Info:*\n${payload.description}`);
    return parts.join("\n\n");
  }

  async updateIssueStatus(issueKey: string, transitionName: string): Promise<{ success: boolean; message: string }> {
    // Get available transitions
    const transRes = await this.client.get(`/issue/${issueKey}/transitions`);
    const transitions: JiraTransition[] = transRes.data.transitions;

    const match = transitions.find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase()
    );

    if (!match) {
      const available = transitions.map((t) => t.name).join(", ");
      return {
        success: false,
        message: `Transition "${transitionName}" tidak ditemukan. Tersedia: ${available}`,
      };
    }

    await this.client.post(`/issue/${issueKey}/transitions`, {
      transition: { id: match.id },
    });

    return { success: true, message: `Issue ${issueKey} berhasil dipindahkan ke "${match.to.name}"` };
  }

  async addComment(issueKey: string, comment: string): Promise<{ id: string; url: string }> {
    const res = await this.client.post(`/issue/${issueKey}/comment`, {
      body: comment,
    });
    return {
      id: res.data.id,
      url: `${this.baseUrl}/browse/${issueKey}?focusedCommentId=${res.data.id}`,
    };
  }

  async linkIssues(
    sourceKey: string,
    targetKey: string,
    linkType: string = "Relates"
  ): Promise<{ success: boolean }> {
    await this.client.post("/issueLink", {
      type: { name: linkType },
      inwardIssue: { key: sourceKey },
      outwardIssue: { key: targetKey },
    });
    return { success: true };
  }

  async getBugMetrics(projectKey: string): Promise<Record<string, any>> {
    const queries = {
      total_open: `project = "${projectKey}" AND issuetype = Bug AND resolution = Unresolved`,
      critical: `project = "${projectKey}" AND issuetype = Bug AND resolution = Unresolved AND priority = Critical`,
      high: `project = "${projectKey}" AND issuetype = Bug AND resolution = Unresolved AND priority = High`,
      medium: `project = "${projectKey}" AND issuetype = Bug AND resolution = Unresolved AND priority = Medium`,
      low: `project = "${projectKey}" AND issuetype = Bug AND resolution = Unresolved AND priority = Low`,
      resolved_this_sprint: `project = "${projectKey}" AND issuetype = Bug AND resolution != Unresolved AND sprint in openSprints()`,
      found_this_sprint: `project = "${projectKey}" AND issuetype = Bug AND sprint in openSprints()`,
    };

    const metrics: Record<string, number> = {};
    for (const [key, jql] of Object.entries(queries)) {
      const res = await this.client.get("/search", {
        params: { jql, maxResults: 0, fields: "id" },
      });
      metrics[key] = res.data.total;
    }
    return metrics;
  }

  async getAvailableTransitions(issueKey: string): Promise<JiraTransition[]> {
    const res = await this.client.get(`/issue/${issueKey}/transitions`);
    return res.data.transitions;
  }

  async getProjects(): Promise<{ key: string; name: string }[]> {
    const res = await this.client.get("/project");
    return res.data.map((p: any) => ({ key: p.key, name: p.name }));
  }
}
