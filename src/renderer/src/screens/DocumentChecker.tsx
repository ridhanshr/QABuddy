import React from "react";
import { useApp } from "../context/AppContext";

export default function DocumentChecker() {
  const { loading, activeView } = useApp();

  if (loading || activeView !== "document-checker") {
    return null;
  }

  return (
    <div className="document-checker-layout">
      <div className="container">
        <header className="page-header">
          <div className="header-title">
            <span className="material-symbols text-primary">fact_check</span>
            <h1>Document Checker</h1>
          </div>
          <p>Analyze and verify document consistency against project requirements.</p>
        </header>

        <section className="checker-content">
          <div className="card">
            <h3>Start Analysis</h3>
            <p className="secondary-text">
              Upload a document or provide a Confluence URL to begin the automated check.
            </p>
            <div className="actions" style={{ marginTop: '1rem' }}>
              <button className="btn-primary">
                <span className="material-symbols">upload_file</span>
                Upload Document
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}