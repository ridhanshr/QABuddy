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

const EXCLUDED_SEGMENTS: &[&str] = &["support", "ecm", "ncm ops"];

/// Extract the Jira project key from a uqa_project project_name.
/// Format: "QCM - <PROJECT_KEY> - <description>" or "QCM - <PROJECT_KEY> <description>"
/// Returns the trimmed segment right after the first " - ".
fn extract_project_key_from_uqa_name(project_name: &str) -> Option<String> {
    // Split on first " - " to get everything after "QCM"
    let after_first = project_name.splitn(2, " - ").nth(1)?.trim();
    // The project key is the first word-token (uppercase letters/digits) before the next " - " or space
    let segment = after_first.splitn(2, " - ").next()?.trim();
    // Check it's not an excluded category
    if EXCLUDED_SEGMENTS.iter().any(|ex| segment.to_lowercase() == *ex) {
        return None;
    }
    // Must look like a Jira project key: all uppercase letters and digits
    if segment.chars().all(|c| c.is_ascii_alphanumeric()) && segment.chars().any(|c| c.is_ascii_alphabetic()) {
        Some(segment.to_string())
    } else {
        None
    }
}

#[tauri::command]
pub async fn get_defect_sources(state: State<'_, AppState>) -> Result<Vec<JiraProjectSource>, String> {
    let pool = state.db_pool.lock().await
        .as_ref()
        .ok_or("Database tidak tersedia")?
        .clone();

    let rows = sqlx::query("SELECT DISTINCT project_name FROM uqa_project WHERE project_name IS NOT NULL AND project_name != ''")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Gagal fetch uqa_project: {e}"))?;

    let mut seen_keys = std::collections::HashSet::new();
    let mut sources: Vec<JiraProjectSource> = Vec::new();

    for row in rows {
        use sqlx::Row;
        let project_name: String = row.get("project_name");
        if let Some(project_key) = extract_project_key_from_uqa_name(&project_name) {
            let key_upper = project_key.to_uppercase();
            if seen_keys.contains(&key_upper) {
                continue;
            }
            seen_keys.insert(key_upper);
            // Display name: "<PROJECT_KEY> - <description after second dash>"
            let parts: Vec<&str> = project_name.splitn(3, " - ").collect();
            let display_name = if parts.len() >= 3 {
                format!("{} - {}", project_key, parts[2].trim())
            } else {
                project_key.clone()
            };
            sources.push(JiraProjectSource {
                id: format!("auto-{}", project_key.to_lowercase()),
                project_key,
                project_name: display_name,
                is_active: true,
                last_synced_at: None,
                auto_sync_enabled: Some(false),
                auto_sync_days: None,
                auto_sync_time: None,
                issue_types: Some(vec!["Bug".to_string(), "Defect".to_string()]),
                last_auto_sync_at: None,
                sync_mode: crate::models::defect::DefectSyncMode::Initial,
                sync_status: crate::models::defect::DefectSyncStatus::Idle,
                error_message: None,
            });
        }
    }

    sources.sort_by(|a, b| a.project_key.cmp(&b.project_key));
    Ok(sources)
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
