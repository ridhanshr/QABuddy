pub mod bootstrap;
pub mod config;
pub mod confluence;
pub mod cancel;
pub mod dashboard;
pub mod defect;
pub mod files;
pub mod jira;
pub mod logs;
pub mod ocr;
pub mod rag;
pub mod updates;

use crate::AppState;
use crate::models::app_config::AppConfig;
use tauri::State;

pub async fn load_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let mut config_store = state.config.lock().await;
    config_store.load().await.map_err(|e| e.to_string())
}
