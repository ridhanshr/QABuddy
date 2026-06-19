#[tauri::command]
pub async fn cancel_request(_request_id: String) -> Result<(), String> {
    Ok(())
}
