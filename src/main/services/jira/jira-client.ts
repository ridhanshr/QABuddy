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
}
