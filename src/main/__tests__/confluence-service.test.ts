import { describe, expect, it } from "vitest";
import { ConfluenceService } from "../services/confluence-service";
import { ConfluenceClient } from "../services/confluence/confluence-client";

const service = new ConfluenceService({
  baseUrl: "https://example.test/wiki",
  authMode: "bearer",
  username: "",
  token: "token",
  spaceKey: "QA",
  targetPageId: "",
  jiraServerId: "",
});

function makeEntry(testCaseNo: string, functionName: string, scenario: string) {
  return {
    id: "",
    testCaseNo,
    functionName,
    scenario,
    category: "Positive",
    inputData: "input 1",
    steps: "step 1",
    expectedResult: "expected 1",
    result: "PASS",
    images: [] as Array<{ id?: string; name: string; data: string; order?: number }>,
  };
}

describe("ConfluenceService", () => {
  it("detects jira server id from multiple storage formats", () => {
    expect(
      service.detectJiraServerId('<ac:parameter ac:name="serverId">jira-server-1</ac:parameter>')
    ).toBe("jira-server-1");

    expect(
      service.detectJiraServerId('<ri:server ri:server-id="jira-server-2" />')
    ).toBe("jira-server-2");

    expect(
      service.detectJiraServerId('<span data-jira-server-id="jira-server-3"></span>')
    ).toBe("jira-server-3");

    expect(
      service.detectJiraServerId("&lt;ac:parameter ac:name=&quot;serverId&quot;&gt;jira-server-4&lt;/ac:parameter&gt;")
    ).toBe("jira-server-4");

    expect(
      service.detectJiraServerId('{"serverId":"jira-server-5"}')
    ).toBe("jira-server-5");
  });

  it("returns parse status when page content cannot be fetched", async () => {
    const brokenService = new ConfluenceService({
      baseUrl: "https://example.test/wiki",
      authMode: "bearer",
      username: "",
      token: "token",
      spaceKey: "QA",
      targetPageId: "",
      jiraServerId: "",
    });

    brokenService.getPage = async () => {
      throw new Error("404 Not Found");
    };

    const result = await brokenService.parseEntriesFromPage("12345");

    expect(result.pageId).toBe("12345");
    expect(result.pageTitle).toBe("");
    expect(result.contentLoaded).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.error).toContain("404 Not Found");
  });

  it("parses qa tables with stable source metadata", () => {
    const content = [
      "<p>Intro</p>",
      service.generateXhtmlTable([makeEntry("TC-001", "Login", "AUTH-1")]),
      "<p>separator</p>",
      service.generateXhtmlTable([makeEntry("TC-002", "Transfer", "AUTH-2")]),
    ].join("\n");

    const entries = service.parseEntriesFromContent(content);

    expect(entries).toHaveLength(2);
    expect(entries[0].sourceTableIndex).toBe(0);
    expect(entries[1].sourceTableIndex).toBe(1);
    expect(entries[0].isDirty).toBe(false);
    expect(entries[0].sourceTableHtml).toContain("TC-001");
  });

  it("preserves attachment order in generated and parsed table content", () => {
    const entry = makeEntry("TC-010", "Attachment Order", "AUTH-10");
    entry.images = [
      { id: "att-2", name: "second.png", data: "data:image/png;base64,BBB", order: 2 },
      { id: "att-1", name: "first.png", data: "data:image/png;base64,AAA", order: 1 },
      { id: "att-3", name: "third.pdf", data: "data:application/pdf;base64,CCC", order: 3 },
    ];

    const html = service.generateXhtmlTable([entry]);
    const parsed = service.parseEntriesFromContent(html);

    expect(html.indexOf("first.png")).toBeLessThan(html.indexOf("second.png"));
    expect(html.indexOf("second.png")).toBeLessThan(html.indexOf("third.pdf"));
    expect(parsed[0].images.map((image: any) => image.name)).toEqual(["first.png", "second.png", "third.pdf"]);
    expect(parsed[0].images.map((image: any) => image.order)).toEqual([1, 2, 3]);
  });

  it("preserves duplicate attachment filenames as separate ordered items", () => {
    const entry = makeEntry("TC-011", "Duplicate Attachment Names", "AUTH-11");
    entry.images = [
      { id: "dup-1", name: "evidence.png", data: "data:image/png;base64,AAA", order: 1 },
      { id: "dup-2", name: "evidence.png", data: "data:image/png;base64,BBB", order: 2 },
    ];

    const html = service.generateXhtmlTable([entry]);
    const parsed = service.parseEntriesFromContent(html);

    expect(parsed[0].images).toHaveLength(2);
    expect(parsed[0].images.map((image: any) => image.name)).toEqual(["evidence.png", "evidence.png"]);
    expect(parsed[0].images.map((image: any) => image.order)).toEqual([1, 2]);
  });

  it("parses tables whose tr tags contain attributes", () => {
    const html = `<table class="relative-table confluenceTable" style="width: 96.3463%;"><colgroup class=""> <col class="" style="width: 14.5803%;"> <col class="" style="width: 85.4197%;"> </colgroup><tbody class=""><tr class=""><td class="confluenceTd"><strong>No. Test Case</strong></td><td class="confluenceTd">TC002</td></tr><tr class=""><td class="confluenceTd"><strong>Function</strong></td><td class="confluenceTd">Login Edit 3</td></tr><tr class=""><td class="confluenceTd"><strong>Scenario</strong></td><td class="confluenceTd"><p>Scenario Login</p></td></tr><tr class=""><td class="confluenceTd"><strong>Kategori</strong></td><td class="confluenceTd">Positive</td></tr><tr class=""><td class="confluenceTd"><strong>Input Data</strong></td><td class="confluenceTd"><ol><li data-uuid="2a815361-341f-47cc-8003-c1d8ca7f0949">test edit</li></ol></td></tr><tr class=""><td class="confluenceTd"><strong>Steps</strong></td><td class="confluenceTd"><ol><li data-uuid="afd9878d-ef71-4de3-8bf3-0af60b11cd96">1. Oke</li><li data-uuid="b0968f9f-7e37-4318-a88d-68a0551a13b9">2. Yes</li></ol></td></tr><tr class=""><td class="confluenceTd"><p><strong>Expected Result</strong></p></td><td class="confluenceTd"><ol><li data-uuid="8f6faddb-e204-401c-98d3-06458ccb7c3c">Oke</li></ol></td></tr><tr class=""><td class="confluenceTd"><p><strong>Result</strong></p></td><td class="confluenceTd">Passed</td></tr><tr class=""><td class="confluenceTd"><p><strong>Screen Capture</strong></p></td><td class="confluenceTd"><div class="content-wrapper"><div id="expander-1330776940" class="expand-container conf-macro output-block" data-hasbody="true" data-macro-name="expand"><div id="expander-control-1330776940" class="expand-control"><button type="button" id="expand-button-1330776940" class="aui-button aui-button-link aui-button-link-icon-text" aria-expanded="false" aria-controls="expander-content-1330776940" resolved=""><span class="expand-icon aui-icon aui-icon-small aui-iconfont-chevron-right" aria-hidden="true"></span><span class="expand-control-text conf-macro-render">Screen Capture</span></button></div><div role="region" id="expander-content-1330776940" class="expand-content expand-hidden" aria-labelledby="expand-button-1330776940"><p><a href="/download/attachments/1726972884/SOP%20-%20OCLIVE-355%20-%20Total%20balance%200%20namun%20status%20collect%20terisi%20-%20v1.docx?version=1&amp;modificationDate=1779170121141&amp;api=v2" data-linked-resource-id="1776202332" data-linked-resource-version="1" data-linked-resource-type="attachment" data-linked-resource-default-alias="SOP - OCLIVE-355 - Total balance 0 namun status collect terisi - v1.docx" data-nice-type="Word Document" data-linked-resource-content-type="application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-linked-resource-container-id="1726972884" data-linked-resource-container-version="24">SOP - OCLIVE-355 - Total balance 0 namun status collect terisi - v1.docx</a></p></div></div></div></td></tr></tbody></table>`;

    const parsed = service.parseEntriesFromContent(html);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].testCaseNo).toBe("TC002");
    expect(parsed[0].functionName).toBe("Login Edit 3");
    expect(parsed[0].scenario).toBe("Scenario Login");
    expect(parsed[0].inputData).toBe("test edit");
    expect(parsed[0].steps).toBe("1. Oke\n2. Yes");
    expect(parsed[0].expectedResult).toBe("Oke");
    expect(parsed[0].images).toHaveLength(1);
  });

  it("preserves ordered list metadata for sync back to Confluence", () => {
    const html = `<table><tbody>
      <tr><td><strong>No. Test Case</strong></td><td>TC901</td></tr>
      <tr><td><strong>Function</strong></td><td>Ordered Lists</td></tr>
      <tr><td><strong>Input Data</strong></td><td><ol><li>Alpha</li><li>Beta</li></ol></td></tr>
      <tr><td><strong>Steps</strong></td><td><ol><li>Login portal MSS</li><li>Lakukan pengajuan LOA</li></ol></td></tr>
      <tr><td><strong>Expected Result</strong></td><td><ol><li>Data lolos validasi 1</li><li>Data pengajuan auto terapprove</li></ol></td></tr>
    </tbody></table>`;

    const parsed = service.parseEntriesFromContent(html);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].inputDataFormat).toBe("ordered");
    expect(parsed[0].stepsFormat).toBe("ordered");
    expect(parsed[0].expectedResultFormat).toBe("ordered");

    const regenerated = service.generateXhtmlTable(parsed);
    const compact = regenerated.replace(/\s+/g, " ");

    expect(compact).toContain("<td class=\"confluenceTd\"> <ol><li>Alpha</li><li>Beta</li></ol> </td>");
    expect(compact).toContain("<td class=\"confluenceTd\"> <ol><li>Login portal MSS</li><li>Lakukan pengajuan LOA</li></ol> </td>");
    expect(compact).toContain("<td class=\"confluenceTd\"> <ol><li>Data lolos validasi 1</li><li>Data pengajuan auto terapprove</li></ol> </td>");
  });

  it("parses steps and expected result even when another cell contains a nested table", () => {
    const html = `
      <table class="wrapped confluenceTable">
        <tbody>
          <tr><td><strong>No. Test Case</strong></td><td>TC900</td></tr>
          <tr><td><strong>Function</strong></td><td>Nested Table Case</td></tr>
          <tr>
            <td><strong>Input Data</strong></td>
            <td>
              <div class="table-wrap">
                <table class="wrapped confluenceTable">
                  <tbody>
                    <tr><td>Inner A</td></tr>
                    <tr><td>Inner B</td></tr>
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
          <tr>
            <td><strong>Steps</strong></td>
            <td><ol><li>Login portal MSS</li><li>Lakukan pengajuan LOA</li></ol></td>
          </tr>
          <tr>
            <td><strong>Expected Result</strong></td>
            <td><ol><li>Data lolos validasi 1 dan validasi 2</li><li>Data pengajuan auto terapprove</li></ol></td>
          </tr>
        </tbody>
      </table>`;

    const parsed = service.parseEntriesFromContent(html);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].testCaseNo).toBe("TC900");
    expect(parsed[0].steps).toBe("Login portal MSS\nLakukan pengajuan LOA");
    expect(parsed[0].expectedResult).toBe("Data lolos validasi 1 dan validasi 2\nData pengajuan auto terapprove");
  });

  it("parses screen capture notes that appear before attachments", () => {
    const html = `<table><tbody><tr><td><strong>No. Test Case</strong></td><td>TC100</td></tr><tr><td><strong>Function</strong></td><td>Attachment Notes</td></tr><tr><td><p><strong>Screen Capture</strong></p></td><td><div class="content-wrapper"><div class="expand-content"><ul><li data-uuid="1">Before update credit limit (MC)</li></ul><p><span><img data-linked-resource-default-alias="image-1.png" /></span></p><p>VISA</p><p><span><img data-linked-resource-default-alias="image-2.png" /></span></p><p><em>*File EDW Batch SDGCRD</em></p><p><span><a data-file-src="/download/attachments/x/SDGCRD_20260507.txt">file</a></span></p></div></div></td></tr></tbody></table>`;

    const parsed = service.parseEntriesFromContent(html);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].images).toHaveLength(3);
    expect(parsed[0].images[0].note).toBe("Before update credit limit (MC)");
    expect(parsed[0].images[1].note).toBe("VISA");
    expect(parsed[0].images[2].note).toBe("*File EDW Batch SDGCRD");
  });

  it("does not carry previous note to an image that has no note", () => {
    const html = `<table><tbody><tr><td><strong>No. Test Case</strong></td><td>TC101</td></tr><tr><td><strong>Function</strong></td><td>Attachment Notes Reset</td></tr><tr><td><p><strong>Screen Capture</strong></p></td><td><div class="content-wrapper"><div class="expand-content"><div class="expand-container" data-macro-name="expand"><span class="expand-control-text conf-macro-render">Portal BRICC</span><div class="expand-content"><ol><li>Login Portal BRICC<br><span><img data-linked-resource-default-alias="image-1.png" /></span></li><li><span><img data-linked-resource-default-alias="image-2.png" /></span></li></ol></div></div></div></div></td></tr></tbody></table>`;

    const parsed = service.parseEntriesFromContent(html);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].images).toHaveLength(2);
    expect(parsed[0].images[0].note).toBe("Login Portal BRICC");
    expect(parsed[0].images[1].note).toBe("");
  });

  it("replaces only the edited table when merging back to storage content", () => {
    const originalFirst = makeEntry("TC-001", "Login", "AUTH-1");
    const originalSecond = makeEntry("TC-002", "Transfer", "AUTH-2");
    const content = [
      "<p>Intro</p>",
      service.generateXhtmlTable([originalFirst]),
      "<p>separator</p>",
      service.generateXhtmlTable([originalSecond]),
      "<p>Footer</p>",
    ].join("\n");

    const parsedEntries = service.parseEntriesFromContent(content);
    const editedSecond = {
      ...parsedEntries[1],
      functionName: "Transfer Limit",
      scenario: "AUTH-22",
      isDirty: true,
    };

    const merged = (service as any).mergeEntriesIntoContent(content, [editedSecond]);

    expect(merged.replacedCount).toBe(1);
    expect(merged.appendedCount).toBe(0);
    expect(merged.content).toContain("Login");
    expect(merged.content).toContain("Transfer Limit");
    expect(merged.content).toContain("AUTH-22");
    expect(merged.content).not.toContain("<td class=\"confluenceTd\">Transfer</td>");
    expect(merged.content).toContain("<p>Footer</p>");
    expect(merged.content).not.toContain("Generated by QA Buddy");
  });

  it("removes deleted tables from storage content", () => {
    const first = makeEntry("TC-001", "Login", "AUTH-1");
    const second = makeEntry("TC-002", "Transfer", "AUTH-2");
    const content = [
      "<p>Intro</p>",
      service.generateXhtmlTable([first]),
      "<p>separator</p>",
      service.generateXhtmlTable([second]),
      "<p>Footer</p>",
    ].join("\n");

    const merged = (service as any).mergeEntriesIntoContent(content, [], void 0, void 0, [0]);

    expect(merged.deletedCount).toBe(1);
    expect(merged.content).not.toContain("TC-001");
    expect(merged.content).toContain("TC-002");
    expect(merged.content).toContain("<p>Footer</p>");
  });

  it("strips legacy generated markers from existing content before merge", () => {
    const first = makeEntry("TC-001", "Login", "AUTH-1");
    const content = [
      "<p>Generated by QA Buddy - 19/5/2026, 13.40.05</p>",
      service.generateXhtmlTable([first]),
      "<p>Generated by QA Buddy — 19/5/2026, 13.08.45</p>",
    ].join("\n");

    const merged = (service as any).mergeEntriesIntoContent(content, []);

    expect(merged.content).not.toContain("Generated by QA Buddy");
    expect(merged.content).toContain("TC-001");
  });

  it("collapses excessive empty paragraphs between tables", () => {
    const first = makeEntry("TC-001", "Login", "AUTH-1");
    const second = makeEntry("TC-002", "Transfer", "AUTH-2");
    const content = [
      service.generateXhtmlTable([first]),
      "<p><br /></p>",
      "<p>&nbsp;</p>",
      "<p><br /></p>",
      service.generateXhtmlTable([second]),
    ].join("\n");

    const merged = (service as any).mergeEntriesIntoContent(content, []);
    const separators = merged.content.match(/<p><br \/><\/p>/g) || [];

    expect(separators.length).toBeLessThanOrEqual(2);
    expect(merged.content).toContain("TC-001");
    expect(merged.content).toContain("TC-002");
  });

  it("extracts jira server id from applinks payloads", () => {
    const client = new ConfluenceClient({
      baseUrl: "https://example.test/wiki",
      authMode: "bearer",
      username: "",
      token: "token",
      spaceKey: "QA",
      targetPageId: "",
      jiraServerId: "",
    });

    expect(
      client.extractJiraServerIdFromAppLinksResponse([
        { id: "conf-1", type: "confluence" },
        { id: "jira-123", type: "jira" },
      ])
    ).toBe("jira-123");

    expect(
      client.extractJiraServerIdFromAppLinksResponse(`
        <list>
          <application>
            <id>conf-1</id>
            <typeId>confluence</typeId>
          </application>
          <application>
            <id>jira-456</id>
            <typeId>jira</typeId>
          </application>
        </list>
      `)
    ).toBe("jira-456");
  });
});
