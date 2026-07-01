use crate::commands::load_config;
use crate::models::brd::{
    BRDGenerationRequest, BRDGenerationResult, BRDTestCase, ExecutionMonitoringData,
    SemanticSearchResult, TestExecution, TestPlan,
};
use crate::AppState;
use tauri::State;

// ── Test Plans ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_test_plans(state: State<'_, AppState>) -> Result<Vec<TestPlan>, String> {
    let service = state.brd_service.lock().await;
    Ok(service.get_test_plans())
}

#[tauri::command]
pub async fn create_test_plan(
    state: State<'_, AppState>,
    uqa_key: String,
    phase: String,
    name: String,
    description: String,
    project_key: String,
) -> Result<TestPlan, String> {
    let service = state.brd_service.lock().await;
    service
        .create_test_plan(uqa_key, phase, name, description, project_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_test_plan(
    state: State<'_, AppState>,
    plan: TestPlan,
) -> Result<TestPlan, String> {
    let service = state.brd_service.lock().await;
    service.update_test_plan(plan).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_test_plan(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let service = state.brd_service.lock().await;
    service.delete_test_plan(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_test_plan_to_jira(
    state: State<'_, AppState>,
    plan_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let config = load_config(state.clone()).await?;
    let service = state.brd_service.lock().await;
    let result = service
        .sync_test_plan_to_jira(&config, &plan_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.map(|(key, url)| serde_json::json!({ "key": key, "url": url })))
}

// ── Test Executions ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_test_executions(
    state: State<'_, AppState>,
    test_plan_id: Option<String>,
) -> Result<Vec<TestExecution>, String> {
    let service = state.brd_service.lock().await;
    Ok(service.get_test_executions(test_plan_id.as_deref()))
}

#[tauri::command]
pub async fn create_test_execution(
    state: State<'_, AppState>,
    test_plan_id: String,
    assignee: String,
    name: String,
    project_key: String,
    feature_name: String,
) -> Result<TestExecution, String> {
    let service = state.brd_service.lock().await;
    service
        .create_test_execution(test_plan_id, assignee, name, project_key, feature_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_test_execution(
    state: State<'_, AppState>,
    execution: TestExecution,
) -> Result<TestExecution, String> {
    let service = state.brd_service.lock().await;
    service
        .update_test_execution(execution)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_test_execution(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let service = state.brd_service.lock().await;
    service.delete_test_execution(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_test_execution_to_jira(
    state: State<'_, AppState>,
    execution_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let config = load_config(state.clone()).await?;
    let service = state.brd_service.lock().await;
    let result = service
        .sync_test_execution_to_jira(&config, &execution_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.map(|(key, url)| serde_json::json!({ "key": key, "url": url })))
}

// ── BRD Test Cases ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_test_cases_from_brd(
    state: State<'_, AppState>,
    request: BRDGenerationRequest,
) -> Result<BRDGenerationResult, String> {
    let config = load_config(state.clone()).await?;
    let service = state.brd_service.lock().await;
    service
        .generate_from_confluence(&config, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_generated_test_cases(
    state: State<'_, AppState>,
    test_execution_id: String,
) -> Result<Vec<BRDTestCase>, String> {
    let service = state.brd_service.lock().await;
    Ok(service.get_test_cases(Some(&test_execution_id)))
}

#[tauri::command]
pub async fn update_brd_test_case(
    state: State<'_, AppState>,
    test_case: BRDTestCase,
) -> Result<BRDTestCase, String> {
    let service = state.brd_service.lock().await;
    service.update_test_case(test_case).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_brd_test_case(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let service = state.brd_service.lock().await;
    service.delete_test_case(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_brd_test_cases_to_jira(
    state: State<'_, AppState>,
    test_execution_id: String,
    project_key: String,
    folder_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let service = state.brd_service.lock().await;
    let results = service
        .sync_test_cases_to_jira(&config, &test_execution_id, &project_key, folder_path.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    let success = results.iter().filter(|r| r.1).count();
    let failed = results.iter().filter(|r| !r.1).count();
    let errors: Vec<String> = results
        .into_iter()
        .filter(|r| !r.1)
        .map(|r| format!("{}: {}", r.0, r.2))
        .collect();
    Ok(serde_json::json!({ "success": success, "failed": failed, "errors": errors }))
}

// ── Execution Monitoring ───────────────────────────────────────────────

#[tauri::command]
pub async fn get_execution_monitoring_data(
    state: State<'_, AppState>,
    test_execution_id: Option<String>,
) -> Result<Vec<ExecutionMonitoringData>, String> {
    let service = state.brd_service.lock().await;
    Ok(service.get_monitoring_data(test_execution_id.as_deref()))
}

// ── Semantic Search ────────────────────────────────────────────────────

#[tauri::command]
pub async fn semantic_search_test_cases(
    state: State<'_, AppState>,
    query: String,
    project_key: String,
) -> Result<Vec<SemanticSearchResult>, String> {
    let config = load_config(state.clone()).await?;
    let service = state.brd_service.lock().await;
    service
        .semantic_search(&config, &query, &project_key)
        .await
        .map_err(|e| e.to_string())
}
