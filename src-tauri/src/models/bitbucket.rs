use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketUser {
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub email_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketRef {
    pub id: String,
    pub display_id: String,
    #[serde(default)]
    pub latest_commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketPullRequest {
    pub id: u64,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    pub state: String,
    pub created_date: u64,
    pub updated_date: u64,
    pub from_ref: BitbucketRef,
    pub to_ref: BitbucketRef,
    pub author: Option<serde_json::Value>,
    #[serde(default)]
    pub jira_ticket_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketFileChange {
    pub path: String,
    pub change_type: String, // ADD, MODIFY, DELETE
    #[serde(default)]
    pub lines_added: usize,
    #[serde(default)]
    pub lines_deleted: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketDiffSummary {
    pub project_key: String,
    pub repo_slug: String,
    pub pr_id: u64,
    pub title: String,
    pub latest_commit_hash: String,
    pub author_name: String,
    pub branch_from: String,
    pub branch_to: String,
    pub files: Vec<BitbucketFileChange>,
    #[serde(default)]
    pub jira_ticket_key: Option<String>,
    #[serde(default)]
    pub jira_summary: Option<String>,
    #[serde(default)]
    pub jira_description: Option<String>,
    #[serde(default)]
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactAnalysisResult {
    pub affected_components: Vec<String>,
    pub modified_functions: Vec<String>,
    pub api_routes_changed: Vec<String>,
    pub regression_risk_level: String, // High, Medium, Low
    pub summary_notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GapAnalysisResult {
    pub existing_test_count: usize,
    pub missing_coverage_areas: Vec<String>,
    pub duplicate_risk_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestStepItem {
    pub step: usize,
    pub action: String,
    pub expected: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketTestScenario {
    pub scenario: String,
    pub confidence: u8, // 0 - 100
    pub reason: String,
    pub scenario_type: String, // Positive, Negative, Edge Case, Regression, Security
    pub risk_level: String, // High, Medium, Low
    pub preconditions: Vec<String>,
    pub steps: Vec<TestStepItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketGenerateRequest {
    pub pr_url_or_id: String,
    pub project_key: Option<String>,
    pub repo_slug: Option<String>,
    pub pr_id: Option<u64>,
    pub selected_files: Vec<String>,
    pub model_override: Option<String>,
    pub force_refresh_cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketGenerateResponse {
    pub pr_id: u64,
    pub commit_hash: String,
    pub cache_hit: bool,
    pub impact: ImpactAnalysisResult,
    pub gap: GapAnalysisResult,
    pub scenarios: Vec<BitbucketTestScenario>,
}
