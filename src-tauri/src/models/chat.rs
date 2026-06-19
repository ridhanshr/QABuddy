//! Chat / intent-router models. Shapes mirror `src/shared/types.ts`
//! (`ChatResponse`, `IntentClassification`, `ProjectInsightRequest`, …) and are
//! serialised as camelCase.

use serde::{Deserialize, Serialize};
use crate::models::connection::{JiraIssueSummary, ConfluencePageSummary};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryMessage {
    /// "user" | "assistant"
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    /// "jira" | "confluence" | "hybrid" | "error"
    pub mode: String,
    pub answer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jql: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issues: Option<Vec<JiraIssueSummary>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<Vec<ConfluencePageSummary>>,
}

/// Which backend a user query should be routed to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IntentRoute {
    Jira,
    Confluence,
    Mixed,
    Clarify,
}

impl IntentRoute {
    pub fn as_str(&self) -> &'static str {
        match self {
            IntentRoute::Jira => "jira",
            IntentRoute::Confluence => "confluence",
            IntentRoute::Mixed => "mixed",
            IntentRoute::Clarify => "clarify",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentClassification {
    pub route: IntentRoute,
    pub confidence: f64,
    pub reason: String,
    pub detected_keywords: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_hint: Option<String>,
}

/// Request payload for generating a project insight summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInsightRequest {
    pub project_key: String,
    pub bug_metrics: crate::models::connection::BugMetrics,
    pub ready_for_qa: Vec<JiraIssueSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sprint_report: Option<crate::models::connection::SprintReport>,
}
