import React, { useMemo } from "react";
import ReactDOM from "react-dom";
import { useApp } from "../context/AppContext";
import SearchableSelect from "../components/SearchableSelect";

export default function ManualTestCaseScreen() {
  const {
    activeView,
    loading,
    manualTab,
    setManualTab,
    downloadTemplate,
    handleFileUpload,
    submitManualCases,
    manualLoading,
    manualCases,
    addManualCase,
    generateWithAi,
    removeManualCase,
    updateManualCase,
    organizeSource,
    setOrganizeSource,
    organizeFolder,
    setOrganizeFolder,
    organizeProjectKey,
    setOrganizeProjectKey,
    organizeXrayFolders,
    organizeFolderLoading,
    submitOrganize,
    jiraProjects,
    // Update from Confluence
    confImportMode,
    setConfImportMode,
    confImportUrl,
    setConfImportUrl,
    confImportJql,
    setConfImportJql,
    confImportEntries,
    setConfImportEntries,
    confImportLoading,
    confImportResult,
    confImportJqlMatched,
    setConfImportJqlMatched,
    confImportJqlMatchedIds,
    setConfImportJqlMatchedIds,
    updateConfImportEntryKey,
    confImportProjectKey,
    setConfImportProjectKey,
    confImportXrayFolders,
    confImportFolderLoading,
    confImportSelectedFolder,
    setConfImportSelectedFolder,
    fetchConfImportEntries,
    searchJiraForImport,
    toggleConfImportEntry,
    toggleAllConfImportEntries,
    submitUpdateFromConfluence,
    confirmStepConflictUpdate,
    stepConflictCheck,
    setStepConflictCheck,
    stepConflictMode,
    setStepConflictMode,
    updateProgress,
    showUpdateProgress,
    setShowUpdateProgress,
  } = useApp();

  const flattenFolderOptions = useMemo(() => {
    const flatten = (folders: typeof organizeXrayFolders, pfx = ""): { value: string; label: string }[] => {
      const result: { value: string; label: string }[] = [];
      for (const f of folders) {
        const path = pfx ? `${pfx}/${f.name}` : `/${f.name}`;
        result.push({ value: path, label: path });
        if (f.children) result.push(...flatten(f.children, path));
      }
      return result;
    };
    return flatten(organizeXrayFolders);
  }, [organizeXrayFolders]);

  const confImportFlattenFolderOptions = useMemo(() => {
    const flatten = (folders: typeof confImportXrayFolders, pfx = ""): { value: string; label: string }[] => {
      const result: { value: string; label: string }[] = [];
      for (const f of folders) {
        const path = pfx ? `${pfx}/${f.name}` : `/${f.name}`;
        result.push({ value: path, label: path });
        if (f.children) result.push(...flatten(f.children, path));
      }
      return result;
    };
    return flatten(confImportXrayFolders);
  }, [confImportXrayFolders]);

  if (loading || activeView !== "manual-test-case") {
    return null;
  }

  return (
    <section style={{ maxWidth: 1000, margin: "0 auto", paddingBottom: 100 }}>
      <div style={{ marginBottom: 32 }}>
        <h2 className="text-display">Manual Test Case</h2>
        <p className="text-body-lg">Manage, create, and organize your manual test repository.</p>
        
        <div style={{ display: 'flex', gap: 24, marginTop: 24, borderBottom: '1px solid var(--outline-variant)' }}>
          <button 
            onClick={() => setManualTab("creator")}
            style={{ 
              padding: '12px 4px', 
              background: 'none', 
              border: 'none', 
              borderBottom: manualTab === "creator" ? '2px solid var(--primary)' : '2px solid transparent',
              color: manualTab === "creator" ? 'var(--primary)' : 'var(--on-surface-variant)',
              fontWeight: manualTab === "creator" ? 600 : 400,
              cursor: 'pointer',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <span className="material-symbols" style={{ fontSize: 20 }}>add_circle</span>
            Creator
          </button>
          <button 
            onClick={() => setManualTab("organizer")}
            style={{ 
              padding: '12px 4px', 
              background: 'none', 
              border: 'none', 
              borderBottom: manualTab === "organizer" ? '2px solid var(--primary)' : '2px solid transparent',
              color: manualTab === "organizer" ? 'var(--primary)' : 'var(--on-surface-variant)',
              fontWeight: manualTab === "organizer" ? 600 : 400,
              cursor: 'pointer',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <span className="material-symbols" style={{ fontSize: 20 }}>account_tree</span>
            Xray Organizer
          </button>
          <button 
            onClick={() => setManualTab("update-from-conf")}
            style={{ 
              padding: '12px 4px', 
              background: 'none', 
              border: 'none', 
              borderBottom: manualTab === "update-from-conf" ? '2px solid var(--primary)' : '2px solid transparent',
              color: manualTab === "update-from-conf" ? 'var(--primary)' : 'var(--on-surface-variant)',
              fontWeight: manualTab === "update-from-conf" ? 600 : 400,
              cursor: 'pointer',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <span className="material-symbols" style={{ fontSize: 20 }}>cloud_sync</span>
            Update from Confluence
          </button>
        </div>
      </div>

      {manualTab === "creator" && (
        <>
          <div className="page-header" style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <h4 style={{ margin: 0, color: 'var(--on-surface-variant)' }}>Create New Scenarios</h4>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="secondary-button" onClick={downloadTemplate} style={{ padding: '4px 12px', height: '32px', borderRadius: 6, fontSize: 13 }}>
                <span className="material-symbols" style={{ fontSize: 18 }}>download</span>
                Template
              </button>
              <input 
                type="file" 
                id="csv-upload" 
                accept=".csv,.xlsx,.xls" 
                onChange={handleFileUpload} 
                style={{ display: 'none' }} 
              />
              <button 
                className="secondary-button" 
                onClick={() => document.getElementById('csv-upload')?.click()}
                style={{ padding: '4px 12px', height: '32px', borderRadius: 6, fontSize: 13 }}
              >
                <span className="material-symbols" style={{ fontSize: 18 }}>upload_file</span>
                Import
              </button>
              <button 
                className="primary-button" 
                onClick={submitManualCases} 
                disabled={manualLoading}
                style={{ padding: '4px 16px', height: '32px', borderRadius: 6, fontSize: 13 }}
              >
                <span className="material-symbols" style={{ fontSize: 18 }}>{manualLoading ? 'progress_activity' : 'send'}</span>
                {manualLoading ? 'Sending...' : 'Submit to Jira'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {manualCases.map((item, index) => (
              <div className="card" key={item.id} style={{ padding: 32, borderLeft: '4px solid var(--primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'white', background: 'var(--primary)', padding: '4px 14px', borderRadius: 20, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                      Scenario #{index + 1}
                    </span>
                    <button 
                      className="secondary-button" 
                      onClick={() => generateWithAi(item.id)}
                      style={{ padding: '4px 12px', height: '32px', fontSize: 12, borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <span className="material-symbols" style={{ fontSize: 16 }}>auto_awesome</span>
                      AI Assist
                    </button>
                  </div>
                  {manualCases.length > 1 && (
                    <button 
                      className="icon-button" 
                      onClick={() => removeManualCase(item.id)}
                      style={{ color: 'var(--error)' }}
                      title="Remove scenario"
                    >
                      <span className="material-symbols">delete_outline</span>
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div className="field-group">
                      <label>Scenario Title</label>
                      <input 
                        placeholder="e.g. Validasi Login dengan data benar" 
                        value={item.title}
                        onChange={(e) => updateManualCase(item.id, "title", e.target.value)}
                      />
                    </div>
                    <div className="field-group">
                      <label>Xray Folder Path</label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <span className="material-symbols" style={{ position: 'absolute', left: 12, fontSize: 18, color: 'var(--on-surface-variant)' }}>folder</span>
                        <input 
                          placeholder="/Sprint 1/Modules/Login" 
                          value={item.xrayFolder}
                          onChange={(e) => updateManualCase(item.id, "xrayFolder", e.target.value)}
                          style={{ paddingLeft: 40 }}
                        />
                      </div>
                    </div>
                    <div className="field-group">
                      <label>Labels / Tags</label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <span className="material-symbols" style={{ position: 'absolute', left: 12, fontSize: 18, color: 'var(--on-surface-variant)' }}>label</span>
                        <input 
                          placeholder="login, auth, p1 (pisahkan dengan koma)" 
                          value={item.labels || ""}
                          onChange={(e) => updateManualCase(item.id, "labels", e.target.value)}
                          style={{ paddingLeft: 40 }}
                        />
                      </div>
                    </div>
                    <div className="field-group" style={{ flex: 1 }}>
                      <label>Description / Objective</label>
                      <textarea 
                        style={{ height: '100%', minHeight: '120px' }}
                        placeholder="Briefly describe what this test is about..."
                        value={item.description}
                        onChange={(e) => updateManualCase(item.id, "description", e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div className="field-group">
                      <label>Test Steps</label>
                      <textarea 
                        rows={6} 
                        placeholder="1. Open login page&#10;2. Enter valid credentials&#10;3. Click login button"
                        value={item.steps}
                        onChange={(e) => updateManualCase(item.id, "steps", e.target.value)}
                      />
                    </div>
                    <div className="field-group">
                      <label>Expected Result</label>
                      <textarea 
                        rows={6} 
                        placeholder="User should be redirected to dashboard..."
                        value={item.expectedResult}
                        onChange={(e) => updateManualCase(item.id, "expectedResult", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button 
              className="secondary-button" 
              onClick={addManualCase}
              style={{ 
                border: '1px dashed var(--outline-variant)', 
                background: 'var(--surface-container-low)', 
                height: 50, 
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--on-surface-variant)'
              }}
            >
              <span className="material-symbols" style={{ fontSize: 20 }}>add_circle</span>
              Add Another Scenario Draft
            </button>
          </div>
        </>
      )}

      {manualTab === "organizer" && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div className="card" style={{ padding: 40, background: 'var(--surface-container-low)', border: '1px solid var(--outline-variant)' }}>
            <div style={{ marginBottom: 32 }}>
              <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Bulk Move to Xray Repository</h3>
              <p style={{ color: 'var(--on-surface-variant)', fontSize: 14 }}>
                Pindahkan tiket tipe <strong>Test</strong> yang sudah ada di Jira ke dalam folder spesifik di Xray Test Repository secara massal.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div className="field-group">
                <label>Source Issues (JQL or Issue Keys)</label>
                <textarea 
                  rows={5}
                  placeholder="e.g. project = QA AND labels = manual-case&#10;OR list keys: QA-123, QA-456, QA-789"
                  value={organizeSource}
                  onChange={(e) => setOrganizeSource(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
                <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginTop: 4 }}>
                  Tips: Masukkan query JQL untuk memfilter tiket, atau daftar Issue Key yang dipisahkan koma.
                </p>
              </div>

              <div className="field-group">
                <label>Project</label>
                <SearchableSelect
                  options={jiraProjects.map(p => ({ value: p.key, label: `${p.key} - ${p.name}` }))}
                  value={organizeProjectKey}
                  onChange={setOrganizeProjectKey}
                  placeholder="-- Select Project --"
                />
              </div>

              <div className="field-group">
                <label>Target Xray Folder</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="material-symbols" style={{ fontSize: 20, color: 'var(--primary)', flexShrink: 0 }}>folder</span>
                  <div style={{ flex: 1 }}>
                    <SearchableSelect
                      options={flattenFolderOptions}
                      value={organizeFolder}
                      onChange={setOrganizeFolder}
                      placeholder={organizeFolderLoading ? 'Loading folders...' : !organizeProjectKey ? '-- Select Project First --' : '-- Select Folder --'}
                      disabled={organizeFolderLoading || !organizeProjectKey}
                    />
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                <button 
                  className="primary-button" 
                  onClick={submitOrganize} 
                  disabled={manualLoading}
                  style={{ width: '100%', height: 48, borderRadius: 12, fontSize: 15 }}
                >
                  <span className="material-symbols" style={{ fontSize: 22 }}>{manualLoading ? 'progress_activity' : 'account_tree'}</span>
                  {manualLoading ? 'Moving Issues...' : 'Organize into Xray Folder'}
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 24, background: 'rgba(var(--primary-rgb), 0.05)', border: '1px dashed var(--primary)' }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <span className="material-symbols" style={{ color: 'var(--primary)' }}>info</span>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>Cara Penggunaan</h4>
                <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
                  Fitur ini berguna untuk merapikan Test Case yang sudah terlanjur dibuat tapi belum masuk ke struktur folder Xray. 
                  Pastikan tiket yang dimasukkan adalah tipe <strong>Test</strong> agar kompatibel dengan folder Xray.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {manualTab === "update-from-conf" && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {/* Mode selector */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <span className="material-symbols" style={{ fontSize: 24, color: 'var(--primary)' }}>settings</span>
              <div>
                <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Pilih Mode</h4>
                <p style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>
                  {confImportMode === "auto" 
                    ? "Auto: Ekstrak Issue Key otomatis dari field Scenario di Confluence"
                    : confImportMode === "jql-match"
                    ? "JQL Match: Cocokkan dengan hasil query JQL"
                    : "Xray Folder: Cocokkan dengan issue di folder Xray terpilih"}
                </p>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  className={confImportMode === "auto" ? "primary-button" : "secondary-button"}
                  onClick={() => setConfImportMode("auto")}
                  style={{ padding: '6px 16px', fontSize: 13, borderRadius: 20 }}
                >
                  Auto
                </button>
                <button
                  className={confImportMode === "jql-match" ? "primary-button" : "secondary-button"}
                  onClick={() => setConfImportMode("jql-match")}
                  style={{ padding: '6px 16px', fontSize: 13, borderRadius: 20 }}
                >
                  JQL Match
                </button>
                <button
                  className={confImportMode === "xray-folder" ? "primary-button" : "secondary-button"}
                  onClick={() => setConfImportMode("xray-folder")}
                  style={{ padding: '6px 16px', fontSize: 13, borderRadius: 20 }}
                >
                  Xray Folder
                </button>
              </div>
            </div>
          </div>

          {/* Confluence URL input */}
          <div className="card" style={{ padding: 24 }}>
            <div className="field-group">
              <label>Confluence Page URL</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  placeholder="https://confluence.domain.com/pages/123456"
                  value={confImportUrl}
                  onChange={(e) => setConfImportUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="primary-button"
                  onClick={fetchConfImportEntries}
                  disabled={confImportLoading}
                  style={{ padding: '8px 20px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }}
                >
                  <span className="material-symbols" style={{ fontSize: 18 }}>{confImportLoading ? 'progress_activity' : 'cloud_download'}</span>
                  {confImportLoading ? 'Loading...' : 'Fetch Entries'}
                </button>
              </div>
            </div>

            {/* JQL input (only in JQL Match mode) */}
            {confImportMode === "jql-match" && (
              <div className="field-group" style={{ marginTop: 16 }}>
                <label>JQL Query</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    placeholder='e.g. project = QA AND issuetype = Test AND description IS EMPTY'
                    value={confImportJql}
                    onChange={(e) => setConfImportJql(e.target.value)}
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }}
                  />
                  <button
                    className="secondary-button"
                    onClick={searchJiraForImport}
                    disabled={confImportLoading || confImportEntries.length === 0}
                    style={{ padding: '8px 20px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }}
                  >
                    <span className="material-symbols" style={{ fontSize: 18 }}>search</span>
                    Match
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setConfImportJqlMatched(false);
                      setConfImportJqlMatchedIds(new Set());
                      setConfImportEntries(prev =>
                        prev.map(e => ({ ...e, selected: !!e.issueKey }))
                      );
                      setConfImportJql("");
                    }}
                    disabled={!confImportJqlMatched}
                    style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }}
                  >
                    <span className="material-symbols" style={{ fontSize: 18 }}>clear</span>
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Xray Folder selector (only in Xray Folder mode) */}
            {confImportMode === "xray-folder" && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="field-group">
                  <label>Project</label>
                  <SearchableSelect
                    options={jiraProjects.map(p => ({ value: p.key, label: `${p.key} - ${p.name}` }))}
                    value={confImportProjectKey}
                    onChange={setConfImportProjectKey}
                    placeholder="-- Select Project --"
                  />
                </div>
                <div className="field-group">
                  <label>Xray Folder</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <SearchableSelect
                        options={confImportFlattenFolderOptions}
                        value={confImportSelectedFolder}
                        onChange={setConfImportSelectedFolder}
                        placeholder={confImportFolderLoading ? 'Loading folders...' : !confImportProjectKey ? '-- Select Project First --' : '-- Select Folder --'}
                        disabled={confImportFolderLoading || !confImportProjectKey}
                      />
                    </div>
                    <button
                      className="secondary-button"
                      onClick={searchJiraForImport}
                      disabled={confImportLoading || confImportEntries.length === 0 || !confImportProjectKey || !confImportSelectedFolder}
                      style={{ padding: '8px 20px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }}
                    >
                      <span className="material-symbols" style={{ fontSize: 18 }}>folder_match</span>
                      Match from Folder
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setConfImportJqlMatched(false);
                        setConfImportJqlMatchedIds(new Set());
                        setConfImportEntries(prev =>
                          prev.map(e => ({ ...e, selected: !!e.issueKey }))
                        );
                      }}
                      disabled={!confImportJqlMatched}
                      style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }}
                    >
                      <span className="material-symbols" style={{ fontSize: 18 }}>clear</span>
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Entries table */}
          {confImportEntries.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--outline-variant)' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {confImportJqlMatched
                    ? `${confImportEntries.filter(e => confImportJqlMatchedIds.has(e.id)).length} matched of ${confImportEntries.length} entries`
                    : `${confImportEntries.length} entries found`
                  }
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="secondary-button"
                    onClick={() => toggleAllConfImportEntries(true)}
                    style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6 }}
                  >
                    Select All
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => toggleAllConfImportEntries(false)}
                    style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6 }}
                  >
                    Deselect All
                  </button>
                  <button
                    className="primary-button"
                    onClick={submitUpdateFromConfluence}
                    disabled={confImportLoading || confImportEntries.every(e => !e.selected || !e.issueKey)}
                    style={{ padding: '6px 20px', fontSize: 13, borderRadius: 8 }}
                  >
                    <span className="material-symbols" style={{ fontSize: 18 }}>{confImportLoading ? 'progress_activity' : 'sync'}</span>
                    {confImportLoading ? 'Updating...' : 'Update Selected'}
                  </button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-container)', borderBottom: '1px solid var(--outline-variant)' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', width: 40 }}>
                        <span className="material-symbols" style={{ fontSize: 16, color: 'var(--on-surface-variant)' }}>check</span>
                      </th>
                      <th style={{ padding: '10px 16px', textAlign: 'left' }}>Issue Key</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left' }}>Scenario</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left' }}>Steps</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left' }}>Expected Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(confImportJqlMatched
                      ? confImportEntries.filter(e => confImportJqlMatchedIds.has(e.id))
                      : confImportEntries
                    ).map((entry) => (
                      <tr 
                        key={entry.id}
                        style={{ 
                          borderBottom: '1px solid var(--outline-variant)',
                          background: entry.selected ? 'rgba(var(--primary-rgb), 0.03)' : 'transparent',
                          opacity: entry.issueKey ? 1 : 0.5,
                        }}
                      >
                        <td style={{ padding: '8px 16px' }}>
                          <input 
                            type="checkbox"
                            checked={entry.selected}
                            disabled={!entry.issueKey}
                            onChange={() => toggleConfImportEntry(entry.id)}
                          />
                        </td>
                        <td style={{ padding: '8px 16px', fontWeight: 600 }}>
                          {entry.issueKey ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {confImportJqlMatched && confImportJqlMatchedIds.has(entry.id) && (
                                <span className="material-symbols" style={{ fontSize: 14, color: 'var(--success)' }}>check_circle</span>
                              )}
                              <input
                                type="text"
                                value={entry.issueKey}
                                onChange={(e) => updateConfImportEntryKey(entry.id, e.target.value)}
                                style={{
                                  width: 130,
                                  padding: '2px 6px',
                                  fontSize: 13,
                                  fontWeight: 600,
                                  fontFamily: 'monospace',
                                  border: '1px solid var(--outline-variant)',
                                  borderRadius: 4,
                                  background: 'transparent',
                                  color: 'inherit',
                                }}
                              />
                              {confImportJqlMatched && !confImportJqlMatchedIds.has(entry.id) && (
                                <span className="material-symbols" style={{ fontSize: 14, color: 'var(--warning)' }}>warning</span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--error)', fontSize: 12 }}>No key</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 16px', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entry.scenario}
                        </td>
                        <td style={{ padding: '8px 16px', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--on-surface-variant)' }}>
                          {entry.steps?.split('\n').slice(0, 3).join(' | ') || '-'}
                        </td>
                        <td style={{ padding: '8px 16px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--on-surface-variant)' }}>
                          {entry.expectedResult?.split('\n')[0] || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result summary */}
          {confImportResult && (
            <div className="card" style={{ padding: 20, borderLeft: `4px solid ${confImportResult.failed.length === 0 ? 'var(--success)' : confImportResult.success.length > 0 ? 'var(--warning)' : 'var(--error)'}` }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Update Result</h4>
              <div style={{ display: 'flex', gap: 24 }}>
                <div>
                  <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{confImportResult.success.length}</span>
                  <span style={{ fontSize: 13, color: 'var(--on-surface-variant)', marginLeft: 6 }}>Success</span>
                </div>
                {confImportResult.failed.length > 0 && (
                  <div>
                    <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--error)' }}>{confImportResult.failed.length}</span>
                    <span style={{ fontSize: 13, color: 'var(--on-surface-variant)', marginLeft: 6 }}>Failed</span>
                  </div>
                )}
              </div>
              {confImportResult.success.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--on-surface-variant)' }}>
                  Keys: {confImportResult.success.map(s => s.key).join(', ')}
                </div>
              )}
              {confImportResult.failed.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {confImportResult.failed.map((f, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--error)', marginTop: 4 }}>{f.key}: {f.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ padding: 24, background: 'rgba(var(--primary-rgb), 0.05)', border: '1px dashed var(--primary)' }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <span className="material-symbols" style={{ color: 'var(--primary)' }}>info</span>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)', marginBottom: 8 }}>Cara Penggunaan</h4>
                <div style={{ fontSize: 13, color: 'var(--on-surface-variant)', lineHeight: 1.6 }}>
                  <p><strong>Mode Auto:</strong> Cukup masukkan URL Confluence. System akan auto-extract Issue Key dari field Scenario dan siapkan entries untuk diupdate.</p>
                  <p><strong>Mode JQL Match:</strong> Masukkan URL Confluence + JQL query. System akan parse entries, lalu cocokkan <strong>scenario</strong> dengan <strong>summary</strong> hasil JQL, perbarui Issue Key, dan tampilkan hanya entry yang cocok. Kosongkan JQL untuk melihat semua entry.</p>
                  <p><strong>Mode Xray Folder:</strong> Pilih Project + Folder Xray. System akan fetch semua issue di folder tersebut, lalu cocokkan dengan scenario Confluence (otomatis strip prefix project). Tidak perlu JQL atau edit manual.</p>
                  <p>Pastikan tabel Confluence memiliki format: <strong>No. Test Case</strong>, <strong>Scenario</strong> (mengandung link Jira issue), <strong>Steps</strong>, <strong>Expected Result</strong>.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Update progress modal (hideable) */}
      {showUpdateProgress && updateProgress && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => setShowUpdateProgress(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 480, width: '90%', padding: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols" style={{ fontSize: 20 }}>sync</span>
                Updating Test Steps
              </h3>
              <button
                className="icon-button"
                onClick={() => setShowUpdateProgress(false)}
                title="Hide"
                style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--on-surface-variant)' }}
              >
                <span className="material-symbols" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>

            {/* Progress bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 8, background: 'var(--surface-container)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${(updateProgress.current / updateProgress.total) * 100}%`,
                  height: '100%',
                  background: updateProgress.status === "error" ? 'var(--error)' : 'var(--primary)',
                  borderRadius: 4,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--on-surface-variant)' }}>
                {updateProgress.current}/{updateProgress.total}
              </span>
            </div>

            {/* Current processing */}
            <div style={{ fontSize: 13, color: 'var(--on-surface-variant)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              {updateProgress.status === "processing" ? (
                <span className="material-symbols" style={{ fontSize: 16, animation: 'spin 1s linear infinite' }}>progress_activity</span>
              ) : updateProgress.status === "success" ? (
                <span className="material-symbols" style={{ fontSize: 16, color: 'var(--success)' }}>check_circle</span>
              ) : (
                <span className="material-symbols" style={{ fontSize: 16, color: 'var(--error)' }}>error</span>
              )}
              <span>{updateProgress.status === "processing" ? 'Processing' : updateProgress.status === "success" ? 'Completed' : 'Error'}: <strong>{updateProgress.currentKey}</strong></span>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Step conflict confirmation modal */}
      {stepConflictCheck && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => setStepConflictCheck(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 520, width: '90%', padding: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-symbols" style={{ color: 'var(--warning, #f59e0b)' }}>warning</span>
              XRay Test Steps Confirmation
            </h3>
            <p style={{ fontSize: 14, color: 'var(--on-surface-variant)', marginBottom: 16 }}>
              {stepConflictCheck.hasSteps.length} test(s) already have existing steps:
            </p>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 24, color: 'var(--on-surface)' }}>
              {stepConflictCheck.hasSteps.join(', ')}
            </div>
            <p style={{ fontSize: 14, color: 'var(--on-surface-variant)', marginBottom: 24 }}>
              Pilih aksi untuk step yang sudah ada:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="primary-button"
                onClick={() => confirmStepConflictUpdate("replace")}
                style={{ justifyContent: 'flex-start', padding: '12px 16px', height: 'auto', fontSize: 14, borderRadius: 8 }}
              >
                <span className="material-symbols" style={{ fontSize: 20 }}>swap_horiz</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>Replace</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Timpa semua step yang ada dengan data dari Confluence</div>
                </div>
              </button>
              <button
                className="secondary-button"
                onClick={() => confirmStepConflictUpdate("skip")}
                style={{ justifyContent: 'flex-start', padding: '12px 16px', height: 'auto', fontSize: 14, borderRadius: 8 }}
              >
                <span className="material-symbols" style={{ fontSize: 20 }}>skip_next</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>Skip</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Lewati test case yang sudah memiliki step</div>
                </div>
              </button>
              <button
                className="secondary-button"
                onClick={() => confirmStepConflictUpdate("append")}
                style={{ justifyContent: 'flex-start', padding: '12px 16px', height: 'auto', fontSize: 14, borderRadius: 8 }}
              >
                <span className="material-symbols" style={{ fontSize: 20 }}>add</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>Append</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Gabungkan step baru di akhir step yang sudah ada</div>
                </div>
              </button>
            </div>
            <button
              className="secondary-button"
              onClick={() => setStepConflictCheck(null)}
              style={{ width: '100%', marginTop: 16, padding: '10px', borderRadius: 8, fontSize: 14 }}
            >
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
