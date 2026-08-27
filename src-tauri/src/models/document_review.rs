use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFinding {
    pub document_type: String,
    pub section: String,
    pub status: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub recommendation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validation_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueValidation {
    pub confluence_field: String,
    pub jira_key: String,
    pub expected_project_key: String,
    pub actual_project_key: String,
    pub issue_type: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_date: Option<String>,
    pub status_match: bool,
    pub project_match: bool,
    pub dates_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TestMeasureReconciliation {
    pub jira_execution_keys: Vec<String>,
    pub confluence_total: Option<u32>,
    pub jira_total: u32,
    pub confluence_executed: Option<u32>,
    pub jira_executed: u32,
    pub confluence_pass: Option<u32>,
    pub jira_pass: u32,
    pub confluence_fail: Option<u32>,
    pub jira_fail: u32,
    pub confluence_blocked: Option<u32>,
    pub jira_blocked: u32,
    pub confluence_not_executed: Option<u32>,
    pub jira_not_executed: u32,
    pub difference: i32,
    pub is_match: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JiraExecutionSummary {
    pub key: String,
    pub summary: String,
    pub issue_type: String,
    pub project_key: String,
    pub status: String,
    pub total: u32,
    pub executed: u32,
    pub pass: u32,
    pub fail: u32,
    pub blocked: u32,
    pub not_executed: u32,
    pub included: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPageSummary {
    pub page_id: String,
    pub title: String,
    pub url: String,
    pub document_type: String,
    pub parent_page_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReviewProgress {
    pub stage: String,
    pub message: String,
    pub current: u32,
    pub total: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finding: Option<ReviewFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    pub score: u32,
    pub overall_status: String,
    pub document_type: String,
    pub project: String,
    pub root_page_id: String,
    pub root_page_title: String,
    pub pages: Vec<ReviewPageSummary>,
    pub pass_count: u32,
    pub warning_count: u32,
    pub fail_count: u32,
    pub not_applicable_count: u32,
    pub findings: Vec<ReviewFinding>,
    pub jira_executions: Vec<JiraExecutionSummary>,
    pub reconciliation: Option<TestMeasureReconciliation>,
}
