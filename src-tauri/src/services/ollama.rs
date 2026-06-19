//! Ollama service + HTTP client. Ports `ollama-client.ts` and
//! `ollama-service.ts`. Low-level HTTP talks to the local Ollama REST API
//! (`/api/tags`, `/api/generate`, `/api/chat`, `/api/embeddings`); the
//! high-level service wraps prompts (see `prompts.rs`) for bug polishing, JQL
//! generation, test-case extraction, dashboard insight and chat.

use std::time::Duration;

use reqwest::Client;
use serde::Deserialize;

use crate::models::app_config::OllamaConfig;
use crate::models::chat::ChatHistoryMessage;
use crate::services::error::{Result, ServiceError};
use crate::services::http::normalize_url;
use crate::services::prompts;
use crate::services::text_utils::{chunk_content, deduplicate_test_cases};

const DEFAULT_TIMEOUT_SECS: u64 = 5;
const GENERATE_TIMEOUT_SECS: u64 = 600;

/// Low-level client for the local Ollama REST API.
#[derive(Clone)]
pub struct OllamaClient {
    endpoint: String,
    model: String,
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<TagsModel>,
}

#[derive(Debug, Deserialize)]
struct TagsModel {
    name: String,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    #[serde(default)]
    response: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    #[serde(default)]
    message: Option<ChatMessage>,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    #[allow(dead_code)]
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct EmbeddingsResponse {
    #[serde(default)]
    embedding: Vec<f64>,
}

impl OllamaClient {
    pub fn new(endpoint: &str, model: &str) -> Self {
        let endpoint = normalize_url(endpoint.trim_end_matches("/api/generate"));
        Self {
            endpoint,
            model: model.to_string(),
        }
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    fn short_client(&self) -> Result<Client> {
        Client::builder()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
            .build()
            .map_err(ServiceError::from)
    }

    fn long_client(&self) -> Result<Client> {
        Client::builder()
            .timeout(Duration::from_secs(GENERATE_TIMEOUT_SECS))
            .build()
            .map_err(ServiceError::from)
    }

    pub async fn validate_connection(&self) -> Result<String> {
        let client = self.short_client()?;
        let resp: TagsResponse = client
            .get(format!("{}/api/tags", self.endpoint))
            .send()
            .await
            .map_err(ServiceError::from)?
            .json()
            .await
            .map_err(ServiceError::from)?;
        Ok(format!("Ollama ready, {} model(s) available", resp.models.len()))
    }

    pub async fn get_available_models(&self) -> Vec<String> {
        let client = match self.short_client() {
            Ok(c) => c,
            Err(_) => return vec![],
        };
        let resp = match client.get(format!("{}/api/tags", self.endpoint)).send().await {
            Ok(r) => r,
            Err(_) => return vec![],
        };
        let parsed: TagsResponse = match resp.json().await {
            Ok(t) => t,
            Err(_) => return vec![],
        };
        parsed.models.into_iter().map(|m| m.name).collect()
    }

    pub async fn generate_text(
        &self,
        prompt: &str,
        json_format: bool,
        temperature: Option<f64>,
        model_override: Option<&str>,
    ) -> Option<String> {
        let client = self.long_client().ok()?;
        let mut body = serde_json::json!({
            "model": model_override.unwrap_or(&self.model),
            "prompt": prompt,
            "stream": false,
        });
        if json_format {
            body["format"] = serde_json::json!("json");
        }
        if let Some(t) = temperature {
            body["temperature"] = serde_json::json!(t);
        }
        let resp = client
            .post(format!("{}/api/generate", self.endpoint))
            .json(&body)
            .send()
            .await
            .ok()?;
        let parsed: GenerateResponse = resp.json().await.ok()?;
        let text = parsed.response.trim().to_string();
        if text.is_empty() { None } else { Some(text) }
    }

    pub async fn chat(
        &self,
        system_prompt: &str,
        user_message: &str,
        history: &[ChatHistoryMessage],
        temperature: Option<f64>,
        model_override: Option<&str>,
    ) -> Option<String> {
        let client = self.long_client().ok()?;
        let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
            "role": "system",
            "content": system_prompt,
        })];
        let recent = if history.len() > 10 { &history[history.len() - 10..] } else { history };
        for msg in recent {
            messages.push(serde_json::json!({ "role": msg.role, "content": msg.content }));
        }
        messages.push(serde_json::json!({ "role": "user", "content": user_message }));
        let mut body = serde_json::json!({
            "model": model_override.unwrap_or(&self.model),
            "messages": messages,
            "stream": false,
        });
        if let Some(t) = temperature {
            body["temperature"] = serde_json::json!(t);
        }
        let resp = client
            .post(format!("{}/api/chat", self.endpoint))
            .json(&body)
            .send()
            .await
            .ok()?;
        let parsed: ChatResponse = resp.json().await.ok()?;
        parsed.message.and_then(|m| {
            let t = m.content.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        })
    }

    pub async fn embed(&self, text: &str, model_override: Option<&str>) -> Result<Vec<f64>> {
        let client = self.long_client()?;
        let body = serde_json::json!({
            "model": model_override.unwrap_or(&self.model),
            "prompt": text,
        });
        let resp = client
            .post(format!("{}/api/embeddings", self.endpoint))
            .json(&body)
            .send()
            .await
            .map_err(ServiceError::from)?;
        let parsed: EmbeddingsResponse = resp.json().await.map_err(ServiceError::from)?;
        Ok(parsed.embedding)
    }
}

/// High-level Ollama service held in app state.
pub struct OllamaService {
    state: tokio::sync::Mutex<Option<OllamaClient>>,
}

impl OllamaService {
    pub fn new() -> Self {
        Self {
            state: tokio::sync::Mutex::new(None),
        }
    }

    pub async fn configure(&self, endpoint: &str, model: &str) {
        let mut guard = self.state.lock().await;
        *guard = Some(OllamaClient::new(endpoint, model));
    }

    pub async fn test_connection(&self, endpoint: &str) -> Result<String> {
        let client = OllamaClient::new(endpoint, "");
        client.validate_connection().await
    }

    pub async fn get_models(&self, endpoint: &str) -> Vec<String> {
        let client = OllamaClient::new(endpoint, "");
        client.get_available_models().await
    }

    pub async fn client_for(&self, endpoint: &str, model: &str) -> OllamaClient {
        let guard = self.state.lock().await;
        if let Some(c) = guard.as_ref() {
            if !endpoint.is_empty() || !model.is_empty() {
                return c.clone();
            }
        }
        drop(guard);
        OllamaClient::new(endpoint, model)
    }

    fn model_or(config: &OllamaConfig, override_name: Option<&str>, fallback: &str) -> String {
        override_name
            .map(String::from)
            .or_else(|| {
                let field = match fallback {
                    "jql" => config.jql_model.clone(),
                    "chat" => config.chat_model.clone(),
                    "extraction" => config.extraction_model.clone(),
                    "insight" => config.insight_model.clone(),
                    _ => None,
                };
                field.filter(|s| !s.is_empty())
            })
            .unwrap_or_else(|| {
                if config.model.is_empty() {
                    "qwen2.5:7b".to_string()
                } else {
                    config.model.clone()
                }
            })
    }

    pub async fn polish_bug_report(
        &self,
        config: &OllamaConfig,
        draft: &crate::models::jira::BugFormDraft,
    ) -> Result<crate::models::jira::BugPreview> {
        let client = self.client_for(&config.endpoint, &config.model).await;
        let prompt = prompts::bug_polish_prompt(draft);
        let model = Self::model_or(config, None, "");
        let raw = client
            .generate_text(&prompt, true, None, Some(&model))
            .await
            .ok_or_else(|| ServiceError::Api("Ollama failed to polish bug report".into()))?;
        let value = crate::services::text_utils::extract_json_block(&raw)
            .ok_or_else(|| ServiceError::Api("Polished bug report was not valid JSON".into()))?;
        Ok(crate::models::jira::BugPreview {
            summary: value["summary"].as_str().unwrap_or("").to_string(),
            description: value["description"].as_str().unwrap_or("").to_string(),
            priority: value["priority"].as_str().unwrap_or("Medium").to_string(),
            labels: value["labels"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        })
    }

    pub async fn generate_jql(
        &self,
        config: &OllamaConfig,
        prompt: &str,
        project_key: &str,
    ) -> Result<Option<String>> {
        let client = self.client_for(&config.endpoint, &config.model).await;
        let model = Self::model_or(config, None, "jql");
        let full_prompt = prompts::jql_prompt(prompt, project_key);
        let raw = client.generate_text(&full_prompt, true, None, Some(&model)).await;
        let raw = match raw {
            Some(r) => r,
            None => return Ok(None),
        };
        let value = crate::services::text_utils::extract_json_block(&raw);
        Ok(value.and_then(|v| v["jql"].as_str().map(String::from)))
    }

    pub async fn summarize_confluence(
        &self,
        config: &OllamaConfig,
        query: &str,
        content: &str,
    ) -> Result<String> {
        let client = self.client_for(&config.endpoint, &config.model).await;
        let model = Self::model_or(config, None, "");
        let prompt = prompts::confluence_summary_prompt(query, content);
        client
            .generate_text(&prompt, false, None, Some(&model))
            .await
            .ok_or_else(|| ServiceError::Api("Ollama summarisation failed".into()))
    }

    pub async fn build_dashboard_insight(
        &self,
        config: &OllamaConfig,
        serialized_data: &str,
    ) -> Result<String> {
        let client = self.client_for(&config.endpoint, &config.model).await;
        let model = Self::model_or(config, None, "insight");
        let prompt = prompts::dashboard_insight_prompt(serialized_data);
        client
            .generate_text(&prompt, false, None, Some(&model))
            .await
            .ok_or_else(|| ServiceError::Api("Ollama insight generation failed".into()))
    }

    pub async fn chat(
        &self,
        config: &OllamaConfig,
        system_prompt: &str,
        user_message: &str,
        history: &[ChatHistoryMessage],
        temperature: Option<f64>,
    ) -> Option<String> {
        let client = self.client_for(&config.endpoint, &config.model).await;
        let model = Self::model_or(config, None, "chat");
        client
            .chat(system_prompt, user_message, history, temperature, Some(&model))
            .await
    }

    pub async fn extract_test_cases(
        &self,
        config: &OllamaConfig,
        body_text: &str,
        depth: &str,
        rag_context: Option<&str>,
        ocr_text: Option<&str>,
    ) -> crate::models::test_case::TestCaseExtractionRun {
        let client = self.client_for(&config.endpoint, &config.model).await;
        let model = Self::model_or(config, None, "extraction");
        let mut cases: Vec<crate::models::test_case::ExtractedTestCase> = Vec::new();
        let used_fallback = false;
        let mut saw_valid_empty_response = false;

        let temperature_schedule = [0.15, 0.05, 0.02];
        let retry_reminders = [
            "",
            "\n\n[IMPORTANT] Output only a JSON object with exactly one top-level key: \"testCases\". Every test case must include sourceEvidence copied exactly from REQUIREMENT TEXT or OCR TEXT.",
            "\n\n[CRITICAL RETRY] The previous response was not in the required format. Return only {\"testCases\":[...]} and nothing else. If you cannot cite exact sourceEvidence, return {\"testCases\":[]}.",
        ];
        let source_corpus = build_source_corpus(body_text, ocr_text);

        for chunk in chunk_content(body_text, 0) {
            let mut chunk_cases: Vec<crate::models::test_case::ExtractedTestCase> = Vec::new();
            for attempt in 0..retry_reminders.len() {
                let prompt = format!(
                    "{}{}",
                    prompts::test_case_extraction_prompt(&chunk, depth, rag_context, ocr_text),
                    retry_reminders[attempt]
                );
                let temperature = temperature_schedule[attempt];
                if let Some(raw) = client
                    .generate_text(&prompt, true, Some(temperature), Some(&model))
                    .await
                {
                    if let Some(parsed) = parse_extracted_test_cases(&raw) {
                        if parsed.is_empty() {
                            saw_valid_empty_response = true;
                            break;
                        }

                        let supported = filter_supported_test_cases(parsed, &source_corpus);
                        if !supported.is_empty() {
                            chunk_cases.extend(supported);
                            break;
                        }
                    }
                }
            }

            if !chunk_cases.is_empty() {
                cases.extend(chunk_cases);
            }
        }

        if !cases.is_empty() {
            return crate::models::test_case::TestCaseExtractionRun {
                test_cases: deduplicate_test_cases(cases),
                used_fallback,
            };
        }

        if saw_valid_empty_response {
            return crate::models::test_case::TestCaseExtractionRun {
                test_cases: Vec::new(),
                used_fallback,
            };
        }

        crate::models::test_case::TestCaseExtractionRun {
            test_cases: fallback_test_cases(body_text, depth),
            used_fallback: true,
        }
    }
}

fn parse_extracted_test_cases(raw: &str) -> Option<Vec<crate::models::test_case::ExtractedTestCase>> {
    let value = crate::services::text_utils::extract_json_block(raw)?;
    Some(parse_extracted_test_cases_value(&value))
}

fn parse_extracted_test_cases_value(
    value: &serde_json::Value,
) -> Vec<crate::models::test_case::ExtractedTestCase> {
    const TEST_CASE_KEYS: &[&str] = &[
        "testCases",
        "test_cases",
        "TestCases",
        "testcase",
        "testCasesList",
    ];

    if let Some(arr) = value.as_array() {
        return arr
            .iter()
            .enumerate()
            .filter_map(|(idx, item)| normalize_test_case(item, idx))
            .collect();
    }

    if let Some(obj) = value.as_object() {
        for key in TEST_CASE_KEYS {
            if let Some(arr) = obj.get(*key).and_then(|v| v.as_array()) {
                let parsed: Vec<_> = arr
                    .iter()
                    .enumerate()
                    .filter_map(|(idx, item)| normalize_test_case(item, idx))
                    .collect();
                if !parsed.is_empty() {
                    return parsed;
                }
            }
        }

        if let Some((_, arr)) = obj.iter().find(|(_, v)| {
            v.as_array()
                .map(|items| {
                    items.first().map(|first| {
                        first.get("title").is_some()
                            || first.get("objective").is_some()
                            || first.get("test_case_name").is_some()
                    }).unwrap_or(false)
                })
                .unwrap_or(false)
        }) {
            if let Some(items) = arr.as_array() {
                let parsed: Vec<_> = items
                    .iter()
                    .enumerate()
                    .filter_map(|(idx, item)| normalize_test_case(item, idx))
                    .collect();
                if !parsed.is_empty() {
                    return parsed;
                }
            }
        }
    }

    Vec::new()
}

fn normalize_test_case(
    value: &serde_json::Value,
    index: usize,
) -> Option<crate::models::test_case::ExtractedTestCase> {
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(String::from)
        .unwrap_or_else(|| format!("TC-{:03}", index + 1));

    let title = value
        .get("title")
        .or_else(|| value.get("test_case_name"))
        .or_else(|| value.get("testCaseName"))
        .or_else(|| value.get("name"))
        .or_else(|| value.get("summary"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let objective = value
        .get("objective")
        .or_else(|| value.get("expected_result"))
        .or_else(|| value.get("expectedResult"))
        .or_else(|| value.get("description"))
        .or_else(|| value.get("steps"))
        .and_then(|v| {
            if let Some(s) = v.as_str() {
                Some(s.to_string())
            } else if let Some(arr) = v.as_array() {
                Some(
                    arr.iter()
                        .filter_map(|item| item.as_str())
                        .collect::<Vec<_>>()
                        .join("; "),
                )
            } else {
                None
            }
        })
        .unwrap_or_default()
        .trim()
        .to_string();

    if title.is_empty() || objective.is_empty() {
        return None;
    }

    let priority = value
        .get("priority")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|p| matches!(*p, "P1" | "P2" | "P3"))
        .unwrap_or("P2")
        .to_string();
    let category = value
        .get("category")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .unwrap_or("Functional")
        .to_string();

    Some(crate::models::test_case::ExtractedTestCase {
        id,
        title,
        objective,
        priority,
        category,
        selected: value
            .get("selected")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        source_evidence: value
            .get("sourceEvidence")
            .or_else(|| value.get("source_evidence"))
            .or_else(|| value.get("evidence"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from),
        confidence: value.get("confidence").and_then(|v| v.as_f64()),
    })
}

fn build_source_corpus(body_text: &str, ocr_text: Option<&str>) -> String {
    match ocr_text.map(str::trim).filter(|s| !s.is_empty()) {
        Some(ocr) => format!("{body_text}\n\n{ocr}"),
        None => body_text.to_string(),
    }
}

fn normalize_for_evidence(value: &str) -> String {
    value
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn filter_supported_test_cases(
    cases: Vec<crate::models::test_case::ExtractedTestCase>,
    source_corpus: &str,
) -> Vec<crate::models::test_case::ExtractedTestCase> {
    let normalized_source = normalize_for_evidence(source_corpus);
    cases
        .into_iter()
        .filter(|case| {
            case.source_evidence
                .as_deref()
                .map(normalize_for_evidence)
                .map(|evidence| evidence.len() >= 12 && normalized_source.contains(&evidence))
                .unwrap_or(false)
        })
        .collect()
}

fn fallback_test_cases(
    body_text: &str,
    depth: &str,
) -> Vec<crate::models::test_case::ExtractedTestCase> {
    let high = [
        "harus", "dapat", "validasi", "error", "gagal", "berhasil", "must", "should", "validate",
        "fail", "invalid", "verify", "successful",
    ];
    let low = [
        "klik", "sistem", "menampilkan", "bisa", "tekan", "masukkan", "pengguna", "admin",
        "salah", "click", "system", "display", "user", "input", "enter", "select", "allow",
    ];

    let mut scored: Vec<(String, f64)> = Vec::new();
    for (i, sentence) in body_text
        .split(|c: char| c == '.' || c == '?' || c == '!')
        .map(|s| s.trim())
        .filter(|s| s.len() > 20)
        .enumerate()
    {
        let lower = sentence.to_lowercase();
        let mut score = 0.0;
        for kw in high {
            if lower.contains(kw) {
                score += 3.0;
            }
        }
        for kw in low {
            if lower.contains(kw) {
                score += 1.0;
            }
        }
        score += std::cmp::max(0, 10 - i) as f64 * 0.5;
        score += (sentence.len() as f64 / 200.0).min(3.0);
        if score > 0.0 {
            scored.push((sentence.to_string(), score));
        }
    }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let threshold = if depth == "happy-path" { 4 } else { 8 };
    let selected: Vec<&(String, f64)> = scored.iter().take(threshold).collect();

    if selected.is_empty() {
        return vec![crate::models::test_case::ExtractedTestCase {
            id: "TC-001".into(),
            title: "Review requirement manually".into(),
            objective:
                "No structured requirement text was found. Review the linked Confluence page.".into(),
            priority: "P2".into(),
            category: "Manual Review".into(),
            selected: true,
            source_evidence: None,
            confidence: None,
        }];
    }

    selected
        .iter()
        .enumerate()
        .map(|(i, (sentence, _))| {
            let title = if sentence.len() > 72 {
                format!("{}...", &sentence[..69])
            } else {
                sentence.clone()
            };
            crate::models::test_case::ExtractedTestCase {
                id: format!("TC-{:03}", i + 1),
                title,
                objective: sentence.clone(),
                priority: if i < 2 { "P1" } else { "P2" }.into(),
                category: if depth == "edge-case" { "Edge Case".into() } else { "Functional".into() },
                selected: true,
                source_evidence: Some(sentence.clone()),
                confidence: None,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_direct_test_cases_array() {
        let raw = r#"{"testCases":[{"id":"TC-001","title":"Login valid","objective":"User logs in","priority":"P1","category":"Functional","selected":true}]}"#;
        let parsed = parse_extracted_test_cases(raw).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "TC-001");
        assert_eq!(parsed[0].title, "Login valid");
    }

    #[test]
    fn parses_snake_case_and_partial_fields() {
        let raw = r#"{"test_cases":[{"title":"Verify search","expected_result":"Result appears","priority":"P4","selected":false}]}"#;
        let parsed = parse_extracted_test_cases(raw).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "TC-001");
        assert_eq!(parsed[0].objective, "Result appears");
        assert_eq!(parsed[0].priority, "P2");
        assert!(!parsed[0].selected);
    }

    #[test]
    fn parses_plain_array_output() {
        let raw = r#"[{"test_case_name":"Verify checkout","description":"User can checkout"}]"#;
        let parsed = parse_extracted_test_cases(raw).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].title, "Verify checkout");
        assert_eq!(parsed[0].objective, "User can checkout");
    }

    #[test]
    fn filters_cases_without_matching_source_evidence() {
        let raw = r#"{"testCases":[
            {"title":"Verify login","objective":"User can login","sourceEvidence":"User can login with a valid password"},
            {"title":"Verify export","objective":"User can export reports","sourceEvidence":"User can export reports"}
        ]}"#;
        let parsed = parse_extracted_test_cases(raw).unwrap();
        let supported = filter_supported_test_cases(
            parsed,
            "The requirement says: User can login with a valid password.",
        );
        assert_eq!(supported.len(), 1);
        assert_eq!(supported[0].title, "Verify login");
    }

    #[test]
    fn filters_cases_without_source_evidence() {
        let raw = r#"{"testCases":[{"title":"Verify login","objective":"User can login"}]}"#;
        let parsed = parse_extracted_test_cases(raw).unwrap();
        let supported = filter_supported_test_cases(parsed, "User can login with a valid password.");
        assert!(supported.is_empty());
    }
}
