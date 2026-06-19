//! Connection-status, bootstrap and dashboard models. Field shapes mirror
//! `src/shared/types.ts` and are serialised as camelCase.

use serde::{Deserialize, Serialize};
use crate::models::app_config::AppConfig;

// ── Connection status ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatusItem {
    pub ok: bool,
    pub message: String,
}

impl Default for ConnectionStatusItem {
    fn default() -> Self {
        Self {
            ok: false,
            message: "Not checked".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub jira: ConnectionStatusItem,
    pub confluence: ConnectionStatusItem,
    pub ollama: ConnectionStatusItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthcheckResult {
    pub jira: ConnectionStatusItem,
    pub confluence: ConnectionStatusItem,
    pub ollama: ConnectionStatusItem,
    pub rag: ConnectionStatusItem,
    pub config: ConfigStatusItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatusItem {
    pub label: String,
    pub configured: bool,
}

// ── Bootstrap / dashboard ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrap {
    pub config: AppConfig,
    pub status: ConnectionStatus,
    pub dashboard: DashboardDigest,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DashboardDigest {
    pub insight: String,
    pub ready_for_qa: Vec<JiraIssueSummary>,
    pub bug_metrics: BugMetrics,
    /// Map keyed by project key.
    #[serde(default)]
    pub projects: std::collections::BTreeMap<String, DashboardProjectData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sprint_report: Option<SprintReport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_demo: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DashboardProjectData {
    pub bug_metrics: BugMetrics,
    pub ready_for_qa: Vec<JiraIssueSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BugMetrics {
    pub total_open: u32,
    pub critical: u32,
    pub high: u32,
    pub medium: u32,
    pub low: u32,
    pub resolved_this_sprint: u32,
    pub found_this_sprint: u32,
    pub epic_total: u32,
    pub epic_completed: u32,
    pub epic_tasks_total: u32,
    pub epic_tasks_resolved: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SprintReport {
    pub sprint_name: String,
    pub sprint_state: String,
    pub total_issues: u32,
    pub completed_issues: u32,
    pub to_do_issues: u32,
    pub in_progress_issues: u32,
    pub done_issues: u32,
    pub completion_percent: f64,
}

/// Lightweight Jira issue row used in dashboards / chat results.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueSummary {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub key: String,
    pub summary: String,
    pub status: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub assignee: String,
    #[serde(default)]
    pub r#type: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluencePageSummary {
    pub id: String,
    pub title: String,
    pub space_name: String,
    pub url: String,
    pub excerpt: String,
}

