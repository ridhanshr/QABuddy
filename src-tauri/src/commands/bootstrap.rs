use crate::AppState;
use crate::models::connection::AppBootstrap;
use tauri::State;

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> Result<AppBootstrap, String> {
    let mut config_store = state.config.lock().await;
    let config = config_store.load().await.map_err(|e| e.to_string())?;
    let qa_service = state.qa_service.lock().await;
    Ok(qa_service.bootstrap(&config).await)
}
