//! Remaining models that mirror `src/shared/types.ts`: Confluence sync/parse
//! results, update-info, and small helper types. Serialised as camelCase.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncToConfluencePayload {
    pub entries: Vec<serde_json::Value>,
    #[serde(default)]
    pub deleted_table_indices: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncToConfluenceResult {
    pub page_title: String,
    pub page_url: String,
    pub entry_count: u32,
    pub image_count: u32,
    pub attachment_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluencePreviewResult {
    pub current_title: String,
    pub current_version: u32,
    pub generated_tables: String,
    pub entry_count: u32,
    pub existing_entry_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseConfluenceEntriesOptions {
    #[serde(default)]
    pub debug: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseConfluenceEntriesResult {
    pub page_id: String,
    pub page_title: String,
    pub content_loaded: bool,
    pub entries: Vec<crate::models::jira::ConfluenceTestImportEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jira_server_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug: Option<ParseConfluenceParseDebugReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseConfluenceParseDebugReport {
    pub page_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_title: Option<String>,
    pub raw_page_content: String,
    pub content_length: usize,
    pub table_count: usize,
    pub parsed_table_count: usize,
    pub skipped_table_count: usize,
    pub unmatched_html_chunks: Vec<ParseConfluenceParseDebugChunk>,
    pub tables: Vec<ParseConfluenceParseDebugTable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseConfluenceParseDebugChunk {
    pub index: usize,
    pub reason: String,
    pub raw_html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseConfluenceParseDebugRow {
    pub label: Option<String>,
    /// "mapped" | "unmapped-label" | "missing-label" | "empty-value"
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mapped_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub raw_html: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseConfluenceParseDebugTable {
    pub index: usize,
    pub parsed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub raw_html: String,
    pub rows: Vec<ParseConfluenceParseDebugRow>,
    pub mapped_fields: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_summary: Option<ParseConfluenceEntrySummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseConfluenceEntrySummary {
    pub test_case_no: String,
    pub function_name: String,
    pub scenario: String,
    pub category: String,
    pub result: String,
    pub image_count: u32,
}

// ── Update info (auto-updater) ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub url: String,
    pub published_at: String,
    pub checked_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for UpdateInfo {
    fn default() -> Self {
        Self {
            update_available: false,
            current_version: String::new(),
            latest_version: String::new(),
            release_notes: String::new(),
            url: String::new(),
            published_at: String::new(),
            checked_at: String::new(),
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub progress: f64,
    pub downloaded: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UqaIssueLink {
    pub issue_key: String,
    pub issue_type_name: String,
    pub summary: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfluenceImportMode {
    Auto,
    /// "jql-match"
    #[serde(rename = "jql-match")]
    JqlMatch,
}

/// Result of indexing a source into the RAG store: `{ indexed, skipped }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexResult {
    pub indexed: u32,
    pub skipped: u32,
}

/// Log entry shape used by the renderer's Logs screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub level: String,
    pub scope: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}
