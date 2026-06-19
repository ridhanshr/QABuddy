mod commands;
mod config;
#[allow(dead_code)]
mod models;
#[allow(dead_code)]
mod services;
#[cfg(test)]
mod runtime_smoke;

use config::store::ConfigStore;
use services::defect_repository::DefectRepositoryService;
use services::confluence::ConfluenceService;
use services::jira::JiraService;
use services::logs::LogsService;
use services::ocr::OcrService;
use services::ollama::OllamaService;
use services::qa::QaService;
use services::rag::RagService;
use services::update::UpdateService;
use tokio::sync::Mutex;
use tauri::Manager;

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

            let config_store = ConfigStore::new(app.handle())?;
            app.manage(AppState {
                config: Mutex::new(config_store),
                jira_service: Mutex::new(JiraService::new()),
                confluence_service: Mutex::new(ConfluenceService::new()),
                ollama_service: Mutex::new(OllamaService::new()),
                qa_service: Mutex::new(QaService::new()),
                rag_service: Mutex::new(RagService::new()),
                logs_service: Mutex::new(LogsService::new(app.handle())),
                update_service: Mutex::new(UpdateService::new()),
                ocr_service: Mutex::new(OcrService::new()),
                defect_repository_service: Mutex::new(DefectRepositoryService::new(app.handle())),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap::bootstrap,
            commands::config::save_config,
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
            commands::jira::check_test_steps,
            commands::jira::fetch_test_steps,
            commands::jira::update_test_cases_from_confluence,
            commands::jira::bulk_transition,
            commands::jira::bulk_assign,
            commands::jira::bulk_add_labels,
            commands::jira::bulk_move_to_xray_folder,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
