import React from "react";
import { useApp } from "../context/AppContext";
import SearchableSelect from "../components/SearchableSelect";
import MultiSearchableSelect from "../components/MultiSearchableSelect";

function getStatusStyle(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("done") || s.includes("resolved") || s.includes("closed") || s.includes("passed") || s.includes("pass")) {
    return { background: "var(--tertiary-container)", color: "var(--on-tertiary-container)", border: "1px solid color-mix(in srgb, var(--tertiary) 30%, transparent)" };
  }
  if (s.includes("progress") || s.includes("dev") || s.includes("test") || s.includes("qa") || s.includes("review")) {
    return { background: "var(--info-container)", color: "var(--on-info-container)", border: "1px solid color-mix(in srgb, var(--info) 30%, transparent)" };
  }
  if (s.includes("fail") || s.includes("error") || s.includes("reject")) {
    return { background: "var(--error-container)", color: "var(--on-error-container)", border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)" };
  }
  return { background: "var(--surface-container-low)", color: "var(--on-surface-variant)", border: "1px solid var(--outline-variant)" };
}

export default function AdvancedJiraOrganizer() {
  const {
    loading,
    activeView,
    config,
    jiraProjects,
    jiraBoards,
    jiraSprints,
    jiraStatuses,
    jiraIssueTypes,
    filtersLoading,
    jqlProject,
    setJqlProject,
    setJqlBoard,
    setJqlSprint,
    jqlBoard,
    jqlSprint,
    jqlStatus,
    setJqlStatus,
    jqlIssueType,
    setJqlIssueType,
    jqlAssignee,
    setJqlAssignee,
    jqlCustomFieldFilters,
    setJqlCustomFieldFilters,
    customFieldOptions,
    jqlLabelFilters,
    setJqlLabelFilters,
    jqlKey,
    setJqlKey,
    jiraCustomFields,
    generatedJql,
    setBanner,
    jqlMaxResults,
    setJqlMaxResults,
    handleJqlSearch,
    searchLoading,
    setSearchResults,
    setSelectedIssueKeys,
    setGeneratedJql,
    searchResults,
    selectedIssueKeys,
    toggleSelectAllIssues,
    toggleSelectIssue,
    pageResults,
    jqlTotalPages,
    resultsPage,
    setResultsPage,
    bulkTransitionId,
    setBulkTransitionId,
    handleBulkTransition,
    bulkLoading,
    handleBulkAssign,
    handleBulkAddLabels,
  } = useApp();

  if (loading || activeView !== "advanced-jira-organizer") {
    return null;
  }

  return (
    <section style={{ maxWidth: 1280, margin: "0 auto", paddingBottom: 100 }}>
      <div className="page-header" style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 className="text-display" style={{ marginBottom: 6 }}>Advanced Jira Organizer</h2>
          <p className="text-body-lg" style={{ maxWidth: 760 }}>
            Visual JQL builder untuk menyusun query lebih cepat, termasuk custom field Jira, lalu menjalankan pencarian dan bulk actions dari satu layar.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ padding: "8px 12px", borderRadius: 999, background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", fontSize: 12, color: "var(--on-surface-variant)" }}>Searchable filters</span>
          <span style={{ padding: "8px 12px", borderRadius: 999, background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", fontSize: 12, color: "var(--on-surface-variant)" }}>Custom fields</span>
          <span style={{ padding: "8px 12px", borderRadius: 999, background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", fontSize: 12, color: "var(--on-surface-variant)" }}>Bulk actions</span>
        </div>
      </div>

      {!config.jira.baseUrl || !config.jira.token ? (
        <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--on-surface-variant)" }}>
          <span className="material-symbols" style={{ fontSize: 48, marginBottom: 16 }}>warning</span>
          <p>Konfigurasi Jira belum lengkap. Isi URL, token, dan project key di Settings terlebih dahulu.</p>
        </div>
      ) : (
        <>
          <div className="bug-grid" style={{ marginBottom: 24, gap: 20, alignItems: "start" }}>
            <div className="card" style={{ padding: 28, borderRadius: 16, boxShadow: "var(--shadow-sm)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 600 }}>
                  <span className="material-symbols" style={{ fontSize: 22, color: "var(--tertiary)" }}>tune</span>
                  Filter Criteria
                </h3>
                <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>Build the query from structured controls</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Section 1: Scope */}
                <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--tertiary)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6, opacity: 0.85 }}>
                    <span className="material-symbols" style={{ fontSize: 16 }}>lan</span>
                    Jira Scope
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
                    <div className="field-group">
                      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface)", display: "block", marginBottom: 4 }}>Project</label>
                      <MultiSearchableSelect
                        options={jiraProjects.map(p => ({ value: p.key, label: `${p.key} - ${p.name}` }))}
                        values={jqlProject}
                        onChange={(val: string[]) => { setJqlProject(val); setJqlBoard([]); setJqlSprint([]); }}
                        placeholder="-- Select Project(s) --"
                        disabled={filtersLoading}
                      />
                    </div>

                    <div className="field-group">
                      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface)", display: "block", marginBottom: 4 }}>Board</label>
                      <MultiSearchableSelect
                        options={jiraBoards.map(b => ({ value: String(b.id), label: b.name }))}
                        values={jqlBoard}
                        onChange={(val: string[]) => { setJqlBoard(val); setJqlSprint([]); }}
                        placeholder="-- Select Board(s) --"
                        disabled={filtersLoading || jqlProject.length === 0}
                      />
                    </div>

                    <div className="field-group">
                      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface)", display: "block", marginBottom: 4 }}>Sprint</label>
                      <MultiSearchableSelect
                        options={jiraSprints.map(s => ({ value: String(s.id), label: `${s.name} (${s.state})` }))}
                        values={jqlSprint}
                        onChange={(val: string[]) => setJqlSprint(val)}
                        placeholder="-- Select Sprint(s) --"
                        disabled={filtersLoading || jqlBoard.length === 0}
                      />
                    </div>
                  </div>
                </div>

                <hr style={{ border: "none", borderTop: "1px dashed var(--outline-variant)", margin: "4px 0" }} />

                {/* Section 2: Attributes */}
                <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--tertiary)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6, opacity: 0.85 }}>
                    <span className="material-symbols" style={{ fontSize: 16 }}>info</span>
                    Attributes
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
                    <div className="field-group">
                      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface)", display: "block", marginBottom: 4 }}>Status</label>
                      <MultiSearchableSelect
                        options={jiraStatuses.map(s => ({ value: s.name, label: s.name }))}
                        values={jqlStatus}
                        onChange={(val: string[]) => setJqlStatus(val)}
                        placeholder="-- Select Status(es) --"
                        disabled={filtersLoading}
                      />
                    </div>

                    <div className="field-group">
                      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface)", display: "block", marginBottom: 4 }}>Issue Type</label>
                      <MultiSearchableSelect
                        options={jiraIssueTypes.map(t => ({ value: t, label: t }))}
                        values={jqlIssueType}
                        onChange={(val: string[]) => setJqlIssueType(val)}
                        placeholder="-- Select Type(s) --"
                        disabled={filtersLoading}
                      />
                    </div>

                    <div className="field-group">
                      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface)", display: "block", marginBottom: 4 }}>Assignee</label>
                      <input
                        type="text"
                        placeholder="e.g. john.doe"
                        value={jqlAssignee}
                        onChange={(e) => setJqlAssignee(e.target.value)}
                        disabled={filtersLoading}
                        style={{
                          width: "100%",
                          borderRadius: "6px",
                          border: "1px solid var(--outline-variant)",
                          padding: "8px 12px",
                          background: "var(--surface-container-low)",
                          fontSize: 14,
                          color: "var(--on-surface)"
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 16, padding: 16, borderRadius: 12, border: "1px solid var(--outline-variant)", background: "var(--surface)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="material-symbols" style={{ fontSize: 18, color: "var(--tertiary)" }}>filter_alt</span>
                        <strong style={{ fontSize: 13 }}>Custom Field Filters</strong>
                      </div>
                      <button
                        type="button"
                        onClick={() => setJqlCustomFieldFilters([...jqlCustomFieldFilters, { fieldId: "", operator: "=", value: "" }])}
                        disabled={filtersLoading}
                        style={{
                          alignSelf: "flex-start",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          background: "transparent",
                          border: "1px dashed var(--outline)",
                          borderRadius: 6,
                          padding: "6px 12px",
                          fontSize: 13,
                          color: "var(--tertiary)",
                          cursor: "pointer",
                          fontWeight: 500,
                        }}
                      >
                        <span className="material-symbols" style={{ fontSize: 18 }}>add</span>
                        Add Custom Field Filter
                      </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {jqlCustomFieldFilters.map((filter, index) => (
                        <div key={index} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 260px", minWidth: 220 }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>Custom Field</span>
                            <SearchableSelect
                              options={customFieldOptions}
                              value={filter.fieldId}
                              onChange={(fieldId) => {
                                const updated = [...jqlCustomFieldFilters];
                                updated[index].fieldId = fieldId;
                                setJqlCustomFieldFilters(updated);
                              }}
                              placeholder={customFieldOptions.length > 0 ? "-- Search custom field --" : "No custom fields found"}
                              disabled={filtersLoading || customFieldOptions.length === 0}
                            />
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 150 }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>Operator</span>
                            <select
                              value={filter.operator}
                              onChange={(event) => {
                                const updated = [...jqlCustomFieldFilters];
                                updated[index].operator = event.target.value as "=" | "!=" | "~";
                                setJqlCustomFieldFilters(updated);
                              }}
                              disabled={filtersLoading}
                              style={{
                                height: 38,
                                borderRadius: 6,
                                border: "1px solid var(--outline-variant)",
                                background: "var(--surface-container-low)",
                                color: "var(--on-surface)",
                                padding: "0 8px",
                                fontSize: 14
                              }}
                            >
                              <option value="=">Equals (=)</option>
                              <option value="!=">Not Equals (!=)</option>
                              <option value="~">Contains (~)</option>
                            </select>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 260px", minWidth: 220 }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>Value</span>
                            <input
                              type="text"
                              placeholder="Optional; leave empty for IS NOT EMPTY"
                              value={filter.value}
                              onChange={(event) => {
                                const updated = [...jqlCustomFieldFilters];
                                updated[index].value = event.target.value;
                                setJqlCustomFieldFilters(updated);
                              }}
                              disabled={filtersLoading}
                              style={{
                                height: 38,
                                borderRadius: 6,
                                border: "1px solid var(--outline-variant)",
                                padding: "8px 12px",
                                background: "var(--surface-container-low)",
                                fontSize: 14,
                                color: "var(--on-surface)",
                                boxSizing: "border-box"
                              }}
                            />
                          </div>

                          {jqlCustomFieldFilters.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setJqlCustomFieldFilters(jqlCustomFieldFilters.filter((_, i) => i !== index))}
                              disabled={filtersLoading}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "var(--error)",
                                cursor: "pointer",
                                padding: 8,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: 2,
                              }}
                              title="Remove custom field filter"
                            >
                              <span className="material-symbols" style={{ fontSize: 20 }}>delete</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--on-surface-variant)" }}>
                      Semua filter custom field langsung masuk ke JQL preview memakai format `cf[id]`.
                    </p>
                  </div>
                </div>

                <hr style={{ border: "none", borderTop: "1px dashed var(--outline-variant)", margin: "4px 0" }} />

                {/* Section 3: Identifiers */}
                <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--tertiary)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6, opacity: 0.85 }}>
                    <span className="material-symbols" style={{ fontSize: 16 }}>tag</span>
                    Identifiers & Tags
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div className="field-group">
                      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface)", display: "block", marginBottom: 4 }}>Key(s)</label>
                      <input
                        type="text"
                        placeholder="e.g. QA-123, QA-124"
                        value={jqlKey}
                        onChange={(e) => setJqlKey(e.target.value)}
                        disabled={filtersLoading}
                        style={{
                          width: "100%",
                          borderRadius: "6px",
                          border: "1px solid var(--outline-variant)",
                          padding: "8px 12px",
                          background: "var(--surface-container-low)",
                          fontSize: 14,
                          color: "var(--on-surface)"
                        }}
                      />
                    </div>

                    <div className="field-group">
                      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface)", display: "block", marginBottom: 8 }}>
                        Labels
                      </label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {jqlLabelFilters.map((filter, index) => (
                          <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <select
                              value={filter.operator}
                              onChange={(e) => {
                                const updated = [...jqlLabelFilters];
                                updated[index].operator = e.target.value as "=" | "!=";
                                setJqlLabelFilters(updated);
                              }}
                              disabled={filtersLoading}
                              style={{
                                borderRadius: "6px",
                                border: "1px solid var(--outline-variant)",
                                padding: "8px 12px",
                                background: "var(--surface-container-low)",
                                fontSize: 14,
                                color: "var(--on-surface)",
                                cursor: "pointer",
                                width: 120,
                              }}
                            >
                              <option value="=">Equals (=)</option>
                              <option value="!=">Not Equals (!=)</option>
                            </select>
                            <input
                              type="text"
                              placeholder="e.g. automation"
                              value={filter.value}
                              onChange={(e) => {
                                const updated = [...jqlLabelFilters];
                                updated[index].value = e.target.value;
                                setJqlLabelFilters(updated);
                              }}
                              disabled={filtersLoading}
                              style={{
                                flex: 1,
                                borderRadius: "6px",
                                border: "1px solid var(--outline-variant)",
                                padding: "8px 12px",
                                background: "var(--surface-container-low)",
                                fontSize: 14,
                                color: "var(--on-surface)"
                              }}
                            />
                            {jqlLabelFilters.length > 1 && (
                              <button
                                onClick={() => setJqlLabelFilters(jqlLabelFilters.filter((_, i) => i !== index))}
                                disabled={filtersLoading}
                                type="button"
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "var(--error)",
                                  cursor: "pointer",
                                  padding: 8,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                title="Remove label filter"
                              >
                                <span className="material-symbols" style={{ fontSize: 20 }}>delete</span>
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setJqlLabelFilters([...jqlLabelFilters, { operator: "=", value: "" }])}
                          disabled={filtersLoading}
                          style={{
                            alignSelf: "flex-start",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            background: "transparent",
                            border: "1px dashed var(--outline)",
                            borderRadius: 6,
                            padding: "6px 12px",
                            fontSize: 13,
                            color: "var(--tertiary)",
                            cursor: "pointer",
                            fontWeight: 500,
                            marginTop: 4,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--primary) 8%, transparent)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <span className="material-symbols" style={{ fontSize: 18 }}>add</span>
                          Add Label Filter
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bug-preview-col">
              <div className="card" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="material-symbols" style={{ color: "var(--tertiary)", fontSize: 20 }}>dns</span>
                    Discovered Custom Fields
                  </h3>
                  <span style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>{jiraCustomFields.filter((field) => field.isCustom).length} found</span>
                </div>
                {jiraCustomFields.filter((field) => field.isCustom).length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--on-surface-variant)" }}>Tidak ada custom field yang terdeteksi untuk project ini.</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {jiraCustomFields
                      .filter((field) => field.isCustom)
                      .slice(0, 8)
                      .map((field) => (
                        <span
                          key={field.id}
                          style={{
                            fontSize: 12,
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: "var(--surface-container-low)",
                            border: "1px solid var(--outline-variant)",
                            color: "var(--on-surface)",
                          }}
                          title={`${field.id} • ${field.type}`}
                        >
                          {field.name}
                        </span>
                      ))}
                  </div>
                )}
              </div>

              <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", gap: 16 }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols" style={{ color: "var(--tertiary)", fontSize: 22 }}>terminal</span>
                      JQL Query Preview
                    </h3>
                    {generatedJql && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(generatedJql);
                          setBanner({ tone: "success", text: "JQL copied to clipboard!" });
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--tertiary)",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: 4
                        }}
                        title="Copy to clipboard"
                      >
                        <span className="material-symbols" style={{ fontSize: 16 }}>content_copy</span>
                        Copy
                      </button>
                    )}
                  </div>
                  <div style={{
                    fontFamily: "monospace",
                    fontSize: 13,
                    padding: "16px",
                    borderRadius: "8px",
                    background: "var(--surface-container-low)",
                    border: "1px solid var(--outline-variant)",
                    minHeight: "120px",
                    color: generatedJql ? "var(--on-surface)" : "var(--on-surface-variant)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    wordBreak: "break-all",
                    whiteSpace: "pre-wrap",
                    textAlign: "left",
                    lineHeight: 1.6
                  }}>
                    {generatedJql || "Select filter criteria to build your JQL query automatically..."}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 4, padding: "0 4px" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--on-surface-variant)" }}>Max Results</span>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={jqlMaxResults}
                    onChange={(e) => setJqlMaxResults(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{
                      width: 80,
                      borderRadius: "6px",
                      border: "1px solid var(--outline-variant)",
                      padding: "6px 10px",
                      background: "var(--surface-container-low)",
                      fontSize: 13,
                      color: "var(--on-surface)",
                      textAlign: "right"
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <button
                    className="primary-button"
                    onClick={() => void handleJqlSearch()}
                    disabled={searchLoading || !generatedJql}
                    type="button"
                    style={{ flex: 1, height: 44, borderRadius: 8 }}
                  >
                    <span className="material-symbols" style={{ fontSize: 20 }}>search</span>
                    {searchLoading ? "Searching..." : "Search Issues"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setJqlProject([]);
                      setJqlBoard([]);
                      setJqlSprint([]);
                      setJqlStatus([]);
                      setJqlIssueType([]);
                      setJqlAssignee("");
                      setJqlCustomFieldFilters([{ fieldId: "", operator: "=", value: "" }]);
                      setJqlLabelFilters([{ operator: "=", value: "" }]);
                      setJqlKey("");
                      setSearchResults([]);
                      setSelectedIssueKeys([]);
                      setGeneratedJql("");
                      setJqlMaxResults(200);
                    }}
                    type="button"
                    style={{ width: 44, height: 44, borderRadius: 8, padding: 0 }}
                    title="Clear All Filters"
                  >
                    <span className="material-symbols" style={{ fontSize: 20 }}>restart_alt</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {searchResults.length === 0 && (
            <div className="card" style={{ padding: "64px 32px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16, marginBottom: 24 }}>
              <span className="material-symbols" style={{ fontSize: 56, color: "var(--tertiary)", opacity: 0.45 }}>
                database_search
              </span>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--on-surface)" }}>No Jira Issues Loaded</h3>
                <p style={{ margin: 0, marginTop: 6, fontSize: 14, color: "var(--on-surface-variant)", maxWidth: 450, lineHeight: 1.5 }}>
                  Select your scope criteria, status, type, keys or labels in the form above and click <strong>Search Issues</strong> to fetch and manage Jira tickets in bulk.
                </p>
              </div>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="card" style={{ padding: 24, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 600 }}>
                  <span className="material-symbols" style={{ fontSize: 22, color: "var(--tertiary)" }}>format_list_bulleted</span>
                  Results ({searchResults.length} issues found)
                </h3>
                <div className="results-selected-badge">
                  Selected: {selectedIssueKeys.length} of {searchResults.length} issue(s)
                </div>
              </div>

              <div style={{ overflowX: "auto", border: "1px solid var(--outline-variant)", borderRadius: 8, background: "var(--surface)" }}>
                <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "12px 16px", textAlign: "left", width: 40 }}>
                        <input
                          type="checkbox"
                          checked={searchResults.length > 0 && selectedIssueKeys.length === searchResults.length}
                          onChange={toggleSelectAllIssues}
                          style={{ accentColor: "var(--primary)", cursor: "pointer" }}
                        />
                      </th>
                      <th>Key</th>
                      <th>Summary</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Assignee</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageResults.map((issue) => (
                      <tr key={issue.key}>
                        <td style={{ padding: "12px 16px" }}>
                          <input
                            type="checkbox"
                            checked={selectedIssueKeys.includes(issue.key)}
                            onChange={() => toggleSelectIssue(issue.key)}
                            style={{ accentColor: "var(--primary)", cursor: "pointer" }}
                          />
                        </td>
                        <td className="key-cell">
                          <button onClick={() => void window.qaBuddy.openExternal(issue.url)} type="button">
                            {issue.key}
                          </button>
                        </td>
                        <td className="summary-cell" style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {issue.summary}
                        </td>
                        <td>
                          <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            ...getStatusStyle(issue.status)
                          }}>
                            {issue.status}
                          </span>
                        </td>
                        <td className="priority-cell">
                          <div className="priority-pill-inner" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {issue.priority === "Highest" || issue.priority === "Critical" ? (
                              <span className="material-symbols filled" style={{ color: "var(--severity-critical)", fontSize: 18 }}>keyboard_double_arrow_up</span>
                            ) : issue.priority === "High" ? (
                              <span className="material-symbols filled" style={{ color: "var(--severity-high)", fontSize: 18 }}>keyboard_arrow_up</span>
                            ) : issue.priority === "Low" ? (
                              <span className="material-symbols filled" style={{ color: "var(--severity-low)", fontSize: 18 }}>keyboard_arrow_down</span>
                            ) : (
                              <span className="material-symbols filled" style={{ color: "var(--severity-medium)", fontSize: 18 }}>drag_handle</span>
                            )}
                            <span>{issue.priority}</span>
                          </div>
                        </td>
                        <td>
                          <div className="assignee-cell" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div className="assignee-avatar" style={{
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              background: "var(--secondary-container)",
                              color: "var(--on-secondary-container)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              fontWeight: 700
                            }}>
                              {issue.assignee?.charAt(0).toUpperCase() || "U"}
                            </div>
                            <span>{issue.assignee || "Unassigned"}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{
                            fontSize: "12px",
                            color: "var(--on-surface-variant)",
                            background: "var(--surface-container)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            border: "1px solid var(--outline-variant)"
                          }}>{issue.type}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {jqlTotalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 20 }}>
                  <button
                    className="secondary-button"
                    onClick={() => setResultsPage(p => Math.max(1, p - 1))}
                    disabled={resultsPage === 1}
                    type="button"
                    style={{ width: 36, height: 36, padding: 0, borderRadius: "6px" }}
                  >
                    <span className="material-symbols" style={{ fontSize: 18 }}>chevron_left</span>
                  </button>
                  {Array.from({ length: jqlTotalPages }, (_, i) => i + 1).map(p => (
                    <button
                      key={p}
                      onClick={() => setResultsPage(p)}
                      type="button"
                      style={{
                        width: 36,
                        height: 36,
                        padding: 0,
                        fontSize: 13,
                        borderRadius: "6px",
                        border: p === resultsPage ? "none" : "1px solid var(--outline-variant)",
                        background: p === resultsPage ? "var(--tertiary)" : "transparent",
                        color: p === resultsPage ? "white" : "var(--on-surface)",
                        cursor: "pointer",
                        fontWeight: p === resultsPage ? "600" : "400",
                        transition: "all 0.15s"
                      }}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    className="secondary-button"
                    onClick={() => setResultsPage(p => Math.min(jqlTotalPages, p + 1))}
                    disabled={resultsPage === jqlTotalPages}
                    type="button"
                    style={{ width: 36, height: 36, padding: 0, borderRadius: "6px" }}
                  >
                    <span className="material-symbols" style={{ fontSize: 18 }}>chevron_right</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ margin: 0, marginBottom: 20, display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 600 }}>
                <span className="material-symbols" style={{ fontSize: 22, color: "var(--tertiary)" }}>batch_prediction</span>
                Bulk Actions
              </h3>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 20 }}>
                <div style={{
                  background: "var(--surface-container-low)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: "8px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 16
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="material-symbols" style={{ color: "var(--tertiary)", fontSize: 20 }}>swap_horiz</span>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Transition Status</h4>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <SearchableSelect
                        options={jiraStatuses.map(s => ({ value: s.id, label: s.name }))}
                        value={bulkTransitionId}
                        onChange={(val) => setBulkTransitionId(val)}
                        placeholder="-- Select Status --"
                      />
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => void handleBulkTransition()}
                      disabled={bulkLoading === "transition" || selectedIssueKeys.length === 0}
                      type="button"
                      style={{ whiteSpace: "nowrap", height: 38, borderRadius: 6 }}
                    >
                      {bulkLoading === "transition" ? "..." : "Apply"}
                    </button>
                  </div>
                </div>

                <div style={{
                  background: "var(--surface-container-low)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: "8px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 16
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="material-symbols" style={{ color: "var(--tertiary)", fontSize: 20 }}>person_add</span>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Assign To</h4>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      id="bulkAssignInput"
                      type="text"
                      placeholder="e.g. john.doe"
                      style={{
                        flex: 1,
                        height: 38,
                        borderRadius: "6px",
                        border: "1px solid var(--outline-variant)",
                        padding: "8px 12px",
                        background: "var(--surface)",
                        fontSize: 14,
                        color: "var(--on-surface)",
                        minWidth: 0
                      }}
                    />
                    <button
                      className="primary-button"
                      onClick={() => {
                        const input = document.getElementById("bulkAssignInput") as HTMLInputElement;
                        if (input && input.value.trim()) void handleBulkAssign(input.value.trim());
                      }}
                      disabled={bulkLoading === "assign" || selectedIssueKeys.length === 0}
                      type="button"
                      style={{ whiteSpace: "nowrap", height: 38, borderRadius: 6 }}
                    >
                      {bulkLoading === "assign" ? "..." : "Apply"}
                    </button>
                  </div>
                </div>

                <div style={{
                  background: "var(--surface-container-low)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: "8px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 16
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="material-symbols" style={{ color: "var(--tertiary)", fontSize: 20 }}>label</span>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Add Labels</h4>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      id="bulkLabelsInput"
                      type="text"
                      placeholder="e.g. aut, reg"
                      style={{
                        flex: 1,
                        height: 38,
                        borderRadius: "6px",
                        border: "1px solid var(--outline-variant)",
                        padding: "8px 12px",
                        background: "var(--surface)",
                        fontSize: 14,
                        color: "var(--on-surface)",
                        minWidth: 0
                      }}
                    />
                    <button
                      className="primary-button"
                      onClick={() => {
                        const input = document.getElementById("bulkLabelsInput") as HTMLInputElement;
                        if (input && input.value.trim()) void handleBulkAddLabels(input.value);
                      }}
                      disabled={bulkLoading === "labels" || selectedIssueKeys.length === 0}
                      type="button"
                      style={{ whiteSpace: "nowrap", height: 38, borderRadius: 6 }}
                    >
                      {bulkLoading === "labels" ? "..." : "Apply"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
