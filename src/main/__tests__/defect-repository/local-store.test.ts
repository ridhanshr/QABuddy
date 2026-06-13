import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraProjectSource } from "@shared/types";

const userDataDir = path.join(process.cwd(), "test-results", "local-store-userdata");

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir,
  },
}));

import { LocalStore } from "../../services/defect-repository/local-store";

describe("LocalStore", () => {
  beforeEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it("keeps one source per project key and preserves the original id", async () => {
    const store = new LocalStore();
    const first: JiraProjectSource = {
      id: "source-1",
      projectKey: "qa",
      projectName: "QA",
      isActive: true,
      lastSyncedAt: null,
      syncMode: "initial",
      syncStatus: "idle",
    };
    const second: JiraProjectSource = {
      id: "source-2",
      projectKey: "QA",
      projectName: "QA Updated",
      isActive: false,
      lastSyncedAt: "2026-06-12T00:00:00.000Z",
      syncMode: "incremental",
      syncStatus: "success",
    };

    await store.saveSource(first);
    await store.saveSource(second);

    const sources = await store.getSources();

    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe("source-1");
    expect(sources[0].projectKey).toBe("QA");
    expect(sources[0].projectName).toBe("QA Updated");
    expect(sources[0].isActive).toBe(false);
    expect(sources[0].syncStatus).toBe("success");
  });

  it("fills default auto sync settings for legacy sources", async () => {
    const store = new LocalStore();

    await store.saveSource({
      id: "source-legacy",
      projectKey: "legacy",
      projectName: "Legacy",
      isActive: true,
      lastSyncedAt: null,
      syncMode: "initial",
      syncStatus: "idle",
    });

    const [source] = await store.getSources();

    expect(source.autoSyncEnabled).toBe(false);
    expect(source.autoSyncDays).toEqual([1, 2, 3, 4, 5]);
    expect(source.autoSyncTime).toBe("09:00");
    expect(source.issueTypes).toEqual(["Bug", "Task", "Defect"]);
    expect(source.lastAutoSyncAt).toBeNull();
  });

  it("removes defects, sync state, and duplicate relations for a deleted source", async () => {
    const store = new LocalStore();
    await store.saveSource({
      id: "source-1",
      projectKey: "QA",
      projectName: "QA",
      isActive: true,
      lastSyncedAt: null,
      syncMode: "initial",
      syncStatus: "idle",
    });

    await store.saveDefects([
      {
        id: "defect-1",
        sourceIssueKey: "QA-1",
        sourceProjectKey: "QA",
        issueType: "Bug",
        normalizedTitle: "title",
        normalizedDescription: "description",
        searchText: "title description",
        status: "Open",
        component: "Checkout",
        version: "1.0.0",
        severity: "High",
        priority: "High",
        similarityFingerprint: "checkout::payment",
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
      },
      {
        id: "defect-2",
        sourceIssueKey: "QA-2",
        sourceProjectKey: "QA",
        issueType: "Bug",
        normalizedTitle: "title 2",
        normalizedDescription: "description 2",
        searchText: "title 2 description 2",
        status: "Open",
        component: "Checkout",
        version: "1.0.0",
        severity: "High",
        priority: "High",
        similarityFingerprint: "checkout::payment::2",
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
      },
    ]);

    await store.saveSyncState({
      id: "sync-1",
      projectKey: "qa",
      lastCursor: "2026-06-12T00:00:00.000Z",
      lastSyncAt: "2026-06-12T00:00:00.000Z",
      lastSyncStatus: "success",
      errorMessage: "",
    });

    await store.saveDuplicateRelation({
      id: "rel-1",
      primaryDefectId: "defect-1",
      duplicateDefectId: "defect-2",
      reason: "manual",
      confidenceScore: 80,
      createdBy: "tester",
      createdAt: "2026-06-12T00:00:00.000Z",
    });

    await store.deleteSource("source-1");

    const [sources, defects, relations, syncStates] = await Promise.all([
      store.getSources(),
      store.getDefects(),
      store.getDuplicateRelations(),
      store.getSyncStates(),
    ]);

    expect(sources).toHaveLength(0);
    expect(defects).toHaveLength(0);
    expect(relations).toHaveLength(0);
    expect(syncStates).toHaveLength(0);
  });

  it("repairs legacy duplicates and orphans on read", async () => {
    fs.mkdirSync(path.join(userDataDir, "defect-repository"), { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "defect-repository", "data.json"),
      JSON.stringify({
        sources: [
          {
            id: "source-1",
            projectKey: "qa",
            projectName: "QA",
            isActive: true,
            lastSyncedAt: null,
            syncMode: "initial",
            syncStatus: "idle",
          },
          {
            id: "source-2",
            projectKey: "QA",
            projectName: "QA Duplicate",
            isActive: false,
            lastSyncedAt: "2026-06-12T02:00:00.000Z",
            syncMode: "incremental",
            syncStatus: "success",
          },
        ],
        defects: [
          {
            id: "defect-1",
            sourceIssueKey: "qa-1",
            sourceProjectKey: "qa",
            issueType: "Bug",
            normalizedTitle: "legacy title",
            normalizedDescription: "legacy description",
            searchText: "legacy title legacy description",
            status: "Open",
            component: "Checkout",
            version: "1.0.0",
            severity: "High",
            priority: "High",
            similarityFingerprint: "checkout::legacy",
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:00.000Z",
          },
          {
            id: "defect-2",
            sourceIssueKey: "QA-1",
            sourceProjectKey: "QA",
            issueType: "Bug",
            normalizedTitle: "newer title",
            normalizedDescription: "newer description",
            searchText: "newer title newer description",
            status: "In Progress",
            component: "Checkout",
            version: "1.0.1",
            severity: "Critical",
            priority: "Critical",
            similarityFingerprint: "checkout::legacy::new",
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T01:00:00.000Z",
          },
          {
            id: "defect-orphan",
            sourceIssueKey: "ORPH-1",
            sourceProjectKey: "ORPH",
            issueType: "Bug",
            normalizedTitle: "orphan title",
            normalizedDescription: "orphan description",
            searchText: "orphan title orphan description",
            status: "Open",
            component: "Other",
            version: "1.0.0",
            severity: "Low",
            priority: "Low",
            similarityFingerprint: "orphan",
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:00.000Z",
          },
          {
            id: "defect-3",
            sourceIssueKey: "QA-2",
            sourceProjectKey: "QA",
            issueType: "Bug",
            normalizedTitle: "related title",
            normalizedDescription: "related description",
            searchText: "related title related description",
            status: "Open",
            component: "Checkout",
            version: "1.0.2",
            severity: "High",
            priority: "High",
            similarityFingerprint: "checkout::related",
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:30:00.000Z",
          },
        ],
        duplicateRelations: [
          {
            id: "rel-1",
            primaryDefectId: "defect-1",
            duplicateDefectId: "defect-1",
            reason: "self",
            confidenceScore: 10,
            createdBy: "tester",
            createdAt: "2026-06-12T00:00:00.000Z",
          },
          {
            id: "rel-2",
            primaryDefectId: "defect-2",
            duplicateDefectId: "defect-3",
            reason: "manual",
            confidenceScore: 90,
            createdBy: "tester",
            createdAt: "2026-06-12T01:00:00.000Z",
          },
          {
            id: "rel-3",
            primaryDefectId: "defect-2",
            duplicateDefectId: "defect-3",
            reason: "manual",
            confidenceScore: 80,
            createdBy: "tester",
            createdAt: "2026-06-12T00:30:00.000Z",
          },
          {
            id: "rel-4",
            primaryDefectId: "defect-2",
            duplicateDefectId: "defect-orphan",
            reason: "orphan",
            confidenceScore: 70,
            createdBy: "tester",
            createdAt: "2026-06-12T00:30:00.000Z",
          },
        ],
        syncStates: [
          {
            id: "sync-1",
            projectKey: "qa",
            lastCursor: "2026-06-12T00:00:00.000Z",
            lastSyncAt: "2026-06-12T00:00:00.000Z",
            lastSyncStatus: "success",
            errorMessage: "",
          },
          {
            id: "sync-2",
            projectKey: "ORPH",
            lastCursor: "2026-06-12T00:00:00.000Z",
            lastSyncAt: "2026-06-12T00:00:00.000Z",
            lastSyncStatus: "success",
            errorMessage: "",
          },
        ],
      }, null, 2),
      "utf8",
    );

    const store = new LocalStore();
    const sources = await store.getSources();
    const defects = await store.getDefects();
    const relations = await store.getDuplicateRelations();
    const syncStates = await store.getSyncStates();
    const persisted = JSON.parse(
      fs.readFileSync(path.join(userDataDir, "defect-repository", "data.json"), "utf8"),
    );

    expect(sources).toHaveLength(1);
    expect(sources[0].projectKey).toBe("QA");
    expect(defects).toHaveLength(2);
    expect(defects.map(d => d.sourceIssueKey).sort()).toEqual(["QA-1", "QA-2"]);
    expect(defects.find(d => d.sourceIssueKey === "QA-1")?.updatedAt).toBe("2026-06-12T01:00:00.000Z");
    expect(relations).toHaveLength(1);
    expect(relations[0].id).toBe("rel-2");
    expect(syncStates).toHaveLength(1);
    expect(syncStates[0].projectKey).toBe("QA");
    expect(persisted.sources).toHaveLength(1);
    expect(persisted.defects).toHaveLength(2);
    expect(persisted.duplicateRelations).toHaveLength(1);
    expect(persisted.syncStates).toHaveLength(1);
  });
});
