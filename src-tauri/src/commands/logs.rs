use std::path::PathBuf;

use crate::models::test_case::{ExecutionStats, TestCaseExecution};
use crate::AppState;
use tauri::{AppHandle, Manager, State};

fn executions_path(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_default()
        .join("test-case-executions.json")
}

fn load_executions(app_handle: &AppHandle) -> Vec<TestCaseExecution> {
    let path = executions_path(app_handle);
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<TestCaseExecution>>(&raw).ok())
        .unwrap_or_default()
}

fn save_executions(app_handle: &AppHandle, data: &[TestCaseExecution]) -> Result<(), String> {
    let path = executions_path(app_handle);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    let raw = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_logs(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let logs_service = state.logs_service.lock().await;
    Ok(logs_service.get_logs())
}

#[tauri::command]
pub async fn save_logs(state: State<'_, AppState>, logs: Vec<serde_json::Value>) -> Result<(), String> {
    let mut logs_service = state.logs_service.lock().await;
    logs_service.save_logs(&logs).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_execution(
    app_handle: AppHandle,
    execution: TestCaseExecution,
) -> Result<(), String> {
    let mut data = load_executions(&app_handle);
    data.push(execution);
    save_executions(&app_handle, &data)
}

#[tauri::command]
pub async fn get_execution_history(
    app_handle: AppHandle,
    test_case_id: Option<String>,
) -> Result<Vec<TestCaseExecution>, String> {
    let mut data = load_executions(&app_handle);
    if let Some(id) = test_case_id {
        data.retain(|e| e.test_case_id == id);
    }
    Ok(data)
}

#[tauri::command]
pub async fn get_execution_stats(app_handle: AppHandle) -> Result<ExecutionStats, String> {
    let data = load_executions(&app_handle);
    let total = data.len() as u32;
    let total_passed = data.iter().filter(|e| e.result.eq_ignore_ascii_case("PASS")).count() as u32;
    let total_failed = data.iter().filter(|e| e.result.eq_ignore_ascii_case("FAILED")).count() as u32;
    let pass_rate = if total > 0 {
        (total_passed as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    Ok(ExecutionStats {
        total_executions: total,
        total_passed,
        total_failed,
        pass_rate,
    })
}
