import { describe, expect, it } from "vitest";
import {
  parseConfluencePageId,
  parseConfluenceDisplayUrl,
  stripHtml,
  fallbackTestCases,
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
    it("extracts sentences as test cases from body text", () => {
      const result = fallbackTestCases(
        "User must be able to login with valid credentials. The system must show an error for invalid passwords. Only admin role can access settings.",
        "comprehensive"
      );
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result[0].title).toContain("User must be able to login");
      expect(result[0].priority).toBe("P1");
      expect(result[1].priority).toBe("P1");
      expect(result[2].priority).toBe("P2");
      expect(result[0].selected).toBe(true);
      expect(result[0].category).toBe("Functional");
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
});
