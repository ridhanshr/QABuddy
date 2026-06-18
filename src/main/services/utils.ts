import type { BugFormDraft, BugPreview, ExtractedTestCase } from "@shared/types";
import { sanitizeExtractedTestCase } from "@shared/types";

// ponies: Content chunking for large Confluence pages
const CHUNK_SIZE = 12000; // Reduced: leave room for prompt template (~3-4k chars) + safety margin
const MAX_OVERLAP = 300;  // Max overlap window to search for sentence boundary

export function chunkContent(text: string, maxChunkSize: number = CHUNK_SIZE): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChunkSize, text.length);

    // Try to break at paragraph boundary (\n\n) first
    if (end < text.length) {
      const lastParagraph = text.lastIndexOf("\n\n", end);
      if (lastParagraph > start + maxChunkSize * 0.5) {
        end = lastParagraph + 2; // include the newlines so next chunk starts clean
      } else {
        // Try sentence boundary (. or ? or !)
        const lastPeriod = text.lastIndexOf(". ", end);
        const lastQuestion = text.lastIndexOf("? ", end);
        const lastExclaim = text.lastIndexOf("! ", end);
        const lastSentence = Math.max(lastPeriod, lastQuestion, lastExclaim);
        if (lastSentence > start + maxChunkSize * 0.5) {
          end = lastSentence + 1; // include the punctuation, exclude the space
        }
      }
    }

    chunks.push(text.slice(start, end).trim());

    // Sentence-aware overlap: find the last sentence boundary near `end` and
    // only accept it if it falls within the overlap window, so the next chunk
    // starts at a clean sentence boundary. lastIndexOf searches leftward from
    // `end` across the entire string, but the guard `>= minOverlapPos` ensures
    // we only accept boundaries within [end - MAX_OVERLAP, end].
    if (end >= text.length) break;
    const minOverlapPos = Math.max(end - MAX_OVERLAP, start + 1);
    const lastPeriodBeforeEnd = text.lastIndexOf(". ", end);
    const lastNewlineBeforeEnd = text.lastIndexOf("\n", end);
    const sentenceBoundary = Math.max(lastPeriodBeforeEnd, lastNewlineBeforeEnd);

    if (sentenceBoundary >= minOverlapPos) {
      // Found a clean boundary inside the overlap window — start next chunk there
      start = sentenceBoundary + 1;
    } else {
      // No clean boundary inside the window — continue from end (no overlap)
      start = end;
    }
  }

  return chunks;
}

export function deduplicateTestCases(cases: ExtractedTestCase[]): ExtractedTestCase[] {
  const seen: ExtractedTestCase[] = [];
  
  for (const tc of cases) {
    const duplicate = seen.find(s => titleSimilarity(s.title, tc.title) > 0.7);
    if (duplicate) {
      // Keep the one with longer objective (more detail)
      if (tc.objective.length > duplicate.objective.length) {
        seen.splice(seen.indexOf(duplicate), 1, tc);
      }
    } else {
      seen.push(tc);
    }
  }
  
  // Re-number
  return seen.map((tc, i) => ({
    ...tc,
    id: `TC-${String(i + 1).padStart(3, "0")}`
  }));
}

function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

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
  
  // Try direct parse first
  const direct = tryJsonParse<T>(trimmed);
  if (direct) {
    return direct;
  }

  // Try to extract from markdown code blocks: ```json ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    const fromBlock = tryJsonParse<T>(codeBlockMatch[1].trim());
    if (fromBlock) {
      return fromBlock;
    }
  }

  // Try to extract JSON object — greedy match to capture the full outer object,
  // not just the first inner nested object (non-greedy would stop at the first '}')
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const objectValue = tryJsonParse<T>(objectMatch[0]);
    if (objectValue) {
      return objectValue;
    }
  }

  // Try to extract JSON array — greedy match to capture the full outer array
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const arrayValue = tryJsonParse<T>(arrayMatch[0]);
    if (arrayValue) {
      return arrayValue;
    }
  }

  // Last resort: clean trailing commas and control chars, then re-attempt greedy match
  const cleaned = trimmed
    .replace(/,\s*([}\]])/g, "$1")   // Remove trailing commas
    .replace(/[\x00-\x1F\x7F]/g, " "); // Remove control characters
  const cleanedObjectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (cleanedObjectMatch) {
    return tryJsonParse<T>(cleanedObjectMatch[0]);
  }

  // Final fallback: cleaned array
  const cleanedArrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (cleanedArrayMatch) {
    return tryJsonParse<T>(cleanedArrayMatch[0]);
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

export function validateBugPreview(raw: unknown): BugPreview | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.summary !== "string") return null;
  if (typeof obj.description !== "string") return null;
  const priority = typeof obj.priority === "string" ? obj.priority : "Medium";
  let labels: string[];
  if (Array.isArray(obj.labels)) {
    labels = obj.labels.filter((l): l is string => typeof l === "string");
  } else if (typeof obj.labels === "string") {
    labels = obj.labels.split(",").map((l) => l.trim()).filter(Boolean);
  } else {
    labels = [];
  }
  return { summary: obj.summary, description: obj.description, priority, labels };
}

export function slugify(text: string, maxLen = 30): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, maxLen)
    .replace(/-$/, "");
}

export function fallbackTestCases(
  bodyText: string,
  depth: string
): ExtractedTestCase[] {
  // ponies: deduplicated keywords, weighted categories
  const highWeightKeywords = [
    "harus", "dapat", "validasi", "error", "gagal", "berhasil",
    "must", "should", "validate", "fail", "invalid", "verify", "successful"
  ];
  const lowWeightKeywords = [
    "klik", "sistem", "menampilkan", "bisa", "tekan", "masukkan", "pengguna", "admin", "salah",
    "click", "system", "display", "user", "input", "enter", "select", "allow"
  ];

  const scoredSentences = bodyText
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 20)
    .map((sentence, index) => {
      const lower = sentence.toLowerCase();
      let score = 0;
      for (const kw of highWeightKeywords) {
        const regex = new RegExp(`\\b${kw}\\b`, "i");
        if (regex.test(lower)) {
          score += 3;
        }
      }
      for (const kw of lowWeightKeywords) {
        const regex = new RegExp(`\\b${kw}\\b`, "i");
        if (regex.test(lower)) {
          score += 1;
        }
      }
      // Position bonus: earlier sentences are more important
      score += Math.max(0, 10 - index * 0.5);
      // Length bonus: longer = more detailed requirement
      score += Math.min(sentence.length / 200, 3);
      return { sentence, score, index };
    });

  scoredSentences.sort((a, b) => b.score - a.score);

  const threshold = depth === "happy-path" ? 4 : 8;
  const selected = scoredSentences
    .filter((item) => item.score > 0)
    .slice(0, threshold);

  if (selected.length === 0) {
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

  return selected.map((item, index) => ({
    id: `TC-${String(index + 1).padStart(3, "0")}`,
    title: item.sentence.length > 72 ? `${item.sentence.slice(0, 69)}...` : item.sentence,
    objective: item.sentence,
    priority: index < 2 ? "P1" : "P2",
    category: depth === "edge-case" ? "Edge Case" : "Functional",
    selected: true,
  }));
}
