use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn ocr_extract_from_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<Option<crate::models::rag::OcrResult>, String> {
    let ocr_service = state.ocr_service.lock().await;
    Ok(ocr_service.extract_text_from_file(&file_path))
}
