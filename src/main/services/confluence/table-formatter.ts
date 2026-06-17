export function normalizeAttachmentOrder<T extends { order?: number; name: string; data: string }>(attachments: T[]): T[] {
  return [...attachments]
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((attachment, index) => ({
      ...attachment,
      order: index + 1,
    }));
}

export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function toListItems(text: string): string {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s)
    .map((s) => `<li>${escapeHtmlText(s)}</li>`)
    .join("");
}

export function linkifyJiraKeys(text: string, jiraBaseUrl?: string, jiraServerId?: string): string {
  if (!text) return text;
  const baseUrl = jiraBaseUrl?.replace(/\/+$/, "");
  return text.replace(
    /(?<![A-Za-z0-9])([A-Z][A-Z0-9]+-\d+)(?![A-Za-z0-9-])/g,
    (match) => {
      if (baseUrl && jiraServerId) {
        return `<ac:structured-macro ac:name="jira" ac:schema-version="1">
  <ac:parameter ac:name="serverId">${jiraServerId}</ac:parameter>
  <ac:parameter ac:name="key">${match}</ac:parameter>
</ac:structured-macro>`;
      }
      if (baseUrl) {
        return `<ac:link><ri:url ri:value="${baseUrl}/browse/${match}" /><ac:plain-text-link-body><![CDATA[${match}]]></ac:plain-text-link-body></ac:link>`;
      }
      return match;
    }
  );
}

export function generateXhtmlTable(entries: any[], jiraBaseUrl?: string, jiraServerId?: string): string {
  const tables: string[] = [];
  for (const entry of entries) {
    const safeTestCaseNo = escapeHtmlText(entry.testCaseNo);
    const safeFunctionName = escapeHtmlText(entry.functionName);
    const safeCategory = escapeHtmlText(entry.category);
    const safeScenario = escapeHtmlText(entry.scenario);
    const inputItems = toListItems(entry.inputData);
    const stepsItems = toListItems(entry.steps);
    const expectedItems = toListItems(entry.expectedResult);
    const scenarioLinked = linkifyJiraKeys(safeScenario, jiraBaseUrl, jiraServerId);

    const orderedAttachments = normalizeAttachmentOrder(entry.images || []);
    let previousNote = "";
    const attachmentsHtml = orderedAttachments
      .map((att: any) => {
        const noteHtml = att.note && att.note !== previousNote
          ? att.note
              .split("\n")
              .map((line: string) => `<p data-qa-attachment-note="true">${escapeHtmlText(line)}</p>`)
              .join("")
          : "";
        previousNote = att.note || previousNote;
        const safeName = escapeHtmlAttribute(att.name);
        if (att.data && att.data.startsWith("data:image/")) {
          return `${noteHtml}<li data-qa-attachment-order="${att.order}" data-qa-attachment-name="${safeName}" data-qa-attachment-note="${escapeHtmlAttribute(att.note || "")}"><ac:image ac:height="400"><ri:attachment ri:filename="${safeName}" /></ac:image></li>`;
        }
        return `${noteHtml}<li data-qa-attachment-order="${att.order}" data-qa-attachment-name="${safeName}" data-qa-attachment-note="${escapeHtmlAttribute(att.note || "")}"><ac:link><ri:attachment ri:filename="${safeName}" /></ac:link></li>`;
      })
      .join("");

    const kategoriRow = safeCategory
      ? `
        <tr>
          <td class="confluenceTd"><strong>Kategori</strong></td>
          <td class="confluenceTd">${safeCategory}</td>
        </tr>`
      : "";

    tables.push(`
      <table class="relative-table wrapped confluenceTable" style="width: 96.3463%">
        <colgroup>
          <col style="width: 14.5803%" />
          <col style="width: 85.4197%" />
        </colgroup>
        <tbody>
          <tr>
            <td class="confluenceTd"><strong>No. Test Case</strong></td>
            <td class="confluenceTd">${safeTestCaseNo}</td>
          </tr>
          <tr>
            <td class="confluenceTd"><strong>Function</strong></td>
            <td class="confluenceTd">${safeFunctionName}</td>
          </tr>
          <tr>
            <td class="confluenceTd"><strong>Scenario</strong></td>
            <td class="confluenceTd"><p>${scenarioLinked}</p></td>
          </tr>
          ${kategoriRow}
          <tr>
            <td class="confluenceTd"><strong>Input Data</strong></td>
            <td class="confluenceTd">
              <ol>${inputItems}</ol>
            </td>
          </tr>
          <tr>
            <td class="confluenceTd"><strong>Steps</strong></td>
            <td class="confluenceTd">
              <ol>${stepsItems}</ol>
            </td>
          </tr>
          <tr>
            <td class="confluenceTd"><p><strong>Expected Result</strong></p></td>
            <td class="confluenceTd">
              <ol>${expectedItems}</ol>
            </td>
          </tr>
          <tr>
            <td class="confluenceTd"><p><strong>Result</strong></p></td>
            <td class="confluenceTd">${entry.result === "PASS" ? "Passed" : "Failed"}</td>
          </tr>
          <tr>
            <td class="confluenceTd"><p><strong>Screen Capture</strong></p></td>
            <td class="confluenceTd">
              <ac:structured-macro ac:name="expand" ac:schema-version="1">
                <ac:parameter ac:name="title">Screen Capture</ac:parameter>
                <ac:rich-text-body>
                  ${attachmentsHtml ? `<ol data-qa-attachments="true">${attachmentsHtml}</ol>` : "<p>-</p>"}
                </ac:rich-text-body>
              </ac:structured-macro>
            </td>
          </tr>
        </tbody>
      </table>`);
  }
  return tables.join("\n<p><br /></p>\n");
}

export function generateSingleTable(entry: any, jiraBaseUrl?: string, jiraServerId?: string): string {
  return generateXhtmlTable([entry], jiraBaseUrl, jiraServerId).trim();
}
