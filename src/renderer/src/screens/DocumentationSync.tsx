import React from "react";
import { useApp } from "../context/AppContext";
import type { ConfAttachment } from "../hooks/useAppState";

export default function DocumentationSync() {
  const {
    activeView,
    loading,
    confParseStatus,
    confTab,
    setConfTab,
    downloadConfTemplate,
    handleConfFileUpload,
    syncConfluence,
    confLoading,
    confEntries,
    removeConfEntry,
    updateConfEntry,
    handleImagePaste,
    draggedAttachment,
    setDraggedAttachment,
    moveConfAttachment,
    moveConfAttachmentByOffset,
    updateConfAttachmentNote,
    removeImage,
    handleConfFileAttachment,
    addConfEntry,
    config,
    setConfig,
    parseConfPageEntries,
    loadConfPagePreview,
    previewConfluenceSync,
    confPageLoading,
    confPreviewLoading,
    confPagePreview,
    confSyncPreview,
    saveSettings
  } = useApp();

  if (loading || activeView !== "documentation-sync") {
    return null;
  }

  function normalizeConfAttachments(attachments: ConfAttachment[], sortByOrder = false): ConfAttachment[] {
    const arr = [...attachments];
    if (sortByOrder) {
      arr.sort((a, b) => a.order - b.order);
    }
    return arr.map((attachment, index) => ({
      ...attachment,
      order: index + 1,
    }));
  }

  return (
    <section style={{ maxWidth: 1000, margin: "0 auto", paddingBottom: 100 }}>
      <div style={{ marginBottom: 32 }}>
        <h2 className="text-display">Documentation Sync</h2>
        <p className="text-body-lg">Sync your testing documentation directly to Confluence pages.</p>
        {confParseStatus && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              borderRadius: 12,
              border: `1px solid ${confParseStatus.contentLoaded ? "var(--outline-variant)" : "var(--error)"}`,
              background: confParseStatus.contentLoaded ? "var(--surface-container-low)" : "color-mix(in srgb, var(--error) 8%, var(--surface))",
              color: "var(--on-surface)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {confParseStatus.contentLoaded
                ? `Page ${confParseStatus.pageId} berhasil dibaca${confParseStatus.pageTitle ? `: ${confParseStatus.pageTitle}` : ""}`
                : `Page ${confParseStatus.pageId} tidak terambil`}
            </div>
            <div style={{ fontSize: 12, color: "var(--on-surface-variant)", lineHeight: 1.5 }}>
              {confParseStatus.contentLoaded
                ? `${confParseStatus.entries.length} entry terdeteksi dari page ini${confParseStatus.jiraServerId ? `, Jira Server ID: ${confParseStatus.jiraServerId}` : ""}.`
                : `Content tidak bisa diambil${confParseStatus.error ? `, error: ${confParseStatus.error}` : ""}.`}
            </div>
          </div>
        )}
        
        <div className="doc-sync-tabs">
          <button 
            onClick={() => setConfTab("form")}
            className={`doc-sync-tab ${confTab === "form" ? "active" : ""}`}
          >
            <span className="material-symbols" style={{ fontSize: 20 }}>edit_note</span>
            Data Entry
          </button>
          <button 
            onClick={() => setConfTab("settings")}
            className={`doc-sync-tab ${confTab === "settings" ? "active" : ""}`}
          >
            <span className="material-symbols" style={{ fontSize: 20 }}>settings_applications</span>
            Sync Settings
          </button>
        </div>
      </div>

      {confTab === "form" && (
        <>
          <div className="page-header" style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <h4 style={{ margin: 0, color: 'var(--on-surface-variant)' }}>Enter Test Documentation</h4>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                className="secondary-button" 
                onClick={downloadConfTemplate}
                style={{ padding: '4px 12px', height: '32px', borderRadius: 6, fontSize: 13 }}
              >
                <span className="material-symbols" style={{ fontSize: 18 }}>download</span>
                Template
              </button>
              <input 
                type="file" 
                id="conf-upload" 
                accept=".csv,.xlsx,.xls" 
                onChange={handleConfFileUpload} 
                style={{ display: 'none' }} 
              />
              <button 
                className="secondary-button" 
                onClick={() => document.getElementById('conf-upload')?.click()}
                style={{ padding: '4px 12px', height: '32px', borderRadius: 6, fontSize: 13 }}
              >
                <span className="material-symbols" style={{ fontSize: 18 }}>upload_file</span>
                Import
              </button>
              <button 
                className="primary-button" 
                onClick={() => void syncConfluence()} 
                disabled={confLoading}
                style={{ padding: '4px 16px', height: '32px', borderRadius: 6, fontSize: 13 }}
              >
                <span className="material-symbols" style={{ fontSize: 18 }}>{confLoading ? 'progress_activity' : 'cloud_upload'}</span>
                {confLoading ? 'Syncing...' : 'Sync to Confluence'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {confEntries.map((item, index) => (
              <div className="card" key={item.id} style={{ padding: 32, marginBottom: 24, border: '1px solid var(--outline-variant)', borderRadius: 16, background: 'var(--surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--outline-variant)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="material-symbols" style={{ color: 'var(--tertiary)', fontSize: 20 }}>bookmark_flag</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tertiary)', textTransform: 'uppercase', letterSpacing: 1.2 }}>
                      Entry #{index + 1}
                    </span>
                  </div>
                  {confEntries.length > 1 && (
                    <button 
                      className="icon-button" 
                      onClick={() => removeConfEntry(item.id)}
                      style={{ color: 'var(--error)', background: 'color-mix(in srgb, var(--error) 10%, transparent)', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="Hapus Entry"
                    >
                      <span className="material-symbols" style={{ fontSize: 20 }}>delete</span>
                    </button>
                  )}
                </div>

                {/* Top Row: Single-line controls (No. TC, Function, Kategori, Result) */}
                <div style={{ display: 'grid', gridTemplateColumns: '140px 2fr 1fr 180px', gap: 20, alignItems: 'end' }}>
                  <div className="field-group">
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface-variant)' }}>No. Test Case</label>
                    <input 
                      placeholder="TC001" 
                      value={item.testCaseNo}
                      onChange={(e) => updateConfEntry(item.id, "testCaseNo", e.target.value)}
                      style={{ height: 45, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div className="field-group">
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Function</label>
                    <input 
                      placeholder="e.g. Limit Maintenance" 
                      value={item.functionName}
                      onChange={(e) => updateConfEntry(item.id, "functionName", e.target.value)}
                      style={{ height: 45, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div className="field-group">
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Kategori</label>
                    <select 
                      value={item.category}
                      onChange={(e) => updateConfEntry(item.id, "category", e.target.value)}
                      style={{ height: 45, width: '100%', borderRadius: 8, border: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)', color: 'var(--on-surface)', padding: '0 12px', fontSize: 14, boxSizing: 'border-box', outline: 'none' }}
                    >
                      <option value="Positive">Positive</option>
                      <option value="Negative">Negative</option>
                      <option value="Regression">Regression</option>
                    </select>
                  </div>
                  <div className="field-group">
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Result</label>
                    <div style={{ display: 'flex', gap: 8, height: 45, boxSizing: 'border-box' }}>
                      <button 
                        onClick={() => updateConfEntry(item.id, "result", "PASS")}
                        style={{ 
                          flex: 1, height: '100%', borderRadius: 8, border: item.result === "PASS" ? 'none' : '1px solid var(--outline-variant)',
                          background: item.result === "PASS" ? '#10b981' : 'var(--surface-container-low)',
                          color: item.result === "PASS" ? 'white' : 'var(--on-surface)',
                          fontWeight: item.result === "PASS" ? 600 : 400,
                          cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
                        }}
                        type="button"
                      >PASS</button>
                      <button 
                        onClick={() => updateConfEntry(item.id, "result", "FAILED")}
                        style={{ 
                          flex: 1, height: '100%', borderRadius: 8, border: item.result === "FAILED" ? 'none' : '1px solid var(--outline-variant)',
                          background: item.result === "FAILED" ? '#ef4444' : 'var(--surface-container-low)',
                          color: item.result === "FAILED" ? 'white' : 'var(--on-surface)',
                          fontWeight: item.result === "FAILED" ? 600 : 400,
                          cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
                        }}
                        type="button"
                      >FAILED</button>
                    </div>
                  </div>
                </div>

                {/* Second Row: Context Textareas (Scenario & Input Data) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 24 }}>
                  <div className="field-group">
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Scenario</label>
                    <textarea
                      rows={3}
                      placeholder="e.g. WAY4-240"
                      value={item.scenario}
                      onChange={(e) => updateConfEntry(item.id, "scenario", e.target.value)}
                      style={{ boxSizing: 'border-box', minHeight: 80, resize: 'vertical' }}
                    />
                  </div>
                  <div className="field-group">
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Input Data</label>
                    <textarea
                      rows={3}
                      placeholder="e.g. Kartu block code N..."
                      value={item.inputData}
                      onChange={(e) => updateConfEntry(item.id, "inputData", e.target.value)}
                      style={{ boxSizing: 'border-box', minHeight: 80, resize: 'vertical' }}
                    />
                  </div>
                </div>

                {/* Third Row: Action & Expectation Textareas (Steps & Expected Result) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 24 }}>
                  <div className="field-group">
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Steps</label>
                    <textarea 
                      rows={4} 
                      placeholder="Melakukan update credit limit contract..."
                      value={item.steps}
                      onChange={(e) => updateConfEntry(item.id, "steps", e.target.value)}
                      style={{ boxSizing: 'border-box', minHeight: 100, resize: 'vertical' }}
                    />
                  </div>
                  <div className="field-group">
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Expected Result</label>
                    <textarea 
                      rows={4} 
                      placeholder="Value Cr Limit date pada Workbench/Desktop Client sesuai..."
                      value={item.expectedResult}
                      onChange={(e) => updateConfEntry(item.id, "expectedResult", e.target.value)}
                      style={{ boxSizing: 'border-box', minHeight: 100, resize: 'vertical' }}
                    />
                  </div>
                </div>

                {/* Fourth Row: Screen Capture */}
                <div className="field-group" style={{ marginTop: 24 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Screen Capture (Paste images or upload files)</label>
                  <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginTop: 6, marginBottom: 10 }}>
                    Urutan attachment disimpan eksplisit. Drag-and-drop kartu untuk mengubah urutan sebelum sync.
                  </p>
                  <div 
                    onPaste={(e) => handleImagePaste(item.id, e)}
                    style={{ 
                      minHeight: 120, border: '2px dashed var(--outline-variant)', 
                      borderRadius: 12, padding: 20, display: 'flex', flexWrap: 'wrap', gap: 12,
                      background: 'var(--surface-container-lowest)', cursor: 'text',
                      alignItems: item.images.length === 0 ? 'center' : 'flex-start',
                      justifyContent: item.images.length === 0 ? 'center' : 'flex-start',
                      transition: 'border-color 0.2s, background 0.2s'
                    }}
                  >
                    {item.images.length === 0 && (
                      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-variant)', pointerEvents: 'none' }}>
                        <span className="material-symbols" style={{ fontSize: 32, marginBottom: 8, color: 'var(--primary)' }}>add_photo_alternate</span>
                        <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Paste images or click to attach documents</p>
                        <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', marginTop: 4, opacity: 0.8 }}>Supports PNG, JPG, and document files</p>
                      </div>
                    )}
                    {normalizeConfAttachments(item.images).map((img: ConfAttachment) => {
                      const isImage = img.data.startsWith("data:image/");
                      return (
                        <div
                          key={img.id}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const draggedId = draggedAttachment?.attachmentId || event.dataTransfer.getData("text/plain");
                            if (draggedId) {
                              moveConfAttachment(item.id, draggedId, img.id);
                            }
                            setDraggedAttachment(null);
                          }}
                          onDragEnd={() => setDraggedAttachment(null)}
                          style={{
                            position: 'relative',
                            width: isImage ? 188 : 228,
                            minHeight: isImage ? 232 : 168,
                            borderRadius: 8,
                            border: draggedAttachment?.attachmentId === img.id ? '1px solid var(--primary)' : '1px solid var(--outline-variant)',
                            display: 'flex',
                            alignItems: 'stretch',
                            padding: 0,
                            overflow: 'hidden',
                            background: 'var(--surface-container)',
                            boxShadow: 'var(--shadow-sm)',
                            flexDirection: 'column'
                          }}
                        >
                          <div style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ background: 'rgba(0,0,0,0.65)', color: 'white', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                              #{img.order}
                            </span>
                            <span
                              className="material-symbols"
                              draggable
                              onDragStart={(event) => {
                                event.stopPropagation();
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", img.id);
                                setDraggedAttachment({ entryId: item.id, attachmentId: img.id });
                              }}
                              onDragEnd={() => setDraggedAttachment(null)}
                              style={{ fontSize: 16, color: 'white', background: 'rgba(0,0,0,0.45)', borderRadius: 999, padding: 2, cursor: 'grab' }}
                              title="Drag untuk reorder"
                            >
                              drag_indicator
                            </span>
                          </div>
                          <div style={{ position: 'absolute', top: 6, right: 34, zIndex: 1, display: 'flex', gap: 4 }}>
                            <button
                              onMouseDown={(event) => event.stopPropagation()}
                              onDragStart={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                moveConfAttachmentByOffset(item.id, img.id, -1);
                              }}
                              disabled={img.order === 1}
                              style={{ background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: 999, width: 24, height: 24, cursor: img.order === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: img.order === 1 ? 0.45 : 1 }}
                              type="button"
                              title="Geser ke atas"
                            >
                              <span className="material-symbols" style={{ fontSize: 14 }}>keyboard_arrow_up</span>
                            </button>
                            <button
                              onMouseDown={(event) => event.stopPropagation()}
                              onDragStart={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                moveConfAttachmentByOffset(item.id, img.id, 1);
                              }}
                              disabled={img.order === item.images.length}
                              style={{ background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: 999, width: 24, height: 24, cursor: img.order === item.images.length ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: img.order === item.images.length ? 0.45 : 1 }}
                              type="button"
                              title="Geser ke bawah"
                            >
                              <span className="material-symbols" style={{ fontSize: 14 }}>keyboard_arrow_down</span>
                            </button>
                          </div>
                          {isImage ? (
                            <>
                              <img src={img.data} style={{ width: '100%', height: 118, objectFit: 'cover', flexShrink: 0 }} />
                              <div style={{ width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.72)', color: 'white', fontSize: 11, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {img.name}
                              </div>
                            </>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '42px 12px 10px' }}>
                              <span className="material-symbols" style={{ fontSize: 24, color: 'var(--primary)' }}>description</span>
                              <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{img.name}</span>
                            </div>
                          )}
                          <div style={{ padding: '8px 10px 10px' }}>
                            <textarea
                              value={img.note || ""}
                              onChange={(event) => updateConfAttachmentNote(item.id, img.id, event.target.value)}
                              placeholder="Catatan / label attachment"
                              rows={3}
                              style={{ width: '100%', resize: 'vertical', minHeight: 62, boxSizing: 'border-box', fontSize: 12, borderRadius: 6, border: '1px solid var(--outline-variant)', background: 'var(--surface)', color: 'var(--on-surface)', padding: '8px 10px' }}
                            />
                          </div>
                          <button 
                            onMouseDown={(event) => event.stopPropagation()}
                            onDragStart={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              removeImage(item.id, img.id);
                            }}
                            style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}
                            type="button"
                          >
                            <span className="material-symbols" style={{ fontSize: 14 }}>close</span>
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => handleConfFileAttachment(item.id)}
                      style={{ height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--outline-variant)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--on-surface)', boxShadow: 'var(--shadow-xs)', alignSelf: 'center' }}
                      type="button"
                    >
                      <span className="material-symbols" style={{ fontSize: 16, color: 'var(--primary)' }}>attachment</span>
                      Tambah File
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button 
              className="secondary-button" 
              onClick={addConfEntry}
              style={{ border: '1px dashed var(--outline-variant)', background: 'var(--surface-container-low)', height: 50, borderRadius: 8 }}
            >
              <span className="material-symbols" style={{ fontSize: 20 }}>add_circle</span>
              Add Another Entry
            </button>
          </div>
        </>
      )}

      {confTab === "settings" && (
        <div className="card" style={{ padding: 40 }}>
          <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>Confluence Sync Configuration</h3>
          <div className="field-group" style={{ maxWidth: 500 }}>
            <label>Target Page ID</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input 
                placeholder="e.g. 123456789" 
                value={config.confluence.targetPageId}
                onChange={(e) => setConfig({ ...config, confluence: { ...config.confluence, targetPageId: e.target.value } })}
                style={{ flex: 1 }}
              />
              <button 
                className="secondary-button" 
                onClick={() => void parseConfPageEntries()}
                disabled={confPageLoading || !config.confluence.targetPageId.trim()}
                type="button"
                style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14, whiteSpace: 'nowrap' }}
              >
                <span className="material-symbols" style={{ fontSize: 18, marginRight: 4 }}>table_rows</span>
                {confPageLoading ? "Loading..." : "Parse Entries from Page"}
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginTop: 8 }}>
              Masukkan ID halaman Confluence tempat template tabel berada. Klik "Parse Entries from Page" untuk mengambil dan menyunting tabel yang ada secara instan.
            </p>
          </div>

          <div className="field-group" style={{ maxWidth: 500, marginTop: 20 }}>
            <label>Jira Server ID <span style={{ color: 'var(--on-surface-variant)', fontWeight: 400 }}>(opsional, untuk Jira macro)</span></label>
            <input 
              placeholder="Auto-detected saat Parse Entries" 
              value={config.confluence.jiraServerId || ""}
              onChange={(e) => setConfig({ ...config, confluence: { ...config.confluence, jiraServerId: e.target.value } })}
            />
            <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginTop: 8 }}>
              Diperlukan untuk mengirim Jira macro ke Confluence. Biasanya terdeteksi otomatis saat "Parse Entries from Page".
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 24 }}>
            <button
              className="secondary-button"
              onClick={() => void loadConfPagePreview()}
              disabled={confPageLoading || !config.confluence.targetPageId.trim()}
              type="button"
              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14 }}
            >
              <span className="material-symbols" style={{ fontSize: 18, marginRight: 6 }}>preview</span>
              {confPageLoading ? "Loading..." : "Preview Page"}
            </button>
            <button
              className="secondary-button"
              onClick={() => void previewConfluenceSync()}
              disabled={confPreviewLoading || !config.confluence.targetPageId.trim()}
              type="button"
              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14 }}
            >
              <span className="material-symbols" style={{ fontSize: 18, marginRight: 6 }}>fact_check</span>
              {confPreviewLoading ? "Preparing..." : "Preview Sync"}
            </button>
          </div>

          {confPagePreview && (
            <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: "1px solid var(--outline-variant)", background: "var(--surface-container-low)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{confPagePreview.title}</h4>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--on-surface-variant)" }}>Version {confPagePreview.version}</p>
                </div>
                <span style={{ fontSize: 12, color: "var(--primary)" }}>{confPagePreview.content.length} chars loaded</span>
              </div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto", fontSize: 12, lineHeight: 1.6 }}>{confPagePreview.content.slice(0, 1200)}</pre>
            </div>
          )}

          {confSyncPreview && (
            <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: "1px solid var(--outline-variant)", background: "rgba(37, 99, 235, 0.06)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>Current Title</div>
                  <div style={{ fontWeight: 600 }}>{confSyncPreview.currentTitle}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>Entry Count</div>
                  <div style={{ fontWeight: 600 }}>{confSyncPreview.entryCount}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>Existing Entries</div>
                  <div style={{ fontWeight: 600 }}>{confSyncPreview.existingEntryCount}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>Version</div>
                  <div style={{ fontWeight: 600 }}>{confSyncPreview.currentVersion}</div>
                </div>
              </div>
              <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", fontSize: 12, lineHeight: 1.6 }}>{confSyncPreview.generatedTables}</pre>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <button 
              className="primary-button" 
              onClick={() => void saveSettings()}
              style={{ padding: '8px 24px', borderRadius: 8, fontSize: 14 }}
              type="button"
            >
              <span className="material-symbols" style={{ fontSize: 18, marginRight: 6 }}>save</span>
              Save Sync Settings
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
