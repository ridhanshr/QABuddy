import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context/AppContext";
import type { JiraProjectSource, DuplicateCandidate, DefectCreateDraft, BugFormDraft, BugPreview } from "@shared/types";

const duplicateCandidateThreshold = 20;
const defectIssueTypeOptions = ["Bug", "Task", "Defect"] as const;
const autoSyncDayOptions = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

type JiraProjectSourceDraft = Omit<JiraProjectSource, "autoSyncEnabled" | "autoSyncDays" | "autoSyncTime" | "issueTypes" | "lastAutoSyncAt"> & {
  autoSyncEnabled: boolean;
  autoSyncDays: number[];
  autoSyncTime: string;
  issueTypes: string[];
  lastAutoSyncAt: string | null;
};

function createEmptySourceDraft(source?: JiraProjectSource | null): JiraProjectSourceDraft {
  return {
    id: source?.id || "",
    projectKey: source?.projectKey || "",
    projectName: source?.projectName || "",
    isActive: source?.isActive ?? true,
    lastSyncedAt: source?.lastSyncedAt ?? null,
    autoSyncEnabled: source?.autoSyncEnabled ?? false,
    autoSyncDays: source?.autoSyncDays?.length ? [...source.autoSyncDays] : [1, 2, 3, 4, 5],
    autoSyncTime: source?.autoSyncTime || "09:00",
    issueTypes: source?.issueTypes?.length ? [...source.issueTypes] : [...defectIssueTypeOptions],
    lastAutoSyncAt: source?.lastAutoSyncAt ?? null,
    syncMode: source?.syncMode || "initial",
    syncStatus: source?.syncStatus || "idle",
    errorMessage: source?.errorMessage,
  };
}

function createEmptyDraft(projectKey = ""): DefectCreateDraft {
  return {
    projectKey,
    issueType: "Bug",
    summary: "",
    description: "",
    stepsToReproduce: "",
    expectedResult: "",
    actualResult: "",
    environment: "",
    priority: "Medium",
    labels: "",
    component: "",
    version: "",
    severity: "",
  };
}

function buildDuplicateQuery(draft: DefectCreateDraft): string {
  return [
    draft.summary,
    draft.description,
    draft.stepsToReproduce,
    draft.expectedResult,
    draft.actualResult,
    draft.component,
    draft.version,
    draft.severity,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function buildDuplicateFiltersFromDraft(draft: DefectCreateDraft) {
  return {
    query: buildDuplicateQuery(draft),
    projectKeys: [draft.projectKey],
    issueTypes: [...defectIssueTypeOptions],
  };
}

export default function DefectRepository() {
  const app = useApp();
  const [searchInput, setSearchInput] = useState("");
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string[]>([]);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string[]>([]);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string[]>([]);
  const [showDuplicateFor, setShowDuplicateFor] = useState<string | null>(null);
  const [showCreateDefect, setShowCreateDefect] = useState(false);
  const [createDraft, setCreateDraft] = useState<DefectCreateDraft>(createEmptyDraft());
  const [createDuplicateCandidates, setCreateDuplicateCandidates] = useState<DuplicateCandidate[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createInfo, setCreateInfo] = useState<string | null>(null);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState<JiraProjectSourceDraft | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishPreview, setPolishPreview] = useState<BugPreview | null>(null);

  useEffect(() => {
    app.loadDefectSources();
    app.loadDefectStats();
  }, []);

  useEffect(() => {
    const shouldLockScroll = showCreateDefect || showDuplicateWarning || sourceEditorOpen;
    if (!shouldLockScroll) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showCreateDefect, showDuplicateWarning, sourceEditorOpen]);

  useEffect(() => {
    if (showCreateDefect && !createDraft.projectKey) {
      const firstProject = [...new Set(app.defectSources.map((source) => source.projectKey).filter(Boolean))][0] || "";
      if (firstProject) {
        setCreateDraft((prev) => ({ ...prev, projectKey: firstProject }));
      }
    }
  }, [app.defectSources, createDraft.projectKey, showCreateDefect]);

  useEffect(() => {
    if (app.defectTab === "repository" && app.defectSearchResults.length === 0 && !app.defectSearching) {
      app.loadAllDefects();
    }
    if (app.defectTab === "stats") {
      app.loadDefectStats();
    }
  }, [app.defectTab]);

  const defectProjectOptions = [...new Map(app.defectSources.map((source) => [source.projectKey, source])).values()]
    .filter((source) => source.projectKey.trim().length > 0)
    .sort((a, b) => a.projectKey.localeCompare(b.projectKey));
  const allProjects = [...new Set(app.defectSearchResults.map(d => d.sourceProjectKey))];
  const allTypes = [...new Set(app.defectSearchResults.map(d => d.issueType))];
  const allStatuses = [...new Set(app.defectSearchResults.map(d => d.status))];
  const visibleCandidates = app.defectCandidates.filter(c => c.score >= duplicateCandidateThreshold);

  const openCreateDefect = () => {
    const firstProject = defectProjectOptions[0]?.projectKey || "";
    setCreateDraft(createEmptyDraft(firstProject));
    setCreateError(null);
    setCreateInfo(null);
    setCreateDuplicateCandidates([]);
    setShowDuplicateWarning(false);
    setPolishPreview(null);
    setShowCreateDefect(true);
  };

  const resetCreateDefect = () => {
    setShowCreateDefect(false);
    setShowDuplicateWarning(false);
    setCreateDuplicateCandidates([]);
    setCreateSubmitting(false);
    setCreateError(null);
    setCreateInfo(null);
    setPolishPreview(null);
    setCreateDraft(createEmptyDraft(defectProjectOptions[0]?.projectKey || ""));
  };

  const openSourceEditor = (source?: JiraProjectSource | null) => {
    setSourceDraft(createEmptySourceDraft(source || null));
    setSourceError(null);
    setSourceEditorOpen(true);
    app.setDefectShowNewSource(false);
  };

  const closeSourceEditor = () => {
    setSourceEditorOpen(false);
    setSourceDraft(null);
    setSourceError(null);
    app.setDefectShowNewSource(false);
  };

  const toggleSourceAutoSyncDay = (day: number) => {
    setSourceDraft((prev) => {
      if (!prev) return prev;
      const exists = prev.autoSyncDays.includes(day);
      const nextDays = exists
        ? prev.autoSyncDays.filter((value) => value !== day)
        : [...prev.autoSyncDays, day];
      return {
        ...prev,
        autoSyncDays: nextDays.sort((a, b) => a - b),
      };
    });
  };

  const toggleSourceIssueType = (issueType: string) => {
    setSourceDraft((prev) => {
      if (!prev) return prev;
      const normalized = issueType.trim();
      if (!normalized) return prev;
      const exists = prev.issueTypes.some((value) => value.toLowerCase() === normalized.toLowerCase());
      const nextTypes = exists
        ? prev.issueTypes.filter((value) => value.toLowerCase() !== normalized.toLowerCase())
        : [...prev.issueTypes, normalized];
      return {
        ...prev,
        issueTypes: nextTypes,
      };
    });
  };

  const updateSourceDraft = (patch: Partial<JiraProjectSource>) => {
    setSourceDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const saveSourceDraft = async () => {
    if (!sourceDraft) return;
    if (!sourceDraft.projectKey.trim()) {
      setSourceError("Project key wajib diisi.");
      return;
    }

    try {
      await app.handleDefectSaveSource({
        ...sourceDraft,
        projectKey: sourceDraft.projectKey.trim().toUpperCase(),
        projectName: sourceDraft.projectName.trim(),
        autoSyncDays: [...new Set(sourceDraft.autoSyncDays)].sort((a, b) => a - b),
        issueTypes: [...new Set(sourceDraft.issueTypes.map((type) => type.trim()).filter(Boolean))],
      });
      closeSourceEditor();
    } catch (error: any) {
      setSourceError(error?.message || "Gagal menyimpan source.");
    }
  };

  const submitCreateDefect = async (forceCreate = false) => {
    const summary = createDraft.summary.trim();
    if (!createDraft.projectKey.trim()) {
      setCreateError("Pilih project Jira terlebih dahulu.");
      return;
    }
    if (!createDraft.issueType.trim()) {
      setCreateError("Pilih issue type terlebih dahulu.");
      return;
    }
    if (!summary) {
      setCreateError("Summary wajib diisi.");
      return;
    }

    setCreateSubmitting(true);
    setCreateError(null);
    setCreateInfo(null);

    try {
      if (!forceCreate) {
        const duplicateFilters = buildDuplicateFiltersFromDraft(createDraft);
        if (!duplicateFilters.query.trim()) {
          setCreateError("Isi summary atau deskripsi terlebih dahulu agar pengecekan duplicate bisa dijalankan.");
          return;
        }

        const candidates = (await window.qaBuddy.findDefectDuplicateCandidates(duplicateFilters))
          .filter((candidate) => candidate.score >= duplicateCandidateThreshold);
        if (candidates.length > 0) {
          setCreateDuplicateCandidates(candidates.slice(0, 5));
          setShowDuplicateWarning(true);
          setCreateSubmitting(false);
          return;
        }
      }

      const result = await window.qaBuddy.createDefectIssue(createDraft);
      setCreateInfo(`Defect ${result.key} berhasil dibuat.`);
      setShowDuplicateWarning(false);
      setCreateDuplicateCandidates([]);
      setShowCreateDefect(false);
      await app.handleDefectSync(createDraft.projectKey);
      app.setDefectTab("repository");
    } catch (error: any) {
      setCreateError(error?.message || "Gagal membuat defect.");
    } finally {
      setCreateSubmitting(false);
    }
  };

  const polishDefectDraft = async () => {
    if (!createDraft.summary.trim()) {
      setCreateError("Isi Summary terlebih dahulu sebelum menggunakan AI Polish.");
      return;
    }
    setPolishing(true);
    setCreateError(null);
    try {
      const bugDraft: BugFormDraft = {
        title: createDraft.summary,
        stepsToReproduce: createDraft.stepsToReproduce,
        actualResult: createDraft.actualResult,
        expectedResult: createDraft.expectedResult,
        environment: createDraft.environment,
        priority: createDraft.priority,
        labels: createDraft.labels,
      };
      const preview = await window.qaBuddy.polishBugReport(bugDraft);
      setPolishPreview(preview);
      setCreateDraft((prev) => ({
        ...prev,
        summary: preview.summary,
        description: preview.description,
        priority: preview.priority,
        labels: preview.labels.join(", "),
      }));
    } catch (error: any) {
      setCreateError(error?.message || "Gagal memproses AI Polish.");
    } finally {
      setPolishing(false);
    }
  };

  const doSearch = () => {
    const filters = {
      query: searchInput,
      projectKeys: selectedProjectFilter.length > 0 ? selectedProjectFilter : undefined,
      issueTypes: selectedTypeFilter.length > 0 ? selectedTypeFilter : undefined,
      statuses: selectedStatusFilter.length > 0 ? selectedStatusFilter : undefined,
    };
    app.setDefectFilters(filters);
    app.setDefectSearchQuery(searchInput);
    app.handleDefectSearch(searchInput, filters);
  };

  if (app.defectTab === "sources") {
    return (
      <section className="defect-repo-section">
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Jira Source Configuration</h3>
            <button className="ghost-button" onClick={() => app.setDefectTab("repository")} type="button">
              <span className="material-symbols" style={{ fontSize: 16 }}>arrow_back</span> Back
            </button>
          </div>

          <div style={{ marginBottom: 12 }}>
            {app.defectSources.length === 0 ? (
              <div className="empty-state" style={{ padding: "40px 0", textAlign: "center" }}>
                <span className="material-symbols filled" style={{ fontSize: 40, color: "var(--on-surface-variant)", marginBottom: 8, display: "block" }}>source</span>
                <p style={{ color: "var(--on-surface-variant)", margin: 0 }}>No Jira project sources configured yet.</p>
                <button className="insight-btn primary" style={{ marginTop: 12 }} onClick={() => openSourceEditor()} type="button">
                  <span className="material-symbols" style={{ fontSize: 16 }}>add</span> Add Source
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button className="insight-btn primary" onClick={() => openSourceEditor()} type="button">
                    <span className="material-symbols" style={{ fontSize: 16 }}>add</span> Add Source
                  </button>
                </div>

                {app.defectSources.map(source => (
                  <div key={source.id} className="card" style={{ padding: 16, marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <strong style={{ fontSize: 15 }}>{source.projectKey}</strong>
                          {source.projectName && <span style={{ color: "var(--on-surface-variant)" }}>({source.projectName})</span>}
                          <span
                            className="defect-score-badge"
                            style={{
                              background: source.isActive ? "rgba(34, 197, 94, 0.12)" : "rgba(107, 114, 128, 0.12)",
                              color: source.isActive ? "#15803d" : "var(--font-secondary)",
                            }}
                          >
                            {source.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, fontSize: 12, color: "var(--on-surface-variant)" }}>
                          <span>Sync: {source.syncStatus === "success" ? "Success" : source.syncStatus === "syncing" ? "Syncing..." : source.syncStatus === "error" ? "Error" : "Idle"}</span>
                          {source.lastSyncedAt && <span>Last sync: {new Date(source.lastSyncedAt).toLocaleString()}</span>}
                          {source.lastAutoSyncAt && <span>Last auto sync: {new Date(source.lastAutoSyncAt).toLocaleString()}</span>}
                          {source.errorMessage && <span style={{ color: "var(--error)" }}>{source.errorMessage}</span>}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                          <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "var(--surface-container-high)" }}>
                            Auto sync: {source.autoSyncEnabled ? "Enabled" : "Disabled"}
                          </span>
                          {source.autoSyncEnabled && (
                            <>
                              <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "var(--surface-container-high)" }}>
                                Days: {source.autoSyncDays?.length ? formatAutoSyncDays(source.autoSyncDays) : "None"}
                              </span>
                              <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "var(--surface-container-high)" }}>
                                Time: {source.autoSyncTime || "-"}
                              </span>
                            </>
                          )}
                          <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "var(--surface-container-high)" }}>
                            Issue types: {formatIssueTypes(source.issueTypes || [])}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                          className="ghost-button"
                          onClick={() => openSourceEditor(source)}
                          type="button"
                          style={{ display: "flex", alignItems: "center", gap: 4 }}
                        >
                          <span className="material-symbols" style={{ fontSize: 16 }}>edit</span>
                          Edit
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => app.handleDefectSync(source.projectKey)}
                          disabled={app.defectSyncing === source.projectKey}
                          type="button"
                          style={{ display: "flex", alignItems: "center", gap: 4 }}
                        >
                          <span className="material-symbols" style={{ fontSize: 16, animation: app.defectSyncing === source.projectKey ? "spin 1s linear infinite" : "none" }}>sync</span>
                          {app.defectSyncing === source.projectKey ? "Syncing..." : "Sync"}
                        </button>
                        <button
                          className="ghost-button"
                          style={{ color: "var(--error)" }}
                          onClick={() => app.handleDefectDeleteSource(source.id)}
                          type="button"
                        >
                          <span className="material-symbols" style={{ fontSize: 16 }}>delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {sourceEditorOpen && sourceDraft && createPortal(
          <div className="dialog-overlay" onClick={closeSourceEditor} style={{ zIndex: 320 }}>
            <div
              className="dialog defect-create-dialog source-config-dialog"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="source-config-title"
            >
              <div className="dialog-header defect-create-dialog-header">
                <div className="dialog-header-info">
                  <h3 className="dialog-title" id="source-config-title">
                    {sourceDraft.id ? "Edit Jira Source" : "Add Jira Source"}
                  </h3>
                  <p className="dialog-subtitle">
                    Atur project target, auto-sync schedule, dan issue type yang akan diambil dari Jira.
                  </p>
                </div>
                <div className="dialog-header-actions">
                  <button className="ghost-button" onClick={closeSourceEditor} type="button" title="Tutup">
                    <span className="material-symbols">close</span>
                  </button>
                </div>
              </div>

              <div className="dialog-body defect-create-dialog-body">
                {sourceError && <div className="defect-banner defect-banner-error">{sourceError}</div>}

                <form
                  className="defect-create-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveSourceDraft();
                  }}
                >
                  <div className="defect-form-grid">
                    <label className="defect-field">
                      <span>Project Key</span>
                      <input
                        className="input"
                        value={sourceDraft.projectKey}
                        onChange={(e) => updateSourceDraft({ projectKey: e.target.value.toUpperCase() })}
                        placeholder="QA"
                        required
                      />
                    </label>

                    <label className="defect-field">
                      <span>Project Name</span>
                      <input
                        className="input"
                        value={sourceDraft.projectName}
                        onChange={(e) => updateSourceDraft({ projectName: e.target.value })}
                        placeholder="Quality Assurance"
                      />
                    </label>

                    <label className="defect-field">
                      <span>Status</span>
                      <select
                        className="input"
                        value={sourceDraft.isActive ? "active" : "inactive"}
                        onChange={(e) => updateSourceDraft({ isActive: e.target.value === "active" })}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>

                    <label className="defect-field">
                      <span>Auto Sync</span>
                      <select
                        className="input"
                        value={sourceDraft.autoSyncEnabled ? "enabled" : "disabled"}
                        onChange={(e) => updateSourceDraft({ autoSyncEnabled: e.target.value === "enabled" })}
                      >
                        <option value="disabled">Disabled</option>
                        <option value="enabled">Enabled</option>
                      </select>
                    </label>

                    <div className="defect-field defect-field-wide">
                      <span>Auto Sync Days</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {autoSyncDayOptions.map((day) => {
                          const selected = sourceDraft.autoSyncDays.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              className={`insight-btn ${selected ? "primary" : "secondary"}`}
                              onClick={() => toggleSourceAutoSyncDay(day.value)}
                              style={{ minWidth: 68 }}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <label className="defect-field">
                      <span>Auto Sync Time</span>
                      <input
                        className="input"
                        type="time"
                        value={sourceDraft.autoSyncTime}
                        onChange={(e) => updateSourceDraft({ autoSyncTime: e.target.value })}
                        disabled={!sourceDraft.autoSyncEnabled}
                      />
                    </label>

                    <div className="defect-field defect-field-wide">
                      <span>Issue Types</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {defectIssueTypeOptions.map((issueType) => {
                          const selected = sourceDraft.issueTypes.some((value) => value.toLowerCase() === issueType.toLowerCase());
                          return (
                            <button
                              key={issueType}
                              type="button"
                              className={`insight-btn ${selected ? "primary" : "secondary"}`}
                              onClick={() => toggleSourceIssueType(issueType)}
                            >
                              {issueType}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="defect-create-actions">
                    <button className="ghost-button" type="button" onClick={closeSourceEditor}>
                      Cancel
                    </button>
                    <button className="insight-btn primary" type="submit">
                      <span className="material-symbols" style={{ fontSize: 16 }}>save</span>
                      Save Source
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>,
          document.body
        )}
      </section>
    );
  }

  if (app.defectTab === "detail" && app.defectViewDefect) {
    const d = app.defectViewDefect;
    return (
      <section className="defect-repo-section">
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Defect Detail: {d.sourceIssueKey}</h3>
            <button className="ghost-button" onClick={() => { app.setDefectTab("repository"); }} type="button">
              <span className="material-symbols" style={{ fontSize: 16 }}>arrow_back</span> Back
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, color: "var(--on-surface-variant)" }}>Project</label>
              <p style={{ margin: "4px 0" }}>{d.sourceProjectKey}</p>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, color: "var(--on-surface-variant)" }}>Issue Type</label>
              <p style={{ margin: "4px 0" }}>{d.issueType}</p>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, color: "var(--on-surface-variant)" }}>Status</label>
              <p style={{ margin: "4px 0" }}>{d.status}</p>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, color: "var(--on-surface-variant)" }}>Severity</label>
              <p style={{ margin: "4px 0" }}>{d.severity}</p>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, color: "var(--on-surface-variant)" }}>Component</label>
              <p style={{ margin: "4px 0" }}>{d.component || "-"}</p>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, color: "var(--on-surface-variant)" }}>Version</label>
              <p style={{ margin: "4px 0" }}>{d.version || "-"}</p>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ fontWeight: 600, fontSize: 12, color: "var(--on-surface-variant)" }}>Normalized Title</label>
            <p style={{ margin: "4px 0" }}>{d.normalizedTitle}</p>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontWeight: 600, fontSize: 12, color: "var(--on-surface-variant)" }}>Normalized Description</label>
            <p style={{ margin: "4px 0", fontSize: 13, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{d.normalizedDescription || "-"}</p>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontWeight: 600, fontSize: 12, color: "var(--on-surface-variant)" }}>Timestamps</label>
            <p style={{ margin: "4px 0", fontSize: 12 }}>
              Created: {new Date(d.createdAt).toLocaleString()} &middot; Updated: {new Date(d.updatedAt).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Duplicate Relations */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h4 style={{ margin: 0 }}>Duplicate Relations</h4>
            <button className="ghost-button" onClick={() => {
              setShowDuplicateFor(showDuplicateFor === d.id ? null : d.id);
            }} type="button">
              <span className="material-symbols" style={{ fontSize: 16 }}>link</span> Link Duplicate
            </button>
          </div>

          {app.defectViewRelations.length === 0 ? (
            <p style={{ color: "var(--on-surface-variant)", fontSize: 13 }}>No duplicate relations.</p>
          ) : (
            app.defectViewRelations.map(r => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--surface-container-high)" }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {r.primaryDefectId === d.id ? "Duplicate of" : "Has duplicate"}:
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 13 }}>
                    {r.primaryDefectId === d.id ? r.duplicateDefectId : r.primaryDefectId}
                  </span>
                  {r.reason && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--on-surface-variant)" }}>({r.reason})</span>}
                </div>
                <button className="ghost-button" style={{ color: "var(--error)" }} onClick={() => app.handleDefectRemoveDuplicate(r.id)} type="button">
                  <span className="material-symbols" style={{ fontSize: 16 }}>unlink</span>
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  if (app.defectTab === "stats") {
    const stats = app.defectStats;
    return (
      <section className="defect-repo-section">
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Defect Repository Statistics</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ghost-button" onClick={() => app.loadDefectStats()} type="button">
                <span className="material-symbols" style={{ fontSize: 16 }}>refresh</span> Refresh
              </button>
              <button className="ghost-button" onClick={() => app.setDefectTab("repository")} type="button">
                <span className="material-symbols" style={{ fontSize: 16 }}>arrow_back</span> Back
              </button>
            </div>
          </div>

          {!stats ? (
            <p>Loading stats...</p>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
                <div className="stat-card" style={{ padding: 16, background: "var(--surface-container)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.totalDefects}</div>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>Total Defects</div>
                </div>
                <div className="stat-card" style={{ padding: 16, background: "var(--surface-container)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.totalDuplicates}</div>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>Total Duplicates</div>
                </div>
                <div className="stat-card" style={{ padding: 16, background: "var(--surface-container)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.defectsPerProject.length}</div>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>Projects</div>
                </div>
                <div className="stat-card" style={{ padding: 16, background: "var(--surface-container)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.topComponents.length}</div>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>Components</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <h4 style={{ margin: "0 0 8px" }}>Defects per Project</h4>
                  <table className="table" style={{ width: "100%", fontSize: 13 }}>
                    <thead>
                      <tr><th>Project</th><th style={{ textAlign: "right" }}>Count</th></tr>
                    </thead>
                    <tbody>
                      {stats.defectsPerProject.map(p => (
                        <tr key={p.projectKey}><td>{p.projectKey}</td><td style={{ textAlign: "right" }}>{p.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 style={{ margin: "0 0 8px" }}>Duplicates per Project</h4>
                  <table className="table" style={{ width: "100%", fontSize: 13 }}>
                    <thead>
                      <tr><th>Project</th><th style={{ textAlign: "right" }}>Count</th></tr>
                    </thead>
                    <tbody>
                      {stats.duplicatesPerProject.map(p => (
                        <tr key={p.projectKey}><td>{p.projectKey}</td><td style={{ textAlign: "right" }}>{p.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 style={{ margin: "0 0 8px" }}>Top Components</h4>
                  <table className="table" style={{ width: "100%", fontSize: 13 }}>
                    <thead>
                      <tr><th>Component</th><th style={{ textAlign: "right" }}>Count</th></tr>
                    </thead>
                    <tbody>
                      {stats.topComponents.map(c => (
                        <tr key={c.component}><td>{c.component}</td><td style={{ textAlign: "right" }}>{c.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 style={{ margin: "0 0 8px" }}>Issue Types</h4>
                  <table className="table" style={{ width: "100%", fontSize: 13 }}>
                    <thead>
                      <tr><th>Type</th><th style={{ textAlign: "right" }}>Count</th></tr>
                    </thead>
                    <tbody>
                      {stats.topIssueTypes.map(t => (
                        <tr key={t.issueType}><td>{t.issueType}</td><td style={{ textAlign: "right" }}>{t.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="defect-repo-section">
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className={`insight-btn ${(app.defectTab as string) === "repository" ? "primary" : "secondary"}`}
          onClick={() => app.setDefectTab("repository")}
          type="button"
        >
          <span className="material-symbols" style={{ fontSize: 16 }}>search</span> Repository
        </button>
        <button
          className={`insight-btn ${(app.defectTab as string) === "sources" ? "primary" : "secondary"}`}
          onClick={() => app.setDefectTab("sources")}
          type="button"
        >
          <span className="material-symbols" style={{ fontSize: 16 }}>source</span> Sources
        </button>
        <button
          className={`insight-btn ${(app.defectTab as string) === "stats" ? "primary" : "secondary"}`}
          onClick={() => { app.setDefectTab("stats"); app.loadDefectStats(); }}
          type="button"
        >
          <span className="material-symbols" style={{ fontSize: 16 }}>bar_chart</span> Stats
        </button>
      </div>

      {/* Search bar */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            className="input"
            placeholder="Search defects by title, description, steps..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()}
            style={{ flex: 1 }}
          />
          <button className="insight-btn primary" onClick={doSearch} disabled={app.defectSearching} type="button">
            <span className="material-symbols" style={{ fontSize: 16 }}>search</span>
            {app.defectSearching ? "Searching..." : "Search"}
          </button>
          <button className="insight-btn secondary" onClick={openCreateDefect} type="button" disabled={defectProjectOptions.length === 0}>
            <span className="material-symbols" style={{ fontSize: 16 }}>add</span>
            Add Defect
          </button>
          <button className="ghost-button" onClick={() => { app.loadAllDefects(); }} disabled={app.defectSearching} type="button" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span className="material-symbols" style={{ fontSize: 16, animation: app.defectSearching ? "spin 1s linear infinite" : "none" }}>refresh</span>
            All
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            className="input"
            style={{ width: "auto", minWidth: 150, fontSize: 12 }}
            value=""
            onChange={e => {
              if (!e.target.value) return;
              setSelectedProjectFilter(prev =>
                prev.includes(e.target.value) ? prev : [...prev, e.target.value]
              );
            }}
          >
            <option value="">Filter by project...</option>
            {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            className="input"
            style={{ width: "auto", minWidth: 150, fontSize: 12 }}
            value=""
            onChange={e => {
              if (!e.target.value) return;
              setSelectedTypeFilter(prev =>
                prev.includes(e.target.value) ? prev : [...prev, e.target.value]
              );
            }}
          >
            <option value="">Filter by type...</option>
            {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="input"
            style={{ width: "auto", minWidth: 150, fontSize: 12 }}
            value=""
            onChange={e => {
              if (!e.target.value) return;
              setSelectedStatusFilter(prev =>
                prev.includes(e.target.value) ? prev : [...prev, e.target.value]
              );
            }}
          >
            <option value="">Filter by status...</option>
            {allStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {(selectedProjectFilter.length > 0 || selectedTypeFilter.length > 0 || selectedStatusFilter.length > 0) && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
            {[...selectedProjectFilter, ...selectedTypeFilter, ...selectedStatusFilter].map(f => (
              <span key={f} style={{
                padding: "2px 8px",
                borderRadius: 12,
                fontSize: 11,
                background: "var(--surface-container-high)",
                display: "flex", alignItems: "center", gap: 4
              }}>
                {f}
                <span style={{ cursor: "pointer" }} onClick={() => {
                  setSelectedProjectFilter(prev => prev.filter(p => p !== f));
                  setSelectedTypeFilter(prev => prev.filter(t => t !== f));
                  setSelectedStatusFilter(prev => prev.filter(s => s !== f));
                }}>&times;</span>
              </span>
            ))}
            <button className="ghost-button" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => {
              setSelectedProjectFilter([]);
              setSelectedTypeFilter([]);
              setSelectedStatusFilter([]);
            }} type="button">Clear</button>
          </div>
        )}
      </div>

      {/* Candidates / Duplicate suggestions */}
      {visibleCandidates.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderLeft: "4px solid var(--warning)" }}>
          <h4 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="material-symbols filled" style={{ fontSize: 18 }}>warning</span>
            Duplicate Candidates Found ({visibleCandidates.length})
          </h4>

          {visibleCandidates.map((c, i) => (
            <div key={c.defect.id} style={{
              padding: "8px 0",
              borderBottom: i < visibleCandidates.length - 1 ? "1px solid var(--surface-container-high)" : "none"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); app.handleDefectViewDetail(c.defect.id); }}
                      style={{ color: "var(--primary)", textDecoration: "none" }}>
                      {c.defect.sourceIssueKey}
                    </a>
                    <span style={{ marginLeft: 8, fontWeight: 400 }}>{c.defect.normalizedTitle}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, fontSize: 11, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ background: c.score > 70 ? "rgba(239,68,68,0.1)" : "rgba(249,115,22,0.1)", color: c.score > 70 ? "var(--error)" : "var(--warning)", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                      Score: {c.score}%
                    </span>
                    <span>{c.defect.sourceProjectKey}</span>
                    <span>{c.defect.issueType}</span>
                    <span>{c.defect.status}</span>
                    {c.defect.component && <span>{c.defect.component}</span>}
                  </div>
                  {c.reasons.length > 0 && (
                    <div style={{ fontSize: 11, color: "var(--on-surface-variant)", marginTop: 4 }}>
                      {c.reasons.map((r, ri) => <span key={ri} style={{ marginRight: 8 }}>&bull; {r}</span>)}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {showDuplicateFor === c.defect.id ? (
                    <>
                      <button className="ghost-button" style={{ fontSize: 11, color: "var(--error)" }}
                        onClick={() => {
                          app.handleDefectMarkDuplicate(c.defect.id, c.defect.id, "manual");
                          setShowDuplicateFor(null);
                        }} type="button">Mark as Dup</button>
                      <button className="ghost-button" style={{ fontSize: 11 }}
                        onClick={() => setShowDuplicateFor(null)} type="button">Cancel</button>
                    </>
                  ) : (
                    <button className="ghost-button" style={{ fontSize: 11 }}
                      onClick={() => setShowDuplicateFor(c.defect.id)} type="button">
                      <span className="material-symbols" style={{ fontSize: 14 }}>link</span> Mark Dup
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {app.defectCandidates.length > 0 && visibleCandidates.length === 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderLeft: "4px solid var(--surface-container-high)" }}>
          <h4 style={{ margin: "0 0 8px" }}>Duplicate Candidates Found ({app.defectCandidates.length})</h4>
          <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: 13 }}>
            Tidak ada kandidat yang melewati ambang skor minimum {duplicateCandidateThreshold}%. Ini sengaja agar kandidat lemah tidak mengganggu triage.
          </p>
        </div>
      )}

      {/* Defect list */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>Defect Records</h4>
          <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>
            {app.defectSearchResults.length} total
          </span>
        </div>

        {app.defectSearchResults.length === 0 ? (
          <div className="empty-state" style={{ padding: "40px 0", textAlign: "center" }}>
            <span className="material-symbols filled" style={{ fontSize: 40, color: "var(--on-surface-variant)", marginBottom: 8, display: "block" }}>inventory_2</span>
            <p style={{ color: "var(--on-surface-variant)", margin: 0 }}>
              {app.defectSearching ? "Searching..." : "No defect records. Sync a Jira project source first."}
            </p>
            {!app.defectSearching && (
              <button className="insight-btn secondary" style={{ marginTop: 12 }} onClick={() => app.setDefectTab("sources")} type="button">
                Go to Sources
              </button>
            )}
          </div>
        ) : (
          <div style={{ maxHeight: 500, overflow: "auto" }}>
            <table className="table" style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Issue Key</th>
                  <th>Summary</th>
                  <th>Project</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Severity</th>
                  <th>Component</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {app.defectSearchResults.map(d => (
                  <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => app.handleDefectViewDetail(d.id)}>
                    <td style={{ fontWeight: 600 }}>{d.sourceIssueKey}</td>
                    <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.normalizedTitle}</td>
                    <td>{d.sourceProjectKey}</td>
                    <td>{d.issueType}</td>
                    <td><span className={`status-badge ${d.status?.toLowerCase()}`}>{d.status}</span></td>
                    <td>{d.severity}</td>
                    <td>{d.component || "-"}</td>
                    <td>
                      <button className="ghost-button" style={{ fontSize: 11 }}
                        onClick={(e) => { e.stopPropagation(); app.handleDefectViewDetail(d.id); }} type="button">
                        Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreateDefect && createPortal(
        <div className="dialog-overlay" onClick={resetCreateDefect} style={{ zIndex: 300 }}>
          <div
            className="dialog defect-create-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="defect-create-title"
          >
            <div className="dialog-header defect-create-dialog-header">
              <div className="dialog-header-info">
                <h3 className="dialog-title" id="defect-create-title">Add Defect</h3>
                <p className="dialog-subtitle">
                  Defect akan dibuat ke Jira project yang dipilih dari source yang sudah terdaftar.
                </p>
              </div>
              <div className="dialog-header-actions">
                <button className="ghost-button" onClick={resetCreateDefect} type="button" title="Tutup">
                  <span className="material-symbols">close</span>
                </button>
              </div>
            </div>

            <div className="dialog-body defect-create-dialog-body">
              {createError && (
                <div className="defect-banner defect-banner-error">{createError}</div>
              )}
              {createInfo && (
                <div className="defect-banner defect-banner-success">{createInfo}</div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitCreateDefect(false);
                }}
                className="defect-create-form"
              >
                <div className="defect-form-grid">
                  <label className="defect-field defect-field-wide">
                    <span>Project Source</span>
                    <select
                      className="input"
                      value={createDraft.projectKey}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, projectKey: e.target.value }))}
                      required
                    >
                      <option value="">Select source project</option>
                      {defectProjectOptions.map((source) => (
                        <option key={source.projectKey} value={source.projectKey}>
                          {source.projectKey}{source.projectName ? ` - ${source.projectName}` : ""}
                          {source.isActive ? "" : " (inactive)"}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="defect-field">
                    <span>Issue Type</span>
                    <select
                      className="input"
                      value={createDraft.issueType}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, issueType: e.target.value }))}
                      required
                    >
                      {defectIssueTypeOptions.map((issueType) => (
                        <option key={issueType} value={issueType}>{issueType}</option>
                      ))}
                    </select>
                  </label>

                  <label className="defect-field defect-field-wide">
                    <span>Summary</span>
                    <input
                      className="input"
                      value={createDraft.summary}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, summary: e.target.value }))}
                      placeholder="Short defect summary"
                      required
                    />
                  </label>

                  <label className="defect-field defect-field-wide">
                    <span>Description</span>
                    <textarea
                      className="input"
                      value={createDraft.description}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder="Short description or context"
                      rows={4}
                    />
                  </label>

                  <label className="defect-field defect-field-wide">
                    <span>Steps to Reproduce</span>
                    <textarea
                      className="input"
                      value={createDraft.stepsToReproduce}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, stepsToReproduce: e.target.value }))}
                      rows={4}
                    />
                  </label>

                  <label className="defect-field">
                    <span>Expected Result</span>
                    <textarea
                      className="input"
                      value={createDraft.expectedResult}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, expectedResult: e.target.value }))}
                      rows={3}
                    />
                  </label>

                  <label className="defect-field">
                    <span>Actual Result</span>
                    <textarea
                      className="input"
                      value={createDraft.actualResult}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, actualResult: e.target.value }))}
                      rows={3}
                    />
                  </label>

                  <label className="defect-field">
                    <span>Environment</span>
                    <input
                      className="input"
                      value={createDraft.environment}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, environment: e.target.value }))}
                      placeholder="Prod, QA, Staging..."
                    />
                  </label>

                  <label className="defect-field">
                    <span>Priority</span>
                    <select
                      className="input"
                      value={createDraft.priority}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, priority: e.target.value }))}
                    >
                      {["Highest", "High", "Medium", "Low", "Lowest"].map((priority) => (
                        <option key={priority} value={priority}>{priority}</option>
                      ))}
                    </select>
                  </label>

                  <label className="defect-field">
                    <span>Severity</span>
                    <input
                      className="input"
                      value={createDraft.severity}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, severity: e.target.value }))}
                      placeholder="Critical, Major, Minor..."
                    />
                  </label>

                  <label className="defect-field">
                    <span>Component</span>
                    <input
                      className="input"
                      value={createDraft.component}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, component: e.target.value }))}
                      placeholder="Payment, Login, API..."
                    />
                  </label>

                  <label className="defect-field">
                    <span>Version</span>
                    <input
                      className="input"
                      value={createDraft.version}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, version: e.target.value }))}
                      placeholder="v1.2.3"
                    />
                  </label>

                  <label className="defect-field defect-field-wide">
                    <span>Labels</span>
                    <input
                      className="input"
                      value={createDraft.labels}
                      onChange={(e) => setCreateDraft((prev) => ({ ...prev, labels: e.target.value }))}
                      placeholder="qa-buddy, urgent, release-2026-06"
                    />
                  </label>
                </div>

                {polishPreview && (
                  <div style={{ marginTop: 16, padding: 16, borderRadius: 8, background: "var(--surface-container)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span className="material-symbols" style={{ fontSize: 18, color: "var(--tertiary)" }}>auto_awesome</span>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>AI Polish Result</span>
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{polishPreview.description}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--surface-container-high)" }}>{polishPreview.priority}</span>
                      {polishPreview.labels.map((label) => (
                        <span key={label} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--surface-container-high)" }}>{label}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="defect-create-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => { setPolishPreview(null); resetCreateDefect(); }}
                    disabled={createSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    className="insight-btn secondary"
                    type="button"
                    onClick={() => void polishDefectDraft()}
                    disabled={polishing || createSubmitting}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span className="material-symbols" style={{ fontSize: 16 }}>auto_awesome</span>
                    {polishing ? "Polishing..." : "Polish with AI"}
                  </button>
                  <button
                    className="insight-btn primary"
                    type="submit"
                    disabled={createSubmitting}
                  >
                    <span className="material-symbols" style={{ fontSize: 16 }}>
                      {createSubmitting ? "sync" : "save"}
                    </span>
                    {createSubmitting ? "Checking..." : "Create Defect"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showDuplicateWarning && createPortal(
        <div className="dialog-overlay" onClick={() => {
          setShowDuplicateWarning(false);
          setCreateDuplicateCandidates([]);
        }} style={{ zIndex: 310 }}>
          <div
            className="dialog defect-warning-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="defect-warning-title"
          >
            <div className="dialog-header defect-create-dialog-header">
              <div className="dialog-header-info">
                <h3 className="dialog-title" id="defect-warning-title">Duplicate warning</h3>
                <p className="dialog-subtitle">
                  Sistem menemukan kandidat yang cukup mirip. Periksa dulu sebelum membuat defect baru.
                </p>
              </div>
              <div className="dialog-header-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setShowDuplicateWarning(false);
                    setCreateDuplicateCandidates([]);
                  }}
                  title="Tutup"
                >
                  <span className="material-symbols">close</span>
                </button>
              </div>
            </div>

            <div className="dialog-body defect-warning-dialog-body">
              <div className="defect-warning-list">
                {createDuplicateCandidates.map((candidate) => (
                  <div key={candidate.defect.id} className="defect-warning-card">
                    <div className="defect-warning-topline">
                      <div className="defect-warning-title">
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            app.handleDefectViewDetail(candidate.defect.id);
                            setShowDuplicateWarning(false);
                            setShowCreateDefect(false);
                          }}
                        >
                          {candidate.defect.sourceIssueKey}
                        </a>
                        <span>{candidate.defect.normalizedTitle}</span>
                      </div>
                      <span className={`defect-score-badge ${candidate.score >= 70 ? "high" : "medium"}`}>
                        Score {candidate.score}%
                      </span>
                    </div>

                    <div className="defect-warning-meta">
                      <span>{candidate.defect.sourceProjectKey}</span>
                      <span>{candidate.defect.issueType}</span>
                      <span>{candidate.defect.status}</span>
                      {candidate.defect.component && <span>{candidate.defect.component}</span>}
                    </div>

                    {candidate.reasons.length > 0 && (
                      <div className="defect-warning-reasons">
                        {candidate.reasons.map((reason, index) => (
                          <span key={`${candidate.defect.id}-${index}`}>• {reason}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="defect-warning-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setShowDuplicateWarning(false);
                    setCreateDuplicateCandidates([]);
                  }}
                  disabled={createSubmitting}
                >
                  Cancel
                </button>
                <button
                  className="insight-btn primary"
                  type="button"
                  onClick={() => void submitCreateDefect(true)}
                  disabled={createSubmitting}
                >
                  <span className="material-symbols" style={{ fontSize: 16 }}>done</span>
                  Continue & Create
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}

function formatAutoSyncDays(days: number[]): string {
  const dayLabels = new Map([
    [1, "Mon"],
    [2, "Tue"],
    [3, "Wed"],
    [4, "Thu"],
    [5, "Fri"],
    [6, "Sat"],
    [0, "Sun"],
  ]);
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((day) => dayLabels.get(day) || String(day))
    .join(", ");
}

function formatIssueTypes(issueTypes: string[]): string {
  const normalized = issueTypes.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join(", ") : "All";
}
