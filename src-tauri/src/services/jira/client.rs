//! Jira low-level client. Ports `jira-client.ts`: REST v2 (`/rest/api/2`),
//! Agile (`/rest/agile/1.0`) and Xray (`/rest/raven/1.0/api`) access plus the
//! ADF/wiki conversion helpers.

use serde_json::Value;

use crate::models::app_config::JiraConfig;
use crate::models::jira::{XrayFolder, XrayTestRun};
use crate::services::error::{Result, ServiceError};
use crate::services::http::{jira_agile_client, jira_api_client, jira_xray_client, AtlassianClient};
use crate::services::text_utils::adf_to_plain_text;
use crate::services::http::normalize_url;

/// Low-level Jira client bundling the three API surfaces.
pub struct JiraClient {
    pub config: JiraConfig,
    pub api: AtlassianClient,
    pub agile: AtlassianClient,
    pub xray: AtlassianClient,
}

impl JiraClient {
    pub fn new(config: &JiraConfig) -> Result<Self> {
        Ok(Self {
            config: config.clone(),
            api: jira_api_client(config)?,
            agile: jira_agile_client(config)?,
            xray: jira_xray_client(config)?,
        })
    }

    /// Build the browser URL for an issue key.
    pub fn issue_url(&self, key: &str) -> String {
        format!("{}/browse/{}", normalize_url(&self.config.base_url), key)
    }

    /// Count issues matching a JQL (maxResults=0).
    pub async fn count_by_jql(&self, jql: &str) -> Result<u64> {
        let v: Value = self
            .api
            .get_json("/search", &[
                ("jql", jql.to_string()),
                ("maxResults", "0".to_string()),
                ("fields", "id".to_string()),
            ])
            .await?;
        Ok(v.get("total").and_then(|t| t.as_u64()).unwrap_or(0))
    }

    /// Search issues returning a raw JSON array of issue objects.
    pub async fn search_issues(&self, jql: &str, max_results: u32, fields: &str) -> Result<Vec<Value>> {
        let v: Value = self
            .api
            .get_json("/search", &[
                ("jql", jql.to_string()),
                ("maxResults", max_results.to_string()),
                ("fields", fields.to_string()),
            ])
            .await?;
        Ok(v.get("issues")
            .and_then(|i| i.as_array())
            .cloned()
            .unwrap_or_default())
    }

    // ── Xray folders ────────────────────────────────────────────────────

    /// Fetch all Xray test-repository folders for a project as a nested tree.
    pub async fn get_xray_folders(&self, project_key: &str) -> Result<Vec<XrayFolder>> {
        let path = format!("/testrepository/{project_key}/folders");
        let data = self.xray.get_json(&path, &[]).await?;
        let raw = extract_folder_array(&data);
        let mut folders = map_folders(&raw);

        // If flat list with parent ids, build a tree.
        let flat = raw.iter().any(|f| f.get("parentId").and_then(|v| v.as_u64()).is_some());
        let no_nested = raw
            .iter()
            .all(|f| !(f.get("children").is_some_and(|c| c.is_array()) || f.get("folders").is_some_and(|c| c.is_array())));
        if flat && no_nested {
            folders = build_folder_tree(folders);
        }
        Ok(folders)
    }

    /// Walk a folder tree by path segments, returning the matching folder id.
    pub fn find_folder_id(folders: &[XrayFolder], path_parts: &[String]) -> Option<u32> {
        let mut current: Vec<XrayFolder> = folders.to_vec();
        let mut found: Option<u32> = None;
        for part in path_parts {
            let needle = part.trim().to_lowercase();
            let next = current
                .iter()
                .find(|f| f.name.trim().to_lowercase() == needle)?;
            found = Some(next.id);
            current = next.children.clone().unwrap_or_default();
        }
        found
    }

    /// Split "/path/to/folder" into trimmed non-empty parts.
    pub fn split_folder_path(folder_path: &str) -> Vec<String> {
        folder_path
            .split('/')
            .filter(|p| !p.trim().is_empty())
            .map(|p| p.to_string())
            .collect()
    }

    /// Fetch test steps + results for an issue. Returns `None` if none/absent.
    pub async fn fetch_test_steps(&self, issue_key: &str) -> Option<(Vec<String>, Vec<String>)> {
        let path = format!("/test/{issue_key}/step");
        let data = self.xray.get_json_or_none(&path, &[]).await?;
        let arr = data.as_array().filter(|a| !a.is_empty())?;
        let extract_raw = |v: &Value| -> String {
            if let Some(s) = v.as_str() {
                return s.to_string();
            }
            v.get("raw").and_then(|r| r.as_str()).unwrap_or("").to_string()
        };
        let steps: Vec<String> = arr
            .iter()
            .map(|s| extract_raw(&s["step"]).trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let results: Vec<String> = arr
            .iter()
            .map(|s| extract_raw(&s["result"]).trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if steps.is_empty() && results.is_empty() {
            None
        } else {
            Some((steps, results))
        }
    }

    /// Add tests to an Xray folder, trying several payload shapes for compat.
    pub async fn add_tests_to_folder(&self, project_key: &str, folder_id: u32, issue_keys: &[String]) -> Result<()> {
        let payloads = [
            serde_json::json!({ "testIssueKeys": issue_keys }),
            serde_json::json!({ "keys": issue_keys }),
            serde_json::json!({ "add": issue_keys }),
        ];
        let path = format!("/testrepository/{project_key}/folders/{folder_id}/tests");
        let mut last_err: Option<ServiceError> = None;
        for payload in &payloads {
            match self.xray.put_json_void(&path, payload).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    let msg = e.to_string();
                    last_err = Some(e);
                    // Stop on auth errors or non-deserialization 500s.
                    if msg.contains("HTTP 401") || msg.contains("HTTP 403") {
                        break;
                    }
                    if !msg.contains("CollectionBean") {
                        break;
                    }
                }
            }
        }
        Err(last_err.unwrap_or_else(|| ServiceError::Api("add_tests_to_folder failed".into())))
    }

    /// Move tests into an Xray folder located by path.
    pub async fn move_tests_to_folder(&self, project_key: &str, folder_path: &str, issue_keys: &[String]) -> Result<()> {
        let all = self.get_xray_folders(project_key).await?;
        let parts = Self::split_folder_path(folder_path);
        let folder_id = Self::find_folder_id(&all, &parts)
            .ok_or_else(|| ServiceError::NotFound(format!("Folder tidak ditemukan: {folder_path}")))?;
        self.add_tests_to_folder(project_key, folder_id, issue_keys).await
    }

    // ── UQA / issue detail ──────────────────────────────────────────────

    pub async fn get_current_user(&self) -> Result<Value> {
        self.api.get_json("/myself", &[]).await
    }

    /// Find a custom field by its exact name.
    pub async fn get_custom_field_by_name(&self, name: &str) -> Result<Option<Value>> {
        let fields: Value = self.api.get_json("/field", &[]).await?;
        let arr = fields.as_array();
        if let Some(arr) = arr {
            for f in arr {
                if f.get("name").and_then(|n| n.as_str()) == Some(name) {
                    return Ok(Some(normalize_field(f)));
                }
            }
        }
        Ok(None)
    }

    pub async fn get_issue_detail(&self, issue_key: &str) -> Result<Option<Value>> {
        let path = format!("/issue/{issue_key}");
        match self
            .api
            .get_json(&path, &[("fields", "summary,description,status,updated,updateAuthor,issuetype".to_string())])
            .await
        {
            Ok(d) => {
                let mut out = serde_json::Map::new();
                out.insert("key".into(), d["key"].clone());
                out.insert("summary".into(), d["fields"]["summary"].clone());
                out.insert("description".into(), d["fields"]["description"].clone());
                out.insert(
                    "status".into(),
                    d["fields"]["status"]["name"].clone(),
                );
                out.insert(
                    "statusCategory".into(),
                    d["fields"]["status"]["statusCategory"]["name"].clone(),
                );
                out.insert("updated".into(), d["fields"]["updated"].clone());
                out.insert("issueType".into(), d["fields"]["issuetype"]["name"].clone());
                out.insert(
                    "updateAuthor".into(),
                    d["fields"]["updateAuthor"]["accountId"].clone(),
                );
                out.insert(
                    "updateAuthorDisplay".into(),
                    d["fields"]["updateAuthor"]["displayName"].clone(),
                );
                Ok(Some(Value::Object(out)))
            }
            Err(_) => Ok(None),
        }
    }

    pub async fn get_transitions(&self, issue_key: &str) -> Result<Vec<Value>> {
        let path = format!("/issue/{issue_key}/transitions");
        let v: Value = self.api.get_json(&path, &[]).await?;
        Ok(v.get("transitions")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default())
    }

    pub async fn execute_transition(&self, issue_key: &str, transition_id: &str) -> Result<()> {
        let path = format!("/issue/{issue_key}/transitions");
        let body = serde_json::json!({ "transition": { "id": transition_id } });
        self.api.put_json_void(&path, &body).await
    }

    /// Fully replace an issue's description with the given wiki-markup string.
    pub async fn replace_description(&self, issue_key: &str, new_description: &str) -> Result<()> {
        let body = serde_json::json!({ "fields": { "description": new_description } });
        let path = format!("/issue/{issue_key}");
        self.api.put_json_void(&path, &body).await
    }

    /// Append a wiki-format row to an issue's description.
    pub async fn append_to_description(&self, issue_key: &str, row: &str) -> Result<()> {
        let detail = self
            .get_issue_detail(issue_key)
            .await?
            .ok_or_else(|| ServiceError::NotFound(format!("Issue {issue_key} not found")))?;
        let existing = &detail["description"];
        let new_description = if let Some(s) = existing.as_str() {
            format!("{}\n{}", s.trim_end(), row)
        } else if existing.is_object() {
            let plain = adf_to_plain_text(existing);
            format!("{}\n{}", plain.trim_end(), row)
        } else {
            format!("||Date||Activity||\n{row}")
        };
        let body = serde_json::json!({ "fields": { "description": new_description } });
        let path = format!("/issue/{issue_key}");
        self.api.put_json_void(&path, &body).await
    }

    /// Append a 3-column (Date/Activity/Notes) wiki row.
    pub async fn append_to_description_with_notes(
        &self,
        issue_key: &str,
        date: &str,
        activity: &str,
        notes: &str,
    ) -> Result<()> {
        let row = format!("|{date}|{activity}|{notes}|");
        let detail = self
            .get_issue_detail(issue_key)
            .await?
            .ok_or_else(|| ServiceError::NotFound(format!("Issue {issue_key} not found")))?;
        let existing = &detail["description"];
        let new_description = if let Some(s) = existing.as_str() {
            format!("{}\n{}", s.trim_end(), row)
        } else if existing.is_object() {
            let plain = adf_to_plain_text(existing);
            format!("{}\n{}", plain.trim_end(), row)
        } else {
            format!("||Date||Activity||Notes||\n{row}")
        };
        let body = serde_json::json!({ "fields": { "description": new_description } });
        let path = format!("/issue/{issue_key}");
        self.api.put_json_void(&path, &body).await
    }

    /// Fetch issue links, filtering for Test Execution type.
    pub async fn get_issue_links(&self, issue_key: &str) -> Result<Vec<Value>> {
        let path = format!("/issue/{issue_key}");
        let v: Value = self.api.get_json(&path, &[("fields", "issuelinks".to_string())]).await?;
        let mut out = Vec::new();
        let links = v["fields"]["issuelinks"].as_array().cloned().unwrap_or_default();
        for link in links {
            for dir in ["inwardIssue", "outwardIssue"] {
                if link[dir]["fields"]["issuetype"]["name"].as_str() == Some("Test Execution") {
                    out.push(serde_json::json!({
                        "issueKey": link[dir]["key"],
                        "issueTypeName": link[dir]["fields"]["issuetype"]["name"],
                        "summary": link[dir]["fields"]["summary"].clone(),
                    }));
                }
            }
        }
        Ok(out)
    }

    /// Get all test runs within a Test Execution via Xray (?detailed=true).
    pub async fn add_tests_to_execution(&self, exec_key: &str, test_keys: &[String]) -> Result<()> {
        // Xray Raven API v1: POST /testexec/{key}/test
        let path = format!("/testexec/{exec_key}/test");
        let payload = serde_json::json!({ "add": test_keys });
        self.xray.post_json(&path, &payload).await.map(|_| ())
    }

    pub async fn get_xray_test_execution_tests(&self, test_exec_key: &str) -> Result<Vec<XrayTestRun>> {
        let path = format!("/testexec/{test_exec_key}/test?detailed=true");
        let data = self.xray.get_json_or_none(&path, &[]).await.unwrap_or(Value::Null);
        let arr = data.as_array().cloned().unwrap_or_default();
        let runs = arr
            .iter()
            .map(|t| XrayTestRun {
                id: t["id"].as_u64().unwrap_or(0) as u32,
                key: t["key"].as_str().unwrap_or("").to_string(),
                status: t["status"].as_str().unwrap_or("").to_string(),
                defects: t
                    .get("defects")
                    .and_then(|d| d.as_array())
                    .map(|d| {
                        d.iter()
                            .map(|x| crate::models::jira::XrayTestDefect {
                                key: x["key"].as_str().unwrap_or("").to_string(),
                                summary: x["summary"].as_str().unwrap_or("").to_string(),
                            })
                            .collect()
                    }),
            })
            .collect();
        Ok(runs)
    }
}

// ── folder helpers ──────────────────────────────────────────────────────

fn extract_folder_array(data: &Value) -> Vec<Value> {
    if let Some(a) = data.as_array() {
        return a.clone();
    }
    for key in ["results", "data", "folders"] {
        if let Some(a) = data.get(key).and_then(|v| v.as_array()) {
            return a.clone();
        }
    }
    Vec::new()
}

fn map_folders(items: &[Value]) -> Vec<XrayFolder> {
    items.iter().map(|f| XrayFolder {
        id: f["id"].as_u64().unwrap_or(0) as u32,
        name: f["name"].as_str().unwrap_or("").to_string(),
        parent_id: f.get("parentId").and_then(|v| v.as_u64()).map(|n| n as u32),
        children: {
            if let Some(c) = f.get("children").and_then(|c| c.as_array()) {
                Some(map_folders(c))
            } else if let Some(c) = f.get("folders").and_then(|c| c.as_array()) {
                Some(map_folders(c))
            } else {
                None
            }
        },
    }).collect()
}

fn build_folder_tree(flat: Vec<XrayFolder>) -> Vec<XrayFolder> {
    use std::collections::HashMap;
    // Map each folder id to the ids of its direct children.
    let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut id_to_node: HashMap<u32, XrayFolder> = HashMap::new();
    let mut roots: Vec<u32> = Vec::new();
    for f in flat {
        let id = f.id;
        let parent = f.parent_id;
        id_to_node.insert(id, f);
        match parent {
            Some(pid) if id_to_node.contains_key(&pid) || flat_exists(&id_to_node, pid) => {
                children_map.entry(pid).or_default().push(id);
            }
            Some(pid) => {
                // parent not yet seen; optimistically attach anyway
                children_map.entry(pid).or_default().push(id);
            }
            None => roots.push(id),
        }
    }
    // If a root id appears in children_map (its parent was missing), keep it
    // as a child of its parent instead; only ids with no parent stay roots.
    fn flat_exists(map: &HashMap<u32, XrayFolder>, id: u32) -> bool {
        map.contains_key(&id)
    }
    let _ = flat_exists;

    fn build(id: u32, id_to_node: &mut HashMap<u32, XrayFolder>, children_map: &HashMap<u32, Vec<u32>>) -> XrayFolder {
        let mut node = id_to_node.remove(&id).unwrap_or(XrayFolder {
            id,
            name: String::new(),
            parent_id: None,
            children: None,
        });
        let kids = children_map.get(&id).cloned().unwrap_or_default();
        if kids.is_empty() {
            node.children = None;
        } else {
            let mut built: Vec<XrayFolder> = Vec::new();
            for k in kids {
                built.push(build(k, id_to_node, children_map));
            }
            node.children = Some(built);
        }
        node
    }

    let mut out = Vec::new();
    for r in roots {
        if id_to_node.contains_key(&r) {
            out.push(build(r, &mut id_to_node, &children_map));
        }
    }
    out
}

fn normalize_field(f: &Value) -> Value {
    serde_json::json!({
        "id": f["id"],
        "name": f["name"],
        "type": f["schema"]["type"].clone(),
        "isCustom": f["id"].as_str().map(|s| s.starts_with("customfield_")).unwrap_or(false),
    })
}
