import axios from "axios";
import type { AppConfig, JiraIssueSource } from "@shared/types";

interface JiraIssueFields {
  issuetype?: { name: string };
  project?: { key: string; name: string };
  summary?: string;
  description?: string;
  status?: { name: string };
  priority?: { name: string };
  resolution?: { name: string };
  labels?: string[];
  created?: string;
  updated?: string;
  assignee?: { displayName: string };
  reporter?: { displayName: string };
  components?: { name: string }[];
  fixVersions?: { name: string }[];
}

interface JiraIssueResponse {
  key: string;
  fields: JiraIssueFields;
}

export class JiraConnector {
  private readonly allowedIssueTypes = new Set(["bug", "task", "defect"]);

  private buildAxiosConfig(config: AppConfig) {
    const auth: Record<string, string> =
      config.jira.authMode === "bearer"
        ? { Authorization: `Bearer ${config.jira.token}` }
        : {
            Authorization: `Basic ${Buffer.from(`${config.jira.username}:${config.jira.token}`).toString("base64")}`,
          };

    return {
      baseURL: config.jira.baseUrl.replace(/\/$/, ""),
      headers: { Accept: "application/json", ...auth },
      timeout: 30000,
    };
  }

  async fetchIssues(
    config: AppConfig,
    projectKey: string,
    cursor?: string,
    issueTypes: string[] = ["Bug", "Task", "Defect"],
  ): Promise<{ issues: JiraIssueSource[]; nextCursor: string | null }> {
    const axiosConfig = this.buildAxiosConfig(config);
    const selectedIssueTypes = issueTypes
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => t.toLowerCase())
      .filter(t => this.allowedIssueTypes.has(t));
    const effectiveIssueTypes = selectedIssueTypes.length > 0 ? selectedIssueTypes : [...this.allowedIssueTypes];
    const typeFilter = effectiveIssueTypes.map(t => `issuetype = "${t}"`).join(" OR ");
    const jqlCursor = this.toJqlDateTime(cursor);
    const jql = jqlCursor
      ? `project = "${projectKey}" AND (${typeFilter}) AND updated >= "${jqlCursor}" ORDER BY updated ASC`
      : `project = "${projectKey}" AND (${typeFilter}) ORDER BY updated ASC`;

    const allIssues: JiraIssueSource[] = [];
    let startAt = 0;
    const maxResults = 100;
    let lastUpdated: string | null = null;

    while (true) {
      const res = await axios.get("/rest/api/2/search", {
        ...axiosConfig,
        params: { jql, startAt, maxResults, fields: ["summary","description","status","priority","issuetype","created","updated","assignee","reporter","resolution","labels","components","fixVersions","comment"].join(",") },
      });

      const data = res.data as { issues: JiraIssueResponse[]; total: number };
      if (!data.issues?.length) break;

      for (const issue of data.issues) {
        if (!this.allowedIssueTypes.has(issue.fields.issuetype?.name?.toLowerCase() || "")) continue;

        const desc = issue.fields.description || "";
        const { stepsToReproduce, expectedResult, actualResult } = this.extractSteps(desc);

        const issueSource: JiraIssueSource = {
          id: issue.key,
          jiraIssueKey: issue.key,
          projectKey: issue.fields.project?.key || projectKey,
          issueType: issue.fields.issuetype?.name || "",
          summary: issue.fields.summary || "",
          description: desc,
          stepsToReproduce,
          expectedResult,
          actualResult,
          status: issue.fields.status?.name || "",
          priority: issue.fields.priority?.name || "",
          severity: issue.fields.priority?.name || "",
          component: issue.fields.components?.map(c => c.name).join(", ") || "",
          version: issue.fields.fixVersions?.map(v => v.name).join(", ") || "",
          reporter: issue.fields.reporter?.displayName || "",
          assignee: issue.fields.assignee?.displayName || "",
          labels: issue.fields.labels || [],
          resolution: issue.fields.resolution?.name || "",
          createdAt: issue.fields.created || "",
          updatedAt: issue.fields.updated || "",
          comments: "",
          attachmentsMetadata: "",
        };

        allIssues.push(issueSource);
        if (issue.fields.updated) lastUpdated = issue.fields.updated;
      }

      if (startAt + maxResults >= data.total) break;
      startAt += maxResults;
    }

    return { issues: allIssues, nextCursor: lastUpdated };
  }

  private toJqlDateTime(cursor?: string): string | null {
    if (!cursor) return null;
    const date = new Date(cursor);
    if (Number.isNaN(date.getTime())) return null;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  private extractSteps(description: string): { stepsToReproduce: string; expectedResult: string; actualResult: string } {
    const lower = description.toLowerCase();
    const stepsRegex = /steps?\s*(to\s+)?reproduce:?([\s\S]*?)(?=\n\s*(expected\s+result|actual\s+result|environment|additional|$))/i;
    const expectedRegex = /expected\s+result:?([\s\S]*?)(?=\n\s*(actual\s+result|environment|additional|steps?\s*(to\s+)?reproduce|$))/i;
    const actualRegex = /actual\s+result:?([\s\S]*?)(?=\n\s*(expected\s+result|environment|additional|steps?\s*(to\s+)?reproduce|$))/i;

    const stepsMatch = description.match(stepsRegex);
    const expectedMatch = description.match(expectedRegex);
    const actualMatch = description.match(actualRegex);

    return {
      stepsToReproduce: stepsMatch ? stepsMatch[2].trim() : "",
      expectedResult: expectedMatch ? expectedMatch[1].trim() : "",
      actualResult: actualMatch ? actualMatch[1].trim() : "",
    };
  }
}
