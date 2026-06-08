import React from "react";
import { useApp } from "../context/AppContext";
import type { ExtractionDepth } from "@shared/types";

export default function TestCaseExtractor() {
  const {
    activeView,
    loading,
    extractUrl,
    setExtractUrl,
    extractDepth,
    setExtractDepth,
    extractLoading,
    extractCases,
    extractedCases,
    setExtractedCases,
    exportCases
  } = useApp();

  if (loading || activeView !== "test-case-extractor") {
    return null;
  }

  return (
    <section>
      <div className="page-header">
        <h2 className="text-display">Test Case Extractor</h2>
        <p className="text-body-lg">Analyze Confluence docs and extract test cases with AI.</p>
      </div>

      <div className="extraction-grid">
        {/* ── Left Column: Form & Stats (4 cols) ── */}
        <div className="bug-preview-col">
          {/* AI Extractor Card */}
          <div className="extractor-bento-card">
            <div className="extractor-header">
              <div className="extractor-title-group">
                <div className="extractor-icon-box" style={{ width: 32, height: 32 }}>
                  <span className="material-symbols" style={{ fontSize: 18 }}>auto_awesome</span>
                </div>
                <div className="extractor-title-text">
                  <h3 style={{ fontSize: 16, margin: 0 }}>AI Extractor</h3>
                  <p style={{ fontSize: 12, margin: 0 }}>Analyze Confluence docs</p>
                </div>
              </div>
              <div className="ollama-badge">
                <span className="material-symbols" style={{ fontSize: 11 }}>memory</span>
                <span>Powered by Ollama</span>
              </div>
            </div>

            <div className="bug-form-fields" style={{ marginBottom: 24 }}>
              <label>
                <span>Confluence Page URL</span>
                <input
                  onChange={(event) => setExtractUrl(event.target.value)}
                  placeholder="https://confluence.company.com/pages/..."
                  type="url"
                  value={extractUrl}
                />
              </label>
              <label>
                <span>Extraction Depth</span>
                <select
                  onChange={(event) => setExtractDepth(event.target.value as ExtractionDepth)}
                  value={extractDepth}
                >
                  <option value="comprehensive">Comprehensive (Positive & Negative)</option>
                  <option value="happy-path">Happy Path Only</option>
                  <option value="edge-case">Edge Cases Focused</option>
                </select>
              </label>
            </div>

            <button
              className="primary-button"
              onClick={() => void extractCases()}
              style={{ width: "100%", marginTop: "auto" }}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 18 }}>model_training</span>
              {extractLoading ? "Extracting..." : "Extract Test Cases"}
            </button>
          </div>
        </div>

        {/* ── Right Column: Results List (8 cols) ── */}
        <div className="results-panel">
          {/* Toolbar */}
          <div className="results-toolbar">
            <div className="results-title-group">
              <h3 style={{ fontSize: 20, fontWeight: 600 }}>Extraction Results</h3>
              <span className="count-badge">{extractedCases.length} Items</span>
            </div>
            <div className="toolbar-actions">
              <button
                className="primary-button"
                onClick={() => void exportCases()}
                style={{ background: "var(--inverse-surface)", color: "var(--inverse-on-surface)", borderColor: "var(--inverse-surface)" }}
                type="button"
              >
                <span className="material-symbols" style={{ fontSize: 18 }}>integration_instructions</span>
                Export to Jira
              </button>
            </div>
          </div>

          {/* List */}
          <div className="case-item-list">
            {extractedCases.length > 0 ? (
              extractedCases.map((item) => (
                <label className="case-item-row" key={item.id}>
                  <div className="checkbox-box">
                    <input
                      checked={item.selected}
                      onChange={(event) =>
                        setExtractedCases((current) =>
                          current.map((entry) =>
                            entry.id === item.id ? { ...entry, selected: event.target.checked } : entry
                          )
                        )
                      }
                      type="checkbox"
                    />
                  </div>
                  <div className="content">
                    <div className="header">
                      <h4>{item.title}</h4>
                      <span className="priority-pill">{item.priority}</span>
                    </div>
                    <p className="desc">{item.objective}</p>
                    <div className="tag-box">
                      <span className="case-tag">
                        <span
                          className="tag-dot"
                          style={{
                            background:
                              item.category === "Happy Path"
                                ? "#10b981"
                                : item.category === "Negative Test"
                                ? "#ef4444"
                                : "#3b82f6",
                          }}
                        ></span>
                        {item.category}
                      </span>
                    </div>
                  </div>
                </label>
              ))
            ) : (
              <div className="bug-preview-placeholder" style={{ padding: 24, border: "none" }}>
                Start extraction to see results here...
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
