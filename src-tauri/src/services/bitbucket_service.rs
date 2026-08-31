use crate::models::app_config::AppConfig;
use crate::models::bitbucket::*;
use crate::models::chat::ChatHistoryMessage;
use crate::models::rag::CodeChunkMeta;
use crate::services::bitbucket_cache::{
    get_global_bitbucket_cache, get_global_bitbucket_explain_cache, BitbucketCacheService,
    BitbucketExplainCacheService,
};
use crate::services::gap_analysis::GapAnalyzer;
use crate::services::impact_analysis::ImpactAnalyzer;
use crate::services::ollama::OllamaClient;
use crate::services::rag::{
    code_chunks, RagService, VectorChunk, BITBUCKET_TTL_SECS, CODE_CHUNK_LINES, CODE_CHUNK_OVERLAP,
};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const BITBUCKET_TIMEOUT_SECS: u64 = 60;
const CHANGES_PAGE_SIZE: u32 = 200;
/// Cap for the raw diff fetched from Bitbucket. The raw diff is only used to
/// determine changed-line numbers and for impact analysis (AI context comes
/// from RAG full-file chunks), so a generous cap is safe and ensures files
/// later in a large diff aren't dropped.
const MAX_DIFF_CHARS: usize = 500_000;
/// Embedding model used to index Bitbucket source code into RAG.
const CODE_EMBEDDING_MODEL: &str = "nomic-embed-text";
/// Maximum number of RAG chunks injected into the scenario prompt.
const MAX_RETRIEVED_CHUNKS: usize = 30;
/// Cap for the fallback whole-file context when a file isn't in RAG.
const MAX_EXPLAIN_FALLBACK_LINES: usize = 1200;
/// Bumps whenever the scenario prompt / JSON schema changes, so cached results
/// from an older prompt version are never served for a newer one.
const SCENARIO_SCHEMA_VERSION: &str = "v5";

/// Build the Ollama JSON Schema that constrains the model to emit exactly a
/// top-level `scenarios` array. Passing this as `format` (instead of the
/// generic `"json"`) stops small SLM models from returning unrelated objects
/// (e.g. a `steps`/`totalResults` shape).
fn scenario_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "scenarios": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "scenario": { "type": "string" },
                        "filePath": { "type": "string" },
                        "confidence": { "type": "integer" },
                        "reason": { "type": "string" },
                        "scenarioType": { "type": "string" },
                        "riskLevel": { "type": "string" },
                        "preconditions": { "type": "array", "items": { "type": "string" } },
                        "steps": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "step": { "type": "integer" },
                                    "action": { "type": "string" },
                                    "expected": { "type": "string" }
                                },
                                "required": ["step", "action", "expected"]
                            }
                        }
                    },
                    "required": ["scenario", "filePath", "confidence", "reason", "scenarioType", "riskLevel", "preconditions", "steps"]
                }
            }
        },
        "required": ["scenarios"]
    })
}

pub struct BitbucketService {
    config: AppConfig,
}

impl BitbucketService {
    pub fn new(config: AppConfig) -> Self {
        Self { config }
    }

    fn create_client(&self) -> Result<reqwest::Client, String> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        if !self.config.bitbucket.token.is_empty() {
            let auth_header = format!("Bearer {}", self.config.bitbucket.token);
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&auth_header).map_err(|e| e.to_string())?,
            );
        }

        reqwest::Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(BITBUCKET_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("Failed to create reqwest client: {}", e))
    }

    /// Parse a full PR URL or a numeric PR id (falling back to the configured
    /// default project/repo). Returns `Err` for unrecognised/empty input.
    pub fn parse_pr_url(&self, url_or_id: &str) -> Result<(String, String, u64), String> {
        let trimmed = url_or_id.trim();
        if trimmed.is_empty() {
            return Err("Bitbucket PR URL / ID kosong".to_string());
        }

        // Full URL: https://bitbucket.company.com/projects/PROJ/repos/REPO/pull-requests/42
        if trimmed.contains("/projects/")
            && trimmed.contains("/repos/")
            && trimmed.contains("/pull-requests/")
        {
            let parts: Vec<&str> = trimmed.split('/').collect();
            let mut project_key = String::new();
            let mut repo_slug = String::new();
            let mut pr_id: u64 = 0;

            for i in 0..parts.len() {
                if parts[i] == "projects" && i + 1 < parts.len() {
                    project_key = parts[i + 1].to_string();
                } else if parts[i] == "repos" && i + 1 < parts.len() {
                    repo_slug = parts[i + 1].to_string();
                } else if parts[i] == "pull-requests" && i + 1 < parts.len() {
                    pr_id = parts[i + 1].parse::<u64>().unwrap_or(0);
                }
            }

            if !project_key.is_empty() && !repo_slug.is_empty() && pr_id > 0 {
                return Ok((project_key, repo_slug, pr_id));
            }
            return Err("URL PR Bitbucket tidak valid".to_string());
        }

        // Numeric ID → configured default project/repo
        let pr_id = trimmed
            .parse::<u64>()
            .map_err(|_| format!("PR ID tidak valid: {trimmed}"))?;
        let project_key = if self.config.bitbucket.default_project_key.is_empty() {
            "QA".to_string()
        } else {
            self.config.bitbucket.default_project_key.clone()
        };
        let repo_slug = if self.config.bitbucket.default_repo_slug.is_empty() {
            "main-repo".to_string()
        } else {
            self.config.bitbucket.default_repo_slug.clone()
        };

        Ok((project_key, repo_slug, pr_id))
    }

    pub fn extract_jira_key(text: &str) -> Option<String> {
        let re = regex::Regex::new(r"([A-Z]{2,10}-\d+)").ok()?;
        re.captures(text).map(|c| c[1].to_string())
    }

    /// Fetch the changed-files list, following Bitbucket's pagination and
    /// surfacing API errors instead of silently returning an empty list.
    async fn fetch_changes(
        &self,
        client: &reqwest::Client,
        base_url: &str,
        project_key: &str,
        repo_slug: &str,
        pr_id: u64,
    ) -> Result<Vec<BitbucketFileChange>, String> {
        let mut files = Vec::new();
        let mut start = 0u32;

        loop {
            let url = format!(
                "{}/rest/api/1.0/projects/{}/repos/{}/pull-requests/{}/changes?limit={}&start={}",
                base_url, project_key, repo_slug, pr_id, CHANGES_PAGE_SIZE, start
            );
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Bitbucket changes API request failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!(
                    "Bitbucket changes API returned status: {}",
                    resp.status()
                ));
            }
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse Bitbucket changes response: {e}"))?;

            if let Some(values) = json["values"].as_array() {
                for item in values {
                    let path = item["path"]["toString"]
                        .as_str()
                        .map(|s| s.to_string())
                        .or_else(|| {
                            item["path"]["components"].as_array().map(|a| {
                                a.iter()
                                    .filter_map(|c| c.as_str())
                                    .collect::<Vec<_>>()
                                    .join("/")
                            })
                        })
                        .unwrap_or_else(|| "file".to_string());
                    let change_type = item["type"].as_str().unwrap_or("MODIFY").to_string();
                    let lines_added = item["linesAdded"].as_u64().unwrap_or(0) as usize;
                    let lines_deleted = item["linesDeleted"].as_u64().unwrap_or(0) as usize;
                    let explainable = !Self::is_ignored_file(&path) && !Self::is_binary_file(&path);

                    files.push(BitbucketFileChange {
                        path,
                        change_type,
                        lines_added,
                        lines_deleted,
                        explainable,
                    });
                }
            }

            if json["isLastPage"].as_bool().unwrap_or(true) {
                break;
            }
            let next = json["nextPageStart"].as_u64().unwrap_or(0) as u32;
            if next <= start {
                break; // safety guard against an infinite loop
            }
            start = next;
        }

        Ok(files)
    }

    /// Fetch all commit messages of a PR (paginated), formatted as intent
    /// hints for the AI. Each entry is "[<short-hash>] <author> - <date>\n<full
    /// message>". Never treated as ground truth downstream.
    async fn fetch_pr_commits(
        &self,
        client: &reqwest::Client,
        base_url: &str,
        project_key: &str,
        repo_slug: &str,
        pr_id: u64,
    ) -> Result<Vec<String>, String> {
        let mut messages = Vec::new();
        let mut start = 0u32;

        loop {
            let url = format!(
                "{}/rest/api/1.0/projects/{}/repos/{}/pull-requests/{}/commits?limit={}&start={}",
                base_url, project_key, repo_slug, pr_id, CHANGES_PAGE_SIZE, start
            );
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Bitbucket commits API request failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!(
                    "Bitbucket commits API returned status: {}",
                    resp.status()
                ));
            }
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse Bitbucket commits response: {e}"))?;

            if let Some(values) = json["values"].as_array() {
                messages.extend(Self::commit_messages_from_values(values));
            }

            if json["isLastPage"].as_bool().unwrap_or(true) {
                break;
            }
            let next = json["nextPageStart"].as_u64().unwrap_or(0) as u32;
            if next <= start {
                break; // safety guard against an infinite loop
            }
            start = next;
        }

        Ok(messages)
    }

    /// Format the `values[]` array of a Bitbucket commits response into intent
    /// hint blocks: "[<short-hash>] <author> - <date>\n<full message>". Empty
    /// messages are skipped.
    fn commit_messages_from_values(values: &[serde_json::Value]) -> Vec<String> {
        let mut messages = Vec::new();
        for item in values {
            let msg = item["message"].as_str().unwrap_or("").trim().to_string();
            if msg.is_empty() {
                continue;
            }
            let full_hash = item["id"].as_str().unwrap_or("");
            let short_hash = full_hash.chars().take(8).collect::<String>();
            let author = item["author"]["displayName"]
                .as_str()
                .or_else(|| item["author"]["name"].as_str())
                .unwrap_or("Unknown");
            let date = item["authorTimestamp"]
                .as_i64()
                .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_millis)
                .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_default();
            let date_part = if date.is_empty() {
                String::new()
            } else {
                format!(" - {date}")
            };
            messages.push(format!("[{short_hash}] {author}{date_part}\n{msg}"));
        }
        messages
    }

    /// Fetch the PR diff JSON and compute per-file added/deleted line counts.
    /// Bitbucket's `/changes` endpoint does not return `linesAdded`/`linesDeleted`,
    /// so we derive the counts from the `/diff` endpoint. Preferred source is the
    /// per-file `properties.lineCounts`, falling back to summing hunk segments.
    async fn fetch_diff_line_counts(
        client: &reqwest::Client,
        base_url: &str,
        project_key: &str,
        repo_slug: &str,
        pr_id: u64,
    ) -> Result<HashMap<String, (usize, usize)>, String> {
        let url = format!(
            "{}/rest/api/1.0/projects/{}/repos/{}/pull-requests/{}/diff",
            base_url, project_key, repo_slug, pr_id
        );
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Bitbucket diff API request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Bitbucket diff API returned status: {}",
                resp.status()
            ));
        }
        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Bitbucket diff response: {e}"))?;

        // The `/diff` response is normally a top-level array. Some server
        // versions wrap it in an object under "diffs".
        let files: Vec<&serde_json::Value> = json
            .as_array()
            .map(|a| a.iter().collect())
            .or_else(|| json["diffs"].as_array().map(|a| a.iter().collect()))
            .unwrap_or_default();
        if files.is_empty() {
            return Err(format!("Bitbucket diff response contained no file diffs"));
        }

        let mut counts: HashMap<String, (usize, usize)> = HashMap::new();
        for file in files {
            let path = file["destination"]["toString"]
                .as_str()
                .or_else(|| file["source"]["toString"].as_str())
                .unwrap_or("")
                .to_string();
            if path.is_empty() {
                continue;
            }
            // Preferred: Bitbucket provides authoritative per-file counts.
            let mut added = file["properties"]["lineCounts"]["added"]
                .as_u64()
                .unwrap_or(0) as usize;
            let mut deleted = file["properties"]["lineCounts"]["deleted"]
                .as_u64()
                .unwrap_or(0) as usize;
            // Fallback: sum ADDED/REMOVED lines across hunk segments.
            if added == 0 && deleted == 0 {
                if let Some(hunks) = file["hunks"].as_array() {
                    for hunk in hunks {
                        if let Some(segments) = hunk["segments"].as_array() {
                            for seg in segments {
                                let stype = seg["type"].as_str().unwrap_or("");
                                let n = seg["lines"].as_array().map(|l| l.len()).unwrap_or(0);
                                match stype {
                                    "ADDED" => added += n,
                                    "REMOVED" => deleted += n,
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
            counts.insert(path, (added, deleted));
        }
        Ok(counts)
    }

    /// Fetch the PR JSON concurrently with the changed-files list.
    pub async fn fetch_pr_details(&self, url_or_id: &str) -> Result<BitbucketDiffSummary, String> {
        let (project_key, repo_slug, pr_id) = self.parse_pr_url(url_or_id)?;
        let client = self.create_client()?;
        let base_url = self.config.bitbucket.base_url.trim_end_matches('/');

        if base_url.is_empty() {
            return Err("Bitbucket Base URL is not configured in Settings".to_string());
        }

        let pr_url = format!(
            "{}/rest/api/1.0/projects/{}/repos/{}/pull-requests/{}",
            base_url, project_key, repo_slug, pr_id
        );

        log::info!(target: "Bitbucket", "fetch_pr_details: GET {pr_url}");
        let (pr_result, changes_result, counts_result, commits_result) = tokio::join!(
            Self::fetch_pr_json(&client, &pr_url),
            self.fetch_changes(&client, &base_url, &project_key, &repo_slug, pr_id),
            Self::fetch_diff_line_counts(&client, &base_url, &project_key, &repo_slug, pr_id),
            self.fetch_pr_commits(&client, &base_url, &project_key, &repo_slug, pr_id),
        );

        let pr_json = pr_result?;
        let mut files = changes_result?;
        let line_counts = match counts_result {
            Ok(c) => c,
            Err(e) => {
                log::warn!(target: "Bitbucket", "fetch_pr_details: could not compute diff line counts: {e}");
                HashMap::new()
            }
        };
        let commit_messages = match commits_result {
            Ok(m) => m,
            Err(e) => {
                log::warn!(target: "Bitbucket", "fetch_pr_details: failed to fetch commit messages: {e}");
                Vec::new()
            }
        };
        for f in files.iter_mut() {
            if let Some((added, deleted)) = line_counts.get(&f.path) {
                f.lines_added = *added;
                f.lines_deleted = *deleted;
            }
        }
        log::info!(target: "Bitbucket", "fetch_pr_details OK: {} files changed, {} commit message(s)", files.len(), commit_messages.len());

        let title = pr_json["title"]
            .as_str()
            .unwrap_or("Untitled PR")
            .to_string();
        let description = pr_json["description"].as_str().map(|s| s.to_string());
        let branch_from = pr_json["fromRef"]["displayId"]
            .as_str()
            .unwrap_or("feature")
            .to_string();
        let branch_to = pr_json["toRef"]["displayId"]
            .as_str()
            .unwrap_or("main")
            .to_string();
        let latest_commit_hash = pr_json["fromRef"]["latestCommit"]
            .as_str()
            .unwrap_or("latest")
            .to_string();
        let author_name = pr_json["author"]["user"]["displayName"]
            .as_str()
            .or_else(|| pr_json["author"]["user"]["name"].as_str())
            .unwrap_or("Unknown")
            .to_string();

        let jira_ticket_key = Self::extract_jira_key(&title)
            .or_else(|| Self::extract_jira_key(&branch_from))
            .or_else(|| description.as_deref().and_then(Self::extract_jira_key));

        Ok(BitbucketDiffSummary {
            project_key,
            repo_slug,
            pr_id,
            title,
            latest_commit_hash,
            author_name,
            branch_from,
            branch_to,
            files,
            commit_messages,
            jira_ticket_key,
            jira_summary: None,
            jira_description: None,
            cached: false,
        })
    }

    /// Fetch and parse a single Bitbucket PR document.
    async fn fetch_pr_json(
        client: &reqwest::Client,
        pr_url: &str,
    ) -> Result<serde_json::Value, String> {
        let resp = client
            .get(pr_url)
            .send()
            .await
            .map_err(|e| format!("Bitbucket API request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Bitbucket API returned status: {}", resp.status()));
        }
        resp.json()
            .await
            .map_err(|e| format!("Failed to parse Bitbucket PR response: {}", e))
    }

    pub async fn fetch_raw_diff(
        &self,
        project_key: &str,
        repo_slug: &str,
        pr_id: u64,
    ) -> Result<String, String> {
        let client = self.create_client()?;
        let base_url = self.config.bitbucket.base_url.trim_end_matches('/');
        let diff_url = format!(
            "{}/rest/api/1.0/projects/{}/repos/{}/pull-requests/{}/diff",
            base_url, project_key, repo_slug, pr_id
        );

        let resp = client
            .get(&diff_url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch diff: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Bitbucket diff API returned status: {}",
                resp.status()
            ));
        }

        let text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read diff text: {}", e))?;
        // Truncate raw diff if exceedingly large, without cutting a multi-byte char.
        if text.len() > MAX_DIFF_CHARS {
            let mut end = MAX_DIFF_CHARS;
            while end > 0 && !text.is_char_boundary(end) {
                end -= 1;
            }
            log::info!(target: "Bitbucket", "fetch_raw_diff: {} bytes (truncated to {end})", text.len());
            Ok(format!(
                "{}\n...[diff truncated for performance]",
                &text[..end]
            ))
        } else {
            log::info!(target: "Bitbucket", "fetch_raw_diff: {} bytes", text.len());
            Ok(text)
        }
    }

    /// Fetch the full raw content of a file at the given commit (browse API).
    /// Returns `Err` when the file doesn't exist at that commit (e.g. deleted).
    async fn fetch_file_content_impl(
        client: &reqwest::Client,
        base_url: &str,
        project_key: &str,
        repo_slug: &str,
        path: &str,
        commit_hash: &str,
    ) -> Result<String, String> {
        let encoded_path = Self::encode_path_segments(path);
        let url = format!(
            "{}/rest/api/1.0/projects/{}/repos/{}/browse/{}?at={}&raw",
            base_url, project_key, repo_slug, encoded_path, commit_hash
        );
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch file content for {path}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Bitbucket browse API returned status {} for {path}",
                resp.status()
            ));
        }
        resp.text()
            .await
            .map_err(|e| format!("Failed to read file content for {path}: {e}"))
    }

    /// Percent-encode each path segment while keeping `/` separators intact.
    fn encode_path_segments(path: &str) -> String {
        path.split('/')
            .map(|seg| url::form_urlencoded::byte_serialize(seg.as_bytes()).collect::<String>())
            .collect::<Vec<_>>()
            .join("/")
    }

    fn emit_generate_progress(app_handle: Option<&AppHandle>, stage: &str, message: impl Into<String>) {
        if let Some(handle) = app_handle {
            let _ = handle.emit(
                "bitbucket-generate-progress",
                BitbucketGenerateProgress { stage: stage.to_string(), message: message.into() },
            );
        }
    }

    pub async fn generate_scenarios(
        &self,
        req: BitbucketGenerateRequest,
        ollama: OllamaClient,
        rag: RagService,
        app_handle: Option<&AppHandle>,
    ) -> Result<BitbucketGenerateResponse, String> {
        Self::emit_generate_progress(app_handle, "fetch_pr", "Mengambil detail Pull Request...");
        let pr_summary = self.fetch_pr_details(&req.pr_url_or_id).await?;
        let cache_key = BitbucketCacheService::make_key(
            SCENARIO_SCHEMA_VERSION,
            &pr_summary.project_key,
            &pr_summary.repo_slug,
            pr_summary.pr_id,
            &pr_summary.latest_commit_hash,
            &self.config.ollama.model,
            &req.selected_files,
        );

        // Check Caching Strategy (PR_ID + CommitHash + Model + File selection)
        if !req.force_refresh_cache {
            if let Some(cached_res) = get_global_bitbucket_cache().get(&cache_key) {
                log::info!(target: "Bitbucket", "generate_scenarios: cache hit for {}", cache_key);
                return Ok(cached_res);
            }
        }
        log::info!(target: "Bitbucket", "generate_scenarios: cache miss — generating for {}", cache_key);

        Self::emit_generate_progress(app_handle, "fetch_diff", "Mengambil code diff dari Bitbucket...");
        let raw_diff = self
            .fetch_raw_diff(
                &pr_summary.project_key,
                &pr_summary.repo_slug,
                pr_summary.pr_id,
            )
            .await?;

        // Exclude non-testable / binary files (CHANGELOG, .jar, images, etc.)
        // from scenario generation entirely.
        let mut skipped_binary = 0usize;
        let keep_file = |f: &BitbucketFileChange, skipped_binary: &mut usize| -> bool {
            if Self::is_ignored_file(&f.path) {
                false
            } else if Self::is_binary_file(&f.path) {
                *skipped_binary += 1;
                false
            } else {
                true
            }
        };
        let non_ignored: Vec<String> = pr_summary
            .files
            .iter()
            .filter(|f| keep_file(f, &mut skipped_binary))
            .map(|f| f.path.clone())
            .collect();
        let filter_list = if req.selected_files.is_empty() {
            non_ignored.clone()
        } else {
            req.selected_files
                .iter()
                .filter(|f| !Self::is_ignored_file(f) && !Self::is_binary_file(f))
                .cloned()
                .collect::<Vec<_>>()
        };
        // If the user selected only ignored/binary files, fall back to all
        // analyzable (non-ignored, non-binary) ones.
        let filter_list = if filter_list.is_empty() {
            non_ignored.clone()
        } else {
            filter_list
        };

        if skipped_binary > 0 {
            log::info!(target: "Bitbucket", "generate_scenarios: excluded {skipped_binary} binary file(s) from scenario generation");
        }

        // Split the diff into per-file sections, keeping only analyzable files.
        let sections: Vec<(String, String)> = Self::split_diff_sections(&raw_diff)
            .into_iter()
            .filter(|(path, _)| filter_list.iter().any(|w| w == path))
            .collect();
        let filtered_diff: String = sections
            .iter()
            .map(|(_, s)| s.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let section_by_path: HashMap<String, String> = sections.iter().cloned().collect();

        // 1. Dependency & Impact Analysis (changelog + binary files excluded)
        Self::emit_generate_progress(app_handle, "impact", "Menganalisis Change Impact...");
        let impact_files: Vec<BitbucketFileChange> = pr_summary
            .files
            .iter()
            .filter(|f| !Self::is_ignored_file(&f.path) && !Self::is_binary_file(&f.path))
            .cloned()
            .collect();
        let impact = ImpactAnalyzer::analyze(&impact_files, &filtered_diff);

        // 2. Existing Test Search & Gap Analysis
        Self::emit_generate_progress(app_handle, "gap", "Memfilter Existing Tests (Gap Analysis)...");
        let gap = GapAnalyzer::analyze(pr_summary.jira_ticket_key.as_deref(), &impact, 0);

        // 3. Always use the Active Model configured in Settings.
        let active_model = if self.config.ollama.model.is_empty() {
            "qwen2.5:7b".to_string()
        } else {
            self.config.ollama.model.clone()
        };

        // 4. Index changed source files into the RAG store (Bitbucket PR
        //    namespace) and retrieve the changed + related chunks for the prompt.
        //    Full code is only fetched/embedded once per PR commit; Force
        //    Re-Analyze reuses the stored chunks within the sliding TTL.
        let namespace = format!(
            "{}:{}:{}",
            pr_summary.project_key, pr_summary.repo_slug, pr_summary.latest_commit_hash
        );
        Self::emit_generate_progress(app_handle, "rag_context", "Mengindeks perubahan kode ke Knowledge Base...");
        let (context_block, covered) = self
            .build_rag_context(
                &rag,
                &ollama,
                &namespace,
                &pr_summary,
                &section_by_path,
                &filter_list,
            )
            .await?;

        let diff_blocks: Vec<&str> = sections
            .iter()
            .filter(|(path, _)| !covered.contains(path))
            .map(|(_, s)| s.as_str())
            .collect();

        let mut prompt = String::new();
        prompt.push_str(&format!("PR Title: {}\n", pr_summary.title));
        prompt.push_str(&format!(
            "Jira Ticket: {}\n",
            pr_summary.jira_ticket_key.as_deref().unwrap_or("None")
        ));
        prompt.push_str(&format!("Impact Summary: {}\n", impact.summary_notes));
        prompt.push_str(&format!(
            "Affected Components: {}\n",
            impact.affected_components.join(", ")
        ));
        if !pr_summary.commit_messages.is_empty() {
            prompt.push_str(
                "\n=== COMMIT MESSAGES (niat perubahan; HANYA petunjuk, bukan ground truth) ===\n",
            );
            prompt.push_str(&pr_summary.commit_messages.join("\n"));
            prompt.push('\n');
        }
        if !context_block.is_empty() {
            prompt.push_str("\n=== CHANGED FILE CONTEXT (retrieved from RAG; lines marked [CHANGED] are the diff) ===\n");
            prompt.push_str(&context_block);
            prompt.push('\n');
        }
        if !diff_blocks.is_empty() {
            prompt.push_str("\n=== RAW DIFF (files without indexed context) ===\n");
            prompt.push_str(&diff_blocks.join("\n"));
        }

        // Re-state the required output shape as the LAST instruction, right
        // after the (possibly large) code context, so small SLM models don't
        // drift toward an unrelated schema by the end of the prompt.
        prompt.push_str("\n\nKeluaran kamu WAJIB berupa satu objek JSON yang hanya memiliki satu kunci \"scenarios\" (array of scenario objects). JANGAN menambahkan kunci lain (mis. \"steps\", \"totalResults\", \"id\", \"class\") di level atas. JANGAN menambahkan teks apa pun selain JSON.");

        let user_prompt = prompt;

        let system_prompt = r#"You are a Senior QA Engineer performing Code Audit & Shift-Left Test Case Generation.

LANGUAGE (important):
- Write ALL scenario text in Bahasa Indonesia: "scenario", "reason", every "preconditions" item, and each step's "action" and "expected".
- Keep "scenarioType" and "riskLevel" as the fixed English values listed below (they are structured categories, not prose).

GROUND RULES (important):
- Generate scenarios ONLY from the provided diff and full-code context. Never invent functions, APIs, variables, classes, or behaviors that are not present in the code.
- Commit messages are hints about developer intent, NOT ground truth. Always verify every scenario against the actual diff / full-code context; never treat a vague or missing commit message as evidence of a feature.
- Every scenario must trace back to an actual change. In the "reason" field, cite the specific file / function / changed line it is based on.
- Keep scenarios VARIED across scenarioType (Positive, Negative, Edge Case, Regression, Security) and riskLevel (High, Medium, Low), but always stay within the actual behavior of the code shown.
- If the changes are trivial (formatting, docs, or very small), return fewer scenarios — or an empty "scenarios" array — with lower confidence instead of fabricating coverage.
- "expected" must be grounded in what the code actually does. Never assert behavior you cannot infer from the diff / full code.
- Confidence uses a 0-100 scale: a scenario directly supported by the diff should be 70-95; reserve 1-5 only for scenarios you are nearly unsure about. Do NOT flatten all confidence values to a tiny number.

Each scenario MUST include:
- scenario: Short descriptive title (Bahasa Indonesia), copied exactly into the output
- filePath: Exact changed-file path this scenario belongs to; choose one path from the provided file context
- confidence: Integer between 0 and 100. 1 means "almost no confidence"; a scenario that is clearly grounded in the diff must be 70-95. NEVER use a value <= 5 for a valid scenario.
- reason: Clear explanation of why this scenario is critical based on code changes (Bahasa Indonesia, cite file/function/line)
- scenarioType: "Positive", "Negative", "Edge Case", "Regression", or "Security"
- riskLevel: "High", "Medium", or "Low"
- preconditions: Array of string preconditions (Bahasa Indonesia)
- steps: Array of {"step": number, "action": string, "expected": string} (action & expected in Bahasa Indonesia)

Output JSON format:
{
  "scenarios": [
     {
       "scenario": "Validasi pembalikan pembayaran",
       "filePath": "src/payment/PaymentService.java",
      "confidence": 92,
      "reason": "Logika bisnis diubah di PaymentService (src/payment/PaymentService.java:40)",
      "scenarioType": "Negative",
      "riskLevel": "High",
      "preconditions": ["Sesi pengguna aktif"],
      "steps": [
        {"step": 1, "action": "Kirim payload tidak valid", "expected": "Sistem mengembalikan kode error 400"}
      ]
    }
  ]
}"#;

        let empty_history: Vec<ChatHistoryMessage> = vec![];
        log::info!(target: "Bitbucket", "generate_scenarios: calling Ollama with active model '{}'", active_model);

        // Correction prompt used when the model's first response is not valid
        // scenario JSON. It is intentionally short and forceful: small SLM
        // models tend to echo an unrelated schema (e.g. a "steps"/"id"/"class"
        // shape), so we forbid those keys and demand ONLY the exact template.
        let retry_system_prompt = format!(
            "{system_prompt}\n\nINSTRUKSI KOREKSI WAJIB: Output kamu sebelumnya SALAH. Kamu HARUS mengembalikan JSON objek yang hanya memiliki SATU kunci 'scenarios' yang berisi array. Setiap item WAJIB memiliki scenario, filePath, confidence, reason, scenarioType, riskLevel, preconditions, dan steps. filePath HARUS persis salah satu path file yang diberikan. Field reason, preconditions, steps, action, dan expected boleh kosong, tetapi field-fieldnya tetap harus ada. DILARANG memakai kunci 'id', 'class', 'totalResults', 'sql_script' pada level atas. DILARANG menambahkan teks lain. Hanya output JSON."
        );

        // 4. Extract scenarios from the model response (robust JSON extraction).
        //    The model is constrained by an Ollama JSON Schema (schema version
        //    SCENARIO_SCHEMA_VERSION), retrying up to 2 more times with a
        //    forceful format-only correction and lower temperature.
        let schema = scenario_schema();
        let mut scenarios: Vec<BitbucketTestScenario> = Vec::new();
        for attempt in 0..3 {
            let (sp, temp) = if attempt == 0 {
                (system_prompt.as_ref(), None)
            } else {
                (retry_system_prompt.as_str(), Some(0.2_f64))
            };
            Self::emit_generate_progress(
                app_handle,
                "calling_ai",
                format!("Menghasilkan skenario dengan AI (percobaan {}/3)...", attempt + 1),
            );
            let ai_raw_response = ollama
                .chat_json_schema(
                    sp,
                    &user_prompt,
                    &empty_history,
                    temp,
                    Some(&active_model),
                    &schema,
                    None,
                )
                .await
                .unwrap_or_else(|| "{ \"scenarios\": [] }".to_string());

            match Self::parse_scenarios_from_ai(&ai_raw_response) {
                Ok(list) if !list.is_empty() => {
                    scenarios = list;
                    break;
                }
                Ok(_) => log::warn!(
                    target: "Bitbucket",
                    "generate_scenarios: attempt {} produced 0 scenarios, retrying with correction",
                    attempt + 1
                ),
                Err(e) => log::warn!(
                    target: "Bitbucket",
                    "generate_scenarios: attempt {} failed schema validation ({e}), retrying with correction",
                    attempt + 1
                ),
            }
        }

        // 5. Duplicate Filtering & Risk Ranking
        let unique_scenarios = GapAnalyzer::filter_duplicates(scenarios);
        log::info!(
            target: "Bitbucket",
            "generate_scenarios: {} scenarios generated for {} (confidence: {:?})",
            unique_scenarios.len(),
            pr_summary.title,
            unique_scenarios.iter().map(|s| s.confidence).collect::<Vec<_>>()
        );

        let response = BitbucketGenerateResponse {
            pr_id: pr_summary.pr_id,
            commit_hash: pr_summary.latest_commit_hash,
            cache_hit: false,
            impact,
            gap,
            scenarios: unique_scenarios,
        };

        // Cache only non-empty results: an empty / malformed generation is a
        // failure, and caching it would surface the same bad result for 30
        // minutes without ever calling the model again.
        if !response.scenarios.is_empty() {
            get_global_bitbucket_cache().set(&cache_key, response.clone());
        } else {
            log::warn!(target: "Bitbucket", "generate_scenarios: 0 scenarios — result NOT cached so a retry can regenerate");
        }

        Self::emit_generate_progress(app_handle, "done", "Selesai.");
        Ok(response)
    }

    /// Create a Jira/Xray "Test" issue for each selected scenario (title,
    /// steps and expected result carried over from the AI-generated
    /// scenario), then optionally move all successfully-created issues into
    /// the chosen Xray Test Repository folder. Mirrors the BRD generator's
    /// `sync_test_cases_to_jira`, minus the local JSON store bookkeeping
    /// (Bitbucket scenarios aren't persisted server-side between calls —
    /// the frontend sends back exactly the scenarios the user selected).
    pub async fn sync_scenarios_to_jira(
        &self,
        req: &BitbucketSyncScenariosRequest,
    ) -> Result<Vec<(String, bool, Option<String>, Option<String>)>, String> {
        if req.scenarios.is_empty() {
            return Err("Tidak ada skenario yang dipilih.".to_string());
        }

        let jira = crate::services::jira::JiraService::new();
        let mut jira_cfg = self.config.jira.clone();
        if !req.project_key.is_empty() {
            jira_cfg.project_key = req.project_key.clone();
        }

        let assignee_account_id: Option<String> = match jira.client(&jira_cfg) {
            Ok(client) => match client.get_current_user().await {
                Ok(user) => user["accountId"].as_str().map(str::to_string),
                Err(_) => None,
            },
            Err(_) => None,
        };

        // (scenario title, success, jira_key, error)
        let mut results: Vec<(String, bool, Option<String>, Option<String>)> = Vec::new();
        let mut synced_keys: Vec<String> = Vec::new();

        for sc in &req.scenarios {
            let steps_lines: String = sc
                .steps
                .iter()
                .map(|s| format!("{}. {}", s.step, s.action))
                .collect::<Vec<_>>()
                .join("\n");
            let expected_lines: String = sc
                .steps
                .iter()
                .map(|s| format!("{}. {}", s.step, s.expected))
                .collect::<Vec<_>>()
                .join("\n");
            let preconditions = sc.preconditions.join("\n");
            let mut description = String::new();
            if !preconditions.is_empty() {
                description.push_str(&format!("Preconditions\n{preconditions}\n\n"));
            }
            description.push_str(&format!("Test Steps\n{steps_lines}\n\nExpected Result\n{expected_lines}"));

            let mut fields = serde_json::json!({
                "project":   { "key": jira_cfg.project_key },
                "summary":   sc.scenario,
                "issuetype": { "name": "Test" },
                "description": description,
                "labels": [sc.scenario_type.clone()],
            });
            if let Some(ref account_id) = assignee_account_id {
                fields["assignee"] = serde_json::json!({ "accountId": account_id });
            }
            let body = serde_json::json!({ "fields": fields });

            match jira.client(&jira_cfg) {
                Err(e) => results.push((sc.scenario.clone(), false, None, Some(format!("Client error: {e}")))),
                Ok(client) => match client.api.post_json("/issue", &body).await {
                    Ok(resp) => {
                        let key = resp["key"].as_str().unwrap_or("").to_string();
                        synced_keys.push(key.clone());
                        results.push((sc.scenario.clone(), true, Some(key), None));
                    }
                    Err(e) => results.push((sc.scenario.clone(), false, None, Some(e.to_string()))),
                },
            }
        }

        if let Some(fp) = req.folder_path.as_deref() {
            if !fp.is_empty() && !synced_keys.is_empty() {
                if let Ok(client) = jira.client(&jira_cfg) {
                    if let Err(e) = client.move_tests_to_folder(&jira_cfg.project_key, fp, &synced_keys).await {
                        log::warn!(target: "Bitbucket", "sync_scenarios_to_jira: folder assignment failed (non-fatal): {e}");
                    }
                }
            }
        }

        Ok(results)
    }

    /// Explain what a piece of Bitbucket PR code does, in plain language for a
    /// non-technical audience. Uses the RAG-indexed code context for the PR and
    /// caches results per namespace:file:lines:mode:model.
    pub async fn explain_bitbucket_code(
        &self,
        req: BitbucketExplainRequest,
        ollama: OllamaClient,
        rag: RagService,
    ) -> Result<BitbucketExplainResponse, String> {
        // #7: friendly guard when Bitbucket isn't configured.
        if self.config.bitbucket.base_url.trim().is_empty() {
            return Err(
                "Bitbucket belum dikonfigurasi. Isi URL Bitbucket di Settings terlebih dahulu."
                    .to_string(),
            );
        }

        let pr_summary = self.fetch_pr_details(&req.pr_url_or_id).await?;
        let namespace = format!(
            "{}:{}:{}",
            pr_summary.project_key, pr_summary.repo_slug, pr_summary.latest_commit_hash
        );
        let mode = if req.mode.trim().is_empty() {
            "simple".to_string()
        } else {
            req.mode.trim().to_string()
        };

        let cache_key = BitbucketExplainCacheService::make_key(
            &namespace,
            &req.file_path,
            req.start_line,
            req.end_line,
            &mode,
            &self.config.ollama.model,
        );
        // #10: skip cache when force_refresh is set.
        if !req.force_refresh {
            if let Some(cached) = get_global_bitbucket_explain_cache().get(&cache_key) {
                log::info!(target: "Bitbucket", "explain_bitbucket_code: cache hit for {cache_key}");
                return Ok(cached);
            }
        }

        // #2: the file must be part of this PR's changes.
        if !pr_summary.files.iter().any(|f| f.path == req.file_path) {
            return Err(format!(
                "File '{}' tidak ditemukan dalam perubahan PR ini. Pilih file dari daftar yang berubah.",
                req.file_path
            ));
        }

        // #5: if the RAG namespace already has chunks (e.g. from a prior
        // scenario generation), reuse it and skip re-fetching the diff.
        let existing_namespace = rag.chunks_by_source_id("bitbucket", &namespace);
        let mut section_by_path: HashMap<String, String> = HashMap::new();

        if existing_namespace.is_empty() {
            let raw_diff = self
                .fetch_raw_diff(
                    &pr_summary.project_key,
                    &pr_summary.repo_slug,
                    pr_summary.pr_id,
                )
                .await?;
            let sections: Vec<(String, String)> = Self::split_diff_sections(&raw_diff)
                .into_iter()
                .filter(|(p, _)| !Self::is_ignored_file(p) && !Self::is_binary_file(p))
                .collect();
            section_by_path = sections.iter().cloned().collect();
            // Index all analyzable text files from the authoritative PR changes
            // list (not just those whose diff section survived truncation), so
            // new/large files are never dropped.
            let filter_list: Vec<String> = pr_summary
                .files
                .iter()
                .filter(|f| !Self::is_ignored_file(&f.path) && !Self::is_binary_file(&f.path))
                .map(|f| f.path.clone())
                .collect();
            self.ensure_rag_indexed(
                &rag,
                &ollama,
                &namespace,
                &pr_summary,
                &section_by_path,
                &filter_list,
            )
            .await?;
        }

        // Retrieve context for the requested file.
        let chunks = rag.chunks_by_source_id("bitbucket", &namespace);
        let mut file_chunks: Vec<VectorChunk> = chunks
            .into_iter()
            .filter(|c| {
                c.code
                    .as_ref()
                    .map(|m| m.file_path == req.file_path)
                    .unwrap_or(false)
            })
            .collect();
        file_chunks.sort_by_key(|c| c.code.as_ref().map(|m| m.start_line).unwrap_or(0));

        let context: String;
        let covered_range: String;

        if file_chunks.is_empty() {
            // Fallback: fetch the file directly at the PR head commit, bounded
            // to the requested range (or a cap) to keep the prompt small.
            let client = self.create_client()?;
            let base_url = self
                .config
                .bitbucket
                .base_url
                .trim_end_matches('/')
                .to_string();
            let content = Self::fetch_file_content_impl(
                &client,
                &base_url,
                &pr_summary.project_key,
                &pr_summary.repo_slug,
                &req.file_path,
                &pr_summary.latest_commit_hash,
            )
            .await?;
            let changed = section_by_path
                .get(&req.file_path)
                .map(|s| Self::parse_changed_line_numbers(s))
                .unwrap_or_default();
            let (range, rendered) = Self::build_file_context_window(
                &req.file_path,
                &content,
                &changed,
                req.start_line,
                req.end_line,
                MAX_EXPLAIN_FALLBACK_LINES,
            );
            covered_range = range;
            context = rendered;
        } else {
            // #6: if the requested line range filters out every chunk, fall
            // back to all chunks for the file instead of failing.
            if let (Some(s), Some(e)) = (req.start_line, req.end_line) {
                let filtered: Vec<VectorChunk> = file_chunks
                    .iter()
                    .filter(|c| {
                        c.code
                            .as_ref()
                            .map(|m| m.end_line >= s && m.start_line <= e)
                            .unwrap_or(false)
                    })
                    .cloned()
                    .collect();
                if !filtered.is_empty() {
                    file_chunks = filtered;
                }
            }
            // Render the file's chunks into context, bounded so a very large
            // (e.g. newly-added) file can't overflow the model's context window.
            // Chunks containing changed lines plus their neighbours are
            // prioritised, then the rest in line order up to the cap.
            let (range, rendered) = Self::render_explain_chunks(&file_chunks);
            covered_range = range;
            context = rendered;
            let _ = rag.touch_bitbucket(&namespace);
        }

        if context.trim().is_empty() {
            return Err(format!(
                "Tidak ada konteks kode untuk file {}.",
                req.file_path
            ));
        }

        // Active model from Settings.
        let active_model = if self.config.ollama.model.is_empty() {
            "qwen2.5:7b".to_string()
        } else {
            self.config.ollama.model.clone()
        };

        let system_prompt = Self::explain_system_prompt(&mode);
        let user_prompt = format!(
            "PR Title: {}\nJira Ticket: {}\nFile: {}\nLines: {}\nMode: {}\n\n=== CODE CONTEXT ===\n{}\n\nJelaskan kode di atas sesuai mode dan format yang diminta.",
            pr_summary.title,
            pr_summary.jira_ticket_key.as_deref().unwrap_or("None"),
            req.file_path,
            covered_range,
            mode,
            context
        );

        let empty_history: Vec<ChatHistoryMessage> = vec![];
        log::info!(target: "Bitbucket", "explain_bitbucket_code: calling Ollama with active model '{}' (mode {mode})", active_model);

        // Request the model to emit strict JSON; retry once with a sharp
        // reminder if the first attempt doesn't parse as valid JSON.
        let mut ai_raw = ollama
            .chat_json(
                &system_prompt,
                &user_prompt,
                &empty_history,
                None,
                Some(&active_model),
            )
            .await
            .unwrap_or_default();
        log::info!(target: "Bitbucket", "explain_bitbucket_code: raw Ollama response (attempt 1): {}", ai_raw);

        let parsed = match Self::parse_explain_response(&ai_raw) {
            Ok(p) => p,
            Err(_) => {
                let retry_prompt = format!(
                    "{user_prompt}\n\n[PENTING RETRY] Respons sebelumnya salah: (1) kamu meng-echo/menyalin isi kode alih-alih menjelaskannya, dan/atau (2) kamu memakai Bahasa Inggris. WAJIB gunakan Bahasa Indonesia untuk seluruh field. LARANGAN: JANGAN salin, ulang, atau parse isi kode/SQL/XML apa pun. HANYA keluarkan satu objek JSON penjelasan dengan skema berikut: {{\"title\":\"Judul dalam Bahasa Indonesia\",\"summary\":\"Ringkasan dalam Bahasa Indonesia\",\"purpose\":\"Tujuan\",\"simpleFlow\":[],\"inputs\":[],\"outputs\":[],\"businessImpact\":\"Dampak\",\"risks\":[],\"technicalTerms\":[],\"evidence\":[],\"confidence\":90,\"unknowns\":[]}}. Tidak ada teks lain di luar objek JSON."
                );
                ai_raw = ollama
                    .chat_json(
                        &system_prompt,
                        &retry_prompt,
                        &empty_history,
                        None,
                        Some(&active_model),
                    )
                    .await
                    .unwrap_or_else(|| "{}".to_string());
                log::info!(target: "Bitbucket", "explain_bitbucket_code: raw Ollama response (attempt 2): {}", ai_raw);
                Self::parse_explain_response(&ai_raw)?
            }
        };
        log::info!(target: "Bitbucket", "explain_bitbucket_code: parsed title='{}' summary='{}' confidence={}", parsed.title, parsed.summary, parsed.confidence);

        get_global_bitbucket_explain_cache().set(&cache_key, parsed.clone());
        Ok(parsed)
    }

    /// System prompt for the AI Code Explainer (Bahasa Indonesia, grounded,
    /// mode-aware).
    fn explain_system_prompt(mode: &str) -> String {
        let mode_instruction = match mode {
            "technical" => {
                "MODE technical: jelaskan untuk developer QA. Sebutkan function, class, API, dan dependency yang relevan. Ringkas dan teknis."
            }
            "impact" => {
                "MODE impact: fokus pada perubahan PR. Jelaskan apa yang berubah, kenapa berubah, dampak ke modul lain, dan risiko yang relevan."
            }
            _ => {
                "MODE simple: jelaskan ke orang yang tidak paham IT. Gunakan bahasa sehari-hari, hindari jargon; istilah teknis masukkan ke technicalTerms dengan penjelasan sederhana."
            }
        };

        format!(
            r#"Kamu adalah mentor QA/engineering yang menjelaskan kode kepada orang yang tidak paham IT. Semua jawaban dalam Bahasa Indonesia yang sederhana dan mudah dipahami.

BAHASA (WAJIB):
- Seluruh isi output HARUS dalam Bahasa Indonesia. Dilarang memakai Bahasa Inggris untuk field apa pun (title, summary, purpose, simpleFlow, inputs, outputs, businessImpact, risks, technicalTerms.term, technicalTerms.explanation, evidence.reason, unknowns). Istilah teknis boleh ditulis dalam bahasa aslinya, tetapi penjelasannya wajib Bahasa Indonesia.

LARANGAN PALING PENTING:
- JANGAN PERNAH menyalin, meng-echo, mengulang, atau meng-parse isi kode/SQL/XML dari "CODE CONTEXT" ke dalam output. JANGAN sertakan sqlScript, CDATA, XML, tag, atau baris kode apa pun dalam output.
- Output-mu HANYA berupa objek JSON penjelasan sesuai skema di bawah. Tidak ada teks lain di luar objek JSON.

ATURAN (PENTING):
- Jelaskan HANYA berdasarkan kode dalam "CODE CONTEXT" dan diff yang tersedia. JANGAN mengarang fitur, API, database, business rule, atau perilaku yang tidak ada di kode.
- Bedakan fakta yang terlihat di kode vs interpretasi. Jika tidak yakin, tulis "Tidak dapat dipastikan dari kode yang tersedia".
- Setiap pernyataan penting harus disertai evidence (file + nomor baris) yang sesuai di field "evidence".
- Jangan menyatakan kode "aman", "benar", atau "berkinerja baik" tanpa bukti.
- Jika konteks tidak cukup, isi field "unknowns".

{mode_instruction}

Output JSON dengan skema berikut:
{{
  "title": "Judul singkat dalam Bahasa Indonesia",
  "summary": "Ringkasan 2-3 kalimat fungsi kode ini dalam Bahasa Indonesia",
  "purpose": "Masalah yang diselesaikan kode ini",
  "simpleFlow": ["Langkah 1", "Langkah 2"],
  "inputs": ["input"],
  "outputs": ["output"],
  "businessImpact": "Dampak bisnis",
  "risks": ["risiko"],
  "technicalTerms": [{{"term": "istilah", "explanation": "penjelasan sederhana dalam Bahasa Indonesia"}}],
  "evidence": [{{"file": "path", "lines": "42-68", "reason": "alasan dalam Bahasa Indonesia"}}],
  "confidence": 90,
  "unknowns": []
}}"#,
            mode_instruction = mode_instruction
        )
    }

    /// Parse the structured explanation from the model's JSON response.
    /// Fails (triggering a retry) both when the response isn't JSON and when it
    /// is JSON but isn't an actual explanation (e.g. the model echoed the code).
    fn parse_explain_response(raw: &str) -> Result<BitbucketExplainResponse, String> {
        let value = crate::services::text_utils::extract_json_block(raw)
            .ok_or_else(|| "Model response was not valid JSON".to_string())?;
        let parsed = serde_json::from_value::<BitbucketExplainResponse>(value)
            .map_err(|e| format!("Gagal mem-parsing hasil penjelasan: {e}"))?;
        if parsed.title.trim().is_empty() && parsed.summary.trim().is_empty() {
            return Err(
                "Model response is valid JSON but contains no explanation (echo of the input code)"
                    .to_string(),
            );
        }
        Ok(parsed)
    }

    /// Render a whole-file context with absolute line numbers, bounded to a
    /// line window when a range is provided (or to `max_lines` when it is not),
    /// so the fallback doesn't blow up the prompt for large files.
    /// Returns `(covered_range, rendered)`.
    fn build_file_context_window(
        path: &str,
        content: &str,
        changed_lines: &HashSet<usize>,
        start: Option<usize>,
        end: Option<usize>,
        max_lines: usize,
    ) -> (String, String) {
        let lines: Vec<(usize, &str)> = content
            .lines()
            .enumerate()
            .map(|(i, l)| (i + 1, l))
            .collect();
        if lines.is_empty() {
            return (String::new(), format!("### File: {path}\n(empty file)\n"));
        }

        let total = lines.len();
        // Determine the window (with a little surrounding context).
        let (lo, hi) = match (start, end) {
            (Some(s), Some(e)) if e >= s => {
                let lo = s.saturating_sub(10);
                let hi = std::cmp::min(e + 10, total);
                (lo, hi)
            }
            _ => (1, std::cmp::min(total, max_lines)),
        };

        let mut out = String::new();
        out.push_str(&format!("### File: {path} (lines {lo}-{hi})\n"));
        for (no, line) in lines.iter() {
            if *no < lo || *no > hi {
                continue;
            }
            let marker = if changed_lines.contains(no) {
                "[CHANGED] "
            } else {
                ""
            };
            out.push_str(&format!("{marker}{no}: {line}\n"));
        }
        if hi < total {
            out.push_str(&format!(
                "... (sisa baris {}-{} dipotong untuk performa)\n",
                hi + 1,
                total
            ));
        }

        let covered_range = format!("{lo}-{hi}");
        (covered_range, out)
    }

    /// Files that shouldn't produce test scenarios (documentation / release
    /// notes such as CHANGELOG).
    fn is_ignored_file(path: &str) -> bool {
        let lower = path.to_lowercase();
        lower.contains("changelog")
    }

    /// Detect binary files by extension — their contents can't be analyzed
    /// from a diff, so they're excluded from scenario generation entirely.
    fn is_binary_file(path: &str) -> bool {
        let lower = path.to_lowercase();
        let ext = lower.rsplit('.').next().unwrap_or("");
        matches!(
            ext,
            "jar"
                | "class"
                | "war"
                | "ear"
                | "aar"
                | "apk"
                | "dex"
                | "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "bmp"
                | "ico"
                | "svgz"
                | "avif"
                | "pdf"
                | "zip"
                | "gz"
                | "tgz"
                | "bz2"
                | "xz"
                | "7z"
                | "rar"
                | "tar"
                | "exe"
                | "dll"
                | "so"
                | "dylib"
                | "bin"
                | "dat"
                | "obj"
                | "o"
                | "a"
                | "lib"
                | "woff"
                | "woff2"
                | "ttf"
                | "eot"
                | "otf"
                | "xlsx"
                | "xls"
                | "docx"
                | "doc"
                | "pptx"
                | "ppt"
                | "mp4"
                | "mp3"
                | "wav"
                | "ogg"
                | "mov"
                | "avi"
                | "mkv"
                | "webm"
        )
    }

    /// Keep only the per-file sections of a unified diff whose path is in
    /// `selected`. An empty selection returns the whole diff unchanged.
    fn filter_diff_by_files(raw_diff: &str, selected: &[String]) -> String {
        if selected.is_empty() {
            return raw_diff.to_string();
        }
        let wanted: HashSet<String> = selected
            .iter()
            .map(|s| s.trim_start_matches('/').to_string())
            .collect();
        let kept: Vec<String> = Self::split_diff_sections(raw_diff)
            .into_iter()
            .filter(|(path, _)| wanted.contains(path))
            .map(|(_, section)| section)
            .collect();
        kept.join("\n")
    }

    /// Split a unified diff into per-file `(path, section)` pairs based on the
    /// `diff --git` markers. Paths containing spaces survive (uses the last
    /// " b/" segment).
    fn split_diff_sections(raw_diff: &str) -> Vec<(String, String)> {
        let mut sections = Vec::new();
        let mut current = String::new();
        let mut current_path = String::new();
        for line in raw_diff.lines() {
            if line.starts_with("diff --git ") {
                if !current.is_empty() {
                    sections.push((current_path.clone(), current.trim_end().to_string()));
                    current.clear();
                }
                let header = line.trim_start_matches("diff --git ");
                current_path = header
                    .rfind(" b/")
                    .map(|i| header[i + 3..].to_string())
                    .unwrap_or_default();
                current = line.to_string();
            } else {
                current.push('\n');
                current.push_str(line);
            }
        }
        if !current.is_empty() {
            sections.push((current_path.clone(), current.trim_end().to_string()));
        }
        sections
    }

    /// Parse the new-file line numbers that were added (`+` lines) from a diff
    /// section — used to highlight the changed lines in the full file context.
    fn parse_changed_line_numbers(section: &str) -> HashSet<usize> {
        let mut changed = HashSet::new();
        let hunk_re = regex::Regex::new(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@").unwrap();
        let mut new_line: Option<usize> = None;
        for line in section.lines() {
            // Skip file headers and "no newline at end of file" markers.
            if line.starts_with("+++") || line.starts_with("---") || line.starts_with('\\') {
                continue;
            }
            if let Some(caps) = hunk_re.captures(line) {
                new_line = caps.get(2).and_then(|m| m.as_str().parse::<usize>().ok());
                continue;
            }
            let Some(current) = new_line else { continue };
            if let Some(rest) = line.strip_prefix('+') {
                let _ = rest;
                changed.insert(current);
                new_line = Some(current + 1);
            } else if line.starts_with(' ') {
                // Context lines exist in the new file too.
                new_line = Some(current + 1);
            }
            // '-' (removed) lines don't advance the new-file line counter.
        }
        changed
    }

    /// Extensions we treat as analyzable source/text for full-code context.
    fn is_text_file(path: &str) -> bool {
        let lower = path.to_lowercase();
        let ext = lower.rsplit('.').next().unwrap_or("");
        matches!(
            ext,
            "java"
                | "kt"
                | "kts"
                | "scala"
                | "groovy"
                | "py"
                | "pyi"
                | "go"
                | "rs"
                | "ts"
                | "tsx"
                | "js"
                | "jsx"
                | "mjs"
                | "cjs"
                | "vue"
                | "svelte"
                | "php"
                | "rb"
                | "pl"
                | "lua"
                | "c"
                | "h"
                | "cpp"
                | "hpp"
                | "cc"
                | "cxx"
                | "cs"
                | "swift"
                | "m"
                | "mm"
                | "sql"
                | "sh"
                | "bash"
                | "zsh"
                | "ps1"
                | "bat"
                | "cmd"
                | "xml"
                | "yml"
                | "yaml"
                | "json"
                | "json5"
                | "properties"
                | "toml"
                | "ini"
                | "cfg"
                | "conf"
                | "gradle"
                | "gradlew"
                | "makefile"
                | "dockerfile"
                | "dockerignore"
                | "gitignore"
                | "md"
                | "markdown"
                | "txt"
                | "rst"
                | "adoc"
                | "html"
                | "htm"
                | "css"
                | "scss"
                | "sass"
                | "less"
                | "graphql"
                | "proto"
                | "tf"
                | "hcl"
        )
    }

    /// Ensure the PR's changed source files are indexed into the RAG store
    /// (Bitbucket namespace `project:repo:commit`). Reuses the existing
    /// namespace within its sliding TTL, otherwise fetches and embeds the
    /// changed text files. Also prunes expired Bitbucket chunks (lazy cleanup).
    async fn ensure_rag_indexed(
        &self,
        rag: &RagService,
        ollama: &OllamaClient,
        namespace: &str,
        pr_summary: &BitbucketDiffSummary,
        section_by_path: &HashMap<String, String>,
        filter_list: &[String],
    ) -> Result<(), String> {
        // Lazy cleanup of expired Bitbucket code chunks.
        if let Ok(pruned) = rag.prune_expired_bitbucket() {
            if pruned > 0 {
                log::info!(target: "Bitbucket", "ensure_rag_indexed: pruned {pruned} expired Bitbucket chunk(s)");
            }
        }

        // Change type per file (ADD / MODIFY / DELETE) from the authoritative
        // PR changes API, so new (large) files are handled correctly even when
        // their diff section is truncated or missing.
        let change_type_by_path: HashMap<String, String> = pr_summary
            .files
            .iter()
            .map(|f| (f.path.clone(), f.change_type.clone()))
            .collect();

        // Index every analyzable text file in the PR, not just those whose diff
        // section appeared within the (possibly truncated) raw diff. Deleted
        // files naturally fail the content fetch below and are skipped.
        let indexable: Vec<&String> = filter_list
            .iter()
            .filter(|p| Self::is_text_file(p))
            .collect();

        let existing = rag.chunks_by_source_id("bitbucket", namespace);
        if !existing.is_empty() {
            let _ = rag.touch_bitbucket(namespace);
            return Ok(());
        }
        if indexable.is_empty() {
            return Ok(());
        }

        log::info!(target: "Bitbucket", "ensure_rag_indexed: indexing {} file(s) into RAG namespace {namespace}", indexable.len());
        let client = std::sync::Arc::new(self.create_client()?);
        let base_url = self
            .config
            .bitbucket
            .base_url
            .trim_end_matches('/')
            .to_string();
        let now = chrono::Utc::now();
        let expires = now + chrono::Duration::seconds(BITBUCKET_TTL_SECS as i64);
        let mut indexed_chunks = 0usize;

        for path in &indexable {
            let content = match Self::fetch_file_content_impl(
                &client,
                &base_url,
                &pr_summary.project_key,
                &pr_summary.repo_slug,
                path,
                &pr_summary.latest_commit_hash,
            )
            .await
            {
                Ok(c) => c,
                Err(_) => continue, // deleted / unreadable -> raw diff fallback
            };
            if content.trim().is_empty() {
                continue;
            }
            let is_add = change_type_by_path.get(*path).map(String::as_str) == Some("ADD");
            let changed = if is_add || section_by_path.get(*path).is_none() {
                // New file (full content in the diff) or diff section
                // unavailable/truncated: treat every line as changed so the
                // whole file is surfaced as context and nothing is missed.
                (1..=content.lines().count()).collect()
            } else {
                section_by_path
                    .get(*path)
                    .map(|s| Self::parse_changed_line_numbers(s))
                    .unwrap_or_default()
            };
            let chunks = code_chunks(&content, &changed, CODE_CHUNK_LINES, CODE_CHUNK_OVERLAP);
            for (start, end, body, changed_in) in chunks {
                let embedding = ollama
                    .embed(&body, Some(CODE_EMBEDDING_MODEL))
                    .await
                    .unwrap_or_default();
                let browse = format!(
                    "{}/projects/{}/repos/{}/browse/{}",
                    base_url,
                    pr_summary.project_key,
                    pr_summary.repo_slug,
                    Self::encode_path_segments(path)
                );
                rag.upsert_chunk(VectorChunk {
                    id: format!("bb:{namespace}:{path}:{start}"),
                    source: "bitbucket".into(),
                    source_id: namespace.to_string(),
                    container_id: Some(format!(
                        "{}:{}",
                        pr_summary.project_key, pr_summary.repo_slug
                    )),
                    source_title: path.to_string(),
                    source_url: browse,
                    content: body,
                    embedding,
                    indexed_at: now.to_rfc3339(),
                    code: Some(CodeChunkMeta {
                        repo: format!("{}:{}", pr_summary.project_key, pr_summary.repo_slug),
                        commit: pr_summary.latest_commit_hash.clone(),
                        file_path: path.to_string(),
                        start_line: start,
                        end_line: end,
                        changed_lines: changed_in,
                    }),
                    expires_at: Some(expires.to_rfc3339()),
                    last_used_at: Some(now.to_rfc3339()),
                })
                .map_err(|e| e.to_string())?;
                indexed_chunks += 1;
            }
        }
        log::info!(target: "Bitbucket", "ensure_rag_indexed: indexed {indexed_chunks} chunk(s) for namespace {namespace}");
        let _ = rag.record_sync("bitbucket", &now.to_rfc3339());
        Ok(())
    }

    /// Index the changed source files of a PR into the RAG store (Bitbucket
    /// namespace `project:repo:commit`) and retrieve the chunks needed for the
    /// scenario prompt: every chunk containing changed lines + immediate
    /// neighbours + top semantic matches. Returns the rendered context block
    /// and the set of files covered by indexed context (whose raw diff is then
    /// omitted from the prompt).
    async fn build_rag_context(
        &self,
        rag: &RagService,
        ollama: &OllamaClient,
        namespace: &str,
        pr_summary: &BitbucketDiffSummary,
        section_by_path: &HashMap<String, String>,
        filter_list: &[String],
    ) -> Result<(String, HashSet<String>), String> {
        // Ensure the PR's changed source files are indexed into RAG (or reuse
        // the existing namespace within its sliding TTL).
        self.ensure_rag_indexed(
            rag,
            ollama,
            namespace,
            pr_summary,
            section_by_path,
            filter_list,
        )
        .await?;

        let all = rag.chunks_by_source_id("bitbucket", namespace);
        if all.is_empty() {
            return Ok((String::new(), HashSet::new()));
        }

        let mut selected: Vec<VectorChunk> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();

        // 1) Always include every chunk that contains changed lines, plus the
        //    chunk immediately before/after it, grouped per file.
        for path in filter_list {
            let mut file_chunks: Vec<VectorChunk> = all
                .iter()
                .filter(|c| {
                    c.code
                        .as_ref()
                        .map(|m| &m.file_path == path)
                        .unwrap_or(false)
                })
                .cloned()
                .collect();
            if file_chunks.is_empty() {
                continue;
            }
            file_chunks.sort_by_key(|c| c.code.as_ref().map(|m| m.start_line).unwrap_or(0));
            let mut chosen: Vec<usize> = Vec::new();
            for (i, c) in file_chunks.iter().enumerate() {
                if c.code
                    .as_ref()
                    .map(|m| !m.changed_lines.is_empty())
                    .unwrap_or(false)
                {
                    chosen.push(i);
                    if i > 0 {
                        chosen.push(i - 1);
                    }
                    if i + 1 < file_chunks.len() {
                        chosen.push(i + 1);
                    }
                }
            }
            chosen.sort_unstable();
            chosen.dedup();
            for i in chosen {
                let c = &file_chunks[i];
                if seen.insert(c.id.clone()) {
                    selected.push(c.clone());
                }
            }
        }

        // 2) Top semantic matches within this PR namespace (related context).
        let query = format!(
            "{} {} changed files: {}",
            pr_summary.title,
            pr_summary.jira_ticket_key.as_deref().unwrap_or(""),
            filter_list.join(", ")
        );
        if !query.trim().is_empty() {
            if let Ok(emb) = ollama.embed(&query, Some(CODE_EMBEDDING_MODEL)).await {
                let semantic = rag.search_in_source(&emb, 6, "bitbucket", namespace);
                for c in semantic {
                    if selected.len() >= MAX_RETRIEVED_CHUNKS {
                        break;
                    }
                    if seen.insert(c.id.clone()) {
                        selected.push(c);
                    }
                }
            }
        }

        // 3) Render the selected chunks.
        let mut covered: HashSet<String> = HashSet::new();
        let mut block = String::new();
        let mut count = 0usize;
        for c in &selected {
            if count >= MAX_RETRIEVED_CHUNKS {
                break;
            }
            if let Some(meta) = c.code.as_ref() {
                block.push_str(&Self::render_rag_chunk(c));
                covered.insert(meta.file_path.clone());
                count += 1;
            }
        }
        log::info!(target: "Bitbucket", "build_rag_context: {count} chunk(s) retrieved for namespace {namespace}");
        Ok((block, covered))
    }

    /// Render one RAG code chunk with absolute line numbers; lines changed by
    /// the PR are prefixed with `[CHANGED]`.
    fn render_rag_chunk(chunk: &VectorChunk) -> String {
        let mut out = String::new();
        let Some(meta) = chunk.code.as_ref() else {
            return out;
        };
        out.push_str(&format!(
            "### File: {} (lines {}-{})\n",
            meta.file_path, meta.start_line, meta.end_line
        ));
        let mut line_no = meta.start_line;
        for line in chunk.content.lines() {
            let marker = if meta.changed_lines.contains(&line_no) {
                "[CHANGED] "
            } else {
                ""
            };
            out.push_str(&format!("{marker}{line_no}: {line}\n"));
            line_no += 1;
        }
        out
    }

    /// Render up to `MAX_RETRIEVED_CHUNKS` chunks for the AI Code Explainer,
    /// guaranteeing chunks that contain changed lines plus their immediate
    /// neighbours are always included, then filling the remaining budget with
    /// the earliest chunks in line order. Returns the rendered context and the
    /// actual covered line range. This bounds the prompt size for very large
    /// (e.g. newly-added) files without sending a truncated blob to the model.
    fn render_explain_chunks(chunks: &[VectorChunk]) -> (String, String) {
        if chunks.is_empty() {
            return (String::new(), String::new());
        }
        let mut selected: HashSet<usize> = HashSet::new();
        // Priority 1: chunks containing changed lines + immediate neighbours.
        for (i, c) in chunks.iter().enumerate() {
            if c.code
                .as_ref()
                .map(|m| !m.changed_lines.is_empty())
                .unwrap_or(false)
            {
                selected.insert(i);
                if i > 0 {
                    selected.insert(i - 1);
                }
                if i + 1 < chunks.len() {
                    selected.insert(i + 1);
                }
            }
        }
        // Priority 2: fill the remaining budget with the earliest chunks.
        for i in 0..chunks.len() {
            if selected.len() >= MAX_RETRIEVED_CHUNKS {
                break;
            }
            selected.insert(i);
        }
        // Output in line order for readability.
        let mut order: Vec<usize> = selected.into_iter().collect();
        order.sort_unstable();

        let mut rendered = String::new();
        let mut rendered_chunks: Vec<&VectorChunk> = Vec::new();
        for i in order {
            if rendered_chunks.len() >= MAX_RETRIEVED_CHUNKS {
                break;
            }
            rendered_chunks.push(&chunks[i]);
            rendered.push_str(&Self::render_rag_chunk(&chunks[i]));
        }
        let start = rendered_chunks
            .first()
            .and_then(|c| c.code.as_ref())
            .map(|m| m.start_line);
        let end = rendered_chunks
            .last()
            .and_then(|c| c.code.as_ref())
            .map(|m| m.end_line);
        let range = match (start, end) {
            (Some(a), Some(b)) => format!("{a}-{b}"),
            _ => String::new(),
        };
        (range, rendered)
    }

    /// Parse the scenarios array from the model's response. Returns `Err` when
    /// the response is not valid JSON or does not match the required envelope
    /// (`{"scenarios": [...]}`). We are intentionally strict: an object with an
    /// unrelated shape (e.g. `{"steps": [...]}`, `{"totalResults": 3}`) or a
    /// malformed scenario item is treated as a hard failure so the caller can
    /// retry instead of silently producing zero scenarios.
    fn parse_scenarios_from_ai(raw: &str) -> Result<Vec<BitbucketTestScenario>, String> {
        let value = match crate::services::text_utils::extract_json_block(raw) {
            Some(v) => v,
            None => {
                let snippet = raw.chars().take(500).collect::<String>();
                log::warn!(target: "Bitbucket", "parse_scenarios_from_ai: response was not valid JSON. Snippet: {snippet}");
                return Err("Model response was not valid JSON".to_string());
            }
        };

        // Require a top-level object with a "scenarios" array. Bare arrays and
        // unrelated objects are rejected so we never accept a wrong schema.
        let arr = match value.get("scenarios").and_then(|v| v.as_array()) {
            Some(arr) => arr,
            None => {
                let snippet = raw.chars().take(300).collect::<String>();
                log::warn!(target: "Bitbucket", "parse_scenarios_from_ai: valid JSON but missing 'scenarios' array. Snippet: {snippet}");
                return Err("Model response has no 'scenarios' array".to_string());
            }
        };

        let mut list = Vec::new();
        for (i, item) in arr.iter().enumerate() {
            let s: BitbucketTestScenario = serde_json::from_value(item.clone()).map_err(|e| {
                log::warn!(target: "Bitbucket", "parse_scenarios_from_ai: scenario #{i} failed deserialization: {e}");
                format!("Scenario #{i} is malformed: {e}")
            })?;

            // Semantic validation on top of Serde's type checks.
            if s.scenario.trim().is_empty() {
                return Err(format!("Scenario #{i} has an empty 'scenario' title"));
            }
            list.push(s);
        }
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_diff_keeps_selected_files_only() {
        let diff = "diff --git a/src/a.rs b/src/a.rs\n+pub fn a() {}\ndiff --git a/src/b.rs b/src/b.rs\n+pub fn b() {}";
        let selected = vec!["src/b.rs".to_string()];
        let filtered = BitbucketService::filter_diff_by_files(diff, &selected);
        assert!(filtered.contains("b.rs"));
        assert!(!filtered.contains("a.rs"));
    }

    #[test]
    fn filter_diff_empty_selection_returns_all() {
        let diff = "diff --git a/src/a.rs b/src/a.rs\n+pub fn a() {}";
        let filtered = BitbucketService::filter_diff_by_files(diff, &[]);
        assert_eq!(filtered, diff);
    }

    #[test]
    fn split_diff_sections_splits_per_file() {
        let diff = "diff --git a/src/a.rs b/src/a.rs\n+pub fn a() {}\ndiff --git a/src/b.rs b/src/b.rs\n+pub fn b() {}";
        let sections = BitbucketService::split_diff_sections(diff);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].0, "src/a.rs");
        assert_eq!(sections[1].0, "src/b.rs");
        assert!(sections[0].1.contains("pub fn a"));
        assert!(sections[1].1.contains("pub fn b"));
    }

    #[test]
    fn parse_changed_line_numbers_extracts_added_lines() {
        let section = "diff --git a/src/a.rs b/src/a.rs\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -1,5 +1,6 @@\n foo\n+bar\n baz\n-removed\n+newbaz\n qux";
        let changed = BitbucketService::parse_changed_line_numbers(section);
        // added lines are at new-file line 2 (bar) and 4 (newbaz).
        assert_eq!(changed, HashSet::from([2, 4]));
    }

    #[test]
    fn render_rag_chunk_marks_changed_lines_with_absolute_numbers() {
        let chunk = VectorChunk {
            id: "c".into(),
            source: "bitbucket".into(),
            source_id: "PROJ:repo:abc".into(),
            container_id: None,
            source_title: "src/a.rs".into(),
            source_url: "/browse/src/a.rs".into(),
            content: "line1\nline2\nline3".into(),
            embedding: vec![],
            indexed_at: "2026-06-18".into(),
            code: Some(CodeChunkMeta {
                repo: "PROJ:repo".into(),
                commit: "abc".into(),
                file_path: "src/a.rs".into(),
                start_line: 10,
                end_line: 12,
                changed_lines: vec![11],
            }),
            expires_at: None,
            last_used_at: None,
        };
        let block = BitbucketService::render_rag_chunk(&chunk);
        assert!(block.contains("### File: src/a.rs (lines 10-12)"));
        assert!(block.contains("[CHANGED] 11: line2"));
        assert!(block.contains("10: line1"));
        assert!(block.contains("12: line3"));
        assert!(!block.contains("[CHANGED] 10:"));
    }

    #[test]
    fn render_explain_chunks_prioritises_changed_and_bounds_to_cap() {
        let mk = |i: usize, changed: bool| {
            let start = i * 3 + 1;
            let changed_lines = if changed { vec![start] } else { vec![] };
            VectorChunk {
                id: format!("c{i}"),
                source: "bitbucket".into(),
                source_id: "ns".into(),
                container_id: None,
                source_title: "f.rs".into(),
                source_url: "".into(),
                content: format!("l{start}\nl{}\nl{}", start + 1, start + 2),
                embedding: vec![],
                indexed_at: String::new(),
                code: Some(CodeChunkMeta {
                    repo: "".into(),
                    commit: "".into(),
                    file_path: "f.rs".into(),
                    start_line: start,
                    end_line: start + 2,
                    changed_lines,
                }),
                expires_at: None,
                last_used_at: None,
            }
        };
        // 40 chunks, several containing changes far apart.
        let mut chunks: Vec<VectorChunk> = (0..40).map(|i| mk(i, i == 5 || i == 39)).collect();
        // Also add an empty sentinel to exercise the guard.
        let (range, rendered) = BitbucketService::render_explain_chunks(&chunks);
        assert!(!range.is_empty());
        assert!(range.starts_with("1-"));
        // Bounded to the cap.
        assert!(rendered.matches("### File: f.rs").count() <= MAX_RETRIEVED_CHUNKS);
        // Both changed chunks are included (5 and 39) despite the cap.
        assert!(rendered.contains("l16"));
        assert!(rendered.contains("l118"));

        chunks.clear();
        let (range, rendered) = BitbucketService::render_explain_chunks(&chunks);
        assert!(range.is_empty());
        assert!(rendered.is_empty());
    }

    #[test]
    fn is_text_file_detects_source_and_excludes_others() {
        assert!(BitbucketService::is_text_file("src/App.java"));
        assert!(BitbucketService::is_text_file("app/main.py"));
        assert!(BitbucketService::is_text_file("README.md"));
        assert!(!BitbucketService::is_text_file("lib/app.jar"));
        assert!(!BitbucketService::is_text_file("img/logo.png"));
    }

    #[test]
    fn commit_messages_from_values_formats_and_skips_empty() {
        let values: Vec<serde_json::Value> = serde_json::from_str(
            r#"[
                {"id":"abcdef1234567890","message":"Add export feature\n\nInclude totals row","author":{"displayName":"Budi"},"authorTimestamp":1700000000000},
                {"id":"00000000","message":"","author":{"displayName":"Skip"}},
                {"id":"xyz","message":"fix typo","author":{"name":"Siti"}}
            ]"#,
        )
        .unwrap();
        let msgs = BitbucketService::commit_messages_from_values(&values);
        assert_eq!(msgs.len(), 2);
        assert!(msgs[0].starts_with("[abcdef12] Budi - "));
        assert!(msgs[0].contains("Add export feature\n\nInclude totals row"));
        // Message too short for a hash: short hash = whatever is available.
        assert!(msgs[1].starts_with("[xyz] Siti"));
        assert!(msgs[1].ends_with("fix typo"));
    }

    #[test]
    fn parse_scenarios_from_ai_parses_fenced_json() {
        let raw = "Here you go:\n```json\n{\"scenarios\": [{\"scenario\": \"S1\", \"confidence\": 90, \"reason\": \"r\", \"scenarioType\": \"Positive\", \"riskLevel\": \"High\", \"preconditions\": [], \"steps\": [{\"step\": 1, \"action\": \"a\", \"expected\": \"e\"}]}]}\n```";
        let list = BitbucketService::parse_scenarios_from_ai(raw).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].scenario, "S1");
        assert_eq!(list[0].confidence, 90);
    }

    #[test]
    fn parse_scenarios_from_ai_rejects_invalid_json() {
        let raw = "not json at all";
        assert!(BitbucketService::parse_scenarios_from_ai(raw).is_err());
    }

    #[test]
    fn parse_scenarios_from_ai_rejects_bare_array() {
        let raw = r#"[{"scenario":"S1","confidence":80,"reason":"r","scenarioType":"Positive","riskLevel":"Low","preconditions":[],"steps":[{"step":1,"action":"a","expected":"e"}]}]"#;
        assert!(BitbucketService::parse_scenarios_from_ai(raw).is_err());
    }

    #[test]
    fn parse_scenarios_from_ai_rejects_wrong_schema_with_steps_top_level() {
        // This is the exact failure reported by the user: valid JSON, but the
        // top-level shape is `steps`/`totalResults`, not `scenarios`.
        let raw = r#"{"totalResults":3,"steps":[{"id":"146275891058804","name":"SQL Step","class":"m_sql","sql_script":"SELECT 1"}]}"#;
        assert!(BitbucketService::parse_scenarios_from_ai(raw).is_err());
    }

    #[test]
    fn parse_scenarios_from_ai_rejects_object_without_scenarios() {
        let raw = r#"{"foo":[1,2,3]}"#;
        assert!(BitbucketService::parse_scenarios_from_ai(raw).is_err());
    }

    #[test]
    fn parse_scenarios_from_ai_rejects_empty_title() {
        let raw = r#"{"scenarios":[{"scenario":"","confidence":80,"reason":"r","scenarioType":"Positive","riskLevel":"Low","preconditions":[],"steps":[{"step":1,"action":"a","expected":"e"}]}]}"#;
        assert!(BitbucketService::parse_scenarios_from_ai(raw).is_err());
    }

    #[test]
    fn parse_scenarios_from_ai_accepts_any_supporting_scenario_type() {
        let raw = r#"{"scenarios":[{"scenario":"S","confidence":80,"reason":"r","scenarioType":"Weird","riskLevel":"Low","preconditions":[],"steps":[{"step":1,"action":"a","expected":"e"}]}]}"#;
        assert!(BitbucketService::parse_scenarios_from_ai(raw).is_ok());
    }

    #[test]
    fn parse_scenarios_from_ai_accepts_any_supporting_risk_level() {
        let raw = r#"{"scenarios":[{"scenario":"S","confidence":80,"reason":"r","scenarioType":"Positive","riskLevel":"Extreme","preconditions":[],"steps":[{"step":1,"action":"a","expected":"e"}]}]}"#;
        assert!(BitbucketService::parse_scenarios_from_ai(raw).is_ok());
    }

    #[test]
    fn parse_scenarios_from_ai_accepts_empty_supporting_fields() {
        let raw = r#"{"scenarios":[{"scenario":"S","confidence":80,"reason":"r","scenarioType":"Positive","riskLevel":"Low","preconditions":[],"steps":[]}]}"#;
        let list = BitbucketService::parse_scenarios_from_ai(raw).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].scenario, "S");
    }

    #[test]
    fn parse_scenarios_from_ai_accepts_scenario_only() {
        let raw = r#"{"scenarios":[{"scenario":"S"}]}"#;
        let list = BitbucketService::parse_scenarios_from_ai(raw).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].reason.is_empty());
        assert!(list[0].steps.is_empty());
    }

    #[test]
    fn parse_scenarios_from_ai_rejects_malformed_item() {
        let raw = r#"{"scenarios":[{"scenario":"S1","confidence":80,"reason":"r","scenarioType":"Positive","riskLevel":"Low","preconditions":[],"steps":[{"step":1,"action":"a","expected":"e"}]},{"scenario":"S2","confidence":"not-a-number","reason":"r","scenarioType":"Positive","riskLevel":"Low","preconditions":[],"steps":[{"step":1,"action":"a","expected":"e"}]}]}"#;
        assert!(BitbucketService::parse_scenarios_from_ai(raw).is_err());
    }

    #[test]
    fn parse_scenarios_from_ai_handles_braces_in_strings() {
        let raw = r#"{"scenarios":[{"scenario":"Return body {\"code\":400}","confidence":88,"reason":"r","scenarioType":"Negative","riskLevel":"High","preconditions":[],"steps":[{"step":1,"action":"Post {\"x\":1}","expected":"HTTP 400"}]}]}"#;
        let list = BitbucketService::parse_scenarios_from_ai(raw).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].scenario, r#"Return body {"code":400}"#);
    }

    #[test]
    fn parse_explain_response_parses_structured_json() {
        let raw = r#"{"title":"Validasi pembayaran","summary":"Fitur memeriksa data pembayaran.","purpose":"Mencegah transaksi tidak valid.","simpleFlow":["Terima data","Validasi"],"inputs":["nomor"],"outputs":["status"],"businessImpact":"Mengurangi risiko.","risks":["data kosong"],"technicalTerms":[{"term":"API","explanation":"jalur komunikasi"}],"evidence":[{"file":"src/A.java","lines":"1-10","reason":"validasi"}],"confidence":90,"unknowns":[]}"#;
        let res = BitbucketService::parse_explain_response(raw).unwrap();
        assert_eq!(res.title, "Validasi pembayaran");
        assert_eq!(res.simple_flow.len(), 2);
        assert_eq!(res.technical_terms[0].term, "API");
        assert_eq!(res.evidence[0].file, "src/A.java");
        assert_eq!(res.confidence, 90);
    }

    #[test]
    fn parse_explain_response_rejects_invalid_json() {
        assert!(BitbucketService::parse_explain_response("not json").is_err());
    }

    #[test]
    fn explain_system_prompt_is_in_indonesian_and_mode_aware() {
        for mode in ["simple", "technical", "impact"] {
            let prompt = BitbucketService::explain_system_prompt(mode);
            assert!(prompt.contains("Bahasa Indonesia"));
            assert!(prompt.contains("evidence"));
            assert!(prompt.contains(mode));
        }
    }

    #[test]
    fn build_file_context_window_respects_range_and_cap() {
        let mut content = String::new();
        for i in 1..=3000 {
            content.push_str(&format!("line {i}\n"));
        }
        let changed = HashSet::from([50]);
        // With a range, only that window (+context) is rendered.
        let (range, rendered) = BitbucketService::build_file_context_window(
            "a.rs",
            &content,
            &changed,
            Some(45),
            Some(55),
            1200,
        );
        assert_eq!(range, "35-65");
        assert!(rendered.contains("[CHANGED] 50: line 50"));
        assert!(!rendered.contains("line 1:"));
        assert!(!rendered.contains("line 1000:"));

        // Without a range, capped to max_lines with a truncation note.
        let (_r2, rendered2) = BitbucketService::build_file_context_window(
            "a.rs", &content, &changed, None, None, 1200,
        );
        assert!(rendered2.contains("1200: line 1200"));
        assert!(rendered2.contains("dipotong untuk performa"));
        assert!(!rendered2.contains("3000: line 3000"));
    }

    #[test]
    fn is_ignored_file_detects_changelog() {
        assert!(BitbucketService::is_ignored_file("CHANGELOG.md"));
        assert!(BitbucketService::is_ignored_file("docs/changelog.txt"));
        assert!(!BitbucketService::is_ignored_file("src/main.rs"));
    }

    #[test]
    fn is_binary_file_detects_common_binaries() {
        assert!(BitbucketService::is_binary_file("lib/foo.jar"));
        assert!(BitbucketService::is_binary_file("lib/App.class"));
        assert!(BitbucketService::is_binary_file("img/logo.png"));
        assert!(BitbucketService::is_binary_file("dist/bundle.zip"));
        assert!(!BitbucketService::is_binary_file("src/App.java"));
        assert!(!BitbucketService::is_binary_file("README.md"));
    }
}
