import type { BugFormDraft, BugPreview, ExtractedTestCase } from "@shared/types";

export function normalizeUrl(value: string): string {
  let url = value.trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  if (url.includes("://localhost")) {
    url = url.replace("://localhost", "://127.0.0.1");
  }
  return url;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractJsonBlock<T>(value: string): T | null {
  const trimmed = value.trim();
  const direct = tryJsonParse<T>(trimmed);
  if (direct) {
    return direct;
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const objectValue = tryJsonParse<T>(objectMatch[0]);
    if (objectValue) {
      return objectValue;
    }
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return tryJsonParse<T>(arrayMatch[0]);
  }

  return null;
}

function tryJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function extractJiraIssueKeys(text: string): string[] {
  const matches = text.match(/([A-Z]{2,}-\d{1,9})/g);
  return matches || [];
}

export function parseConfluencePageId(url: string): string | null {
  // Pattern 1: /pages/123456
  const pagesMatch = url.match(/\/pages\/(\d+)/i);
  if (pagesMatch) {
    return pagesMatch[1];
  }

  // Pattern 2: ?pageId=123456 or &pageId=123456
  const queryMatch = url.match(/[?&]pageId=(\d+)/i);
  if (queryMatch) {
    return queryMatch[1];
  }

  // Pattern 3: at the end of the URL (e.g. .../pages/123456)
  const trailingMatch = url.match(/\/(\d+)$/);
  if (trailingMatch) {
    return trailingMatch[1];
  }

  return null;
}

export function parseConfluenceDisplayUrl(url: string): { spaceKey: string; title: string } | null {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    const segments = pathname.split("/").filter(Boolean);
    const displayIndex = segments.indexOf("display");

    if (displayIndex !== -1 && segments.length >= displayIndex + 2) {
      const title = decodeURIComponent(segments[segments.length - 1].replace(/\+/g, " "));
      const spaceKey = segments[segments.length - 2];
      return { spaceKey, title };
    }
  } catch {
    return null;
  }
  return null;
}

export function fallbackBugPreview(draft: BugFormDraft): BugPreview {
  const summary = draft.title.trim() || "Untitled bug report";
  const labels = draft.labels
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const description = [
    `Environment: ${draft.environment || "-"}`,
    "",
    "Steps to Reproduce:",
    draft.stepsToReproduce || "-",
    "",
    "Actual Result:",
    draft.actualResult || "-",
    "",
    "Expected Result:",
    draft.expectedResult || "-",
  ].join("\n");

  return {
    summary,
    description,
    priority: draft.priority || "Medium",
    labels,
  };
}

export function fallbackTestCases(
  bodyText: string,
  depth: string
): ExtractedTestCase[] {
  const sentences = bodyText
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 20)
    .slice(0, depth === "happy-path" ? 4 : 8);

  if (sentences.length === 0) {
    return [
      {
        id: "TC-001",
        title: "Review requirement manually",
        objective: "No structured requirement text was found. Review the linked Confluence page.",
        priority: "P2",
        category: "Manual Review",
        selected: true,
      },
    ];
  }

  return sentences.map((sentence, index) => ({
    id: `TC-${String(index + 1).padStart(3, "0")}`,
    title: sentence.slice(0, 72),
    objective: sentence,
    priority: index < 2 ? "P1" : "P2",
    category: depth === "edge-case" ? "Edge Case" : "Functional",
    selected: index < 5,
  }));
}
