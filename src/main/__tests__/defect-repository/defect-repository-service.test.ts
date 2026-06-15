import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig, DefectRecord, JiraIssueSource, JiraProjectSource, SyncState } from "@shared/types";

vi.mock("electron", () => ({
  app: {
    getPath: () => path.join(process.cwd(), "test-results", "defect-service-userdata"),
  },
}));

import { DefectRepositoryService } from "../../services/defect-repository/defect-repository-service";
import { SearchIndex } from "../../services/defect-repository/search-index";

describe("DefectRepositoryService", () => {
  it("preserves defect ids when resyncing the same Jira issue", async () => {
    const service = new DefectRepositoryService("http://127.0.0.1:11434");
    const config: AppConfig = {
      jira: {
        baseUrl: "http://jira.local",
        authMode: "bearer",
        username: "user",
        token: "token",
        projectKey: "QA",
        readyForQaJql: "",
        bugIssueType: "Bug",
        testCaseIssueType: "Task",
      },
      confluence: {
        baseUrl: "http://confluence.local",
        authMode: "bearer",
        username: "user",
        token: "token",
        spaceKey: "QA",
        targetPageId: "",
        jiraServerId: "",
      },
      ollama: {
        endpoint: "http://127.0.0.1:11434",
        model: "qwen2.5:7b",
        jqlModel: "",
        chatModel: "",
        extractionModel: "",
        insightModel: "",
        defectEmbeddingModel: "embeddinggemma",
        defectExplanationModel: "",
      },
      preferences: {
        theme: "light",
        language: "id-ID",
      },
      uqa: {
        enabled: false,
        remindTime: "16:00",
        remindDays: [1, 2, 3, 4, 5],
        productTesterFieldId: null,
        lastNotifiedDate: {},
        perIssueReminders: {},
        searchMode: "both",
        projectKeys: [],
      },
      dashboard: {
        projects: [],
      },
    };

    const existingDefect: DefectRecord = {
      id: "defect-1",
      sourceIssueKey: "QA-1",
      sourceProjectKey: "QA",
      issueType: "Bug",
      normalizedTitle: "old title",
      normalizedDescription: "old description",
      searchText: "old title old description",
      status: "Open",
      component: "Checkout",
      version: "1.0.0",
      severity: "High",
      priority: "High",
      similarityFingerprint: "old fingerprint",
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
    };

    const savedDefects: DefectRecord[][] = [];
    const savedStates: SyncState[] = [];
    const savedSources: JiraProjectSource[] = [];

    (service as any).store = {
      getSources: vi.fn(async () => ([{
        id: "source-1",
        projectKey: "QA",
        projectName: "QA",
        isActive: true,
        lastSyncedAt: null,
        syncMode: "initial",
        syncStatus: "idle",
      }])),
      getSyncStates: vi.fn(async () => ([{
        id: "sync-1",
        projectKey: "qa",
        lastCursor: "2026-06-12T00:00:00.000Z",
        lastSyncAt: "2026-06-12T00:00:00.000Z",
        lastSyncStatus: "success",
        errorMessage: "",
      }])),
      getDefects: vi.fn(async () => ([existingDefect])),
      saveSource: vi.fn(async (source: JiraProjectSource) => {
        savedSources.push(source);
        return savedSources;
      }),
      saveDefects: vi.fn(async (defects: DefectRecord[]) => {
        savedDefects.push(defects);
      }),
      saveSyncState: vi.fn(async (state: SyncState) => {
        savedStates.push(state);
      }),
    };

    (service as any).jiraConnector = {
      fetchIssues: vi.fn(async (_config: AppConfig, _projectKey: string) => ({
        issues: [
          {
            id: "QA-1",
            jiraIssueKey: "QA-1",
            projectKey: "QA",
            issueType: "Bug",
            summary: "new title",
            description: "new description",
            stepsToReproduce: "",
            expectedResult: "",
            actualResult: "",
            status: "In Progress",
            priority: "High",
            severity: "High",
            component: "Checkout",
            version: "1.0.1",
            reporter: "Tester",
            assignee: "Dev",
            labels: [],
            resolution: "",
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T01:00:00.000Z",
            comments: "",
            attachmentsMetadata: "",
          } satisfies JiraIssueSource,
        ],
        nextCursor: "2026-06-12T01:00:00.000Z",
      })),
    };

    (service as any).searchIndex = { build: vi.fn() };

    const result = await service.syncSource(config, "QA");

    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(savedDefects).toHaveLength(1);
    expect(savedDefects[0]).toHaveLength(1);
    expect(savedDefects[0][0].id).toBe("defect-1");
    expect(savedStates).toHaveLength(1);
    expect(savedStates[0].projectKey).toBe("QA");
  });

  it("rebuilds search results from the latest storage state", async () => {
    const service = new DefectRepositoryService("http://127.0.0.1:11434");
    const staleDefect: DefectRecord = {
      id: "defect-stale",
      sourceIssueKey: "QA-OLD",
      sourceProjectKey: "QA",
      issueType: "Bug",
      normalizedTitle: "old title",
      normalizedDescription: "old description",
      searchText: "old title old description",
      status: "Open",
      component: "Checkout",
      version: "1.0.0",
      severity: "High",
      priority: "High",
      similarityFingerprint: "old fingerprint",
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
    };
    const freshDefect: DefectRecord = {
      id: "defect-fresh",
      sourceIssueKey: "QA-NEW",
      sourceProjectKey: "QA",
      issueType: "Bug",
      normalizedTitle: "fresh title",
      normalizedDescription: "fresh description",
      searchText: "fresh title fresh description",
      status: "Open",
      component: "Checkout",
      version: "1.0.1",
      severity: "High",
      priority: "High",
      similarityFingerprint: "fresh fingerprint",
      createdAt: "2026-06-12T01:00:00.000Z",
      updatedAt: "2026-06-12T01:00:00.000Z",
    };

    (service as any).store = {
      getDefects: vi.fn(async () => ([freshDefect])),
    };

    const staleIndex = new SearchIndex();
    staleIndex.build([staleDefect]);
    (service as any).searchIndex = staleIndex;

    const result = await service.searchDefects({ query: "" }, {
      jira: {
        baseUrl: "http://jira.local",
        authMode: "bearer",
        username: "user",
        token: "token",
        projectKey: "QA",
        readyForQaJql: "",
        bugIssueType: "Bug",
        testCaseIssueType: "Task",
      },
      confluence: {
        baseUrl: "http://confluence.local",
        authMode: "bearer",
        username: "user",
        token: "token",
        spaceKey: "QA",
        targetPageId: "",
        jiraServerId: "",
      },
      ollama: {
        endpoint: "http://127.0.0.1:11434",
        model: "qwen2.5:7b",
        jqlModel: "",
        chatModel: "",
        extractionModel: "",
        insightModel: "",
        defectEmbeddingModel: "embeddinggemma",
        defectExplanationModel: "",
      },
      preferences: {
        theme: "light",
        language: "id-ID",
      },
      uqa: {
        enabled: false,
        remindTime: "16:00",
        remindDays: [1, 2, 3, 4, 5],
        productTesterFieldId: null,
        lastNotifiedDate: {},
        perIssueReminders: {},
        searchMode: "both",
        projectKeys: [],
      },
      dashboard: {
        projects: [],
      },
    });

    expect(result.defects).toHaveLength(1);
    expect(result.defects[0].id).toBe("defect-fresh");
  });

  it("returns the same duplicate candidates for search and create flows", async () => {
    const service = new DefectRepositoryService("http://127.0.0.1:11434");
    service.setAIEnabled(false);

    const defects: DefectRecord[] = [
      {
        id: "defect-1",
        sourceIssueKey: "QA-101",
        sourceProjectKey: "QA",
        issueType: "Bug",
        normalizedTitle: "payment timeout on checkout",
        normalizedDescription: "payment gateway timeout when submitting order",
        searchText: "payment timeout on checkout payment gateway timeout when submitting order",
        status: "Open",
        component: "Checkout",
        version: "1.0.0",
        severity: "High",
        priority: "High",
        similarityFingerprint: "checkout::gateway::order::payment::timeout",
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
      },
      {
        id: "defect-2",
        sourceIssueKey: "QA-102",
        sourceProjectKey: "QA",
        issueType: "Task",
        normalizedTitle: "user profile copy update",
        normalizedDescription: "update label text in profile page",
        searchText: "user profile copy update label text profile page",
        status: "Open",
        component: "Profile",
        version: "1.0.0",
        severity: "Low",
        priority: "Low",
        similarityFingerprint: "profile::copy::text::update",
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
      },
    ];

    (service as any).store = {
      getDefects: vi.fn(async () => defects),
    };

    const config: AppConfig = {
      jira: {
        baseUrl: "http://jira.local",
        authMode: "bearer",
        username: "user",
        token: "token",
        projectKey: "QA",
        readyForQaJql: "",
        bugIssueType: "Bug",
        testCaseIssueType: "Task",
      },
      confluence: {
        baseUrl: "http://confluence.local",
        authMode: "bearer",
        username: "user",
        token: "token",
        spaceKey: "QA",
        targetPageId: "",
        jiraServerId: "",
      },
      ollama: {
        endpoint: "",
        model: "",
        jqlModel: "",
        chatModel: "",
        extractionModel: "",
        insightModel: "",
        defectEmbeddingModel: "",
        defectExplanationModel: "",
      },
      preferences: {
        theme: "light",
        language: "id-ID",
      },
      uqa: {
        enabled: false,
        remindTime: "16:00",
        remindDays: [1, 2, 3, 4, 5],
        productTesterFieldId: null,
        lastNotifiedDate: {},
        perIssueReminders: {},
        searchMode: "both",
        projectKeys: [],
      },
      dashboard: {
        projects: [],
      },
    };

    const filters = { query: "payment timeout checkout", projectKeys: ["QA"], issueTypes: ["Bug", "Task", "Defect"] };
    const searchResult = await service.searchDefects(filters, config);
    const createCandidates = await service.findDuplicateCandidates(filters, config);

    expect(createCandidates.map((c) => c.defect.id)).toEqual(searchResult.candidates.map((c) => c.defect.id));
    expect(createCandidates.map((c) => c.score)).toEqual(searchResult.candidates.map((c) => c.score));
  });
});
