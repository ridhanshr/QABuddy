use crate::models::app_config::AppConfig;
use crate::models::bitbucket::*;
use crate::models::chat::ChatHistoryMessage;
use crate::services::bitbucket_cache::{BitbucketCacheService, get_global_bitbucket_cache};
use crate::services::gap_analysis::GapAnalyzer;
use crate::services::impact_analysis::ImpactAnalyzer;
use crate::services::ollama::OllamaService;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

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
            .build()
            .map_err(|e| format!("Failed to create reqwest client: {}", e))
    }

    pub fn parse_pr_url(&self, url_or_id: &str) -> (String, String, u64) {
        let trimmed = url_or_id.trim();

        // Check if full URL format: https://bitbucket.company.com/projects/PROJ/repos/REPO/pull-requests/42
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
                    if let Ok(id) = parts[i + 1].parse::<u64>() {
                        pr_id = id;
                    }
                }
            }

            if !project_key.is_empty() && !repo_slug.is_empty() && pr_id > 0 {
                return (project_key, repo_slug, pr_id);
            }
        }

        // Fallback to default configured project and repo slug if ID is numeric
        let pr_id = trimmed.parse::<u64>().unwrap_or(1);
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

        (project_key, repo_slug, pr_id)
    }

    pub fn extract_jira_key(text: &str) -> Option<String> {
        let re = regex::Regex::new(r"([A-Z]{2,10}-\d+)").ok()?;
        if let Some(cap) = re.captures(text) {
            return Some(cap[1].to_string());
        }
        None
    }

    pub async fn fetch_pr_details(&self, url_or_id: &str) -> Result<BitbucketDiffSummary, String> {
        let (project_key, repo_slug, pr_id) = self.parse_pr_url(url_or_id);
        let client = self.create_client()?;
        let base_url = self.config.bitbucket.base_url.trim_end_matches('/');

        if base_url.is_empty() {
            return Err("Bitbucket Base URL is not configured in Settings".to_string());
        }

        let pr_url = format!(
            "{}/rest/api/1.0/projects/{}/repos/{}/pull-requests/{}",
            base_url, project_key, repo_slug, pr_id
        );

        let resp = client.get(&pr_url).send().await.map_err(|e| format!("Bitbucket API request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Bitbucket API returned status: {}", resp.status()));
        }

        let pr_json: serde_json::Value = resp.json().await.map_err(|e| format!("Failed to parse Bitbucket PR response: {}", e))?;

        let title = pr_json["title"].as_str().unwrap_or("Untitled PR").to_string();
        let description = pr_json["description"].as_str().map(|s| s.to_string());
        let branch_from = pr_json["fromRef"]["displayId"].as_str().unwrap_or("feature").to_string();
        let branch_to = pr_json["toRef"]["displayId"].as_str().unwrap_or("main").to_string();
        let latest_commit_hash = pr_json["fromRef"]["latestCommit"].as_str().unwrap_or("latest").to_string();
        let author_name = pr_json["author"]["user"]["displayName"].as_str()
            .unwrap_or(pr_json["author"]["user"]["name"].as_str().unwrap_or("Unknown")).to_string();

        let jira_ticket_key = Self::extract_jira_key(&title)
            .or_else(|| Self::extract_jira_key(&branch_from))
            .or_else(|| description.as_deref().and_then(Self::extract_jira_key));

        // Fetch Changes List
        let changes_url = format!(
            "{}/rest/api/1.0/projects/{}/repos/{}/pull-requests/{}/changes?limit=200",
            base_url, project_key, repo_slug, pr_id
        );

        let mut files = Vec::new();
        if let Ok(changes_resp) = client.get(&changes_url).send().await {
            if changes_resp.status().is_success() {
                if let Ok(changes_json) = changes_resp.json::<serde_json::Value>().await {
                    if let Some(values) = changes_json["values"].as_array() {
                        for item in values {
                            let path = item["path"]["toString"].as_str()
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

                            files.push(BitbucketFileChange {
                                path,
                                change_type,
                                lines_added: 0,
                                lines_deleted: 0,
                            });
                        }
                    }
                }
            }
        }

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

    pub async fn fetch_raw_diff(&self, project_key: &str, repo_slug: &str, pr_id: u64) -> Result<String, String> {
        let client = self.create_client()?;
        let base_url = self.config.bitbucket.base_url.trim_end_matches('/');
        let diff_url = format!(
            "{}/rest/api/1.0/projects/{}/repos/{}/pull-requests/{}/diff",
            base_url, project_key, repo_slug, pr_id
        );

        let resp = client.get(&diff_url).send().await.map_err(|e| format!("Failed to fetch diff: {}", e))?;
        if !resp.status().is_success() {
            return Ok(format!("Diff response status: {}", resp.status()));
        }

        let text = resp.text().await.map_err(|e| format!("Failed to read diff text: {}", e))?;
        // Truncate raw diff if exceedingly large for CPU safety
        if text.len() > 30000 {
            Ok(format!("{}\n...[diff truncated for performance]", &text[..30000]))
        } else {
            Ok(text)
        }
    }

    pub async fn generate_scenarios(&self, req: BitbucketGenerateRequest, ollama: &OllamaService) -> Result<BitbucketGenerateResponse, String> {
        let pr_summary = self.fetch_pr_details(&req.pr_url_or_id).await?;
        let cache_key = BitbucketCacheService::make_key(
            &pr_summary.project_key,
            &pr_summary.repo_slug,
            pr_summary.pr_id,
            &pr_summary.latest_commit_hash,
        );

        // Check Caching Strategy (PR_ID + CommitHash)
        if !req.force_refresh_cache {
            if let Some(cached_res) = get_global_bitbucket_cache().get(&cache_key) {
                return Ok(cached_res);
            }
        }

        let raw_diff = self.fetch_raw_diff(&pr_summary.project_key, &pr_summary.repo_slug, pr_summary.pr_id).await?;

        // 1. Dependency & Impact Analysis
        let impact = ImpactAnalyzer::analyze(&pr_summary.files, &raw_diff);

        // 2. Existing Test Search & Gap Analysis
        let gap = GapAnalyzer::analyze(pr_summary.jira_ticket_key.as_deref(), &impact, 0);

        // 3. Ollama Prompting with Lightweight Model (qwen2.5-coder:1.5b / gemma3)
        let system_prompt = r#"You are a Senior QA Engineer performing Code Audit & Shift-Left Test Case Generation.
Given the Git Diff and PR context, generate structured test scenarios in strict JSON format.
Each scenario MUST include:
- scenario: Short descriptive title
- confidence: Integer between 0 and 100 representing confidence/importance score
- reason: Clear explanation of why this scenario is critical based on code changes
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
      "reason": "Business logic modified in PaymentService",
      "scenarioType": "Negative",
      "riskLevel": "High",
      "preconditions": ["User session active"],
      "steps": [
        {"step": 1, "action": "Submit invalid payload", "expected": "System returns error code 400"}
      ]
    }
  ]
}"#;

        let user_prompt = format!(
            "PR Title: {}\nJira Ticket: {}\nImpact Summary: {}\nAffected Components: {}\nRaw Diff:\n{}",
            pr_summary.title,
            pr_summary.jira_ticket_key.as_deref().unwrap_or("None"),
            impact.summary_notes,
            impact.affected_components.join(", "),
            raw_diff
        );

        let mut ollama_config = self.config.ollama.clone();
        if let Some(ref model_override) = req.model_override {
            ollama_config.diff_model = Some(model_override.clone());
        }
        let model_to_use = ollama_config.diff_model.clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "qwen2.5-coder:1.5b".to_string());
        ollama_config.model = model_to_use;

        let empty_history: Vec<ChatHistoryMessage> = vec![];
        let ai_raw_response = ollama
            .chat(&ollama_config, system_prompt, &user_prompt, &empty_history, None)
            .await
            .unwrap_or_else(|| "{ \"scenarios\": [] }".to_string());

        // Extract JSON array from LLM response
        let scenarios = Self::parse_scenarios_from_ai(&ai_raw_response)?;

        // 4. Duplicate Filtering & Risk Ranking
        let unique_scenarios = GapAnalyzer::filter_duplicates(scenarios);

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

    fn parse_scenarios_from_ai(raw: &str) -> Result<Vec<BitbucketTestScenario>, String> {
        let json_str = if let Some(start) = raw.find('{') {
            if let Some(end) = raw.rfind('}') {
                &raw[start..=end]
            } else {
                raw
            }
        } else {
            raw
        };

        if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(arr) = v["scenarios"].as_array() {
                let mut list = Vec::new();
                for item in arr {
                    if let Ok(s) = serde_json::from_value::<BitbucketTestScenario>(item.clone()) {
                        list.push(s);
                    }
                }
                if !list.is_empty() {
                    return Ok(list);
                }
            }
        }

        // Fallback default scenario if JSON parsing was partial
        Ok(vec![BitbucketTestScenario {
            scenario: "Validate PR Code Changes & API Behavior".to_string(),
            confidence: 85,
            reason: "Generated fallback for detected code modification in PR".to_string(),
            scenario_type: "Positive".to_string(),
            risk_level: "Medium".to_string(),
            preconditions: vec!["Environment ready for QA testing".to_string()],
            steps: vec![
                TestStepItem {
                    step: 1,
                    action: "Execute modified feature flow".to_string(),
                    expected: "Feature executes cleanly according to acceptance criteria".to_string(),
                }
            ],
        }])
    }
}
