import React from "react";
import type { ParseConfluenceParseDebugReport } from "@shared/types";

export interface ConfluenceParseDebugProps {
  report: ParseConfluenceParseDebugReport;
}

export default function ConfluenceParseDebug({ report }: ConfluenceParseDebugProps) {
  const sectionStyle: React.CSSProperties = {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    border: "1px solid var(--outline-variant)",
    background: "var(--surface-container-low)",
  };

  const preStyle: React.CSSProperties = {
    margin: 0,
    padding: 12,
    borderRadius: 8,
    background: "var(--surface)",
    border: "1px solid var(--outline-variant)",
    maxHeight: 260,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 11,
    lineHeight: 1.55,
  };

  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--primary)" }}>
        View parse debug
      </summary>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={sectionStyle}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Summary</div>
          <div style={{ fontSize: 12, color: "var(--on-surface-variant)", lineHeight: 1.6 }}>
            <div>Page: {report.pageId}{report.pageTitle ? ` - ${report.pageTitle}` : ""}</div>
            <div>Content length: {report.contentLength}</div>
            <div>Tables found: {report.tableCount}</div>
            <div>Tables parsed: {report.parsedTableCount}</div>
            <div>Tables skipped: {report.skippedTableCount}</div>
          </div>
        </div>

        <details style={sectionStyle}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Raw page content</summary>
          <pre style={{ ...preStyle, marginTop: 10 }}>{report.rawPageContent || "(empty)"}</pre>
        </details>

        <details style={sectionStyle} open={report.unmatchedHtmlChunks.length === 0}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            Unmatched HTML chunks ({report.unmatchedHtmlChunks.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {report.unmatchedHtmlChunks.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>No unmatched HTML chunks.</div>
            ) : report.unmatchedHtmlChunks.map((chunk) => (
              <div key={chunk.index} style={{ border: "1px solid var(--outline-variant)", borderRadius: 8, padding: 10, background: "var(--surface)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{chunk.reason}</div>
                <pre style={preStyle}>{chunk.rawHtml}</pre>
              </div>
            ))}
          </div>
        </details>

        <details style={sectionStyle} open>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Tables ({report.tables.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {report.tables.map((table, index) => (
              <details key={index} style={{ border: "1px solid var(--outline-variant)", borderRadius: 8, padding: 10, background: "var(--surface)" }}>
                <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  Table {table.index + 1} {table.parsed ? "success" : "skipped"}
                </summary>
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--on-surface-variant)", lineHeight: 1.6 }}>
                  <div>Status: {table.parsed ? "Parsed" : "Skipped"}</div>
                  {table.reason && <div>Reason: {table.reason}</div>}
                  <div>Mapped fields: {table.mappedFields.length > 0 ? table.mappedFields.join(", ") : "-"}</div>
                  {table.entrySummary && (
                    <div>
                      Entry summary: {table.entrySummary.testCaseNo || "-"} | {table.entrySummary.functionName || "-"} | {table.entrySummary.result} | {table.entrySummary.imageCount} image(s)
                    </div>
                  )}
                </div>
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Raw table HTML</summary>
                  <pre style={{ ...preStyle, marginTop: 10 }}>{table.rawHtml}</pre>
                </details>
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Row mapping</summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                    {table.rows.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>No rows captured.</div>
                    ) : table.rows.map((row, rowIndex) => (
                      <div key={rowIndex} style={{ border: "1px solid var(--outline-variant)", borderRadius: 8, padding: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                          {row.label || "(missing label)"} <span style={{ color: row.status === "mapped" ? "#16a34a" : "#dc2626" }}>({row.status})</span>
                        </div>
                        {row.mappedField && <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 4 }}>Mapped field: {row.mappedField}</div>}
                        {row.reason && <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 4 }}>Reason: {row.reason}</div>}
                        {row.valuePreview && <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginTop: 4 }}>Value preview: {row.valuePreview}</div>}
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Raw row HTML</summary>
                          <pre style={{ ...preStyle, marginTop: 10 }}>{row.rawHtml}</pre>
                        </details>
                      </div>
                    ))}
                  </div>
                </details>
              </details>
            ))}
          </div>
        </details>
      </div>
    </details>
  );
}
