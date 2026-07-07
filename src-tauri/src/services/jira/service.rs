//! Jira service — high-level operations ported from `jira-service.ts`.
//! Covers connection testing, JQL search, dashboard metrics, sprint reports,
//! project metadata, issue creation, bulk operations, Xray organisation,
//! UQA, and Confluence→Jira test-step updates.

use chrono::Utc;
use serde_json::{json, Value};

use crate::models::app_config::JiraConfig;
use crate::models::connection::{BugMetrics, JiraIssueSummary, SprintReport};
use crate::models::jira::{
    BulkOperationResult, BugFormDraft, BugPreview, ConfluenceTestImportEntry, CreatedIssue,
    DefectCreateDraft, FetchTestStepsResult, JiraBoard, JiraProject, JiraSprint, JiraStatus,
    JiraUser, StepConflictCheck, StepConflictMode,
    UpdateTestCasesFromConfluenceResult, UpdateTestFailedEntry, UpdateTestSuccessEntry, XrayFolder,
};
use crate::models::test_case::ManualTestCase;
use crate::models::uqa::{
    AutoUqaGeneratedPayload, PhaseFailedDetail, PhaseTestSummary, UqaEntry, UqaIssue, UqaTransition,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::services::error::{Result, ServiceError};
use crate::services::http::normalize_url;
use crate::services::jira::client::JiraClient;
use crate::services::text_utils::adf_to_plain_text;

const XRAY_FOLDER_CACHE_SECS: u64 = 1800; // 30 minutes

pub struct JiraService {
    cache_path: Option<PathBuf>,
    // In-memory cache: project_key → (folders, fetched_at)
    xray_folder_cache: Mutex<HashMap<String, (Vec<XrayFolder>, Instant)>>,
}

impl JiraService {
    pub fn new() -> Self {
        Self { cache_path: None, xray_folder_cache: Mutex::new(HashMap::new()) }
    }

    pub fn with_cache(app_handle: &AppHandle) -> Self {
        let cache_path = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_default()
            .join("jira-project-cache.json");
        Self { cache_path: Some(cache_path), xray_folder_cache: Mutex::new(HashMap::new()) }
    }

    fn read_cache(&self) -> Option<Vec<JiraProject>> {
        let path = self.cache_path.as_ref()?;
        let raw = std::fs::read_to_string(path).ok()?;
        #[derive(serde::Deserialize)]
        struct Cache {
            projects: Vec<JiraProject>,
            timestamp: u64,
        }
        let cache: Cache = serde_json::from_str(&raw).ok()?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        // 1-hour TTL
        if now.saturating_sub(cache.timestamp) < 3600 {
            Some(cache.projects)
        } else {
            None
        }
    }

    fn write_cache(&self, projects: &[JiraProject]) {
        let path = match self.cache_path.as_ref() {
            Some(p) => p,
            None => return,
        };
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let cache = serde_json::json!({ "projects": projects, "timestamp": timestamp });
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, serde_json::to_string(&cache).unwrap());
    }

    pub fn client(&self, config: &JiraConfig) -> Result<JiraClient> {
        if config.base_url.is_empty() || config.token.is_empty() {
            return Err(ServiceError::Config(
                "Jira base URL or token not configured".into(),
            ));
        }
        JiraClient::new(config)
    }

    fn assert_configured(&self, config: &JiraConfig) -> Result<()> {
        if config.base_url.is_empty() || config.token.is_empty() || config.project_key.is_empty() {
            return Err(ServiceError::Config(
                "Konfigurasi Jira belum lengkap. Isi URL, token, dan project key di Settings."
                    .into(),
            ));
        }
        Ok(())
    }

    pub async fn test_connection(&self, config: &JiraConfig) -> Result<String> {
        let client = self.client(config)?;
        let user = client.get_current_user().await?;
        let name = user
            .get("displayName")
            .and_then(|v| v.as_str())
            .or_else(|| user.get("name").and_then(|v| v.as_str()))
            .or_else(|| user.get("emailAddress").and_then(|v| v.as_str()))
            .unwrap_or("connected");
        Ok(format!("Connected as {name}"))
    }

    // ── JQL helpers ─────────────────────────────────────────────────────

    fn build_label_filters(exclude: &[String], include: &[String]) -> String {
        let mut parts: Vec<String> = Vec::new();
        if !exclude.is_empty() {
            let q: Vec<String> = exclude.iter().map(|l| format!("\"{l}\"")).collect();
            parts.push(format!("AND labels NOT IN ({})", q.join(", ")));
        }
        if !include.is_empty() {
            let q: Vec<String> = include.iter().map(|l| format!("\"{l}\"")).collect();
            parts.push(format!("AND labels IN ({})", q.join(", ")));
        }
        parts.join(" ")
    }

    fn build_status_filters(exclude: &[String], include: &[String]) -> String {
        let mut parts: Vec<String> = Vec::new();
        if !exclude.is_empty() {
            let q: Vec<String> = exclude.iter().map(|s| format!("\"{s}\"")).collect();
            parts.push(format!("AND status NOT IN ({})", q.join(", ")));
        }
        if !include.is_empty() {
            let q: Vec<String> = include.iter().map(|s| format!("\"{s}\"")).collect();
            parts.push(format!("AND status IN ({})", q.join(", ")));
        }
        parts.join(" ")
    }

    fn map_issue_to_summary(issue: &Value, base_url: &str) -> JiraIssueSummary {
        let fields = &issue["fields"];
        let key = issue["key"].as_str().unwrap_or("").to_string();
        let id = issue["id"].as_str().unwrap_or("").to_string();
        JiraIssueSummary {
            id,
            key: key.clone(),
            summary: fields["summary"].as_str().unwrap_or("").to_string(),
            status: fields["status"]["name"].as_str().unwrap_or("-").to_string(),
            priority: fields["priority"]["name"].as_str().unwrap_or("-").to_string(),
            assignee: fields["assignee"]["displayName"]
                .as_str()
                .unwrap_or("Unassigned")
                .to_string(),
            r#type: fields["issuetype"]["name"].as_str().unwrap_or("-").to_string(),
            url: format!("{}/browse/{}", normalize_url(base_url), key),
        }
    }

    pub async fn search_issues(
        &self,
        config: &JiraConfig,
        jql: &str,
        max_results: u32,
    ) -> Result<Vec<JiraIssueSummary>> {
        let client = self.client(config)?;
        let issues = client
            .search_issues(
                jql,
                max_results,
                "summary,status,priority,assignee,issuetype",
            )
            .await?;
        Ok(issues
            .iter()
            .map(|i| Self::map_issue_to_summary(i, &config.base_url))
            .collect())
    }

    pub async fn find_issues_by_jql(
        &self,
        config: &JiraConfig,
        jql: &str,
        max_results: u32,
    ) -> Result<Vec<JiraIssueSummary>> {
        self.search_issues(config, jql, max_results).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn get_ready_for_qa_issues(
        &self,
        config: &JiraConfig,
        project_key: Option<&str>,
        issue_type: Option<&str>,
        exclude_labels: &[String],
        include_labels: &[String],
        exclude_statuses: &[String],
        include_statuses: &[String],
    ) -> Result<Vec<JiraIssueSummary>> {
        let pk = project_key.unwrap_or(&config.project_key);
        let it = issue_type.unwrap_or(&config.bug_issue_type);
        if pk.is_empty() || it.is_empty() {
            return Ok(vec![]);
        }
        let label_filter = Self::build_label_filters(exclude_labels, include_labels);
        let status_filter = Self::build_status_filters(exclude_statuses, include_statuses);
        let base_jql = if config.ready_for_qa_jql.trim().is_empty() {
            format!(
                "project = \"{pk}\" AND issuetype = \"{it}\" ORDER BY priority DESC, updated DESC"
            )
        } else {
            config.ready_for_qa_jql.trim().to_string()
        };

        let order_re = regex::Regex::new(r"(?is)^(.*?)\s*(ORDER\s+BY\s+.*)$").unwrap();
        let (filter_part, order_part) = if let Some(c) = order_re.captures(&base_jql) {
            (c[1].trim().to_string(), format!(" {}", c[2].trim()))
        } else {
            (base_jql.clone(), String::new())
        };
        let jql = format!("{filter_part} {label_filter} {status_filter}{order_part}");
        self.search_issues(config, &jql, 1000).await
    }

    // ── Metrics & reports ───────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub async fn get_bug_metrics(
        &self,
        config: &JiraConfig,
        project_key: Option<&str>,
        issue_type: Option<&str>,
        exclude_labels: &[String],
        include_labels: &[String],
        exclude_statuses: &[String],
        include_statuses: &[String],
    ) -> Result<BugMetrics> {
        let project = project_key.unwrap_or(&config.project_key);
        let it = issue_type.unwrap_or(&config.bug_issue_type);
        if project.is_empty() || it.is_empty() {
            return Ok(BugMetrics::default());
        }
        let client = self.client(config)?;
        let type_filter = format!("AND issuetype = \"{it}\"");
        let label_filter = Self::build_label_filters(exclude_labels, include_labels);
        let status_filter = Self::build_status_filters(exclude_statuses, include_statuses);

        let base = format!("project = \"{project}\" {type_filter} {status_filter}");
        let total_open =
            client.count_by_jql(&format!("{base} {label_filter}")).await.unwrap_or(0) as u32;
        let critical = client
            .count_by_jql(&format!("{base} AND priority = Critical {label_filter}"))
            .await
            .unwrap_or(0) as u32;
        let high = client
            .count_by_jql(&format!("{base} AND priority = High {label_filter}"))
            .await
            .unwrap_or(0) as u32;
        let medium = client
            .count_by_jql(&format!("{base} AND priority = Medium {label_filter}"))
            .await
            .unwrap_or(0) as u32;
        let low = client
            .count_by_jql(&format!("{base} AND priority = Low {label_filter}"))
            .await
            .unwrap_or(0) as u32;

        let mut epic_total = 0u32;
        let mut epic_completed = 0u32;
        if let Ok(t) = client
            .count_by_jql(&format!("project = \"{project}\" AND issuetype = Epic"))
            .await
        {
            epic_total = t as u32;
        }
        if let Ok(c) = client
            .count_by_jql(&format!(
                "project = \"{project}\" AND issuetype = Epic AND resolution != Unresolved"
            ))
            .await
        {
            epic_completed = c as u32;
        }
        let mut epic_tasks_total = 0u32;
        let mut epic_tasks_resolved = 0u32;
        if let Ok(epics) = client
            .search_issues(
                &format!("project = \"{project}\" AND issuetype = Epic AND resolution = Unresolved"),
                200,
                "summary",
            )
            .await
        {
            if !epics.is_empty() {
                let keys: Vec<String> = epics
                    .iter()
                    .filter_map(|e| e["key"].as_str().map(String::from))
                    .collect();
                let in_clause = keys.join(", ");
                if let Ok(t) = client
                    .count_by_jql(&format!(
                        "project = \"{project}\" AND issuetype = Task AND \"Epic Link\" in ({in_clause}) {label_filter}"
                    ))
                    .await
                {
                    epic_tasks_total = t as u32;
                }
                if let Ok(r) = client
                    .count_by_jql(&format!(
                        "project = \"{project}\" AND issuetype = Task AND resolution != Unresolved AND \"Epic Link\" in ({in_clause}) {label_filter}"
                    ))
                    .await
                {
                    epic_tasks_resolved = r as u32;
                }
            }
        }

        Ok(BugMetrics {
            total_open,
            critical,
            high,
            medium,
            low,
            resolved_this_sprint: 0,
            found_this_sprint: 0,
            epic_total,
            epic_completed,
            epic_tasks_total,
            epic_tasks_resolved,
        })
    }

    pub async fn get_sprint_report(&self, config: &JiraConfig) -> Result<Option<SprintReport>> {
        let client = match self.client(config) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };
        let boards = self.get_boards(config).await?;
        if boards.is_empty() {
            return Ok(None);
        }
        let sprints = self.get_sprints(config, boards[0].id).await?;
        let active = match sprints.iter().find(|s| s.state == "active") {
            Some(s) => s,
            None => return Ok(None),
        };
        let path = format!("/sprint/{}/issue", active.id);
        let resp: Value = client
            .agile
            .get_json(&path, &[("maxResults", "200".into()), ("fields", "status".into())])
            .await?;
        let issues = resp["issues"].as_array().cloned().unwrap_or_default();
        let mut completed = 0u32;
        let mut todo = 0u32;
        let mut in_progress = 0u32;
        let mut done = 0u32;
        for issue in &issues {
            let name = issue["fields"]["status"]["name"]
                .as_str()
                .unwrap_or("")
                .to_lowercase();
            if matches!(name.as_str(), "done" | "closed" | "resolved") {
                done += 1;
                completed += 1;
            } else if matches!(
                name.as_str(),
                "in progress" | "in analyze" | "in review" | "in development"
            ) {
                in_progress += 1;
            } else {
                todo += 1;
            }
        }
        let total = issues.len() as u32;
        let completion_percent = if total > 0 {
            ((completed as f64 / total as f64) * 100.0).round()
        } else {
            0.0
        };
        Ok(Some(SprintReport {
            sprint_name: active.name.clone(),
            sprint_state: active.state.clone(),
            total_issues: total,
            completed_issues: completed,
            to_do_issues: todo,
            in_progress_issues: in_progress,
            done_issues: done,
            completion_percent,
        }))
    }

    // ── Project metadata ────────────────────────────────────────────────

    pub async fn get_projects(&self, config: &JiraConfig) -> Result<Vec<JiraProject>> {
        if let Some(cached) = self.read_cache() {
            return Ok(cached);
        }
        let client = self.client(config)?;
        let v: Value = client.api.get_json("/project", &[]).await?;
        let arr = v.as_array().cloned().unwrap_or_default();
        let projects: Vec<JiraProject> = arr
            .iter()
            .map(|p| JiraProject {
                key: p["key"].as_str().unwrap_or("").to_string(),
                name: p["name"].as_str().unwrap_or("").to_string(),
                id: p["id"].as_str().unwrap_or("").to_string(),
            })
            .collect();
        self.write_cache(&projects);
        Ok(projects)
    }

    pub async fn get_boards(&self, config: &JiraConfig) -> Result<Vec<JiraBoard>> {
        let client = self.client(config)?;
        let v: Value = client
            .agile
            .get_json("/board", &[("maxResults", "50".into())])
            .await?;
        let arr = v["values"].as_array().cloned().unwrap_or_default();
        Ok(arr
            .iter()
            .map(|b| JiraBoard {
                id: b["id"].as_u64().unwrap_or(0) as u32,
                name: b["name"].as_str().unwrap_or("").to_string(),
                r#type: b["type"].as_str().unwrap_or("").to_string(),
            })
            .collect())
    }

    pub async fn get_sprints(&self, config: &JiraConfig, board_id: u32) -> Result<Vec<JiraSprint>> {
        let client = self.client(config)?;
        let path = format!("/board/{board_id}/sprint");
        let v: Value = client
            .agile
            .get_json(&path, &[
                ("state", "active,future,closed".into()),
                ("maxResults", "200".into()),
            ])
            .await?;
        let arr = v["values"].as_array().cloned().unwrap_or_default();
        Ok(arr
            .iter()
            .map(|s| JiraSprint {
                id: s["id"].as_u64().unwrap_or(0) as u32,
                name: s["name"].as_str().unwrap_or("").to_string(),
                state: s["state"].as_str().unwrap_or("").to_string(),
            })
            .collect())
    }

    pub async fn get_statuses(&self, config: &JiraConfig) -> Result<Vec<JiraStatus>> {
        let client = self.client(config)?;
        let v: Value = client.api.get_json("/status", &[]).await?;
        let arr = v.as_array().cloned().unwrap_or_default();
        Ok(arr
            .iter()
            .map(|s| JiraStatus {
                id: s["id"].as_str().unwrap_or("").to_string(),
                name: s["name"].as_str().unwrap_or("").to_string(),
                category: s["category"]["name"].as_str().map(String::from),
            })
            .collect())
    }

    pub async fn get_issue_types(&self, config: &JiraConfig) -> Result<Vec<String>> {
        let client = self.client(config)?;
        match client.api.get_json("/issuetype", &[]).await {
            Ok(v) => Ok(v
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|t| t["name"].as_str().map(String::from))
                .collect()),
            Err(_) => Ok(vec![]),
        }
    }

    pub async fn get_users(&self, config: &JiraConfig, project_key: &str) -> Result<Vec<JiraUser>> {
        let client = self.client(config)?;
        let v: Value = client
            .api
            .get_json(
                "/user/assignable/search",
                &[
                    ("project", project_key.into()),
                    ("maxResults", "100".into()),
                ],
            )
            .await?;
        let arr = v.as_array().cloned().unwrap_or_default();
        Ok(arr
            .iter()
            .map(|u| JiraUser {
                account_id: u["accountId"].as_str().unwrap_or("").to_string(),
                display_name: u["displayName"].as_str().unwrap_or("").to_string(),
                email_address: u["emailAddress"].as_str().map(String::from),
            })
            .collect())
    }

    pub async fn get_labels(&self, config: &JiraConfig) -> Result<Vec<String>> {
        let client = self.client(config)?;
        match client
            .api
            .get_json("/label", &[("maxResults", "500".into())])
            .await
        {
            Ok(v) => Ok(v["values"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|l| l["label"].as_str().map(String::from))
                .collect()),
            Err(_) => Ok(vec![]),
        }
    }

    pub async fn get_custom_fields(
        &self,
        config: &JiraConfig,
    ) -> Result<Vec<crate::models::jira::JiraField>> {
        let client = self.client(config)?;
        match client.api.get_json("/field", &[]).await {
            Ok(v) => Ok(v
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|f| crate::models::jira::JiraField {
                    id: f["id"].as_str().unwrap_or("").to_string(),
                    name: f["name"].as_str().unwrap_or("").to_string(),
                    r#type: f["schema"]["type"].as_str().unwrap_or("unknown").to_string(),
                    is_custom: f["custom"].as_bool().unwrap_or(false),
                })
                .collect()),
            Err(_) => Ok(vec![]),
        }
    }

    // ── Issue creation ──────────────────────────────────────────────────

    pub async fn create_bug(
        &self,
        config: &JiraConfig,
        draft: &BugFormDraft,
        preview: &BugPreview,
    ) -> Result<CreatedIssue> {
        self.assert_configured(config)?;
        self.create_issue(
            config,
            &config.project_key,
            if config.bug_issue_type.is_empty() {
                "Bug"
            } else {
                &config.bug_issue_type
            },
            &preview.summary,
            &preview.description,
            Some(if preview.priority.is_empty() {
                "Medium"
            } else {
                &preview.priority
            }),
            Some(&preview.labels),
            Some(&draft.environment),
        )
        .await
    }

    pub async fn create_defect_issue(
        &self,
        config: &JiraConfig,
        draft: &DefectCreateDraft,
    ) -> Result<CreatedIssue> {
        self.assert_configured(config)?;
        let labels: Vec<String> = draft
            .labels
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        self.create_issue(
            config,
            &draft.project_key,
            if draft.issue_type.is_empty() {
                "Bug"
            } else {
                &draft.issue_type
            },
            &draft.summary,
            &draft.description,
            Some(if draft.priority.is_empty() {
                "Medium"
            } else {
                &draft.priority
            }),
            Some(&labels),
            Some(&draft.environment),
        )
        .await
    }

    pub async fn create_issue(
        &self,
        config: &JiraConfig,
        project_key: &str,
        issue_type: &str,
        summary: &str,
        description: &str,
        priority: Option<&str>,
        labels: Option<&Vec<String>>,
        environment: Option<&str>,
    ) -> Result<CreatedIssue> {
        self.assert_configured(config)?;
        let client = self.client(config)?;
        let mut fields = json!({
            "project": { "key": project_key },
            "summary": summary,
            "issuetype": { "name": issue_type },
            "description": description,
            "priority": { "name": priority.unwrap_or("Medium") },
        });
        if let Some(labels) = labels {
            fields["labels"] = json!(labels);
        }
        if let Some(env) = environment {
            if !env.is_empty() {
                fields["environment"] = json!(env);
            }
        }
        let body = json!({ "fields": fields });
        let resp: Value = client.api.post_json("/issue", &body).await?;
        let key = resp["key"].as_str().unwrap_or("").to_string();
        Ok(CreatedIssue {
            key: key.clone(),
            url: client.issue_url(&key),
        })
    }

    pub async fn create_test_cases(
        &self,
        config: &JiraConfig,
        cases: &[crate::models::test_case::ExtractedTestCase],
    ) -> Result<Vec<CreatedIssue>> {
        self.assert_configured(config)?;
        let client = self.client(config)?;
        let issue_type = if config.test_case_issue_type.is_empty() {
            "Task"
        } else {
            &config.test_case_issue_type
        };
        let mut created: Vec<CreatedIssue> = Vec::new();
        for item in cases {
            let category_slug = item.category.to_lowercase().replace(' ', "-");
            let evidence = item
                .source_evidence
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("\n\nSource evidence:\n{value}"))
                .unwrap_or_default();
            let body = json!({
                "fields": {
                    "project": { "key": config.project_key },
                    "summary": item.title,
                    "issuetype": { "name": issue_type },
                    "description": format!("Objective:\n{}\n\nCategory: {}{}", item.objective, item.category, evidence),
                    "priority": { "name": map_qa_priority_to_jira(&item.priority) },
                    "labels": ["qa-buddy", "test-case", category_slug],
                }
            });
            match client.api.post_json("/issue", &body).await {
                Ok(resp) => {
                    let key = resp["key"].as_str().unwrap_or("").to_string();
                    created.push(CreatedIssue {
                        key: key.clone(),
                        url: client.issue_url(&key),
                    });
                }
                Err(e) => {
                    for c in &created {
                        let _ = client
                            .api
                            .put_json_void(&format!("/issue/{}", c.key), &json!({}))
                            .await;
                    }
                    return Err(e);
                }
            }
        }
        Ok(created)
    }

    pub async fn create_manual_test_cases(
        &self,
        config: &JiraConfig,
        cases: &[ManualTestCase],
    ) -> Result<Vec<CreatedIssue>> {
        self.assert_configured(config)?;
        let client = self.client(config)?;
        let mut created: Vec<CreatedIssue> = Vec::new();
        let mut all_folders: Option<Vec<XrayFolder>> = None;

        for item in cases {
            let project_key = item
                .project_key
                .clone()
                .unwrap_or_else(|| config.project_key.clone());
            let full_description = format!(
                "{}\n\nh4. Steps to Reproduce\n{}\n\nh4. Expected Result\n{}",
                item.description, item.steps, item.expected_result
            );
            let custom_labels: Vec<String> = if item.labels.is_empty() {
                vec![]
            } else {
                item.labels
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            };
            let body = json!({
                "fields": {
                    "project": { "key": project_key },
                    "summary": item.title,
                    "issuetype": { "name": "Test" },
                    "description": full_description,
                    "labels": custom_labels,
                }
            });
            let resp: Value = client.api.post_json("/issue", &body).await?;
            let key = resp["key"].as_str().unwrap_or("").to_string();
            created.push(CreatedIssue {
                key: key.clone(),
                url: client.issue_url(&key),
            });

            if !item.steps.trim().is_empty() {
                let result_text = if item.expected_result.is_empty() {
                    String::new()
                } else {
                    format_bullets(&item.expected_result)
                };
                let step = json!({
                    "step": format_bullets(&item.steps),
                    "data": "",
                    "result": result_text,
                });
                let _ = client
                    .xray
                    .put_json_void(&format!("/test/{key}/step"), &step)
                    .await;
            }

            if !item.xray_folder.trim().is_empty() {
                if all_folders.is_none() {
                    all_folders =
                        Some(client.get_xray_folders(&project_key).await.unwrap_or_default());
                }
                if let Some(folders) = &all_folders {
                    let parts = JiraClient::split_folder_path(&item.xray_folder);
                    if let Some(folder_id) = JiraClient::find_folder_id(folders, &parts) {
                        let _ = client
                            .add_tests_to_folder(&project_key, folder_id, &[key])
                            .await;
                    }
                }
            }
        }
        Ok(created)
    }

    // ── Bulk operations ─────────────────────────────────────────────────

    pub async fn bulk_transition(
        &self,
        config: &JiraConfig,
        issue_keys: &[String],
        transition_id: &str,
    ) -> Result<BulkOperationResult> {
        let client = self.client(config)?;
        let mut success = 0u32;
        let mut failed = 0u32;
        let mut errors: Vec<String> = Vec::new();
        for key in issue_keys {
            let body = json!({ "transition": { "id": transition_id } });
            let path = format!("/issue/{key}/transitions");
            match client.api.post_json(&path, &body).await {
                Ok(_) => success += 1,
                Err(e) => {
                    failed += 1;
                    errors.push(e.to_string());
                }
            }
        }
        Ok(BulkOperationResult {
            success,
            failed,
            errors,
        })
    }

    pub async fn bulk_assign(
        &self,
        config: &JiraConfig,
        issue_keys: &[String],
        assignee_name: &str,
    ) -> Result<BulkOperationResult> {
        let client = self.client(config)?;
        let mut success = 0u32;
        let mut failed = 0u32;
        let mut errors: Vec<String> = Vec::new();
        for key in issue_keys {
            let body = json!({ "name": assignee_name });
            let path = format!("/issue/{key}/assignee");
            match client.api.put_json_void(&path, &body).await {
                Ok(_) => success += 1,
                Err(e) => {
                    failed += 1;
                    errors.push(e.to_string());
                }
            }
        }
        Ok(BulkOperationResult {
            success,
            failed,
            errors,
        })
    }

    pub async fn bulk_add_labels(
        &self,
        config: &JiraConfig,
        issue_keys: &[String],
        labels: &[String],
    ) -> Result<BulkOperationResult> {
        let client = self.client(config)?;
        let mut success = 0u32;
        let mut failed = 0u32;
        let mut errors: Vec<String> = Vec::new();
        for key in issue_keys {
            let path = format!("/issue/{key}");
            match client
                .api
                .get_json(&path, &[("fields", "labels".to_string())])
                .await
            {
                Ok(issue) => {
                    let existing: Vec<String> = issue["fields"]["labels"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                        .iter()
                        .filter_map(|l| l.as_str().map(String::from))
                        .collect();
                    let mut merged: Vec<String> = existing.clone();
                    for l in labels {
                        if !merged.contains(l) {
                            merged.push(l.clone());
                        }
                    }
                    let body = json!({ "fields": { "labels": merged } });
                    match client.api.put_json_void(&path, &body).await {
                        Ok(_) => success += 1,
                        Err(e) => {
                            failed += 1;
                            errors.push(e.to_string());
                        }
                    }
                }
                Err(e) => {
                    failed += 1;
                    errors.push(e.to_string());
                }
            }
        }
        Ok(BulkOperationResult {
            success,
            failed,
            errors,
        })
    }

    pub async fn bulk_move_to_xray_folder(
        &self,
        config: &JiraConfig,
        issue_keys: &[String],
        folder_path: &str,
    ) -> Result<BulkOperationResult> {
        let client = self.client(config)?;
        client
            .move_tests_to_folder(&config.project_key, folder_path, issue_keys)
            .await?;
        Ok(BulkOperationResult {
            success: issue_keys.len() as u32,
            failed: 0,
            errors: vec![],
        })
    }

    // ── Xray organisation ───────────────────────────────────────────────

    pub async fn get_xray_folders(
        &self,
        config: &JiraConfig,
        project_key: &str,
    ) -> Result<Vec<XrayFolder>> {
        // Check in-memory cache first (30-min TTL)
        {
            let cache = self.xray_folder_cache.lock().unwrap();
            if let Some((folders, fetched_at)) = cache.get(project_key) {
                if fetched_at.elapsed().as_secs() < XRAY_FOLDER_CACHE_SECS {
                    return Ok(folders.clone());
                }
            }
        }
        let client = self.client(config)?;
        let folders = client.get_xray_folders(project_key).await?;
        {
            let mut cache = self.xray_folder_cache.lock().unwrap();
            cache.insert(project_key.to_string(), (folders.clone(), Instant::now()));
        }
        Ok(folders)
    }

    pub async fn get_xray_folder_issues(
        &self,
        config: &JiraConfig,
        project_key: &str,
        folder_id: u32,
    ) -> Result<Vec<Value>> {
        self.assert_configured(config)?;
        let client = self.client(config)?;
        let path = format!("/testrepository/{project_key}/folders/{folder_id}/tests");
        let data = client.xray.get_json_or_none(&path, &[]).await;
        log::info!("[folder_issues] raw response: {:?}", data.as_ref().map(|d| d.to_string().chars().take(500).collect::<String>()));
        let mut keys: Vec<String> = Vec::new();
        if let Some(data) = data {
            // Try all known Xray Raven API response shapes
            let candidates: &[&str] = &["testIssues", "keys", "issues", "results", "tests"];
            if let Some(arr) = data.as_array() {
                keys = arr.iter().filter_map(|v| {
                    v.as_str().map(String::from).or_else(|| v["key"].as_str().map(String::from))
                }).collect();
            } else {
                for field in candidates {
                    if let Some(arr) = data[field].as_array() {
                        keys = arr.iter().filter_map(|v| {
                            v.as_str().map(String::from).or_else(|| v["key"].as_str().map(String::from))
                        }).collect();
                        if !keys.is_empty() {
                            break;
                        }
                    }
                }
            }
        }
        log::info!("[folder_issues] resolved {} keys for folder {}", keys.len(), folder_id);
        if !keys.is_empty() {
            return Ok(fetch_issue_summaries(&client, &keys).await);
        }
        // Return empty — do not fall back to full project issues
        Ok(vec![])
    }

    pub async fn add_tests_to_execution(
        &self,
        config: &JiraConfig,
        exec_key: &str,
        test_keys: &[String],
    ) -> Result<()> {
        self.assert_configured(config)?;
        let client = self.client(config)?;
        client.add_tests_to_execution(exec_key, test_keys).await
    }

    pub async fn organize_tests_into_xray(
        &self,
        config: &JiraConfig,
        source: &str,
        folder_path: &str,
        project_key: &str,
    ) -> Result<u32> {
        self.assert_configured(config)?;
        let client = self.client(config)?;
        let trimmed = source.trim();
        let upper = trimmed.to_uppercase();
        let issue_keys: Vec<String> = if upper.starts_with("PROJECT") || trimmed.contains('=') {
            let resp: Value = client
                .api
                .get_json(
                    "/search",
                    &[
                        ("jql", trimmed.to_string()),
                        ("fields", "key".into()),
                        ("maxResults", "1000".into()),
                    ],
                )
                .await?;
            resp["issues"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|i| i["key"].as_str().map(String::from))
                .collect()
        } else {
            source
                .split(|c: char| c == ',' || c.is_whitespace())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        };
        if issue_keys.is_empty() {
            return Ok(0);
        }
        let count = issue_keys.len() as u32;
        client
            .move_tests_to_folder(project_key, folder_path, &issue_keys)
            .await?;
        Ok(count)
    }

    // ── Confluence → Jira Test update ───────────────────────────────────

    pub async fn fetch_test_steps(
        &self,
        config: &JiraConfig,
        issue_key: &str,
    ) -> Result<Option<FetchTestStepsResult>> {
        let client = self.client(config)?;
        let raw = client.fetch_test_steps(issue_key).await;
        match raw {
            Some((steps, results)) => Ok(Some(FetchTestStepsResult {
                issue_key: issue_key.to_string(),
                steps: steps.join("\n"),
                expected_result: results.join("\n"),
            })),
            None => Ok(None),
        }
    }

    pub async fn check_test_steps(
        &self,
        config: &JiraConfig,
        entries: &[ConfluenceTestImportEntry],
    ) -> Result<StepConflictCheck> {
        let client = self.client(config)?;
        let mut has_steps: Vec<String> = Vec::new();
        let mut no_steps: Vec<String> = Vec::new();
        for entry in entries
            .iter()
            .filter(|e| e.selected && !e.issue_key.is_empty())
        {
            let path = format!("/test/{}/step", entry.issue_key);
            let has = match client.xray.get_json_or_none(&path, &[]).await {
                Some(v) => v.as_array().is_some_and(|a| !a.is_empty()) || !v.is_null(),
                None => false,
            };
            if has {
                has_steps.push(entry.issue_key.clone());
            } else {
                no_steps.push(entry.issue_key.clone());
            }
        }
        Ok(StepConflictCheck { has_steps, no_steps })
    }

    pub async fn update_test_cases_from_confluence(
        &self,
        config: &JiraConfig,
        entries: &[ConfluenceTestImportEntry],
        mode: StepConflictMode,
    ) -> Result<UpdateTestCasesFromConfluenceResult> {
        self.assert_configured(config)?;
        let client = self.client(config)?;
        let mut success: Vec<UpdateTestSuccessEntry> = Vec::new();
        let mut failed: Vec<UpdateTestFailedEntry> = Vec::new();
        let valid: Vec<&ConfluenceTestImportEntry> = entries
            .iter()
            .filter(|e| e.selected && !e.issue_key.is_empty())
            .collect();

        for entry in valid {
            let new_step_text = if entry.steps.is_empty() {
                String::new()
            } else {
                format_bullets(&entry.steps)
            };
            let new_result_text = if entry.expected_result.is_empty() {
                String::new()
            } else {
                format_bullets(&entry.expected_result)
            };
            let key = entry.issue_key.clone();

            let outcome: std::result::Result<&str, String> = async {
                let path = format!("/test/{key}/step");
                match mode {
                    StepConflictMode::Skip => {
                        let existing = client.xray.get_json_or_none(&path, &[]).await;
                        let has = existing
                            .as_ref()
                            .map(|v| v.as_array().is_some_and(|a| !a.is_empty()) || !v.is_null())
                            .unwrap_or(false);
                        if has {
                            return Ok("Skipped (already has steps)");
                        }
                    }
                    StepConflictMode::Append => {
                        let existing = client.xray.get_json_or_none(&path, &[]).await;
                        if let Some(arr) = existing.as_ref().and_then(|v| v.as_array()) {
                            if !arr.is_empty() {
                                let last = &arr[arr.len() - 1];
                                let existing_step = last["step"].as_str().unwrap_or("");
                                let existing_result = last["result"].as_str().unwrap_or("");
                                let combined_step = [existing_step, new_step_text.as_str()]
                                    .into_iter()
                                    .filter(|s: &&str| !s.is_empty())
                                    .map(|s| s.to_string())
                                    .collect::<Vec<_>>()
                                    .join("\n");
                                let combined_result = [existing_result, new_result_text.as_str()]
                                    .into_iter()
                                    .filter(|s: &&str| !s.is_empty())
                                    .map(|s| s.to_string())
                                    .collect::<Vec<_>>()
                                    .join("\n");
                                let body = json!({
                                    "step": combined_step,
                                    "data": last["data"].clone(),
                                    "result": combined_result,
                                });
                                client
                                    .xray
                                    .put_json_void(&path, &body)
                                    .await
                                    .map_err(|e| e.to_string())?;
                                return Ok("Updated successfully (appended)");
                            }
                        }
                    }
                    StepConflictMode::Replace => {
                        // Overwrite via the single-step PUT below.
                    }
                }
                let body =
                    json!({ "step": new_step_text, "data": "", "result": new_result_text });
                client
                    .xray
                    .put_json_void(&path, &body)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok("Updated successfully")
            }
            .await;

            match outcome {
                Ok(msg) => success.push(UpdateTestSuccessEntry {
                    key,
                    message: msg.to_string(),
                }),
                Err(e) => failed.push(UpdateTestFailedEntry { key, error: e }),
            }
        }
        Ok(UpdateTestCasesFromConfluenceResult { success, failed })
    }

    pub async fn find_test_cases_by_jql(
        &self,
        config: &JiraConfig,
        jql: &str,
        max_results: u32,
    ) -> Result<Vec<JiraIssueSummary>> {
        self.assert_configured(config)?;
        self.search_issues(config, jql, max_results).await
    }

    pub async fn resolve_issue_key(
        &self,
        config: &JiraConfig,
        issue_key: &str,
    ) -> Result<Option<String>> {
        let client = match self.client(config) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };
        let path = format!("/issue/{issue_key}");
        match client
            .api
            .get_json(&path, &[("fields", "key".to_string())])
            .await
        {
            Ok(v) => Ok(v["key"]
                .as_str()
                .map(String::from)
                .or(Some(issue_key.to_string()))),
            Err(_) => Ok(None),
        }
    }

    // ── UQA ─────────────────────────────────────────────────────────────

    pub async fn get_uqa_transitions(
        &self,
        config: &JiraConfig,
        issue_key: &str,
    ) -> Result<Vec<UqaTransition>> {
        let client = self.client(config)?;
        let transitions = client.get_transitions(issue_key).await?;
        Ok(transitions
            .iter()
            .map(|t| UqaTransition {
                id: t["id"].as_str().unwrap_or("").to_string(),
                name: t["name"].as_str().unwrap_or("").to_string(),
                to_status: t["to"]["name"]
                    .as_str()
                    .or_else(|| t["name"].as_str())
                    .unwrap_or("")
                    .to_string(),
            })
            .collect())
    }

    pub async fn append_uqa_entry(
        &self,
        config: &JiraConfig,
        issue_key: &str,
        date: &str,
        activity: &str,
    ) -> Result<()> {
        let client = self.client(config)?;
        let row = format!("|{date}|{activity}|");
        client.append_to_description(issue_key, &row).await
    }

    pub async fn append_uqa_entry_with_notes(
        &self,
        config: &JiraConfig,
        issue_key: &str,
        date: &str,
        activity: &str,
        notes: &str,
    ) -> Result<()> {
        let client = self.client(config)?;
        client
            .append_to_description_with_notes(issue_key, date, activity, notes)
            .await
    }

    pub async fn transition_uqa_issue(
        &self,
        config: &JiraConfig,
        issue_key: &str,
        transition_id: &str,
    ) -> Result<()> {
        let client = self.client(config)?;
        client.execute_transition(issue_key, transition_id).await
    }

    pub async fn get_uqa_issues(
        &self,
        config: &JiraConfig,
        field_id: &str,
        search_mode: &str,
        project_keys: &[String],
    ) -> Result<Vec<UqaIssue>> {
        self.assert_configured(config)?;
        let client = self.client(config)?;
        let num = regex::Regex::new(r"(?i)^customfield_")
            .unwrap()
            .replace(field_id, "")
            .to_string();
        let user_condition = match search_mode {
            "productTester" => format!("cf[{num}] = currentUser()"),
            "assignee" => "assignee = currentUser()".to_string(),
            _ => format!(
                "(cf[{num}] = currentUser() OR assignee = currentUser())"
            ),
        };
        let mut jql = format!("{user_condition} AND status NOT IN (SELESAI, DONE)");
        if !project_keys.is_empty() {
            let q: Vec<String> = project_keys.iter().map(|k| format!("\"{k}\"")).collect();
            jql.push_str(&format!(" AND project IN ({})", q.join(", ")));
        }
        jql.push_str(" ORDER BY updated DESC");

        let issues = client
            .search_issues(
                &jql,
                100,
                "summary,status,description,updated,updateAuthor,project,assignee",
            )
            .await?;

        let today = Utc::now().format("%Y-%m-%d").to_string();
        let mut results: Vec<UqaIssue> = Vec::new();
        for issue in &issues {
            let key = issue["key"].as_str().unwrap_or("").to_string();
            let detail = match client.get_issue_detail(&key).await {
                Ok(Some(d)) => d,
                _ => continue,
            };
            let description = &detail["description"];
            let text = if let Some(s) = description.as_str() {
                s.to_string()
            } else if description.get("type").and_then(|t| t.as_str()) == Some("doc") {
                adf_to_plain_text(description)
            } else {
                continue;
            };
            let entries = parse_uqa_table(&text);
            let needs_update = !entries.iter().any(|e| e.date == today);
            results.push(UqaIssue {
                project_key: issue["fields"]["project"]["key"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                project_name: issue["fields"]["project"]["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                issue_key: key,
                summary: issue["fields"]["summary"].as_str().unwrap_or("").to_string(),
                last_updated: entries.last().map(|e| e.date.clone()),
                needs_update,
                status: detail["status"].as_str().unwrap_or("").to_string(),
                status_category: detail["statusCategory"].as_str().unwrap_or("").to_string(),
                available_transitions: vec![],
                last_update_author: detail["updateAuthor"].as_str().unwrap_or("").to_string(),
                last_update_date: detail["updated"].as_str().unwrap_or("").to_string(),
                entries,
            });
        }
        Ok(results)
    }

    pub async fn auto_generate_uqa_notes(
        &self,
        config: &JiraConfig,
        issue_key: &str,
    ) -> Result<AutoUqaGeneratedPayload> {
        self.assert_configured(config)?;
        let client = self.client(config)?;
        let date = Utc::now().format("%Y-%m-%d").to_string();
        let links = client.get_issue_links(issue_key).await?;
        let mut phases: Vec<PhaseTestSummary> = Vec::new();
        if links.is_empty() {
            return Ok(AutoUqaGeneratedPayload {
                date,
                activity: vec![],
                phases,
                generated_notes: String::new(),
                no_links_found: Some(true),
            });
        }
        for link in &links {
            let summary = link["summary"].as_str().unwrap_or("");
            let phase = detect_phase_from_name(summary);
            let link_key = link["issueKey"].as_str().unwrap_or("");
            let test_runs = client
                .get_xray_test_execution_tests(link_key)
                .await
                .unwrap_or_default();
            if test_runs.is_empty() {
                continue;
            }
            let todo = test_runs.iter().filter(|t| t.status == "TODO").count() as u32;
            let in_progress = test_runs.iter().filter(|t| t.status == "EXECUTING").count() as u32;
            let done = test_runs.iter().filter(|t| t.status == "PASS").count() as u32;
            let failed = test_runs.iter().filter(|t| t.status == "FAIL").count() as u32;
            let aborted = test_runs.iter().filter(|t| t.status == "ABORTED").count() as u32;
            let failed_details: Vec<PhaseFailedDetail> = test_runs
                .iter()
                .filter(|t| t.status == "FAIL" || t.status == "ABORTED")
                .map(|t| PhaseFailedDetail {
                    test_key: t.key.clone(),
                    defects: t
                        .defects
                        .clone()
                        .unwrap_or_default()
                        .iter()
                        .map(|d| format!("{}: {}", d.key, d.summary))
                        .collect(),
                })
                .collect();
            phases.push(PhaseTestSummary {
                phase,
                test_exec_key: link_key.to_string(),
                test_exec_name: summary.to_string(),
                todo,
                in_progress,
                done,
                failed,
                aborted,
                failed_details,
            });
        }
        let mut activity: Vec<String> = phases
            .iter()
            .filter(|p| p.phase != "UNKNOWN")
            .map(|p| p.phase.clone())
            .collect();
        activity.sort_by(|a, b| phase_rank(a).cmp(&phase_rank(b)));
        activity.dedup();
        let generated_notes = format_uqa_notes(&phases);
        Ok(AutoUqaGeneratedPayload {
            date,
            activity,
            phases,
            generated_notes,
            no_links_found: None,
        })
    }

    /// Inject execution history table into a Jira issue description.
    /// Builds a wiki-markup table from `snapshots` and replaces the section
    /// between `h2. Execution Monitoring` markers (or appends if not found).
    pub async fn inject_execution_report(
        &self,
        jira_config: &JiraConfig,
        target_issue_key: &str,
        exec_key: &str,
        snapshots: &[crate::models::jira::XrayExecutionSnapshot],
    ) -> Result<()> {
        let client = self.client(jira_config)?;

        // Build wiki-markup table: Date | Activity | Notes (newest first)
        // No section header — user manages the surrounding description manually.
        let mut table = String::from("||Date||Activity||Notes||\n");
        for snap in snapshots.iter().rev() {
            let date_label = {
                let parts: Vec<&str> = snap.date.splitn(3, '-').collect();
                if parts.len() == 3 {
                    let month = match parts[1] {
                        "01" => "Jan", "02" => "Feb", "03" => "Mar", "04" => "Apr",
                        "05" => "Mei", "06" => "Jun", "07" => "Jul", "08" => "Agu",
                        "09" => "Sep", "10" => "Okt", "11" => "Nov", "12" => "Des",
                        m => m,
                    };
                    format!("{} {} {}", parts[2], month, parts[0])
                } else {
                    snap.date.clone()
                }
            };
            // Notes: ringkasan status; Blocked hanya muncul jika > 0
            let mut notes = format!(
                "Done {}, In Progress {}, To Do {}, Fail {}, Aborted 0",
                snap.passed, snap.in_progress, snap.unexecuted, snap.failed
            );
            if snap.blocked > 0 {
                notes.push_str(&format!(", Blocked {}", snap.blocked));
            }
            // Activity column left empty — user fills it in manually
            table.push_str(&format!("|{}| |{}|\n", date_label, notes));
        }

        // Wrap the table in hidden anchor markers so re-injecting replaces instead of appends.
        // The markers render as invisible anchors in Jira wiki markup.
        let marker_open  = format!("{{anchor:qab-exec-start-{exec_key}}}");
        let marker_close = format!("{{anchor:qab-exec-end-{exec_key}}}");
        let block = format!("{marker_open}\n{table}{marker_close}");

        // Fetch existing description and splice or append
        let issue = client.get_issue_detail(target_issue_key).await?;
        let existing_desc = issue
            .as_ref()
            .and_then(|v| {
                if v["description"].is_object() {
                    Some(adf_to_plain_text(&v["description"]))
                } else {
                    v["description"].as_str().map(|s| s.to_string())
                }
            })
            .unwrap_or_default();

        let new_desc = if let (Some(s), Some(e)) = (
            existing_desc.find(&marker_open),
            existing_desc.find(&marker_close),
        ) {
            // Replace everything between (and including) the two markers
            let end_idx = e + marker_close.len();
            format!("{}{}{}", &existing_desc[..s], block, &existing_desc[end_idx..])
        } else {
            // First time — append at the end
            if existing_desc.trim().is_empty() {
                block
            } else {
                format!("{}\n\n{}", existing_desc.trim_end(), block)
            }
        };

        client.replace_description(target_issue_key, &new_desc).await
    }

    /// Snapshot history file path for a given execution key.
    fn execution_history_path(app_handle: &AppHandle, exec_key: &str) -> PathBuf {
        let safe_key = exec_key.replace('/', "_").replace('\\', "_");
        app_handle
            .path()
            .app_data_dir()
            .unwrap_or_default()
            .join("exec-history")
            .join(format!("{safe_key}.json"))
    }

    /// Load all saved snapshots for a given execution key.
    pub fn load_execution_history(
        app_handle: &AppHandle,
        exec_key: &str,
    ) -> Result<Vec<crate::models::jira::XrayExecutionSnapshot>> {
        let path = Self::execution_history_path(app_handle, exec_key);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = std::fs::read_to_string(&path).map_err(|e| ServiceError::Api(e.to_string()))?;
        let snaps: Vec<crate::models::jira::XrayExecutionSnapshot> =
            serde_json::from_str(&raw).unwrap_or_default();
        Ok(snaps)
    }

    /// Append today's snapshot, keeping only one entry per date (latest wins).
    fn save_snapshot(
        app_handle: &AppHandle,
        exec_key: &str,
        snap: &crate::models::jira::XrayExecutionSnapshot,
    ) {
        let path = Self::execution_history_path(app_handle, exec_key);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut history: Vec<crate::models::jira::XrayExecutionSnapshot> =
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
        // Replace entry for today if it exists, otherwise append
        if let Some(pos) = history.iter().position(|h| h.date == snap.date) {
            history[pos] = snap.clone();
        } else {
            history.push(snap.clone());
        }
        // Keep chronological order
        history.sort_by(|a, b| a.date.cmp(&b.date));
        if let Ok(json) = serde_json::to_string_pretty(&history) {
            let _ = std::fs::write(&path, json);
        }
    }

    /// Fetch current state of a Jira Xray Test Execution, save a daily snapshot, return details + history.
    pub async fn get_xray_execution_details(
        &self,
        jira_config: &JiraConfig,
        app_handle: &AppHandle,
        exec_key: &str,
    ) -> Result<crate::models::jira::XrayExecutionDetails> {
        let client = self.client(jira_config)?;
        // Fetch issue metadata
        let issue = client.get_issue_detail(exec_key).await?;

        // Validate issue type — must be "Test Execution"
        let issue_type = issue
            .as_ref()
            .and_then(|v| v["issueType"].as_str())
            .unwrap_or("")
            .to_string();
        if issue.is_none() {
            return Err(ServiceError::NotFound(format!(
                "Issue '{exec_key}' tidak ditemukan. Pastikan key yang dimasukkan benar."
            )));
        }
        if !issue_type.eq_ignore_ascii_case("Test Execution") {
            return Err(ServiceError::Api(format!(
                "Issue '{exec_key}' bukan bertipe Test Execution (tipe saat ini: \"{issue_type}\"). \
                 Masukkan key dari issue bertipe Test Execution."
            )));
        }

        let summary = issue
            .as_ref()
            .and_then(|v| v["summary"].as_str())
            .unwrap_or(exec_key)
            .to_string();
        let status = issue
            .as_ref()
            .and_then(|v| v["status"].as_str())
            .unwrap_or("")
            .to_string();
        let status_category = issue
            .as_ref()
            .and_then(|v| v["statusCategory"].as_str())
            .unwrap_or("")
            .to_string();
        let updated = issue
            .as_ref()
            .and_then(|v| v["updated"].as_str())
            .unwrap_or("")
            .to_string();
        // Fetch all test runs and aggregate counts
        let runs = client.get_xray_test_execution_tests(exec_key).await?;
        let total = runs.len() as u32;
        let passed = runs.iter().filter(|r| matches!(r.status.to_uppercase().as_str(), "PASS" | "PASSED")).count() as u32;
        let failed = runs.iter().filter(|r| matches!(r.status.to_uppercase().as_str(), "FAIL" | "FAILED" | "ABORTED")).count() as u32;
        let blocked = runs.iter().filter(|r| matches!(r.status.to_uppercase().as_str(), "BLOCKED")).count() as u32;
        let in_progress = runs.iter().filter(|r| matches!(r.status.to_uppercase().as_str(), "EXECUTING" | "IN_PROGRESS" | "IN PROGRESS")).count() as u32;
        let unexecuted = total.saturating_sub(passed + failed + blocked + in_progress);
        let pass_rate = if total > 0 { (passed as f64 / total as f64) * 100.0 } else { 0.0 };
        // Save today's snapshot
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let snap = crate::models::jira::XrayExecutionSnapshot {
            date: today,
            total,
            passed,
            failed,
            blocked,
            unexecuted,
            in_progress,
        };
        Self::save_snapshot(app_handle, exec_key, &snap);
        // Load full history to return alongside current state
        let history = Self::load_execution_history(app_handle, exec_key).unwrap_or_default();
        Ok(crate::models::jira::XrayExecutionDetails {
            key: exec_key.to_string(),
            summary,
            status,
            status_category,
            updated,
            total,
            passed,
            failed,
            blocked,
            unexecuted,
            in_progress,
            pass_rate,
            history,
        })
    }
}

// ── free helpers ────────────────────────────────────────────────────────

fn map_qa_priority_to_jira(priority: &str) -> &str {
    match priority.trim().to_uppercase().as_str() {
        "P1" => "High",
        "P2" => "Medium",
        "P3" => "Low",
        _ => {
            if priority.is_empty() {
                "Medium"
            } else {
                priority
            }
        }
    }
}

fn format_bullets(text: &str) -> String {
    text.lines()
        .map(|line| format!("- {}", line.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}

async fn fetch_issue_summaries(client: &JiraClient, keys: &[String]) -> Vec<Value> {
    if keys.is_empty() {
        return vec![];
    }
    let q: Vec<String> = keys.iter().map(|k| format!("\"{k}\"")).collect();
    let jql = format!("key in ({})", q.join(","));
    match client.search_issues(&jql, keys.len() as u32, "summary").await {
        Ok(issues) => issues
            .iter()
            .map(|i| json!({ "key": i["key"], "summary": i["fields"]["summary"] }))
            .collect(),
        Err(_) => vec![],
    }
}

fn detect_phase_from_name(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("system integration") || lower.contains("sit") {
        "SIT".into()
    } else if lower.contains("user acceptance") || lower.contains("uat") {
        "UAT".into()
    } else if lower.contains("deployment") || lower.contains("dt") {
        "DT".into()
    } else {
        "UNKNOWN".into()
    }
}

fn phase_rank(phase: &str) -> u8 {
    match phase {
        "SIT" => 0,
        "UAT" => 1,
        "DT" => 2,
        _ => 99,
    }
}

fn format_uqa_notes(phases: &[PhaseTestSummary]) -> String {
    let mut sorted: Vec<&PhaseTestSummary> = phases.iter().collect();
    sorted.sort_by(|a, b| phase_rank(&a.phase).cmp(&phase_rank(&b.phase)));
    let mut parts: Vec<String> = Vec::new();
    for p in sorted {
        let mut lines: Vec<String> = vec![format!("*{}*", p.phase)];
        let mut status_parts: Vec<String> = Vec::new();
        if p.todo > 0 {
            status_parts.push(format!("To Do {} TC", p.todo));
        }
        if p.in_progress > 0 {
            status_parts.push(format!("In Progress {} TC", p.in_progress));
        }
        if p.done > 0 {
            status_parts.push(format!("Done {} TC", p.done));
        }
        if p.failed > 0 {
            status_parts.push(format!("Failed {} TC", p.failed));
        }
        if p.aborted > 0 {
            status_parts.push(format!("Aborted {} TC", p.aborted));
        }
        lines.push(format!("{}: {}", p.test_exec_key, status_parts.join(", ")));
        for fd in &p.failed_details {
            for defect in &fd.defects {
                lines.push(format!("  Failed - {}: {}", fd.test_key, defect));
            }
        }
        parts.push(lines.join("\n"));
    }
    parts.join("\n\n")
}

fn parse_uqa_table(text: &str) -> Vec<UqaEntry> {
    let html_re =
        regex::Regex::new(r#"(?s)<table\s+class="confluenceTable">(.*?)</table>"#).unwrap();
    if let Some(c) = html_re.captures(text) {
        return parse_html_uqa_table(&c[1]);
    }
    parse_wiki_uqa_table(text)
}

fn parse_html_uqa_table(table_html: &str) -> Vec<UqaEntry> {
    let mut entries = Vec::new();
    let row_re = regex::Regex::new(r"(?s)<tr>(.*?)</tr>").unwrap();
    let cell_re = regex::Regex::new(r"(?s)<td[^>]*>(.*?)</td>").unwrap();
    let strip_re = regex::Regex::new(r"<[^>]+>").unwrap();
    for cap in row_re.captures_iter(table_html) {
        let row = cap[1].trim();
        if row.is_empty() {
            continue;
        }
        if regex::Regex::new(r"(?i)<th[\s>]").unwrap().is_match(row) {
            continue;
        }
        let cells: Vec<String> = cell_re
            .captures_iter(row)
            .map(|c| c[1].trim().to_string())
            .collect();
        if cells.len() < 2 {
            continue;
        }
        let date_text = strip_re.replace_all(&cells[0], "").trim().to_string();
        let date_re = regex::Regex::new(r"^(\d{4})-?(\d{2})-?(\d{2})$").unwrap();
        let date = match date_re.captures(&date_text) {
            Some(c) => format!("{}-{}-{}", &c[1], &c[2], &c[3]),
            None => continue,
        };
        let activity = cells[1].clone();
        let notes = if cells.len() > 2 { Some(cells[2].clone()) } else { None };
        entries.push(UqaEntry {
            date,
            activity,
            notes,
        });
    }
    entries
}

fn normalize_uqa_date(s: &str) -> Option<String> {
    let d = s.replace('-', "");
    if d.len() != 8 {
        return None;
    }
    let (y, m, day) = (&d[0..4], &d[4..6], &d[6..8]);
    let mn: u32 = m.parse().unwrap_or(0);
    let dn: u32 = day.parse().unwrap_or(0);
    if (1..=12).contains(&mn) && (1..=31).contains(&dn) {
        return Some(format!("{y}-{m}-{day}"));
    }
    let (day2, m2, y2) = (&d[0..2], &d[2..4], &d[4..8]);
    let dn2: u32 = day2.parse().unwrap_or(0);
    let mn2: u32 = m2.parse().unwrap_or(0);
    if (1..=12).contains(&mn2) && (1..=31).contains(&dn2) {
        return Some(format!("{y2}-{m2}-{day2}"));
    }
    None
}

fn parse_wiki_uqa_table(text: &str) -> Vec<UqaEntry> {
    let mut entries = Vec::new();
    let text = text.replace('\r', "");
    let lines: Vec<&str> = text.split('\n').collect();
    let mut joined: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in lines {
        let trimmed = line.trim_start();
        if trimmed.starts_with('|') {
            if !current.is_empty() {
                joined.push(current.clone());
            }
            current = line.to_string();
        } else if !current.is_empty() {
            current.push('\n');
            current.push_str(line);
        }
    }
    if !current.is_empty() {
        joined.push(current);
    }

    let trail_re = regex::Regex::new(r"[\s\xa0]+$").unwrap();
    let m3_re =
        regex::Regex::new(r"(?s)^\|(\d{4}-?\d{2}-?\d{2})\|(.+?)\|(.*)\|$").unwrap();
    let m2_re = regex::Regex::new(r"(?s)^\|(\d{4}-?\d{2}-?\d{2})\|(.+)\|$").unwrap();
    for row in &joined {
        let cleaned = trail_re.replace_all(row, "");
        if let Some(c) = m3_re.captures(&cleaned) {
            if let Some(date) = normalize_uqa_date(&c[1]) {
                let notes = c[3].trim();
                entries.push(UqaEntry {
                    date,
                    activity: c[2].trim().to_string(),
                    notes: if notes.is_empty() {
                        None
                    } else {
                        Some(notes.to_string())
                    },
                });
                continue;
            }
        }
        if let Some(c) = m2_re.captures(&cleaned) {
            if let Some(date) = normalize_uqa_date(&c[1]) {
                entries.push(UqaEntry {
                    date,
                    activity: c[2].trim().to_string(),
                    notes: None,
                });
            }
        }
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_uqa_date_yyyymmdd() {
        assert_eq!(normalize_uqa_date("2026-06-18").as_deref(), Some("2026-06-18"));
        assert_eq!(normalize_uqa_date("20260618").as_deref(), Some("2026-06-18"));
    }

    #[test]
    fn parse_wiki_uqa_table_two_and_three_col() {
        let text = "||Date||Activity||Notes||\n|2026-06-18|Ran tests|all good|\n|2026-06-17|Found bug|";
        let entries = parse_wiki_uqa_table(text);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].notes.as_deref(), Some("all good"));
    }

    #[test]
    fn detect_phase() {
        assert_eq!(detect_phase_from_name("SIT Round 1"), "SIT");
        assert_eq!(detect_phase_from_name("UAT phase"), "UAT");
        assert_eq!(detect_phase_from_name("Deployment Test (DT)"), "DT");
        assert_eq!(detect_phase_from_name("Random"), "UNKNOWN");
    }
}
