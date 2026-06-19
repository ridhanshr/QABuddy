use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraConfig {
    pub base_url: String,
    pub auth_mode: AuthMode,
    pub username: String,
    pub token: String,
    pub project_key: String,
    pub ready_for_qa_jql: String,
    pub bug_issue_type: String,
    pub test_case_issue_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceConfig {
    pub base_url: String,
    pub auth_mode: AuthMode,
    pub username: String,
    pub token: String,
    pub space_key: String,
    pub target_page_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jira_server_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaConfig {
    pub endpoint: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jql_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extraction_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub insight_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defect_embedding_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defect_explanation_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UqaConfig {
    pub enabled: bool,
    pub remind_time: String,
    pub remind_days: Vec<u8>,
    /// Jira custom field id for "Product Tester", or null when not configured.
    #[serde(default)]
    pub product_tester_field_id: Option<String>,
    /// Map of issueKey → last ISO date a reminder was fired.
    #[serde(default)]
    pub last_notified_date: std::collections::BTreeMap<String, String>,
    /// Map of issueKey → per-issue reminder overrides.
    #[serde(default)]
    pub per_issue_reminders: std::collections::BTreeMap<String, crate::models::uqa::PerIssueReminder>,
    /// "productTester" | "assignee" | "both"
    pub search_mode: String,
    #[serde(default)]
    pub project_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preferences {
    pub theme: ThemePreference,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardProjectConfig {
    pub project_key: String,
    pub issue_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_jql: Option<String>,
    #[serde(default)]
    pub exclude_labels: Vec<String>,
    #[serde(default)]
    pub include_labels: Vec<String>,
    #[serde(default)]
    pub exclude_statuses: Vec<String>,
    #[serde(default)]
    pub include_statuses: Vec<String>,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub jira: JiraConfig,
    pub confluence: ConfluenceConfig,
    pub ollama: OllamaConfig,
    pub preferences: Preferences,
    pub uqa: UqaConfig,
    pub dashboard: DashboardConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DashboardConfig {
    #[serde(default)]
    pub projects: Vec<DashboardProjectConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMode {
    Bearer,
    Basic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    Light,
    Dark,
    System,
}

impl std::fmt::Display for ThemePreference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ThemePreference::Light => write!(f, "light"),
            ThemePreference::Dark => write!(f, "dark"),
            ThemePreference::System => write!(f, "system"),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            jira: JiraConfig {
                base_url: String::new(),
                auth_mode: AuthMode::Bearer,
                username: String::new(),
                token: String::new(),
                project_key: "QA".to_string(),
                ready_for_qa_jql: String::new(),
                bug_issue_type: "Bug".to_string(),
                test_case_issue_type: "Task".to_string(),
            },
            confluence: ConfluenceConfig {
                base_url: String::new(),
                auth_mode: AuthMode::Bearer,
                username: String::new(),
                token: String::new(),
                space_key: "QA".to_string(),
                target_page_id: String::new(),
                jira_server_id: None,
            },
            ollama: OllamaConfig {
                endpoint: "http://127.0.0.1:11434".to_string(),
                model: "qwen2.5:7b".to_string(),
                jql_model: None,
                chat_model: None,
                extraction_model: None,
                insight_model: None,
                defect_embedding_model: Some("embeddinggemma".to_string()),
                defect_explanation_model: None,
            },
            preferences: Preferences {
                theme: ThemePreference::Light,
                language: "id-ID".to_string(),
            },
            uqa: UqaConfig {
                enabled: false,
                remind_time: "16:00".to_string(),
                remind_days: vec![1, 2, 3, 4, 5],
                product_tester_field_id: None,
                last_notified_date: std::collections::BTreeMap::new(),
                per_issue_reminders: std::collections::BTreeMap::new(),
                search_mode: "both".to_string(),
                project_keys: vec![],
            },
            dashboard: DashboardConfig::default(),
        }
    }
}
