use std::collections::{HashMap, HashSet};

use regex::Regex;
use serde_json::Value;
use tauri::Emitter;

use crate::models::app_config::AppConfig;
use crate::models::document_review::{
    DocumentReviewProgress, JiraExecutionSummary, ReviewFinding, ReviewPageSummary, ReviewSummary,
    TestMeasureReconciliation,
};
use crate::models::jira::XrayTestRun;
use crate::services::confluence::ConfluenceService;
use crate::services::error::{Result, ServiceError};
use crate::services::jira::JiraService;
use crate::services::ollama::OllamaService;
use crate::services::text_utils::{extract_json_block, strip_html};

const TMP_LINK_WEIGHT: u32 = 4;

const SIT_WEIGHTS: &[(&str, u32)] = &[
    ("SIT Structure", 10),
    ("Test Strategy SIT", 10),
    ("Test Model & Traceability SIT", 10),
    ("Scenario Detail and Screen Capture SIT", 15),
    ("Test Data Requirement and Readiness SIT", 10),
    ("Test Environment Requirement and Readiness SIT", 10),
    ("Test Execution Log and Result SIT", 10),
    ("Test Incident Report SIT", 5),
    ("Test Completion Report SIT", 10),
    ("Residual Risk", 3),
    ("Lesson Learned", 2),
];

#[derive(Debug, Clone)]
struct PageData {
    raw: Value,
    id: String,
    title: String,
    content: String,
    plain: String,
    parent_id: Option<String>,
}

#[derive(Debug, Default)]
struct Score {
    earned: u32,
    possible: u32,
}

const REVIEW_PROGRESS_EVENT: &str = "document-review-progress";

fn emit_progress(
    app: Option<&tauri::AppHandle>,
    stage: &str,
    message: impl Into<String>,
    current: u32,
    total: u32,
) {
    if let Some(app) = app {
        let _ = app.emit(
            REVIEW_PROGRESS_EVENT,
            DocumentReviewProgress {
                stage: stage.to_string(),
                message: message.into(),
                current,
                total,
                finding: None,
            },
        );
    }
}

fn flush_new_findings(app: Option<&tauri::AppHandle>, summary: &ReviewSummary, emitted: &mut usize) {
    let Some(app) = app else { return };
    for finding in summary.findings.iter().skip(*emitted) {
        *emitted += 1;
        let _ = app.emit(
            REVIEW_PROGRESS_EVENT,
            DocumentReviewProgress {
                stage: "finding".into(),
                message: finding.title.clone(),
                current: 0,
                total: 0,
                finding: Some(finding.clone()),
            },
        );
    }
}

pub async fn review_document(
    confluence: &ConfluenceService,
    jira: &JiraService,
    ollama: Option<&OllamaService>,
    config: &AppConfig,
    page_id: &str,
    jira_project_key: &str,
    app: Option<&tauri::AppHandle>,
) -> Result<ReviewSummary> {
    if page_id.trim().is_empty() || !page_id.trim().chars().all(|c| c.is_ascii_digit()) {
        return Err(ServiceError::Config(
            "Confluence Page ID harus berupa angka".into(),
        ));
    }
    if config.confluence.base_url.trim().is_empty() || config.confluence.token.trim().is_empty() {
        return Err(ServiceError::Config(
            "Konfigurasi Confluence belum lengkap".into(),
        ));
    }
    if jira_project_key.trim().is_empty() {
        return Err(ServiceError::Config(
            "Jira Project Key untuk review belum diisi".into(),
        ));
    }

    emit_progress(app, "fetch", "Mengambil halaman Confluence...".to_string(), 0, 0);
    let root_raw = confluence
        .get_page(&config.confluence, page_id.trim())
        .await?;
    let root = page_data(root_raw)?;
    let mut raw_pages = vec![root.raw.clone()];
    collect_children(
        confluence,
        &config.confluence,
        &root.id,
        &mut raw_pages,
        &mut HashSet::new(),
        app,
    )
    .await?;
    let mut seen_page_ids = HashSet::new();
    let pages: Vec<PageData> = raw_pages
        .into_iter()
        .filter_map(|v| page_data(v).ok())
        .filter(|page| seen_page_ids.insert(page.id.clone()))
        .collect();

    let mut summary = ReviewSummary {
        document_type: "Unknown".to_string(),
        project: root.title.clone(),
        root_page_id: root.id.clone(),
        root_page_title: root.title.clone(),
        ..ReviewSummary::default()
    };
    let page_types: Vec<String> = pages
        .iter()
        .map(|page| classify_page_type(page, &pages))
        .collect();
    summary.pages = pages
        .iter()
        .zip(page_types.iter())
        .map(|(page, document_type)| ReviewPageSummary {
            page_id: page.id.clone(),
            title: page.title.clone(),
            url: page_url(config, page),
            document_type: document_type.clone(),
            parent_page_id: page.parent_id.clone(),
        })
        .collect();

    let root_type = classify_page_type(&root, &pages);
    let mut execution_cache = ExecutionCache::default();
    let ollama_ready = if config.ollama.endpoint.trim().is_empty() {
        false
    } else if let Some(service) = &ollama {
        let model = config
            .ollama
            .extraction_model
            .as_deref()
            .filter(|model| !model.trim().is_empty())
            .unwrap_or(config.ollama.model.as_str());
        service
            .client_for(&config.ollama.endpoint, model)
            .await
            .validate_connection()
            .await
            .is_ok()
    } else {
        false
    };
    let has_tmp = page_types.iter().any(|document_type| document_type == "TMP");
    let sit_pages: Vec<&PageData> = pages
        .iter()
        .zip(page_types.iter())
        .filter(|(_, document_type)| document_type.as_str() == "SIT")
        .map(|(page, _)| page)
        .collect();
    let sit_review_pages: Vec<&PageData> = sit_pages
        .iter()
        .copied()
        .filter(|page| is_sit_review_candidate(page))
        .collect();

    let mut emitted_findings = 0usize;
    let mut completed_units = 0u32;
    emit_progress(
        app,
        "pages",
        format!("{} halaman terkumpul. Menyiapkan pemeriksaan...", pages.len()),
        0,
        0,
    );

    let scenario_capture_pages = collect_scenario_capture_sit_pages(&pages, &page_types);
    let mut total_units = scenario_capture_pages.len() as u32 + if has_tmp { 1 } else { 0 };
    let mut score = Score::default();
    if has_tmp {
        total_units += 1 + sit_review_pages.len() as u32;
        summary.document_type = if sit_pages.is_empty() {
            "TMP"
        } else {
            "TMP + SIT"
        }
        .to_string();
        completed_units += 1;
        emit_progress(
            app,
            "check",
            format!("Memvalidasi TMP: {}...", root.title),
            completed_units,
            total_units,
        );
        validate_tmp(
            &root,
            &mut summary,
            &mut score,
            config,
            confluence,
            jira,
            jira_project_key,
        )
        .await?;
        flush_new_findings(app, &summary, &mut emitted_findings);
        if sit_review_pages.is_empty() {
            add_missing_sit_finding(&mut summary, config, &root, &pages);
        }
        let sit_count = sit_review_pages.len();
        for (idx, sit) in sit_review_pages.into_iter().enumerate() {
            let mut semantic_warning_added = false;
            completed_units += 1;
            emit_progress(
                app,
                "check",
                format!("Memvalidasi SIT {}/{}: {}...", idx + 1, sit_count, sit.title),
                completed_units,
                total_units,
            );
            validate_sit(
                sit,
                &mut summary,
                &mut score,
                config,
                jira,
                ollama,
                &mut semantic_warning_added,
                jira_project_key,
                ollama_ready,
                &mut execution_cache,
            )
            .await?;
            flush_new_findings(app, &summary, &mut emitted_findings);
        }
    } else if (root_type == "SIT" && is_sit_review_candidate(&root))
        || !sit_review_pages.is_empty()
    {
        summary.document_type = "SIT".to_string();
        let targets: Vec<&PageData> = if root_type == "SIT" {
            vec![&root]
        } else {
            sit_review_pages
        };
        total_units += targets.len() as u32;
        let sit_count = targets.len();
        for (idx, sit) in targets.into_iter().enumerate() {
            let mut semantic_warning_added = false;
            completed_units += 1;
            emit_progress(
                app,
                "check",
                format!("Memvalidasi SIT {}/{}: {}...", idx + 1, sit_count, sit.title),
                completed_units,
                total_units,
            );
            validate_sit(
                sit,
                &mut summary,
                &mut score,
                config,
                jira,
                ollama,
                &mut semantic_warning_added,
                jira_project_key,
                ollama_ready,
                &mut execution_cache,
            )
            .await?;
            flush_new_findings(app, &summary, &mut emitted_findings);
        }
    } else {
        summary.document_type = "Unknown".to_string();
        add_finding(
            &mut summary,
            "Unknown",
            "Page Detection",
            "FAIL",
            "High",
            "Document type not detected",
            "Heading dan struktur halaman tidak cocok dengan TMP atau SIT Phase 1.",
            "Masukkan URL halaman TMP atau SIT yang sesuai template.",
            None,
            Some("TMP atau SIT"),
            Some(&root.title),
            Some(page_url(config, &root)),
        );
    }

    let scenario_count = scenario_capture_pages.len();
    for (idx, target) in scenario_capture_pages.iter().enumerate() {
        completed_units += 1;
        emit_progress(
            app,
            "check",
            format!("Memvalidasi Scenario Detail {}/{}: {}...", idx + 1, scenario_count, target.title),
            completed_units,
            total_units,
        );
        validate_scenario_capture_tables(target, config, &mut summary, &mut score);
        flush_new_findings(app, &summary, &mut emitted_findings);
    }

    summary.score = score_to_percent(score);
    finalize_counts(&mut summary);
    emit_progress(
        app,
        "done",
        format!("Review selesai. {} temuan ditemukan.", summary.findings.len()),
        total_units,
        total_units,
    );
    Ok(summary)
}

async fn collect_children(
    confluence: &ConfluenceService,
    config: &crate::models::app_config::ConfluenceConfig,
    parent_id: &str,
    pages: &mut Vec<Value>,
    visited: &mut HashSet<String>,
    app: Option<&tauri::AppHandle>,
) -> Result<()> {
    const MAX_PAGES: usize = 100;
    let mut queue: Vec<String> = vec![parent_id.to_string()];
    let mut guard = 0usize;
    while !queue.is_empty() && pages.len() < MAX_PAGES {
        guard += 1;
        if guard > MAX_PAGES * 4 {
            break;
        }
        let level: Vec<String> = std::mem::take(&mut queue)
            .into_iter()
            .filter(|id| visited.insert(id.clone()))
            .take(MAX_PAGES.saturating_sub(pages.len()).max(1))
            .collect();
        let fetches = level.iter().map(|current| {
            let current = current.clone();
            async move {
                let mut children = confluence
                    .list_child_pages(config, &current)
                    .await
                    .unwrap_or_default();
                if children.is_empty() {
                    if let Ok(mut listed) = confluence.list_pages(config, &current).await {
                        listed.retain(|page| {
                            page["id"].as_str() != Some(current.as_str())
                                && page["ancestors"]
                                    .as_array()
                                    .map(|ancestors| {
                                        ancestors
                                            .iter()
                                            .any(|ancestor| ancestor["id"].as_str() == Some(current.as_str()))
                                    })
                                    .unwrap_or(true)
                        });
                        children = listed;
                    }
                }
                (current, children)
            }
        });
        let fetched: Vec<(String, Vec<Value>)> = futures::future::join_all(fetches).await;
        let total_fetched: usize = fetched.iter().map(|(_, children)| children.len()).sum();
        if total_fetched > 0 {
            emit_progress(
                app,
                "fetch",
                format!(
                    "Mengambil halaman Confluence... {} halaman terkumpul.",
                    pages.len()
                ),
                0,
                0,
            );
        }
        for (current, children) in fetched {
            for mut child in children {
                let id = child["id"].as_str().unwrap_or("").to_string();
                if id.is_empty() || pages.iter().any(|p| p["id"].as_str() == Some(id.as_str())) {
                    continue;
                }
                if child["ancestors"].as_array().is_none() {
                    child["ancestors"] = serde_json::json!([{ "id": current }]);
                }
                pages.push(child);
                queue.push(id);
                if pages.len() >= MAX_PAGES {
                    break;
                }
            }
            if pages.len() >= MAX_PAGES {
                break;
            }
        }
    }
    Ok(())
}

fn page_data(raw: Value) -> Result<PageData> {
    let id = raw["id"].as_str().unwrap_or("").to_string();
    if id.is_empty() {
        return Err(ServiceError::NotFound(
            "Confluence page ID tidak ditemukan".into(),
        ));
    }
    let title = raw["title"].as_str().unwrap_or("").to_string();
    let storage = raw["body"]["storage"]["value"].as_str().unwrap_or("");
    let view = raw["body"]["view"]["value"].as_str().unwrap_or("");
    let content = match (storage.trim().is_empty(), view.trim().is_empty()) {
        (false, false) => format!("{storage}\n{view}"),
        (false, true) => storage.to_string(),
        (true, false) => view.to_string(),
        (true, true) => String::new(),
    };
    let plain = strip_html(&content);
    let parent_id = raw["ancestors"]
        .as_array()
        .and_then(|ancestors| ancestors.last())
        .and_then(|ancestor| ancestor["id"].as_str())
        .map(str::to_string);
    Ok(PageData {
        raw,
        id,
        title,
        content,
        plain,
        parent_id,
    })
}

fn detect_document_type(page: &PageData) -> String {
    let normalized = normalize(&page.plain);
    let title = normalize(&page.title);
    let has_tmp = is_tmp_structure(page);
    let has_sit = title.contains("system integration test")
        || title.contains("sit")
        || normalized.contains("system integration test")
        || normalized.contains("test management process sit")
        || (normalized.contains("test strategy sit")
            && (normalized.contains("test completion report sit")
                || normalized.contains("test execution log")
                || normalized.contains("test plan sit")));
    match (has_tmp, has_sit) {
        (true, _) => "TMP".to_string(),
        (false, true) => "SIT".to_string(),
        _ => "Unknown".to_string(),
    }
}

fn is_tmp_structure(page: &PageData) -> bool {
    let normalized = normalize(&page.plain);
    let required = [
        "test basis",
        "risk of testing",
        "items test scope",
        "assumption constraint",
        "staffing",
        "test status report",
        "approval form",
    ];
    let section_count = required
        .iter()
        .filter(|section| normalized.contains(**section))
        .count();
    let checklist_table = normalized.contains("checklist") && normalized.contains("link");
    (normalized.contains("test management process")
        && !normalized.contains("test management process sit"))
        || (checklist_table && section_count >= 2)
        || section_count >= 4
}

fn classify_page_type(page: &PageData, pages: &[PageData]) -> String {
    let mut visited = HashSet::new();
    if let Some(phase) = inherited_phase(page, pages, &mut visited) {
        return phase;
    }
    detect_document_type(page)
}

fn inherited_phase(
    page: &PageData,
    pages: &[PageData],
    visited: &mut HashSet<String>,
) -> Option<String> {
    if !visited.insert(page.id.clone()) {
        return None;
    }
    if let Some(parent_id) = &page.parent_id {
        if let Some(parent) = pages.iter().find(|candidate| &candidate.id == parent_id) {
            if let Some(phase) = inherited_phase(parent, pages, visited) {
                return Some(phase);
            }
        }
    }
    phase_from_title(page)
}

fn phase_from_title(page: &PageData) -> Option<String> {
    let title = normalize(&page.title);
    if title.contains("user acceptance test") || title.split_whitespace().any(|word| word == "uat") {
        return Some("UAT".to_string());
    }
    if title.contains("deployment test") || title.contains("deploy test") {
        return Some("DT".to_string());
    }
    if title.contains("system integration test") || title.split_whitespace().any(|word| word == "sit") {
        return Some("SIT".to_string());
    }
    None
}

fn is_sit_review_candidate(page: &PageData) -> bool {
    let title = normalize(&page.title);
    let plain = normalize(&page.plain);
    plain.contains("test management process sit")
        || (title.contains("system integration test")
            && (plain.contains("test plan sit") || plain.contains("test strategy sit")))
}

fn add_missing_sit_finding(
    summary: &mut ReviewSummary,
    config: &AppConfig,
    root: &PageData,
    pages: &[PageData],
) {
    let candidates: Vec<&PageData> = pages
        .iter()
        .filter(|page| page.id != root.id)
        .filter(|page| {
            let title = normalize(&page.title);
            let plain = normalize(&page.plain);
            title.contains("sit")
                || title.contains("system integration test")
                || plain.contains("test strategy")
                || plain.contains("test execution")
                || plain.contains("test completion report")
        })
        .collect();

    if candidates.is_empty() {
        add_finding_ext(
            summary,
            "TMP",
            "Hierarchy",
            "WARNING",
            "Medium",
            "SIT child page not found",
            "TMP terdeteksi, tetapi tidak ditemukan child page SIT yang dapat direview.",
            "Pastikan halaman SIT menjadi child page langsung atau hierarchy Confluence dapat diakses.",
            None,
            None,
            None,
            Some(page_url(config, root)),
            None,
            None,
            Some("hierarchy"),
        );
        return;
    }

    let evidence = candidates
        .iter()
        .take(10)
        .map(|page| format!("{} ({})", page.title, page.id))
        .collect::<Vec<_>>()
        .join(", ");
    add_finding_ext(
        summary,
        "TMP",
        "Hierarchy",
        "WARNING",
        "Medium",
        "SIT child page candidate not recognized",
        format!(
            "Ada kandidat child SIT, tetapi struktur minimum belum cukup untuk diklasifikasikan sebagai SIT: {evidence}."
        ),
        "Periksa heading/section SIT pada kandidat atau perluas pola deteksi dokumen.",
        None,
        Some("SIT child page yang terdeteksi dari hierarchy"),
        Some(&evidence),
        Some(page_url(config, root)),
        Some(0.6),
        Some(evidence.clone()),
        Some("hierarchy"),
    );
}

struct TmpProjectIdentity {
    key: String,
    name: String,
}

struct TmpLinkCheck {
    title: String,
    status: String,
    description: String,
    evidence: Option<String>,
    source_url: Option<String>,
}

async fn validate_tmp_links(
    page: &PageData,
    config: &AppConfig,
    confluence: &ConfluenceService,
    jira: &JiraService,
    jira_project_key: &str,
) -> Vec<TmpLinkCheck> {
    let identity = project_identity(&page.title);
    vec![
        validate_jira_link(page, config, jira, jira_project_key, identity.as_ref()).await,
        validate_confluence_link(
            page,
            config,
            confluence,
            "Perencanaan / BRD",
            &["perencanaan", "planning"],
            |title, _| {
                let normalized = normalize(title);
                normalized.contains("brd")
                    || identity
                        .as_ref()
                        .is_some_and(|project| matches_project_text(&normalized, project))
            },
        )
        .await,
        validate_confluence_link(
            page,
            config,
            confluence,
            "Pengembangan",
            &["pengembangan", "development"],
            |title, _| {
                identity
                    .as_ref()
                    .is_some_and(|project| matches_project_text(&normalize(title), project))
            },
        )
        .await,
        validate_uqa_link(page, config, jira, identity.as_ref()).await,
        validate_confluence_link(
            page,
            config,
            confluence,
            "Test Basis / Requirement",
            &["requirement"],
            |title, _| {
                let normalized = normalize(title);
                normalized.contains("brd")
                    || identity
                        .as_ref()
                        .is_some_and(|project| matches_project_text(&normalized, project))
            },
        )
        .await,
        validate_system_design_link(page, config, confluence, identity.as_ref()).await,
    ]
}

async fn validate_jira_link(
    page: &PageData,
    config: &AppConfig,
    jira: &JiraService,
    jira_project_key: &str,
    identity: Option<&TmpProjectIdentity>,
) -> TmpLinkCheck {
    let title = "Test Level / Test Types".to_string();
    let link = extract_tmp_link(&page.content, &["jira"]);
    let Some(link) = link else {
        return warning_check(title, "Kolom Test Level / Test Types tidak berisi link Jira.", None);
    };
    if let Some(project_key) = extract_jira_project_key(&link) {
        if project_key.eq_ignore_ascii_case(jira_project_key) {
            return pass_check(
                title,
                format!("Jira project link mengarah ke project {project_key}."),
                Some(format!("Project: {project_key}")),
                Some(link),
            );
        }
        return warning_check(
            title,
            format!("Jira project link mengarah ke {project_key}, expected {jira_project_key}."),
            Some(link),
        );
    }
    let Some(issue_key) = extract_jira_keys(&link).into_iter().next() else {
        return warning_check(title, "Link Jira tidak mengandung issue key yang valid.", Some(link));
    };
    let client = match jira.client(&config.jira) {
        Ok(client) => client,
        Err(error) => return warning_check(title, error.to_string(), Some(link)),
    };
    let issue = match client.get_issue_raw(&issue_key).await {
        Ok(issue) => issue,
        Err(error) => {
            return warning_check(
                title,
                format!("Jira issue {issue_key} tidak dapat diakses: {error}"),
                Some(link),
            )
        }
    };
    let actual_project = issue["fields"]["project"]["key"].as_str().unwrap_or("");
    if !actual_project.eq_ignore_ascii_case(jira_project_key) {
        return warning_check(
            title,
            format!("Jira issue {issue_key} berada di project {actual_project}, expected {jira_project_key}."),
            Some(link),
        );
    }
    let summary = issue["fields"]["summary"].as_str().unwrap_or("");
    if identity.is_some_and(|project| !matches_project_text(&normalize(summary), project)) {
        return warning_check(
            title,
            "Summary Jira tidak cocok dengan identitas project TMP.".to_string(),
            Some(link),
        );
    }
    pass_check(
        title,
        format!("Jira issue {issue_key} terisi dan berada di project {actual_project}."),
        Some(format!("Project: {actual_project}; Summary: {summary}")),
        Some(link),
    )
}

async fn validate_uqa_link(
    page: &PageData,
    config: &AppConfig,
    jira: &JiraService,
    identity: Option<&TmpProjectIdentity>,
) -> TmpLinkCheck {
    let title = "Checklist / UQA".to_string();
    let link = extract_tmp_link(&page.content, &["uqa"]);
    let Some(link) = link else {
        return warning_check(title, "Kolom UQA tidak berisi link Jira.", None);
    };
    let Some(issue_key) = extract_jira_keys(&link).into_iter().next() else {
        return warning_check(title, "Link UQA tidak mengandung issue key yang valid.", Some(link));
    };
    let client = match jira.client(&config.jira) {
        Ok(client) => client,
        Err(error) => return warning_check(title, error.to_string(), Some(link)),
    };
    let issue = match client.get_issue_raw(&issue_key).await {
        Ok(issue) => issue,
        Err(error) => {
            return warning_check(
                title,
                format!("UQA issue {issue_key} tidak dapat diakses: {error}"),
                Some(link),
            )
        }
    };
    let summary = issue["fields"]["summary"].as_str().unwrap_or("");
    if identity.is_some_and(|project| !matches_project_text(&normalize(summary), project)) {
        return warning_check(
            title,
            "Summary UQA tidak cocok dengan identitas project TMP.".to_string(),
            Some(link),
        );
    }
    pass_check(
        title,
        format!("UQA issue {issue_key} sesuai dengan project TMP."),
        Some(format!("Summary: {summary}")),
        Some(link),
    )
}

async fn validate_confluence_link<F>(
    page: &PageData,
    config: &AppConfig,
    confluence: &ConfluenceService,
    title: &str,
    labels: &[&str],
    matches_target: F,
) -> TmpLinkCheck
where
    F: Fn(&str, &PageData) -> bool,
{
    let link = extract_tmp_link(&page.content, labels);
    let Some(link) = link else {
        return warning_check(title.to_string(), "Kolom tidak berisi link Confluence.", None);
    };
    let target_raw = match confluence.get_page_by_url(&config.confluence, &link).await {
        Ok(target) => target,
        Err(error) => {
            return warning_check(
                title.to_string(),
                format!("Link Confluence tidak dapat diakses: {error}"),
                Some(link),
            )
        }
    };
    let target = match page_data(target_raw) {
        Ok(target) => target,
        Err(error) => {
            return warning_check(
                title.to_string(),
                format!("Target Confluence tidak valid: {error}"),
                Some(link),
            )
        }
    };
    if !matches_target(&target.title, &target) {
        return warning_check(
            title.to_string(),
            format!("Target page '{}' tidak cocok dengan identitas project TMP.", target.title),
            Some(link),
        );
    }
    pass_check(
        title.to_string(),
        format!("Target page '{}' sesuai dengan project TMP.", target.title),
        Some(format!("Page ID: {}; Title: {}", target.id, target.title)),
        Some(link),
    )
}

fn extract_sit_jira_link(content: &str, labels: &[&str]) -> Option<String> {
    let row_re = Regex::new(r"(?is)<tr\b[^>]*>(.*?)</tr>").ok()?;
    let cell_re = Regex::new(r"(?is)<t[dh]\b[^>]*>(.*?)</t[dh]>").ok()?;
    let key_param = Regex::new(
        r#"(?is)<ac:parameter\b[^>]*\bac:name\s*=\s*["']key["'][^>]*>\s*([A-Z][A-Z0-9]{1,15}-\d+)\s*</ac:parameter>"#,
    )
    .ok()?;
    let data_key = Regex::new(r#"data-jira-key\s*=\s*["']([A-Z][A-Z0-9]{1,15}-\d+)["']"#).ok()?;
    let browse = Regex::new(r#"/browse/([A-Z][A-Z0-9]{1,15}-\d+)"#).ok()?;
    let jira_macro = Regex::new(
        r#"(?is)<ac:structured-macro\b[^>]*\bac:name\s*=\s*["']jira["'][^>]*>(.*?)</ac:structured-macro>"#,
    )
    .ok()?;
    for row_match in row_re.captures_iter(content) {
        let row_html = row_match.get(1).map(|m| m.as_str()).unwrap_or("");
        let cells: Vec<String> = cell_re
            .captures_iter(row_html)
            .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
            .collect();
        if cells.len() < 2 {
            continue;
        }
        let label_cell = normalize(&strip_html(&cells[0]));
        if !labels.iter().any(|label| label_cell.contains(&normalize(label))) {
            continue;
        }
        let target = &cells[1];
        if let Some(m) = key_param.captures(target).and_then(|c| c.get(1)) {
            return Some(m.as_str().to_string());
        }
        if let Some(m) = jira_macro.captures(target) {
            let haystack = m.get(1).map(|x| x.as_str()).unwrap_or(target.as_str());
            if let Some(key) = extract_jira_keys(haystack).into_iter().next() {
                return Some(key);
            }
        }
        if let Some(m) = data_key.captures(target).and_then(|c| c.get(1)) {
            return Some(m.as_str().to_string());
        }
        if let Some(m) = browse.captures(target).and_then(|c| c.get(1)) {
            return Some(m.as_str().to_string());
        }
    }
    None
}

async fn validate_test_level_link(
    page: &PageData,
    summary: &mut ReviewSummary,
    config: &AppConfig,
    jira: &JiraService,
    jira_project_key: &str,
) {
    let _title = "Test Level / Test Types".to_string();
    let source_key = match extract_sit_jira_link(&page.content, &["test level", "test types"]) {
        Some(key) => key,
        None => {
            add_finding_ext(
                summary,
                "SIT",
                "Test Level / Test Types",
                "FAIL",
                "High",
                "Test Level / Test Types tidak ditemukan",
                "Field Test Level / Test Types belum berisi Jira macro atau link issue.",
                "Tambahkan Jira macro dengan issue type 'System Integration Test' di field Test Level / Test Types.",
                None,
                Some("System Integration Test"),
                None,
                Some(page_url(config, page)),
                None,
                None,
                Some("rule"),
            );
            return;
        }
    };
    let client = match jira.client(&config.jira) {
        Ok(client) => client,
        Err(error) => {
            add_finding_ext(
                summary,
                "SIT",
                "Test Level / Test Types",
                "FAIL",
                "High",
                "Jira is not configured",
                error.to_string(),
                "Lengkapi konfigurasi Jira.",
                Some(source_key),
                None,
                None,
                Some(page_url(config, page)),
                None,
                None,
                Some("rule"),
            );
            return;
        }
    };
    let issue = match client.get_issue_raw(&source_key).await {
        Ok(issue) => issue,
        Err(error) => {
            add_finding_ext(
                summary,
                "SIT",
                "Test Level / Test Types",
                "FAIL",
                "High",
                "Jira issue Test Level tidak dapat diakses",
                format!("{source_key}: {error}"),
                "Periksa Jira key dan akses Jira API.",
                Some(source_key),
                Some(jira_project_key),
                None,
                Some(page_url(config, page)),
                None,
                None,
                Some("rule"),
            );
            return;
        }
    };
    let fields = &issue["fields"];
    let issue_type = fields["issuetype"]["name"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let actual_project = fields["project"]["key"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let issue_summary = fields["summary"].as_str().unwrap_or("").to_string();
    let expected_type = "System Integration Test";
    let project_match = actual_project.eq_ignore_ascii_case(jira_project_key);
    let type_match = issue_type.eq_ignore_ascii_case(expected_type);
    let description = format!(
        "Issue {source_key} (type='{issue_type}', project='{actual_project}') dirujuk dari field Test Level / Test Types."
    );
    let evidence = format!(
        "Project: {actual_project}; Type: {issue_type}; Summary: {issue_summary}"
    );
    if !project_match {
        add_finding_ext(
            summary,
            "SIT",
            "Test Level / Test Types",
            "FAIL",
            "High",
            "Jira project mismatch pada Test Level",
            format!(
                "{source_key} belongs to project {actual_project}, expected {jira_project_key}."
            ),
            "Gunakan issue dengan project yang sesuai.",
            Some(source_key),
            Some(jira_project_key),
            Some(&actual_project),
            Some(page_url(config, page)),
            None,
            Some(evidence),
            Some("rule"),
        );
        return;
    }
    if !type_match {
        add_finding_ext(
            summary,
            "SIT",
            "Test Level / Test Types",
            "WARNING",
            "Medium",
            "Jira issue type tidak sesuai",
            format!(
                "{source_key} memiliki issue type '{issue_type}', expected '{expected_type}'."
            ),
            "Pastikan issue Test Level / Test Types memiliki type 'System Integration Test'.",
            Some(source_key),
            Some(expected_type),
            Some(&issue_type),
            Some(page_url(config, page)),
            None,
            Some(evidence),
            Some("rule"),
        );
        return;
    }
    add_finding_ext(
        summary,
        "SIT",
        "Test Level / Test Types",
        "PASS",
        "Info",
        "Test Level / Test Types sesuai",
        description,
        "",
        Some(source_key),
        Some(expected_type),
        Some(&issue_type),
        Some(page_url(config, page)),
        None,
        Some(evidence),
        Some("rule"),
    );
}

async fn validate_system_design_link(
    page: &PageData,
    config: &AppConfig,
    confluence: &ConfluenceService,
    identity: Option<&TmpProjectIdentity>,
) -> TmpLinkCheck {
    let title = "Test Basis / System Design".to_string();
    let link = extract_tmp_link(&page.content, &["system design"]);
    let Some(link) = link else {
        return warning_check(title, "System Design tidak berisi link Confluence.", None);
    };
    let target_raw = match confluence.get_page_by_url(&config.confluence, &link).await {
        Ok(target) => target,
        Err(error) => {
            return warning_check(
                title,
                format!("Link System Design tidak dapat diakses: {error}"),
                Some(link),
            )
        }
    };
    let target = match page_data(target_raw) {
        Ok(target) => target,
        Err(error) => {
            return warning_check(title, format!("Target System Design tidak valid: {error}"), Some(link));
        }
    };
    let parent_titles = confluence_ancestor_titles(config, confluence, &target).await;
    let parent_matches = identity.is_some_and(|project| {
        parent_titles
            .iter()
            .any(|ancestor| matches_project_text(&normalize(ancestor), project))
    });
    let title_matches = normalize(&target.title).contains("system design");
    if !parent_matches || !title_matches {
        return warning_check(
            title,
            format!(
                "Target '{}' tidak berada pada parent project yang sesuai atau bukan page System Design.",
                target.title
            ),
            Some(link),
        );
    }
    pass_check(
        title,
        format!("System Design '{}' berada di bawah parent project yang sesuai.", target.title),
        Some(format!("Ancestors: {}", parent_titles.join(" > "))),
        Some(link),
    )
}

async fn confluence_ancestor_titles(
    config: &AppConfig,
    confluence: &ConfluenceService,
    page: &PageData,
) -> Vec<String> {
    let mut titles = Vec::new();
    if let Some(ancestors) = page.raw["ancestors"].as_array() {
        for ancestor in ancestors {
            if let Some(title) = ancestor["title"].as_str() {
                titles.push(title.to_string());
            } else if let Some(id) = ancestor["id"].as_str() {
                if let Ok(raw) = confluence.get_page(&config.confluence, id).await {
                    if let Some(title) = raw["title"].as_str() {
                        titles.push(title.to_string());
                    }
                }
            }
        }
    }
    titles
}

fn project_identity(title: &str) -> Option<TmpProjectIdentity> {
    let cleaned = Regex::new(r"^\[[^\]]+\]\s*-\s*")
        .ok()?
        .replace(title, "")
        .to_string();
    let mut parts = cleaned.splitn(2, " - ");
    let key = parts.next()?.trim().to_string();
    let name = parts.next()?.trim().to_string();
    if key.is_empty() || name.is_empty() {
        return None;
    }
    Some(TmpProjectIdentity { key, name })
}

fn matches_project_text(normalized_text: &str, identity: &TmpProjectIdentity) -> bool {
    let key = normalize(&identity.key);
    let name = normalize(&identity.name);
    normalized_text.contains(&key) || (!name.is_empty() && normalized_text.contains(&name))
}

fn extract_tmp_link(content: &str, labels: &[&str]) -> Option<String> {
    let href = Regex::new(r#"(?is)<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>"#).ok()?;
    let key_param = Regex::new(
        r#"(?is)<ac:parameter\b[^>]*\bac:name\s*=\s*["']key["'][^>]*>\s*([A-Z][A-Z0-9]{1,15}-\d+)\s*</ac:parameter>"#,
    )
    .ok()?;
    let jira_macro = Regex::new(
        r#"(?is)<ac:structured-macro\b[^>]*\bac:name\s*=\s*["']jira["'][^>]*>(.*?)</ac:structured-macro>"#,
    )
    .ok()?;
    let row_re = Regex::new(r"(?is)<tr\b[^>]*>(.*?)</tr>").ok()?;
    let cell_re = Regex::new(r"(?is)<t[dh]\b[^>]*>(.*?)</t[dh]>").ok()?;

    for row_match in row_re.captures_iter(content) {
        let row_html = row_match.get(1).map(|m| m.as_str()).unwrap_or("");
        let cells: Vec<String> = cell_re
            .captures_iter(row_html)
            .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
            .collect();
        if cells.len() < 2 {
            continue;
        }
        let label_cell = normalize(&strip_html(&cells[0]));
        let target_cell = &cells[1];
        if !labels.iter().any(|label| label_cell.contains(&normalize(label))) {
            continue;
        }
        if let Some(link) = href.captures(target_cell).and_then(|c| c.get(1)) {
            return Some(link.as_str().replace("&", "&"));
        }
        if let Some(m) = key_param.captures(target_cell).and_then(|c| c.get(1)) {
            return Some(m.as_str().to_string());
        }
        if let Some(m) = jira_macro.captures(target_cell) {
            let haystack = m.get(1).map(|x| x.as_str()).unwrap_or(target_cell.as_str());
            if let Some(key) = extract_jira_keys(haystack).into_iter().next() {
                return Some(key);
            }
        }
    }
    None
}

fn extract_jira_project_key(link: &str) -> Option<String> {
    Regex::new(r"(?i)/projects/([A-Z][A-Z0-9_]{1,15})(?:[/?#]|$)")
        .ok()?
        .captures(link)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_uppercase())
}

fn pass_check(
    title: String,
    description: String,
    evidence: Option<String>,
    source_url: Option<String>,
) -> TmpLinkCheck {
    TmpLinkCheck {
        title,
        status: "PASS".to_string(),
        description,
        evidence,
        source_url,
    }
}

fn warning_check(
    title: impl Into<String>,
    description: impl Into<String>,
    source_url: Option<String>,
) -> TmpLinkCheck {
    TmpLinkCheck {
        title: title.into(),
        status: "WARNING".to_string(),
        description: description.into(),
        evidence: None,
        source_url,
    }
}

async fn validate_tmp(
    page: &PageData,
    summary: &mut ReviewSummary,
    score: &mut Score,
    config: &AppConfig,
    confluence: &ConfluenceService,
    jira: &JiraService,
    jira_project_key: &str,
) -> Result<()> {
    let required = [
        "test basis",
        "risk of testing",
        "items & test scope",
        "assumption & constraint",
        "staffing",
        "test status report",
        "approval form",
    ];
    let missing: Vec<&str> = required
        .iter()
        .copied()
        .filter(|label| !contains_label(page, label))
        .collect();
    let status = if missing.is_empty() { "PASS" } else { "FAIL" };
    let description = if missing.is_empty() {
        "Heading utama dan seluruh section wajib TMP ditemukan.".to_string()
    } else {
        format!("Section TMP yang belum ditemukan: {}.", missing.join(", "))
    };
    add_weighted(
        summary,
        score,
        "TMP",
        "TMP Structure",
        status,
        "High",
        "TMP structure validation",
        description,
        if missing.is_empty() { "" } else { "Lengkapi section TMP yang hilang." },
        20,
        config,
        page,
    );

    let fields = ["maker", "checker", "signer"];
    let missing_fields: Vec<&str> = fields
        .iter()
        .copied()
        .filter(|label| !contains_label(page, label))
        .collect();
    let status = if missing_fields.is_empty() {
        "PASS"
    } else {
        "FAIL"
    };
    let missing_roles = if missing_fields.is_empty() {
        "Kolom Maker, Checker, dan Signer terisi.".to_string()
    } else {
        format!("Missing role: {}", missing_fields.join(", "))
    };
    add_weighted(
        summary,
        score,
        "TMP",
        "Approval Form",
        status,
        "High",
        "Approval Form validation",
        format!("Missing role: {missing_roles}"),
        if missing_fields.is_empty() { "" } else { "Lengkapi Maker, Checker, dan Signer." },
        10,
        config,
        page,
    );

    let link_checks = validate_tmp_links(page, config, confluence, jira, jira_project_key).await;
    for check in link_checks {
        let severity = if check.status == "WARNING" { "Medium" } else { "Info" };
        add_weighted(
            summary,
            score,
            "TMP",
            "TMP Checklist and Link Validation",
            &check.status,
            severity,
            &check.title,
            check.description,
            "Periksa link dan target page/issue yang digunakan pada TMP.",
            TMP_LINK_WEIGHT,
            config,
            page,
        );
        if let Some(last) = summary.findings.last_mut() {
            last.validation_source = Some("rule".to_string());
            last.source_url = check.source_url.or_else(|| Some(page_url(config, page)));
            last.evidence = check.evidence;
        }
    }

    Ok(())
}

#[derive(Debug, Clone)]
enum SemanticDecision {
    Valid {
        confidence: f64,
        reason: String,
        evidence: String,
    },
    Invalid {
        confidence: f64,
        reason: String,
        evidence: String,
    },
    LowConfidence {
        confidence: f64,
        reason: String,
        evidence: String,
    },
    Unavailable(String),
    Skipped,
}

#[derive(Debug, Default)]
struct ExecutionCache {
    entries: HashMap<String, ExecutionCacheEntry>,
}

#[derive(Debug, Default)]
struct ExecutionCacheEntry {
    issue_error: Option<String>,
    issue: Option<IssueFetch>,
    runs: Option<Result<Vec<XrayTestRun>>>,
}

#[derive(Debug)]
struct IssueFetch {
    issue_type: String,
    summary: String,
    project_key: String,
    status: String,
}

async fn validate_sit(
    page: &PageData,
    summary: &mut ReviewSummary,
    score: &mut Score,
    config: &AppConfig,
    jira: &JiraService,
    ollama: Option<&OllamaService>,
    semantic_warning_added: &mut bool,
    jira_project_key: &str,
    ollama_ready: bool,
    execution_cache: &mut ExecutionCache,
) -> Result<()> {
    let checks: [(&str, &[&str], &str, &str); 10] = [
        (
            "SIT Structure",
            &[
                "test plan sit",
                "test strategy sit",
                "test model specification sit",
                "test model & traceability sit",
                "test data requirement & readiness sit",
                "test environment requirement and readiness sit",
                "test execution log",
                "test completion report sit",
                "summary of system integration test",
                "residual risk",
                "lesson learned",
            ],
            "SIT structure is complete",
            "Lengkapi required SIT heading/section.",
        ),
        (
            "Test Strategy SIT",
            &[
                "entry criteria",
                "exit criteria",
                "test design techniques",
                "test data",
                "test environment",
                "testing schedule",
            ],
            "Test Strategy SIT fields are complete",
            "Lengkapi field wajib Test Strategy SIT.",
        ),
        (
            "Test Model & Traceability SIT",
            &["test model", "traceability"],
            "Test Model and Traceability are documented",
            "Lengkapi Test Model dan Traceability.",
        ),
        (
            "Scenario Detail and Screen Capture SIT",
            &["scenario detail", "screen capture"],
            "Scenario detail and evidence references are present",
            "Lengkapi Scenario Detail dan Screen Capture SIT.",
        ),
        (
            "Test Data Requirement and Readiness SIT",
            &["test data requirement", "readiness"],
            "Test data requirement and readiness are documented",
            "Lengkapi Test Data Requirement and Readiness.",
        ),
        (
            "Test Environment Requirement and Readiness SIT",
            &["test environment requirement", "readiness"],
            "Test environment requirement and readiness are documented",
            "Lengkapi Test Environment Requirement and Readiness.",
        ),
        (
            "Test Execution Log and Result SIT",
            &["test execution", "test execution log"],
            "Test execution reference and result are documented",
            "Lengkapi Test Execution Log dan result.",
        ),
        (
            "Test Incident Report SIT",
            &["test incident report"],
            "Test incident outcome is documented",
            "Lengkapi Test Incident Report.",
        ),
        (
            "Test Completion Report SIT",
            &[
                "test completion report",
                "test completion evaluation",
                "test measures",
                "test deliverables",
            ],
            "Completion report fields are present",
            "Lengkapi Test Completion Report, Test Measures, dan Test Deliverables.",
        ),
        (
            "Residual Risk",
            &["residual risk"],
            "Residual risk is documented",
            "Tambahkan Residual Risk atau pernyataan tidak ada residual risk.",
        ),
    ];
    let mut ai_recommendations: Vec<(String, f64, String, String)> = Vec::new();
    let mut section_missing: Vec<(Vec<&str>, Vec<String>)> = Vec::with_capacity(checks.len());
    let mut semantic_order: Vec<usize> = Vec::new();
    for (idx, (section, labels, _, _)) in checks.iter().copied().enumerate() {
        let missing = missing_labels(page, labels);
        let invalid_values = if section == "SIT Structure" || !missing.is_empty() {
            Vec::new()
        } else {
            suspicious_label_values(page, labels)
        };
        if missing.is_empty() && invalid_values.is_empty() {
            semantic_order.push(idx);
        }
        section_missing.push((missing, invalid_values));
    }
    let semantic_futures: Vec<_> = semantic_order
        .iter()
        .map(|&idx| {
            let (section, labels, _, _) = checks[idx];
            semantic_validate_section(page, section, labels, config, ollama, ollama_ready)
        })
        .collect();
    let semantic_results: Vec<SemanticDecision> =
        futures::future::join_all(semantic_futures).await;
    let mut semantics: Vec<SemanticDecision> =
        vec![SemanticDecision::Skipped; checks.len()];
    for (idx, semantic) in semantic_order.into_iter().zip(semantic_results.into_iter()) {
        semantics[idx] = semantic;
    }
    for (idx, (section, _labels, title, recommendation)) in checks.iter().copied().enumerate() {
        let (missing, invalid_values) = &section_missing[idx];
        let semantic = &semantics[idx];
        if matches!(semantic, SemanticDecision::Unavailable(_)) && !*semantic_warning_added {
            *semantic_warning_added = true;
            add_finding_ext(
                summary,
                "SIT",
                "Semantic Validation",
                "WARNING",
                "Medium",
                "AI semantic validation skipped",
                "Ollama tidak tersedia atau tidak mengembalikan respons valid. Review tetap dilanjutkan dengan rule deterministik dan guard value sederhana.",
                "Nyalakan Ollama untuk validasi konteks isi yang lebih akurat.",
                None,
                None,
                None,
                Some(page_url(config, page)),
                None,
                None,
                Some("ai"),
            );
        }
        let status = if !missing.is_empty() || !invalid_values.is_empty() {
            "FAIL"
        } else {
            "PASS"
        };
        let description = if !missing.is_empty() {
            format!("Missing: {}", missing.join(", "))
        } else if !invalid_values.is_empty() {
            format!(
                "Field berisi value kosong/placeholder/tidak bermakna: {}.",
                invalid_values.join(", ")
            )
        } else {
            title.to_string()
        };
        let weight = SIT_WEIGHTS
            .iter()
            .find(|(name, _)| *name == section)
            .map(|(_, weight)| *weight)
            .unwrap_or(2);
        add_weighted(
            summary,
            score,
            "SIT",
            section,
            status,
            if status == "FAIL" { "High" } else { "Info" },
            title,
            description,
            recommendation,
            weight,
            config,
            page,
        );
        if let Some(last) = summary.findings.last_mut() {
            match semantic {
                SemanticDecision::Skipped if !invalid_values.is_empty() => {
                    last.evidence = Some(invalid_values.join(", "));
                    last.validation_source = Some("rule".to_string());
                }
                _ => {
                    last.validation_source = Some("rule".to_string());
                }
            }
        }
        if let SemanticDecision::Invalid {
            confidence,
            reason,
            evidence,
        }
        | SemanticDecision::LowConfidence {
            confidence,
            reason,
            evidence,
        } = semantic
        {
            ai_recommendations.push((
                section.to_string(),
                *confidence,
                reason.clone(),
                evidence.clone(),
            ));
        }
    }

    if !ai_recommendations.is_empty() {
        let description = ai_recommendations
            .iter()
            .map(|(section, _, reason, _)| format!("- {section}: {reason}"))
            .collect::<Vec<_>>()
            .join("\n");
        let evidence = ai_recommendations
            .iter()
            .map(|(section, _, _, evidence)| format!("- {section}: {evidence}"))
            .collect::<Vec<_>>()
            .join("\n");
        let confidence = ai_recommendations
            .iter()
            .map(|(_, confidence, _, _)| *confidence)
            .sum::<f64>()
            / ai_recommendations.len() as f64;
        add_finding_ext(
            summary,
            "SIT",
            "AI Recommendations",
            "WARNING",
            "Medium",
            "AI recommendations for SIT review",
            description,
            "Review the listed sections manually; AI findings do not change the deterministic PASS/FAIL result.",
            None,
            None,
            None,
            Some(page_url(config, page)),
            Some(confidence),
            Some(evidence),
            Some("ai"),
        );
    }

    let lesson_status = if contains_label(page, "lesson learned") && has_actionable_lesson(page) {
        "PASS"
    } else if contains_label(page, "lesson learned") {
        "WARNING"
    } else {
        "FAIL"
    };
    let lesson_description = if lesson_status == "PASS" {
        "Lesson learned dan action/recommendation ditemukan."
    } else {
        "Lesson learned belum memiliki action yang jelas."
    };
    add_weighted(
        summary,
        score,
        "SIT",
        "Lesson Learned",
        lesson_status,
        "Low",
        "Lesson Learned validation",
        lesson_description,
        "Tambahkan action atau recommendation yang spesifik.",
        2,
        config,
        page,
    );

    let _ = validate_jira_and_reconcile(page, summary, config, jira, jira_project_key, execution_cache)
        .await;
    validate_test_level_link(page, summary, config, jira, jira_project_key).await;
    Ok(())
}

/// Required columns on the table inside `Scenario Detail & Screen Capture SIT` page.
/// Header labels in Confluence are accepted case-insensitively and with `&` <-> `and`.
const SCENARIO_CAPTURE_REQUIRED_COLUMNS: &[&str] = &[
    "no. test case",
    "function",
    "kategori",
    "input data",
    "steps",
    "expected result",
    "result",
    "screen capture",
];

const SCENARIO_COMPLETENESS_WEIGHT: u32 = 10;
const SCENARIO_COUNT_WEIGHT: u32 = 5;

fn is_scenario_capture_sit_title(title: &str) -> bool {
    let normalized = normalize(title);
    if !normalized.contains("scenario detail") {
        return false;
    }
    if !normalized.contains("screen capture") {
        return false;
    }
    !normalized.contains("sop verification")
}

fn collect_scenario_capture_sit_pages<'a>(
    pages: &'a [PageData],
    page_types: &[String],
) -> Vec<&'a PageData> {
    let candidates: Vec<&'a PageData> = pages
        .iter()
        .zip(page_types.iter())
        .filter(|(_, document_type)| document_type.as_str() == "SIT")
        .map(|(page, _)| page)
        .filter(|page| is_scenario_capture_sit_title(&page.title))
        .collect();
    let candidate_ids: HashSet<&str> = candidates
        .iter()
        .map(|page| page.id.as_str())
        .collect();
    candidates
        .into_iter()
        .filter(|page| {
            !pages.iter().any(|other| {
                other.parent_id.as_deref() == Some(page.id.as_str())
                    && candidate_ids.contains(other.id.as_str())
            })
        })
        .collect()
}

#[derive(Debug, Default)]
struct HtmlCell {
    /// Raw stripped text (trimmed), preserving meaningful values like "-".
    text: String,
    /// Normalized text used only for matching header labels.
    normalized: String,
    has_image: bool,
    has_attachment: bool,
}

fn parse_html_tables(html: &str) -> Vec<Vec<Vec<HtmlCell>>> {
    let mut tables: Vec<Vec<Vec<HtmlCell>>> = Vec::new();
    let mut depth: i32 = 0;
    let mut current_table_depth: i32 = -1;
    let mut current_table: Option<Vec<Vec<HtmlCell>>> = None;
    let mut current_row: Option<Vec<HtmlCell>> = None;
    let mut current_cell: Option<HtmlCell> = None;
    let mut cell_text = String::new();

    let tag_re = Regex::new(r"(?is)<(/?)([a-zA-Z][a-zA-Z0-9:_-]*)\b[^>]*>").unwrap();
    let mut last_end = 0usize;

    for cap in tag_re.captures_iter(html) {
        let start = cap.get(0).map(|m| m.start()).unwrap_or(0);
        let end = cap.get(0).map(|m| m.end()).unwrap_or(0);
        if current_cell.is_some() && start > last_end {
            cell_text.push_str(&html[last_end..start]);
        }
        last_end = end;

        let is_close = !cap.get(1).map(|m| m.as_str().is_empty()).unwrap_or(false);
        let raw_tag = cap
            .get(2)
            .map(|m| m.as_str().to_ascii_lowercase())
            .unwrap_or_default();
        let tag = raw_tag.as_str();
        match tag {
            "table" => {
                if is_close {
                    if depth == current_table_depth && current_table.is_some() {
                        if let Some(row) = current_row.take() {
                            if let Some(table) = current_table.as_mut() {
                                table.push(row);
                            }
                        }
                        let finished = current_table.take().unwrap();
                        tables.push(finished);
                        current_table_depth = -1;
                        current_row = None;
                        current_cell = None;
                        cell_text.clear();
                    }
                    depth -= 1;
                } else {
                    depth += 1;
                    if current_table_depth < 0 {
                        current_table_depth = depth;
                        current_table = Some(Vec::new());
                        current_row = None;
                        current_cell = None;
                        cell_text.clear();
                    }
                }
            }
            "tr" => {
                if depth == current_table_depth {
                    if !is_close {
                        if let Some(table) = current_table.as_mut() {
                            if let Some(row) = current_row.take() {
                                table.push(row);
                            }
                            current_row = Some(Vec::new());
                        }
                        current_cell = None;
                        cell_text.clear();
                    } else if current_row.is_some() {
                        if let Some(cell) = current_cell.take() {
                            let mut cell = cell;
                            cell.text = strip_html(&cell_text).trim().to_string();
                            cell.normalized = normalize_cell_text(&cell.text);
                            if let Some(row) = current_row.as_mut() {
                                row.push(cell);
                            }
                        }
                        cell_text.clear();
                    }
                }
            }
            "td" | "th" => {
                if depth != current_table_depth {
                    continue;
                }
                if is_close {
                    if let Some(cell) = current_cell.take() {
                        let mut cell = cell;
                        cell.text = strip_html(&cell_text).trim().to_string();
                        cell.normalized = normalize_cell_text(&cell.text);
                        if let Some(row) = current_row.as_mut() {
                            row.push(cell);
                        }
                    }
                    cell_text.clear();
                } else if current_row.is_some() {
                    current_cell = Some(HtmlCell::default());
                    cell_text.clear();
                }
            }
            "img" | "ac:image" | "ri:attachment" | "ri:file" | "ac:link" if !is_close => {
                if let Some(cell) = current_cell.as_mut() {
                    if tag == "img" || tag == "ac:image" {
                        cell.has_image = true;
                    } else {
                        cell.has_attachment = true;
                    }
                }
            }
            _ => {}
        }
    }

    if current_cell.is_some() {
        let segment = &html[last_end..];
        if !segment.is_empty() {
            cell_text.push_str(segment);
            let mut cell = current_cell.take().unwrap();
            cell.text = strip_html(&cell_text).trim().to_string();
            cell.normalized = normalize_cell_text(&cell.text);
            if let Some(row) = current_row.as_mut() {
                row.push(cell);
            }
        }
    }

    tables
}

fn dedupe_tables(tables: Vec<Vec<Vec<HtmlCell>>>) -> Vec<Vec<Vec<HtmlCell>>> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for table in tables {
        let fingerprint: String = table
            .iter()
            .map(|row| {
                row.iter()
                    .map(|cell| {
                        format!("{}|{}|{}", cell.text, cell.has_image, cell.has_attachment)
                    })
                    .collect::<Vec<_>>()
                    .join("\x1f")
            })
            .collect::<Vec<_>>()
            .join("\x1e");
        if seen.insert(fingerprint) {
            out.push(table);
        }
    }
    out
}

fn normalize_cell_text(text: &str) -> String {
    let lowered = text.to_lowercase();
    let cleaned: String = lowered
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn cell_has_value(cell: &HtmlCell) -> bool {
    if !cell.text.is_empty() {
        return true;
    }
    cell.has_image || cell.has_attachment
}

fn header_index(headers: &[String], expected: &str) -> Option<usize> {
    let normalized_expected = normalize_cell_text(expected);
    headers.iter().position(|header| header == &normalized_expected)
}

fn identify_row_test_case(headers: &[String], row: &[HtmlCell]) -> String {
    let label_indices: Vec<usize> = headers
        .iter()
        .enumerate()
        .filter_map(|(idx, header)| {
            if header == "no" || header == "no test case" || header == "no testcase" {
                Some(idx)
            } else {
                None
            }
        })
        .collect();
    if let Some(&idx) = label_indices.first() {
        if let Some(cell) = row.get(idx) {
            if !cell.text.is_empty() {
                return cell.text.clone();
            }
        }
    }
    for cell in row {
        if !cell.text.is_empty() {
            return cell.text.clone();
        }
    }
    "(tanpa label)".to_string()
}

fn find_label_value_test_case_id(table: &[Vec<HtmlCell>]) -> Option<String> {
    for row in table {
        if row.len() < 2 {
            continue;
        }
        let label = normalize_cell_text(&row[0].text);
        if label == "no test case" || label == "no" || label == "no testcase" {
            let id = row[1].text.trim().to_string();
            return Some(if id.is_empty() {
                "(tanpa No. Test Case)".to_string()
            } else {
                id
            });
        }
    }
    None
}

fn is_columnar_scenario_table(headers: &[String]) -> bool {
    headers.len() >= 3
        && headers.iter().any(|header| header == "no test case" || header == "no")
}

fn match_test_execution<'a>(
    page: &PageData,
    executions: &'a [JiraExecutionSummary],
) -> Option<&'a JiraExecutionSummary> {
    let included: Vec<&JiraExecutionSummary> = executions.iter().filter(|e| e.included).collect();
    if included.is_empty() {
        return None;
    }
    let page_keys: HashSet<String> = extract_jira_keys(&page.content)
        .into_iter()
        .collect();
    if let Some(execution) = included
        .iter()
        .find(|e| page_keys.contains(&e.key))
        .copied()
    {
        return Some(execution);
    }
    let title = normalize(&page.title);
    let rollback_page = title.contains("rollback");
    let rollback_exec = included
        .iter()
        .find(|e| normalize(&e.summary).contains("rollback"))
        .copied();
    if rollback_page {
        if rollback_exec.is_some() {
            return rollback_exec;
        }
        return included
            .iter()
            .find(|e| {
                let normalized = normalize(&e.summary);
                !normalized.contains("rollback")
                    && (normalized.contains("system integration test")
                        || normalized.contains("test execution"))
            })
            .copied();
    }
    let best = included
        .iter()
        .filter(|e| !normalize(&e.summary).contains("rollback"))
        .map(|e| (title_execution_score(&page.title, &e.summary), e))
        .max_by_key(|(score, _)| *score);
    if let Some((score, execution)) = best {
        if score > 0 {
            return Some(*execution);
        }
    }
    included
        .iter()
        .find(|e| {
            let normalized = normalize(&e.summary);
            !normalized.contains("rollback")
                && (normalized.contains("system integration test")
                    || normalized.contains("test execution"))
        })
        .copied()
}

const EXECUTION_STOPWORDS: &[&str] = &[
    "ccedur",
    "scenario",
    "detail",
    "screen",
    "capture",
    "sit",
    "uat",
    "dan",
    "test",
    "execution",
    "plan",
    "system",
    "integration",
    "of",
    "and",
    "for",
    "the",
    "after",
    "rollback",
    "negative",
    "module",
];

fn title_execution_score(page_title: &str, execution_summary: &str) -> usize {
    let significant = |text: &str| -> HashSet<String> {
        normalize(text)
            .split_whitespace()
            .filter(|word| word.len() > 2 && !EXECUTION_STOPWORDS.contains(word))
            .map(str::to_string)
            .collect()
    };
    significant(page_title)
        .intersection(&significant(execution_summary))
        .count()
}

fn validate_label_value_table(
    page: &PageData,
    config: &AppConfig,
    summary: &mut ReviewSummary,
    table: &[Vec<HtmlCell>],
    tc_id: &str,
    failed: &mut bool,
) -> bool {
    let mut rows: Vec<(String, &HtmlCell)> = Vec::new();
    for row in table {
        if row.len() < 2 {
            continue;
        }
        let label = normalize_cell_text(&row[0].text);
        if label.is_empty() {
            continue;
        }
        rows.push((label, &row[1]));
    }

    let mut missing: Vec<String> = Vec::new();
    for required in SCENARIO_CAPTURE_REQUIRED_COLUMNS {
        let normalized = normalize_cell_text(required);
        match rows.iter().find(|(label, _)| label == &normalized) {
            Some((_, cell)) => {
                if !cell_has_value(cell) {
                    missing.push(format!("{required} (kosong)"));
                }
            }
            None => missing.push(format!("{required} (tidak ada baris)")),
        }
    }

    if missing.is_empty() {
        return true;
    }
    *failed = true;
    let title = format!("Kolom tabel {tc_id} belum lengkap");
    add_finding_ext(
        summary,
        "SIT",
        "Scenario Detail & Screen Capture SIT - Table Completeness",
        "FAIL",
        "High",
        &title,
        format!(
            "Page \"{}\", tabel {tc_id} memiliki kolom yang belum diisi: {}.",
            page.title,
            missing.join(", ")
        ),
        "Lengkapi kolom yang masih kosong sebelum review dianggap PASS.",
        Some(tc_id.to_string()),
        None,
        None,
        Some(page_url(config, page)),
        None,
        Some(missing.join("; ")),
        Some("rule"),
    );
    false
}

fn validate_columnar_table(
    page: &PageData,
    config: &AppConfig,
    summary: &mut ReviewSummary,
    table: &[Vec<HtmlCell>],
    failed: &mut bool,
) -> bool {
    let Some(header_row) = table.first() else { return false };
    let headers: Vec<String> = header_row
        .iter()
        .map(|cell| cell.normalized.clone())
        .collect();
    if !is_columnar_scenario_table(&headers) {
        return false;
    }
    let column_indices: Vec<Option<usize>> = SCENARIO_CAPTURE_REQUIRED_COLUMNS
        .iter()
        .map(|required| header_index(&headers, required))
        .collect();

    let mut any_complete = false;
    for row in table.iter().skip(1) {
        if row.is_empty() {
            continue;
        }
        let row_label = identify_row_test_case(&headers, row);
        let mut missing: Vec<&str> = Vec::new();
        for (required, maybe_index) in
            SCENARIO_CAPTURE_REQUIRED_COLUMNS.iter().zip(column_indices.iter())
        {
            let Some(idx) = maybe_index else {
                missing.push(*required);
                continue;
            };
            let has_value = row.get(*idx).map(cell_has_value).unwrap_or(false);
            if !has_value {
                missing.push(*required);
            }
        }
        if missing.is_empty() {
            any_complete = true;
        } else {
            *failed = true;
            let title = format!("Kolom tabel {row_label} belum lengkap");
            add_finding_ext(
                summary,
                "SIT",
                "Scenario Detail & Screen Capture SIT - Table Completeness",
                "FAIL",
                "High",
                &title,
                format!(
                    "Page \"{}\", tabel {row_label} memiliki kolom yang belum diisi: {}.",
                    page.title,
                    missing.join(", ")
                ),
                "Lengkapi kolom yang masih kosong sebelum review dianggap PASS.",
                Some(row_label.clone()),
                None,
                None,
                Some(page_url(config, page)),
                None,
                Some(missing.join(", ")),
                Some("rule"),
            );
        }
    }
    any_complete
}

fn validate_scenario_capture_tables(
    page: &PageData,
    config: &AppConfig,
    summary: &mut ReviewSummary,
    score: &mut Score,
) {
    let storage_html = page.raw["body"]["storage"]["value"].as_str().unwrap_or("");
    let view_html = page.raw["body"]["view"]["value"].as_str().unwrap_or("");
    // ponytail: page.content = storage + view, so a third parse is always redundant
    let mut tables = dedupe_tables(parse_html_tables(storage_html));
    if tables.is_empty() {
        tables = dedupe_tables(parse_html_tables(view_html));
    }
    if tables.is_empty() {
        score.possible += SCENARIO_COMPLETENESS_WEIGHT;
        add_finding_ext(
            summary,
            "SIT",
            "Scenario Detail & Screen Capture SIT - Table Completeness",
            "FAIL",
            "High",
            "Tabel Scenario Detail & Screen Capture SIT tidak ditemukan",
            format!(
                "Page \"{}\" tidak memiliki tabel Scenario Detail & Screen Capture SIT.",
                page.title
            ),
            "Tambahkan tabel dengan kolom wajib yang tercantum di template.",
            None,
            None,
            None,
            Some(page_url(config, page)),
            None,
            None,
            Some("rule"),
        );
        return;
    }

    let mut any_complete = false;
    let mut failed = false;
    let mut examined_tables = 0usize;
    for table in &tables {
        let Some(header_row) = table.first() else { continue };
        if header_row.is_empty() {
            continue;
        }
        let headers: Vec<String> = header_row
            .iter()
            .map(|cell| cell.normalized.clone())
            .collect();
        if is_columnar_scenario_table(&headers) {
            examined_tables += 1;
            if validate_columnar_table(page, config, summary, table, &mut failed) {
                any_complete = true;
            }
            continue;
        }
        if let Some(tc_id) = find_label_value_test_case_id(table) {
            examined_tables += 1;
            if validate_label_value_table(page, config, summary, table, &tc_id, &mut failed) {
                any_complete = true;
            }
        }
    }

    if examined_tables == 0 {
        score.possible += SCENARIO_COMPLETENESS_WEIGHT;
        add_finding_ext(
            summary,
            "SIT",
            "Scenario Detail & Screen Capture SIT - Table Completeness",
            "FAIL",
            "High",
            "Tabel Scenario Detail & Screen Capture SIT kosong",
            format!(
                "Page \"{}\" memiliki tabel tetapi tidak ditemukan tabel dengan kolom wajib Scenario Detail & Screen Capture SIT.",
                page.title
            ),
            "Tambahkan tabel dengan kolom wajib yang tercantum di template.",
            None,
            None,
            None,
            Some(page_url(config, page)),
            None,
            None,
            Some("rule"),
        );
        return;
    }

    score.possible += SCENARIO_COMPLETENESS_WEIGHT;
    if any_complete && !failed {
        score.earned += SCENARIO_COMPLETENESS_WEIGHT;
    }

    if let Some(execution) = match_test_execution(page, &summary.jira_executions) {
        let found = examined_tables as u32;
        let count_matched = found == execution.pass;
        score.possible += SCENARIO_COUNT_WEIGHT;
        if count_matched {
            score.earned += SCENARIO_COUNT_WEIGHT;
        }
        if count_matched {
            add_finding_ext(
                summary,
                "SIT",
                "Scenario Detail & Screen Capture SIT - Table Count",
                "PASS",
                "Info",
                "Jumlah tabel scenario sesuai",
                format!(
                    "Page \"{}\" memiliki {} tabel scenario, sesuai execution {} ({:?} test case PASS).",
                    page.title, found, execution.key, execution.pass
                ),
                "",
                Some(execution.key.clone()),
                None,
                None,
                Some(page_url(config, page)),
                None,
                None,
                Some("rule"),
            );
        } else {
            add_finding_ext(
                summary,
                "SIT",
                "Scenario Detail & Screen Capture SIT - Table Count",
                "FAIL",
                "High",
                "Jumlah tabel scenario tidak sesuai",
                format!(
                    "Page \"{}\" memiliki {} tabel scenario, tetapi execution {} hanya {:?} test case yang PASS (aborted/fail tidak dihitung).",
                    page.title, found, execution.key, execution.pass
                ),
                "Samakan jumlah tabel scenario dengan jumlah test case yang PASS pada Jira Test Execution.",
                Some(execution.key.clone()),
                None,
                None,
                Some(page_url(config, page)),
                None,
                None,
                Some("rule"),
            );
        }
    }

    if any_complete && !failed {
        add_finding_ext(
            summary,
            "SIT",
            "Scenario Detail & Screen Capture SIT - Table Completeness",
            "PASS",
            "Info",
            "Kolom tabel sudah lengkap",
            format!(
                "Semua kolom wajib pada tabel Scenario Detail & Screen Capture SIT page \"{}\" sudah diisi.",
                page.title
            ),
            "",
            None,
            None,
            None,
            Some(page_url(config, page)),
            None,
            None,
            Some("rule"),
        );
    }
}

async fn semantic_validate_section(
    page: &PageData,
    section: &str,
    labels: &[&str],
    config: &AppConfig,
    ollama: Option<&OllamaService>,
    ollama_ready: bool,
) -> SemanticDecision {
    let Some(ollama) = ollama else {
        return SemanticDecision::Unavailable(
            "Ollama tidak tersedia untuk semantic validation.".to_string(),
        );
    };
    if !ollama_ready {
        return SemanticDecision::Unavailable("Ollama tidak tersedia untuk semantic validation.".to_string());
    }
    if config.ollama.endpoint.trim().is_empty() {
        return SemanticDecision::Unavailable("Endpoint Ollama belum dikonfigurasi.".to_string());
    }

    let section_text = focused_section_text(page, labels);
    if section_text.trim().len() < 20 {
        return SemanticDecision::Skipped;
    }
    let model = config
        .ollama
        .extraction_model
        .as_deref()
        .filter(|model| !model.trim().is_empty())
        .unwrap_or(config.ollama.model.as_str());
    let client = ollama.client_for(&config.ollama.endpoint, model).await;
    let prompt = semantic_validation_prompt(section, labels, &section_text);
    let Some(raw) = client
        .generate_text(&prompt, true, Some(0.05), Some(model))
        .await
    else {
        return SemanticDecision::Unavailable(
            "Ollama tidak mengembalikan hasil semantic validation.".to_string(),
        );
    };
    let Some(value) = extract_json_block(&raw) else {
        return SemanticDecision::Unavailable(
            "Respons semantic validation bukan JSON valid.".to_string(),
        );
    };
    let is_valid = value["isValid"].as_bool().unwrap_or(false);
    let confidence = value["confidence"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
    let reason = value["reason"]
        .as_str()
        .unwrap_or("Semantic validation selesai tanpa alasan detail.")
        .trim()
        .to_string();
    let evidence = value["evidence"]
        .as_str()
        .unwrap_or("")
        .trim()
        .chars()
        .take(280)
        .collect::<String>();

    if confidence < 0.65 {
        SemanticDecision::LowConfidence {
            confidence,
            reason: if reason.is_empty() {
                "AI semantic validation confidence rendah.".to_string()
            } else {
                reason
            },
            evidence,
        }
    } else if is_valid {
        SemanticDecision::Valid {
            confidence,
            reason,
            evidence,
        }
    } else {
        SemanticDecision::Invalid {
            confidence,
            reason,
            evidence,
        }
    }
}

fn semantic_validation_prompt(section: &str, labels: &[&str], section_text: &str) -> String {
    let snippet: String = section_text.chars().take(5000).collect();
    format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n\n{}\n{}",
        "Anda adalah QA documentation reviewer.",
        "Nilai apakah isi section Confluence benar-benar relevan dengan konteks field SIT, bukan sekadar ada labelnya.",
        "Balas HANYA JSON: {\"isValid\":true|false,\"confidence\":0.0-1.0,\"reason\":\"...\",\"evidence\":\"kutipan singkat dari input\"}.",
        "Tandai false bila isi field asal/gibberish/placeholder seperti ABCD, test, lorem ipsum, N/A tanpa alasan, atau tidak menjawab konteks label.",
        "Jika section berisi referensi Jira (token '[Jira: ...]' atau '[Jira JQL: ...]') atau link Confluence, anggap valid karena menunjukkan keterkaitan traceability/testExecution.",
        format!("Section: {section}; Required labels: {}", labels.join(", ")),
        "=== SECTION TEXT ===",
        snippet
    )
}

fn suspicious_label_values(page: &PageData, labels: &[&str]) -> Vec<String> {
    labels
        .iter()
        .filter_map(|label| {
            extract_value_after_label(&page.plain, label).and_then(|value| {
                if is_suspicious_value(&value) {
                    Some(format!(
                        "{label} = \"{}\"",
                        value.chars().take(60).collect::<String>()
                    ))
                } else {
                    None
                }
            })
        })
        .collect()
}

fn focused_section_text(page: &PageData, labels: &[&str]) -> String {
    let mut out = Vec::new();
    for label in labels {
        if let Some(value) = extract_value_after_label(&page.plain, label) {
            if !value.trim().is_empty() {
                out.push(format!("{label}: {value}"));
            }
        }
    }
    if out.is_empty() {
        page.plain.chars().take(5000).collect()
    } else {
        out.join("\n")
    }
}

fn extract_value_after_label(text: &str, label: &str) -> Option<String> {
    let normalized_text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower_text = normalized_text.to_lowercase();
    let lower_label = label.to_lowercase();
    let start = lower_text
        .match_indices(&lower_label)
        .find_map(|(start, _)| {
            let before_is_word = normalized_text[..start]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric());
            let after_start = start + lower_label.len();
            let after = normalized_text[after_start..].trim_start();
            if after.starts_with(',') {
                return None;
            }
            let after_is_word = after.chars().next().is_some_and(|c| c.is_alphanumeric());
            if before_is_word
                || (after_is_word && is_label_continuation(&lower_label, after))
            {
                None
            } else {
                Some(start)
            }
        })?;
    let value_start = start + lower_label.len();
    let mut tail = normalized_text[value_start..]
        .trim_start_matches(|c: char| c == ':' || c == '-' || c == '/' || c.is_whitespace())
        .trim();
    if label.eq_ignore_ascii_case("exit criteria")
        && tail
            .to_lowercase()
            .starts_with("test completion criteria")
    {
        tail = tail["test completion criteria".len()..]
            .trim_start_matches(|c: char| c == ':' || c == '-' || c == '/' || c.is_whitespace())
            .trim();
    }
    if tail.is_empty() {
        return Some(String::new());
    }

    let boundary = [
        " test strategy",
        " test model",
        " test data",
        " test environment",
        " test execution",
        " test completion",
        " test design techniques",
        " degree of independence",
        " metrics to be collected",
        " retesting",
        " regression",
        " suspension criteria",
        " resumption criteria",
        " testing schedule",
        " entry criteria",
        " exit criteria",
        " scenario detail",
        " screen capture",
        " expected result",
        " result",
        " residual risk",
        " lesson learned",
        " jira ",
    ]
    .iter()
    .filter_map(|needle| tail.to_lowercase().find(needle))
    .filter(|idx| *idx > 0)
    .min()
    .unwrap_or_else(|| tail.len().min(180));

    Some(tail[..boundary.min(tail.len())].trim().to_string())
}

fn is_label_continuation(label: &str, value: &str) -> bool {
    let value = value.to_lowercase();
    match label {
        "test data" => value.starts_with("requirement"),
        "test environment" => value.starts_with("requirement"),
        "test execution" => value.starts_with("log"),
        "test model" => value.starts_with("specification") || value.starts_with("& traceability"),
        _ => false,
    }
}

fn is_suspicious_value(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return true;
    }
    let normalized = normalize(trimmed);
    if normalized.is_empty() {
        return true;
    }
    let placeholders = [
        "abcd",
        "abc",
        "asdf",
        "qwerty",
        "test",
        "testing",
        "dummy",
        "lorem ipsum",
        "isi bebas",
        "asal",
        "todo",
        "tbd",
    ];
    if normalized == "n a"
        || placeholders.iter().any(|p| normalized == *p)
    {
        return true;
    }
    let alpha: Vec<char> = trimmed.chars().filter(|c| c.is_alphabetic()).collect();
    if alpha.len() >= 4 {
        let uppercase = alpha.iter().filter(|c| c.is_uppercase()).count();
        if uppercase == alpha.len() && trimmed.split_whitespace().count() == 1 {
            return true;
        }
    }
    false
}

fn add_weighted(
    summary: &mut ReviewSummary,
    score: &mut Score,
    doc_type: &str,
    section: &str,
    status: &str,
    severity: &str,
    title: &str,
    description: impl Into<String>,
    recommendation: &str,
    weight: u32,
    config: &AppConfig,
    page: &PageData,
) {
    score.possible += weight;
    score.earned += match status {
        "PASS" => weight,
        "WARNING" => weight / 2,
        _ => 0,
    };
    add_finding(
        summary,
        doc_type,
        section,
        status,
        severity,
        title,
        description,
        recommendation,
        None,
        None,
        None,
        Some(page_url(config, page)),
    );
}

async fn validate_jira_and_reconcile(
    page: &PageData,
    summary: &mut ReviewSummary,
    config: &AppConfig,
    jira: &JiraService,
    jira_project_key: &str,
    execution_cache: &mut ExecutionCache,
) -> Result<()> {
    let keys = extract_jira_keys(&page.content);
    if keys.is_empty() {
        add_finding(
            summary,
            "SIT",
            "Jira Validation",
            "FAIL",
            "High",
            "No Jira key found",
            "Tidak ada Jira key yang dapat divalidasi dari halaman SIT.",
            "Tambahkan Jira key pada field SIT yang relevan.",
            None,
            None,
            None,
            Some(page_url(config, page)),
        );
        return Ok(());
    }
    let client = match jira.client(&config.jira) {
        Ok(client) => client,
        Err(error) => {
            add_finding(
                summary,
                "SIT",
                "Jira Validation",
                "FAIL",
                "High",
                "Jira is not configured",
                error.to_string(),
                "Lengkapi konfigurasi Jira.",
                None,
                None,
                None,
                Some(page_url(config, page)),
            );
            return Ok(());
        }
    };
    let mut included_keys = HashSet::new();
    let mut aggregate = (0u32, 0u32, 0u32, 0u32, 0u32, 0u32);
    for key in keys {
        let entry = execution_cache.entries.entry(key.clone()).or_default();
        if entry.issue.is_none() && entry.issue_error.is_none() {
            let issue = match client.get_issue_raw(&key).await {
                Ok(value) => value,
                Err(error) => {
                    entry.issue_error = Some(error.to_string());
                    add_finding(
                        summary,
                        "SIT",
                        "Jira Validation",
                        "FAIL",
                        "High",
                        "Jira issue not found",
                        format!("{key}: {error}"),
                        "Periksa Jira key dan akses Jira API.",
                        Some(key),
                        None,
                        None,
                        Some(page_url(config, page)),
                    );
                    continue;
                }
            };
            let fields = &issue["fields"];
            entry.issue = Some(IssueFetch {
                issue_type: fields["issuetype"]["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                summary: fields["summary"].as_str().unwrap_or("").to_string(),
                project_key: fields["project"]["key"].as_str().unwrap_or("").to_string(),
                status: fields["status"]["name"].as_str().unwrap_or("").to_string(),
            });
        }
        if let Some(error) = entry.issue_error.as_ref() {
            add_finding(
                summary,
                "SIT",
                "Jira Validation",
                "FAIL",
                "High",
                "Jira issue not found",
                format!("{key}: {error}"),
                "Periksa Jira key dan akses Jira API.",
                Some(key),
                None,
                None,
                Some(page_url(config, page)),
            );
            continue;
        }
        let issue = entry.issue.as_ref().expect("issue cached");
        let is_execution = issue.issue_type.to_lowercase().contains("test execution")
            || issue.summary.to_lowercase().contains("test execution");
        if !is_execution {
            continue;
        }
        let project_match = issue.project_key.eq_ignore_ascii_case(jira_project_key);
        let status_done = issue.status.eq_ignore_ascii_case("done");
        let mut execution = JiraExecutionSummary {
            key: key.clone(),
            summary: issue.summary.clone(),
            issue_type: issue.issue_type.clone(),
            project_key: issue.project_key.clone(),
            status: issue.status.clone(),
            included: false,
            ..JiraExecutionSummary::default()
        };
        if !project_match {
            summary.jira_executions.push(execution);
            add_finding(
                summary,
                "SIT",
                "Jira Validation",
                "FAIL",
                "High",
                "Jira project mismatch",
                format!(
                    "{key} belongs to {}, expected {}.",
                    issue.project_key, jira_project_key
                ),
                "Gunakan Jira Test Execution dari project yang dikonfigurasi.",
                Some(key),
                Some(jira_project_key),
                Some(&issue.project_key),
                Some(page_url(config, page)),
            );
            continue;
        }
        if !status_done {
            summary.jira_executions.push(execution);
            add_finding(
                summary,
                "SIT",
                "Jira Validation",
                "WARNING",
                "Medium",
                "Jira Test Execution is not DONE",
                format!(
                    "{key} memiliki status {} dan tidak masuk agregasi metric.",
                    issue.status
                ),
                "Selesaikan execution atau review statusnya.",
                Some(key),
                Some("DONE"),
                Some(&issue.status),
                Some(page_url(config, page)),
            );
            continue;
        }
        if entry.runs.is_none() {
            entry.runs = Some(client.get_xray_test_execution_tests(&key).await);
        }
        let runs = match entry.runs.as_ref().expect("runs cached") {
            Ok(runs) => runs,
            Err(error) => {
                summary.jira_executions.push(execution);
                add_finding(
                    summary,
                    "SIT",
                    "Jira Test Execution",
                    "WARNING",
                    "High",
                    "Xray metric unavailable",
                    format!("{key}: {error}"),
                    "Pastikan Xray API dapat mengembalikan summary execution.",
                    Some(key),
                    None,
                    None,
                    Some(page_url(config, page)),
                );
                continue;
            }
        };
        if runs.is_empty() {
            summary.jira_executions.push(execution);
            add_finding(
                summary,
                "SIT",
                "Jira Test Execution",
                "WARNING",
                "High",
                "Xray execution summary is empty",
                format!("{key} berstatus DONE tetapi tidak mengembalikan test execution summary."),
                "Periksa konfigurasi Xray atau isi execution di Jira.",
                Some(key),
                None,
                None,
                Some(page_url(config, page)),
            );
            continue;
        }
        if !included_keys.insert(key.clone()) {
            continue;
        }
        for run in runs {
            execution.total += 1;
            match normalize(&run.status).as_str() {
                "pass" | "passed" => {
                    execution.pass += 1;
                    execution.executed += 1;
                }
                "fail" | "failed" => {
                    execution.fail += 1;
                    execution.executed += 1;
                }
                "blocked" => {
                    execution.blocked += 1;
                    execution.executed += 1;
                }
                _ => execution.not_executed += 1,
            }
        }
        execution.included = true;
        aggregate.0 += execution.total;
        aggregate.1 += execution.executed;
        aggregate.2 += execution.pass;
        aggregate.3 += execution.fail;
        aggregate.4 += execution.blocked;
        aggregate.5 += execution.not_executed;
        summary.jira_executions.push(execution);
    }

    if included_keys.is_empty() {
        return Ok(());
    }
    let confluence_executed = extract_metric(&page.plain, "test cases executed");
    let confluence_total = extract_total(&page.plain, confluence_executed);
    let matched = confluence_executed
        .map(|value| value == aggregate.1)
        .unwrap_or(false)
        && confluence_total
            .map(|value| value == aggregate.0)
            .unwrap_or(true);
    let reconciliation = TestMeasureReconciliation {
        jira_execution_keys: included_keys.iter().cloned().collect(),
        confluence_total,
        jira_total: aggregate.0,
        confluence_executed,
        jira_executed: aggregate.1,
        confluence_pass: None,
        jira_pass: aggregate.2,
        confluence_fail: None,
        jira_fail: aggregate.3,
        confluence_blocked: None,
        jira_blocked: aggregate.4,
        confluence_not_executed: None,
        jira_not_executed: aggregate.5,
        difference: confluence_executed
            .map(|value| value as i32 - aggregate.1 as i32)
            .unwrap_or(0),
        is_match: matched,
    };
    let description = format!(
        "Confluence executed: {:?}; aggregated Jira/Xray executed: {} from {}.",
        confluence_executed,
        aggregate.1,
        included_keys.iter().cloned().collect::<Vec<_>>().join(", ")
    );
    add_finding(
        summary,
        "SIT",
        "Test Measures Reconciliation",
        if matched { "PASS" } else { "FAIL" },
        if matched { "Info" } else { "High" },
        "Test Measures reconciliation",
        description,
        "Samakan Test Measures dengan agregat summary Jira/Xray API.",
        None,
        None,
        None,
        Some(page_url(config, page)),
    );
    summary.reconciliation = Some(reconciliation);
    Ok(())
}

fn extract_jira_keys(content: &str) -> Vec<String> {
    let re = Regex::new(r"\b[A-Z][A-Z0-9]{1,15}-\d+\b").unwrap();
    let mut keys = Vec::new();
    let mut seen = HashSet::new();
    for capture in re.find_iter(content) {
        let key = capture.as_str().to_string();
        if seen.insert(key.clone()) {
            keys.push(key);
        }
    }
    keys
}

fn extract_metric(text: &str, label: &str) -> Option<u32> {
    let pattern = if label.eq_ignore_ascii_case("test cases executed") {
        format!(
            r"(?i){}\s*:?\s*(\d+)\s+test cases\b",
            regex::escape(label)
        )
    } else {
        format!(r"(?i){}\s*:?\s*(\d+)", regex::escape(label))
    };
    Regex::new(&pattern)
        .ok()?
        .captures(text)
        .and_then(|c| c.get(1)?.as_str().parse().ok())
}

fn extract_total(text: &str, executed: Option<u32>) -> Option<u32> {
    let percentage =
        Regex::new(r"(?i)test cases executed\s*:?\s*\d+\s*test cases\s*\(([0-9]+(?:\.[0-9]+)?)%")
            .ok()?
            .captures(text)
            .and_then(|c| c.get(1)?.as_str().parse::<f64>().ok());
    match (executed, percentage) {
        (Some(value), Some(percent)) if percent > 0.0 => {
            Some(((value as f64 * 100.0) / percent).round() as u32)
        }
        (value, _) => value,
    }
}

fn contains_label(page: &PageData, label: &str) -> bool {
    normalize(&page.plain).contains(&normalize(label))
}

fn missing_labels<'a>(page: &PageData, labels: &'a [&'a str]) -> Vec<&'a str> {
    labels
        .iter()
        .copied()
        .filter(|label| !contains_label(page, label))
        .collect()
}

fn has_actionable_lesson(page: &PageData) -> bool {
    let text = normalize(&page.plain);
    text.contains("action") || text.contains("recommendation") || text.contains("perbaikan")
}

fn normalize(value: &str) -> String {
    let lower = value.to_lowercase().replace('&', " and ");
    let cleaned: String = lower
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn page_url(config: &AppConfig, page: &PageData) -> String {
    page.raw["_links"]["webui"]
        .as_str()
        .map(|path| {
            format!(
                "{}{}",
                config.confluence.base_url.trim_end_matches('/'),
                path
            )
        })
        .unwrap_or_else(|| {
            format!(
                "{}/pages/viewpage.action?pageId={}",
                config.confluence.base_url.trim_end_matches('/'),
                page.id
            )
        })
}

fn score_to_percent(score: Score) -> u32 {
    if score.possible == 0 {
        0
    } else {
        ((score.earned as f64 / score.possible as f64) * 100.0).round() as u32
    }
}

fn add_finding(
    summary: &mut ReviewSummary,
    document_type: &str,
    section: &str,
    status: &str,
    severity: &str,
    title: &str,
    description: impl Into<String>,
    recommendation: &str,
    source_key: Option<String>,
    expected: Option<&str>,
    actual: Option<&str>,
    source_url: Option<String>,
) {
    add_finding_ext(
        summary,
        document_type,
        section,
        status,
        severity,
        title,
        description,
        recommendation,
        source_key,
        expected,
        actual,
        source_url,
        None,
        None,
        None,
    );
}

fn add_finding_ext(
    summary: &mut ReviewSummary,
    document_type: &str,
    section: &str,
    status: &str,
    severity: &str,
    title: &str,
    description: impl Into<String>,
    recommendation: &str,
    source_key: Option<String>,
    expected: Option<&str>,
    actual: Option<&str>,
    source_url: Option<String>,
    confidence: Option<f64>,
    evidence: Option<String>,
    validation_source: Option<&str>,
) {
    let recommendation = if status == "PASS" { "" } else { recommendation };
    summary.findings.push(ReviewFinding {
        document_type: document_type.to_string(),
        section: section.to_string(),
        status: status.to_string(),
        severity: severity.to_string(),
        title: title.to_string(),
        description: description.into(),
        recommendation: recommendation.to_string(),
        source_key,
        expected_value: expected.map(str::to_string),
        actual_value: actual.map(str::to_string),
        source_url,
        confidence,
        evidence,
        validation_source: validation_source.map(str::to_string),
    });
}

fn finalize_counts(summary: &mut ReviewSummary) {
    let deterministic: Vec<&ReviewFinding> = summary
        .findings
        .iter()
        .filter(|f| f.section != "AI Recommendations" && f.section != "Semantic Validation")
        .collect();
    summary.pass_count = deterministic
        .iter()
        .filter(|f| f.status == "PASS")
        .count() as u32;
    summary.warning_count = deterministic
        .iter()
        .filter(|f| f.status == "WARNING")
        .count() as u32;
    summary.fail_count = deterministic
        .iter()
        .filter(|f| f.status == "FAIL")
        .count() as u32;
    summary.not_applicable_count = deterministic
        .iter()
        .filter(|f| f.status == "NOT_APPLICABLE")
        .count() as u32;
    summary.overall_status = if summary.fail_count > 0 {
        "FAIL"
    } else if summary.warning_count > 0 {
        "WARNING"
    } else {
        "PASS"
    }
    .to_string();
}

#[cfg(test)]
mod tests {
    use super::{
        classify_page_type, collect_scenario_capture_sit_pages, dedupe_tables,
        detect_document_type, extract_jira_keys, extract_metric, extract_total,
        extract_jira_project_key, extract_sit_jira_link, extract_tmp_link,
        extract_value_after_label, find_label_value_test_case_id, is_scenario_capture_sit_title,
        is_sit_review_candidate, is_suspicious_value, is_tmp_structure, matches_project_text,
        missing_labels, normalize, page_data, parse_html_tables, project_identity, Score,
        suspicious_label_values, validate_scenario_capture_tables, SCENARIO_COMPLETENESS_WEIGHT,
    };
    use crate::models::app_config::AppConfig;
    use crate::models::document_review::{JiraExecutionSummary, ReviewSummary};

    #[test]
    fn aggregates_confluence_executed_metric() {
        let text = "Test cases executed : 64 test cases (100.00%)";
        assert_eq!(extract_metric(text, "test cases executed"), Some(64));
        assert_eq!(extract_total(text, Some(64)), Some(64));
    }

    #[test]
    fn ignores_execution_percentage_when_extracting_executed_count() {
        let text = "Test cases executed: 100% Summary Test cases executed: 64 test cases (100.00%)";
        assert_eq!(extract_metric(text, "test cases executed"), Some(64));
    }

    #[test]
    fn normalizes_template_labels() {
        assert_eq!(
            normalize("0. TEST MANAGEMENT PROCESS"),
            "0 test management process"
        );
    }

    #[test]
    fn detects_tmp_from_internal_heading_not_title() {
        let page = page_data(serde_json::json!({
            "id": "1",
            "title": "[20260620] - CCEDUR - Enhancement Dashboard URL Referral",
            "body": { "storage": { "value": "<h1>0. Test Management Process</h1><h2>1. Test Basis</h2>" } }
        })).unwrap();
        assert_eq!(detect_document_type(&page), "TMP");
    }

    #[test]
    fn detects_sit_from_structure() {
        let page = page_data(serde_json::json!({
            "id": "2",
            "title": "01. System Integration Test For CCEDUR",
            "body": { "storage": { "value": "<h1>01. System Integration Test</h1><h1>TEST MANAGEMENT PROCESS SIT</h1><h1>TEST COMPLETION REPORT SIT</h1>" } }
        })).unwrap();
        assert_eq!(detect_document_type(&page), "SIT");
    }

    #[test]
    fn detects_sit_from_alternative_title_and_sit_heading() {
        let page = page_data(serde_json::json!({
            "id": "3",
            "title": "SIT - Payment Gateway",
            "body": { "storage": { "value": "<h1>TEST MANAGEMENT PROCESS SIT</h1><p>Entry criteria: environment ready</p>" } }
        })).unwrap();
        assert_eq!(detect_document_type(&page), "SIT");
    }

    #[test]
    fn ignores_sit_reference_page_without_sit_root_structure() {
        let page = page_data(serde_json::json!({
            "id": "5",
            "title": "Test Execution of Test Plan of System Integration Test",
            "body": { "storage": { "value": "Test Execution Status Done CCEDUR-180" } }
        })).unwrap();

        assert_eq!(detect_document_type(&page), "SIT");
        assert!(!is_sit_review_candidate(&page));
    }

    #[test]
    fn inherits_phase_from_parent_page() {
        let sit = page_data(serde_json::json!({
            "id": "10",
            "title": "01. System Integration Test For CCEDUR",
            "body": { "storage": { "value": "TEST MANAGEMENT PROCESS SIT TEST PLAN SIT" } }
        })).unwrap();
        let child = page_data(serde_json::json!({
            "id": "11",
            "title": "01-02. CCEDUR SOP Verification",
            "ancestors": [{ "id": "10" }],
            "body": { "storage": { "value": "Verification checklist" } }
        })).unwrap();
        let pages = vec![sit.clone(), child.clone()];

        assert_eq!(classify_page_type(&sit, &pages), "SIT");
        assert_eq!(classify_page_type(&child, &pages), "SIT");
    }

    #[test]
    fn flags_placeholder_field_value() {
        let page = page_data(serde_json::json!({
            "id": "4",
            "title": "SIT",
            "body": { "storage": { "value": "<p>Entry Criteria: ABCD</p><p>Exit Criteria: Semua defect closed</p>" } }
        })).unwrap();
        assert!(is_suspicious_value("ABCD"));
        assert_eq!(
            extract_value_after_label(&page.plain, "Entry Criteria").as_deref(),
            Some("ABCD")
        );
        let invalid = suspicious_label_values(&page, &["entry criteria", "exit criteria"]);
        assert_eq!(invalid.len(), 1);
        assert!(invalid[0].contains("entry criteria"));
    }

    #[test]
    fn keeps_valid_short_and_compound_strategy_values() {
        let text = "Entry Criteria: Unit test sudah selesai dilakukan. Exit Criteria / Test Completion Criteria: System integration test telah selesai dilakukan. Test Design Techniques: Specification-based testing (Black box testing) dengan menguji fungsi. Testing Schedule: BRI SIT schedule.";

        assert_eq!(
            extract_value_after_label(text, "entry criteria").as_deref(),
            Some("Unit test sudah selesai dilakukan.")
        );
        assert_eq!(
            extract_value_after_label(text, "exit criteria").as_deref(),
            Some("System integration test telah selesai dilakukan.")
        );
        assert!(!is_suspicious_value("Unit"));
        assert!(!is_suspicious_value("BRI"));
        assert!(!is_suspicious_value(
            "Specification-based testing (Black box testing) dengan menguji fungsi."
        ));
    }

    #[test]
    fn skips_longer_headings_when_extracting_strategy_labels() {
        let text = "Test Environment Requirement and Readiness SIT Environment Dev incomplete Test Strategy SIT Test Environment: QA Testing Schedule: BRI";

        assert_eq!(
            extract_value_after_label(text, "test environment").as_deref(),
            Some("QA")
        );
        assert_eq!(
            extract_value_after_label(text, "testing schedule").as_deref(),
            Some("BRI")
        );
    }

    #[test]
    fn does_not_extract_comma_heading_suffix_as_a_value() {
        let text = "Test Execution Log, Result & Incident Report SIT CCEDUR-180";

        assert_eq!(extract_value_after_label(text, "test execution log"), None);
    }

    #[test]
    fn reference_sit_html_satisfies_structure_and_strategy_labels() {
        let html = include_str!("../../../requirement/SIT.html");
        let page = page_data(serde_json::json!({
            "id": "1814292033",
            "title": "01. System Integration Test For CCEDUR",
            "body": {
                "storage": { "value": html },
                "view": { "value": html }
            }
        }))
        .unwrap();

        let structure = [
            "test plan sit",
            "test strategy sit",
            "test model specification sit",
            "test model & traceability sit",
            "test data requirement & readiness sit",
            "test environment requirement and readiness sit",
            "test execution log",
            "test completion report sit",
            "summary of system integration test",
            "residual risk",
            "lesson learned",
        ];
        let strategy = [
            "entry criteria",
            "exit criteria",
            "test design techniques",
            "test data",
            "test environment",
            "testing schedule",
        ];

        assert_eq!(detect_document_type(&page), "SIT");
        assert!(missing_labels(&page, &structure).is_empty());
        assert!(missing_labels(&page, &strategy).is_empty());
    }

    #[test]
    fn extracts_tmp_project_identity_and_labeled_links() {
        let identity = project_identity(
            "[20260620] - CCEDUR - Enhancement Dashboard URL Referral",
        )
        .unwrap();
        assert_eq!(identity.key, "CCEDUR");
        assert_eq!(identity.name, "Enhancement Dashboard URL Referral");
        assert!(matches_project_text(
            &normalize("CR260205_Enhancement Dashboard URL Referral (CCEDUR)"),
            &identity
        ));

        let html = r#"<table><tr><td><strong>System Design</strong></td><td><a href="https://confluence.example/pages/123">CR260205_System Design</a></td></tr></table>"#;
        assert_eq!(
            extract_tmp_link(html, &["system design"]).as_deref(),
            Some("https://confluence.example/pages/123")
        );
    }

    #[test]
    fn extracts_jira_key_from_jira_macro_with_key_parameter() {
        let html = r#"<table><tr><td>UQA</td><td><p><ac:structured-macro ac:name="jira" ac:schema-version="1"><ac:parameter ac:name="server">Jira</ac:parameter><ac:parameter ac:name="key">CCEDUR-191</ac:parameter></ac:structured-macro></p></td></tr></table>"#;
        assert_eq!(
            extract_tmp_link(html, &["uqa"]).as_deref(),
            Some("CCEDUR-191")
        );
    }

    #[test]
    fn extracts_jira_key_from_jira_macro_with_whitespace_and_single_quote_attributes() {
        let html = r#"<table><tr><td>Jira</td><td><ac:structured-macro ac:name='jira' ac:macro-id='abc123'><ac:parameter ac:name='key'>
            CCEDUR-180
        </ac:parameter></ac:structured-macro></td></tr></table>"#;
        assert_eq!(
            extract_tmp_link(html, &["jira"]).as_deref(),
            Some("CCEDUR-180")
        );
    }

    #[test]
    fn extracts_jira_key_from_jql_macro_without_key_parameter() {
        let html = r#"<table><tr><td>UQA</td><td><ac:structured-macro ac:name="jira" ac:macro-id="abc123"><ac:parameter ac:name="jql">project = CCEDUR</ac:parameter><ac:rich-text-body><p>CCEDUR-191</p></ac:rich-text-body></ac:structured-macro></td></tr></table>"#;
        assert_eq!(
            extract_tmp_link(html, &["uqa"]).as_deref(),
            Some("CCEDUR-191")
        );
    }

    #[test]
    fn detects_tmp_from_checklist_and_required_sections() {
        let page = page_data(serde_json::json!({
            "id": "20",
            "title": "[20260620] - CCEDUR - Enhancement Dashboard URL Referral",
            "body": { "storage": { "value": "Checklist Link Jira Perencanaan Pengembangan UQA 1. Test Basis 2. Risk of Testing 3. Items & Test Scope 4. Assumption & Constraint 5. Staffing 6. Test Status Report 7. Approval Form" } }
        })).unwrap();

        assert!(is_tmp_structure(&page));
        assert_eq!(detect_document_type(&page), "TMP");
    }

    #[test]
    fn extracts_jira_project_key_from_project_url() {
        assert_eq!(
            extract_jira_project_key("https://jira.example/projects/CCEDUR"),
            Some("CCEDUR".to_string())
        );
        assert_eq!(extract_jira_project_key("https://jira.example/browse/CCEDUR-1"), None);
    }

    #[test]
    fn extracts_unique_jira_keys() {
        assert_eq!(
            extract_jira_keys("CCEDUR-180, CCEDUR-191, CCEDUR-180"),
            vec!["CCEDUR-180", "CCEDUR-191"]
        );
    }

    #[test]
    fn does_not_pick_test_plan_link_for_system_design_on_tmpccloa() {
        let html = include_str!("../../../requirement/TMPCCLOA.html");
        let link = extract_tmp_link(html, &["system design"]);
        assert_eq!(
            link.as_deref(),
            Some("/spaces/SKU/pages/1558451076/CR260102_System+Design"),
            "System Design link should come from the Document Name table, not Test Plan"
        );
    }

    #[test]
    fn does_not_pick_test_plan_link_for_system_design_on_tmp() {
        let html = include_str!("../../../requirement/TMP.html");
        let link = extract_tmp_link(html, &["system design"]);
        assert_eq!(
            link.as_deref(),
            Some("https://confluence.bri.co.id/x/3yi7Xg"),
            "System Design link should come from the Document Name table, not Test Plan"
        );
    }

    #[test]
    fn extracts_requirement_link_from_tmpccloa() {
        let html = include_str!("../../../requirement/TMPCCLOA.html");
        let link = extract_tmp_link(html, &["requirement"]);
        assert_eq!(
            link.as_deref(),
            Some("/spaces/BRD2022/pages/1567593247/BRD+2026+010+CONS+CDD+Automation+Loan+On+Apps")
        );
    }

    #[test]
    fn extracts_jira_link_from_tmpccloa() {
        let html = include_str!("../../../requirement/TMPCCLOA.html");
        let link = extract_tmp_link(html, &["jira"]);
        assert_eq!(
            link.as_deref(),
            Some("https://jira.bri.co.id/projects/CCALOA")
        );
    }

    #[test]
    fn extracts_sit_test_level_jira_link_from_sit_html() {
        let html = include_str!("../../../requirement/SIT.html");
        let key = extract_sit_jira_link(html, &["test level", "test types"]);
        assert_eq!(key.as_deref(), Some("CCEDUR-173"));
    }

    #[test]
    fn extracts_sit_test_level_jira_link_from_jira_macro() {
        let html = r#"<table><tr><td><strong>Test Level / Test Types *</strong></td><td><p>Functional (SIT)</p><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">CCEDUR-180</ac:parameter></ac:structured-macro></td></tr></table>"#;
        assert_eq!(
            extract_sit_jira_link(html, &["test level", "test types"]).as_deref(),
            Some("CCEDUR-180")
        );
    }

    #[test]
    fn extracts_sit_test_level_jira_link_from_data_jira_key() {
        let html = r#"<table><tr><td>Test Level / Test Types *</td><td><span class="jira-issue" data-jira-key="CCEDUR-191"><a href="/browse/CCEDUR-191">CCEDUR-191</a></span></td></tr></table>"#;
        assert_eq!(
            extract_sit_jira_link(html, &["test level", "test types"]).as_deref(),
            Some("CCEDUR-191")
        );
    }

    #[test]
    fn sit_test_level_returns_none_when_label_missing() {
        let html = r#"<table><tr><td>Other Field</td><td><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">CCEDUR-180</ac:parameter></ac:structured-macro></td></tr></table>"#;
        assert_eq!(
            extract_sit_jira_link(html, &["test level", "test types"]),
            None
        );
    }

    #[test]
    fn sit_test_level_does_not_pick_other_jira_links_outside_row() {
        let html = r#"<table>
            <tr><td>Test Level / Test Types</td><td><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">CCEDUR-173</ac:parameter></ac:structured-macro></td></tr>
            <tr><td>Test Plan</td><td><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">CCEDUR-179</ac:parameter></ac:structured-macro></td></tr>
            <tr><td>Test Execution</td><td><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">CCEDUR-180</ac:parameter></ac:structured-macro></td></tr>
        </table>"#;
        assert_eq!(
            extract_sit_jira_link(html, &["test level", "test types"]).as_deref(),
            Some("CCEDUR-173")
        );
    }

    #[test]
    fn scenario_capture_title_matches_ampersand_and_case_variants() {
        assert!(is_scenario_capture_sit_title(
            "01-01. CCEDUR Scenario Detail & Screen Capture SIT"
        ));
        assert!(is_scenario_capture_sit_title(
            "01-01. CCEDUR Scenario Detail and Screen Capture SIT"
        ));
        assert!(is_scenario_capture_sit_title(
            "01-01. ccedur scenario detail & screen capture sit"
        ));
        assert!(is_scenario_capture_sit_title(
            "01-03. CCEDUR Scenario Detail & Screen Capture SIT - Negative"
        ));
        assert!(is_scenario_capture_sit_title(
            "01-01-02. CCEDUR Scenario Detail & Screen Capture After Rollback"
        ));
        assert!(is_scenario_capture_sit_title(
            "01-01-01. CCEDUR Scenario Detail & Screen Capture SIT dan UAT"
        ));
    }

    #[test]
    fn scenario_capture_title_excludes_sop_verification() {
        assert!(!is_scenario_capture_sit_title("01-02. CCEDUR SOP Verification"));
        assert!(!is_scenario_capture_sit_title(
            "01-01. CCEDUR Scenario Detail & Screen Capture SIT - SOP Verification"
        ));
        assert!(!is_scenario_capture_sit_title("01. System Integration Test For CCEDUR"));
    }

    #[test]
    fn collects_all_scenario_capture_sit_pages_including_multiple() {
        let root = page_data(serde_json::json!({
            "id": "1",
            "title": "[20260620] - CCEDUR - Enhancement Dashboard URL Referral",
            "body": { "storage": { "value": "<h1>0. Test Management Process</h1>" } }
        })).unwrap();
        let sit = page_data(serde_json::json!({
            "id": "2",
            "title": "01. System Integration Test For CCEDUR",
            "ancestors": [{ "id": "1" }],
            "body": { "storage": { "value": "<h1>TEST MANAGEMENT PROCESS SIT</h1><h1>TEST COMPLETION REPORT SIT</h1>" } }
        })).unwrap();
        let container = page_data(serde_json::json!({
            "id": "3",
            "title": "01-01. CCEDUR Scenario Detail & Screen Capture SIT",
            "ancestors": [{ "id": "2" }],
            "body": { "storage": { "value": "<p>container page, no table here</p>" } }
        })).unwrap();
        let leaf_a = page_data(serde_json::json!({
            "id": "6",
            "title": "01-01-01. CCEDUR Scenario Detail & Screen Capture SIT dan UAT",
            "ancestors": [{ "id": "2" }, { "id": "3" }],
            "body": { "storage": { "value": "<table><tr><td>TC001</td></tr></table>" } }
        })).unwrap();
        let leaf_b = page_data(serde_json::json!({
            "id": "7",
            "title": "01-01-02. CCEDUR Scenario Detail & Screen Capture After Rollback",
            "ancestors": [{ "id": "2" }, { "id": "3" }],
            "body": { "storage": { "value": "<table><tr><td>TC002</td></tr></table>" } }
        })).unwrap();
        let standalone = page_data(serde_json::json!({
            "id": "4",
            "title": "01-03. CCEDUR Scenario Detail & Screen Capture SIT - Extra",
            "ancestors": [{ "id": "2" }],
            "body": { "storage": { "value": "<table><tr><td>TC003</td></tr></table>" } }
        })).unwrap();
        let sop = page_data(serde_json::json!({
            "id": "5",
            "title": "01-02. CCEDUR SOP Verification",
            "ancestors": [{ "id": "2" }],
            "body": { "storage": { "value": "Verification checklist" } }
        })).unwrap();
        let pages = vec![root.clone(), sit.clone(), container.clone(), leaf_a.clone(), leaf_b.clone(), standalone.clone(), sop.clone()];
        let page_types: Vec<String> = pages.iter().map(|p| classify_page_type(p, &pages)).collect();

        let targets = collect_scenario_capture_sit_pages(&pages, &page_types);
        assert_eq!(
            targets.len(),
            3,
            "unexpected targets: {:?}",
            targets.iter().map(|p| format!("{} ({})", p.title, p.id)).collect::<Vec<_>>()
        );
        assert!(targets.iter().any(|p| p.title.contains("01-01-01.")));
        assert!(targets.iter().any(|p| p.title.contains("01-01-02.")));
        assert!(targets.iter().any(|p| p.title.contains("01-03.")));
        assert!(targets.iter().all(|p| !p.title.contains("SOP")));
        assert!(
            targets.iter().all(|p| p.title != container.title),
            "container page should be excluded: {:?}",
            targets.iter().map(|p| &p.title).collect::<Vec<_>>()
        );
    }

    #[test]
    fn parse_html_tables_extracts_header_and_data_rows_with_attachment() {
        let html = r#"<table>
            <tbody>
                <tr>
                    <th><p>No. Test Case</p></th><th>Function</th><th>Kategori</th>
                    <th>Input Data</th><th>Steps</th><th>Expected Result</th>
                    <th>Result</th><th>Screen Capture</th>
                </tr>
                <tr>
                    <td><p>TC001</p></td><td><p>Login</p></td><td><p>Positive</p></td>
                    <td><p>user:pass</p></td><td><p>1. open page</p></td>
                    <td><p>login success</p></td><td><p>PASS</p></td>
                    <td><ac:image><ri:attachment ri:filename="tc001.png"/></ac:image></td>
                </tr>
            </tbody>
        </table>"#;
        let tables = parse_html_tables(html);
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].len(), 2);
        assert_eq!(tables[0][0][0].normalized, "no test case");
        assert_eq!(tables[0][1][0].text, "TC001");
        assert_eq!(tables[0][1][1].text, "Login");
        assert_eq!(tables[0][1][1].normalized, "login");
        assert!(tables[0][1][7].has_attachment || tables[0][1][7].has_image);
    }

    #[test]
    fn parse_html_tables_detects_multiple_sibling_tables() {
        let table = r#"<table>
            <tr><th>No. Test Case</th><th>Function</th></tr>
            <tr><td>TC{num}</td><td>Rollback</td></tr>
        </table>"#;
        let html: String = (1..=4)
            .map(|i| table.replace("{num}", &i.to_string()))
            .collect::<Vec<_>>()
            .join("");
        let tables = parse_html_tables(&html);
        assert_eq!(tables.len(), 4);
        assert_eq!(tables[3][1][0].text, "TC4");
    }

    #[test]
    fn parse_html_tables_dedupes_identical_storage_and_view_tables() {
        let table = r#"<table>
            <tr><th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
            <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th></tr>
            <tr><td>TC001</td><td>Rollback</td><td>Positive</td><td>-</td>
            <td>1. run</td><td>success</td><td>PASS</td><td>image.png</td></tr>
        </table>"#;
        let html = [table, table].join("\n");
        let tables = dedupe_tables(parse_html_tables(&html));
        assert_eq!(tables.len(), 1);
    }

    #[test]
    fn storage_and_view_duplication_does_not_double_table_count_or_findings() {
        let make_table = |i: usize| {
            format!(
                r#"<table>
                    <tr><td><strong>No. Test Case</strong></td><td>TC{:03}</td></tr>
                    <tr><td><strong>Function</strong></td><td>Rollback</td></tr>
                    <tr><td><strong>Input Data</strong></td><td>-</td></tr>
                    <tr><td><strong>Steps</strong></td><td>1. run</td></tr>
                    <tr><td><strong>Expected Result</strong></td><td>success</td></tr>
                    <tr><td><strong>Result</strong></td><td>Passed</td></tr>
                    <tr><td><strong>Screen Capture</strong></td><td>image.png</td></tr>
                </table>"#,
                i
            )
        };
        let one: String = (1..=4).map(|i| make_table(i)).collect::<Vec<_>>().join("");
        let storage = one.clone();
        let view = one
            .replace("image.png", "view-copy.png")
            .replace("<strong>", "")
            .replace("</strong>", "");
        let page = page_data(serde_json::json!({
            "id": "7",
            "title": "01-01-02. CCEDUR Scenario Detail & Screen Capture After Rollback",
            "body": { "storage": { "value": storage }, "view": { "value": view } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        summary.jira_executions = vec![JiraExecutionSummary {
            key: "CCEDUR-191".to_string(),
            summary: "Test Execution of Test Plan of System Integration Test - Rollback".to_string(),
            total: 4,
            executed: 4,
            pass: 4,
            included: true,
            ..JiraExecutionSummary::default()
        }];
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        let count_pass = summary
            .findings
            .iter()
            .find(|f| f.section == "Scenario Detail & Screen Capture SIT - Table Count");
        assert!(
            matches!(count_pass, Some(f) if f.status == "PASS"),
            "expected count PASS: {:?}",
            summary.findings
        );
        let tc_fails: Vec<&str> = summary
            .findings
            .iter()
            .filter(|f| f.status == "FAIL" && f.section == "Scenario Detail & Screen Capture SIT - Table Completeness")
            .map(|f| f.source_key.as_deref().unwrap_or(""))
            .collect();
        assert_eq!(tc_fails.len(), 4, "expected exactly 4 TC fails, got {:?}", tc_fails);
        assert_eq!(tc_fails[0], "TC001");
        assert_eq!(tc_fails[3], "TC004");
    }

    #[test]
    fn complete_scenario_capture_table_returns_pass_finding() {
        let html = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC001</td><td>Login</td><td>Positive</td><td>user:pass</td>
                <td>1. open</td><td>success</td><td>PASS</td><td>image.png</td>
            </tr>
            <tr>
                <td>TC002</td><td>Logout</td><td>Positive</td><td>-</td>
                <td>1. click logout</td><td>redirect</td><td>PASS</td><td><ac:image/></td>
            </tr>
        </table>"#;
        let page = page_data(serde_json::json!({
            "id": "3",
            "title": "01-01. CCEDUR Scenario Detail & Screen Capture SIT",
            "body": { "storage": { "value": html }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        assert!(summary.findings.iter().any(|f| f.status == "PASS"));
        let fails: Vec<&str> = summary
            .findings
            .iter()
            .filter(|f| f.status == "FAIL")
            .map(|f| f.title.as_str())
            .collect();
        assert!(
            fails.is_empty(),
            "unexpected FAIL findings: {:?}",
            fails
        );
    }

    #[test]
    fn row_with_missing_columns_returns_fail_finding() {
        let html = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC003</td><td>Login</td><td>Positive</td><td>user:pass</td>
                <td></td><td></td><td>PASS</td><td></td>
            </tr>
        </table>"#;
        let page = page_data(serde_json::json!({
            "id": "3",
            "title": "01-01. CCEDUR Scenario Detail & Screen Capture SIT",
            "body": { "storage": { "value": html }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        let fail = summary
            .findings
            .iter()
            .find(|f| f.status == "FAIL")
            .expect("expected FAIL finding");
        assert!(fail.description.contains("steps"));
        assert!(fail.description.contains("expected result"));
        assert!(fail.description.contains("screen capture"));
        assert_eq!(fail.source_key.as_deref(), Some("TC003"));
    }

    #[test]
    fn mixed_complete_and_incomplete_rows_do_not_emit_pass_finding() {
        let html = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC001</td><td>Login</td><td>Positive</td><td>user:pass</td>
                <td>1. open</td><td>success</td><td>PASS</td><td>image.png</td>
            </tr>
            <tr>
                <td>TC002</td><td>Logout</td><td>Positive</td><td>-</td>
                <td></td><td></td><td>PASS</td><td></td>
            </tr>
        </table>"#;
        let page = page_data(serde_json::json!({
            "id": "3",
            "title": "01-01. CCEDUR Scenario Detail & Screen Capture SIT",
            "body": { "storage": { "value": html }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        let fails: Vec<&str> = summary
            .findings
            .iter()
            .filter(|f| f.status == "FAIL")
            .map(|f| f.title.as_str())
            .collect();
        assert!(!fails.is_empty(), "expected FAIL finding for incomplete row");
        assert!(
            fails.iter().any(|t| t.contains("TC002")),
            "expected FAIL to reference TC002: {:?}",
            fails
        );
        assert!(
            !summary.findings.iter().any(|f| f.status == "PASS"),
            "no PASS finding allowed when any row is incomplete: {:?}",
            summary.findings
        );
    }

    #[test]
    fn rollback_page_with_matching_table_count_passes() {
        let table = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC{num}</td><td>Rollback</td><td>Positive</td><td>-</td>
                <td>1. run</td><td>success</td><td>PASS</td><td>image.png</td>
            </tr>
        </table>"#;
        let html: String = (1..=4)
            .map(|i| table.replace("{num}", &i.to_string()))
            .collect::<Vec<_>>()
            .join("");
        let page = page_data(serde_json::json!({
            "id": "7",
            "title": "01-01-02. CCEDUR Scenario Detail & Screen Capture After Rollback",
            "body": { "storage": { "value": html }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        summary.jira_executions = vec![JiraExecutionSummary {
            key: "CCEDUR-191".to_string(),
            summary: "Test Execution of Test Plan of System Integration Test - Rollback".to_string(),
            total: 4,
            executed: 4,
            pass: 4,
            included: true,
            ..JiraExecutionSummary::default()
        }];
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        assert!(
            summary.findings.iter().any(|f| {
                f.status == "PASS"
                    && f.section == "Scenario Detail & Screen Capture SIT - Table Count"
            }),
            "expected table count PASS: {:?}",
            summary.findings
        );
        assert_eq!(
            summary.findings.iter().find(|f| f.section == "Scenario Detail & Screen Capture SIT - Table Count").unwrap().source_key.as_deref(),
            Some("CCEDUR-191")
        );
        assert!(
            !summary.findings.iter().any(|f| f.status == "FAIL"),
            "unexpected FAIL: {:?}",
            summary.findings
        );
    }

    #[test]
    fn rollback_page_with_mismatched_table_count_fails() {
        let html = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC001</td><td>Rollback</td><td>Positive</td><td>-</td>
                <td>1. run</td><td>success</td><td>PASS</td><td>image.png</td>
            </tr>
        </table>"#;
        let page = page_data(serde_json::json!({
            "id": "7",
            "title": "01-01-02. CCEDUR Scenario Detail & Screen Capture After Rollback",
            "body": { "storage": { "value": html }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        summary.jira_executions = vec![JiraExecutionSummary {
            key: "CCEDUR-191".to_string(),
            summary: "Test Execution of Test Plan of System Integration Test - Rollback".to_string(),
            total: 4,
            executed: 4,
            pass: 4,
            included: true,
            ..JiraExecutionSummary::default()
        }];
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        let count_fail = summary
            .findings
            .iter()
            .find(|f| f.section == "Scenario Detail & Screen Capture SIT - Table Count")
            .expect("expected table count finding");
        assert_eq!(count_fail.status, "FAIL");
        assert!(count_fail.description.contains("1 tabel"));
        assert_eq!(count_fail.source_key.as_deref(), Some("CCEDUR-191"));
    }

    #[test]
    fn match_test_execution_prefers_execution_key_in_page_content() {
        let table = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC{num}</td><td>Negative</td><td>Negative</td><td>-</td>
                <td>1. run</td><td>error</td><td>PASS</td><td>image.png</td>
            </tr>
        </table>"#;
        let html: String = (1..=4)
            .map(|i| table.replace("{num}", &i.to_string()))
            .collect::<Vec<_>>()
            .join("");
        let storage = format!("<p>Jira test execution: CCEDUR-191</p>{html}");
        let page = page_data(serde_json::json!({
            "id": "8",
            "title": "01-01-03. CCEDUR Scenario Detail & Screen Capture SIT - Negative",
            "body": { "storage": { "value": storage }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        summary.jira_executions = vec![
            JiraExecutionSummary {
                key: "CCEDUR-180".to_string(),
                summary: "Test Execution of Test Plan of System Integration Test".to_string(),
                total: 60,
                executed: 60,
                pass: 60,
                included: true,
                ..JiraExecutionSummary::default()
            },
            JiraExecutionSummary {
                key: "CCEDUR-191".to_string(),
                summary: "Test Execution of Test Plan of System Integration Test - Rollback".to_string(),
                total: 4,
                executed: 4,
                pass: 4,
                included: true,
                ..JiraExecutionSummary::default()
            },
        ];
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        let count = summary
            .findings
            .iter()
            .find(|f| f.section == "Scenario Detail & Screen Capture SIT - Table Count")
            .expect("expected table count finding");
        assert_eq!(count.status, "PASS");
        assert_eq!(count.source_key.as_deref(), Some("CCEDUR-191"));
    }

    #[test]
    fn match_test_execution_by_module_keyword_in_title() {
        let table = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC{num}</td><td>Activation</td><td>Positive</td><td>-</td>
                <td>1. run</td><td>success</td><td>PASS</td><td>image.png</td>
            </tr>
        </table>"#;
        let html: String = (1..=2)
            .map(|i| table.replace("{num}", &i.to_string()))
            .collect::<Vec<_>>()
            .join("");
        let page = page_data(serde_json::json!({
            "id": "9",
            "title": "01-01-03. CCEDUR Scenario Detail & Screen Capture SIT dan UAT - Module Activation",
            "body": { "storage": { "value": html }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        summary.jira_executions = vec![
            JiraExecutionSummary {
                key: "1111".to_string(),
                summary: "Test Execution Module Onboarding".to_string(),
                total: 30,
                executed: 30,
                pass: 30,
                included: true,
                ..JiraExecutionSummary::default()
            },
            JiraExecutionSummary {
                key: "1112".to_string(),
                summary: "Test Execution Module Activation".to_string(),
                total: 2,
                executed: 2,
                pass: 2,
                included: true,
                ..JiraExecutionSummary::default()
            },
        ];
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        let count = summary
            .findings
            .iter()
            .find(|f| f.section == "Scenario Detail & Screen Capture SIT - Table Count")
            .expect("expected table count finding");
        assert_eq!(count.status, "PASS");
        assert_eq!(count.source_key.as_deref(), Some("1112"));
    }

    #[test]
    fn match_test_execution_scores_significant_title_tokens() {
        let exec = |key: &str, summary: &str, pass: u32| JiraExecutionSummary {
            key: key.to_string(),
            summary: summary.to_string(),
            total: pass,
            executed: pass,
            pass,
            included: true,
            ..JiraExecutionSummary::default()
        };
        let executions = vec![
            exec("CCSERKKBVI-127", "Test Execution of System Integration Test - Onboarding Module", 5),
            exec("CCSERKKBVI-137", "Test Execution of System Integration Test - Waive Annual Fee", 4),
            exec("CCSERKKBVI-145", "Test Execution of Test Plan of System Integration Test - Regression Way4", 8),
            exec("CCSERKKBVI-147", "Test Execution of Test Plan of System Integration Test - After Rollback", 2),
            exec("CCSERKKBVI-148", "Test Execution of Test Plan of System Integration Test - Regression Surrounding", 9),
        ];
        let cases = [
            (
                "01-01-01. CCSERKKBVI - Scenario Detail & Screen Capture SIT - Onboarding BIN dan Product type baru Kartu Kredit Private dan Prioritas",
                5u32,
                "CCSERKKBVI-127",
            ),
            (
                "01-01-05. CCSERKKBVI - Scenario Detail & Screen Capture SIT - Auto waive annual fee",
                4,
                "CCSERKKBVI-137",
            ),
            (
                "01-01-07. CCSERKKBVI - Scenario Detail & Screen Capture SIT - Regresi Way4",
                8,
                "CCSERKKBVI-145",
            ),
            (
                "01-01-08. CCSERKKBVI - Scenario Detail & Screen Capture SIT - Regresi Surrounding",
                9,
                "CCSERKKBVI-148",
            ),
        ];
        for (title, count, expected_key) in cases {
            let table = r#"<table>
                <tr>
                    <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                    <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
                </tr>
                <tr>
                    <td>TC{num}</td><td>F</td><td>Positive</td><td>-</td>
                    <td>1. run</td><td>ok</td><td>PASS</td><td>image.png</td>
                </tr>
            </table>"#;
            let html: String = (1..=count as usize)
                .map(|i| table.replace("{num}", &i.to_string()))
                .collect::<Vec<_>>()
                .join("");
            let page = page_data(serde_json::json!({
                "id": "x",
                "title": title,
                "body": { "storage": { "value": html }, "view": { "value": "" } }
            })).unwrap();
            let mut summary = ReviewSummary::default();
            summary.jira_executions.clone_from(&executions);
            let config = AppConfig::default();
            validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());
            let count_finding = summary
                .findings
                .iter()
                .find(|f| f.section == "Scenario Detail & Screen Capture SIT - Table Count");
            let count_finding = count_finding.expect("expected table count finding");
            assert_eq!(count_finding.status, "PASS", "title: {:?}", title);
            assert_eq!(
                count_finding.source_key.as_deref(),
                Some(expected_key),
                "title: {:?}",
                title
            );
        }
    }

    #[test]
    fn table_count_only_counts_pass_executions() {
        let table = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC{num}</td><td>Rollback</td><td>Positive</td><td>-</td>
                <td>1. run</td><td>success</td><td>PASS</td><td>image.png</td>
            </tr>
        </table>"#;
        let html: String = (1..=4)
            .map(|i| table.replace("{num}", &i.to_string()))
            .collect::<Vec<_>>()
            .join("");
        let page = page_data(serde_json::json!({
            "id": "7",
            "title": "01-01-02. CCEDUR Scenario Detail & Screen Capture After Rollback",
            "body": { "storage": { "value": html }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        summary.jira_executions = vec![JiraExecutionSummary {
            key: "CCEDUR-191".to_string(),
            summary: "Test Execution of Test Plan of System Integration Test - Rollback".to_string(),
            total: 8,
            executed: 4,
            pass: 4,
            fail: 2,
            not_executed: 2,
            included: true,
            ..JiraExecutionSummary::default()
        }];
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        let count = summary
            .findings
            .iter()
            .find(|f| f.section == "Scenario Detail & Screen Capture SIT - Table Count")
            .expect("expected table count finding");
        assert_eq!(count.status, "PASS", "expected PASS because only PASS runs count: {:?}", summary.findings);
        assert_eq!(count.source_key.as_deref(), Some("CCEDUR-191"));
    }

    #[test]
    fn scenario_table_score_reflects_failures() {
        let config = AppConfig::default();
        let incomplete = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC001</td><td>Login</td><td>Positive</td><td>-</td>
                <td></td><td></td><td>PASS</td><td></td>
            </tr>
        </table>"#;
        let page = page_data(serde_json::json!({
            "id": "3",
            "title": "01-01-01. CCEDUR Scenario Detail & Screen Capture SIT dan UAT",
            "body": { "storage": { "value": incomplete }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        let mut score = Score::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut score);
        assert_eq!(score.possible, SCENARIO_COMPLETENESS_WEIGHT);
        assert_eq!(score.earned, 0);

        let complete = r#"<table>
            <tr>
                <th>No. Test Case</th><th>Function</th><th>Kategori</th><th>Input Data</th>
                <th>Steps</th><th>Expected Result</th><th>Result</th><th>Screen Capture</th>
            </tr>
            <tr>
                <td>TC001</td><td>Login</td><td>Positive</td><td>-</td>
                <td>1. open</td><td>ok</td><td>PASS</td><td>image.png</td>
            </tr>
        </table>"#;
        let page = page_data(serde_json::json!({
            "id": "3",
            "title": "01-01-01. CCEDUR Scenario Detail & Screen Capture SIT dan UAT",
            "body": { "storage": { "value": complete }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        let mut score = Score::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut score);
        assert_eq!(score.possible, SCENARIO_COMPLETENESS_WEIGHT);
        assert_eq!(score.earned, SCENARIO_COMPLETENESS_WEIGHT);
    }

    #[test]
    fn page_without_scenario_table_returns_fail_finding() {
        let page = page_data(serde_json::json!({
            "id": "3",
            "title": "01-01. CCEDUR Scenario Detail & Screen Capture SIT",
            "body": { "storage": { "value": "<p>No table here</p>" }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        let fail = summary
            .findings
            .iter()
            .find(|f| f.status == "FAIL")
            .expect("expected FAIL finding");
        assert!(fail.title.contains("tidak ditemukan"));
    }

    #[test]
    fn label_value_table_detects_complete_columns_as_pass() {
        let html = r#"<table>
            <tr><td><strong>No. Test Case</strong></td><td>TC001</td></tr>
            <tr><td><strong>Function</strong></td><td>Audit Trail Log</td></tr>
            <tr><td><strong>Kategori</strong></td><td>Positive</td></tr>
            <tr><td><strong>Input Data</strong></td><td>User Klik menu</td></tr>
            <tr><td><strong>Steps</strong></td><td>1. Buka Portal</td></tr>
            <tr><td><strong>Expected Result</strong></td><td>Log muncul</td></tr>
            <tr><td><strong>Result</strong></td><td>Passed</td></tr>
            <tr><td><strong>Screen Capture</strong></td><td><ac:image><ri:attachment ri:filename="a.png"/></ac:image></td></tr>
        </table>"#;
        let page = page_data(serde_json::json!({
            "id": "3",
            "title": "01-01. CCEDUR Scenario Detail & Screen Capture SIT",
            "body": { "storage": { "value": html }, "view": { "value": "" } }
        })).unwrap();
let tables = dedupe_tables(parse_html_tables(&page.content));
        assert_eq!(find_label_value_test_case_id(&tables[0]).as_deref(), Some("TC001"));

        let mut summary = ReviewSummary::default();
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());
        assert!(
            summary.findings.iter().all(|f| f.status == "PASS"),
            "unexpected findings: {:?}",
            summary.findings
        );
    }

    #[test]
    fn label_value_table_reports_specific_missing_columns_and_tc_id() {
        let html = r#"<table>
            <tr><td><strong>No. Test Case</strong></td><td>TC007</td></tr>
            <tr><td><strong>Function</strong></td><td>Audit Trail Log</td></tr>
            <tr><td><strong>Kategori</strong></td><td>Positive</td></tr>
            <tr><td><strong>Input Data</strong></td><td>User Klik menu</td></tr>
            <tr><td><strong>Steps</strong></td><td></td></tr>
            <tr><td><strong>Expected Result</strong></td><td></td></tr>
            <tr><td><strong>Result</strong></td><td>Passed</td></tr>
            <tr><td><strong>Screen Capture</strong></td><td></td></tr>
        </table>"#;
        let page = page_data(serde_json::json!({
            "id": "3",
            "title": "01-01. CCEDUR Scenario Detail & Screen Capture SIT",
            "body": { "storage": { "value": html }, "view": { "value": "" } }
        })).unwrap();
        let mut summary = ReviewSummary::default();
        let config = AppConfig::default();
        validate_scenario_capture_tables(&page, &config, &mut summary, &mut Score::default());

        let fail = summary
            .findings
            .iter()
            .find(|f| f.status == "FAIL")
            .expect("expected FAIL finding");
        assert!(fail.title.contains("TC007"), "title: {}", fail.title);
        assert!(fail.description.contains("steps"), "desc: {}", fail.description);
        assert!(fail.description.contains("expected result"), "desc: {}", fail.description);
        assert!(fail.description.contains("screen capture"), "desc: {}", fail.description);
        assert_eq!(fail.source_key.as_deref(), Some("TC007"));
    }
}
