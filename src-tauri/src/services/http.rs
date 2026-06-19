//! Atlassian HTTP client wrapper built on reqwest.
//!
//! Provides authenticated clients for Jira REST/Agile/Xray APIs, Confluence,
//! and a generic builder used throughout the services. Mirrors the behaviour
//! of the Electron `createAtlassianClient` helper: Bearer/Basic auth, 60s
//! timeout, and automatic retry with exponential backoff for transient
//! network/5xx/429 errors.

use std::time::Duration;

use reqwest::{Client, Method, Response, StatusCode};
use serde::Serialize;

use crate::models::app_config::{AuthMode, ConfluenceConfig, JiraConfig};
use crate::services::error::{Result, ServiceError};

const TIMEOUT_SECS: u64 = 60;
const MAX_RETRIES: u32 = 2;
const RETRYABLE_STATUSES: &[u16] = &[429, 500, 502, 503, 504];

/// Build the Authorization header value for the given credentials.
pub fn auth_header(auth_mode: &AuthMode, username: &str, token: &str) -> Option<String> {
    if token.is_empty() {
        return None;
    }
    match auth_mode {
        AuthMode::Basic => {
            let payload = base64::engine::general_purpose::STANDARD
                .encode(format!("{username}:{token}"));
            Some(format!("Basic {payload}"))
        }
        AuthMode::Bearer => Some(format!("Bearer {token}")),
    }
}

/// Construct a reqwest [`Client`] preconfigured for an Atlassian endpoint.
pub fn build_client(base_url: &str, path_prefix: &str, auth_mode: &AuthMode, username: &str, token: &str) -> Result<Client> {
    let _ = (base_url, path_prefix); // base/prefix are applied per-request via AtlassianClient
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5));
    if let Some(value) = auth_header(auth_mode, username, token) {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(&value) {
            headers.insert(reqwest::header::AUTHORIZATION, hv);
        }
        if let Ok(hv) = reqwest::header::HeaderValue::try_from("application/json") {
            headers.insert(reqwest::header::CONTENT_TYPE, hv);
        }
        if let Ok(hv) = reqwest::header::HeaderValue::try_from("application/json") {
            headers.insert(reqwest::header::ACCEPT, hv);
        }
        builder = builder.default_headers(headers);
    }
    builder.build().map_err(ServiceError::from)
}

/// Execute a request with automatic retry on transient failures.
async fn send_with_retry(client: &Client, method: Method, url: &str) -> Result<Response> {
    let mut last_err: Option<ServiceError> = None;
    for attempt in 0..=MAX_RETRIES {
        let req = client.request(method.clone(), url);
        let resp = req.send().await;
        match resp {
            Ok(r) => {
                let status = r.status();
                if RETRYABLE_STATUSES.contains(&status.as_u16()) && attempt < MAX_RETRIES {
                    let backoff = Duration::from_millis((attempt as u64 + 1) * 1000);
                    tokio::time::sleep(backoff).await;
                    continue;
                }
                return Ok(r);
            }
            Err(e) => {
                // Network error: retry until exhausted.
                last_err = Some(ServiceError::from(e));
                if attempt < MAX_RETRIES {
                    let backoff = Duration::from_millis((attempt as u64 + 1) * 1000);
                    tokio::time::sleep(backoff).await;
                    continue;
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| ServiceError::Api("retry loop exhausted".into())))
}

/// Execute a request with a JSON body and retry.
async fn send_with_retry_body(client: &Client, method: Method, url: &str, body: &str) -> Result<Response> {
    let mut last_err: Option<ServiceError> = None;
    for attempt in 0..=MAX_RETRIES {
        let req = client.request(method.clone(), url).body(body.to_string());
        let resp = req.send().await;
        match resp {
            Ok(r) => {
                let status = r.status();
                if RETRYABLE_STATUSES.contains(&status.as_u16()) && attempt < MAX_RETRIES {
                    let backoff = Duration::from_millis((attempt as u64 + 1) * 1000);
                    tokio::time::sleep(backoff).await;
                    continue;
                }
                return Ok(r);
            }
            Err(e) => {
                last_err = Some(ServiceError::from(e));
                if attempt < MAX_RETRIES {
                    let backoff = Duration::from_millis((attempt as u64 + 1) * 1000);
                    tokio::time::sleep(backoff).await;
                    continue;
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| ServiceError::Api("retry loop exhausted".into())))
}

/// Read the response body, surfacing a descriptive error for non-2xx responses.
async fn read_response<T: serde::de::DeserializeOwned>(response: Response) -> Result<T> {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet = if text.len() > 500 { &text[..500] } else { &text };
        return Err(ServiceError::Api(format!("HTTP {}: {}", status, snippet)));
    }
    serde_json::from_str::<T>(&text).map_err(ServiceError::from)
}

/// Read raw text for non-2xx-aware use cases.
pub async fn read_text(response: Response) -> Result<String> {
    response.text().await.map_err(ServiceError::from)
}

/// A thin wrapper around a reqwest [`Client`] targeting a single base URL +
/// path prefix. Used by the Jira/Confluence services.
pub struct AtlassianClient {
    pub base_url: String,
    pub path_prefix: String,
    pub http: Client,
}

impl AtlassianClient {
    pub fn new(base_url: &str, path_prefix: &str, auth_mode: &AuthMode, username: &str, token: &str) -> Result<Self> {
        let http = build_client(base_url, path_prefix, auth_mode, username, token)?;
        Ok(Self {
            base_url: normalize_url(base_url),
            path_prefix: path_prefix.to_string(),
            http,
        })
    }

    /// Compose the full URL for a relative path, appending query parameters.
    fn url(&self, path: &str, query: &[(&str, String)]) -> String {
        let mut url = format!("{}{}{}", self.base_url, self.path_prefix, path);
        if !query.is_empty() {
            let mut pairs = url::form_urlencoded::Serializer::new(String::new());
            for (k, v) in query {
                pairs.append_pair(k, v);
            }
            url.push('?');
            url.push_str(&pairs.finish());
        }
        url
    }

    pub async fn get<T: serde::de::DeserializeOwned>(&self, path: &str, query: &[(&str, String)]) -> Result<T> {
        let url = self.url(path, query);
        let resp = send_with_retry(&self.http, Method::GET, &url).await?;
        read_response::<T>(resp).await
    }

    /// GET returning raw JSON value (for loosely-typed responses).
    pub async fn get_json(&self, path: &str, query: &[(&str, String)]) -> Result<serde_json::Value> {
        self.get::<serde_json::Value>(path, query).await
    }

    pub async fn post<T: serde::de::DeserializeOwned, B: Serialize>(&self, path: &str, body: &B) -> Result<T> {
        let url = self.url(path, &[]);
        let body_str = serde_json::to_string(body)?;
        let resp = send_with_retry_body(&self.http, Method::POST, &url, &body_str).await?;
        read_response::<T>(resp).await
    }

    pub async fn post_json(&self, path: &str, body: &serde_json::Value) -> Result<serde_json::Value> {
        let url = self.url(path, &[]);
        let body_str = serde_json::to_string(body)?;
        let resp = send_with_retry_body(&self.http, Method::POST, &url, &body_str).await?;
        read_response::<serde_json::Value>(resp).await
    }

    pub async fn put<T: serde::de::DeserializeOwned, B: Serialize>(&self, path: &str, body: &B) -> Result<T> {
        let url = self.url(path, &[]);
        let body_str = serde_json::to_string(body)?;
        let resp = send_with_retry_body(&self.http, Method::PUT, &url, &body_str).await?;
        // PUT frequently returns 204 No Content.
        if resp.status() == StatusCode::NO_CONTENT {
            return serde_json::from_str::<T>("null").map_err(ServiceError::from);
        }
        read_response::<T>(resp).await
    }

    /// PUT that ignores the response body entirely (used by Xray endpoints).
    pub async fn put_void<B: Serialize>(&self, path: &str, body: &B) -> Result<()> {
        let url = self.url(path, &[]);
        let body_str = serde_json::to_string(body)?;
        let resp = send_with_retry_body(&self.http, Method::PUT, &url, &body_str).await?;
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            let text = resp.text().await.unwrap_or_default();
            let snippet = if text.len() > 500 { &text[..500] } else { &text };
            Err(ServiceError::Api(format!("HTTP {}: {}", status, snippet)))
        }
    }

    pub async fn put_json_void(&self, path: &str, body: &serde_json::Value) -> Result<()> {
        self.put_void(path, body).await
    }

    /// Perform a GET but swallow errors, returning `None` on failure. Mirrors
    /// the Electron client's try/catch fallback pattern.
    pub async fn get_json_or_none(&self, path: &str, query: &[(&str, String)]) -> Option<serde_json::Value> {
        match self.get_json(path, query).await {
            Ok(v) => Some(v),
            Err(_) => None,
        }
    }
}

/// Convenience: build a Jira API client (`/rest/api/2`).
pub fn jira_api_client(config: &JiraConfig) -> Result<AtlassianClient> {
    AtlassianClient::new(
        &config.base_url,
        "/rest/api/2",
        &config.auth_mode,
        &config.username,
        &config.token,
    )
}

/// Convenience: build a Jira Agile client (`/rest/agile/1.0`).
pub fn jira_agile_client(config: &JiraConfig) -> Result<AtlassianClient> {
    AtlassianClient::new(
        &config.base_url,
        "/rest/agile/1.0",
        &config.auth_mode,
        &config.username,
        &config.token,
    )
}

/// Convenience: build an Xray client (`/rest/raven/1.0/api`).
pub fn jira_xray_client(config: &JiraConfig) -> Result<AtlassianClient> {
    AtlassianClient::new(
        &config.base_url,
        "/rest/raven/1.0/api",
        &config.auth_mode,
        &config.username,
        &config.token,
    )
}

/// Convenience: build a Confluence client (`/rest/api`).
pub fn confluence_client(config: &ConfluenceConfig) -> Result<AtlassianClient> {
    AtlassianClient::new(
        &config.base_url,
        "/rest/api",
        &config.auth_mode,
        &config.username,
        &config.token,
    )
}

// ── URL & string helpers (ported from services/utils.ts) ────────────────

/// Normalise a user-entered base URL: trim, strip trailing slashes, add a
/// scheme if missing, and rewrite localhost → 127.0.0.1.
pub fn normalize_url(value: &str) -> String {
    let mut url = value.trim().trim_end_matches('/').to_string();
    if !url.is_empty() && !regex::Regex::new(r"(?i)^https?://").unwrap().is_match(&url) {
        url = format!("http://{url}");
    }
    if url.contains("://localhost") {
        url = url.replace("://localhost", "://127.0.0.1");
    }
    url
}

use base64::Engine as _;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_strips_trailing_slash_and_adds_scheme() {
        assert_eq!(normalize_url("https://example.com/"), "https://example.com");
        assert_eq!(normalize_url("example.com/"), "http://example.com");
        assert_eq!(normalize_url("http://localhost:8080/"), "http://127.0.0.1:8080");
        assert_eq!(normalize_url(""), "");
    }

    #[test]
    fn auth_header_bearer_and_basic() {
        let bearer = auth_header(&AuthMode::Bearer, "user", "tok").unwrap();
        assert_eq!(bearer, "Bearer tok");
        let basic = auth_header(&AuthMode::Basic, "user", "tok").unwrap();
        assert!(basic.starts_with("Basic "));
    }
}
