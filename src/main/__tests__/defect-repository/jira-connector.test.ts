import axios from "axios";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { JiraConnector } from "../../services/defect-repository/jira-connector";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

describe("JiraConnector", () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
  });

  it("formats incremental sync cursor into JQL-safe date time", () => {
    const connector = new JiraConnector();
    const value = (connector as any).toJqlDateTime("2026-06-12T13:45:15.000+0700");

    expect(value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("returns null for invalid cursor values", () => {
    const connector = new JiraConnector();
    const value = (connector as any).toJqlDateTime("not-a-date");

    expect(value).toBeNull();
  });

  it("filters Jira search by selected issue types", async () => {
    const connector = new JiraConnector();
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { issues: [], total: 0 },
    });

    await connector.fetchIssues(
      {
        jira: {
          baseUrl: "http://jira.local",
          authMode: "bearer",
          username: "user",
          token: "token",
        },
      } as any,
      "QA",
      undefined,
      ["Bug", "Defect"],
    );

    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(1);
    const request = vi.mocked(axios.get).mock.calls[0]?.[1];
    expect(request?.params?.jql).toContain('issuetype = "bug"');
    expect(request?.params?.jql).toContain('issuetype = "defect"');
    expect(request?.params?.jql).not.toContain('issuetype = "task"');
  });
});
