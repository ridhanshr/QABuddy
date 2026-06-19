use crate::models::misc::{DownloadProgress, UpdateInfo};
use crate::AppState;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn check_for_updates(state: State<'_, AppState>) -> Result<UpdateInfo, String> {
    let mut update_service = state.update_service.lock().await;
    Ok(update_service.check_for_updates(env!("CARGO_PKG_VERSION")).await)
}

#[tauri::command]
pub async fn get_update_status(state: State<'_, AppState>) -> Result<Option<UpdateInfo>, String> {
    let update_service = state.update_service.lock().await;
    Ok(update_service.get_cached_status())
}

#[tauri::command]
pub async fn download_and_install_update(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let mut update_service = state.update_service.lock().await;
    let emit_handle = app_handle.clone();
    update_service
        .download_and_install_update(&app_handle, move |progress: DownloadProgress| {
            let _ = emit_handle.emit("download-progress", progress);
        })
        .await
        .map_err(|e| e.to_string())
}
