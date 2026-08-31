use super::load_config;
use crate::models::bitbucket::*;
use crate::services::bitbucket_service::BitbucketService;
use crate::AppState;
use tauri::{AppHandle, State};

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
    app_handle: AppHandle,
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
        .generate_scenarios(request, ollama_client, rag_service, Some(&app_handle))
        .await
}

/// Create a Jira/Xray Test issue for each user-selected Bitbucket-generated
/// scenario (carrying over steps + expected result), optionally file them
/// into an Xray folder, and cache the resulting key in the local `test_case`
/// table (tc_key/id_jira_repo/title only — these are freshly-created issues
/// with no Test Execution association yet, so te_jira_key is left empty).
#[tauri::command]
pub async fn sync_bitbucket_scenarios_to_jira(
    state: State<'_, AppState>,
    request: BitbucketSyncScenariosRequest,
) -> Result<BitbucketSyncScenariosResponse, String> {
    let config = load_config(state.clone()).await?;
    let service = BitbucketService::new(config);
    let raw_results = service.sync_scenarios_to_jira(&request).await?;

    // Best-effort cache into the local test_case table — a DB hiccup here
    // must not hide the fact that the Jira issues were already created.
    if let Some(pool) = state.db_pool.lock().await.clone() {
        for (scenario_title, success, jira_key, _) in &raw_results {
            if !success {
                continue;
            }
            let Some(key) = jira_key.clone() else { continue };
            let id_jira_repo = key.rfind('-').map(|i| key[..i].to_string());
            let title = Some(scenario_title.clone());
            let result = sqlx::query(
                r#"
                INSERT INTO test_case (tc_key, te_jira_key, title, id_jira_repo, last_sync)
                VALUES (?, '', ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    title        = COALESCE(VALUES(title), title),
                    id_jira_repo = COALESCE(VALUES(id_jira_repo), id_jira_repo),
                    last_sync    = NOW()
                "#,
            )
            .bind(&key)
            .bind(title.as_deref())
            .bind(id_jira_repo.as_deref())
            .execute(&pool)
            .await;
            if let Err(e) = result {
                log::warn!("[sync_bitbucket_scenarios_to_jira] Gagal cache {key} ke test_case: {e}");
            }
        }
    }

    let results = raw_results
        .into_iter()
        .map(|(scenario, success, jira_key, error)| BitbucketSyncScenarioResult {
            scenario,
            success,
            jira_key,
            error,
        })
        .collect();
    Ok(BitbucketSyncScenariosResponse { results })
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
