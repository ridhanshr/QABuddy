import type { JiraConfig } from "@shared/types";
import { createAtlassianClient } from "../http";
import type { AxiosInstance } from "axios";

// ---------------------------------------------------------------------------
// Typed response shapes
// ---------------------------------------------------------------------------

export interface JiraSearchResponse {
  issues: Array<{
    id: string;
    key: string;
    fields: {
      summary: string;
      status?: { name: string };
      priority?: { name: string };
      assignee?: { displayName?: string };
      issuetype?: { name: string };
    };
  }>;
  total: number;
}

export interface XrayFolder {
  id: number;
  name: string;
  children?: XrayFolder[];
}

export interface XrayTestRun {
  id: number;
  key: string;
  status: "TODO" | "EXECUTING" | "PASS" | "FAIL" | "ABORTED";
  defects?: Array<{ key: string; summary: string }>;
}

// ---------------------------------------------------------------------------
// JiraClient
// ---------------------------------------------------------------------------

/**
 * Low-level HTTP client wrapper for Jira REST API, Agile API, and Xray API.
 * All raw axios calls live here so that `jira-service.ts` can focus on
 * business logic rather than transport concerns.
 */
export class JiraClient {
  private readonly config: JiraConfig;

  /** Jira REST API v2 – e.g. /rest/api/2 */
  readonly api: AxiosInstance;
  /** Jira Agile REST API – e.g. /rest/agile/1.0 */
  readonly agile: AxiosInstance;
  /** Xray (Raven) API – e.g. /rest/raven/1.0/api */
  readonly xray: AxiosInstance;

  constructor(config: JiraConfig) {
    this.config = config;
    this.api = createAtlassianClient(config, "/rest/api/2");
    this.agile = createAtlassianClient(config, "/rest/agile/1.0");
    this.xray = createAtlassianClient(config, "/rest/raven/1.0/api");
  }

  // -------------------------------------------------------------------------
  // Convenience helpers
  // -------------------------------------------------------------------------

  /**
   * Build the full browser URL for a given issue key.
   */
  issueUrl(key: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/browse/${key}`;
  }

  /**
   * Run a JQL query and return only the total count (maxResults=0).
   */
  async countByJql(jql: string): Promise<number> {
    const res = await this.api.get<JiraSearchResponse>("/search", {
      params: { jql, maxResults: 0, fields: "id" },
    });
    return res.data.total;
  }

  // -------------------------------------------------------------------------
  // Xray folder utilities
  // -------------------------------------------------------------------------

  /**
   * Fetch all Xray test-repository folders for a project.
   */
  async getXrayFolders(projectKey: string): Promise<XrayFolder[]> {
    const res = await this.xray.get<any>(`/testrepository/${projectKey}/folders`);
    const data = res.data;
    if (Array.isArray(data)) return data;
    if (data?.results && Array.isArray(data.results)) return data.results;
    if (data?.data && Array.isArray(data.data)) return data.data;
    if (data?.folders && Array.isArray(data.folders)) return data.folders;
    throw new Error(`Unexpected Xray folders response format: ${JSON.stringify(data).slice(0, 200)}`);
  }

  /**
   * Walk the Xray folder tree and return the numeric id of the folder
   * matched by the given path segments.  Returns `null` if not found.
   */
  findFolderId(folders: XrayFolder[], pathParts: string[]): number | null {
    let currentFolders: XrayFolder[] = folders;
    let foundId: number | null = null;

    for (const part of pathParts) {
      if (!Array.isArray(currentFolders)) return null;
      const match = currentFolders.find(
        (f) => f.name.trim().toLowerCase() === part.trim().toLowerCase()
      );
      if (match) {
        foundId = match.id;
        currentFolders = Array.isArray(match.children) ? match.children : [];
      } else {
        return null;
      }
    }
    return foundId;
  }

  /**
   * Split a "/path/to/folder" string into trimmed, non-empty parts.
   */
  splitFolderPath(folderPath: string): string[] {
    return folderPath.split("/").filter((p) => p.trim() !== "");
  }

  /**
   * Fetch test steps + expected results for a given test issue key.
   * Returns null if the issue has no steps or doesn't exist.
   */
  async fetchTestSteps(
    issueKey: string
  ): Promise<{ steps: string[]; results: string[] } | null> {
    try {
      const res = await this.xray.get<any>(`/test/${issueKey}/step`);
      const data = res.data;
      if (Array.isArray(data) && data.length > 0) {
        const steps = data.map((s: any) => (s.step || "").trim()).filter(Boolean);
        const results = data.map((s: any) => (s.result || "").trim()).filter(Boolean);
        return steps.length > 0 || results.length > 0 ? { steps, results } : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get all test issue keys + summaries in a given Xray folder.
   * Tries the Xray API first, falls back to JQL search on the project.
   */
  async getIssuesInXrayFolder(
    projectKey: string,
    folderId: number
  ): Promise<{ key: string; summary: string }[]> {
    try {
      const res = await this.xray.get<any>(
        `/testrepository/${projectKey}/folders/${folderId}/tests`
      );
      const data = res.data;
      let keys: string[] = [];
      if (Array.isArray(data)) {
        keys = data;
      } else if (data?.keys && Array.isArray(data.keys)) {
        keys = data.keys;
      } else if (data?.issues && Array.isArray(data.issues)) {
        keys = data.issues.map((i: any) => (typeof i === "string" ? i : i.key));
      } else if (data?.results && Array.isArray(data.results)) {
        keys = data.results;
      }
      if (keys.length > 0) {
        return await this.fetchIssueSummaries(keys);
      }
    } catch {
      // Xray API endpoint not available — fall through to JQL
    }
    const jql = `project = "${projectKey}" ORDER BY key`;
    const res = await this.api.get<JiraSearchResponse>("/search", {
      params: { jql, maxResults: 500, fields: "summary" },
    });
    return (res.data.issues || []).map((i) => ({
      key: i.key,
      summary: i.fields.summary,
    }));
  }

  private async fetchIssueSummaries(keys: string[]): Promise<{ key: string; summary: string }[]> {
    if (keys.length === 0) return [];
    const jql = `key in (${keys.map((k) => `"${k}"`).join(",")})`;
    const res = await this.api.get<JiraSearchResponse>("/search", {
      params: { jql, maxResults: keys.length, fields: "summary" },
    });
    return (res.data.issues || []).map((i) => ({
      key: i.key,
      summary: i.fields.summary,
    }));
  }

  // -------------------------------------------------------------------------
  // UQA (Daily Activity) methods
  // -------------------------------------------------------------------------

  /**
   * Fetch the current Jira user (myself).
   */
  async getCurrentUser(): Promise<{ accountId: string; displayName: string; emailAddress: string }> {
    const res = await this.api.get("/myself");
    return res.data;
  }

  /**
   * Find a custom field by its exact name.
   */
  async getCustomFieldByName(
    name: string
  ): Promise<{ id: string; name: string; type: string; isCustom: boolean } | null> {
    const res = await this.api.get<any[]>("/field");
    const fields = res.data || [];
    const field = fields.find((f: any) => f.name === name);
    if (!field) return null;
    return {
      id: field.id,
      name: field.name,
      type: field.schema?.type || "string",
      isCustom: field.id?.startsWith("customfield_") ?? false,
    };
  }

  /**
   * Run a JQL search and return full issue details (key, summary, status, fields).
   */
  async searchIssuesFull(
    jql: string,
    maxResults: number,
    fields: string[] = ["summary", "status"]
  ): Promise<any[]> {
    const res = await this.api.get("/search", {
      params: {
        jql,
        maxResults,
        fields: fields.join(","),
      },
    });
    return res.data.issues || [];
  }

  /**
   * Fetch detailed issue data: description, status, transitions, updated, updateAuthor.
   */
  async getIssueDetail(
    issueKey: string
  ): Promise<{
    key: string;
    summary: string;
    description: any;
    status: string;
    statusCategory: string;
    updated: string;
    updateAuthor: string;
    updateAuthorDisplay: string;
  } | null> {
    try {
      const res = await this.api.get(`/issue/${issueKey}`, {
        params: {
          fields: "summary,description,status,updated,updateAuthor",
        },
      });
      const d = res.data;
      return {
        key: d.key,
        summary: d.fields.summary,
        description: d.fields.description,
        status: d.fields.status?.name || "",
        statusCategory: d.fields.status?.statusCategory?.name || "",
        updated: d.fields.updated || "",
        updateAuthor: d.fields.updateAuthor?.accountId || "",
        updateAuthorDisplay: d.fields.updateAuthor?.displayName || "",
      };
    } catch {
      return null;
    }
  }

  /**
   * Get available transitions for an issue.
   */
  async getTransitions(
    issueKey: string
  ): Promise<{ id: string; name: string; toStatus: string }[]> {
    const res = await this.api.get(`/issue/${issueKey}/transitions`);
    return (res.data.transitions || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      toStatus: t.to?.name || t.name,
    }));
  }

  /**
   * Execute a transition on an issue.
   */
  async executeTransition(issueKey: string, transitionId: string): Promise<void> {
    await this.api.post(`/issue/${issueKey}/transitions`, {
      transition: { id: transitionId },
    });
  }

  /**
   * Update issue description. Appends a wiki-format table row.
   * Expects `appendRow` in wiki format: `|date|activity|`
   */
  async appendToDescription(issueKey: string, appendRow: string): Promise<void> {
    const detail = await this.getIssueDetail(issueKey);
    if (!detail) throw new Error(`Issue ${issueKey} not found`);

    const existing = detail.description;
    let newDescription: string;

    if (typeof existing === "string") {
      newDescription = existing.trimEnd() + "\n" + appendRow;
    } else if (existing && typeof existing === "object" && existing.type === "doc") {
      const plainText = this.adfToPlainText(existing);
      newDescription = plainText.trimEnd() + "\n" + appendRow;
    } else {
      newDescription = `||Date||Activity||\n${appendRow}`;
    }

    await this.api.put(`/issue/${issueKey}`, {
      fields: { description: newDescription },
    });
  }

  /**
   * Update issue description with a 3-column wiki row (Date / Activity / Notes).
   */
  async appendToDescriptionWithNotes(issueKey: string, date: string, activity: string, notes: string): Promise<void> {
    const detail = await this.getIssueDetail(issueKey);
    if (!detail) throw new Error(`Issue ${issueKey} not found`);

    const existing = detail.description;
    let newDescription: string;

    const row = `|${date}|${activity}|${notes}|`;

    if (typeof existing === "string") {
      newDescription = existing.trimEnd() + "\n" + row;
    } else if (existing && typeof existing === "object" && existing.type === "doc") {
      const plainText = this.adfToPlainText(existing);
      newDescription = plainText.trimEnd() + "\n" + row;
    } else {
      newDescription = `||Date||Activity||Notes||\n${row}`;
    }

    await this.api.put(`/issue/${issueKey}`, {
      fields: { description: newDescription },
    });
  }

  /**
   * Simple ADF-to-plain-text converter (handles basic doc/paragraph/text nodes).
   * Tables are converted to wiki markup for storage compatibility.
   */
  adfToPlainText(adf: any): string {
    if (!adf || !adf.content) return "";
    const extract = (nodes: any[]): string => {
      let result = "";
      for (const node of nodes) {
        if (node.type === "text") {
          result += node.text || "";
        } else if (node.type === "hardBreak" || node.type === "hard_break") {
          result += "\n";
        } else if (node.type === "paragraph") {
          result += extract(node.content || []) + "\n";
        } else if (node.type === "table") {
          result += this.adfTableToWiki(node) + "\n";
        } else if (node.type === "tableRow") {
          result += "|";
          for (const cell of node.content || []) {
            result += extract(cell.content || []) + "|";
          }
          result += "\n";
        } else if (node.type === "tableHeader") {
          result += "||";
          for (const cell of node.content || []) {
            result += extract(cell.content || []) + "||";
          }
          result += "\n";
        } else if (node.content) {
          result += extract(node.content);
        }
      }
      return result;
    };
    return extract(adf.content || []);
  }

  private adfTableToWiki(table: any): string {
    let wiki = "";
    for (const row of table.content || []) {
      if (row.type === "tableRow") {
        const isHeader = row.content?.[0]?.type === "tableHeader";
        const sep = isHeader ? "||" : "|";
        wiki += sep;
        for (const cell of row.content || []) {
          wiki += this.adfToPlainText(cell).replace(/\n/g, " ") + sep;
        }
        wiki += "\n";
      }
    }
    return wiki;
  }

  /**
   * Move a set of test issue keys into an Xray folder.
   * Throws if the folder cannot be found.
   */
  async moveTestsToXrayFolder(
    projectKey: string,
    folderPath: string,
    issueKeys: string[]
  ): Promise<void> {
    const allFolders = await this.getXrayFolders(projectKey);
    const pathParts = this.splitFolderPath(folderPath);
    const folderId = this.findFolderId(allFolders, pathParts);

    if (!folderId) {
      throw new Error(`Folder tidak ditemukan: ${folderPath}`);
    }

    await this.xray.put(
      `/testrepository/${projectKey}/folders/${folderId}/tests`,
      { add: issueKeys }
    );
  }

  /**
   * Get issue links from a Jira issue, filtering for Test Execution type.
   * Returns linked Test Executions with their summary and key.
   */
  async getIssueLinks(issueKey: string): Promise<
    Array<{ issueKey: string; issueTypeName: string; summary: string }>
  > {
    const res = await this.api.get(`/issue/${issueKey}`, {
      params: { fields: "issuelinks" },
    });
    const links = res.data.fields?.issuelinks || [];
    const results: Array<{ issueKey: string; issueTypeName: string; summary: string }> = [];

    for (const link of links) {
      const typeName = link.type?.name || "";
      if (typeName !== "Test Execution") continue;

      if (link.inwardIssue?.fields?.issuetype?.name === "Test Execution") {
        results.push({
          issueKey: link.inwardIssue.key,
          issueTypeName: link.inwardIssue.fields.issuetype.name,
          summary: link.inwardIssue.fields.summary || "",
        });
      }
      if (link.outwardIssue?.fields?.issuetype?.name === "Test Execution") {
        results.push({
          issueKey: link.outwardIssue.key,
          issueTypeName: link.outwardIssue.fields.issuetype.name,
          summary: link.outwardIssue.fields.summary || "",
        });
      }
    }
    return results;
  }

  /**
   * Get all test runs within a Test Execution via Xray API.
   * Uses ?detailed=true to include defects/evidences.
   */
  async getXrayTestExecutionTests(testExecKey: string): Promise<XrayTestRun[]> {
    try {
      const res = await this.xray.get<any>(`/testexec/${testExecKey}/test?detailed=true`);
      const data = res.data;
      if (!Array.isArray(data)) return [];

      return data.map((t: any) => ({
        id: t.id,
        key: t.key,
        status: t.status,
        defects: t.defects?.map((d: any) => ({
          key: d.key,
          summary: d.summary,
        })) || [],
      }));
    } catch {
      return [];
    }
  }
}
