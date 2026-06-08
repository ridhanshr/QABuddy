import React from "react";
import { useApp } from "../context/AppContext";

export default function Documentation() {
  const { loading, activeView } = useApp();

  if (loading || activeView !== "documentation") {
    return null;
  }

  return (
    <div className="documentation-layout">
      <div className="doc-container">
        <div className="doc-grid">
          {/* Table of Contents */}
          <aside className="doc-toc">
            <nav>
              <h3 className="toc-title">On this page</h3>
              <ul className="toc-list">
                <li><a href="#getting-started" className="toc-link">Getting Started</a></li>
                <li><a href="#jira-integration" className="toc-link">Jira Integration</a></li>
                <li><a href="#writing-reports" className="toc-link">Writing Effective Bug Reports</a></li>
                <li><a href="#local-ai" className="toc-link">Local AI Privacy</a></li>
              </ul>
            </nav>
          </aside>

          {/* Main Content */}
          <article className="doc-content">
            <header className="doc-header">
              <h1>QA Buddy Documentation</h1>
              <p>Comprehensive guide for setup, integration, and maximizing utility in your testing workflows.</p>
            </header>

            {/* Section: Getting Started */}
            <section id="getting-started" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">rocket_launch</span>
                <h2>Getting Started</h2>
              </div>
              <p>
                QA Buddy is engineered to provide surgical precision in your testing cycles. Designed as a high-speed, local-first assistant, it minimizes latency while maximizing data context extraction from your application logs and bug definitions.
              </p>
              <p className="secondary-text">
                Upon initial launch, ensure your local environment variables align with the configuration settings. The primary navigation on the left provides access to core utilities: real-time dashboard analytics, the contextual chat assistant, and automated report generation tools.
              </p>
              <div className="callout-box checklist">
                <h4>Prerequisites Checklist</h4>
                <ul>
                  <li>Node.js v18.0 or higher</li>
                  <li>Active Atlassian API Token (Jira & Confluence)</li>
                  <li>Access to repository source logs</li>
                </ul>
              </div>
            </section>

            {/* Section: Jira Integration */}
            <section id="jira-integration" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">sync_alt</span>
                <h2>Jira Integration</h2>
              </div>
              <p>
                Connecting QA Buddy to your Jira instance allows for seamless extraction of acceptance criteria and automated bug ticket creation. The integration utilizes a read-heavy optimization pattern to ensure we do not hit Atlassian API rate limits during bulk test extractions.
              </p>
              <h3 className="doc-h3">Querying Issues via JQL</h3>
              <p className="secondary-text">
                When instructing the Chat Assistant or using the Test Case Extractor, providing specific JQL (Jira Query Language) scopes significantly improves response accuracy. Below is an example of a highly optimized JQL string for targeting recent regressions in a specific sprint.
              </p>
              <div className="doc-code-block">
                <div className="code-header">
                  <span>JQL</span>
                  <button 
                    className="copy-btn"
                    onClick={() => {
                      const jqlStr = `project = "CORE" AND issuetype = Bug \nAND status in ("In Progress", "To Do") \nAND sprint in openSprints() \nAND component = "PaymentGateway" \nORDER BY priority DESC, created DESC`;
                      navigator.clipboard.writeText(jqlStr);
                    }}
                  >
                    <span className="material-symbols">content_copy</span>
                  </button>
                </div>
                <pre><code>{`project = "CORE" AND issuetype = Bug 
AND status in ("In Progress", "To Do") 
AND sprint in openSprints() 
AND component = "PaymentGateway" 
ORDER BY priority DESC, created DESC`}</code></pre>
              </div>
            </section>

            {/* Section: Writing Effective Bug Reports */}
            <section id="writing-reports" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">edit_document</span>
                <h2>Writing Effective Bug Reports</h2>
              </div>
              <p>
                While the AI assistant can extrapolate missing context, explicit and structured input guarantees predictable outputs. Adhere to the following structural hierarchy when submitting prompt data to the Bug Report module.
              </p>
              <div className="comparison-grid">
                <div className="comparison-item bad">
                  <div className="item-header">
                    <span className="indicator"></span>
                    <h4>Sub-optimal Input</h4>
                  </div>
                  <p className="italic">"The login button doesn't work on mobile."</p>
                </div>
                <div className="comparison-item good">
                  <div className="item-header">
                    <span className="indicator"></span>
                    <h4>Optimal Input</h4>
                  </div>
                  <p className="italic">"Environment: iOS Safari 16.2. Action: Tapping 'Sign In' triggers infinite spinner, no network request fired. Expected: Route to /dashboard."</p>
                </div>
              </div>
            </section>

            {/* Section: Local AI Privacy */}
            <section id="local-ai" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">shield_lock</span>
                <h2>Local AI Privacy</h2>
              </div>
              <div className="callout-box info">
                <span className="material-symbols text-primary" style={{ marginTop: 2 }}>info</span>
                <div>
                  <p className="bold">Zero-Telemetry Policy</p>
                  <p className="secondary-text">By default, QA Buddy executes all LLM inference using a local inference engine. No proprietary code snippets, server logs, or bug descriptions ever leave your machine without explicit configuration.</p>
                </div>
              </div>
              <p className="secondary-text">
                We utilize a quantized model architecture capable of running efficiently on modern developer hardware. This architecture guarantees that sensitive intellectual property remains air-gapped from cloud processing vectors.
              </p>
            </section>
          </article>
        </div>
      </div>
    </div>
  );
}
