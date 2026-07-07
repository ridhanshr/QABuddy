use crate::commands::load_config;
use crate::models::app_config::UqaConfig;
use crate::models::connection::JiraIssueSummary;
use crate::models::jira::{
    BulkOperationResult, ConfluenceTestImportEntry, FetchTestStepsResult,
    StepConflictCheck, StepConflictMode, XrayFolder,
};
use crate::models::test_case::{ExtractedTestCase, ManualTestCase};
use crate::models::uqa::{AutoUqaGeneratedPayload, UqaIssue, UqaTransition};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_jira_projects(state: State<'_, AppState>) -> Result<Vec<crate::models::jira::JiraProject>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.get_projects(&config.jira).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_jira_boards(state: State<'_, AppState>, project_key: String) -> Result<Vec<crate::models::jira::JiraBoard>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let mut cfg = config.jira.clone();
    cfg.project_key = project_key;
    jira_service.get_boards(&cfg).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_jira_sprints(state: State<'_, AppState>, board_id: u32) -> Result<Vec<crate::models::jira::JiraSprint>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.get_sprints(&config.jira, board_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_jira_statuses(state: State<'_, AppState>) -> Result<Vec<crate::models::jira::JiraStatus>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.get_statuses(&config.jira).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_jira_issue_types(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.get_issue_types(&config.jira).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_jira_users(state: State<'_, AppState>, project_key: String) -> Result<Vec<crate::models::jira::JiraUser>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.get_users(&config.jira, &project_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_jira_labels(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.get_labels(&config.jira).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_jira_custom_fields(
    state: State<'_, AppState>,
) -> Result<Vec<crate::models::jira::JiraField>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.get_custom_fields(&config.jira).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn find_issues_by_jql(
    state: State<'_, AppState>,
    jql: String,
    max_results: u32,
) -> Result<Vec<JiraIssueSummary>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service
        .find_issues_by_jql(&config.jira, &jql, max_results)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_test_cases(
    state: State<'_, AppState>,
    cases: Vec<ExtractedTestCase>,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let created = jira_service
        .create_test_cases(&config.jira, &cases)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "created": created }))
}

#[tauri::command]
pub async fn create_manual_test_cases(
    state: State<'_, AppState>,
    cases: Vec<ManualTestCase>,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let created = jira_service
        .create_manual_test_cases(&config.jira, &cases)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "created": created }))
}

#[tauri::command]
pub async fn organize_tests_into_xray(
    state: State<'_, AppState>,
    source: String,
    folder_path: String,
    project_key: String,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let count = jira_service
        .organize_tests_into_xray(&config.jira, &source, &folder_path, &project_key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "count": count }))
}

#[tauri::command]
pub async fn get_xray_folders(state: State<'_, AppState>, project_key: String) -> Result<Vec<XrayFolder>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.get_xray_folders(&config.jira, &project_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_xray_folder_issues(
    state: State<'_, AppState>,
    project_key: String,
    folder_id: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service
        .get_xray_folder_issues(&config.jira, &project_key, folder_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_tests_to_execution(
    state: State<'_, AppState>,
    exec_key: String,
    test_keys: Vec<String>,
) -> Result<(), String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service
        .add_tests_to_execution(&config.jira, &exec_key, &test_keys)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_test_steps(
    state: State<'_, AppState>,
    entries: Vec<ConfluenceTestImportEntry>,
) -> Result<StepConflictCheck, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.check_test_steps(&config.jira, &entries).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_test_steps(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<Option<FetchTestStepsResult>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.fetch_test_steps(&config.jira, &issue_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_test_cases_from_confluence(
    state: State<'_, AppState>,
    entries: Vec<ConfluenceTestImportEntry>,
    mode: Option<StepConflictMode>,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let result = jira_service
        .update_test_cases_from_confluence(&config.jira, &entries, mode.unwrap_or(StepConflictMode::Replace))
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!(result))
}

#[tauri::command]
pub async fn bulk_transition(
    state: State<'_, AppState>,
    issue_keys: Vec<String>,
    transition_id: String,
) -> Result<BulkOperationResult, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.bulk_transition(&config.jira, &issue_keys, &transition_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn bulk_assign(
    state: State<'_, AppState>,
    issue_keys: Vec<String>,
    assignee_account_id: String,
) -> Result<BulkOperationResult, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.bulk_assign(&config.jira, &issue_keys, &assignee_account_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn bulk_add_labels(
    state: State<'_, AppState>,
    issue_keys: Vec<String>,
    labels: Vec<String>,
) -> Result<BulkOperationResult, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.bulk_add_labels(&config.jira, &issue_keys, &labels).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn bulk_move_to_xray_folder(
    state: State<'_, AppState>,
    issue_keys: Vec<String>,
    folder_path: String,
) -> Result<BulkOperationResult, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.bulk_move_to_xray_folder(&config.jira, &issue_keys, &folder_path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_xray_execution_details(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    exec_key: String,
) -> Result<crate::models::jira::XrayExecutionDetails, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service
        .get_xray_execution_details(&config.jira, &app_handle, &exec_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn inject_execution_report(
    state: State<'_, AppState>,
    target_issue_key: String,
    exec_key: String,
    snapshots: Vec<crate::models::jira::XrayExecutionSnapshot>,
) -> Result<(), String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service
        .inject_execution_report(&config.jira, &target_issue_key, &exec_key, &snapshots)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_xray_execution_history(
    app_handle: tauri::AppHandle,
    exec_key: String,
) -> Result<Vec<crate::models::jira::XrayExecutionSnapshot>, String> {
    crate::services::jira::JiraService::load_execution_history(&app_handle, &exec_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_current_user(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let client = state
        .jira_service
        .lock()
        .await
        .client(&config.jira)
        .map_err(|e| e.to_string())?;
    client.get_current_user().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_uqa_field(state: State<'_, AppState>) -> Result<Option<serde_json::Value>, String> {
    let config = load_config(state.clone()).await?;
    let client = state
        .jira_service
        .lock()
        .await
        .client(&config.jira)
        .map_err(|e| e.to_string())?;
    client.get_custom_field_by_name("Product Tester").await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_uqa_issues(state: State<'_, AppState>) -> Result<Vec<UqaIssue>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let field_id = if let Some(field_id) = config.uqa.product_tester_field_id.clone() {
        field_id
    } else {
        let client = jira_service
            .client(&config.jira)
            .map_err(|e| e.to_string())?;
        match client.get_custom_field_by_name("Product Tester").await.map_err(|e| e.to_string())? {
            Some(field) => field["id"].as_str().unwrap_or("customfield_00000").to_string(),
            None => "customfield_00000".to_string(),
        }
    };
    jira_service
        .get_uqa_issues(&config.jira, &field_id, &config.uqa.search_mode, &config.uqa.project_keys)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_uqa_on_startup(state: State<'_, AppState>) -> Result<Vec<UqaIssue>, String> {
    get_uqa_issues(state).await
}

#[tauri::command]
pub async fn get_uqa_transitions(state: State<'_, AppState>, issue_key: String) -> Result<Vec<UqaTransition>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.get_uqa_transitions(&config.jira, &issue_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn append_uqa_entry(state: State<'_, AppState>, issue_key: String, date: String, activity: String) -> Result<(), String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.append_uqa_entry(&config.jira, &issue_key, &date, &activity).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn append_uqa_entry_with_notes(
    state: State<'_, AppState>,
    issue_key: String,
    date: String,
    activity: String,
    notes: String,
) -> Result<(), String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.append_uqa_entry_with_notes(&config.jira, &issue_key, &date, &activity, &notes).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn transition_uqa_issue(
    state: State<'_, AppState>,
    issue_key: String,
    transition_id: String,
) -> Result<(), String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.transition_uqa_issue(&config.jira, &issue_key, &transition_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auto_generate_uqa_notes(state: State<'_, AppState>, issue_key: String) -> Result<AutoUqaGeneratedPayload, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service.auto_generate_uqa_notes(&config.jira, &issue_key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_uqa_schedule(state: State<'_, AppState>, config: UqaConfig) -> Result<(), String> {
    let mut app_config = load_config(state.clone()).await?;
    app_config.uqa = config;
    let mut store = state.config.lock().await;
    store.save(&app_config).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_uqa_schedule(state: State<'_, AppState>) -> Result<UqaConfig, String> {
    let config = load_config(state.clone()).await?;
    Ok(config.uqa)
}

#[tauri::command]
pub async fn get_uqa_issues_from_store(state: State<'_, AppState>) -> Result<Vec<UqaIssue>, String> {
    get_uqa_issues(state).await
}

#[tauri::command]
pub async fn sync_uqa_issues(state: State<'_, AppState>) -> Result<Vec<UqaIssue>, String> {
    get_uqa_issues(state).await
}

#[tauri::command]
pub async fn get_per_uqa_reminder(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<Option<crate::models::uqa::PerIssueReminder>, String> {
    let config = load_config(state.clone()).await?;
    Ok(config.uqa.per_issue_reminders.get(&issue_key).cloned())
}

#[tauri::command]
pub async fn update_per_uqa_reminder(
    state: State<'_, AppState>,
    issue_key: String,
    reminder: crate::models::uqa::PerIssueReminder,
) -> Result<(), String> {
    let mut app_config = load_config(state.clone()).await?;
    app_config.uqa.per_issue_reminders.insert(issue_key, reminder);
    let mut store = state.config.lock().await;
    store.save(&app_config).await.map_err(|e| e.to_string())?;
    Ok(())
}
