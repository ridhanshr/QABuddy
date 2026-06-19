use crate::commands::load_config;
use crate::models::app_config::OllamaConfig;
use crate::models::misc::{ConfluencePreviewResult, ParseConfluenceEntriesOptions, ParseConfluenceEntriesResult, SyncToConfluencePayload, SyncToConfluenceResult};
use crate::models::test_case::ExtractedTestCaseResult;
use crate::AppState;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_confluence_page(
    state: State<'_, AppState>,
    page_id: String,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let confluence_service = state.confluence_service.lock().await;
    let (title, content, version) = confluence_service
        .get_page_preview(&config.confluence, &page_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "title": title, "content": content, "version": version }))
}

#[tauri::command]
pub async fn parse_confluence_entries(
    state: State<'_, AppState>,
    page_id: String,
    options: Option<ParseConfluenceEntriesOptions>,
) -> Result<ParseConfluenceEntriesResult, String> {
    let config = load_config(state.clone()).await?;
    let confluence_service = state.confluence_service.lock().await;
    let options = options.unwrap_or(ParseConfluenceEntriesOptions { debug: false });
    confluence_service
        .parse_confluence_entries(&config.confluence, &page_id, &options)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_confluence_sync(
    state: State<'_, AppState>,
    page_id: String,
    payload: serde_json::Value,
) -> Result<ConfluencePreviewResult, String> {
    let config = load_config(state.clone()).await?;
    let confluence_service = state.confluence_service.lock().await;
    let entries = payload["entries"].as_array().cloned().unwrap_or_default();
    confluence_service
        .preview_sync(&config.confluence, &page_id, &entries)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_to_confluence(
    state: State<'_, AppState>,
    page_id: String,
    payload: SyncToConfluencePayload,
) -> Result<SyncToConfluenceResult, String> {
    let config = load_config(state.clone()).await?;
    let confluence_service = state.confluence_service.lock().await;
    confluence_service
        .sync_to_confluence(&config.confluence, &page_id, &payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn extract_test_cases(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    url: String,
    depth: String,
) -> Result<ExtractedTestCaseResult, String> {
    let config = load_config(state.clone()).await?;
    if config.confluence.base_url.is_empty() || config.confluence.token.is_empty() {
        return Err("Confluence belum dikonfigurasi.".into());
    }

    let _ = app_handle.emit("extraction-progress", format!("Memuat halaman: {url}"));
    let page = {
        let confluence_service = state.confluence_service.lock().await;
        confluence_service
            .get_page_by_url(&config.confluence, &url)
            .await
            .map_err(|e| e.to_string())?
    };
    let page_title = page["title"].as_str().unwrap_or("").to_string();
    let page_content = page["body"]["storage"]["value"].as_str().unwrap_or("").to_string();
    let page_id = page["id"].as_str().unwrap_or("").to_string();
    let plain = crate::services::text_utils::strip_html(&page_content);

    let rag_context = build_rag_context(&state, &config.ollama, &page_id, &page_title, &plain, &app_handle).await;
    let ocr_text = collect_ocr_text(&state, &config.confluence, &page_id, &app_handle).await;

    let extracted = {
        let ollama_service = state.ollama_service.lock().await;
        let result = ollama_service
            .extract_test_cases(
                &config.ollama,
                &plain,
                &depth,
                rag_context.as_deref(),
                ocr_text.as_deref(),
            )
            .await;
        result
    };
    let _ = app_handle.emit("extraction-progress", "Selesai");

    Ok(ExtractedTestCaseResult {
        page_title,
        source_url: if page_id.is_empty() { url } else { format!("{}?pageId={}", config.confluence.base_url.trim_end_matches('/'), page_id) },
        test_cases: extracted.test_cases,
        is_fallback: Some(extracted.used_fallback),
    })
}

async fn build_rag_context(
    state: &State<'_, AppState>,
    ollama_config: &OllamaConfig,
    page_id: &str,
    page_title: &str,
    plain_text: &str,
    app_handle: &AppHandle,
) -> Option<String> {
    if ollama_config.endpoint.trim().is_empty() {
        return None;
    }

    let embed_model = ollama_config
        .defect_embedding_model
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(ollama_config.model.as_str());

    let query = format!(
        "test cases requirement acceptance criteria {} {}",
        page_title,
        plain_text.chars().take(600).collect::<String>()
    );

    let embedding = {
        let ollama_service = state.ollama_service.lock().await;
        let client = ollama_service
            .client_for(&ollama_config.endpoint, embed_model)
            .await;
        match client.embed(&query, Some(embed_model)).await {
            Ok(embedding) => embedding,
            Err(_) => return None,
        }
    };

    let snippets = {
        let rag_service = state.rag_service.lock().await;
        let mut snippets: Vec<Value> = Vec::new();

        let exact_chunks = rag_service.chunks_by_source_id("confluence", page_id);
        snippets.extend(exact_chunks.into_iter().map(|chunk| {
            serde_json::json!({
                "content": chunk.content,
                "sourceTitle": chunk.source_title,
                "sourceUrl": chunk.source_url,
                "score": 1.0,
            })
        }));

        snippets.extend(rag_service.search(&embedding, 4, Some("confluence")).into_iter().map(|item| {
            serde_json::json!({
                "content": item.content,
                "sourceTitle": item.source_title,
                "sourceUrl": item.source_url,
                "score": item.score,
            })
        }));
        snippets.extend(rag_service.search(&embedding, 4, Some("jira")).into_iter().map(|item| {
            serde_json::json!({
                "content": item.content,
                "sourceTitle": item.source_title,
                "sourceUrl": item.source_url,
                "score": item.score,
            })
        }));
        snippets
    };

    if snippets.is_empty() {
        let _ = app_handle.emit("extraction-progress", "Tidak ada konteks RAG yang cocok");
        return None;
    }

    let mut seen = std::collections::HashSet::new();
    let mut lines = Vec::new();
    for (idx, snippet) in snippets.into_iter().enumerate() {
        let source_url = snippet["sourceUrl"].as_str().unwrap_or("").to_string();
        if !seen.insert(source_url.clone()) {
            continue;
        }
        let title = snippet["sourceTitle"].as_str().unwrap_or("").to_string();
        let content = snippet["content"].as_str().unwrap_or("").to_string();
        let score = snippet["score"].as_f64().unwrap_or(0.0);
        let content = content.chars().take(1200).collect::<String>();
        lines.push(format!("[{}] {} (score {:.2})\n{}", idx + 1, title, score, content));
        if lines.len() >= 6 {
            break;
        }
    }

    if lines.is_empty() {
        None
    } else {
        let _ = app_handle.emit("extraction-progress", "Menambahkan konteks RAG");
        Some(lines.join("\n\n"))
    }
}

async fn collect_ocr_text(
    state: &State<'_, AppState>,
    confluence_config: &crate::models::app_config::ConfluenceConfig,
    page_id: &str,
    app_handle: &AppHandle,
) -> Option<String> {
    if page_id.is_empty() {
        return None;
    }

    let attachments = {
        let confluence_service = state.confluence_service.lock().await;
        confluence_service
            .get_attachments(confluence_config, page_id)
            .await
            .ok()?
    };

    let image_attachments: Vec<Value> = attachments
        .into_iter()
        .filter(|att| {
            let ct = att["contentType"].as_str().unwrap_or("").to_lowercase();
            let mime = att["mimeType"].as_str().unwrap_or("").to_lowercase();
            let title = att["title"].as_str().unwrap_or("").to_lowercase();
            ct.starts_with("image/")
                || mime.starts_with("image/")
                || title.ends_with(".png")
                || title.ends_with(".jpg")
                || title.ends_with(".jpeg")
                || title.ends_with(".gif")
                || title.ends_with(".webp")
                || title.ends_with(".bmp")
        })
        .take(5)
        .collect();

    if image_attachments.is_empty() {
        return None;
    }

    let _ = app_handle.emit(
        "extraction-progress",
        format!("OCR lampiran gambar: {} file", image_attachments.len()),
    );

    let mut texts = Vec::new();
    for (idx, att) in image_attachments.iter().enumerate() {
        let title = att["title"].as_str().unwrap_or("attachment").to_string();
        let download = att["_links"]["download"]
            .as_str()
            .or_else(|| att["downloadUrl"].as_str());
        let Some(download_path) = download else {
            continue;
        };

        let bytes = {
            let confluence_service = state.confluence_service.lock().await;
            match confluence_service
                .download_attachment(confluence_config, download_path)
                .await
            {
                Ok(bytes) => bytes,
                Err(_) => continue,
            }
        };

        let ocr_result = {
            let ocr_service = state.ocr_service.lock().await;
            ocr_service.extract_text_from_bytes(&bytes, &title)
        };

        if let Some(result) = ocr_result {
            texts.push(format!(
                "[OCR {} / {} dari {}]\n{}",
                idx + 1,
                image_attachments.len(),
                result.source_attachment,
                result.text
            ));
        }
    }

    if texts.is_empty() {
        None
    } else {
        Some(texts.join("\n\n"))
    }
}
