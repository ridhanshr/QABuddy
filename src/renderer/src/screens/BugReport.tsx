import React from "react";
import { useApp } from "../context/AppContext";

export default function BugReport() {
  const {
    activeView,
    loading,
    bugDraft,
    setBugDraft,
    bugPreview,
    polishBug,
    bugLoading,
    submitBug
  } = useApp();

  if (loading || activeView !== "bug-report") {
    return null;
  }

  return (
    <section>
      {/* Page Header */}
      <div className="page-header">
        <h2 className="text-display">Quick Bug Report</h2>
        <p className="text-body-lg">Log an issue quickly and let AI format it for Jira.</p>
      </div>

      <div className="bug-grid">
        {/* ── Form Section (7 cols) ── */}
        <div className="card bug-form-card">
          <div className="bug-form-fields">
            <label>
              <span>Judul</span>
              <input
                onChange={(event) => setBugDraft({ ...bugDraft, title: event.target.value })}
                placeholder="e.g., Login button unresponsive on mobile view"
                value={bugDraft.title}
              />
            </label>
            <label>
              <span>Langkah Reproduksi</span>
              <textarea
                onChange={(event) =>
                  setBugDraft({ ...bugDraft, stepsToReproduce: event.target.value })
                }
                placeholder="1. Go to... 2. Click... 3. See..."
                rows={4}
                value={bugDraft.stepsToReproduce}
              />
            </label>
            <div className="bug-form-row-2col">
              <label>
                <span>Hasil Aktual</span>
                <textarea
                  onChange={(event) => setBugDraft({ ...bugDraft, actualResult: event.target.value })}
                  placeholder="What actually happened..."
                  rows={3}
                  value={bugDraft.actualResult}
                />
              </label>
              <label>
                <span>Hasil Harapan</span>
                <textarea
                  onChange={(event) => setBugDraft({ ...bugDraft, expectedResult: event.target.value })}
                  placeholder="What should have happened..."
                  rows={3}
                  value={bugDraft.expectedResult}
                />
              </label>
            </div>
            <div className="bug-form-row-2col">
              <label>
                <span>Environment</span>
                <input
                  onChange={(event) => setBugDraft({ ...bugDraft, environment: event.target.value })}
                  placeholder="e.g., Production, Staging"
                  value={bugDraft.environment}
                />
              </label>
              <label>
                <span>Priority</span>
                <select
                  onChange={(event) => setBugDraft({ ...bugDraft, priority: event.target.value })}
                  value={bugDraft.priority}
                >
                  <option>Critical</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </label>
            </div>
            <label>
              <span>Labels</span>
              <input
                onChange={(event) => setBugDraft({ ...bugDraft, labels: event.target.value })}
                placeholder="e.g., regression, mobile"
                value={bugDraft.labels}
              />
            </label>
          </div>
        </div>

        {/* ── AI Preview Section (5 cols) ── */}
        <div className="bug-preview-col">
          <div className="bug-preview-card">
            {/* Preview Header Bar */}
            <div className="bug-preview-header">
              <div className="bug-preview-title">
                <span className="material-symbols" style={{ fontSize: 20 }}>auto_awesome</span>
                <span>Polished by AI</span>
              </div>
              <span className="bug-preview-badge">Preview</span>
            </div>
            {/* Preview Content */}
            <div className="bug-preview-body">
              {bugPreview.summary ? (
                <div className="bug-preview-content">
                  <div>
                    <h4 className="bug-preview-label">Summary</h4>
                    <p className="bug-preview-summary">{bugPreview.summary}</p>
                  </div>
                  <div>
                    <h4 className="bug-preview-label">Description</h4>
                    <pre className="code-block">{bugPreview.description}</pre>
                  </div>
                  {(bugPreview.priority || bugPreview.labels.length > 0) && (
                    <div className="bug-preview-tags">
                      {bugPreview.priority && <span className="status-pill connected">{bugPreview.priority}</span>}
                      {bugPreview.labels.map((label) => (
                        <span className="status-pill neutral" key={label}>{label}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bug-preview-placeholder">
                  Start typing to see the AI-enhanced Jira ticket preview here...
                </div>
              )}
            </div>
          </div>

          {/* Submit Buttons */}
          <div className="bug-submit-row">
            <button className="secondary-button" onClick={() => void polishBug()} type="button">
              <span className="material-symbols" style={{ fontSize: 18 }}>auto_awesome</span>
              {bugLoading ? "Menyusun..." : "Polish with AI"}
            </button>
            <button className="primary-button bug-submit-btn" onClick={() => void submitBug()} type="button">
              <span className="material-symbols" style={{ fontSize: 20 }}>send</span>
              Submit to Jira
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
