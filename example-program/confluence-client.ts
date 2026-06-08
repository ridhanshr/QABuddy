import axios, { AxiosInstance } from "axios";

export interface ConfluencePage {
  id: string;
  title: string;
  space: { key: string; name: string };
  body?: { storage: { value: string } };
  version: { number: number };
  _links: { webui: string };
}

export interface TestCase {
  id: string;
  name: string;
  steps: string[];
  expectedResult: string;
  status?: "PASS" | "FAIL" | "SKIP" | "NOT_RUN";
  notes?: string;
}

export class ConfluenceClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string, pat: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.client = axios.create({
      baseURL: `${this.baseUrl}/rest/api`,
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  // ─── PAGE OPERATIONS ─────────────────────────────────────────────

  async searchPages(query: string, spaceKey?: string, maxResults = 10): Promise<ConfluencePage[]> {
    const cql = spaceKey
      ? `type = "page" AND space.key = "${spaceKey}" AND text ~ "${query}"`
      : `type = "page" AND text ~ "${query}"`;

    const res = await this.client.get("/content/search", {
      params: { cql, limit: maxResults, expand: "space,version" },
    });
    return res.data.results;
  }

  async getPage(pageId: string): Promise<ConfluencePage> {
    const res = await this.client.get(`/content/${pageId}`, {
      params: { expand: "body.storage,version,space" },
    });
    return res.data;
  }

  async getPageByTitle(spaceKey: string, title: string): Promise<ConfluencePage | null> {
    const res = await this.client.get("/content", {
      params: {
        spaceKey,
        title,
        expand: "body.storage,version,space",
        limit: 1,
      },
    });
    return res.data.results?.[0] || null;
  }

  async createPage(
    spaceKey: string,
    title: string,
    content: string,
    parentId?: string
  ): Promise<{ id: string; url: string }> {
    const body: any = {
      type: "page",
      title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: content,
          representation: "storage",
        },
      },
    };

    if (parentId) {
      body.ancestors = [{ id: parentId }];
    }

    const res = await this.client.post("/content", body);
    return {
      id: res.data.id,
      url: `${this.baseUrl}${res.data._links.webui}`,
    };
  }

  async updatePage(
    pageId: string,
    title: string,
    content: string,
    currentVersion: number
  ): Promise<{ id: string; url: string }> {
    const res = await this.client.put(`/content/${pageId}`, {
      type: "page",
      title,
      version: { number: currentVersion + 1 },
      body: {
        storage: {
          value: content,
          representation: "storage",
        },
      },
    });
    return {
      id: res.data.id,
      url: `${this.baseUrl}${res.data._links.webui}`,
    };
  }

  // ─── TEST CASE OPERATIONS ─────────────────────────────────────────

  parseTestCasesFromHtml(html: string): TestCase[] {
    const testCases: TestCase[] = [];

    // Parse table rows — assuming standard QA test case table format
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

    let isFirstRow = true;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      if (isFirstRow) {
        isFirstRow = false;
        continue; // skip header row
      }

      const cells: string[] = [];
      let cellMatch;
      const cellContent = rowMatch[1];
      const cellRegexLocal = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

      while ((cellMatch = cellRegexLocal.exec(cellContent)) !== null) {
        const cleaned = cellMatch[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .trim();
        cells.push(cleaned);
      }

      if (cells.length >= 3) {
        testCases.push({
          id: cells[0] || `TC-${testCases.length + 1}`,
          name: cells[1] || "Unnamed Test Case",
          steps: (cells[2] || "").split("\n").filter(Boolean),
          expectedResult: cells[3] || "",
          status: (cells[4] as TestCase["status"]) || "NOT_RUN",
          notes: cells[5] || "",
        });
      }
    }

    return testCases;
  }

  buildTestReportHtml(
    title: string,
    testCases: TestCase[],
    jiraProjectUrl?: string
  ): string {
    const passCount = testCases.filter((tc) => tc.status === "PASS").length;
    const failCount = testCases.filter((tc) => tc.status === "FAIL").length;
    const skipCount = testCases.filter((tc) => tc.status === "SKIP").length;
    const notRunCount = testCases.filter((tc) => tc.status === "NOT_RUN").length;
    const total = testCases.length;
    const passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;

    const statusColor: Record<string, string> = {
      PASS: "#00875A",
      FAIL: "#DE350B",
      SKIP: "#FF8B00",
      NOT_RUN: "#6B778C",
    };

    const rows = testCases
      .map(
        (tc) => `
      <tr>
        <td style="padding:8px;border:1px solid #DFE1E6;">${tc.id}</td>
        <td style="padding:8px;border:1px solid #DFE1E6;">${tc.name}</td>
        <td style="padding:8px;border:1px solid #DFE1E6;">${tc.expectedResult}</td>
        <td style="padding:8px;border:1px solid #DFE1E6;text-align:center;">
          <span style="background:${statusColor[tc.status || "NOT_RUN"]};color:white;padding:2px 8px;border-radius:3px;font-weight:bold;font-size:12px;">
            ${tc.status || "NOT_RUN"}
          </span>
        </td>
        <td style="padding:8px;border:1px solid #DFE1E6;">${tc.notes || "-"}</td>
      </tr>`
      )
      .join("");

    return `
<h2>${title}</h2>
<p><strong>Generated:</strong> ${new Date().toLocaleString("id-ID")}</p>

<table style="border-collapse:collapse;background:#F4F5F7;padding:16px;border-radius:4px;margin-bottom:16px;">
  <tr>
    <td style="padding:8px 16px;text-align:center;">
      <div style="font-size:24px;font-weight:bold;color:#0052CC;">${passRate}%</div>
      <div style="color:#6B778C;font-size:12px;">Pass Rate</div>
    </td>
    <td style="padding:8px 16px;text-align:center;">
      <div style="font-size:20px;font-weight:bold;color:#00875A;">${passCount}</div>
      <div style="color:#6B778C;font-size:12px;">PASS</div>
    </td>
    <td style="padding:8px 16px;text-align:center;">
      <div style="font-size:20px;font-weight:bold;color:#DE350B;">${failCount}</div>
      <div style="color:#6B778C;font-size:12px;">FAIL</div>
    </td>
    <td style="padding:8px 16px;text-align:center;">
      <div style="font-size:20px;font-weight:bold;color:#FF8B00;">${skipCount}</div>
      <div style="color:#6B778C;font-size:12px;">SKIP</div>
    </td>
    <td style="padding:8px 16px;text-align:center;">
      <div style="font-size:20px;font-weight:bold;color:#6B778C;">${notRunCount}</div>
      <div style="color:#6B778C;font-size:12px;">NOT RUN</div>
    </td>
    <td style="padding:8px 16px;text-align:center;">
      <div style="font-size:20px;font-weight:bold;">${total}</div>
      <div style="color:#6B778C;font-size:12px;">TOTAL</div>
    </td>
  </tr>
</table>

<table style="width:100%;border-collapse:collapse;font-size:14px;">
  <tr style="background:#0052CC;color:white;">
    <th style="padding:10px;border:1px solid #0052CC;text-align:left;">ID</th>
    <th style="padding:10px;border:1px solid #0052CC;text-align:left;">Test Case</th>
    <th style="padding:10px;border:1px solid #0052CC;text-align:left;">Expected Result</th>
    <th style="padding:10px;border:1px solid #0052CC;text-align:center;">Status</th>
    <th style="padding:10px;border:1px solid #0052CC;text-align:left;">Notes</th>
  </tr>
  ${rows}
</table>

${jiraProjectUrl ? `<p><a href="${jiraProjectUrl}">🔗 Lihat di Jira</a></p>` : ""}
    `.trim();
  }

  async createTestReport(
    spaceKey: string,
    reportTitle: string,
    testCases: TestCase[],
    parentId?: string,
    jiraProjectUrl?: string
  ): Promise<{ id: string; url: string }> {
    const content = this.buildTestReportHtml(reportTitle, testCases, jiraProjectUrl);
    return this.createPage(spaceKey, reportTitle, content, parentId);
  }

  async getSpaces(): Promise<{ key: string; name: string }[]> {
    const res = await this.client.get("/space", {
      params: { limit: 50, type: "global" },
    });
    return res.data.results.map((s: any) => ({ key: s.key, name: s.name }));
  }
}
