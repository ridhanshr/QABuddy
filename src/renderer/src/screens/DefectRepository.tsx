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
  const [syncingDefectToDb, setSyncingDefectToDb] = useState<Set<string>>(new Set());
  const [defectDbSyncResult, setDefectDbSyncResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

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

  const getTypeDotColor = (type: string) => {
    const t = (type || "").toLowerCase();
    if (t === "bug") return "var(--error)";
    if (t === "task") return "var(--tertiary)";
    return "var(--warning)";
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

  const handleSyncDefectToDb = async (defectKey: string, judulDefect: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncingDefectToDb(prev => new Set(prev).add(defectKey));
    setDefectDbSyncResult(prev => ({ ...prev, [defectKey]: undefined as any }));
    try {
      await window.qaBuddy.syncDefectToDb(defectKey, judulDefect);
      setDefectDbSyncResult(prev => ({ ...prev, [defectKey]: { ok: true, msg: "Tersimpan" } }));
    } catch (err: any) {
      setDefectDbSyncResult(prev => ({ ...prev, [defectKey]: { ok: false, msg: err?.message || String(err) } }));
    } finally {
      setSyncingDefectToDb(prev => { const s = new Set(prev); s.delete(defectKey); return s; });
    }
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
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div className="page-header-left">
            <h2 className="text-display">Jira Source Configuration</h2>
            <p className="text-body-lg">Kelola project Jira yang menjadi sumber data defect.</p>
          </div>
          <button
            className="ghost-button"
            onClick={() => app.setDefectTab("repository")}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            type="button"
          >
            <span className="material-symbols" style={{ fontSize: 16 }}>arrow_back</span>
            Back
          </button>
        </div>

        {/* Add Source Button */}
        <div style={{ marginBottom: 20 }}>
          <button
            className="secondary-button"
            onClick={() => openSourceEditor()}
            type="button"
          >
            <span className="material-symbols" style={{ fontSize: 18 }}>add</span>
            Add Source
          </button>
        </div>

        {/* Source Cards */}
        {app.defectSources.length === 0 ? (
          <div className="empty-state">
            <span className="material-symbols empty-icon">source</span>
            <h3 style={{ margin: 0, fontSize: 15 }}>No Jira project sources configured yet</h3>
            <p style={{ margin: 0 }}>Tambahkan source agar defect bisa di-sync dari Jira.</p>
            <button
              className="primary-button"
              onClick={() => openSourceEditor()}
              type="button"
              style={{ marginTop: 4 }}
            >
              <span className="material-symbols" style={{ fontSize: 18 }}>add</span>
              Add Source
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {app.defectSources.map(source => (
              <div
                key={source.id}
                className="card"
              >
                {/* Row 1: Project Key + Badge + Actions */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--on-surface)" }}>{source.projectKey}</h4>
                    {source.projectName && <span style={{ fontSize: 13.5, color: "var(--on-surface-variant)" }}>{source.projectName}</span>}
                    <span className={source.isActive ? "status-pill connected" : "status-pill neutral"}>
                      {source.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <button
                      className="ghost-button"
                      onClick={() => openSourceEditor(source)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      type="button"
                    >
                      <span className="material-symbols" style={{ fontSize: 16 }}>edit</span>
                      Edit
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => app.handleDefectSync(source.projectKey)}
                      disabled={app.defectSyncing === source.projectKey}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      type="button"
                    >
                      <span className={`material-symbols${app.defectSyncing === source.projectKey ? " rotating" : ""}`} style={{ fontSize: 16 }}>sync</span>
                      {app.defectSyncing === source.projectKey ? "Syncing..." : "Sync"}
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => app.handleDefectDeleteSource(source.id)}
                      style={{ color: "var(--error)" }}
                      type="button"
                      title="Hapus source"
                    >
                      <span className="material-symbols" style={{ fontSize: 16 }}>delete</span>
                    </button>
                  </div>
                </div>

                {/* Row 2: Sync Status */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: 14, fontSize: 13, color: "var(--on-surface-variant)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="material-symbols" style={{ fontSize: 16, color: source.syncStatus === "success" ? "var(--success)" : source.syncStatus === "error" ? "var(--error)" : "var(--font-disabled)" }}>check_circle</span>
                    Sync: {source.syncStatus === "success" ? "Success" : source.syncStatus === "syncing" ? "Syncing..." : source.syncStatus === "error" ? "Error" : "Idle"}
                  </div>
                  {source.lastSyncedAt && <div>Last sync: {new Date(source.lastSyncedAt).toLocaleString()}</div>}
                  {source.lastAutoSyncAt && <div>Last auto sync: {new Date(source.lastAutoSyncAt).toLocaleString()}</div>}
                  {source.errorMessage && <div style={{ color: "var(--error)" }}>{source.errorMessage}</div>}
                </div>

                {/* Row 3: Tags */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span className="case-tag">Auto sync: {source.autoSyncEnabled ? "Enabled" : "Disabled"}</span>
                  {source.autoSyncEnabled && (
                    <>
                      <span className="case-tag">Days: {source.autoSyncDays?.length ? formatAutoSyncDays(source.autoSyncDays) : "None"}</span>
                      <span className="case-tag">Time: {source.autoSyncTime || "-"}</span>
                    </>
                  )}
                  <span className="case-tag">Issue types: {formatIssueTypes(source.issueTypes || [])}</span>
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
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--on-surface)", lineHeight: "28px" }}>Test Defect Management Statistics</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="ghost-button"
              onClick={() => app.loadDefectStats()}
              disabled={app.defectSearching}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              type="button"
            >
              <span className={`material-symbols${app.defectSearching ? " rotating" : ""}`} style={{ fontSize: 16 }}>refresh</span>
              Refresh
            </button>
            <button
              className="ghost-button"
              onClick={() => app.setDefectTab("repository")}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 16 }}>arrow_back</span>
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
                  className="card"
                  style={{ padding: 20 }}
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
              <div className="card" style={{ padding: 20 }}>
                <h4 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "var(--on-surface)", borderBottom: "1px solid var(--outline-variant)", paddingBottom: 10 }}>Issue Types</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {stats.topIssueTypes.map((item) => {
                    const total = stats.totalDefects || 1;
                    const pct = Math.round((item.count / total) * 100);
                    const color = getTypeDotColor(item.issueType);
                    return (
                      <div key={item.issueType}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--on-surface)" }}>
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }}></span>
                            {item.issueType}
                          </span>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{item.count.toLocaleString()}</span>
                        </div>
                        <div className="rag-progress-bar">
                          <div className="rag-progress-fill" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Defects per Project */}
              <div className="card" style={{ padding: 20 }}>
                <h4 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "var(--on-surface)", borderBottom: "1px solid var(--outline-variant)", paddingBottom: 10 }}>Defects per Project</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {stats.defectsPerProject.map((item, i) => {
                    const isTop = i === 0;
                    return (
                      <div
                        key={item.projectKey}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "10px 14px",
                          borderRadius: "var(--radius-md)",
                          background: "var(--surface-container-low)"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="material-symbols" style={{ fontSize: 20, color: isTop ? "var(--primary)" : "var(--on-surface-variant)" }}>folder</span>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{item.projectKey}</span>
                        </div>
                        <span className="case-tag">
                          {item.count.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top Components */}
              <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid var(--outline-variant)", paddingBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--on-surface)" }}>Top Components</h4>
                  <span className="material-symbols" style={{ fontSize: 18, color: "var(--font-disabled)" }}>sort</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", overflow: "auto", maxHeight: 300 }}>
                  {stats.topComponents.length === 0 ? (
                    <div style={{ color: "var(--on-surface-variant)", fontSize: 13, padding: "12px 0" }}>No components found.</div>
                  ) : (
                    stats.topComponents.map((item, i) => (
                      <div key={item.component}>
                        {i > 0 && <div style={{ height: 1, background: "var(--outline-variant)", margin: "12px 0" }}></div>}
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--tertiary-container)", color: "var(--on-tertiary-container)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span className="material-symbols filled" style={{ fontSize: 22 }}>bug_report</span>
          </div>
          <div>
            <h2 className="text-display" style={{ margin: 0 }}>Test Defect Management</h2>
            <p className="text-body-lg" style={{ marginTop: 2 }}>Manage and track all system anomalies and test failures.</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="secondary-button"
            onClick={() => { app.loadAllDefects(); }}
            disabled={app.defectSearching}
            type="button"
          >
            <span className={`material-symbols${app.defectSearching ? " rotating" : ""}`} style={{ fontSize: 18 }}>refresh</span>
            Refresh
          </button>
          <button
            className="primary-button"
            onClick={openCreateDefect}
            type="button"
            disabled={defectProjectOptions.length === 0}
          >
            <span className="material-symbols" style={{ fontSize: 18 }}>add</span>
            Add Defect
          </button>
        </div>
      </div>

      {/* Secondary Navigation (Tabs) */}
      <div className="doc-sync-tabs" style={{ marginBottom: 20 }}>
        {(["repository", "sources", "stats"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => {
              app.setDefectTab(tab);
              if (tab === "stats") app.loadDefectStats();
            }}
            className={`doc-sync-tab ${(app.defectTab as string) === tab ? "active" : ""}`}
            type="button"
          >
            {tab === "repository" ? "Repository" : tab === "sources" ? "Sources" : "Stats"}
          </button>
        ))}
      </div>

      {/* Main Card Container */}
      <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Filter Toolbar */}
        <div style={{ padding: 14, borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container-low)", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select
              aria-label="Filter project"
              value={selectedProjectFilter}
              onChange={e => { setSelectedProjectFilter(e.target.value); setCurrentPage(1); }}
              style={{ height: 36, minWidth: 150 }}
            >
              <option value="">Project: All</option>
              {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select
              aria-label="Filter type"
              value={selectedTypeFilter}
              onChange={e => { setSelectedTypeFilter(e.target.value); setCurrentPage(1); }}
              style={{ height: 36, minWidth: 130 }}
            >
              <option value="">Type: All</option>
              {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              aria-label="Filter status"
              value={selectedStatusFilter}
              onChange={e => { setSelectedStatusFilter(e.target.value); setCurrentPage(1); }}
              style={{ height: 36, minWidth: 140 }}
            >
              <option value="">Status: All</option>
              {allStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="search-box">
              <span className="material-symbols">search</span>
              <input
                placeholder="Search key, summary, status..."
                value={tableSearchInput}
                onChange={e => { setTableSearchInput(e.target.value); setCurrentPage(1); }}
                onKeyDown={e => { if (e.key === "Enter") doTableSearch(); }}
              />
            </div>
            <button
              className="secondary-button"
              onClick={doTableSearch}
              disabled={app.defectSearching}
              type="button"
              style={{ height: 36 }}
            >
              <span className={`material-symbols${app.defectSearching ? " rotating" : ""}`} style={{ fontSize: 16 }}>search</span>
              {app.defectSearching ? "Searching..." : "Search"}
            </button>
          </div>
        </div>

        {/* Duplicate Candidates Section */}
        {visibleCandidates.length > 0 && (
          <div style={{ padding: 16, borderBottom: "1px solid var(--outline-variant)", borderLeft: "4px solid var(--warning)", background: "color-mix(in srgb, var(--warning) 7%, transparent)" }}>
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
                        background: c.score > 70 ? "color-mix(in srgb, var(--error) 12%, transparent)" : "color-mix(in srgb, var(--warning) 12%, transparent)",
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
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ whiteSpace: "nowrap" }}>Issue Key</th>
                <th>Summary</th>
                <th style={{ whiteSpace: "nowrap" }}>Project</th>
                <th style={{ whiteSpace: "nowrap" }}>Type</th>
                <th style={{ whiteSpace: "nowrap" }}>Status</th>
                <th style={{ whiteSpace: "nowrap" }}>Severity</th>
                <th style={{ whiteSpace: "nowrap" }}>Component</th>
                <th style={{ whiteSpace: "nowrap" }}>DB</th>
                <th style={{ textAlign: "right", width: 64 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedDefects.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "48px 16px", color: "var(--on-surface-variant)" }}>
                    {app.defectSearching ? "Searching..." : "No defect records. Sync a Jira project source first."}
                  </td>
                </tr>
              ) : (
                paginatedDefects.map(d => (
                  <tr
                    key={d.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => app.handleDefectViewDetail(d.id)}
                  >
                    <td className="key-cell">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          const base = app.config.jira.baseUrl?.replace(/\/+$/, "");
                          if (base) void window.qaBuddy.openExternal(`${base}/browse/${d.sourceIssueKey}`);
                        }}
                      >
                        {d.sourceIssueKey}
                      </button>
                    </td>
                    <td className="summary-cell" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={d.normalizedTitle}>{d.normalizedTitle}</td>
                    <td style={{ color: "var(--on-surface-variant)" }}>{d.sourceProjectKey}</td>
                    <td>
                      <span className="type-badge">
                        <span className="tag-dot" style={{ background: getTypeDotColor(d.issueType) }}></span>
                        {d.issueType}
                      </span>
                    </td>
                    <td>
                      <span className="status-pill neutral" style={{ textTransform: "none", letterSpacing: 0 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: getStatusDotColor(d.status) }}></span>
                        {d.status}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: getSeverityColor(d.severity), fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                        <span className="material-symbols" style={{ fontSize: 16 }}>{getSeverityIcon(d.severity)}</span>
                        {d.severity}
                      </span>
                    </td>
                    <td style={{ color: "var(--on-surface-variant)", fontFamily: "var(--font-mono)", fontSize: 13 }}>{d.component || "-"}</td>
                    <td style={{ whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                      {(() => {
                        const syncing = syncingDefectToDb.has(d.sourceIssueKey);
                        const res = defectDbSyncResult[d.sourceIssueKey];
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={e => handleSyncDefectToDb(d.sourceIssueKey, d.normalizedTitle, e)}
                              disabled={syncing}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "3px 8px" }}
                            >
                              <span className={`material-symbols${syncing ? " rotating" : ""}`} style={{ fontSize: 13 }}>
                                {syncing ? "sync" : "save"}
                              </span>
                              {syncing ? "..." : "Sync DB"}
                            </button>
                            {res && (
                              <span style={{ fontSize: 10, color: res.ok ? "var(--success)" : "var(--error)" }}>
                                {res.ok ? "✓" : "✗"} {res.msg}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: "right" }} onClick={e => e.stopPropagation()}>
                      <button
                        className="icon-btn"
                        onClick={() => app.handleDefectViewDetail(d.id)}
                        type="button"
                        title="Lihat detail"
                      >
                        <span className="material-symbols" style={{ fontSize: 18 }}>visibility</span>
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
