import React, { useEffect, useState, useMemo } from "react";
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
  const [tableSearchInput, setTableSearchInput] = useState("");
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>("");
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("");
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
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [isSearchActive, setIsSearchActive] = useState(false);

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

  const doTableSearch = () => {
    const q = tableSearchInput.trim();
    if (!q) {
      setIsSearchActive(false);
      app.loadAllDefects();
      return;
    }
    setIsSearchActive(true);
    const filters: Record<string, unknown> = {
      query: q,
      projectKeys: selectedProjectFilter ? [selectedProjectFilter] : undefined,
      issueTypes: selectedTypeFilter ? [selectedTypeFilter] : undefined,
      statuses: selectedStatusFilter ? [selectedStatusFilter] : undefined,
    };
    app.handleDefectSearch(q, filters as any);
    setCurrentPage(1);
  };

  const filteredDefects = useMemo(() => {
    let results = app.defectSearchResults;
    if (selectedProjectFilter) {
      results = results.filter(d => d.sourceProjectKey === selectedProjectFilter);
    }
    if (selectedTypeFilter) {
      results = results.filter(d => d.issueType === selectedTypeFilter);
    }
    if (selectedStatusFilter) {
      results = results.filter(d => d.status === selectedStatusFilter);
    }
    if (tableSearchInput.trim()) {
      const query = tableSearchInput.toLowerCase();
      results = results.filter(d =>
        d.sourceIssueKey.toLowerCase().includes(query) ||
        d.normalizedTitle.toLowerCase().includes(query) ||
        (d.component && d.component.toLowerCase().includes(query))
      );
    }
    return results;
  }, [app.defectSearchResults, selectedProjectFilter, selectedTypeFilter, selectedStatusFilter, tableSearchInput]);

  const totalPages = Math.ceil(filteredDefects.length / itemsPerPage);
  const paginatedDefects = filteredDefects.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getSeverityIcon = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case "critical": return "keyboard_double_arrow_up";
      case "high": return "keyboard_double_arrow_up";
      case "medium": return "remove";
      case "low": return "keyboard_arrow_down";
      default: return "remove";
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case "critical": return "var(--error)";
      case "high": return "var(--error)";
      case "medium": return "var(--tertiary)";
      case "low": return "var(--outline)";
      default: return "var(--tertiary)";
    }
  };

  const getStatusDotColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "open": return "var(--error)";
      case "in progress": return "var(--primary)";
      case "resolved": return "var(--outline)";
      case "closed": return "var(--outline)";
      default: return "var(--outline)";
    }
  };

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

  if (app.defectTab === "sources") {
    return (
      <section className="defect-repo-section">
        {/* Page Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--on-surface)", lineHeight: "28px" }}>Jira Source Configuration</h2>
          <button
            onClick={() => app.setDefectTab("repository")}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--on-surface-variant)", fontSize: 14, cursor: "pointer", padding: "8px 0" }}
            type="button"
          >
            <span className="material-symbols" style={{ fontSize: 18 }}>arrow_back</span>
            Back
          </button>
        </div>

        {/* Add Source Button */}
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => openSourceEditor()}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 16px", height: 40,
              background: "var(--surface)", color: "var(--primary)",
              border: "1px solid var(--outline-variant)", borderRadius: 8,
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              transition: "border-color 0.15s"
            }}
            type="button"
          >
            <span className="material-symbols" style={{ fontSize: 18 }}>add</span>
            Add Source
          </button>
        </div>

        {/* Source Cards */}
        {app.defectSources.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <span className="material-symbols filled" style={{ fontSize: 48, color: "var(--on-surface-variant)", marginBottom: 12, display: "block", opacity: 0.4 }}>source</span>
            <p style={{ color: "var(--on-surface-variant)", margin: "0 0 16px" }}>No Jira project sources configured yet.</p>
            <button
              onClick={() => openSourceEditor()}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "8px 16px",
                background: "var(--primary)", color: "var(--on-primary)",
                border: "none", borderRadius: 4,
                fontSize: 13, fontWeight: 500, cursor: "pointer"
              }}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 16 }}>add</span>
              Add Source
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {app.defectSources.map(source => (
              <div
                key={source.id}
                style={{
                  background: "var(--surface-container-lowest)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: 12,
                  padding: 24,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  transition: "border-color 0.15s"
                }}
              >
                {/* Row 1: Project Key + Badge + Actions */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <h4 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--on-surface)" }}>{source.projectKey}</h4>
                    {source.projectName && <span style={{ fontSize: 14, color: "var(--on-surface-variant)" }}>{source.projectName}</span>}
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      padding: "4px 10px", borderRadius: 999,
                      fontSize: 12, fontWeight: 500,
                      background: source.isActive ? "rgba(37, 99, 235, 0.1)" : "rgba(107, 114, 128, 0.1)",
                      color: source.isActive ? "var(--primary)" : "var(--on-surface-variant)",
                      border: `1px solid ${source.isActive ? "rgba(37, 99, 235, 0.2)" : "var(--outline-variant)"}`
                    }}>
                      {source.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <button
                      onClick={() => openSourceEditor(source)}
                      style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "var(--on-surface-variant)", fontSize: 13, cursor: "pointer", padding: 0 }}
                      type="button"
                    >
                      <span className="material-symbols" style={{ fontSize: 16 }}>edit</span>
                      Edit
                    </button>
                    <button
                      onClick={() => app.handleDefectSync(source.projectKey)}
                      disabled={app.defectSyncing === source.projectKey}
                      style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "var(--on-surface-variant)", fontSize: 13, cursor: "pointer", padding: 0 }}
                      type="button"
                    >
                      <span className="material-symbols" style={{ fontSize: 16, animation: app.defectSyncing === source.projectKey ? "spin 1s linear infinite" : "none" }}>sync</span>
                      {app.defectSyncing === source.projectKey ? "Syncing..." : "Sync"}
                    </button>
                    <button
                      onClick={() => app.handleDefectDeleteSource(source.id)}
                      style={{ display: "flex", alignItems: "center", background: "none", border: "none", color: "var(--error)", cursor: "pointer", padding: 0 }}
                      type="button"
                    >
                      <span className="material-symbols" style={{ fontSize: 16 }}>delete</span>
                    </button>
                  </div>
                </div>

                {/* Row 2: Sync Status */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: 16, fontSize: 13, color: "var(--on-surface-variant)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="material-symbols" style={{ fontSize: 16, color: source.syncStatus === "success" ? "#16a34a" : source.syncStatus === "error" ? "var(--error)" : "var(--outline)" }}>check_circle</span>
                    Sync: {source.syncStatus === "success" ? "Success" : source.syncStatus === "syncing" ? "Syncing..." : source.syncStatus === "error" ? "Error" : "Idle"}
                  </div>
                  {source.lastSyncedAt && <div>Last sync: {new Date(source.lastSyncedAt).toLocaleString()}</div>}
                  {source.lastAutoSyncAt && <div>Last auto sync: {new Date(source.lastAutoSyncAt).toLocaleString()}</div>}
                  {source.errorMessage && <div style={{ color: "var(--error)" }}>{source.errorMessage}</div>}
                </div>

                {/* Row 3: Tags */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 13, fontFamily: "monospace", padding: "4px 12px", borderRadius: 999, background: "var(--surface-container-high)", color: "var(--on-surface-variant)" }}>
                    Auto sync: {source.autoSyncEnabled ? "Enabled" : "Disabled"}
                  </span>
                  {source.autoSyncEnabled && (
                    <>
                      <span style={{ fontSize: 13, fontFamily: "monospace", padding: "4px 12px", borderRadius: 999, background: "var(--surface-container-high)", color: "var(--on-surface-variant)" }}>
                        Days: {source.autoSyncDays?.length ? formatAutoSyncDays(source.autoSyncDays) : "None"}
                      </span>
                      <span style={{ fontSize: 13, fontFamily: "monospace", padding: "4px 12px", borderRadius: 999, background: "var(--surface-container-high)", color: "var(--on-surface-variant)" }}>
                        Time: {source.autoSyncTime || "-"}
                      </span>
                    </>
                  )}
                  <span style={{ fontSize: 13, fontFamily: "monospace", padding: "4px 12px", borderRadius: 999, background: "var(--surface-container-high)", color: "var(--on-surface-variant)" }}>
                    Issue types: {formatIssueTypes(source.issueTypes || [])}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

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
        {/* Page Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--on-surface)", lineHeight: "28px" }}>Defect Repository Statistics</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              onClick={() => app.loadDefectStats()}
              disabled={app.defectSearching}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--on-surface-variant)", fontSize: 13, cursor: "pointer", padding: "8px 0" }}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 16, animation: app.defectSearching ? "spin 1s linear infinite" : "none" }}>refresh</span>
              Refresh
            </button>
            <button
              onClick={() => app.setDefectTab("repository")}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--on-surface-variant)", fontSize: 13, cursor: "pointer", padding: "8px 0" }}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 18 }}>arrow_back</span>
              Back
            </button>
          </div>
        </div>

        {!stats ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--on-surface-variant)" }}>Loading stats...</div>
        ) : (
          <>
            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24, marginBottom: 24 }}>
              {[
                { label: "Total Defects", value: stats.totalDefects, icon: "bug_report", color: "var(--primary)" },
                { label: "Total Duplicates", value: stats.totalDuplicates, icon: "content_copy", color: "var(--on-surface-variant)" },
                { label: "Projects", value: stats.defectsPerProject.length, icon: "folder_open", color: "var(--tertiary)" },
                { label: "Components", value: stats.topComponents.length, icon: "widgets", color: "var(--primary)" },
              ].map(card => (
                <div
                  key={card.label}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--outline-variant)",
                    borderRadius: 8,
                    padding: 24,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{card.label}</span>
                    <span className="material-symbols" style={{ fontSize: 20, color: card.color }}>{card.icon}</span>
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "var(--on-surface)", lineHeight: 1 }}>{card.value.toLocaleString()}</div>
                </div>
              ))}
            </div>

            {/* Data Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
              {/* Issue Types - Bar Chart */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--outline-variant)", borderRadius: 8, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <h4 style={{ margin: "0 0 24px", fontSize: 16, fontWeight: 600, color: "var(--on-surface)", borderBottom: "1px solid var(--outline-variant)", paddingBottom: 8 }}>Issue Types</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {stats.topIssueTypes.map((item, i) => {
                    const total = stats.totalDefects || 1;
                    const pct = Math.round((item.count / total) * 100);
                    const colors = ["var(--error)", "var(--primary)", "var(--tertiary)"];
                    const color = colors[i % colors.length];
                    return (
                      <div key={item.issueType}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--on-surface)" }}>
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }}></span>
                            {item.issueType}
                          </span>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{item.count.toLocaleString()}</span>
                        </div>
                        <div style={{ width: "100%", height: 8, background: "var(--surface-container-high)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Defects per Project */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--outline-variant)", borderRadius: 8, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <h4 style={{ margin: "0 0 24px", fontSize: 16, fontWeight: 600, color: "var(--on-surface)", borderBottom: "1px solid var(--outline-variant)", paddingBottom: 8 }}>Defects per Project</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {stats.defectsPerProject.map((item, i) => {
                    const isTop = i === 0;
                    return (
                      <div
                        key={item.projectKey}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "12px 16px", borderRadius: 4,
                          border: "1px solid var(--outline-variant)",
                          background: "var(--surface-container-low)"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="material-symbols" style={{ fontSize: 20, color: isTop ? "var(--primary)" : "var(--on-surface-variant)" }}>folder</span>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{item.projectKey}</span>
                        </div>
                        <span style={{
                          fontFamily: "monospace", fontSize: 13, fontWeight: 500,
                          padding: "2px 10px", borderRadius: 4,
                          background: isTop ? "var(--primary-container)" : "var(--secondary-container)",
                          color: isTop ? "var(--on-primary-container)" : "var(--on-secondary-container)"
                        }}>
                          {item.count.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top Components */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--outline-variant)", borderRadius: 8, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, borderBottom: "1px solid var(--outline-variant)", paddingBottom: 8 }}>
                  <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--on-surface)" }}>Top Components</h4>
                  <span className="material-symbols" style={{ fontSize: 20, color: "var(--on-surface-variant)" }}>sort</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", overflow: "auto", maxHeight: 300 }}>
                  {stats.topComponents.length === 0 ? (
                    <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "12px 0" }}>No components found.</div>
                  ) : (
                    stats.topComponents.map((item, i) => (
                      <div key={item.component}>
                        {i > 0 && <div style={{ height: 1, background: "var(--surface-container-highest)", margin: "12px 0" }}></div>}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 14, color: "var(--on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 16 }}>{item.component}</span>
                          <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--on-surface-variant)", flexShrink: 0 }}>{item.count}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="defect-repo-section">
      {/* Page Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 4, background: "rgba(0, 74, 198, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)" }}>
            <span className="material-symbols filled" style={{ fontSize: 24 }}>bug_report</span>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: "var(--on-surface)", lineHeight: "32px", letterSpacing: "-0.01em" }}>Defect Repository</h2>
            <p style={{ margin: 0, fontSize: 14, color: "var(--on-surface-variant)", lineHeight: "20px" }}>Manage and track all system anomalies and test failures.</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            className="ghost-button"
            onClick={() => { app.loadAllDefects(); }}
            disabled={app.defectSearching}
            type="button"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", border: "1px solid var(--outline-variant)", borderRadius: 4, fontSize: 13, fontWeight: 500 }}
          >
            <span className="material-symbols" style={{ fontSize: 18, animation: app.defectSearching ? "spin 1s linear infinite" : "none" }}>refresh</span>
            Refresh
          </button>
          <button
            className="insight-btn primary"
            onClick={openCreateDefect}
            type="button"
            disabled={defectProjectOptions.length === 0}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 4, fontSize: 13, fontWeight: 500 }}
          >
            <span className="material-symbols" style={{ fontSize: 18 }}>add</span>
            Add Defect
          </button>
        </div>
      </div>

      {/* Secondary Navigation (Tabs) */}
      <div style={{ borderBottom: "1px solid var(--outline-variant)", marginBottom: 24 }}>
        <nav style={{ display: "flex", gap: 24 }}>
          {(["repository", "sources", "stats"] as const).map(tab => {
            const isActive = (app.defectTab as string) === tab;
            const label = tab === "repository" ? "Repository" : tab === "sources" ? "Sources" : "Stats";
            return (
              <button
                key={tab}
                onClick={() => {
                  app.setDefectTab(tab);
                  if (tab === "stats") app.loadDefectStats();
                }}
                style={{
                  paddingBottom: 12,
                  color: isActive ? "var(--primary)" : "var(--on-surface-variant)",
                  fontSize: 13,
                  fontWeight: 500,
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${isActive ? "var(--primary)" : "transparent"}`,
                  cursor: "pointer",
                  transition: "color 0.15s"
                }}
                type="button"
              >
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Card Container */}
      <div style={{ background: "var(--surface-container-lowest)", borderRadius: 8, border: "1px solid var(--outline-variant)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Filter Toolbar */}
        <div style={{ padding: 16, borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-bright)", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <select
                style={{
                  appearance: "none",
                  background: "var(--surface)",
                  border: "1px solid var(--outline-variant)",
                  color: "var(--on-surface)",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 4,
                  padding: "8px 32px 8px 12px",
                  height: 36,
                  cursor: "pointer"
                }}
                value={selectedProjectFilter}
                onChange={e => { setSelectedProjectFilter(e.target.value); setCurrentPage(1); }}
              >
                <option value="">Project: All</option>
                {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <span className="material-symbols" style={{ position: "absolute", right: 8, top: 8, fontSize: 18, color: "var(--outline)", pointerEvents: "none" }}>expand_more</span>
            </div>
            <div style={{ position: "relative" }}>
              <select
                style={{
                  appearance: "none",
                  background: "var(--surface)",
                  border: "1px solid var(--outline-variant)",
                  color: "var(--on-surface)",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 4,
                  padding: "8px 32px 8px 12px",
                  height: 36,
                  cursor: "pointer"
                }}
                value={selectedTypeFilter}
                onChange={e => { setSelectedTypeFilter(e.target.value); setCurrentPage(1); }}
              >
                <option value="">Type: All</option>
                {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="material-symbols" style={{ position: "absolute", right: 8, top: 8, fontSize: 18, color: "var(--outline)", pointerEvents: "none" }}>expand_more</span>
            </div>
            <div style={{ position: "relative" }}>
              <select
                style={{
                  appearance: "none",
                  background: "var(--surface)",
                  border: "1px solid var(--outline-variant)",
                  color: "var(--on-surface)",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 4,
                  padding: "8px 32px 8px 12px",
                  height: 36,
                  cursor: "pointer"
                }}
                value={selectedStatusFilter}
                onChange={e => { setSelectedStatusFilter(e.target.value); setCurrentPage(1); }}
              >
                <option value="">Status: All</option>
                {allStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="material-symbols" style={{ position: "absolute", right: 8, top: 8, fontSize: 18, color: "var(--outline)", pointerEvents: "none" }}>expand_more</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", width: 256 }}>
              <span className="material-symbols" style={{ position: "absolute", left: 8, top: 8, fontSize: 18, color: "var(--outline)" }}>search</span>
              <input
                type="text"
                placeholder="Search key, summary, status..."
                value={tableSearchInput}
                onChange={e => { setTableSearchInput(e.target.value); setCurrentPage(1); }}
                onKeyDown={e => { if (e.key === "Enter") doTableSearch(); }}
                style={{
                  width: "100%",
                  background: "var(--surface)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: 4,
                  padding: "8px 12px 8px 32px",
                  fontSize: 14,
                  color: "var(--on-surface)",
                  height: 36
                }}
              />
            </div>
            <button
              onClick={doTableSearch}
              disabled={app.defectSearching}
              type="button"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", height: 36,
                background: "var(--primary)", color: "var(--on-primary)",
                border: "none", borderRadius: 4,
                fontSize: 13, fontWeight: 500, cursor: "pointer"
              }}
            >
              <span className="material-symbols" style={{ fontSize: 16, animation: app.defectSearching ? "spin 1s linear infinite" : "none" }}>search</span>
              {app.defectSearching ? "Searching..." : "Search"}
            </button>
          </div>
        </div>

        {/* Duplicate Candidates Section */}
        {visibleCandidates.length > 0 && (
          <div style={{ padding: 16, borderBottom: "1px solid var(--outline-variant)", borderLeft: "4px solid var(--warning)", background: "rgba(249, 115, 22, 0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span className="material-symbols filled" style={{ fontSize: 18, color: "var(--warning)" }}>warning</span>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Potential Duplicates Found ({visibleCandidates.length})</h4>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleCandidates.map(c => (
                <div key={c.defect.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 12px", borderRadius: 6, background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <a
                        href="#"
                        onClick={e => {
                          e.preventDefault();
                          const base = app.config.jira.baseUrl?.replace(/\/+$/, "");
                          if (base) void window.qaBuddy.openExternal(`${base}/browse/${c.defect.sourceIssueKey}`);
                        }}
                        style={{ color: "var(--primary)", fontWeight: 600, fontSize: 13, textDecoration: "none", fontFamily: "monospace" }}
                      >
                        {c.defect.sourceIssueKey}
                      </a>
                      <span style={{
                        padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                        background: c.score > 70 ? "rgba(239,68,68,0.1)" : "rgba(249,115,22,0.1)",
                        color: c.score > 70 ? "var(--error)" : "var(--warning)"
                      }}>
                        Score: {c.score}%
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--on-surface)", marginBottom: 4 }}>{c.defect.normalizedTitle}</div>
                    <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--on-surface-variant)", flexWrap: "wrap" }}>
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
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Data Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-container-low)", borderBottom: "1px solid var(--outline-variant)" }}>
                <th style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500, color: "var(--on-surface-variant)", whiteSpace: "nowrap", width: 96 }}>Issue Key</th>
                <th style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500, color: "var(--on-surface-variant)" }}>Summary</th>
                <th style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500, color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>Project</th>
                <th style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500, color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>Type</th>
                <th style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500, color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>Status</th>
                <th style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500, color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>Severity</th>
                <th style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500, color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>Component</th>
                <th style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500, color: "var(--on-surface-variant)", whiteSpace: "nowrap", textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody style={{ background: "var(--surface-container-lowest)" }}>
              {paginatedDefects.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "40px 16px", textAlign: "center", color: "var(--on-surface-variant)" }}>
                    {app.defectSearching ? "Searching..." : "No defect records. Sync a Jira project source first."}
                  </td>
                </tr>
              ) : (
                paginatedDefects.map(d => (
                  <tr
                    key={d.id}
                    style={{ cursor: "pointer", borderBottom: "1px solid rgba(115, 118, 134, 0.2)" }}
                    onClick={() => app.handleDefectViewDetail(d.id)}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(242, 244, 246, 0.5)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <a
                        href="#"
                        onClick={e => {
                          e.stopPropagation();
                          const base = app.config.jira.baseUrl?.replace(/\/+$/, "");
                          if (base) void window.qaBuddy.openExternal(`${base}/browse/${d.sourceIssueKey}`);
                        }}
                        style={{ color: "var(--primary)", fontFamily: "monospace", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
                      >
                        {d.sourceIssueKey}
                      </a>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--on-surface)", fontWeight: 500, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.normalizedTitle}>{d.normalizedTitle}</td>
                    <td style={{ padding: "12px 16px", color: "var(--on-surface-variant)" }}>{d.sourceProjectKey}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--error-container)", color: "var(--on-error-container)", padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>
                        <span className="material-symbols" style={{ fontSize: 14 }}>bug_report</span>
                        {d.issueType}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--outline-variant)", padding: "2px 8px", borderRadius: 999, fontSize: 12, color: "var(--on-surface-variant)", background: "var(--surface)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: getStatusDotColor(d.status) }}></span>
                        {d.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ color: getSeverityColor(d.severity), fontWeight: 600, display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                        <span className="material-symbols" style={{ fontSize: 16 }}>{getSeverityIcon(d.severity)}</span>
                        {d.severity}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--on-surface-variant)", fontFamily: "monospace", fontSize: 13 }}>{d.component || "-"}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <button
                        style={{ background: "none", border: "none", padding: 4, borderRadius: 4, cursor: "pointer", color: "var(--outline)" }}
                        onClick={e => { e.stopPropagation(); app.handleDefectViewDetail(d.id); }}
                        onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
                        onMouseLeave={e => (e.currentTarget.style.color = "var(--outline)")}
                        type="button"
                      >
                        <span className="material-symbols" style={{ fontSize: 20 }}>visibility</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div style={{ padding: 16, borderTop: "1px solid var(--outline-variant)", background: "var(--surface-bright)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--on-surface-variant)", margin: 0 }}>
              Showing {filteredDefects.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} to {Math.min(currentPage * itemsPerPage, filteredDefects.length)} of {filteredDefects.length} entries
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--on-surface-variant)" }}>Rows:</span>
              <select
                value={itemsPerPage}
                onChange={e => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                style={{
                  appearance: "none",
                  background: "var(--surface)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: 4,
                  padding: "4px 24px 4px 8px",
                  fontSize: 12,
                  color: "var(--on-surface)",
                  cursor: "pointer",
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23737686'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 6px center"
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "1px solid var(--outline-variant)", background: "transparent", color: "var(--outline)", cursor: "pointer" }}
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 18 }}>chevron_left</span>
            </button>
            {Array.from({ length: Math.min(totalPages, 3) }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                style={{
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 4,
                  border: page === currentPage ? "none" : "1px solid var(--outline-variant)",
                  background: page === currentPage ? "var(--primary)" : "transparent",
                  color: page === currentPage ? "var(--on-primary)" : "var(--on-surface)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500
                }}
                onClick={() => setCurrentPage(page)}
                type="button"
              >
                {page}
              </button>
            ))}
            {totalPages > 3 && <span style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--outline)" }}>...</span>}
            <button
              style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "1px solid var(--outline-variant)", background: "transparent", color: "var(--on-surface)", cursor: "pointer" }}
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 18 }}>chevron_right</span>
            </button>
          </div>
        </div>
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

            <div className="dialog-body defect-warning-dialog-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
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
            </div>

            <div className="defect-warning-actions" style={{ flexShrink: 0 }}>
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
