use crate::AppState;
use crate::models::app_config::AppConfig;
use crate::models::connection::{ConnectionStatus, HealthcheckResult};
use tauri::State;

#[tauri::command]
pub async fn save_config(
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<AppConfig, String> {
    let mut config_store = state.config.lock().await;
    config_store.save(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_ollama_models(
    state: State<'_, AppState>,
    endpoint: String,
) -> Result<Vec<String>, String> {
    let ollama_service = state.ollama_service.lock().await;
    Ok(ollama_service.get_models(&endpoint).await)
}

#[tauri::command]
pub async fn test_connections(state: State<'_, AppState>) -> Result<ConnectionStatus, String> {
    let mut config_store = state.config.lock().await;
    let config = config_store.load().await.map_err(|e| e.to_string())?;
    let qa_service = state.qa_service.lock().await;
    Ok(qa_service.test_connections(&config).await)
}

#[tauri::command]
pub async fn healthcheck(state: State<'_, AppState>) -> Result<HealthcheckResult, String> {
    let mut config_store = state.config.lock().await;
    let config = config_store.load().await.map_err(|e| e.to_string())?;
    let qa_service = state.qa_service.lock().await;
    Ok(qa_service.healthcheck(&config).await)
}
