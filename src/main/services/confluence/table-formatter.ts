import { slugify } from "../utils";

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
  const lines = text.split("\n").map((s) => s.trim());
  const parts: string[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length > 0) {
      parts.push(`<ul>${bullets.map((b) => `<li>${escapeHtmlText(b)}</li>`).join("")}</ul>`);
      bullets = [];
    }
  };

  for (const line of lines) {
    if (!line) {
      flushBullets();
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      bullets.push(line.replace(/^\s*-\s+/, ""));
    } else {
      flushBullets();
      parts.push(`<p>${escapeHtmlText(line)}</p>`);
    }
  }
  flushBullets();
  return parts.join("");
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

function generateAttachmentItems(attachments: any[]): string {
  let previousNote = "";
  return attachments
    .map((att: any) => {
      const noteHtml = att.note && att.note !== previousNote
        ? att.note
            .split("\n")
            .map((line: string) => `<p data-qa-attachment-note="true">${escapeHtmlText(line)}</p>`)
            .join("")
        : "";
      previousNote = att.note || previousNote;
      const safeName = escapeHtmlAttribute(att.name);
      const commonAttrs = `data-qa-attachment-order="${att.order}" data-qa-attachment-name="${safeName}" data-qa-attachment-note="${escapeHtmlAttribute(att.note || "")}"`;
      if (att.group) {
        const safeGroup = escapeHtmlAttribute(att.group);
        if (att.data && att.data.startsWith("data:image/")) {
          return `${noteHtml}<li ${commonAttrs} data-qa-attachment-group="${safeGroup}"><ac:image ac:height="400"><ri:attachment ri:filename="${safeName}" /></ac:image></li>`;
        }
        return `${noteHtml}<li ${commonAttrs} data-qa-attachment-group="${safeGroup}"><ac:link><ri:attachment ri:filename="${safeName}" /></ac:link></li>`;
      }
      if (att.data && att.data.startsWith("data:image/")) {
        return `${noteHtml}<li ${commonAttrs}><ac:image ac:height="400"><ri:attachment ri:filename="${safeName}" /></ac:image></li>`;
      }
      return `${noteHtml}<li ${commonAttrs}><ac:link><ri:attachment ri:filename="${safeName}" /></ac:link></li>`;
    })
    .join("");
}

function generateScreenCaptureBody(attachments: any[]): string {
  if (attachments.length === 0) return "<p>-</p>";

  const hasGroups = attachments.some((att: any) => att.group);
  if (!hasGroups) {
    return `<ol data-qa-attachments="true">${generateAttachmentItems(attachments)}</ol>`;
  }

  const parts: string[] = [];
  let currentGroup = "";
  let currentItems: any[] = [];
  const flush = () => {
    if (currentItems.length === 0) return;
    const itemsHtml = `<ol data-qa-attachments="true">${generateAttachmentItems(currentItems)}</ol>`;
    if (currentGroup) {
      parts.push(`
        <ac:structured-macro ac:name="expand" ac:schema-version="1">
          <ac:parameter ac:name="title">${escapeHtmlText(currentGroup)}</ac:parameter>
          <ac:rich-text-body>${itemsHtml}</ac:rich-text-body>
        </ac:structured-macro>`);
    } else {
      parts.push(itemsHtml);
    }
    currentItems = [];
  };

  for (const attachment of attachments) {
    const group = attachment.group || "";
    if (group !== currentGroup) {
      flush();
      currentGroup = group;
    }
    currentItems.push(attachment);
  }
  flush();
  return parts.join("");
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
    const screenCaptureTitle = orderedAttachments.some((att: any) => att.group) ? "Click here to expand..." : "Screen Capture";
    const attachmentsHtml = generateScreenCaptureBody(orderedAttachments);

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
              ${inputItems}
            </td>
          </tr>
          <tr>
            <td class="confluenceTd"><strong>Steps</strong></td>
            <td class="confluenceTd">
              ${stepsItems}
            </td>
          </tr>
          <tr>
            <td class="confluenceTd"><p><strong>Expected Result</strong></p></td>
            <td class="confluenceTd">
              ${expectedItems}
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
                <ac:parameter ac:name="title">${screenCaptureTitle}</ac:parameter>
                <ac:rich-text-body>
                  ${attachmentsHtml}
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

export function generateSectionHeading(sectionName: string): string {
  const id = `id-${slugify(sectionName)}`;
  return `<h1 id="${id}"><strong><span style="color:var(--ds-text,#172b4d);">${escapeHtmlText(sectionName)} </span></strong></h1>`;
}

export function generateTocMacro(sections: string[]): string {
  if (sections.length === 0) return "";
  const items = sections
    .map((name, i) => {
      const id = `id-${slugify(name)}`;
      return `<li><span class="toc-item-body" data-outline="${i + 1}"><span class="toc-outline">${i + 1}</span><a href="#${id}" class="toc-link">${escapeHtmlText(name)}&nbsp;</a></span></li>`;
    })
    .join("");
  return `<div class="toc-macro client-side-toc-macro conf-macro output-block hidden-outline" data-headerelements="H1,H2,H3,H4,H5,H6,H7" data-hasbody="false" data-macro-name="toc"><ul style="">${items}</ul></div>`;
}
