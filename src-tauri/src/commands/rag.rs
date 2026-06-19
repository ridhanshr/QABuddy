use chrono::Utc;
use tauri::{Emitter, State};

use crate::commands::load_config;
use crate::models::rag::{RagIndexProgress, RagSearchResult, RagStats};
use crate::services::rag::{chunk_text, VectorChunk};
use crate::services::text_utils::strip_html;
use crate::AppState;

const EMBEDDING_MODEL: &str = "nomic-embed-text";

#[tauri::command]
pub async fn rag_index_confluence(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    space_key: String,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    if config.confluence.base_url.is_empty() || config.confluence.token.is_empty() {
        return Err("Confluence belum dikonfigurasi.".into());
    }
    if config.ollama.endpoint.is_empty() {
        return Err("Ollama belum dikonfigurasi.".into());
    }

    let confluence_service = state.confluence_service.lock().await;
    let ollama_service = state.ollama_service.lock().await;
    let rag_service = state.rag_service.lock().await;

    let pages = confluence_service
        .list_pages(&config.confluence, &space_key)
        .await
        .map_err(|e| e.to_string())?;
    let total = pages.len() as u32;
    let client = ollama_service.client_for(&config.ollama.endpoint, EMBEDDING_MODEL).await;
    let mut indexed = 0u32;
    let mut skipped = 0u32;

    let _ = app_handle.emit(
        "rag-progress",
        RagIndexProgress {
            source: "confluence".into(),
            status: "fetching".into(),
            message: "Mengambil halaman Confluence...".into(),
            current: 0,
            total,
        },
    );

    for (idx, page) in pages.iter().enumerate() {
        let page_id = page["id"].as_str().unwrap_or("").to_string();
        let title = page["title"].as_str().unwrap_or("").to_string();
        let raw_content = page["body"]["storage"]["value"].as_str().unwrap_or("");
        let plain = strip_html(raw_content);
        if plain.trim().len() < 50 {
            skipped += 1;
            continue;
        }
        let page_url = format!(
            "{}/pages/viewpage.action?pageId={}",
            config.confluence.base_url.trim_end_matches('/'),
            page_id
        );
        let chunks = chunk_text(&plain);
        if chunks.is_empty() {
            skipped += 1;
            continue;
        }
        let _ = app_handle.emit(
            "rag-progress",
            RagIndexProgress {
                source: "confluence".into(),
                status: "embedding".into(),
                message: format!("Memproses {} ({}/{})", title, idx + 1, total),
                current: idx as u32 + 1,
                total,
            },
        );
        for (i, chunk) in chunks.iter().enumerate() {
            let embedding = client
                .embed(chunk, Some(EMBEDDING_MODEL))
                .await
                .unwrap_or_default();
            rag_service
                .upsert_chunk(VectorChunk {
                    id: format!("conf-{}-{}", page_id, i),
                    source: "confluence".into(),
                    source_id: page_id.clone(),
                    container_id: Some(space_key.clone()),
                    source_title: title.clone(),
                    source_url: page_url.clone(),
                    content: chunk.clone(),
                    embedding,
                    indexed_at: Utc::now().to_rfc3339(),
                })
                .map_err(|e| e.to_string())?;
        }
        indexed += 1;
    }

    let _ = rag_service.record_sync("confluence", &Utc::now().to_rfc3339());
    let _ = app_handle.emit(
        "rag-progress",
        RagIndexProgress {
            source: "confluence".into(),
            status: "done".into(),
            message: format!("Selesai! {} halaman diindeks, {} dilewati.", indexed, skipped),
            current: total,
            total,
        },
    );
    Ok(serde_json::json!({ "indexed": indexed, "skipped": skipped }))
}

#[tauri::command]
pub async fn rag_index_jira(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    project_key: String,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    if config.jira.base_url.is_empty() || config.jira.token.is_empty() {
        return Err("Jira belum dikonfigurasi.".into());
    }
    if config.ollama.endpoint.is_empty() {
        return Err("Ollama belum dikonfigurasi.".into());
    }

    let jira_service = state.jira_service.lock().await;
    let ollama_service = state.ollama_service.lock().await;
    let rag_service = state.rag_service.lock().await;
    let client = jira_service.client(&config.jira).map_err(|e| e.to_string())?;
    let total = 0u32;
    let _ = app_handle.emit(
        "rag-progress",
        RagIndexProgress {
            source: "jira".into(),
            status: "fetching".into(),
            message: "Mengambil issues dari Jira...".into(),
            current: 0,
            total,
        },
    );

    let mut indexed = 0u32;
    let mut skipped = 0u32;
    let mut start_at = 0u32;
    let mut issues: Vec<serde_json::Value> = Vec::new();
    loop {
        let page: serde_json::Value = client
            .api
            .get_json(
                "/search",
                &[
                    ("jql", format!("project = \"{}\" ORDER BY updated DESC", project_key)),
                    ("startAt", start_at.to_string()),
                    ("maxResults", "50".to_string()),
                    ("fields", "summary,description,status,priority,assignee,issuetype,labels,comment".to_string()),
                ],
            )
            .await
            .map_err(|e| e.to_string())?;
        let batch = page["issues"].as_array().cloned().unwrap_or_default();
        let total_from_api = page["total"].as_u64().unwrap_or(batch.len() as u64) as usize;
        let batch_len = batch.len();
        issues.extend(batch);
        if issues.len() >= total_from_api || batch_len < 50 {
            break;
        }
        start_at += 50;
    }

    let client = ollama_service.client_for(&config.ollama.endpoint, EMBEDDING_MODEL).await;
    let _ = app_handle.emit(
        "rag-progress",
        RagIndexProgress {
            source: "jira".into(),
            status: "embedding".into(),
            message: "Mengindeks issue Jira...".into(),
            current: 0,
            total: issues.len() as u32,
        },
    );

    for (idx, issue) in issues.iter().enumerate() {
        let key = issue["key"].as_str().unwrap_or("").to_string();
        let fields = &issue["fields"];
        let summary = fields["summary"].as_str().unwrap_or("").to_string();
        let mut text = vec![
            format!("[{}] {}", key, summary),
            format!("Type: {}", fields["issuetype"]["name"].as_str().unwrap_or("-")),
            format!("Status: {}", fields["status"]["name"].as_str().unwrap_or("-")),
            format!("Priority: {}", fields["priority"]["name"].as_str().unwrap_or("-")),
        ];
        if let Some(desc) = fields["description"].as_str() {
            text.push(format!("Description: {desc}"));
        }
        let full_text = text.join("\n");
        if full_text.trim().len() < 50 {
            skipped += 1;
            continue;
        }
        let chunks = chunk_text(&full_text);
        let issue_url = format!("{}/browse/{}", config.jira.base_url.trim_end_matches('/'), key);
        let _ = app_handle.emit(
            "rag-progress",
            RagIndexProgress {
                source: "jira".into(),
                status: "embedding".into(),
                message: format!("Memproses {} ({}/{})", key, idx + 1, issues.len()),
                current: idx as u32 + 1,
                total: issues.len() as u32,
            },
        );
        for (i, chunk) in chunks.iter().enumerate() {
            let embedding = client
                .embed(chunk, Some(EMBEDDING_MODEL))
                .await
                .unwrap_or_default();
            rag_service
                .upsert_chunk(VectorChunk {
                    id: format!("jira-{}-{}", key, i),
                    source: "jira".into(),
                    source_id: key.clone(),
                    container_id: Some(project_key.clone()),
                    source_title: format!("{}: {}", key, summary),
                    source_url: issue_url.clone(),
                    content: chunk.clone(),
                    embedding,
                    indexed_at: Utc::now().to_rfc3339(),
                })
                .map_err(|e| e.to_string())?;
        }
        indexed += 1;
    }

    let _ = rag_service.record_sync("jira", &Utc::now().to_rfc3339());
    let _ = app_handle.emit(
        "rag-progress",
        RagIndexProgress {
            source: "jira".into(),
            status: "done".into(),
            message: format!("Selesai! {} issues diindeks, {} dilewati.", indexed, skipped),
            current: issues.len() as u32,
            total: issues.len() as u32,
        },
    );
    Ok(serde_json::json!({ "indexed": indexed, "skipped": skipped }))
}

#[tauri::command]
pub async fn rag_search(state: State<'_, AppState>, query: String) -> Result<Vec<RagSearchResult>, String> {
    let config = load_config(state.clone()).await?;
    if config.ollama.endpoint.is_empty() {
        return Ok(vec![]);
    }
    let ollama_service = state.ollama_service.lock().await;
    let rag_service = state.rag_service.lock().await;
    let client = ollama_service.client_for(&config.ollama.endpoint, EMBEDDING_MODEL).await;
    let embedding = client.embed(&query, Some(EMBEDDING_MODEL)).await.map_err(|e| e.to_string())?;
    Ok(rag_service.search(&embedding, 5, None))
}

#[tauri::command]
pub async fn rag_get_stats(state: State<'_, AppState>) -> Result<RagStats, String> {
    let rag_service = state.rag_service.lock().await;
    Ok(rag_service.stats())
}

#[tauri::command]
pub async fn rag_clear_index(state: State<'_, AppState>, source: Option<String>) -> Result<(), String> {
    let rag_service = state.rag_service.lock().await;
    rag_service.clear(source.as_deref()).map_err(|e| e.to_string())
}
