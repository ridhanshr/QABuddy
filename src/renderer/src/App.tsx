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
import DocumentationReview from "./screens/DocumentationReview";
import DefectRepository from "./screens/DefectRepository";
import TestCycleManager from "./screens/TestCycleManager";
import ProjectManagement from "./screens/ProjectManagement";
import ScreenHero from "./components/ScreenHero";

const primaryNavigation: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "grid_view", filledIcon: "grid_view" },
  { key: "project-management", label: "Project Management", icon: "folder_open", filledIcon: "folder_open" },
  { key: "manual-test-case", label: "Test Cases Management", icon: "assignment", filledIcon: "assignment" },
  { key: "documentation-sync", label: "Test Evidence Management", icon: "description", filledIcon: "description" },
  { key: "defect-repository", label: "Test Defect Management", icon: "inventory_2", filledIcon: "inventory_2" },
  { key: "daily-uqa", label: "Daily Activities", icon: "edit_note", filledIcon: "edit_note" },
  { key: "document-review", label: "QA Document Review", icon: "fact_check", filledIcon: "fact_check" },
];

const footerNavigation: NavItem[] = [
  { key: "logs", label: "Logs", icon: "notifications", filledIcon: "notifications" },
  { key: "settings", label: "Settings", icon: "settings", filledIcon: "settings" },
  { key: "documentation", label: "Documentation", icon: "menu_book", filledIcon: "menu_book" },
];

const allNavigation = [...primaryNavigation, ...footerNavigation];

const screenHero: Record<string, { icon: string; title: string; description: string }> = {
  dashboard: { icon: "dashboard", title: "QA Dashboard", description: "Pantau kualitas, aktivitas, dan pekerjaan QA dari satu workspace." },
  "project-management": { icon: "folder_open", title: "Project Management", description: "Kelola project, test plan, dan test execution Jira." },
  "manual-test-case": { icon: "assignment", title: "Test Cases Management", description: "Create, organize, extract, and sync your manual test repository." },
  "documentation-sync": { icon: "description", title: "Test Evidence Management", description: "Review evidence dan sinkronkan hasil pengujian dengan Jira dan Confluence." },
  "defect-repository": { icon: "inventory_2", title: "Test Defect Management", description: "Cari, kelola, dan sinkronkan defect dari Jira." },
  "daily-uqa": { icon: "edit_note", title: "Daily Activities", description: "Pantau aktivitas UQA dan status pekerjaan harian." },
  "document-review": { icon: "fact_check", title: "QA Document Review", description: "Validate document content, hierarchy, and Jira/Xray execution metrics." },
  logs: { icon: "notifications", title: "Logs", description: "Lihat riwayat aktivitas dan hasil operasi QA Buddy." },
  settings: { icon: "settings", title: "Settings", description: "Atur koneksi, preferensi, dan integrasi workspace." },
  documentation: { icon: "menu_book", title: "Documentation", description: "Pelajari fitur dan alur kerja QA Buddy." },
};

function AppContent({ onLogout, loggedInUser, loggedInRole }: { onLogout: () => void; loggedInUser: string; loggedInRole: string }) {
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
    manualLoading,
    flushTokensOnLogout,
  } = useApp();

  const visibleNavigation = primaryNavigation.filter((item) => {
    if (item.key === "project-management" && loggedInRole === "Product Tester") return false;
    return true;
  });

  const currentNav = allNavigation.find((item) => item.key === activeView);
  const currentTitle = currentNav?.label || "Dashboard";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas font-sans text-ink">
      {/* ── Sidebar ── */}
      <aside className="app-sidebar flex w-[264px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Navigasi utama">
        <div className="border-b border-line px-5 pb-4 pt-6">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="QA Buddy Logo" className="h-8 w-8 object-contain" />
            <div>
              <h1 className="text-[15px] font-bold leading-none tracking-tight">QA Buddy</h1>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-faint">Buddy Up. Test Smarter.</p>
        </div>

        <nav className="app-nav flex-1 space-y-0.5 overflow-y-auto p-2.5">
          <div className="nav-section-label">Workspace</div>
          {visibleNavigation.map((item) => (
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
            className="mx-2.5 mb-2 flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors"
            style={{
              background: "color-mix(in srgb, var(--success) 7%, var(--surface))",
              borderColor: "color-mix(in srgb, var(--success) 30%, transparent)",
            }}
            title="Klik untuk kembali ke halaman Generate Test Case"
          >
            <span className="material-symbols rotating text-[18px]" style={{ color: "var(--success)" }}>smart_toy</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold" style={{ color: "var(--success)" }}>
                AI Generating Test Cases...
              </div>
              {brdChunkProgress && (
                <>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-high">
                    <div
                      className="h-full rounded-full transition-all duration-400"
                      style={{
                        width: `${Math.round((brdChunkProgress.done / Math.max(brdChunkProgress.total, 1)) * 100)}%`,
                        background: "var(--success)",
                      }}
                    />
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted">
                    {brdChunkProgress.done}/{brdChunkProgress.total} fitur
                    {brdChunkProgress.currentFeature ? ` — ${brdChunkProgress.currentFeature}` : ""}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {(brdGenerating || downloadingUpdate) && (
          <div className="mx-2.5 mb-2 rounded-lg border border-line bg-surface-low px-3 py-2.5" role="status" aria-live="polite">
            <div className="flex items-center gap-2">
              <span className="material-symbols rotating text-[17px]" style={{ color: "var(--primary)" }}>sync</span>
              <span className="truncate text-[11px] font-semibold" style={{ color: "var(--on-surface)" }}>
                {brdGenerating ? "AI sedang membuat test case..." : "Update sedang diunduh..."}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-high">
              <div className="jira-sync-progress h-full rounded-full" style={{ width: brdGenerating && brdChunkProgress ? `${Math.round((brdChunkProgress.done / Math.max(brdChunkProgress.total, 1)) * 100)}%` : "38%", background: "var(--primary)" }} />
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
            className="mx-2.5 mb-2 flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors"
            style={{
              background: "color-mix(in srgb, var(--primary) 6%, var(--surface))",
              borderColor: "color-mix(in srgb, var(--primary) 28%, transparent)",
            }}
            title="Klik untuk membuka detail unduhan"
          >
            <span className="material-symbols rotating text-[18px] text-primary">sync</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-primary">Downloading update...</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-high">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${downloadProgress || 0}%` }}
                />
              </div>
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-primary">
              {downloadProgress !== null ? `${Math.round(downloadProgress)}%` : "0%"}
            </span>
          </div>
        )}

        <div className="app-nav-footer space-y-0.5 border-t border-line p-2.5">
          <div className="nav-section-label">System</div>
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

      {/* ── Main column ── */}
       <div className="app-main flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line px-6"
          style={{ background: "var(--glass-topbar)", backdropFilter: "blur(12px)" }}
        >
          <h2 className="text-[15px] font-semibold">{currentTitle}</h2>

          <div className="flex items-center gap-3">
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
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-mid hover:text-ink"
              type="button"
            >
              <span className="material-symbols text-[20px]">
                {config.preferences.theme === "dark" ? "dark_mode" : config.preferences.theme === "system" ? "desktop_windows" : "light_mode"}
              </span>
            </button>

            <div className="connection-indicators flex items-center gap-2.5">
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

            <div className="h-6 w-px bg-line" />

            {/* User info + logout */}
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-on-primary">
                  {loggedInUser.slice(0, 2)}
                </span>
                <span className="max-w-[140px] truncate text-xs font-medium text-muted">{loggedInUser}</span>
              </div>
              <button
                type="button"
                onClick={async () => { await flushTokensOnLogout(); onLogout(); }}
                className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-mid hover:text-ink"
                title="Logout"
              >
                <span className="material-symbols text-[18px]">logout</span>
              </button>
            </div>
          </div>
        </header>

        <main className="app-content flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] p-6">
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
                {manualLoading && (
                  <div className="screen-progress-panel" role="status" aria-live="polite">
                    <div className="screen-progress-title"><span className="material-symbols rotating">sync</span> Mengirim test case ke Jira...</div>
                    <div className="screen-progress-track"><div className="screen-progress-bar jira-sync-progress" /></div>
                    <div className="screen-progress-note">Memeriksa duplikat, membuat test case, dan menghubungkan execution. Jangan tutup halaman.</div>
                  </div>
                )}
                {screenHero[activeView] && <ScreenHero {...screenHero[activeView]} />}
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
                {activeView === "document-review" && <DocumentationReview />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

const SESSION_KEY = "qa-buddy-session";
const SESSION_ROLE_KEY = "qa-buddy-role";
const SESSION_JIRA_TOKEN_KEY = "qa-buddy-jira-token";
const SESSION_CONF_TOKEN_KEY = "qa-buddy-conf-token";

export default function App() {
  const [loggedInUser, setLoggedInUser] = useState<string | null>(
    () => sessionStorage.getItem(SESSION_KEY)
  );
  const [loggedInRole, setLoggedInRole] = useState<string>(
    () => sessionStorage.getItem(SESSION_ROLE_KEY) ?? ""
  );
  const [jiraToken, setJiraToken] = useState<string>(
    () => sessionStorage.getItem(SESSION_JIRA_TOKEN_KEY) ?? ""
  );
  const [confToken, setConfToken] = useState<string>(
    () => sessionStorage.getItem(SESSION_CONF_TOKEN_KEY) ?? ""
  );

  const handleLogin = (username: string, role: string, jiraApiToken: string, confluenceApiToken: string) => {
    sessionStorage.setItem(SESSION_KEY, username);
    sessionStorage.setItem(SESSION_ROLE_KEY, role);
    sessionStorage.setItem(SESSION_JIRA_TOKEN_KEY, jiraApiToken);
    sessionStorage.setItem(SESSION_CONF_TOKEN_KEY, confluenceApiToken);
    setLoggedInUser(username);
    setLoggedInRole(role);
    setJiraToken(jiraApiToken);
    setConfToken(confluenceApiToken);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_ROLE_KEY);
    sessionStorage.removeItem(SESSION_JIRA_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_CONF_TOKEN_KEY);
    setLoggedInUser(null);
    setLoggedInRole("");
    setJiraToken("");
    setConfToken("");
  };

  // Login form only applies to production (built) builds. In development the
  // app opens directly as VITE_DEV_PN (set in .env) so features that filter
  // by PN/username behave the same as a real login, without needing to
  // log in manually on every `npm run dev`. Falls back to "dev" if unset.
  const isDev = import.meta.env.DEV;
  const devPn = (import.meta.env.VITE_DEV_PN as string | undefined) || "dev";
  const activeUser = loggedInUser ?? (isDev ? devPn : null);

  if (!activeUser) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <AppProvider loggedInUser={activeUser} jiraToken={jiraToken} confToken={confToken}>
      <AppContent onLogout={handleLogout} loggedInUser={activeUser} loggedInRole={loggedInRole} />
    </AppProvider>
  );
}
