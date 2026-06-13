import { describe, expect, it } from "vitest";
import type { DefectRecord } from "@shared/types";
import { SearchIndex } from "../../services/defect-repository/search-index";

function makeDefect(overrides: Partial<DefectRecord>): DefectRecord {
  return {
    id: overrides.id || crypto.randomUUID(),
    sourceIssueKey: overrides.sourceIssueKey || "QA-1",
    sourceProjectKey: overrides.sourceProjectKey || "QA",
    issueType: overrides.issueType || "Bug",
    normalizedTitle: overrides.normalizedTitle || "payment timeout on checkout",
    normalizedDescription: overrides.normalizedDescription || "payment gateway timeout when submitting order",
    searchText: overrides.searchText || "payment timeout on checkout payment gateway timeout when submitting order",
    status: overrides.status || "Open",
    component: overrides.component || "Checkout",
    version: overrides.version || "1.0.0",
    severity: overrides.severity || "High",
    priority: overrides.priority || "High",
    similarityFingerprint: overrides.similarityFingerprint || "checkout::gateway::order::payment::timeout",
    createdAt: overrides.createdAt || "2026-06-12T00:00:00.000Z",
    updatedAt: overrides.updatedAt || "2026-06-12T00:00:00.000Z",
  };
}

describe("SearchIndex", () => {
  it("does not surface duplicate candidates when query is empty", () => {
    const index = new SearchIndex();
    const defect = makeDefect({});
    index.build([defect]);

    const result = index.search({ query: "" });

    expect(result.defects).toHaveLength(1);
    expect(result.candidates).toHaveLength(0);
  });

  it("assigns a non-zero score for relevant text overlap", () => {
    const index = new SearchIndex();
    const defect = makeDefect({
      sourceIssueKey: "QA-10",
      normalizedTitle: "payment timeout on checkout",
      normalizedDescription: "payment gateway timeout when submitting order",
      searchText: "payment timeout checkout gateway order submission",
      similarityFingerprint: "checkout::gateway::order::payment::timeout",
    });
    index.build([defect]);

    const result = index.search({ query: "payment timeout checkout" });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].score).toBeGreaterThan(0);
    expect(result.candidates[0].reasons.length).toBeGreaterThan(0);
  });
});
