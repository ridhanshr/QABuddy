//! Confluence REST client. Ports `confluence-client.ts`: page fetch/update,
//! attachment upload/download, and Jira server-id detection via applinks.

use reqwest::Client;
use serde_json::{json, Value};

use crate::models::app_config::ConfluenceConfig;
use crate::services::error::{Result, ServiceError};
use crate::services::http::{auth_header, normalize_url};
use crate::services::text_utils::{parse_confluence_display_url, parse_confluence_page_id};

/// Low-level Confluence REST client.
#[derive(Clone)]
pub struct ConfluenceClient {
    pub base_url: String,
    config: ConfluenceConfig,
}

impl ConfluenceClient {
    pub fn new(config: &ConfluenceConfig) -> Self {
        Self {
            base_url: normalize_url(&config.base_url),
            config: config.clone(),
        }
    }

    fn build(&self, path_prefix: &str, timeout_secs: u64) -> Result<Client> {
        let mut builder = Client::builder().timeout(std::time::Duration::from_secs(timeout_secs));
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(value) = auth_header(&self.config.auth_mode, &self.config.username, &self.config.token) {
            if let Ok(hv) = reqwest::header::HeaderValue::from_str(&value) {
                headers.insert(reqwest::header::AUTHORIZATION, hv);
            }
        }
        if let Ok(hv) = reqwest::header::HeaderValue::try_from("application/json") {
            headers.insert(reqwest::header::ACCEPT, hv);
        }
        builder = builder.default_headers(headers);
        // path_prefix is folded into each request URL; we keep the client generic.
        let _ = path_prefix;
        builder.build().map_err(ServiceError::from)
    }

    fn url(&self, path: &str) -> String {
        // `path` is expected to be absolute from the host root (starts with /rest/...).
        format!("{}{}", self.base_url, path)
    }

    /// Probe `/rest/api/user/current`; returns a human-readable status string.
    pub async fn validate_connection(&self) -> Result<String> {
        let client = self.build("/rest/api", 30)?;
        let resp = client
            .get(self.url("/rest/api/user/current"))
            .send()
            .await
            .map_err(ServiceError::from)?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(ServiceError::Api(format!("HTTP {status}")));
        }
        let name = body
            .get("displayName")
            .and_then(|v| v.as_str())
            .or_else(|| body.get("username").and_then(|v| v.as_str()))
            .unwrap_or("connected");
        Ok(format!("Connected as {name}"))
    }

    /// Fetch a page with storage+view body, version, and space.
    pub async fn get_page(&self, page_id: &str) -> Result<Value> {
        let client = self.build("/rest/api", 120)?;
        let path = format!(
            "/rest/api/content/{page_id}?expand=body.storage,body.view,version,space"
        );
        let resp = client.get(self.url(&path)).send().await.map_err(ServiceError::from)?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            let snippet = if text.len() > 500 { &text[..500] } else { &text };
            return Err(ServiceError::Api(format!("HTTP {status}: {snippet}")));
        }
        serde_json::from_str::<Value>(&text).map_err(ServiceError::from)
    }

    /// Look up a page by space key + title.
    pub async fn get_page_by_title(&self, space_key: &str, title: &str) -> Result<Value> {
        let client = self.build("/rest/api", 120)?;
        let title_enc = url::form_urlencoded::byte_serialize(title.as_bytes()).collect::<String>();
        let path = format!(
            "/rest/api/content?spaceKey={space_key}&title={title_enc}&expand=body.storage,body.view,version,space"
        );
        let resp = client.get(self.url(&path)).send().await.map_err(ServiceError::from)?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(ServiceError::Api(format!("HTTP {status}")));
        }
        let results = body.get("results").and_then(|v| v.as_array());
        if let Some(arr) = results {
            if let Some(first) = arr.first() {
                return Ok(first.clone());
            }
        }
        Err(ServiceError::NotFound(format!(
            "Page not found with title \"{title}\" in space \"{space_key}\"."
        )))
    }

    /// Resolve a user-facing Confluence URL to the underlying page payload.
    pub async fn get_page_by_url(&self, url: &str) -> Result<Value> {
        if let Some(page_id) = parse_confluence_page_id(url) {
            return self.get_page(&page_id).await;
        }
        if let Some((space_key, title)) = parse_confluence_display_url(url) {
            return self.get_page_by_title(&space_key, &title).await;
        }
        Err(ServiceError::NotFound(format!("Unsupported Confluence URL: {url}")))
    }

    /// List pages for a space key or ancestor/page id.
    pub async fn list_pages(&self, space_or_page_id: &str) -> Result<Vec<Value>> {
        let client = self.build("/rest/api", 120)?;
        let is_numeric = space_or_page_id.chars().all(|c| c.is_ascii_digit());
        let mut start = 0u32;
        let limit = 50u32;
        let mut out = Vec::new();
        loop {
            let path = if is_numeric {
                let cql = format!("(id={} OR ancestor={}) AND type=page", space_or_page_id, space_or_page_id);
                format!(
                    "/rest/api/content/search?cql={}&start={start}&limit={limit}&expand=body.storage,space",
                    url::form_urlencoded::byte_serialize(cql.as_bytes()).collect::<String>()
                )
            } else {
                format!(
                    "/rest/api/content?spaceKey={}&type=page&status=current&start={start}&limit={limit}&expand=body.storage,space",
                    url::form_urlencoded::byte_serialize(space_or_page_id.as_bytes()).collect::<String>()
                )
            };
            let resp = client.get(self.url(&path)).send().await.map_err(ServiceError::from)?;
            let status = resp.status();
            let body: Value = resp.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                return Err(ServiceError::Api(format!("HTTP {status}")));
            }
            let items = body.get("results").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let total = body.get("size").and_then(|v| v.as_u64()).unwrap_or(items.len() as u64) as usize;
            let count = items.len();
            out.extend(items);
            if out.len() >= total || count < limit as usize {
                break;
            }
            start += limit;
        }
        Ok(out)
    }

    /// Update a page's storage body, bumping the version number.
    pub async fn update_page(&self, page_id: &str, title: &str, content: &str, version: u32) -> Result<Value> {
        let client = self.build("/rest/api", 120)?;
        let body = json!({
            "type": "page",
            "title": title,
            "version": { "number": version + 1 },
            "body": {
                "storage": {
                    "value": content,
                    "representation": "storage",
                }
            }
        });
        let path = format!("/rest/api/content/{page_id}");
        let resp = client.put(self.url(&path)).json(&body).send().await.map_err(ServiceError::from)?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            let snippet = if text.len() > 500 { &text[..500] } else { &text };
            return Err(ServiceError::Api(format!("HTTP {status}: {snippet}")));
        }
        serde_json::from_str::<Value>(&text).map_err(ServiceError::from)
    }

    /// List attachments (up to 100) for a page.
    pub async fn get_attachments(&self, page_id: &str) -> Result<Vec<Value>> {
        let client = self.build("/rest/api", 60)?;
        let mut all_results: Vec<Value> = Vec::new();
        let mut start = 0usize;
        let limit = 200usize;
        loop {
            let path = format!(
                "/rest/api/content/{page_id}/child/attachment?limit={limit}&start={start}&expand=version"
            );
            let resp = client.get(self.url(&path)).send().await.map_err(ServiceError::from)?;
            let body: Value = resp.json().await.unwrap_or(Value::Null);
            let results = body
                .get("results")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let count = results.len();
            all_results.extend(results);
            // Stop if this page returned fewer items than the limit (last page)
            if count < limit {
                break;
            }
            start += limit;
        }
        Ok(all_results)
    }

    /// Download an attachment by its `/download/...` path and return raw bytes.
    pub async fn download_attachment(&self, download_path: &str) -> Result<Vec<u8>> {
        let client = self.build("", 120)?;
        let resp = client
            .get(self.url(download_path))
            .send()
            .await
            .map_err(ServiceError::from)?;
        let status = resp.status();
        let bytes = resp.bytes().await.map_err(ServiceError::from)?.to_vec();
        if !status.is_success() {
            return Err(ServiceError::Api(format!("HTTP {status}")));
        }
        Ok(bytes)
    }

    /// Upload an attachment (raw bytes) to a page.
    pub async fn upload_attachment(
        &self,
        page_id: &str,
        filename: &str,
        data: Vec<u8>,
    ) -> Result<Value> {
        let client = self.build("/rest/api", 120)?;
        // multipart form, requires X-Atlassian-Token: nocheck
        let part = reqwest::multipart::Part::bytes(data)
            .file_name(filename.to_string())
            .mime_str("application/octet-stream")
            .map_err(ServiceError::from)?;
        let form = reqwest::multipart::Form::new()
            .text("comment", "Uploaded via QA Buddy".to_string())
            .part("file", part);

        let path = format!("/rest/api/content/{page_id}/child/attachment");
        let resp = client
            .post(self.url(&path))
            .header("X-Atlassian-Token", "nocheck")
            .multipart(form)
            .send()
            .await
            .map_err(ServiceError::from)?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(ServiceError::Api(format!("HTTP {status}")));
        }
        Ok(body
            .get("results")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .cloned()
            .unwrap_or(Value::Null))
    }

    /// Resolve the Jira application-link server id via the applinks REST API.
    pub async fn detect_jira_server_id(&self) -> Option<String> {
        let candidates = [
            "/rest/applinks/3.0/applinks",
            "/rest/applinks/latest/listApplicationlinks",
            "/rest/applinks/1.0/listApplicationlinks",
        ];
        for path in candidates {
            let client = match self.build("", 30) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let resp = client
                .get(self.url(path))
                .header("Accept", "application/json, application/xml, text/xml")
                .send()
                .await;
            let resp = match resp {
                Ok(r) => r,
                Err(_) => continue,
            };
            // 401/403 → try next candidate.
            let status = resp.status().as_u16();
            if status == 401 || status == 403 {
                continue;
            }
            let text = resp.text().await.unwrap_or_default();
            if let Some(id) = extract_jira_server_id(&text) {
                return Some(id);
            }
        }
        None
    }
}

/// Parse a Jira server id out of an applinks response (XML or JSON).
/// Ports `ConfluenceClient.extractJiraServerIdFromAppLinksResponse`.
pub fn extract_jira_server_id(payload: &str) -> Option<String> {
    let decoded = decode_xml_entities(payload);
    // XML form: <application> ... <typeId>jira</typeId> ... <id>xxx</id> ... </application>
    let app_re = regex::Regex::new(r"(?is)<application>[\s\S]*?</application>").unwrap();
    for block in app_re.find_iter(&decoded) {
        let block = block.as_str();
        let is_jira = regex::Regex::new(r"(?i)<typeId>\s*jira\s*</typeId>").unwrap().is_match(block);
        if !is_jira {
            continue;
        }
        let id_re = regex::Regex::new(r"(?i)<id>\s*([^<]+?)\s*</id>").unwrap();
        if let Some(c) = id_re.captures(block) {
            let id = c[1].trim().to_string();
            if !id.is_empty() {
                return Some(id);
            }
        }
    }
    // JSON form: try parsing and recurse for a jira-typed entry.
    if let Ok(value) = serde_json::from_str::<Value>(payload) {
        return find_jira_id_in_json(&value);
    }
    None
}

fn find_jira_id_in_json(value: &Value) -> Option<String> {
    match value {
        Value::Array(arr) => {
            for item in arr {
                if let Some(found) = find_jira_id_in_json(item) {
                    return Some(found);
                }
            }
            None
        }
        Value::Object(obj) => {
            let type_str = obj
                .get("typeId")
                .or_else(|| obj.get("type"))
                .or_else(|| obj.get("application").and_then(|a| a.get("typeId")))
                .or_else(|| obj.get("application").and_then(|a| a.get("type")))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let id = obj.get("id")
                .or_else(|| obj.get("application").and_then(|a| a.get("id")))
                .or_else(|| obj.get("serverId"))
                .or_else(|| obj.get("applicationId"))
                .and_then(|v| v.as_str());
            if type_str.contains("jira") {
                if let Some(id) = id {
                    let id = id.trim().to_string();
                    if !id.is_empty() {
                        return Some(id);
                    }
                }
            }
            for (_, nested) in obj {
                if let Some(found) = find_jira_id_in_json(nested) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn decode_xml_entities(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}
