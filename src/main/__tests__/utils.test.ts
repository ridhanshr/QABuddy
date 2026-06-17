import { describe, expect, it } from "vitest";
import {
  parseConfluencePageId,
  parseConfluenceDisplayUrl,
  stripHtml,
  fallbackTestCases,
  extractJsonBlock,
  chunkContent,
  deduplicateTestCases,
} from "../services/utils";

describe("utils", () => {
  it("extracts page id from confluence pages URL", () => {
    expect(
      parseConfluencePageId("https://example.atlassian.net/wiki/spaces/QA/pages/12345678/Spec")
    ).toBe("12345678");
  });

  it("extracts page id from query string URL", () => {
    expect(parseConfluencePageId("https://example/wiki?pageId=9911")).toBe("9911");
  });

  it("strips html markup into readable text", () => {
    expect(stripHtml("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
  });

  describe("parseConfluenceDisplayUrl", () => {
    it("parses display/friendly URL with space key and title", () => {
      const result = parseConfluenceDisplayUrl("https://company.atlassian.net/wiki/display/SPACE/Page+Title");
      expect(result).toEqual({ spaceKey: "SPACE", title: "Page Title" });
    });

    it("parses display URL with encoded title characters", () => {
      const result = parseConfluenceDisplayUrl("https://confluence.example.com/display/PROJ/Feature+Requirements+v2");
      expect(result).toEqual({ spaceKey: "PROJ", title: "Feature Requirements v2" });
    });

    it("parses display URL without trailing slash", () => {
      const result = parseConfluenceDisplayUrl("https://example.com/wiki/display/TEAM/docs");
      expect(result).toEqual({ spaceKey: "TEAM", title: "docs" });
    });

    it("returns null for pages-style URL (not display)", () => {
      const result = parseConfluenceDisplayUrl("https://example.atlassian.net/wiki/spaces/QA/pages/12345678/Spec");
      expect(result).toBeNull();
    });

    it("returns null for invalid URL", () => {
      const result = parseConfluenceDisplayUrl("not-a-url");
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      const result = parseConfluenceDisplayUrl("");
      expect(result).toBeNull();
    });
  });

  describe("fallbackTestCases", () => {
    it("extracts sentences as test cases from body text and ranks by keywords", () => {
      const result = fallbackTestCases(
        "User must be able to login with valid credentials. The system must show an error for invalid passwords. Only admin role can access settings.",
        "comprehensive"
      );
      expect(result.length).toBeGreaterThanOrEqual(3);
      // The sentence with more keywords ("system", "must", "error", "invalid") ranks higher than "user must be able..."
      expect(result[0].title).toContain("The system must show an error");
      expect(result[0].priority).toBe("P1");
      expect(result[1].priority).toBe("P1");
      expect(result[2].priority).toBe("P2");
      expect(result[0].selected).toBe(true);
      
      const objectives = result.map((r) => r.objective);
      expect(objectives).toContain("User must be able to login with valid credentials.");
      expect(objectives).toContain("Only admin role can access settings.");
    });

    it("limits results for happy-path depth", () => {
      const longText = Array.from({ length: 10 }, (_, i) => `Requirement sentence number ${i + 1}.`).join(" ");
      const result = fallbackTestCases(longText, "happy-path");
      expect(result.length).toBeLessThanOrEqual(4);
    });

    it("uses Edge Case category for edge-case depth", () => {
      const result = fallbackTestCases("A requirement sentence with enough length to qualify as a test case. Another detailed requirement here.", "edge-case");
      expect(result[0].category).toBe("Edge Case");
    });

    it("returns placeholder when body text is empty", () => {
      const result = fallbackTestCases("", "comprehensive");
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Review requirement manually");
    });

    it("skips sentences shorter than 20 chars", () => {
      const result = fallbackTestCases("Short. Also short. A sufficiently long sentence that qualifies as a test case here.", "comprehensive");
      expect(result.length).toBe(1);
    });
  });

  describe("extractJsonBlock", () => {
    it("parses valid JSON directly", () => {
      const result = extractJsonBlock<{ test: string }>('{"test": "value"}');
      expect(result).toEqual({ test: "value" });
    });

    it("extracts JSON from markdown code blocks", () => {
      const input = '```json\n{"test": "value"}\n```';
      const result = extractJsonBlock<{ test: string }>(input);
      expect(result).toEqual({ test: "value" });
    });

    it("extracts JSON from text with surrounding content", () => {
      const input = 'Here is the result: {"test": "value"} hope this helps';
      const result = extractJsonBlock<{ test: string }>(input);
      expect(result).toEqual({ test: "value" });
    });

    it("handles trailing commas", () => {
      const input = '{"test": "value",}';
      const result = extractJsonBlock<{ test: string }>(input);
      expect(result).toEqual({ test: "value" });
    });

    it("returns null for invalid JSON", () => {
      const result = extractJsonBlock<{ test: string }>("not json at all");
      expect(result).toBeNull();
    });
  });

  describe("chunkContent", () => {
    it("returns single chunk for small content", () => {
      const text = "Short text";
      const result = chunkContent(text, 100);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });

    it("splits large content into multiple chunks", () => {
      const text = "A".repeat(1000);
      const result = chunkContent(text, 200);
      expect(result.length).toBeGreaterThan(1);
    });

    it("prefers paragraph boundaries for splitting", () => {
      const text = "Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.";
      const result = chunkContent(text, 20);
      expect(result.length).toBeGreaterThan(1);
      // Each chunk should start at a paragraph boundary
      result.forEach(chunk => {
        expect(chunk.startsWith("Paragraph")).toBe(true);
      });
    });
  });

  describe("deduplicateTestCases", () => {
    it("removes duplicate test cases by title similarity", () => {
      const cases = [
        { id: "TC-001", title: "Verify login with valid credentials", objective: "Test login", priority: "P1", category: "Functional", selected: true },
        { id: "TC-002", title: "Verify login with valid credentials (detailed)", objective: "Detailed test login", priority: "P1", category: "Functional", selected: true },
        { id: "TC-003", title: "Verify logout functionality", objective: "Test logout", priority: "P2", category: "Functional", selected: true },
      ];
      const result = deduplicateTestCases(cases);
      expect(result).toHaveLength(2);
      // Should keep the one with longer objective
      expect(result[0].objective).toBe("Detailed test login");
    });

    it("re-numbers test cases after deduplication", () => {
      const cases = [
        { id: "TC-001", title: "Test A", objective: "A", priority: "P1", category: "Functional", selected: true },
        { id: "TC-002", title: "Test A copy", objective: "A copy", priority: "P1", category: "Functional", selected: true },
      ];
      const result = deduplicateTestCases(cases);
      expect(result[0].id).toBe("TC-001");
      expect(result[1].id).toBe("TC-002");
    });
  });
});
