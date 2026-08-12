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
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushEntryToJiraInput {
    pub issue_key: String,
    pub steps: String,
    pub expected_result: String,
    pub input_data: String,
    pub category: String,
}

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
    assignee: Option<String>,
) -> Result<serde_json::Value, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let created = jira_service
        .create_manual_test_cases(&config.jira, &cases, assignee.as_deref())
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

/// Batch-fetch TC details from Jira for a list of TC keys.
/// Returns one FetchTestStepsResult per key (None entries are skipped).
#[tauri::command]
pub async fn fetch_tc_details_batch(
    state: State<'_, AppState>,
    tc_keys: Vec<String>,
) -> Result<Vec<FetchTestStepsResult>, String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let mut results = Vec::new();
    for key in &tc_keys {
        match jira_service.fetch_test_steps(&config.jira, key).await {
            Ok(Some(detail)) => results.push(detail),
            Ok(None) => {
                // No steps — still return a stub so frontend knows the key was processed
                results.push(FetchTestStepsResult {
                    issue_key: key.clone(),
                    summary: String::new(),
                    steps: String::new(),
                    expected_result: String::new(),
                    input_data: String::new(),
                    labels: vec![],
                    function_name: None,
                });
            }
            Err(e) => return Err(format!("Gagal fetch {key}: {e}")),
        }
    }
    Ok(results)
}

/// Update the Xray test run status for a TC inside a TE.
#[tauri::command]
pub async fn update_test_run_status(
    state: State<'_, AppState>,
    te_key: String,
    tc_key: String,
    status: String,
) -> Result<(), String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let result = jira_service
        .update_test_run_status_for_tc(&config.jira, &te_key, &tc_key, &status)
        .await;
    if let Err(ref e) = result {
        eprintln!("[update_test_run_status] FAILED te={te_key} tc={tc_key} status={status}: {e}");
    } else {
        eprintln!("[update_test_run_status] OK te={te_key} tc={tc_key} status={status}");
    }
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn push_entry_to_jira(
    state: State<'_, AppState>,
    input: PushEntryToJiraInput,
) -> Result<(), String> {
    let config = load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    jira_service
        .push_entry_to_jira(&config.jira, &input.issue_key, &input.steps, &input.expected_result, &input.input_data, &input.category)
        .await
        .map_err(|e| e.to_string())
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
    use crate::models::uqa::{DbTeSummary, PhaseTestSummary, PhaseFailedDetail};
    use crate::services::jira::service::{detect_phase_from_name_pub, phase_rank_pub, format_uqa_notes_pub};

    // ── Try DB path first ──
    let db_rows: Vec<DbTeSummary> = {
        let pool_opt = state.db_pool.lock().await.clone();
        if let Some(pool) = pool_opt {
            sqlx::query(
                r#"
                SELECT
                    te.te_jira_key,
                    te.title                                          AS te_title,
                    COALESCE(te.execution_status, '')                 AS execution_status,
                    DATE_FORMAT(te.last_sync, '%Y-%m-%d %H:%i:%s')   AS last_sync,
                    COUNT(tc.tc_key)                                  AS total,
                    SUM(tc.test_run_status IN ('PASS','DONE','Done','Pass')) AS done_count,
                    SUM(tc.test_run_status IN ('FAIL','FAILED','Failed','Fail')) AS failed_count,
                    SUM(tc.test_run_status IN ('ABORTED','Aborted'))  AS aborted_count,
                    SUM(tc.test_run_status IN ('EXECUTING','IN_PROGRESS','In Progress','In progress','Executing'))
                                                                      AS in_progress_count,
                    SUM(tc.test_run_status IN ('TODO','To Do','To do','todo'))
                                                                      AS todo_count
                FROM test_plan tp
                JOIN test_execution te ON te.tp_jira_key = tp.tp_jira_key
                LEFT JOIN test_case tc ON tc.te_jira_key = te.te_jira_key
                WHERE tp.uqa_key = ?
                  AND DATE(te.last_sync) = CURDATE()
                GROUP BY te.te_jira_key, te.title, te.execution_status, te.last_sync
                ORDER BY te.last_sync DESC
                "#,
            )
            .bind(&issue_key)
            .fetch_all(&pool)
            .await
            .unwrap_or_default()
            .iter()
            .map(|row| {
                use sqlx::Row;
                DbTeSummary {
                    te_jira_key:      row.get("te_jira_key"),
                    te_title:         row.get("te_title"),
                    execution_status: row.get("execution_status"),
                    last_sync:        row.get("last_sync"),
                    total:            row.try_get::<i64, _>("total").unwrap_or(0) as u32,
                    done:             row.try_get::<i64, _>("done_count").unwrap_or(0) as u32,
                    failed:           row.try_get::<i64, _>("failed_count").unwrap_or(0) as u32,
                    aborted:          row.try_get::<i64, _>("aborted_count").unwrap_or(0) as u32,
                    in_progress:      row.try_get::<i64, _>("in_progress_count").unwrap_or(0) as u32,
                    todo:             row.try_get::<i64, _>("todo_count").unwrap_or(0) as u32,
                }
            })
            .collect()
        } else {
            vec![]
        }
    };

    if !db_rows.is_empty() {
        let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let phases: Vec<PhaseTestSummary> = db_rows.iter()
            .filter(|r| {
                let name = r.te_title.as_deref().unwrap_or(&r.te_jira_key).to_lowercase();
                !name.contains("user acceptance test")
            })
            .map(|r| {
            let name = r.te_title.as_deref().unwrap_or(&r.te_jira_key);
            PhaseTestSummary {
                phase:          detect_phase_from_name_pub(name),
                test_exec_key:  r.te_jira_key.clone(),
                test_exec_name: name.to_string(),
                todo:           r.todo,
                in_progress:    r.in_progress,
                done:           r.done,
                failed:         r.failed,
                aborted:        r.aborted,
                failed_details: vec![],
            }
        }).collect();
        let mut activity: Vec<String> = phases.iter()
            .filter(|p| p.phase != "UNKNOWN")
            .map(|p| p.phase.clone())
            .collect();
        activity.sort_by(|a, b| phase_rank_pub(a).cmp(&phase_rank_pub(b)));
        activity.dedup();
        let generated_notes = format_uqa_notes_pub(&phases);
        return Ok(AutoUqaGeneratedPayload {
            date,
            activity,
            phases,
            generated_notes,
            no_links_found: None,
            source: Some("db".to_string()),
        });
    }

    // ── Fall back to live Jira/Xray API ──
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

/// Struct representing a UQA issue with date custom fields, for syncing to DB.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UqaWithDates {
    pub uqa_key: String,
    pub summary: String,
    pub status: String,
    pub assignee: String,
    pub product_tester: String,
    pub start_sit: Option<String>,
    pub finish_sit: Option<String>,
    pub start_uat: Option<String>,
}

/// Fetch UQA issues assigned to the current user with date custom fields
/// (Start Date QA → start_sit, Finish Date QA → finish_sit, UAT date → start_uat,
/// Product Tester → product_tester). Used to populate uqa_project table in DB.
#[tauri::command]
pub async fn fetch_uqa_with_dates(state: State<'_, AppState>) -> Result<Vec<UqaWithDates>, String> {
    let config = load_config(state.clone()).await?;
    let jira_config = config.jira.clone();
    drop(config);
    let jira_service = state.jira_service.lock().await;
    let client = jira_service.client(&jira_config).map_err(|e| e.to_string())?;

    // Resolve custom field IDs by name (one call to /field)
    let all_fields: serde_json::Value = client.api
        .get_json("/field", &[])
        .await
        .map_err(|e| e.to_string())?;

    let find_field_id = |name: &str| -> String {
        all_fields
            .as_array()
            .and_then(|arr| {
                arr.iter().find(|f| {
                    f.get("name").and_then(|n| n.as_str()) == Some(name)
                })
            })
            .and_then(|f| f.get("id").and_then(|i| i.as_str()))
            .unwrap_or("")
            .to_string()
    };

    let f_product_tester = find_field_id("Product Tester");
    let f_start_qa       = find_field_id("Start Date QA");
    let f_finish_qa      = find_field_id("Finish Date QA");
    // Try multiple possible names for UAT date field
    let f_start_uat = {
        let v = find_field_id("UAT date");
        if v.is_empty() { find_field_id("UAT Date") } else { v }
    };
    let f_start_uat = if f_start_uat.is_empty() { find_field_id("Start UAT") } else { f_start_uat };

    log::info!(
        "[fetch_uqa_with_dates] field IDs — product_tester={} start_qa={} finish_qa={} start_uat={}",
        f_product_tester, f_start_qa, f_finish_qa, f_start_uat
    );

    // Build fields string for the search
    let mut fields_list = vec![
        "summary".to_string(),
        "status".to_string(),
        "assignee".to_string(),
    ];
    if !f_product_tester.is_empty() { fields_list.push(f_product_tester.clone()); }
    if !f_start_qa.is_empty()       { fields_list.push(f_start_qa.clone()); }
    if !f_finish_qa.is_empty()      { fields_list.push(f_finish_qa.clone()); }
    if !f_start_uat.is_empty()      { fields_list.push(f_start_uat.clone()); }
    let fields_str = fields_list.join(",");

    // Use currentUser() so Jira resolves the logged-in user correctly
    let jql_assignee = r#"project = "UAT QA Activity 2026" AND assignee = currentUser() ORDER BY updated DESC"#;
    let jql_tester = if f_product_tester.is_empty() {
        String::new()
    } else {
        let num = f_product_tester.trim_start_matches("customfield_");
        format!(r#"project = "UAT QA Activity 2026" AND cf[{num}] = currentUser() ORDER BY updated DESC"#)
    };

    log::info!("[fetch_uqa_with_dates] fields={} jql_assignee={}", fields_str, jql_assignee);

    let mut issues_raw: Vec<serde_json::Value> = client
        .search_issues(jql_assignee, 100, &fields_str)
        .await
        .map_err(|e| e.to_string())?;

    log::info!("[fetch_uqa_with_dates] assignee query returned {} issues", issues_raw.len());

    if !jql_tester.is_empty() {
        let tester_issues = client
            .search_issues(&jql_tester, 100, &fields_str)
            .await
            .unwrap_or_default();
        log::info!("[fetch_uqa_with_dates] tester query returned {} issues", tester_issues.len());
        let existing_keys: std::collections::HashSet<String> = issues_raw
            .iter()
            .filter_map(|i| i["key"].as_str().map(String::from))
            .collect();
        for issue in tester_issues {
            if let Some(k) = issue["key"].as_str() {
                if !existing_keys.contains(k) {
                    issues_raw.push(issue);
                }
            }
        }
    }

    let extract_date = |fields: &serde_json::Value, field_id: &str| -> Option<String> {
        if field_id.is_empty() { return None; }
        fields.get(field_id)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };

    let result = issues_raw
        .iter()
        .map(|issue| {
            let key = issue["key"].as_str().unwrap_or("").to_string();
            let fields = &issue["fields"];
            UqaWithDates {
                uqa_key: key,
                summary: fields["summary"].as_str().unwrap_or("").to_string(),
                status: fields["status"]["name"].as_str().unwrap_or("").to_string(),
                assignee: fields["assignee"]["displayName"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                product_tester: fields
                    .get(&f_product_tester)
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|u| u["displayName"].as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_default(),
                start_sit:  extract_date(fields, &f_start_qa),
                finish_sit: extract_date(fields, &f_finish_qa),
                start_uat:  extract_date(fields, &f_start_uat),
            }
        })
        .collect();

    Ok(result)
}
