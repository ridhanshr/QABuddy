import type { IntentClassification, IntentRoute } from "@shared/types";

const JIRA_KEYWORDS = [
  "tiket", "ticket", "issue", "bug", "task", "story", "epic",
  "status", "priority", "prioritas", "assignee", "reporter",
  "sprint", "jql", "open", "closed", "resolve", "in progress",
  "ready for qa", "done", "to do", "backlog", "in analyze",
];

const STATUS_KEYWORDS = [
  "in progress", "open", "closed", "done", "to do",
  "ready for qa", "resolved", "reopened", "blocked",
  "in review", "in analysis", "in testing", "ready for review",
];

const CONFLUENCE_KEYWORDS = [
  "dokumen", "document", "dokumentasi", "documentation",
  "halaman", "page", "confluence", "knowledge base",
  "sop", "requirement", "acceptance criteria",
  "ringkasan", "summary", "jelaskan", "explain",
  "penjelasan", "panduan", "guide", "wiki",
];

const MIXED_INDICATORS = [
  " dan ", " & ", " serta ", " plus ",
  "gabung", "combined", "hybrid",
  "tiket.*dokumentasi", "dokumentasi.*tiket",
  "both", "all",
];

export class IntentRouter {
  classify(query: string): IntentClassification {
    const lower = query.toLowerCase().trim();

    if (!lower) {
      return { route: "clarify", confidence: 0, reason: "Query kosong", detectedKeywords: [] };
    }

    const detectedKeywords: string[] = [];
    let jiraScore = 0;
    let confluenceScore = 0;

    for (const kw of JIRA_KEYWORDS) {
      if (lower.includes(kw)) {
        jiraScore += 2;
        detectedKeywords.push(kw);
      }
    }

    for (const kw of STATUS_KEYWORDS) {
      if (lower.includes(kw)) {
        jiraScore += 3;
        if (!detectedKeywords.includes(kw)) detectedKeywords.push(kw);
      }
    }

    const explicitJiraRef = /(?:cari|tampilkan|list|daftar|cek)\w*\s+.*(?:jql|tiket|ticket|issue|bug|jira)/i.test(lower);
    if (explicitJiraRef) jiraScore += 5;

    const hasIssueKey = /[A-Z]{2,}-\d{1,9}/.test(lower);
    if (hasIssueKey) jiraScore += 5;

    for (const kw of CONFLUENCE_KEYWORDS) {
      if (lower.includes(kw)) {
        confluenceScore += 2;
        if (!detectedKeywords.includes(kw)) detectedKeywords.push(kw);
      }
    }

    const confluenceUrl = /\/wiki\/|confluence\./i.test(lower);
    if (confluenceUrl) confluenceScore += 5;

    const statusHint = this.extractStatusHint(lower);
    const projectKey = this.extractProjectKey(lower);

    let route: IntentRoute;
    let reason: string;
    let confidence: number;

    const isMixed = MIXED_INDICATORS.some((ind) => new RegExp(ind, "i").test(lower));

    if (isMixed && jiraScore >= 2 && confluenceScore >= 2) {
      route = "mixed";
      confidence = Math.min((jiraScore + confluenceScore) / 15, 1);
      reason = "Mixed intent: both Jira and Confluence keywords detected";
    } else if (jiraScore > confluenceScore) {
      route = "jira";
      confidence = Math.min(jiraScore / 12, 1);
      reason = `Jira-dominant: detected ${detectedKeywords.slice(0, 4).join(", ")}`;
    } else if (confluenceScore > jiraScore) {
      route = "confluence";
      confidence = Math.min(confluenceScore / 12, 1);
      reason = `Confluence-dominant: detected ${detectedKeywords.slice(0, 4).join(", ")}`;
    } else if (jiraScore > 0 && jiraScore === confluenceScore) {
      route = "mixed";
      confidence = 0.5;
      reason = "Equal Jira and Confluence signals";
    } else {
      route = "clarify";
      confidence = 0;
      reason = "No clear Jira or Confluence intent detected, need clarification";
    }

    return { route, confidence, reason, detectedKeywords, projectKey, statusHint };
  }

  private extractStatusHint(lower: string): string | undefined {
    for (const st of STATUS_KEYWORDS) {
      if (lower.includes(st)) return st;
    }
    const statusAfter = lower.match(/(?:status|tiket)\s+(\w+(?:\s+\w+){0,2})/i);
    if (statusAfter) return statusAfter[1].trim();
    return undefined;
  }

  private extractProjectKey(lower: string): string | undefined {
    const match = lower.match(/project\s*['"]?([A-Z0-9]{2,10})['"]?/i);
    if (match) return match[1].toUpperCase();
    return undefined;
  }

  isJiraIntent(query: string): boolean {
    return this.classify(query).route === "jira";
  }

  isConfluenceIntent(query: string): boolean {
    return this.classify(query).route === "confluence";
  }

  needsClarification(query: string): boolean {
    return this.classify(query).route === "clarify";
  }
}
