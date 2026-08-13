use crate::models::app_config::AppConfig;
use crate::models::bitbucket::*;
use crate::models::chat::ChatHistoryMessage;
use crate::services::bitbucket_cache::{BitbucketCacheService, get_global_bitbucket_cache};
use crate::services::gap_analysis::GapAnalyzer;
use crate::services::impact_analysis::ImpactAnalyzer;
use crate::services::ollama::OllamaClient;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

const BITBUCKET_TIMEOUT_SECS: u64 = 60;
const CHANGES_PAGE_SIZE: u32 = 200;
const MAX_DIFF_CHARS: usize = 30000;
const MAX_FULL_CONTEXT_FILES: usize = 8;
const MAX_FULL_CONTEXT_BYTES_PER_FILE: usize = 40_000;
const MAX_FULL_CONTEXT_TOTAL_BYTES: usize = 100_000;

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
        if trimmed.contains("/projects/") && trimmed.contains("/repos/") && trimmed.contains("/pull-requests/") {
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
                return Err(format!("Bitbucket changes API returned status: {}", resp.status()));
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

                    files.push(BitbucketFileChange {
                        path,
                        change_type,
                        lines_added,
                        lines_deleted,
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
        let (pr_result, changes_result) = tokio::join!(
            Self::fetch_pr_json(&client, &pr_url),
            self.fetch_changes(&client, &base_url, &project_key, &repo_slug, pr_id),
        );

        let pr_json = pr_result?;
        let files = changes_result?;
        log::info!(target: "Bitbucket", "fetch_pr_details OK: {} files changed", files.len());

        let title = pr_json["title"].as_str().unwrap_or("Untitled PR").to_string();
        let description = pr_json["description"].as_str().map(|s| s.to_string());
        let branch_from = pr_json["fromRef"]["displayId"].as_str().unwrap_or("feature").to_string();
        let branch_to = pr_json["toRef"]["displayId"].as_str().unwrap_or("main").to_string();
        let latest_commit_hash = pr_json["fromRef"]["latestCommit"].as_str().unwrap_or("latest").to_string();
        let author_name = pr_json["author"]["user"]["displayName"].as_str()
            .or_else(|| pr_json["author"]["user"]["name"].as_str())
            .unwrap_or("Unknown").to_string();

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
            jira_ticket_key,
            jira_summary: None,
            jira_description: None,
            cached: false,
        })
    }

    /// Fetch and parse a single Bitbucket PR document.
    async fn fetch_pr_json(client: &reqwest::Client, pr_url: &str) -> Result<serde_json::Value, String> {
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

    pub async fn fetch_raw_diff(&self, project_key: &str, repo_slug: &str, pr_id: u64) -> Result<String, String> {
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
            return Err(format!("Bitbucket diff API returned status: {}", resp.status()));
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
            Ok(format!("{}\n...[diff truncated for performance]", &text[..end]))
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
            return Err(format!("Bitbucket browse API returned status {} for {path}", resp.status()));
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

    pub async fn generate_scenarios(&self, req: BitbucketGenerateRequest, ollama: OllamaClient) -> Result<BitbucketGenerateResponse, String> {
        let pr_summary = self.fetch_pr_details(&req.pr_url_or_id).await?;
        let cache_key = BitbucketCacheService::make_key(
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

        let raw_diff = self.fetch_raw_diff(&pr_summary.project_key, &pr_summary.repo_slug, pr_summary.pr_id).await?;

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
        let non_ignored: Vec<String> = pr_summary.files.iter()
            .filter(|f| keep_file(f, &mut skipped_binary))
            .map(|f| f.path.clone())
            .collect();
        let filter_list = if req.selected_files.is_empty() {
            non_ignored.clone()
        } else {
            req.selected_files.iter()
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
        let filtered_diff: String = sections.iter().map(|(_, s)| s.as_str()).collect::<Vec<_>>().join("\n");
        let section_by_path: HashMap<String, String> = sections.iter().cloned().collect();

        // 1. Dependency & Impact Analysis (changelog + binary files excluded)
        let impact_files: Vec<BitbucketFileChange> = pr_summary.files.iter()
            .filter(|f| !Self::is_ignored_file(&f.path) && !Self::is_binary_file(&f.path))
            .cloned()
            .collect();
        let impact = ImpactAnalyzer::analyze(&impact_files, &filtered_diff);

        // 2. Existing Test Search & Gap Analysis
        let gap = GapAnalyzer::analyze(pr_summary.jira_ticket_key.as_deref(), &impact, 0);

        // 3. Always use the Active Model configured in Settings.
        let active_model = if self.config.ollama.model.is_empty() {
            "qwen2.5:7b".to_string()
        } else {
            self.config.ollama.model.clone()
        };

        // 4. Full-code context for the most-impactful text files (capped).
        //    The raw diff of those files is replaced by their highlighted full
        //    content to save tokens while giving the model real surrounding code.
        let mut candidates: Vec<(String, usize)> = section_by_path.iter()
            .filter(|(path, _)| Self::is_text_file(path))
            .map(|(path, section)| (path.clone(), Self::parse_changed_line_numbers(section).len()))
            .collect();
        candidates.sort_by(|a, b| b.1.cmp(&a.1));
        candidates.truncate(MAX_FULL_CONTEXT_FILES);

        let client = std::sync::Arc::new(self.create_client()?);
        let base_url = self.config.bitbucket.base_url.trim_end_matches('/').to_string();
        let mut set = tokio::task::JoinSet::new();
        for (path, _) in &candidates {
            let client = client.clone();
            let base_url = base_url.clone();
            let pk = pr_summary.project_key.clone();
            let rs = pr_summary.repo_slug.clone();
            let ch = pr_summary.latest_commit_hash.clone();
            let path = path.clone();
            set.spawn(async move {
                let res = Self::fetch_file_content_impl(&client, &base_url, &pk, &rs, &path, &ch).await;
                (path, res)
            });
        }
        let mut fetched: HashMap<String, Result<String, String>> = HashMap::new();
        while let Some(res) = set.join_next().await {
            if let Ok((path, r)) = res {
                fetched.insert(path, r);
            }
        }

        let mut full_context_blocks: Vec<String> = Vec::new();
        let mut covered: HashSet<String> = HashSet::new();
        let mut total_bytes = 0usize;
        for (path, _) in &candidates {
            if full_context_blocks.len() >= MAX_FULL_CONTEXT_FILES {
                break;
            }
            let Ok(content) = fetched.get(path).cloned().unwrap_or_else(|| Err("not fetched".to_string())) else {
                continue;
            };
            if content.len() > MAX_FULL_CONTEXT_BYTES_PER_FILE || total_bytes + content.len() > MAX_FULL_CONTEXT_TOTAL_BYTES {
                continue;
            }
            let changed = section_by_path
                .get(path)
                .map(|s| Self::parse_changed_line_numbers(s))
                .unwrap_or_default();
            full_context_blocks.push(Self::build_full_context_block(path, &content, &changed));
            covered.insert(path.clone());
            total_bytes += content.len();
        }
        log::info!(
            target: "Bitbucket",
            "generate_scenarios: {} file(s) with full context (~{total_bytes} bytes), {} file(s) fall back to diff",
            full_context_blocks.len(),
            section_by_path.len().saturating_sub(covered.len())
        );

        let diff_blocks: Vec<&str> = sections.iter()
            .filter(|(path, _)| !covered.contains(path))
            .map(|(_, s)| s.as_str())
            .collect();

        let mut prompt = String::new();
        prompt.push_str(&format!("PR Title: {}\n", pr_summary.title));
        prompt.push_str(&format!("Jira Ticket: {}\n", pr_summary.jira_ticket_key.as_deref().unwrap_or("None")));
        prompt.push_str(&format!("Impact Summary: {}\n", impact.summary_notes));
        prompt.push_str(&format!("Affected Components: {}\n", impact.affected_components.join(", ")));
        if !full_context_blocks.is_empty() {
            prompt.push_str("\n=== CHANGED FILE CONTEXT (full code; lines marked [CHANGED] are the diff) ===\n");
            for block in &full_context_blocks {
                prompt.push_str(block);
                prompt.push('\n');
            }
        }
        if !diff_blocks.is_empty() {
            prompt.push_str("\n=== RAW DIFF (files without full context) ===\n");
            prompt.push_str(&diff_blocks.join("\n"));
        }

        let user_prompt = prompt;

        let system_prompt = r#"You are a Senior QA Engineer performing Code Audit & Shift-Left Test Case Generation.

GROUND RULES (important):
- Generate scenarios ONLY from the provided diff and full-code context. Never invent functions, APIs, variables, classes, or behaviors that are not present in the code.
- Every scenario must trace back to an actual change. In the "reason" field, cite the specific file / function / changed line it is based on.
- Keep scenarios VARIED across scenarioType (Positive, Negative, Edge Case, Regression, Security) and riskLevel (High, Medium, Low), but always stay within the actual behavior of the code shown.
- If the changes are trivial (formatting, docs, or very small), return fewer scenarios — or an empty "scenarios" array — with lower confidence instead of fabricating coverage.
- "expected" must be grounded in what the code actually does. Never assert behavior you cannot infer from the diff / full code.

Each scenario MUST include:
- scenario: Short descriptive title
- confidence: Integer between 0 and 100 representing confidence/importance score
- reason: Clear explanation of why this scenario is critical based on code changes (cite file/function/line)
- scenarioType: "Positive", "Negative", "Edge Case", "Regression", or "Security"
- riskLevel: "High", "Medium", or "Low"
- preconditions: Array of string preconditions
- steps: Array of {"step": number, "action": string, "expected": string}

Output JSON format:
{
  "scenarios": [
    {
      "scenario": "Validate payment reversal",
      "confidence": 92,
      "reason": "Business logic modified in PaymentService (src/payment/PaymentService.java:40)",
      "scenarioType": "Negative",
      "riskLevel": "High",
      "preconditions": ["User session active"],
      "steps": [
        {"step": 1, "action": "Submit invalid payload", "expected": "System returns error code 400"}
      ]
    }
  ]
}"#;

        let empty_history: Vec<ChatHistoryMessage> = vec![];
        log::info!(target: "Bitbucket", "generate_scenarios: calling Ollama with active model '{}'", active_model);
        let ai_raw_response = ollama
            .chat(&system_prompt, &user_prompt, &empty_history, None, Some(&active_model))
            .await
            .unwrap_or_else(|| "{ \"scenarios\": [] }".to_string());

        // 4. Extract scenarios from the model response (robust JSON extraction)
        let scenarios = Self::parse_scenarios_from_ai(&ai_raw_response)?;

        // 5. Duplicate Filtering & Risk Ranking
        let unique_scenarios = GapAnalyzer::filter_duplicates(scenarios);
        log::info!(target: "Bitbucket", "generate_scenarios: {} scenarios generated for {}", unique_scenarios.len(), pr_summary.title);

        let response = BitbucketGenerateResponse {
            pr_id: pr_summary.pr_id,
            commit_hash: pr_summary.latest_commit_hash,
            cache_hit: false,
            impact,
            gap,
            scenarios: unique_scenarios,
        };

        // Cache the result
        get_global_bitbucket_cache().set(&cache_key, response.clone());

        Ok(response)
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
            "jar" | "class" | "war" | "ear" | "aar" | "apk" | "dex"
                | "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "svgz" | "avif"
                | "pdf" | "zip" | "gz" | "tgz" | "bz2" | "xz" | "7z" | "rar" | "tar"
                | "exe" | "dll" | "so" | "dylib" | "bin" | "dat" | "obj" | "o" | "a" | "lib"
                | "woff" | "woff2" | "ttf" | "eot" | "otf"
                | "xlsx" | "xls" | "docx" | "doc" | "pptx" | "ppt"
                | "mp4" | "mp3" | "wav" | "ogg" | "mov" | "avi" | "mkv" | "webm"
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
            "java" | "kt" | "kts" | "scala" | "groovy" | "py" | "pyi" | "go" | "rs"
                | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "vue" | "svelte"
                | "php" | "rb" | "pl" | "lua" | "c" | "h" | "cpp" | "hpp" | "cc" | "cxx"
                | "cs" | "swift" | "m" | "mm" | "sql" | "sh" | "bash" | "zsh" | "ps1" | "bat" | "cmd"
                | "xml" | "yml" | "yaml" | "json" | "json5" | "properties" | "toml" | "ini" | "cfg" | "conf"
                | "gradle" | "gradlew" | "makefile" | "dockerfile" | "dockerignore" | "gitignore"
                | "md" | "markdown" | "txt" | "rst" | "adoc"
                | "html" | "htm" | "css" | "scss" | "sass" | "less"
                | "graphql" | "proto" | "tf" | "hcl"
        )
    }

    /// Render a full file with the changed lines highlighted for the LLM.
    fn build_full_context_block(path: &str, content: &str, changed_lines: &HashSet<usize>) -> String {
        let mut out = String::new();
        out.push_str(&format!("### File: {path} ({} changed line(s))\n", changed_lines.len()));
        if content.trim().is_empty() {
            out.push_str("(empty file)\n");
            return out;
        }
        for (idx, line) in content.lines().enumerate() {
            let no = idx + 1;
            if changed_lines.contains(&no) {
                out.push_str(&format!("[CHANGED] {no}: {line}\n"));
            } else {
                out.push_str(&format!("{no}: {line}\n"));
            }
        }
        out
    }

    /// Parse the scenarios array from the model's response. Returns `Err` when
    /// the response is not valid JSON so callers can surface the failure
    /// instead of silently producing a fake scenario.
    fn parse_scenarios_from_ai(raw: &str) -> Result<Vec<BitbucketTestScenario>, String> {
        let value = match crate::services::text_utils::extract_json_block(raw) {
            Some(v) => v,
            None => {
                let snippet = raw.chars().take(500).collect::<String>();
                log::warn!(target: "Bitbucket", "parse_scenarios_from_ai: response was not valid JSON. Snippet: {snippet}");
                return Err("Model response was not valid JSON".to_string());
            }
        };

        // Accept either {"scenarios": [...]} or a bare array [...] from the model.
        let arr = value["scenarios"].as_array()
            .or_else(|| value.as_array())
            .cloned()
            .unwrap_or_default();

        let mut list = Vec::new();
        for item in arr {
            if let Ok(s) = serde_json::from_value::<BitbucketTestScenario>(item.clone()) {
                list.push(s);
            }
        }
        if value.get("scenarios").is_none() && value.as_array().is_none() {
            let snippet = raw.chars().take(300).collect::<String>();
            log::warn!(target: "Bitbucket", "parse_scenarios_from_ai: valid JSON but no 'scenarios' array. Snippet: {snippet}");
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
    fn build_full_context_block_marks_changed_lines() {
        let content = "line1\nline2\nline3\n";
        let changed = HashSet::from([2]);
        let block = BitbucketService::build_full_context_block("src/a.rs", content, &changed);
        assert!(block.contains("### File: src/a.rs (1 changed line(s))"));
        assert!(block.contains("[CHANGED] 2: line2"));
        assert!(block.contains("1: line1"));
        assert!(!block.contains("[CHANGED] 1:"));
        assert!(!block.contains("[CHANGED] 3:"));
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
    fn parse_scenarios_from_ai_accepts_bare_array() {
        let raw = r#"[{"scenario":"S1","confidence":80,"reason":"r","scenarioType":"Positive","riskLevel":"Low","preconditions":[],"steps":[]}]"#;
        let list = BitbucketService::parse_scenarios_from_ai(raw).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].scenario, "S1");
    }

    #[test]
    fn parse_scenarios_from_ai_handles_braces_in_strings() {
        let raw = r#"{"scenarios":[{"scenario":"Return body {\"code\":400}","confidence":88,"reason":"r","scenarioType":"Negative","riskLevel":"High","preconditions":[],"steps":[{"step":1,"action":"Post {\"x\":1}","expected":"HTTP 400"}]}]}"#;
        let list = BitbucketService::parse_scenarios_from_ai(raw).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].scenario, r#"Return body {"code":400}"#);
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
