//! Jira-related models (projects, boards, bugs, Xray, bulk ops). Shapes
//! mirror `src/shared/types.ts` and are serialised as camelCase.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraProject {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraBoard {
    pub id: u32,
    pub name: String,
    /// Stored as "type" in TS.
    pub r#type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSprint {
    pub id: u32,
    pub name: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraStatus {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraUser {
    pub account_id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraField {
    pub id: String,
    pub name: String,
    /// "type" in TS.
    pub r#type: String,
    pub is_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BugFormDraft {
    pub title: String,
    pub steps_to_reproduce: String,
    pub actual_result: String,
    pub expected_result: String,
    pub environment: String,
    pub priority: String,
    pub labels: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BugPreview {
    pub summary: String,
    pub description: String,
    pub priority: String,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefectCreateDraft {
    pub project_key: String,
    pub issue_type: String,
    pub summary: String,
    pub description: String,
    pub steps_to_reproduce: String,
    pub expected_result: String,
    pub actual_result: String,
    pub environment: String,
    pub priority: String,
    pub labels: String,
    pub component: String,
    pub version: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkOperationResult {
    pub success: u32,
    pub failed: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XrayFolder {
    pub id: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<XrayFolder>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchTestStepsResult {
    pub issue_key: String,
    pub steps: String,
    pub expected_result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepConflictCheck {
    pub has_steps: Vec<String>,
    pub no_steps: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StepConflictMode {
    /// "replace"
    Replace,
    /// "skip"
    Skip,
    /// "append"
    Append,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceTestImportEntry {
    pub id: String,
    pub issue_key: String,
    pub scenario: String,
    pub steps: String,
    pub expected_result: String,
    pub function_name: String,
    pub test_case_no: String,
    pub input_data: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTestCasesFromConfluenceResult {
    pub success: Vec<UpdateTestSuccessEntry>,
    pub failed: Vec<UpdateTestFailedEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTestSuccessEntry {
    pub key: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTestFailedEntry {
    pub key: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub current: u32,
    pub total: u32,
    pub current_key: String,
    /// "processing" | "success" | "error"
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JqlBuilderFilters {
    pub project: String,
    pub sprint: String,
    pub status: String,
    pub assignee: String,
    pub labels: String,
}

/// Xray test run status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum XrayTestStatus {
    Todo,
    Executing,
    Pass,
    Fail,
    Aborted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XrayTestRun {
    pub id: u32,
    pub key: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defects: Option<Vec<XrayTestDefect>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XrayTestDefect {
    pub key: String,
    pub summary: String,
}

/// Result of creating an issue: `{ key, url }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedIssue {
    pub key: String,
    pub url: String,
}
