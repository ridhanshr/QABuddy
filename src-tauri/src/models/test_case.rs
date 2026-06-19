//! Test-case related models. Field shapes mirror the TypeScript contract in
//! `src/shared/types.ts` (`ExtractedTestCase`, `ManualTestCase`, …) and are
//! serialised as camelCase so the renderer can consume them unchanged.

use serde::{Deserialize, Serialize};

/// A test case extracted from a Confluence page by the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedTestCase {
    pub id: String,
    pub title: String,
    pub objective: String,
    pub priority: String,
    pub category: String,
    pub selected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_evidence: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

/// Result of extracting test cases from a Confluence page.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedTestCaseResult {
    pub page_title: String,
    pub source_url: String,
    pub test_cases: Vec<ExtractedTestCase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_fallback: Option<bool>,
}

/// Outcome of a single extraction run before conversion to the renderer-facing
/// result type.
#[derive(Debug, Clone)]
pub struct TestCaseExtractionRun {
    pub test_cases: Vec<ExtractedTestCase>,
    pub used_fallback: bool,
}

/// A manually-authored test case (Manual Test Case screen).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualTestCase {
    pub id: String,
    pub title: String,
    pub description: String,
    pub steps: String,
    pub expected_result: String,
    pub xray_folder: String,
    pub labels: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_key: Option<String>,
}

/// Result of a recorded test execution entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaseExecution {
    pub id: String,
    pub test_case_id: String,
    pub test_case_title: String,
    pub result: String, // "PASS" | "FAILED"
    pub executed_by: String,
    pub executed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_issue_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionStats {
    pub total_executions: u32,
    pub total_passed: u32,
    pub total_failed: u32,
    pub pass_rate: f64,
}
