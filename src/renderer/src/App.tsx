import React from "react";
import logo from "./assets/logo.png";
import { AppProvider, useApp } from "./context/AppContext";

import NavigationButton, { NavItem } from "./components/NavigationButton";
import Dashboard from "./screens/Dashboard";
import ChatAssistant from "./screens/ChatAssistant";
import ManualTestCaseScreen from "./screens/ManualTestCaseScreen";
import DocumentationSync from "./screens/DocumentationSync";
import AdvancedJiraOrganizer from "./screens/AdvancedJiraOrganizer";
import DailyUQA from "./screens/DailyUQA";
import Logs from "./screens/Logs";
import Settings from "./screens/Settings";
import Documentation from "./screens/Documentation";
import DefectRepository from "./screens/DefectRepository";

const primaryNavigation: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "grid_view", filledIcon: "grid_view" },
  { key: "chat-assistant", label: "Chat Assistant", icon: "chat_spark", filledIcon: "chat_spark" },
  { key: "manual-test-case", label: "Test Cases", icon: "assignment", filledIcon: "assignment" },
  { key: "documentation-sync", label: "Documentation Sync", icon: "description", filledIcon: "description" },
  { key: "advanced-jira-organizer", label: "Advanced Jira Organizer", icon: "account_tree", filledIcon: "account_tree" },
  { key: "daily-uqa", label: "Daily UQA", icon: "edit_note", filledIcon: "edit_note" },
  { key: "defect-repository", label: "Defect Repository", icon: "inventory_2", filledIcon: "inventory_2" },
];

const footerNavigation: NavItem[] = [
  { key: "logs", label: "Logs", icon: "list_alt", filledIcon: "list_alt" },
  { key: "settings", label: "Settings", icon: "settings", filledIcon: "settings" },
  { key: "documentation", label: "Documentation", icon: "menu_book", filledIcon: "menu_book" },
];

const allNavigation = [...primaryNavigation, ...footerNavigation];

function AppContent() {
  const {
    activeView,
    setActiveView,
    loading,
    config,
    setConfig,
    status,
    setStatus,
    banner,
    setBanner,
    connectionPills,
    downloadingUpdate,
    downloadProgress,
    setSettingsTab,
    setShowDetailedProgress,
  } = useApp();

  const currentNav = allNavigation.find((item) => item.key === activeView);
  const currentTitle = currentNav?.label || "Dashboard";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-title-row">
            <img src={logo} alt="QA Buddy Logo" className="brand-logo" />
            <h1>QA Buddy</h1>
          </div>
          <p>Quality Engineering Hub</p>
        </div>

        <nav className="nav-list">
          {primaryNavigation.map((item) => (
            <NavigationButton
              active={item.key === activeView}
              item={item}
              key={item.key}
              onClick={() => setActiveView(item.key)}
            />
          ))}
        </nav>

        {downloadingUpdate && (
          <div 
            onClick={() => {
              setActiveView("settings");
              setSettingsTab("updates");
              setShowDetailedProgress(true);
            }}
            style={{
              margin: "8px 12px",
              padding: "10px 12px",
              background: "rgba(8, 87, 195, 0.08)",
              borderRadius: "8px",
              border: "1px solid var(--tertiary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              transition: "all 0.2s ease"
            }}
            title="Klik untuk membuka detail unduhan"
          >
            <span className="material-symbols rotating" style={{ color: "var(--tertiary)", fontSize: 18 }}>sync</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--tertiary)" }}>Downloading update...</div>
              <div style={{ width: "100%", height: 4, background: "var(--surface-container-high)", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
                <div style={{ width: `${downloadProgress || 0}%`, height: "100%", background: "var(--tertiary)" }} />
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tertiary)" }}>
              {downloadProgress !== null ? `${Math.round(downloadProgress)}%` : "0%"}
            </span>
          </div>
        )}

        <div className="sidebar-footer">
          {footerNavigation.map((item) => (
            <NavigationButton
              active={item.key === activeView}
              item={item}
              key={item.key}
              onClick={() => setActiveView(item.key)}
            />
          ))}
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="material-symbols" style={{ fontSize: 20 }}>{currentNav?.icon || "dashboard"}</span>
            <h2 style={{ margin: 0 }}>{currentTitle}</h2>
          </div>
          <div className="topbar-right" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
            <div className="topbar-icons">
              <button
                onClick={() => {
                  const modes = ["light", "dark", "system"];
                  const idx = modes.indexOf(config.preferences.theme);
                  const next = modes[(idx + 1) % modes.length];
                  const updated = { ...config, preferences: { ...config.preferences, theme: next as any } };
                  setConfig(updated);
                  window.qaBuddy.saveConfig(updated).catch(() => {});
                }}
                title={`Theme: ${config.preferences.theme}`}
                className="icon-button"
                type="button"
              >
                <span className="material-symbols" style={{ fontSize: 20 }}>
                  {config.preferences.theme === "dark" ? "dark_mode" : config.preferences.theme === "system" ? "desktop_windows" : "light_mode"}
                </span>
              </button>
            </div>
            <div className="connection-indicators" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {connectionPills.map((pill) => (
                <span
                  key={pill.label}
                  className="connection-pill"
                  title={`${pill.label}: ${pill.item.message} — Click to re-check`}
                  onClick={() => { window.qaBuddy.testConnections().then(setStatus); }}
                >
                  <img src={pill.icon} alt={pill.label} style={{ width: 18, height: 18, objectFit: "contain" }} />
                  <span className={`connection-dot ${pill.item.ok ? "ok" : "fail"}`} />
                </span>
              ))}
            </div>

          </div>
        </header>

        <main className="content">
          {banner ? (
            <div className={`app-banner ${banner.tone}`}>
              <span>{banner.text}</span>
              <button className="ghost-button" onClick={() => setBanner(null)} type="button">
                Dismiss
              </button>
            </div>
          ) : null}

          {loading && <div className="card">Memuat workspace QA Buddy...</div>}

          {!loading && (
            <>
              {activeView === "dashboard" && <Dashboard />}
              {activeView === "chat-assistant" && <ChatAssistant />}
              {activeView === "manual-test-case" && <ManualTestCaseScreen />}
              {activeView === "documentation-sync" && <DocumentationSync />}
              {activeView === "advanced-jira-organizer" && <AdvancedJiraOrganizer />}
              {activeView === "daily-uqa" && <DailyUQA />}
              {activeView === "defect-repository" && <DefectRepository />}
              {activeView === "logs" && <Logs />}
              {activeView === "settings" && <Settings />}
              {activeView === "documentation" && <Documentation />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
