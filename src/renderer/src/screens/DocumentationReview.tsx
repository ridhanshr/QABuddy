import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import type { DocumentReviewSummary, ReviewFinding } from "@shared/types";

const statusColor: Record<string, string> = {
  PASS: "var(--success)",
  WARNING: "var(--warning)",
  FAIL: "var(--error)",
  NOT_APPLICABLE: "var(--font-disabled)",
};

function triggerDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function FindingCard({ finding }: { finding: ReviewFinding }) {
  const color = statusColor[finding.status] ?? "var(--on-surface-variant)";
  return (
    <article className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{
          color, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.06em",
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          padding: "2px 8px", borderRadius: 999, textTransform: "uppercase",
        }}>{finding.status}</span>
        <span style={{ color: "var(--on-surface-variant)", fontSize: 12, paddingLeft: 8, borderLeft: "1px solid var(--outline-variant)" }}>{finding.section}</span>
        {finding.sourceKey ? <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--on-surface-variant)" }}>{finding.sourceKey}</span> : null}
      </div>
      <h3 style={{ margin: "0 0 6px", fontSize: 14.5 }}>{finding.title}</h3>
      <p style={{ margin: "0 0 8px", color: "var(--on-surface-variant)", lineHeight: 1.5, whiteSpace: "pre-line", fontSize: 13.5 }}>{finding.description}</p>
      {(finding.validationSource || typeof finding.confidence === "number" || finding.evidence) ? (
        <div style={{ margin: "0 0 8px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", color: "var(--on-surface-variant)", fontSize: 12 }}>
          {finding.validationSource ? <span>Source: {finding.validationSource}</span> : null}
          {typeof finding.confidence === "number" ? <span>Confidence: {Math.round(finding.confidence * 100)}%</span> : null}
          {finding.evidence ? <span style={{ flexBasis: "100%", whiteSpace: "pre-line" }}>Evidence: {finding.evidence}</span> : null}
        </div>
      ) : null}
      {finding.recommendation ? (
        <p style={{ margin: 0, fontSize: 13 }}><strong>Recommendation:</strong> {finding.recommendation}</p>
      ) : null}
      {finding.sourceUrl ? (
        <button type="button" className="link-button" style={{ padding: 0, marginTop: 10 }} onClick={() => window.qaBuddy.openExternal(finding.sourceUrl!)}>
          Open source page
        </button>
      ) : null}
    </article>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: tone }}>{value}</div>
    </div>
  );
}

export default function DocumentationReview() {
  const { loading, activeView } = useApp();
  const [pageId, setPageId] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [result, setResult] = useState<DocumentReviewSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<{ current: number; total: number } | null>(null);
  const [liveFindings, setLiveFindings] = useState<ReviewFinding[]>([]);

  useEffect(() => {
    return window.qaBuddy.onDocumentReviewProgress((progress) => {
      if (progress.stage === "finding") {
        if (progress.finding) setLiveFindings((prev) => [...prev, progress.finding!]);
        return;
      }
      setProgressMessage(progress.message);
      if (progress.total > 0) setProgressStep({ current: progress.current, total: progress.total });
    });
  }, []);

  if (loading || activeView !== "document-review") return null;

  const runReview = async () => {
    const value = pageId.trim();
    if (!value) {
      setError("Masukkan Confluence Page ID.");
      return;
    }
    if (!/^\d+$/.test(value)) {
      setError("Page ID hanya boleh berisi angka.");
      return;
    }
    const projectKey = jiraProjectKey.trim().toUpperCase();
    if (!projectKey) {
      setError("Masukkan Jira Project Key untuk review ini.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setLiveFindings([]);
    setProgressMessage("Menyiapkan review...");
    setProgressStep(null);
    try {
      setResult(await window.qaBuddy.reviewDocument(value, projectKey));
      setProgressMessage(null);
      setProgressStep(null);
      setLiveFindings([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgressMessage(null);
      setProgressStep(null);
    } finally {
      setBusy(false);
    }
  };

  const reconciliation = result?.reconciliation;
  const exportReviewXlsx = async () => {
    if (!result) return;
    const XLSX = await import("xlsx");
    const summaryRows = [
      { Field: "Document Type", Value: result.documentType },
      { Field: "Project", Value: result.project },
      { Field: "Root Page Title", Value: result.rootPageTitle },
      { Field: "Root Page ID", Value: result.rootPageId },
      { Field: "Score", Value: result.score },
      { Field: "Overall Status", Value: result.overallStatus },
      { Field: "Pass Count", Value: result.passCount },
      { Field: "Warning Count", Value: result.warningCount },
      { Field: "Fail Count", Value: result.failCount },
      { Field: "Not Applicable Count", Value: result.notApplicableCount },
    ];
    const pageRows = result.pages.map((page) => ({
      "Document Type": page.documentType,
      Title: page.title,
      "Page ID": page.pageId,
      "Parent ID": page.parentPageId ?? "",
      URL: page.url,
    }));
    const execRows = result.jiraExecutions.map((execution) => ({
      Key: execution.key,
      Summary: execution.summary,
      "Issue Type": execution.issueType,
      Project: execution.projectKey,
      Status: execution.status,
      Total: execution.total,
      Executed: execution.executed,
      Pass: execution.pass,
      Fail: execution.fail,
      Blocked: execution.blocked,
      "Not Executed": execution.notExecuted,
      Included: execution.included ? "Yes" : "No",
    }));
    const findingRows = result.findings.map((finding) => ({
      "Document Type": finding.documentType,
      Section: finding.section,
      Status: finding.status,
      Severity: finding.severity,
      Title: finding.title,
      Description: finding.description,
      Recommendation: finding.recommendation,
      "Source Key": finding.sourceKey ?? "",
      Expected: finding.expectedValue ?? "",
      Actual: finding.actualValue ?? "",
      URL: finding.sourceUrl ?? "",
      Confidence: typeof finding.confidence === "number" ? finding.confidence : "",
      Evidence: finding.evidence ?? "",
      "Validation Source": finding.validationSource ?? "",
    }));
    const reconciliationRows = result.reconciliation
      ? [{
          "Jira Keys": result.reconciliation.jiraExecutionKeys.join(", "),
          "Confluence Total": result.reconciliation.confluenceTotal ?? "",
          "Jira Total": result.reconciliation.jiraTotal,
          "Confluence Executed": result.reconciliation.confluenceExecuted ?? "",
          "Jira Executed": result.reconciliation.jiraExecuted,
          "Confluence Pass": result.reconciliation.confluencePass ?? "",
          "Jira Pass": result.reconciliation.jiraPass,
          "Confluence Fail": result.reconciliation.confluenceFail ?? "",
          "Jira Fail": result.reconciliation.jiraFail,
          "Confluence Blocked": result.reconciliation.confluenceBlocked ?? "",
          "Jira Blocked": result.reconciliation.jiraBlocked,
          "Confluence Not Executed": result.reconciliation.confluenceNotExecuted ?? "",
          "Jira Not Executed": result.reconciliation.jiraNotExecuted,
          Difference: result.reconciliation.difference,
          "Is Match": result.reconciliation.isMatch ? "Yes" : "No",
        }]
      : [];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Summary");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(pageRows), "Pages");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(execRows), "Jira Executions");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(findingRows), "Findings");
    if (reconciliationRows.length) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(reconciliationRows), "Reconciliation");
    }
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    triggerDownload(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `QABuddy_Review_${result.rootPageId}.xlsx`
    );
  };

  const exportReviewCsv = () => {
    if (!result) return;
    const header = [
      "Document Type", "Section", "Status", "Severity", "Title", "Description",
      "Recommendation", "Source Key", "Expected", "Actual", "URL", "Confidence",
      "Evidence", "Validation Source",
    ];
    const lines = [header.join(",")];
    for (const finding of result.findings) {
      lines.push(
        [
          csvField(finding.documentType),
          csvField(finding.section),
          csvField(finding.status),
          csvField(finding.severity),
          csvField(finding.title),
          csvField(finding.description),
          csvField(finding.recommendation),
          csvField(finding.sourceKey ?? ""),
          csvField(finding.expectedValue ?? ""),
          csvField(finding.actualValue ?? ""),
          csvField(finding.sourceUrl ?? ""),
          csvField(typeof finding.confidence === "number" ? finding.confidence : ""),
          csvField(finding.evidence ?? ""),
          csvField(finding.validationSource ?? ""),
        ].join(",")
      );
    }
    triggerDownload(
      new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8;" }),
      `QABuddy_Review_Findings_${result.rootPageId}.csv`
    );
  };
  return (
    <section style={{ maxWidth: 1180, margin: "0 auto", paddingBottom: 40 }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 28 }}>
        <div className="screen-icon" style={{ width: 44, height: 44 }}>
          <span className="material-symbols" style={{ fontSize: 25 }}>fact_check</span>
        </div>
        <div>
          <div style={{ color: "var(--primary)", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Quality control workspace</div>
          <h1 style={{ margin: 0, fontSize: 30, letterSpacing: "-0.03em" }}>QA Documentation Review</h1>
          <p style={{ margin: "8px 0 0", color: "var(--on-surface-variant)", maxWidth: 650, lineHeight: 1.5 }}>Validate TMP and SIT content, hierarchy, and Jira/Xray execution metrics from one focused review.</p>
        </div>
      </header>

      <div className="card" style={{ marginBottom: 24, padding: 22, borderRadius: 18, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
          <span className="material-symbols" style={{ color: "var(--primary)", fontSize: 22 }}>pin</span>
          <div>
            <div style={{ display: "block", fontWeight: 800, marginBottom: 4 }}>Review settings</div>
            <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: 13 }}>Tentukan Page ID Confluence dan Jira Project Key yang digunakan untuk review ini.</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            id="review-page-id"
            value={pageId}
            onChange={(event) => { setPageId(event.target.value.replace(/\D/g, "")); if (error) setError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter") void runReview(); }}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Page ID"
            aria-describedby="review-page-id-help"
            style={{ flex: "1 1 460px", minWidth: 240, height: 46, fontFamily: "var(--font-mono)", fontSize: 15 }}
          />
          <input
            id="review-jira-project-key"
            value={jiraProjectKey}
            onChange={(event) => { setJiraProjectKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "")); if (error) setError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter") void runReview(); }}
            placeholder="Jira Project Key"
            aria-label="Jira Project Key"
            style={{ flex: "0 1 220px", minWidth: 180, height: 46, fontFamily: "var(--font-mono)", fontSize: 15 }}
          />
          <button type="button" className="primary-button" onClick={() => void runReview()} disabled={busy} style={{ minHeight: 46, paddingInline: 20 }}>
            <span className={`material-symbols ${busy ? "rotating" : ""}`}>{busy ? "sync" : "fact_check"}</span>
            {busy ? "Reviewing..." : "Run Review"}
          </button>
        </div>
        <div id="review-page-id-help" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, color: "var(--on-surface-variant)", fontSize: 12 }}>
          <span className="material-symbols" style={{ fontSize: 16 }}>lock</span>
          <span>Review bersifat read-only. Tidak ada perubahan yang dikirim ke Confluence atau Jira.</span>
        </div>
        {error ? <p role="alert" style={{ color: "var(--error)", margin: "12px 0 0", fontSize: 13, fontWeight: 600 }}>{error}</p> : null}
      </div>

      {result ? (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }} aria-live="polite">
            <Metric label="Score" value={`${result.score}/100`} tone={result.score >= 80 ? "var(--success)" : result.score >= 60 ? "var(--warning)" : "var(--error)"} />
            <Metric label="Overall status" value={result.overallStatus} tone={statusColor[result.overallStatus]} />
            <Metric label="Pass" value={result.passCount} tone="var(--success)" />
            <Metric label="Warning" value={result.warningCount} tone="var(--warning)" />
            <Metric label="Fail" value={result.failCount} tone="var(--error)" />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
            <button type="button" className="primary-button" onClick={() => { void exportReviewXlsx(); }} style={{ minHeight: 44, paddingInline: 18 }}>
              <span className="material-symbols" style={{ fontSize: 20 }}>download</span>
              Export XLSX
            </button>
            <button type="button" className="secondary-button" onClick={exportReviewCsv} style={{ minHeight: 44, paddingInline: 18 }}>
              <span className="material-symbols" style={{ fontSize: 20 }}>download</span>
              Export CSV
            </button>
          </div>

          <div className="card" style={{ marginBottom: 24, padding: 22, borderRadius: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: "var(--on-surface-variant)", fontSize: 12 }}>Document type</div>
                <h2 style={{ margin: "4px 0" }}>{result.documentType}</h2>
                <p style={{ margin: 0, color: "var(--on-surface-variant)" }}>{result.rootPageTitle}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "var(--on-surface-variant)", fontSize: 12 }}>Pages reviewed</div>
                <strong style={{ fontSize: 24 }}>{result.pages.length}</strong>
              </div>
            </div>
            {result.pages.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
                {result.pages.map((page) => (
                  <button key={page.pageId} type="button" className="link-button" style={{ textAlign: "left", padding: 0 }} onClick={() => window.qaBuddy.openExternal(page.url)}>
                    {page.documentType}: {page.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {reconciliation ? (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ marginTop: 0 }}>Test Measures Reconciliation</h2>
              <p style={{ color: "var(--on-surface-variant)" }}>Official metrics from Jira/Xray API. Only DONE executions are included.</p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Metric label="Confluence executed" value={reconciliation.confluenceExecuted ?? "-"} />
                <Metric label="Jira executed" value={reconciliation.jiraExecuted} tone={reconciliation.isMatch ? "var(--success)" : "var(--error)"} />
                <Metric label="Jira total" value={reconciliation.jiraTotal} />
                <Metric label="PASS" value={reconciliation.jiraPass} tone="var(--success)" />
                <Metric label="FAIL" value={reconciliation.jiraFail} tone="var(--error)" />
              </div>
              <p style={{ marginBottom: 0, fontFamily: "var(--font-mono)", fontSize: 12 }}>Executions: {reconciliation.jiraExecutionKeys.join(", ")}</p>
            </div>
          ) : null}

          {result.jiraExecutions.length > 0 ? (
            <div className="card" style={{ marginBottom: 24, overflowX: "auto" }}>
              <h2 style={{ marginTop: 0 }}>Jira Test Executions</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Key", "Summary", "Project", "Status", "Total", "Executed", "Included"].map((head) => <th key={head} style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--outline-variant)" }}>{head}</th>)}</tr></thead>
                <tbody>{result.jiraExecutions.map((execution) => <tr key={execution.key}>
                  <td style={{ padding: "8px 6px", fontFamily: "var(--font-mono)" }}>{execution.key}</td>
                  <td style={{ padding: "8px 6px" }}>{execution.summary}</td>
                  <td style={{ padding: "8px 6px" }}>{execution.projectKey}</td>
                  <td style={{ padding: "8px 6px", color: execution.status.toLowerCase() === "done" ? "var(--success)" : "var(--warning)" }}>{execution.status}</td>
                  <td style={{ padding: "8px 6px" }}>{execution.total}</td>
                  <td style={{ padding: "8px 6px" }}>{execution.executed}</td>
                  <td style={{ padding: "8px 6px" }}>{execution.included ? "Yes" : "No"}</td>
                </tr>)}</tbody>
              </table>
            </div>
          ) : null}

          <div>
            <h2 style={{ margin: "0 0 12px" }}>Findings</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 10, alignItems: "start" }}>
              {result.findings.map((finding, index) => <FindingCard key={`${finding.section}-${finding.title}-${index}`} finding={finding} />)}
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ minHeight: 250, display: "grid", placeItems: "center", textAlign: "center", padding: 32, borderRadius: 18, border: "1px dashed var(--outline)" }} aria-live="polite">
          {busy || liveFindings.length > 0 ? (
            <div style={{ width: "100%", maxWidth: 620 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700 }}>{busy ? "Review berjalan..." : "Pengecekan selesai"}</div>
                <div style={{ color: "var(--on-surface-variant)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                  {progressStep && progressStep.total > 0 ? `${Math.min(progressStep.current, progressStep.total)}/${progressStep.total} pemeriksaan` : ""}
                </div>
              </div>
              {busy ? (
                <>
                  <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: "var(--surface-container-high)", overflow: "hidden" }}>
                    <style>{"@keyframes review-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
                    <div
                      style={{
                        height: "100%",
                        width: progressStep && progressStep.total > 0
                          ? `${Math.min(100, Math.round((progressStep.current / progressStep.total) * 100))}%`
                          : "40%",
                        minWidth: 12,
                        borderRadius: 999,
                        background: "var(--primary)",
                        transition: "width 250ms ease",
                        ...(progressStep && progressStep.total > 0 ? {} : { animation: "review-indeterminate 1.4s ease-in-out infinite" }),
                      }}
                    />
                  </div>
                  <p style={{ margin: "8px 0 0", color: "var(--on-surface-variant)", fontSize: 13 }}>{progressMessage ?? "Memproses..."}</p>
                </>
              ) : null}
              {liveFindings.length > 0 ? (
                <div style={{ marginTop: busy ? 16 : 0, textAlign: "left" }}>
                  <div style={{ color: "var(--on-surface-variant)", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
                    Temuan sejauh ini ({liveFindings.length})
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 10, alignItems: "start" }}>
                    {liveFindings.map((finding, index) => (
                      <FindingCard key={`${finding.section}-${finding.title}-${index}`} finding={finding} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div>
              <span className="material-symbols" style={{ fontSize: 42, color: "var(--primary)", opacity: 0.85 }}>analytics</span>
              <h2 style={{ margin: "12px 0 6px" }}>Ready for a document review</h2>
              <p style={{ margin: 0, color: "var(--on-surface-variant)", maxWidth: 420 }}>Hasil review akan muncul di sini setelah Page ID diproses.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
