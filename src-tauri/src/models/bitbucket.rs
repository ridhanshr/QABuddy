use serde::{Deserialize, Deserializer, Serialize};

fn deserialize_step_number<'de, D>(deserializer: D) -> Result<usize, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(match value {
        serde_json::Value::Number(n) => n.as_u64().unwrap_or(0) as usize,
        serde_json::Value::String(s) => s.trim().parse::<usize>().unwrap_or(0),
        _ => 0,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketFileChange {
    pub path: String,
    pub change_type: String, // ADD, MODIFY, DELETE
    #[serde(default)]
    pub lines_added: usize,
    #[serde(default)]
    pub lines_deleted: usize,
    /// Whether the file is analyzable by AI (non-binary, non-changelog).
    /// Mirrors the backend `is_ignored_file` / `is_binary_file` rules so the
    /// frontend can offer the same set without duplicating the logic.
    #[serde(default)]
    pub explainable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketDiffSummary {
    pub project_key: String,
    pub repo_slug: String,
    pub pr_id: u64,
    pub title: String,
    pub latest_commit_hash: String,
    pub author_name: String,
    pub branch_from: String,
    pub branch_to: String,
    pub files: Vec<BitbucketFileChange>,
    /// Developer intent hints from the PR's commit messages. Each entry is a
    /// pre-formatted block, e.g. "[abc1234] Author - <date>\n<full message>".
    /// Never treated as ground truth — only sent to the AI as context.
    #[serde(default)]
    pub commit_messages: Vec<String>,
    #[serde(default)]
    pub jira_ticket_key: Option<String>,
    #[serde(default)]
    pub jira_summary: Option<String>,
    #[serde(default)]
    pub jira_description: Option<String>,
    #[serde(default)]
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactAnalysisResult {
    pub affected_components: Vec<String>,
    pub modified_functions: Vec<String>,
    pub api_routes_changed: Vec<String>,
    pub regression_risk_level: String, // High, Medium, Low
    pub summary_notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GapAnalysisResult {
    pub existing_test_count: usize,
    pub missing_coverage_areas: Vec<String>,
    pub duplicate_risk_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestStepItem {
    #[serde(default, deserialize_with = "deserialize_step_number")]
    pub step: usize,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub expected: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketTestScenario {
    pub scenario: String,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub confidence: u8, // 0 - 100
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub scenario_type: String, // Positive, Negative, Edge Case, Regression, Security
    #[serde(default)]
    pub risk_level: String, // High, Medium, Low
    #[serde(default)]
    pub preconditions: Vec<String>,
    #[serde(default)]
    pub steps: Vec<TestStepItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketGenerateRequest {
    pub pr_url_or_id: String,
    pub selected_files: Vec<String>,
    pub force_refresh_cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketGenerateResponse {
    pub pr_id: u64,
    pub commit_hash: String,
    pub cache_hit: bool,
    pub impact: ImpactAnalysisResult,
    pub gap: GapAnalysisResult,
    pub scenarios: Vec<BitbucketTestScenario>,
}

/// Progress update emitted while `generate_scenarios` runs, so the UI can
/// show which stage of the pipeline is currently in flight (there is no
/// natural per-item percentage — this is a single-shot LLM call, not a
/// per-feature loop like the BRD generator).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketGenerateProgress {
    /// Machine-readable stage id, e.g. "fetch_pr", "fetch_diff", "impact",
    /// "rag_context", "calling_ai", "done".
    pub stage: String,
    /// Human-readable message (Bahasa Indonesia) shown to the user.
    pub message: String,
}

/// Request to sync a set of user-selected Bitbucket-generated scenarios into
/// a Jira/Xray Test Repository project (optionally into a specific folder),
/// and cache them in the local `test_case` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketSyncScenariosRequest {
    pub project_key: String,
    #[serde(default)]
    pub folder_path: Option<String>,
    pub scenarios: Vec<BitbucketTestScenario>,
}

/// Result of syncing one scenario to Jira.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketSyncScenarioResult {
    pub scenario: String,
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jira_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketSyncScenariosResponse {
    pub results: Vec<BitbucketSyncScenarioResult>,
}

/// Request to explain what a piece of Bitbucket PR code does (AI Code Explainer).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketExplainRequest {
    pub pr_url_or_id: String,
    pub file_path: String,
    /// Optional 1-based line range to focus on (e.g. a function).
    #[serde(default)]
    pub start_line: Option<usize>,
    #[serde(default)]
    pub end_line: Option<usize>,
    /// "simple" | "technical" | "impact"
    #[serde(default)]
    pub mode: String,
    /// Bypass the explanation cache and regenerate.
    #[serde(default)]
    pub force_refresh: bool,
}

/// A technical term explained in plain language.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TechnicalTerm {
    #[serde(default)]
    pub term: String,
    #[serde(default)]
    pub explanation: String,
}

/// A file/line reference backing a statement in the explanation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeEvidence {
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub lines: String,
    #[serde(default)]
    pub reason: String,
}

/// Structured explanation produced by the AI Code Explainer.
///
/// Deserialization is case- and separator-insensitive (`simple_flow`,
/// `simpleFlow`, `Simple_Flow`, ... all map to the same field) so the answer
/// stays populated no matter which key convention the model uses.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketExplainResponse {
    pub title: String,
    pub summary: String,
    pub purpose: String,
    pub simple_flow: Vec<String>,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub business_impact: String,
    pub risks: Vec<String>,
    pub technical_terms: Vec<TechnicalTerm>,
    pub evidence: Vec<CodeEvidence>,
    pub confidence: u8,
    pub unknowns: Vec<String>,
}

impl<'de> Deserialize<'de> for BitbucketExplainResponse {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        let obj = value.as_object().ok_or_else(|| {
            serde::de::Error::custom("expected a JSON object for the explanation")
        })?;

        // Normalise a key: lowercase and strip anything that isn't alphanumeric.
        let norm = |k: &str| {
            k.to_lowercase()
                .chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
        };

        // Index the object by its normalised keys so lookups are
        // case/separator-insensitive (simple_flow, simpleFlow, SimpleFlow...).
        let index: std::collections::HashMap<String, &serde_json::Value> =
            obj.iter().map(|(k, v)| (norm(k), v)).collect();
        let get = |key: &str| obj.get(key).or_else(|| index.get(&norm(key)).copied());

        let str_of = |v: &Option<&serde_json::Value>| {
            v.and_then(|v| v.as_str()).unwrap_or("").trim().to_string()
        };
        let str_vec = |v: &Option<&serde_json::Value>| {
            v.and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|i| i.as_str().map(|s| s.trim().to_string()))
                        .collect()
                })
                .unwrap_or_default()
        };
        let terms = |v: &Option<&serde_json::Value>| {
            v.and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|i| {
                            let o = i.as_object()?;
                            let term = o
                                .get("term")
                                .or_else(|| o.get("Term"))
                                .and_then(|x| x.as_str())
                                .unwrap_or("");
                            let explanation = o
                                .get("explanation")
                                .or_else(|| o.get("Explanation"))
                                .and_then(|x| x.as_str())
                                .unwrap_or("");
                            Some(TechnicalTerm {
                                term: term.trim().to_string(),
                                explanation: explanation.trim().to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        let evidence = |v: &Option<&serde_json::Value>| {
            v.and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|i| {
                            let o = i.as_object()?;
                            let file = o
                                .get("file")
                                .or_else(|| o.get("File"))
                                .and_then(|x| x.as_str())
                                .unwrap_or("");
                            let lines = o
                                .get("lines")
                                .or_else(|| o.get("Lines"))
                                .map(|x| {
                                    x.as_str()
                                        .map(String::from)
                                        .or_else(|| x.as_i64().map(|n| n.to_string()))
                                        .unwrap_or_default()
                                })
                                .unwrap_or_default();
                            let reason = o
                                .get("reason")
                                .or_else(|| o.get("Reason"))
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .trim()
                                .to_string();
                            Some(CodeEvidence {
                                file: file.trim().to_string(),
                                lines,
                                reason,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        };

        Ok(BitbucketExplainResponse {
            title: str_of(&get("title")),
            summary: str_of(&get("summary")),
            purpose: str_of(&get("purpose")),
            simple_flow: str_vec(&get("simple_flow")),
            inputs: str_vec(&get("inputs")),
            outputs: str_vec(&get("outputs")),
            business_impact: str_of(&get("business_impact")),
            risks: str_vec(&get("risks")),
            technical_terms: terms(&get("technical_terms")),
            evidence: evidence(&get("evidence")),
            confidence: get("confidence")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                .min(100) as u8,
            unknowns: str_vec(&get("unknowns")),
        })
    }
}
