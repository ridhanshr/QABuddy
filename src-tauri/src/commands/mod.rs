pub mod bitbucket_commands;
pub mod bootstrap;
pub mod brd;
pub mod cancel;
pub mod config;
pub mod confluence;
pub mod dashboard;
pub mod db;
pub mod defect;
pub mod document_review;
pub mod files;
pub mod jira;
pub mod logs;
pub mod ocr;
pub mod rag;
pub mod updates;

use crate::models::app_config::AppConfig;
use crate::AppState;
use tauri::State;

pub async fn load_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let mut config_store = state.config.lock().await;
    config_store.load().await.map_err(|e| e.to_string())
}
