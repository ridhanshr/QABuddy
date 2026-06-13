import { describe, expect, it } from "vitest";
import type { DefectRecord, DuplicateRelation } from "@shared/types";
import { DefectReportingService } from "../../services/defect-repository/defect-reporting-service";

function makeDefect(overrides: Partial<DefectRecord>): DefectRecord {
  return {
    id: overrides.id || crypto.randomUUID(),
    sourceIssueKey: overrides.sourceIssueKey || "QA-1",
    sourceProjectKey: overrides.sourceProjectKey || "QA",
    issueType: overrides.issueType || "Bug",
    normalizedTitle: overrides.normalizedTitle || "title",
    normalizedDescription: overrides.normalizedDescription || "description",
    searchText: overrides.searchText || "title description",
    status: overrides.status || "Open",
    component: overrides.component || "Checkout",
    version: overrides.version || "1.0.0",
    severity: overrides.severity || "High",
    priority: overrides.priority || "High",
    similarityFingerprint: overrides.similarityFingerprint || "checkout::payment",
    createdAt: overrides.createdAt || "2026-06-12T00:00:00.000Z",
    updatedAt: overrides.updatedAt || "2026-06-12T00:00:00.000Z",
  };
}

describe("DefectReportingService", () => {
  it("computes project and duplicate stats from cleaned records", () => {
    const service = new DefectReportingService();
    const defects = [
      makeDefect({ id: "defect-1", sourceProjectKey: "QA", sourceIssueKey: "QA-1", component: "Checkout, Cart" }),
      makeDefect({ id: "defect-2", sourceProjectKey: "QA", sourceIssueKey: "QA-2", component: "Checkout" }),
      makeDefect({ id: "defect-3", sourceProjectKey: "WEB", sourceIssueKey: "WEB-1", component: "Cart" }),
    ];
    const relations: DuplicateRelation[] = [
      {
        id: "rel-1",
        primaryDefectId: "defect-1",
        duplicateDefectId: "defect-2",
        reason: "manual",
        confidenceScore: 90,
        createdBy: "tester",
        createdAt: "2026-06-12T00:00:00.000Z",
      },
      {
        id: "rel-2",
        primaryDefectId: "defect-2",
        duplicateDefectId: "defect-3",
        reason: "manual",
        confidenceScore: 80,
        createdBy: "tester",
        createdAt: "2026-06-12T01:00:00.000Z",
      },
    ];

    const stats = service.computeStats(defects, relations);

    expect(stats.totalDefects).toBe(3);
    expect(stats.totalDuplicates).toBe(2);
    expect(stats.defectsPerProject).toEqual([
      { projectKey: "QA", count: 2 },
      { projectKey: "WEB", count: 1 },
    ]);
    expect(stats.duplicatesPerProject).toEqual([
      { projectKey: "QA", count: 2 },
      { projectKey: "WEB", count: 1 },
    ]);
    expect(stats.topComponents).toEqual([
      { component: "Checkout", count: 2 },
      { component: "Cart", count: 2 },
    ]);
    expect(stats.topIssueTypes).toEqual([{ issueType: "Bug", count: 3 }]);
  });
});
