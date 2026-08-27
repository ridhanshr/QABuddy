use crate::commands::load_config;
use crate::models::document_review::ReviewSummary;
use crate::services::document_review::review_document as run_review;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn review_document(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    page_id: String,
    jira_project_key: String,
) -> Result<ReviewSummary, String> {
    let config = load_config(state.clone()).await?;
    let confluence = state.confluence_service.lock().await;
    let jira = state.jira_service.lock().await;
    let ollama = state.ollama_service.lock().await;
    run_review(
        &confluence,
        &jira,
        Some(&ollama),
        &config,
        &page_id,
        &jira_project_key,
        Some(&app_handle),
    )
        .await
        .map_err(|error| error.to_string())
}
