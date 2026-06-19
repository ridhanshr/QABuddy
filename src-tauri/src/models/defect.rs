//! Defect-repository models. Shapes mirror `src/shared/types.ts`
//! (`JiraProjectSource`, `DefectRecord`, `DuplicateRelation`, …) and are
//! serialised as camelCase.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DefectSyncMode {
    Initial,
    Incremental,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DefectSyncStatus {
    Idle,
    Syncing,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraProjectSource {
    pub id: String,
    pub project_key: String,
    pub project_name: String,
    pub is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_synced_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_sync_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_sync_days: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_sync_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_types: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_auto_sync_at: Option<String>,
    pub sync_mode: DefectSyncMode,
    pub sync_status: DefectSyncStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueSource {
    pub id: String,
    pub jira_issue_key: String,
    pub project_key: String,
    pub issue_type: String,
    pub summary: String,
    pub description: String,
    pub steps_to_reproduce: String,
    pub expected_result: String,
    pub actual_result: String,
    pub status: String,
    pub priority: String,
    pub severity: String,
    pub component: String,
    pub version: String,
    pub reporter: String,
    pub assignee: String,
    pub labels: Vec<String>,
    pub resolution: String,
    pub created_at: String,
    pub updated_at: String,
    pub comments: String,
    pub attachments_metadata: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefectRecord {
    pub id: String,
    pub source_issue_key: String,
    pub source_project_key: String,
    pub issue_type: String,
    pub normalized_title: String,
    pub normalized_description: String,
    pub search_text: String,
    pub status: String,
    pub component: String,
    pub version: String,
    pub severity: String,
    pub priority: String,
    pub similarity_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f64>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateRelation {
    pub id: String,
    pub primary_defect_id: String,
    pub duplicate_defect_id: String,
    pub reason: String,
    pub confidence_score: f64,
    pub created_by: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub id: String,
    pub project_key: String,
    pub last_cursor: String,
    pub last_sync_at: String,
    pub last_sync_status: String,
    pub error_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidate {
    pub defect: DefectRecord,
    pub score: f64,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilters {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub project_keys: Vec<String>,
    #[serde(default)]
    pub issue_types: Vec<String>,
    #[serde(default)]
    pub statuses: Vec<String>,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default)]
    pub versions: Vec<String>,
    #[serde(default)]
    pub severities: Vec<String>,
    #[serde(default)]
    pub use_ai: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DefectRepositoryStats {
    pub total_defects: u64,
    pub total_duplicates: u64,
    pub defects_per_project: Vec<NameCount>,
    pub duplicates_per_project: Vec<NameCount>,
    pub top_components: Vec<NameCount>,
    pub top_issue_types: Vec<NameCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameCount {
    pub name: String,
    pub count: u64,
}
