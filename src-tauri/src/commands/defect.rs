use crate::commands::load_config;
use crate::models::defect::{DefectRecord, DefectRepositoryStats, DuplicateCandidate, DuplicateRelation, JiraProjectSource, SearchFilters};
use crate::AppState;
use tauri::State;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateRelationDraft {
    pub primary_defect_id: String,
    pub duplicate_defect_id: String,
    pub reason: String,
    pub confidence_score: f64,
    pub created_by: String,
}

#[tauri::command]
pub async fn get_defect_sources(state: State<'_, AppState>) -> Result<Vec<JiraProjectSource>, String> {
    let service = state.defect_repository_service.lock().await;
    service.get_sources().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_defect_source(
    state: State<'_, AppState>,
    source: JiraProjectSource,
) -> Result<Vec<JiraProjectSource>, String> {
    let service = state.defect_repository_service.lock().await;
    service.save_source(source).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_defect_source(state: State<'_, AppState>, id: String) -> Result<Vec<JiraProjectSource>, String> {
    let service = state.defect_repository_service.lock().await;
    service.delete_source(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_defect_source(
    state: State<'_, AppState>,
    project_key: String,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let mut service = state.defect_repository_service.lock().await;
    let (indexed, skipped) = service
        .sync_source(&config, &project_key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "indexed": indexed, "skipped": skipped }))
}

#[tauri::command]
pub async fn find_defect_duplicate_candidates(
    state: State<'_, AppState>,
    filters: SearchFilters,
) -> Result<Vec<DuplicateCandidate>, String> {
    let mut service = state.defect_repository_service.lock().await;
    service.find_duplicate_candidates(filters).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_defects(
    state: State<'_, AppState>,
    filters: SearchFilters,
) -> Result<serde_json::Value, String> {
    let mut service = state.defect_repository_service.lock().await;
    let (candidates, defects) = service.search_defects(filters).await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "candidates": candidates, "defects": defects }))
}

#[tauri::command]
pub async fn get_defect(state: State<'_, AppState>, id: String) -> Result<Option<DefectRecord>, String> {
    let service = state.defect_repository_service.lock().await;
    service.get_defect(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_defect_duplicate_relations(
    state: State<'_, AppState>,
    defect_id: String,
) -> Result<Vec<DuplicateRelation>, String> {
    let service = state.defect_repository_service.lock().await;
    service
        .get_duplicate_relations(defect_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mark_duplicate_defect(
    state: State<'_, AppState>,
    relation: DuplicateRelationDraft,
) -> Result<DuplicateRelation, String> {
    let service = state.defect_repository_service.lock().await;
    service
        .mark_duplicate(crate::services::defect_repository::OmitIdRelation {
            primary_defect_id: relation.primary_defect_id,
            duplicate_defect_id: relation.duplicate_defect_id,
            reason: relation.reason,
            confidence_score: relation.confidence_score,
            created_by: relation.created_by,
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_duplicate_defect_link(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let service = state.defect_repository_service.lock().await;
    service.remove_duplicate_link(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_defect_stats(state: State<'_, AppState>) -> Result<DefectRepositoryStats, String> {
    let service = state.defect_repository_service.lock().await;
    service.get_stats().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reindex_all_defects(state: State<'_, AppState>) -> Result<(), String> {
    let mut service = state.defect_repository_service.lock().await;
    service.reindex_all().await.map_err(|e| e.to_string())
}
