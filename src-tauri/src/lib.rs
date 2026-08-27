mod commands;
mod config;
#[allow(dead_code)]
mod models;
#[cfg(test)]
mod runtime_smoke;
#[allow(dead_code)]
mod services;

use config::store::ConfigStore;
use services::brd_service::BRDService;
use services::confluence::ConfluenceService;
use services::db::DbPool;
use services::defect_repository::DefectRepositoryService;
use services::jira::JiraService;
use services::logs::LogsService;
use services::ocr::OcrService;
use services::ollama::OllamaService;
use services::qa::QaService;
use services::rag::RagService;
use services::update::UpdateService;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

/// Shared application state, managed by Tauri and injected into commands via
/// `State<'_, AppState>`. The stores/mutexes are created once at startup.
pub struct AppState {
    pub config: Mutex<ConfigStore>,
    pub jira_service: Mutex<JiraService>,
    pub confluence_service: Mutex<ConfluenceService>,
    pub ollama_service: Mutex<OllamaService>,
    pub qa_service: Mutex<QaService>,
    pub rag_service: Mutex<RagService>,
    pub logs_service: Mutex<LogsService>,
    pub update_service: Mutex<UpdateService>,
    pub ocr_service: Mutex<OcrService>,
    pub defect_repository_service: Mutex<DefectRepositoryService>,
    pub brd_service: Mutex<BRDService>,
    /// MySQL connection pool. Wrapped in Arc<Mutex<Option>> so it can be
    /// populated asynchronously after startup without blocking the UI.
    pub db_pool: Arc<Mutex<Option<DbPool>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Load .env from the project root (dev) or app bundle dir (prod).
            // Errors are non-fatal — env vars may already be set in the environment.
            let _ = dotenvy::dotenv();

            // db_pool starts as None; a background task fills it after the UI is ready.
            // This avoids block_on inside setup() which causes a deadlock/blank screen.
            let db_pool: Arc<Mutex<Option<DbPool>>> = Arc::new(Mutex::new(None));
            let db_pool_clone = Arc::clone(&db_pool);
            tauri::async_runtime::spawn(async move {
                match services::db::create_pool().await {
                    Ok(pool) => {
                        let mut guard = db_pool_clone.lock().await;
                        *guard = Some(pool);
                        log::info!("Central DB pool ready.");
                    }
                    Err(e) => {
                        log::warn!("Central DB unavailable: {e}");
                    }
                }
            });

            let config_store = ConfigStore::new(app.handle())?;
            app.manage(AppState {
                config: Mutex::new(config_store),
                jira_service: Mutex::new(JiraService::with_cache(app.handle())),
                confluence_service: Mutex::new(ConfluenceService::new()),
                ollama_service: Mutex::new(OllamaService::new()),
                qa_service: Mutex::new(QaService::new()),
                rag_service: Mutex::new(RagService::new()),
                logs_service: Mutex::new(LogsService::new(app.handle())),
                update_service: Mutex::new(UpdateService::new()),
                ocr_service: Mutex::new(OcrService::new()),
                defect_repository_service: Mutex::new(DefectRepositoryService::new(app.handle())),
                brd_service: Mutex::new(BRDService::new(app.handle())),
                db_pool,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap::bootstrap,
            commands::config::save_config,
            commands::brd::get_test_plans,
            commands::brd::create_test_plan,
            commands::brd::update_test_plan,
            commands::brd::delete_test_plan,
            commands::brd::sync_test_plan_to_jira,
            commands::brd::get_test_executions,
            commands::brd::create_test_execution,
            commands::brd::update_test_execution,
            commands::brd::delete_test_execution,
            commands::brd::sync_test_execution_to_jira,
            commands::brd::generate_test_cases_from_brd,
            commands::brd::get_generated_test_cases,
            commands::brd::update_brd_test_case,
            commands::brd::delete_brd_test_case,
            commands::brd::sync_brd_test_cases_to_jira,
            commands::brd::get_execution_monitoring_data,
            commands::brd::semantic_search_test_cases,
            commands::config::get_ollama_models,
            commands::config::test_connections,
            commands::config::healthcheck,
            commands::dashboard::get_dashboard,
            commands::dashboard::get_project_insight,
            commands::dashboard::ask_assistant,
            commands::dashboard::polish_bug_report,
            commands::dashboard::create_bug,
            commands::dashboard::create_defect_issue,
            commands::confluence::get_confluence_page,
            commands::confluence::parse_confluence_entries,
            commands::confluence::preview_confluence_sync,
            commands::confluence::sync_to_confluence,
            commands::confluence::extract_test_cases,
            commands::document_review::review_document,
            commands::files::read_local_file,
            commands::files::get_directory_name,
            commands::logs::get_logs,
            commands::logs::save_logs,
            commands::logs::record_execution,
            commands::logs::get_execution_history,
            commands::logs::get_execution_stats,
            commands::updates::check_for_updates,
            commands::updates::get_update_status,
            commands::updates::download_and_install_update,
            commands::ocr::ocr_extract_from_file,
            commands::rag::rag_index_confluence,
            commands::rag::rag_index_jira,
            commands::rag::rag_search,
            commands::rag::rag_get_stats,
            commands::rag::rag_clear_index,
            commands::rag::rag_clear_bitbucket,
            commands::defect::get_defect_sources,
            commands::defect::save_defect_source,
            commands::defect::delete_defect_source,
            commands::defect::sync_defect_source,
            commands::defect::find_defect_duplicate_candidates,
            commands::defect::search_defects,
            commands::defect::get_defect,
            commands::defect::get_defect_duplicate_relations,
            commands::defect::mark_duplicate_defect,
            commands::defect::remove_duplicate_defect_link,
            commands::defect::get_defect_stats,
            commands::defect::reindex_all_defects,
            commands::jira::get_jira_projects,
            commands::jira::get_jira_boards,
            commands::jira::get_jira_sprints,
            commands::jira::get_jira_statuses,
            commands::jira::get_jira_issue_types,
            commands::jira::get_jira_users,
            commands::jira::get_jira_labels,
            commands::jira::get_jira_custom_fields,
            commands::jira::find_issues_by_jql,
            commands::jira::create_test_cases,
            commands::jira::create_manual_test_cases,
            commands::jira::organize_tests_into_xray,
            commands::jira::get_xray_folders,
            commands::jira::get_xray_folder_issues,
            commands::jira::add_tests_to_execution,
            commands::jira::check_test_steps,
            commands::jira::fetch_test_steps,
            commands::jira::fetch_tc_details_batch,
            commands::jira::update_test_run_status,
            commands::jira::push_entry_to_jira,
            commands::jira::update_test_cases_from_confluence,
            commands::jira::bulk_transition,
            commands::jira::bulk_assign,
            commands::jira::bulk_add_labels,
            commands::jira::bulk_move_to_xray_folder,
            commands::jira::get_xray_execution_details,
            commands::jira::get_xray_execution_history,
            commands::jira::inject_execution_report,
            commands::jira::get_current_user,
            commands::jira::get_uqa_field,
            commands::jira::get_uqa_issues,
            commands::jira::check_uqa_on_startup,
            commands::jira::get_uqa_transitions,
            commands::jira::append_uqa_entry,
            commands::jira::append_uqa_entry_with_notes,
            commands::jira::transition_uqa_issue,
            commands::jira::auto_generate_uqa_notes,
            commands::jira::update_uqa_schedule,
            commands::jira::get_uqa_schedule,
            commands::jira::get_uqa_issues_from_store,
            commands::jira::sync_uqa_issues,
            commands::jira::get_per_uqa_reminder,
            commands::jira::update_per_uqa_reminder,
            commands::cancel::cancel_request,
            commands::db::check_db_connection,
            commands::db::save_uqa_test_plan,
            commands::db::get_db_test_plans,
            commands::db::check_test_plans_in_db,
            commands::db::save_test_executions,
            commands::db::check_test_executions_in_db,
            commands::db::save_test_repositories,
            commands::db::get_test_repositories_in_db,
            commands::db::save_uqa_projects,
            commands::db::resync_uqa_project,
            commands::db::check_uqa_projects_in_db,
            commands::db::save_test_cases,
            commands::db::sync_execution_tests_to_db,
            commands::db::sync_defect_to_db,
            commands::db::get_my_uqa_projects,
            commands::db::get_my_test_executions,
            commands::db::get_my_test_cases_by_execution,
            commands::db::get_test_cases_by_te_key,
            commands::db::get_uqa_db_execution_summary,
            commands::db::update_test_case_run_status,
            commands::db::get_test_case_titles,
            commands::db::login_user,
            commands::db::register_user,
            commands::db::update_user_tokens,
            commands::jira::fetch_uqa_with_dates,
            commands::bitbucket_commands::get_bitbucket_pr_details,
            commands::bitbucket_commands::fetch_bitbucket_diff,
            commands::bitbucket_commands::generate_test_scenarios_from_bitbucket,
            commands::bitbucket_commands::explain_bitbucket_code,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
