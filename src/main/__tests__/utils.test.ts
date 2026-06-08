import { describe, expect, it } from "vitest";
import { parseConfluencePageId, stripHtml } from "../services/utils";

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
});
