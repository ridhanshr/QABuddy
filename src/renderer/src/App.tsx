import React, { useState } from "react";
import logo from "./assets/logo.png";
import { AppProvider, useApp } from "./context/AppContext";
import Login from "./screens/Login";

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
import TestCycleManager from "./screens/TestCycleManager";
import ProjectManagement from "./screens/ProjectManagement";

const primaryNavigation: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "grid_view", filledIcon: "grid_view" },
  { key: "project-management", label: "Project Management", icon: "folder_open", filledIcon: "folder_open" },
  { key: "manual-test-case", label: "Test Cases Management", icon: "assignment", filledIcon: "assignment" },
  { key: "documentation-sync", label: "Test Evidence Management", icon: "description", filledIcon: "description" },
  { key: "defect-repository", label: "Test Defect Management", icon: "inventory_2", filledIcon: "inventory_2" },
  { key: "daily-uqa", label: "Daily Activities", icon: "edit_note", filledIcon: "edit_note" },
];

const footerNavigation: NavItem[] = [
  { key: "logs", label: "Logs", icon: "list_alt", filledIcon: "list_alt" },
  { key: "settings", label: "Settings", icon: "settings", filledIcon: "settings" },
  { key: "documentation", label: "Documentation", icon: "menu_book", filledIcon: "menu_book" },
];

const allNavigation = [...primaryNavigation, ...footerNavigation];

function AppContent({ onLogout, loggedInUser }: { onLogout: () => void; loggedInUser: string }) {
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
    brdGenerating,
    brdChunkProgress,
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
          <p>Buddy Up. Test Smarter.</p>
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

        {brdGenerating && (
          <div
            onClick={() => setActiveView("manual-test-case")}
            style={{
              margin: "8px 12px",
              padding: "10px 12px",
              background: "rgba(22, 163, 74, 0.08)",
              borderRadius: "8px",
              border: "1px solid #16a34a",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              transition: "all 0.2s ease",
            }}
            title="Klik untuk kembali ke halaman Generate Test Case"
          >
            <span className="material-symbols rotating" style={{ color: "#16a34a", fontSize: 18 }}>smart_toy</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#16a34a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                AI Generating Test Cases...
              </div>
              {brdChunkProgress && (
                <>
                  <div style={{ width: "100%", height: 4, background: "var(--surface-container-high)", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
                    <div style={{
                      width: `${Math.round((brdChunkProgress.done / Math.max(brdChunkProgress.total, 1)) * 100)}%`,
                      height: "100%",
                      background: "#16a34a",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--on-surface-variant)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {brdChunkProgress.done}/{brdChunkProgress.total} fitur
                    {brdChunkProgress.currentFeature ? ` — ${brdChunkProgress.currentFeature}` : ""}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

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

            {/* User info + logout */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, borderLeft: "1px solid var(--outline-variant)", paddingLeft: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: "var(--primary-container)",
                  color: "var(--on-primary-container)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700,
                }}>
                  {loggedInUser.slice(0, 2)}
                </div>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--on-surface-variant)" }}>
                  {loggedInUser}
                </span>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="icon-button"
                title="Logout"
                style={{ color: "var(--on-surface-variant)" }}
              >
                <span className="material-symbols" style={{ fontSize: 18 }}>logout</span>
              </button>
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
              {activeView === "project-management" && <ProjectManagement />}
              {activeView === "chat-assistant" && <ChatAssistant />}
              {activeView === "manual-test-case" && <ManualTestCaseScreen />}
              {activeView === "documentation-sync" && <DocumentationSync />}
              {activeView === "advanced-jira-organizer" && <AdvancedJiraOrganizer />}
              {activeView === "daily-uqa" && <DailyUQA />}
              {activeView === "defect-repository" && <DefectRepository />}
              {activeView === "test-cycle-manager" && <TestCycleManager />}
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

const SESSION_KEY = "qa-buddy-session";

export default function App() {
  const [loggedInUser, setLoggedInUser] = useState<string | null>(
    () => sessionStorage.getItem(SESSION_KEY)
  );

  const handleLogin = (username: string) => {
    sessionStorage.setItem(SESSION_KEY, username);
    setLoggedInUser(username);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setLoggedInUser(null);
  };

  if (!loggedInUser) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <AppProvider>
      <AppContent onLogout={handleLogout} loggedInUser={loggedInUser} />
    </AppProvider>
  );
}
