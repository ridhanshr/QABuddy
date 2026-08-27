use super::load_config;
use crate::models::bitbucket::*;
use crate::services::bitbucket_service::BitbucketService;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_bitbucket_pr_details(
    state: State<'_, AppState>,
    pr_url_or_id: String,
) -> Result<BitbucketDiffSummary, String> {
    let config = load_config(state.clone()).await?;
    let service = BitbucketService::new(config);
    service.fetch_pr_details(&pr_url_or_id).await
}

#[tauri::command]
pub async fn fetch_bitbucket_diff(
    state: State<'_, AppState>,
    pr_url_or_id: String,
) -> Result<String, String> {
    let config = load_config(state.clone()).await?;
    let service = BitbucketService::new(config);
    let (project_key, repo_slug, pr_id) = service.parse_pr_url(&pr_url_or_id)?;
    service
        .fetch_raw_diff(&project_key, &repo_slug, pr_id)
        .await
}

#[tauri::command]
pub async fn generate_test_scenarios_from_bitbucket(
    state: State<'_, AppState>,
    request: BitbucketGenerateRequest,
) -> Result<BitbucketGenerateResponse, String> {
    let config = load_config(state.clone()).await?;
    // Build the Ollama client handle briefly, then release the lock so a long
    // LLM call doesn't block every other AI feature in the app.
    let ollama_client = {
        let ollama_service = state.ollama_service.lock().await;
        ollama_service
            .client_for(&config.ollama.endpoint, &config.ollama.model)
            .await
    };
    let rag_service = state.rag_service.lock().await.clone();
    let service = BitbucketService::new(config);
    service
        .generate_scenarios(request, ollama_client, rag_service)
        .await
}

/// AI Code Explainer: explain what a piece of Bitbucket PR code does.
#[tauri::command]
pub async fn explain_bitbucket_code(
    state: State<'_, AppState>,
    request: BitbucketExplainRequest,
) -> Result<BitbucketExplainResponse, String> {
    let config = load_config(state.clone()).await?;
    let ollama_client = {
        let ollama_service = state.ollama_service.lock().await;
        ollama_service
            .client_for(&config.ollama.endpoint, &config.ollama.model)
            .await
    };
    let rag_service = state.rag_service.lock().await.clone();
    let service = BitbucketService::new(config);
    service
        .explain_bitbucket_code(request, ollama_client, rag_service)
        .await
}
