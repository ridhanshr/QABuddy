//! UQA (daily activity) models. Shapes mirror `src/shared/types.ts` and are
//! serialised as camelCase.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UqaEntry {
    pub date: String,
    pub activity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UqaTransition {
    pub id: String,
    pub name: String,
    pub to_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UqaIssue {
    pub project_key: String,
    pub project_name: String,
    pub issue_key: String,
    pub summary: String,
    pub entries: Vec<UqaEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_updated: Option<String>,
    pub needs_update: bool,
    pub status: String,
    pub status_category: String,
    pub available_transitions: Vec<UqaTransition>,
    pub last_update_author: String,
    pub last_update_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerIssueReminder {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remind_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remind_days: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UqaSyncProgress {
    /// "fetching" | "processing" | "saving" | "done" | "error"
    pub status: String,
    pub message: String,
    pub current: u32,
    pub total: u32,
}

/// Summary of a test-execution phase (used by auto-generated UQA notes).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseTestSummary {
    pub phase: String,
    pub test_exec_key: String,
    pub test_exec_name: String,
    pub todo: u32,
    pub in_progress: u32,
    pub done: u32,
    pub failed: u32,
    pub aborted: u32,
    pub failed_details: Vec<PhaseFailedDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseFailedDetail {
    pub test_key: String,
    pub defects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoUqaGeneratedPayload {
    pub date: String,
    pub activity: Vec<String>,
    pub phases: Vec<PhaseTestSummary>,
    pub generated_notes: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_links_found: Option<bool>,
}
