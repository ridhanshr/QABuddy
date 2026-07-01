use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BRDTestCaseStep {
    pub step_number: i32,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BRDTestCaseExpectedResult {
    pub step_number: i32,
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BRDTestCase {
    pub id: String,
    pub test_execution_id: String,
    pub name: String,
    pub feature_category: String,
    pub scenario_type: String,
    pub steps: Vec<BRDTestCaseStep>,
    pub expected_result: Vec<BRDTestCaseExpectedResult>,
    pub assignee: String,
    pub execution_status: String,
    pub sync_status: String,
    #[serde(default)]
    pub jira_test_case_key: Option<String>,
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BRDGenerationRequest {
    pub confluence_page_id: String,
    pub project_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BRDGenerationResult {
    pub success: bool,
    pub feature_name: String,
    pub test_cases: Vec<BRDTestCase>,
    /// The local test_execution_id that links these cases — pass to syncBRDTestCasesToJira
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_execution_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestPlan {
    pub id: String,
    #[serde(default)]
    pub jira_test_plan_key: Option<String>,
    pub uqa_key: String,
    pub phase: String,
    pub name: String,
    pub description: String,
    pub project_key: String,
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestExecution {
    pub id: String,
    #[serde(default)]
    pub jira_test_exec_key: Option<String>,
    pub test_plan_id: String,
    pub assignee: String,
    pub name: String,
    pub project_key: String,
    pub feature_name: String,
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BRDStoreData {
    pub test_plans: Vec<TestPlan>,
    pub test_executions: Vec<TestExecution>,
    pub test_cases: Vec<BRDTestCase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionMonitoringData {
    pub test_execution_id: String,
    pub test_execution_name: String,
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub blocked: usize,
    pub unexecuted: usize,
    pub pass_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResult {
    pub issue_key: String,
    pub summary: String,
    pub score: f64,
    pub match_reason: String,
}
