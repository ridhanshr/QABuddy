use crate::commands::load_config;
use crate::models::app_config::AppConfig;
use crate::models::chat::{ChatHistoryMessage, ChatResponse, IntentRoute, ProjectInsightRequest};
use crate::models::connection::{BugMetrics, ConfluencePageSummary, DashboardDigest, DashboardProjectData};
use crate::models::jira::{BugFormDraft, BugPreview, DefectCreateDraft};
use crate::models::rag::RagSearchResult;
use crate::services::prompts;
use crate::AppState;
use tauri::State;

const CHAT_EMBEDDING_MODEL: &str = "nomic-embed-text";

fn demo_dashboard() -> DashboardDigest {
    DashboardDigest {
        is_demo: Some(true),
        insight: "Jira belum dikonfigurasi. Dashboard ini menampilkan data demo.".to_string(),
        ready_for_qa: vec![],
        bug_metrics: BugMetrics::default(),
        projects: Default::default(),
        sprint_report: None,
    }
}

#[tauri::command]
pub async fn get_dashboard(
    state: State<'_, AppState>,
    skip_insight: Option<bool>,
) -> Result<DashboardDigest, String> {
    let config = load_config(state.clone()).await?;
    if config.jira.base_url.is_empty() || config.jira.token.is_empty() {
        return Ok(demo_dashboard());
    }

    let jira_service = state.jira_service.lock().await;
    let ollama_service = state.ollama_service.lock().await;
    let first_project = config.dashboard.projects.iter().find(|p| p.enabled);
    let main_project_key = first_project.map(|p| p.project_key.clone()).unwrap_or_default();
    let main_issue_type = first_project.map(|p| p.issue_type.clone()).unwrap_or_default();
    let exclude_labels = first_project.map(|p| p.exclude_labels.clone()).unwrap_or_default();
    let include_labels = first_project.map(|p| p.include_labels.clone()).unwrap_or_default();
    let exclude_statuses = first_project.map(|p| p.exclude_statuses.clone()).unwrap_or_default();
    let include_statuses = first_project.map(|p| p.include_statuses.clone()).unwrap_or_default();

    let ready_for_qa = jira_service
        .get_ready_for_qa_issues(
            &config.jira,
            if main_project_key.is_empty() { None } else { Some(main_project_key.as_str()) },
            if main_issue_type.is_empty() { None } else { Some(main_issue_type.as_str()) },
            &exclude_labels,
            &include_labels,
            &exclude_statuses,
            &include_statuses,
        )
        .await
        .unwrap_or_default();
    let bug_metrics = jira_service
        .get_bug_metrics(
            &config.jira,
            if main_project_key.is_empty() { None } else { Some(main_project_key.as_str()) },
            if main_issue_type.is_empty() { None } else { Some(main_issue_type.as_str()) },
            &exclude_labels,
            &include_labels,
            &exclude_statuses,
            &include_statuses,
        )
        .await
        .unwrap_or_default();
    let sprint_report = jira_service.get_sprint_report(&config.jira).await.unwrap_or(None);

    let mut projects = std::collections::BTreeMap::<String, DashboardProjectData>::new();
    for pc in config.dashboard.projects.iter().filter(|p| p.enabled) {
        let ready = jira_service
            .get_ready_for_qa_issues(
                &config.jira,
                Some(pc.project_key.as_str()),
                Some(pc.issue_type.as_str()),
                &pc.exclude_labels,
                &pc.include_labels,
                &pc.exclude_statuses,
                &pc.include_statuses,
            )
            .await
            .unwrap_or_default();
        let bugs = jira_service
            .get_bug_metrics(
                &config.jira,
                Some(pc.project_key.as_str()),
                Some(pc.issue_type.as_str()),
                &pc.exclude_labels,
                &pc.include_labels,
                &pc.exclude_statuses,
                &pc.include_statuses,
            )
            .await
            .unwrap_or_default();
        projects.insert(pc.project_key.clone(), DashboardProjectData { bug_metrics: bugs, ready_for_qa: ready });
    }

    let insight = if skip_insight.unwrap_or(false) || config.ollama.endpoint.is_empty() {
        format!(
            "{} bug terbuka, {} issue siap QA{}.",
            bug_metrics.total_open,
            ready_for_qa.len(),
            if sprint_report.is_some() { " dan sprint report tersedia" } else { "" }
        )
    } else {
        ollama_service
            .build_dashboard_insight(
                &config.ollama,
                &serde_json::to_string(&serde_json::json!({
                    "readyForQa": ready_for_qa,
                    "bugMetrics": bug_metrics,
                    "sprintReport": sprint_report,
                    "projectKey": main_project_key,
                    "projects": projects.keys().collect::<Vec<_>>(),
                }))
                .map_err(|e| e.to_string())?,
            )
            .await
            .unwrap_or_else(|_| "Insight tidak tersedia".to_string())
    };

    Ok(DashboardDigest {
        insight,
        ready_for_qa,
        bug_metrics,
        projects,
        sprint_report,
        is_demo: None,
    })
}

#[tauri::command]
pub async fn get_project_insight(
    state: State<'_, AppState>,
    request: ProjectInsightRequest,
) -> Result<String, String> {
    let config = load_config(state.clone()).await?;
    let ollama_service = state.ollama_service.lock().await;
    if !config.ollama.endpoint.is_empty() {
        return ollama_service
            .build_dashboard_insight(
                &config.ollama,
                &serde_json::to_string(&request).map_err(|e| e.to_string())?,
            )
            .await
            .map_err(|e| e.to_string());
    }
    Ok(format!(
        "Dashboard {} - {} bug terbuka, {} issue siap QA.",
        request.project_key,
        request.bug_metrics.total_open,
        request.ready_for_qa.len()
    ))
}

#[tauri::command]
pub async fn ask_assistant(
    state: State<'_, AppState>,
    prompt: String,
    history: Option<Vec<ChatHistoryMessage>>,
) -> Result<ChatResponse, String> {
    let config = load_config(state.clone()).await?;
    let history = history.unwrap_or_default();

    let route = crate::services::intent_router::IntentRouter::new().classify(&prompt).route;
    match route {
        IntentRoute::Jira => {
            let jql = if !config.ollama.endpoint.is_empty() {
                let ollama_service = state.ollama_service.lock().await;
                ollama_service
                    .generate_jql(&config.ollama, &prompt, &config.jira.project_key)
                    .await
                    .unwrap_or_else(|_| Some(format!("project = \"{}\" ORDER BY updated DESC", config.jira.project_key)))
                    .unwrap_or_else(|| format!("project = \"{}\" ORDER BY updated DESC", config.jira.project_key))
            } else {
                format!("project = \"{}\" ORDER BY updated DESC", config.jira.project_key)
            };
            let issues = search_jira_issues(&state, &config, &jql, 8).await;
            let answer = if !config.ollama.endpoint.is_empty() {
                let user_message = format!(
                    "Pertanyaan pengguna:\n{prompt}\n\nJQL yang dijalankan:\n{jql}\n\nDATA JIRA TERBARU:\n{}",
                    serde_json::to_string_pretty(&issues).unwrap_or_default()
                );
                let ollama_service = state.ollama_service.lock().await;
                ollama_service
                    .chat(
                        &config.ollama,
                        prompts::jira_first_chat_system_prompt(),
                        &user_message,
                        &history,
                        Some(0.1),
                    )
                    .await
                    .unwrap_or_else(|| "Tidak dapat menghasilkan jawaban.".to_string())
            } else {
                format!(
                    "Ditemukan {} issue. JQL: {}",
                    issues.len(),
                    jql
                )
            };
            Ok(ChatResponse {
                mode: "jira".into(),
                answer,
                jql: Some(jql),
                issues: Some(issues),
                pages: None,
            })
        }
        IntentRoute::Confluence => {
            let rag_results = search_rag_context(&state, &config, &prompt, Some("confluence"), 5)
                .await
                .unwrap_or_default();
            let pages = pages_from_rag(&rag_results);
            let rag_context = format_rag_context(&rag_results);
            let answer = if config.ollama.endpoint.is_empty() {
                "Confluence terkonfigurasi, tetapi Ollama belum aktif untuk ringkasan.".to_string()
            } else if rag_context.is_empty() {
                "Saya belum menemukan konteks Confluence yang relevan di Knowledge Base. Jalankan sync/index Confluence terlebih dahulu atau sebutkan halaman yang lebih spesifik.".to_string()
            } else {
                let user_message = format!(
                    "Pertanyaan pengguna:\n{prompt}\n\nKONTEKS CONFLUENCE TERINDEKS:\n{rag_context}"
                );
                let ollama_service = state.ollama_service.lock().await;
                ollama_service
                    .chat(
                        &config.ollama,
                        prompts::knowledge_base_chat_system_prompt(),
                        &user_message,
                        &history,
                        Some(0.1),
                    )
                    .await
                    .unwrap_or_else(|| "Tidak dapat menghasilkan jawaban.".to_string())
            };
            Ok(ChatResponse {
                mode: "confluence".into(),
                answer,
                jql: None,
                issues: None,
                pages: Some(pages),
            })
        }
        IntentRoute::Mixed => {
            let jql = if !config.jira.project_key.trim().is_empty() {
                if !config.ollama.endpoint.is_empty() {
                    let ollama_service = state.ollama_service.lock().await;
                    ollama_service
                        .generate_jql(&config.ollama, &prompt, &config.jira.project_key)
                        .await
                        .unwrap_or_else(|_| Some(format!("project = \"{}\" ORDER BY updated DESC", config.jira.project_key)))
                        .unwrap_or_else(|| format!("project = \"{}\" ORDER BY updated DESC", config.jira.project_key))
                } else {
                    format!("project = \"{}\" ORDER BY updated DESC", config.jira.project_key)
                }
            } else {
                String::new()
            };
            let issues = if jql.is_empty() {
                Vec::new()
            } else {
                search_jira_issues(&state, &config, &jql, 6).await
            };
            let rag_results = search_rag_context(&state, &config, &prompt, Some("confluence"), 6)
                .await
                .unwrap_or_default();
            let pages = pages_from_rag(&rag_results);
            let rag_context = format_rag_context(&rag_results);
            let answer = if config.ollama.endpoint.is_empty() {
                format!(
                    "Ollama belum aktif. Saya menemukan {} issue Jira dan {} potongan Knowledge Base yang relevan.",
                    issues.len(),
                    rag_results.len()
                )
            } else if issues.is_empty() && rag_context.is_empty() {
                "Saya belum menemukan data Jira atau Knowledge Base yang cukup untuk menjawab. Sebutkan project, issue key, halaman Confluence, atau jalankan sync/index terlebih dahulu.".to_string()
            } else {
                let user_message = format!(
                    "Pertanyaan pengguna:\n{prompt}\n\nJQL yang dijalankan:\n{}\n\nDATA JIRA TERBARU:\n{}\n\nKONTEKS KNOWLEDGE BASE:\n{}",
                    if jql.is_empty() { "(tidak ada)" } else { &jql },
                    serde_json::to_string_pretty(&issues).unwrap_or_default(),
                    if rag_context.is_empty() { "(tidak ada)" } else { &rag_context }
                );
                let ollama_service = state.ollama_service.lock().await;
                ollama_service
                    .chat(
                        &config.ollama,
                        prompts::hybrid_chat_system_prompt(),
                        &user_message,
                        &history,
                        Some(0.1),
                    )
                    .await
                    .unwrap_or_else(|| "Tidak dapat menghasilkan jawaban.".to_string())
            };
            Ok(ChatResponse {
                mode: "hybrid".into(),
                answer,
                jql: if jql.is_empty() { None } else { Some(jql) },
                issues: Some(issues),
                pages: Some(pages),
            })
        }
        IntentRoute::Clarify => Ok(ChatResponse {
            mode: "error".into(),
            answer: "Pertanyaan belum cukup spesifik. Sebutkan apakah yang dimaksud data Jira, dokumen Confluence, atau keduanya.".into(),
            jql: None,
            issues: None,
            pages: None,
        }),
    }
}

async fn search_jira_issues(
    state: &State<'_, AppState>,
    config: &AppConfig,
    jql: &str,
    max_results: u32,
) -> Vec<crate::models::connection::JiraIssueSummary> {
    if config.jira.base_url.trim().is_empty() || config.jira.token.trim().is_empty() {
        return Vec::new();
    }
    let jira_service = state.jira_service.lock().await;
    jira_service
        .search_issues(&config.jira, jql, max_results)
        .await
        .unwrap_or_default()
}

async fn search_rag_context(
    state: &State<'_, AppState>,
    config: &AppConfig,
    query: &str,
    source_filter: Option<&str>,
    limit: usize,
) -> Result<Vec<RagSearchResult>, String> {
    if config.ollama.endpoint.trim().is_empty() {
        return Ok(Vec::new());
    }
    let embedding = {
        let ollama_service = state.ollama_service.lock().await;
        let client = ollama_service
            .client_for(&config.ollama.endpoint, CHAT_EMBEDDING_MODEL)
            .await;
        client
            .embed(query, Some(CHAT_EMBEDDING_MODEL))
            .await
            .map_err(|e| e.to_string())?
    };
    let rag_service = state.rag_service.lock().await;
    Ok(rag_service.search(&embedding, limit, source_filter))
}

fn format_rag_context(results: &[RagSearchResult]) -> String {
    results
        .iter()
        .enumerate()
        .map(|(idx, item)| {
            let content = item.content.chars().take(1400).collect::<String>();
            format!(
                "[{}] {} (score {:.2})\nURL: {}\n{}",
                idx + 1,
                item.source_title,
                item.score,
                item.source_url,
                content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn pages_from_rag(results: &[RagSearchResult]) -> Vec<ConfluencePageSummary> {
    let mut seen = std::collections::HashSet::new();
    results
        .iter()
        .filter(|item| !item.source_url.trim().is_empty() && seen.insert(item.source_url.clone()))
        .take(5)
        .map(|item| ConfluencePageSummary {
            id: item.source_url.clone(),
            title: if item.source_title.trim().is_empty() {
                item.source_url.clone()
            } else {
                item.source_title.clone()
            },
            space_name: "Knowledge Base".into(),
            url: item.source_url.clone(),
            excerpt: item.content.chars().take(240).collect(),
        })
        .collect()
}

#[tauri::command]
pub async fn polish_bug_report(
    state: State<'_, AppState>,
    draft: BugFormDraft,
) -> Result<BugPreview, String> {
    let config = load_config(state.clone()).await?;
    let ollama_service = state.ollama_service.lock().await;
    if config.ollama.endpoint.is_empty() {
        return Ok(BugPreview {
            summary: draft.title.clone(),
            description: format!(
                "{}\n\nSteps:\n{}\n\nActual:\n{}\n\nExpected:\n{}\n\nEnv:\n{}",
                draft.title, draft.steps_to_reproduce, draft.actual_result, draft.expected_result, draft.environment
            ),
            priority: draft.priority.clone(),
            labels: draft
                .labels
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        });
    }
    ollama_service
        .polish_bug_report(&config.ollama, &draft)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_bug(
    state: State<'_, AppState>,
    draft: BugFormDraft,
    preview: BugPreview,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let result = jira_service
        .create_bug(&config.jira, &draft, &preview)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!(result))
}

#[tauri::command]
pub async fn create_defect_issue(
    state: State<'_, AppState>,
    draft: DefectCreateDraft,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let result = jira_service
        .create_defect_issue(&config.jira, &draft)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!(result))
}
