import { describe, expect, it, vi } from "vitest";
import { JiraService } from "../services/jira-service";

describe("Defect creation", () => {
  it("posts a generic issue to the selected project and issue type", async () => {
    const service = new JiraService({
      baseUrl: "https://jira.example.test",
      authMode: "bearer",
      username: "",
      token: "token",
      projectKey: "LEGACY",
      readyForQaJql: "",
      bugIssueType: "Bug",
      testCaseIssueType: "Task",
    });
    const post = vi.fn().mockResolvedValue({ data: { key: "DEF-123" } });

    (service as any).client = {
      api: { post },
      issueUrl: (key: string) => `https://jira.example.test/browse/${key}`,
    };

    const result = await service.createIssue("PROJ", "Task", {
      summary: "Selected project defect",
      description: "Description body",
      priority: "High",
      labels: ["qa-buddy", "regression"],
      environment: "QA",
      component: "Payments",
      version: "1.2.3",
      severity: "Critical",
    });

    expect(post).toHaveBeenCalledWith("/issue", {
      fields: {
        project: { key: "PROJ" },
        summary: "Selected project defect",
        issuetype: { name: "Task" },
        description: "Description body",
        priority: { name: "High" },
        labels: ["qa-buddy", "regression"],
        environment: "QA",
      },
    });
    expect(result).toEqual({
      key: "DEF-123",
      url: "https://jira.example.test/browse/DEF-123",
    });
  });
});
