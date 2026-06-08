import React from "react";
import { useApp } from "../context/AppContext";

import jiraIcon from "../assets/jira.png";
import confluenceIcon from "../assets/confluence.png";

export default function Settings() {
  const {
    loading,
    activeView,
    settingsTab,
    setSettingsTab,
    status,
    config,
    setConfig,
    showJiraToken,
    setShowJiraToken,
    showConfluenceToken,
    setShowConfluenceToken,
    connectionLoading,
    setBanner,
    modelsLoading,
    ollamaModels,
    saveAllLoading,
    setSaveAllLoading,
    saveSettings,
    runHealthcheck,
    healthcheckLoading,
    healthcheckResult,
    ragStats,
    ragProgress,
    ragLoading,
    ragSyncSpace,
    setRagSyncSpace,
    ragSyncProject,
    setRagSyncProject,
    handleRagIndexConfluence,
    handleRagIndexJira,
    handleRagClear,
  } = useApp();

  if (loading || activeView !== "settings") {
    return null;
  }

  const toErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  };

  return (
    <section style={{ maxWidth: 800, margin: "0 auto" }}>
      <div className="page-header" style={{ marginBottom: 32 }}>
        <h2 className="text-display">Settings</h2>
      </div>

      <div className="tab-container" style={{ marginBottom: 24, borderBottom: "1px solid var(--outline-variant)" }}>
        <button 
          className={`tab-btn ${settingsTab === "general" ? "active" : ""}`}
          onClick={() => setSettingsTab("general")}
          type="button"
        >
          <span className="material-symbols" style={{ fontSize: 18 }}>settings</span>
          General Settings
        </button>
        <button 
          className={`tab-btn ${settingsTab === "knowledge-base" ? "active" : ""}`}
          onClick={() => setSettingsTab("knowledge-base")}
          type="button"
        >
          <span className="material-symbols" style={{ fontSize: 18 }}>neurology</span>
          Knowledge Base
        </button>
      </div>

      {settingsTab === "general" && (
        <div className="settings-stack">
          {/* Connection Settings Card */}
          <div className="card" style={{ padding: 24 }}>
            <div className="settings-header" style={{ marginBottom: 24 }}>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 600 }}>Connection Settings</h3>
                <p style={{ fontSize: 14, color: "var(--on-surface-variant)" }}>Configure integrations to Jira and Confluence.</p>
              </div>
            </div>

            <div className="bug-form-fields">
              {/* Jira Section */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "var(--primary)" }}>Jira Configuration</h4>
                  <span className={`bug-preview-badge ${status.jira.ok ? "connected" : ""}`} style={{ fontSize: 11, background: status.jira.ok ? "rgba(16, 185, 129, 0.1)" : "var(--surface-container)", color: status.jira.ok ? "#10b981" : "var(--on-surface-variant)", border: "1px solid currentColor" }}>
                    <span className="tag-dot" style={{ background: status.jira.ok ? "#10b981" : "#737686", marginRight: 6 }}></span>
                    {status.jira.ok ? "Jira Connected" : "Connection Pending"}
                  </span>
                </div>
                <div className="bug-form-row-2col">
                  <label>
                    <span>Jira Workspace URL</span>
                    <input
                      onChange={(event) =>
                        setConfig({ ...config, jira: { ...config.jira, baseUrl: event.target.value } })
                      }
                      placeholder="https://company.atlassian.net"
                      type="url"
                      value={config.jira.baseUrl}
                    />
                  </label>
                  <label>
                    <span>Jira Project Key</span>
                    <input
                      onChange={(event) =>
                        setConfig({ ...config, jira: { ...config.jira, projectKey: event.target.value } })
                      }
                      placeholder="QA"
                      value={config.jira.projectKey}
                    />
                  </label>
                </div>
                <div className="bug-form-row-2col">
                  <label>
                    <span>Test Case Issue Type</span>
                    <input
                      onChange={(event) =>
                        setConfig({ ...config, jira: { ...config.jira, testCaseIssueType: event.target.value } })
                      }
                      placeholder="Test"
                      value={config.jira.testCaseIssueType}
                    />
                  </label>
                  <label>
                    <span>Bug Issue Type</span>
                    <input
                      onChange={(event) =>
                        setConfig({ ...config, jira: { ...config.jira, bugIssueType: event.target.value } })
                      }
                      placeholder="Bug"
                      value={config.jira.bugIssueType}
                    />
                  </label>
                </div>
                <div className="bug-form-row-2col">
                  <label>
                    <span>Jira Username / Email</span>
                    <input
                      onChange={(event) =>
                        setConfig({ ...config, jira: { ...config.jira, username: event.target.value } })
                      }
                      placeholder="yourname@company.com"
                      value={config.jira.username}
                    />
                  </label>
                  <label>
                    <span>Jira API Token</span>
                    <div style={{ position: "relative" }}>
                      <input
                        onChange={(event) =>
                          setConfig({ ...config, jira: { ...config.jira, token: event.target.value } })
                        }
                        style={{ width: "100%", paddingRight: 40 }}
                        type={showJiraToken ? "text" : "password"}
                        value={config.jira.token}
                      />
                      <button
                        onClick={() => setShowJiraToken(!showJiraToken)}
                        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--on-surface-variant)", cursor: "pointer" }}
                        type="button"
                      >
                        <span className="material-symbols" style={{ fontSize: 18 }}>
                          {showJiraToken ? "visibility" : "visibility_off"}
                        </span>
                      </button>
                    </div>
                  </label>
                </div>
                <div className="bug-form-row-2col" style={{ marginTop: 8 }}>
                  <label>
                    <span>Auth Mode</span>
                    <select
                      onChange={(event) =>
                        setConfig({ ...config, jira: { ...config.jira, authMode: event.target.value as "basic" | "bearer" } })
                      }
                      value={config.jira.authMode}
                      style={{ height: 44, width: "100%", borderRadius: 8, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)", padding: "0 12px" }}
                    >
                      <option value="basic">Basic (Email + Token)</option>
                      <option value="bearer">Bearer (PAT)</option>
                    </select>
                  </label>
                  <label>
                    <span>&nbsp;</span>
                    <div style={{ height: 44 }} />
                  </label>
                </div>
              </div>

              {/* Confluence Section */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "var(--primary)" }}>Confluence Configuration</h4>
                  <span className={`bug-preview-badge ${status.confluence.ok ? "connected" : ""}`} style={{ fontSize: 11, background: status.confluence.ok ? "rgba(16, 185, 129, 0.1)" : "var(--surface-container)", color: status.confluence.ok ? "#10b981" : "var(--on-surface-variant)", border: "1px solid currentColor" }}>
                    <span className="tag-dot" style={{ background: status.confluence.ok ? "#10b981" : "#737686", marginRight: 6 }}></span>
                    {status.confluence.ok ? "Confluence Connected" : "Connection Pending"}
                  </span>
                </div>
                <div className="bug-form-row-2col">
                  <label>
                    <span>Confluence URL</span>
                    <input
                      onChange={(event) =>
                        setConfig({ ...config, confluence: { ...config.confluence, baseUrl: event.target.value } })
                      }
                      placeholder="https://company.atlassian.net/wiki"
                      type="url"
                      value={config.confluence.baseUrl}
                    />
                  </label>
                  <label>
                    <span>Space Key</span>
                    <input
                      onChange={(event) =>
                        setConfig({ ...config, confluence: { ...config.confluence, spaceKey: event.target.value } })
                      }
                      placeholder="QA"
                      value={config.confluence.spaceKey}
                    />
                  </label>
                </div>
                <div className="bug-form-row-2col">
                  <label>
                    <span>Confluence Username / Email</span>
                    <input
                      onChange={(event) =>
                        setConfig({ ...config, confluence: { ...config.confluence, username: event.target.value } })
                      }
                      placeholder="yourname@company.com"
                      value={config.confluence.username}
                    />
                  </label>
                  <label>
                    <span>Confluence PAT / Token</span>
                    <div style={{ position: "relative" }}>
                      <input
                        onChange={(event) =>
                          setConfig({ ...config, confluence: { ...config.confluence, token: event.target.value } })
                        }
                        style={{ width: "100%", paddingRight: 40 }}
                        type={showConfluenceToken ? "text" : "password"}
                        value={config.confluence.token}
                      />
                      <button
                        onClick={() => setShowConfluenceToken(!showConfluenceToken)}
                        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--on-surface-variant)", cursor: "pointer" }}
                        type="button"
                      >
                        <span className="material-symbols" style={{ fontSize: 18 }}>
                          {showConfluenceToken ? "visibility" : "visibility_off"}
                        </span>
                      </button>
                    </div>
                  </label>
                </div>
                <div className="bug-form-row-2col" style={{ marginTop: 8 }}>
                  <label>
                    <span>Auth Mode</span>
                    <select
                      onChange={(event) =>
                        setConfig({ ...config, confluence: { ...config.confluence, authMode: event.target.value as "basic" | "bearer" } })
                      }
                      value={config.confluence.authMode}
                      style={{ height: 44, width: "100%", borderRadius: 8, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)", padding: "0 12px" }}
                    >
                      <option value="basic">Basic (Email + Token)</option>
                      <option value="bearer">Bearer (PAT)</option>
                    </select>
                  </label>
                  <label>
                    <span>&nbsp;</span>
                    <div style={{ height: 44 }} />
                  </label>
                </div>
              </div>
            </div>

            <div className="bug-submit-row" style={{ marginTop: 24, display: "flex", gap: 8 }}>
              <button className="secondary-button" onClick={async () => {
                setBanner({ tone: "info", text: "Menguji Jira..." });
                try {
                  await window.qaBuddy.saveConfig(config);
                  const nextStatus = await window.qaBuddy.testConnections();
                  setConfig(config);
                  setBanner({ tone: nextStatus.jira.ok ? "success" : "error", text: nextStatus.jira.ok ? "Jira terhubung." : `Jira gagal: ${nextStatus.jira.message}` });
                } catch (error) {
                  setBanner({ tone: "error", text: toErrorMessage(error, "Gagal menguji Jira.") });
                }
              }} style={{ flex: 1 }} type="button" disabled={connectionLoading}>
                {connectionLoading ? "..." : "Test Jira"}
              </button>
              <button className="secondary-button" onClick={async () => {
                setBanner({ tone: "info", text: "Menguji Confluence..." });
                try {
                  await window.qaBuddy.saveConfig(config);
                  const nextStatus = await window.qaBuddy.testConnections();
                  setBanner({ tone: nextStatus.confluence.ok ? "success" : "error", text: nextStatus.confluence.ok ? "Confluence terhubung." : `Confluence gagal: ${nextStatus.confluence.message}` });
                } catch (error) {
                  setBanner({ tone: "error", text: toErrorMessage(error, "Gagal menguji Confluence.") });
                }
              }} style={{ flex: 1 }} type="button" disabled={connectionLoading}>
                {connectionLoading ? "..." : "Test Confluence"}
              </button>
              <button className="secondary-button" onClick={async () => {
                setBanner({ tone: "info", text: "Menguji Ollama..." });
                try {
                  await window.qaBuddy.saveConfig(config);
                  const nextStatus = await window.qaBuddy.testConnections();
                  setBanner({ tone: nextStatus.ollama.ok ? "success" : "error", text: nextStatus.ollama.ok ? "Ollama terhubung." : `Ollama gagal: ${nextStatus.ollama.message}` });
                } catch (error) {
                  setBanner({ tone: "error", text: toErrorMessage(error, "Gagal menguji Ollama.") });
                }
              }} style={{ flex: 1 }} type="button" disabled={connectionLoading}>
                {connectionLoading ? "..." : "Test Ollama"}
              </button>
            </div>
          </div>

          {/* Local AI Configuration Card */}
          <div className="card" style={{ padding: 24 }}>
            <div className="settings-header" style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="material-symbols" style={{ color: "var(--primary)" }}>memory</span>
                <div>
                  <h3 style={{ fontSize: 20, fontWeight: 600 }}>Local AI Configuration</h3>
                  <p style={{ fontSize: 14, color: "var(--on-surface-variant)" }}>Manage your local LLM engine.</p>
                </div>
              </div>
              <span className="bug-preview-badge" style={{ background: status.ollama.ok ? "rgba(37, 99, 235, 0.1)" : "var(--surface-container)", color: status.ollama.ok ? "var(--primary)" : "var(--on-surface-variant)", border: "1px solid currentColor" }}>
                <span className={`tag-dot ${status.ollama.ok ? "animate-pulse" : ""}`} style={{ background: status.ollama.ok ? "var(--primary)" : "#737686", marginRight: 6 }}></span>
                Ollama {status.ollama.ok ? "Running" : "Offline"}
              </span>
            </div>

            <div className="bug-form-fields">
              <div className="bug-form-row-2col">
                <label>
                  <span>Active Model</span>
                  <select
                    onChange={(event) =>
                      setConfig({ ...config, ollama: { ...config.ollama, model: event.target.value } })
                    }
                    value={config.ollama.model}
                    disabled={modelsLoading}
                  >
                    {modelsLoading ? (
                      <option>Loading models...</option>
                    ) : ollamaModels.length > 0 ? (
                      ollamaModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))
                    ) : (
                      <option value="">No models detected. Check Ollama status.</option>
                    )}
                  </select>
                </label>
                <label>
                  <span>Local API Endpoint</span>
                  <input
                    onChange={(event) =>
                      setConfig({ ...config, ollama: { ...config.ollama, endpoint: event.target.value } })
                    }
                    value={config.ollama.endpoint}
                  />
                </label>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span className="material-symbols" style={{ fontSize: 18, color: "var(--primary)" }}>tune</span>
                  <strong style={{ fontSize: 14 }}>Specialized Models</strong>
                </div>
                <div className="bug-form-row-2col">
                  <label>
                    <span>JQL Model</span>
                    <select
                      onChange={(event) =>
                        setConfig({ ...config, ollama: { ...config.ollama, jqlModel: event.target.value } })
                      }
                      value={config.ollama.jqlModel || ""}
                      disabled={modelsLoading}
                    >
                      <option value="">Use Active Model</option>
                      {ollamaModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Chat Model</span>
                    <select
                      onChange={(event) =>
                        setConfig({ ...config, ollama: { ...config.ollama, chatModel: event.target.value } })
                      }
                      value={config.ollama.chatModel || ""}
                      disabled={modelsLoading}
                    >
                      <option value="">Use Active Model</option>
                      {ollamaModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="bug-form-row-2col" style={{ marginTop: 8 }}>
                  <label>
                    <span>Extraction Model</span>
                    <select
                      onChange={(event) =>
                        setConfig({ ...config, ollama: { ...config.ollama, extractionModel: event.target.value } })
                      }
                      value={config.ollama.extractionModel || ""}
                      disabled={modelsLoading}
                    >
                      <option value="">Use Active Model</option>
                      {ollamaModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Insight Model</span>
                    <select
                      onChange={(event) =>
                        setConfig({ ...config, ollama: { ...config.ollama, insightModel: event.target.value } })
                      }
                      value={config.ollama.insightModel || ""}
                      disabled={modelsLoading}
                    >
                      <option value="">Use Active Model</option>
                      {ollamaModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div className="bug-preview-placeholder" style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "flex-start", background: "var(--surface-container)", border: "1px solid var(--outline-variant)", fontStyle: "normal", opacity: 1, padding: 16 }}>
              <span className="material-symbols" style={{ fontSize: 20, color: "var(--on-surface-variant)" }}>info</span>
              <div>
                <h4 style={{ fontSize: 12, fontWeight: 500, color: "var(--on-surface)", marginBottom: 4 }}>Model Context Window Limit</h4>
                <p style={{ fontSize: 14, color: "var(--on-surface-variant)" }}>Currently set to 8192 tokens. Large test suites may require chunking before analysis.</p>
              </div>
            </div>

            <div className="bug-submit-row" style={{ marginTop: 24 }}>
              <button 
                className="primary-button" 
                onClick={() => void saveSettings()} 
                style={{ width: "100%", justifyContent: "center" }} 
                type="button"
                disabled={saveAllLoading}
              >
                {saveAllLoading ? (
                  <>
                    <span className="material-symbols rotating" style={{ fontSize: 18, marginRight: 8 }}>sync</span>
                    Saving AI Settings...
                  </>
                ) : (
                  <>
                    <span className="material-symbols" style={{ fontSize: 18, marginRight: 8 }}>save</span>
                    Save AI Settings
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 24 }}>
            <div className="settings-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 600 }}>System Healthcheck</h3>
                <p style={{ fontSize: 14, color: "var(--on-surface-variant)" }}>Validasi koneksi, RAG, dan konfigurasi sebelum dipakai.</p>
              </div>
            </div>

            <button
              className="secondary-button"
              onClick={() => void runHealthcheck()}
              type="button"
              disabled={healthcheckLoading}
              style={{ marginBottom: 16 }}
            >
              <span className="material-symbols" style={{ fontSize: 18, marginRight: 6 }}>health_and_safety</span>
              {healthcheckLoading ? "Running..." : "Run Healthcheck"}
            </button>

            {healthcheckResult && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {[
                  { label: "Jira", icon: "check_circle", data: healthcheckResult.jira },
                  { label: "Confluence", icon: "check_circle", data: healthcheckResult.confluence },
                  { label: "Ollama", icon: "check_circle", data: healthcheckResult.ollama },
                  { label: "Knowledge Base (RAG)", icon: "database", data: healthcheckResult.rag },
                  { label: "Config Validation", icon: "settings", data: healthcheckResult.config },
                ].map((item) => {
                  const ok = Boolean(item.data?.ok);
                  const summary = "issues" in item.data && Array.isArray(item.data.issues)
                    ? item.data.issues.join(", ")
                    : "message" in item.data
                      ? item.data.message
                      : "totalChunks" in item.data
                        ? `Chunks: ${item.data.totalChunks}`
                        : ok
                          ? "OK"
                          : "Tidak lolos validasi";
                  return (
                    <div
                      key={item.label}
                      style={{
                        padding: 16,
                        borderRadius: 12,
                        border: "1px solid var(--outline-variant)",
                        background: ok ? "rgba(22, 163, 74, 0.06)" : "rgba(220, 38, 38, 0.06)",
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                      }}
                    >
                      <span
                        className="material-symbols"
                        style={{ fontSize: 20, color: ok ? "#16a34a" : "#dc2626", marginTop: 2 }}
                      >
                        {ok ? item.icon : "error"}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{item.label}</div>
                        <div style={{ fontSize: 12, color: "var(--on-surface-variant)", lineHeight: 1.5 }}>
                          {summary}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* General Preferences Card */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>General Preferences</h3>
            <p style={{ fontSize: 14, color: "var(--on-surface-variant)", marginBottom: 24 }}>Customize your workspace experience.</p>
            
            <div className="bug-form-row-2col">
              <div>
                <label className="bug-preview-label" style={{ marginBottom: 8, display: "block" }}>Theme</label>
                <div style={{ display: "flex", padding: 4, background: "var(--surface-container-low)", borderRadius: 8, border: "1px solid var(--outline-variant)", width: "fit-content" }}>
                  <button 
                    className={config.preferences.theme === "light" ? "primary-button" : "secondary-button"} 
                    onClick={() => setConfig({ ...config, preferences: { ...config.preferences, theme: "light" } })}
                    style={{ border: config.preferences.theme === "light" ? "" : "none", background: config.preferences.theme === "light" ? "var(--surface-container-lowest)" : "none", color: config.preferences.theme === "light" ? "var(--on-surface)" : "var(--on-surface-variant)", borderColor: "var(--outline-variant)", padding: "6px 16px", fontSize: 12, boxShadow: config.preferences.theme === "light" ? "var(--shadow-sm)" : "none" }} 
                    type="button"
                  >
                    <span className="material-symbols" style={{ fontSize: 18, marginRight: 8 }}>light_mode</span>
                    Light
                  </button>
                  <button 
                    className={config.preferences.theme === "dark" ? "primary-button" : "secondary-button"} 
                    onClick={() => setConfig({ ...config, preferences: { ...config.preferences, theme: "dark" } })}
                    style={{ border: config.preferences.theme === "dark" ? "" : "none", background: config.preferences.theme === "dark" ? "var(--surface-container-lowest)" : "none", color: config.preferences.theme === "dark" ? "var(--on-surface)" : "var(--on-surface-variant)", borderColor: "var(--outline-variant)", padding: "6px 16px", fontSize: 12, boxShadow: config.preferences.theme === "dark" ? "var(--shadow-sm)" : "none" }} 
                    type="button"
                  >
                    <span className="material-symbols" style={{ fontSize: 18, marginRight: 8 }}>dark_mode</span>
                    Dark
                  </button>
                  <button 
                    className={config.preferences.theme === "system" ? "primary-button" : "secondary-button"} 
                    onClick={() => setConfig({ ...config, preferences: { ...config.preferences, theme: "system" } })}
                    style={{ border: config.preferences.theme === "system" ? "" : "none", background: config.preferences.theme === "system" ? "var(--surface-container-lowest)" : "none", color: config.preferences.theme === "system" ? "var(--on-surface)" : "var(--on-surface-variant)", borderColor: "var(--outline-variant)", padding: "6px 16px", fontSize: 12, boxShadow: config.preferences.theme === "system" ? "var(--shadow-sm)" : "none" }} 
                    type="button"
                  >
                    <span className="material-symbols" style={{ fontSize: 18, marginRight: 8 }}>desktop_windows</span>
                    System
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 32, padding: "0 12px", display: "flex", justifyContent: "flex-end" }}>
            <button 
              className="primary-button" 
              onClick={async () => {
                setSaveAllLoading(true);
                try {
                  await saveSettings();
                } finally {
                  setSaveAllLoading(false);
                }
              }} 
              style={{ padding: "12px 32px", fontSize: 16, borderRadius: 12, boxShadow: "var(--shadow-md)" }}
              type="button"
            >
              {saveAllLoading ? "Memproses..." : "Save All Changes"}
            </button>
          </div>
        </div>
      )}

      {settingsTab === "knowledge-base" && (
        <div className="knowledge-base-stack" style={{ paddingTop: 8 }}>
          <div style={{ marginBottom: 24 }}>
            <p className="text-body-lg">Sinkronkan dokumen dari Confluence & Jira agar Chat Assistant menjawab pertanyaan berdasarkan data internal perusahaan Anda (RAG).</p>
          </div>

          {/* Prerequisite check */}
          {!config.ollama.endpoint && (
            <div className="surface-card" style={{ padding: 20, marginBottom: 24, borderLeft: "4px solid var(--color-warning, #FB8C00)", display: "flex", gap: 12, alignItems: "center" }}>
              <span className="material-symbols" style={{ color: "var(--color-warning, #FB8C00)", fontSize: 24 }}>warning</span>
              <div>
                <strong>Ollama diperlukan</strong>
                <p className="text-body-sm" style={{ margin: 0, opacity: 0.8 }}>Embedding model memerlukan Ollama. Pastikan Ollama berjalan dan model <code>nomic-embed-text</code> sudah di-pull.</p>
              </div>
            </div>
          )}

          {/* Stats Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div className="surface-card" style={{ padding: 20, textAlign: "center" }}>
              <span className="material-symbols" style={{ fontSize: 32, color: "var(--md-primary)", marginBottom: 8 }}>database</span>
              <div className="text-display" style={{ fontSize: 28 }}>{ragStats?.totalChunks ?? 0}</div>
              <div className="text-body-sm" style={{ opacity: 0.7 }}>Total Chunks</div>
            </div>
            <div className="surface-card" style={{ padding: 20, textAlign: "center" }}>
              <img src={confluenceIcon} alt="Confluence" style={{ width: 28, height: 28, marginBottom: 8 }} />
              <div className="text-display" style={{ fontSize: 28 }}>{ragStats?.confluencePages ?? 0}</div>
              <div className="text-body-sm" style={{ opacity: 0.7 }}>Confluence Pages ({ragStats?.confluenceChunks ?? 0} chunks)</div>
            </div>
            <div className="surface-card" style={{ padding: 20, textAlign: "center" }}>
              <img src={jiraIcon} alt="Jira" style={{ width: 28, height: 28, marginBottom: 8 }} />
              <div className="text-display" style={{ fontSize: 28 }}>{ragStats?.jiraIssues ?? 0}</div>
              <div className="text-body-sm" style={{ opacity: 0.7 }}>Jira Issues ({ragStats?.jiraChunks ?? 0} chunks)</div>
            </div>
          </div>

          {/* Last sync info */}
          {ragStats && (ragStats.lastConfluenceSync || ragStats.lastJiraSync) && (
            <div className="surface-card" style={{ padding: 16, marginBottom: 24, display: "flex", gap: 24, alignItems: "center" }}>
              <span className="material-symbols" style={{ fontSize: 20, opacity: 0.6 }}>schedule</span>
              {ragStats.lastConfluenceSync && (
                <span className="text-body-sm">Confluence sync terakhir: <strong>{new Date(ragStats.lastConfluenceSync).toLocaleString("id-ID")}</strong></span>
              )}
              {ragStats.lastJiraSync && (
                <span className="text-body-sm">Jira sync terakhir: <strong>{new Date(ragStats.lastJiraSync).toLocaleString("id-ID")}</strong></span>
              )}
            </div>
          )}

          {/* Progress indicator */}
          {ragProgress && ragLoading && (
            <div className="surface-card" style={{ padding: 20, marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <span className="material-symbols spin" style={{ fontSize: 20, color: "var(--md-primary)" }}>progress_activity</span>
                <span className="text-body" style={{ fontWeight: 500 }}>{ragProgress.message}</span>
              </div>
              {ragProgress.total > 0 && (
                <div style={{ width: "100%", height: 6, background: "var(--md-surface-variant, #e0e0e0)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.round((ragProgress.current / ragProgress.total) * 100)}%`,
                    height: "100%",
                    background: "var(--md-primary)",
                    borderRadius: 3,
                    transition: "width 0.3s ease",
                  }} />
                </div>
              )}
              {ragProgress.total > 0 && (
                <div className="text-body-sm" style={{ marginTop: 8, opacity: 0.6, textAlign: "right" }}>
                  {ragProgress.current} / {ragProgress.total}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div className="surface-card" style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <img src={confluenceIcon} alt="Confluence" style={{ width: 24, height: 24 }} />
                <h3 className="text-title" style={{ margin: 0 }}>Confluence Space</h3>
              </div>
              <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: 16 }}>
                Pilih space atau page ID yang ingin diindeks. (Misal: <strong>DEV</strong> atau <strong>1499888245</strong>)
              </p>
              <div style={{ marginBottom: 16 }}>
                <label className="text-body-sm" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>Target Space Key / Page ID</label>
                <input
                  type="text"
                  className="text-input"
                  value={ragSyncSpace}
                  onChange={(e) => setRagSyncSpace(e.target.value)}
                  placeholder="e.g. DEV atau 1499888245"
                  disabled={ragLoading !== null}
                />
              </div>
              <button
                className="primary-button"
                onClick={handleRagIndexConfluence}
                disabled={ragLoading !== null || !config.confluence.baseUrl || !config.ollama.endpoint || !ragSyncSpace.trim()}
                style={{ width: "100%", height: 42, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                type="button"
              >
                {ragLoading === "confluence" ? (
                  <span className="material-symbols spin" style={{ fontSize: 18 }}>progress_activity</span>
                ) : (
                  <span className="material-symbols" style={{ fontSize: 18 }}>sync</span>
                )}
                {ragLoading === "confluence" ? "Mengindeks..." : "Sync Confluence"}
              </button>
            </div>

            <div className="surface-card" style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <img src={jiraIcon} alt="Jira" style={{ width: 24, height: 24 }} />
                <h3 className="text-title" style={{ margin: 0 }}>Jira Project</h3>
              </div>
              <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: 16 }}>
                Pilih project yang ingin diindeks. Summary, description, dan komentar akan di-embed.
              </p>
              <div style={{ marginBottom: 16 }}>
                <label className="text-body-sm" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>Target Project Key</label>
                <input
                  type="text"
                  className="text-input"
                  value={ragSyncProject}
                  onChange={(e) => setRagSyncProject(e.target.value)}
                  placeholder="e.g. PAY"
                  disabled={ragLoading !== null}
                />
              </div>
              <button
                className="primary-button"
                onClick={handleRagIndexJira}
                disabled={ragLoading !== null || !config.jira.baseUrl || !config.ollama.endpoint || !ragSyncProject.trim()}
                style={{ width: "100%", height: 42, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                type="button"
              >
                {ragLoading === "jira" ? (
                  <span className="material-symbols spin" style={{ fontSize: 18 }}>progress_activity</span>
                ) : (
                  <span className="material-symbols" style={{ fontSize: 18 }}>sync</span>
                )}
                {ragLoading === "jira" ? "Mengindeks..." : "Sync Jira"}
              </button>
            </div>
          </div>

          {/* How it works + Clear */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <div className="surface-card" style={{ padding: 24 }}>
              <h3 className="text-title" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols" style={{ fontSize: 20 }}>info</span>
                Cara Kerja RAG
              </h3>
              <div className="text-body-sm" style={{ lineHeight: 1.8, opacity: 0.8 }}>
                <p style={{ margin: "0 0 8px" }}><strong>1.</strong> Dokumen dari Confluence/Jira diambil dan dipecah menjadi potongan teks kecil (chunks).</p>
                <p style={{ margin: "0 0 8px" }}><strong>2.</strong> Setiap chunk diubah menjadi vector embedding menggunakan model <code>nomic-embed-text</code> via Ollama.</p>
                <p style={{ margin: "0 0 8px" }}><strong>3.</strong> Saat Anda bertanya di Chat Assistant, pertanyaan dicocokkan dengan chunks yang paling relevan.</p>
                <p style={{ margin: 0 }}><strong>4.</strong> Chunks relevan dikirim bersama pertanyaan ke model AI untuk menghasilkan jawaban yang akurat.</p>
              </div>
            </div>

            <div className="surface-card" style={{ padding: 24 }}>
              <h3 className="text-title" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols" style={{ fontSize: 20, color: "var(--color-error, #d32f2f)" }}>delete_sweep</span>
                Hapus Index
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  className="secondary-button"
                  onClick={() => handleRagClear("confluence")}
                  disabled={ragLoading !== null || !ragStats?.confluenceChunks}
                  style={{ width: "100%", height: 36, fontSize: 13 }}
                  type="button"
                >
                  Hapus Confluence Index
                </button>
                <button
                  className="secondary-button"
                  onClick={() => handleRagClear("jira")}
                  disabled={ragLoading !== null || !ragStats?.jiraChunks}
                  style={{ width: "100%", height: 36, fontSize: 13 }}
                  type="button"
                >
                  Hapus Jira Index
                </button>
                <button
                  className="secondary-button"
                  onClick={() => handleRagClear()}
                  disabled={ragLoading !== null || !ragStats?.totalChunks}
                  style={{ width: "100%", height: 36, fontSize: 13, color: "var(--color-error, #d32f2f)" }}
                  type="button"
                >
                  Hapus Semua
                </button>
              </div>
            </div>
          </div>

          {/* Prerequisite info */}
          <div className="surface-card" style={{ padding: 20, marginTop: 24, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span className="material-symbols" style={{ fontSize: 20, color: "var(--md-primary)", flexShrink: 0 }}>lightbulb</span>
            <div className="text-body-sm" style={{ opacity: 0.7, lineHeight: 1.6 }}>
              <strong>Prerequisite:</strong> Pastikan model embedding sudah tersedia di Ollama Anda dengan running <code>ollama pull nomic-embed-text</code>.
              Setelah Knowledge Base terisi, Chat Assistant akan otomatis menggunakan konteks dari knowledge base untuk menjawab pertanyaan Anda.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
