use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbTestPlan {
    pub tp_jira_key: String,
    pub title: String,
    pub uqa_key: String,
    pub assignee: Option<String>,
    pub last_sync: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTestPlanInput {
    pub uqa_key: String,
    pub tp_jira_key: String,
    pub title: Option<String>,
    pub assignee: Option<String>,
}

// Helper: lock the pool and return an error if not yet connected.
macro_rules! get_pool {
    ($state:expr) => {{
        let guard = $state.db_pool.lock().await;
        match guard.as_ref() {
            Some(p) => p.clone(),
            None => return Err("Database belum terhubung. Coba beberapa saat lagi.".into()),
        }
    }};
}

// ── Check DB connection ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn check_db_connection(state: State<'_, AppState>) -> Result<String, String> {
    let pool = get_pool!(state);
    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .map(|_| "Connected".to_string())
        .map_err(|e| format!("DB ping failed: {e}"))
}

// ── Save a UQA ↔ Test Plan relation into the DB ───────────────────────────────

#[tauri::command]
pub async fn save_uqa_test_plan(
    state: State<'_, AppState>,
    input: SaveTestPlanInput,
) -> Result<(), String> {
    let pool = get_pool!(state);

    // Only upsert uqa_project if a uqa_key is provided (it's a FK — can't insert empty string)
    if !input.uqa_key.is_empty() {
        sqlx::query(
            r#"
            INSERT INTO uqa_project (uqa_key, project_name, assignee, status, last_sync)
            VALUES (?, '', ?, '', NOW())
            ON DUPLICATE KEY UPDATE last_sync = NOW()
            "#,
        )
        .bind(&input.uqa_key)
        .bind(input.assignee.as_deref().unwrap_or(""))
        .execute(&pool)
        .await
        .map_err(|e| format!("Gagal upsert uqa_project: {e}"))?;
    }

    // Upsert test_plan — store NULL for uqa_key when not provided
    let uqa_key_opt: Option<&str> = if input.uqa_key.is_empty() { None } else { Some(&input.uqa_key) };
    sqlx::query(
        r#"
        INSERT INTO test_plan (tp_jira_key, title, uqa_key, assignee, last_sync)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            title     = VALUES(title),
            uqa_key   = COALESCE(VALUES(uqa_key), uqa_key),
            assignee  = VALUES(assignee),
            last_sync = NOW()
        "#,
    )
    .bind(&input.tp_jira_key)
    .bind(input.title.as_deref().unwrap_or(""))
    .bind(uqa_key_opt)
    .bind(input.assignee.as_deref().unwrap_or(""))
    .execute(&pool)
    .await
    .map_err(|e| format!("Gagal upsert test_plan: {e}"))?;

    Ok(())
}

// ── Fetch all Test Plans stored in DB ────────────────────────────────────────

#[tauri::command]
pub async fn get_db_test_plans(state: State<'_, AppState>) -> Result<Vec<DbTestPlan>, String> {
    let pool = get_pool!(state);

    let rows = sqlx::query(
        r#"
        SELECT
            tp_jira_key,
            title,
            uqa_key,
            assignee,
            DATE_FORMAT(last_sync, '%Y-%m-%d %H:%i:%s') AS last_sync
        FROM test_plan
        ORDER BY last_sync DESC
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Gagal mengambil data test_plan: {e}"))?;

    let result = rows
        .into_iter()
        .map(|row| DbTestPlan {
            tp_jira_key: row.get("tp_jira_key"),
            title: row.get("title"),
            uqa_key: row.get("uqa_key"),
            assignee: row.get("assignee"),
            last_sync: row.get("last_sync"),
        })
        .collect();

    Ok(result)
}

/// Fetch Test Plans whose key is prefixed by the given Jira project key
/// (e.g. project "CCSERKKBVI" → test plans like "CCSERKKBVI-123").
#[tauri::command]
pub async fn get_test_plans_by_project_prefix(
    state: State<'_, AppState>,
    project_key: String,
) -> Result<Vec<DbTestPlan>, String> {
    let prefix = project_key.trim();
    if prefix.is_empty() {
        return Ok(vec![]);
    }
    let pool = get_pool!(state);
    let like_pattern = format!("{prefix}-%");

    let rows = sqlx::query(
        r#"
        SELECT
            tp_jira_key,
            title,
            uqa_key,
            assignee,
            DATE_FORMAT(last_sync, '%Y-%m-%d %H:%i:%s') AS last_sync
        FROM test_plan
        WHERE tp_jira_key LIKE ?
        ORDER BY tp_jira_key ASC
        "#,
    )
    .bind(&like_pattern)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Gagal mengambil test_plan untuk project {prefix}: {e}"))?;

    let result = rows
        .into_iter()
        .map(|row| DbTestPlan {
            tp_jira_key: row.get("tp_jira_key"),
            title: row.get("title"),
            uqa_key: row.get("uqa_key"),
            assignee: row.get("assignee"),
            last_sync: row.get("last_sync"),
        })
        .collect();

    Ok(result)
}

// ── Save Test Executions to DB ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTestExecutionInput {
    pub te_jira_key: String,
    pub title: String,
    pub tp_jira_key: String,
    pub assignee: Option<String>,
    pub execution_status: Option<String>,
}

#[tauri::command]
pub async fn save_test_executions(
    state: State<'_, AppState>,
    executions: Vec<SaveTestExecutionInput>,
) -> Result<(), String> {
    let pool = get_pool!(state);

    for exec in &executions {
        sqlx::query(
            r#"
            INSERT INTO test_execution (te_jira_key, title, tp_jira_key, assignee, execution_status, last_sync)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                title            = VALUES(title),
                tp_jira_key      = VALUES(tp_jira_key),
                assignee         = VALUES(assignee),
                execution_status = VALUES(execution_status),
                last_sync        = NOW()
            "#,
        )
        .bind(&exec.te_jira_key)
        .bind(&exec.title)
        .bind(&exec.tp_jira_key)
        .bind(exec.assignee.as_deref().unwrap_or(""))
        .bind(exec.execution_status.as_deref().unwrap_or(""))
        .execute(&pool)
        .await
        .map_err(|e| format!("Gagal upsert test_execution {}: {e}", exec.te_jira_key))?;
    }

    Ok(())
}

// ── Check which TE keys already exist in DB ───────────────────────────────────

#[tauri::command]
pub async fn check_test_executions_in_db(
    state: State<'_, AppState>,
    te_keys: Vec<String>,
) -> Result<Vec<String>, String> {
    if te_keys.is_empty() {
        return Ok(vec![]);
    }

    let pool = get_pool!(state);

    let placeholders = te_keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT te_jira_key FROM test_execution WHERE te_jira_key IN ({})",
        placeholders
    );

    let mut q = sqlx::query(&sql);
    for k in &te_keys {
        q = q.bind(k);
    }

    let rows = q
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Gagal cek test_execution di DB: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|row| row.get::<String, _>("te_jira_key"))
        .collect())
}

// ── UQA Project sync to DB ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveUqaProjectInput {
    pub uqa_key: String,
    pub project_name: String,
    pub assignee: Option<String>,
    pub product_tester: Option<String>,
    pub status: Option<String>,
    pub start_sit: Option<String>,
    pub finish_sit: Option<String>,
    pub start_uat: Option<String>,
}


#[tauri::command]
pub async fn save_uqa_projects(
    state: State<'_, AppState>,
    projects: Vec<SaveUqaProjectInput>,
) -> Result<(), String> {
    let pool = get_pool!(state);

    for p in &projects {
        sqlx::query(
            r#"
            INSERT INTO uqa_project
                (uqa_key, project_name, assignee, product_tester, status, start_qa, finish_qa, finish_uat, last_sync)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                project_name   = VALUES(project_name),
                assignee       = VALUES(assignee),
                product_tester = VALUES(product_tester),
                status         = VALUES(status),
                start_qa       = VALUES(start_qa),
                finish_qa      = VALUES(finish_qa),
                finish_uat     = VALUES(finish_uat),
                last_sync      = NOW()
            "#,
        )
        .bind(&p.uqa_key)
        .bind(&p.project_name)
        .bind(p.assignee.as_deref().unwrap_or(""))
        .bind(p.product_tester.as_deref().unwrap_or(""))
        .bind(p.status.as_deref().unwrap_or(""))
        .bind(p.start_sit.as_deref())   // → start_qa
        .bind(p.finish_sit.as_deref())  // → finish_qa
        .bind(p.start_uat.as_deref())   // → finish_uat
        .execute(&pool)
        .await
        .map_err(|e| format!("Gagal upsert uqa_project {}: {e}", p.uqa_key))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn resync_uqa_project(
    state: State<'_, AppState>,
    project: SaveUqaProjectInput,
) -> Result<(), String> {
    let pool = get_pool!(state);
    sqlx::query(
        r#"
        INSERT INTO uqa_project
            (uqa_key, project_name, assignee, product_tester, status, start_qa, finish_qa, finish_uat, last_sync)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            project_name   = VALUES(project_name),
            assignee       = VALUES(assignee),
            product_tester = VALUES(product_tester),
            status         = VALUES(status),
            start_qa       = VALUES(start_qa),
            finish_qa      = VALUES(finish_qa),
            finish_uat     = VALUES(finish_uat),
            last_sync      = NOW()
        "#,
    )
    .bind(&project.uqa_key)
    .bind(&project.project_name)
    .bind(project.assignee.as_deref().unwrap_or(""))
    .bind(project.product_tester.as_deref().unwrap_or(""))
    .bind(project.status.as_deref().unwrap_or(""))
    .bind(project.start_sit.as_deref())
    .bind(project.finish_sit.as_deref())
    .bind(project.start_uat.as_deref())
    .execute(&pool)
    .await
    .map_err(|e| format!("Gagal resync uqa_project {}: {e}", project.uqa_key))?;
    Ok(())
}

/// Update only the status column of uqa_project after a Jira transition.
#[tauri::command]
pub async fn update_uqa_project_status(
    state: State<'_, AppState>,
    uqa_key: String,
    status: String,
) -> Result<(), String> {
    let pool = get_pool!(state);
    sqlx::query(
        r#"UPDATE uqa_project SET status = ?, last_sync = NOW() WHERE uqa_key = ?"#,
    )
    .bind(&status)
    .bind(&uqa_key)
    .execute(&pool)
    .await
    .map_err(|e| format!("Gagal update status uqa_project {uqa_key}: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn check_uqa_projects_in_db(
    state: State<'_, AppState>,
    uqa_keys: Vec<String>,
) -> Result<Vec<String>, String> {
    if uqa_keys.is_empty() {
        return Ok(vec![]);
    }

    let pool = get_pool!(state);
    let placeholders = uqa_keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT uqa_key FROM uqa_project WHERE uqa_key IN ({})",
        placeholders
    );

    let mut q = sqlx::query(&sql);
    for k in &uqa_keys {
        q = q.bind(k);
    }

    let rows = q
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Gagal cek uqa_project di DB: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|row| row.get::<String, _>("uqa_key"))
        .collect())
}

// ── Test Repository ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTestRepositoryInput {
    pub project_key: String,
    pub project_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DbTestRepository {
    pub project_key: String,
    pub project_name: String,
    pub last_sync: Option<String>,
}

#[tauri::command]
pub async fn save_test_repositories(
    state: State<'_, AppState>,
    repositories: Vec<SaveTestRepositoryInput>,
) -> Result<(), String> {
    let pool = get_pool!(state);

    for repo in &repositories {
        sqlx::query(
            r#"
            INSERT INTO test_repository (id_jira_repo, nama_repo, last_sync)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                nama_repo = VALUES(nama_repo),
                last_sync = NOW()
            "#,
        )
        .bind(&repo.project_key)
        .bind(&repo.project_name)
        .execute(&pool)
        .await
        .map_err(|e| format!("Gagal upsert test_repository {}: {e}", repo.project_key))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_test_repositories_in_db(
    state: State<'_, AppState>,
) -> Result<Vec<DbTestRepository>, String> {
    let pool = get_pool!(state);

    let rows = sqlx::query(
        r#"
        SELECT
            id_jira_repo,
            nama_repo,
            DATE_FORMAT(last_sync, '%Y-%m-%d %H:%i:%s') AS last_sync
        FROM test_repository
        ORDER BY last_sync DESC
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Gagal mengambil data test_repository: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|row| DbTestRepository {
            project_key: row.get("id_jira_repo"),
            project_name: row.get("nama_repo"),
            last_sync: row.get("last_sync"),
        })
        .collect())
}

// ── Test Case ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTestCaseInput {
    pub tc_key: String,
    pub te_jira_key: String,
    pub title: Option<String>,
    pub id_jira_repo: Option<String>,
    pub assignee: Option<String>,
}

#[tauri::command]
pub async fn save_test_cases(
    state: State<'_, AppState>,
    cases: Vec<SaveTestCaseInput>,
) -> Result<(), String> {
    let pool = get_pool!(state);

    for tc in &cases {
        // Derive id_jira_repo from tc_key prefix if not provided (e.g. "TRAW-1027" → "TRAW")
        let id_jira_repo = tc.id_jira_repo.clone().or_else(|| {
            tc.tc_key.rfind('-').map(|i| tc.tc_key[..i].to_string())
        });

        sqlx::query(
            r#"
            INSERT INTO test_case (tc_key, te_jira_key, title, id_jira_repo, assignee, last_sync)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                title        = COALESCE(VALUES(title), title),
                id_jira_repo = COALESCE(VALUES(id_jira_repo), id_jira_repo),
                assignee     = COALESCE(VALUES(assignee), assignee),
                last_sync    = NOW()
            "#,
        )
        .bind(&tc.tc_key)
        .bind(&tc.te_jira_key)
        .bind(tc.title.as_deref())
        .bind(id_jira_repo.as_deref())
        .bind(tc.assignee.as_deref())
        .execute(&pool)
        .await
        .map_err(|e| format!("Gagal upsert test_case {}/{}: {e}", tc.tc_key, tc.te_jira_key))?;
    }

    Ok(())
}

/// Fetch all test cases in a Test Execution from Xray with full detail, then
/// upsert each into `test_case`. Fields populated:
///   title          ← Jira issue summary
///   id_jira_repo   ← project prefix of tc_key (e.g. "TRALOS" from "TRALOS-1")
///   test_run_status← Xray run status
///   executed_by    ← assignee/executor display name from run
///   executed_at    ← finishedOn from run
/// Existing non-NULL values are preserved via COALESCE.
#[derive(Debug, Serialize, Deserialize)]
pub struct SyncTcResult {
    pub count: u32,
    /// True when the TE exceeds Xray's 200-TC listing cap and not all TCs
    /// could be discovered (JQL fallback unavailable or also incomplete).
    pub truncated: bool,
}

#[tauri::command]
pub async fn sync_execution_tests_to_db(
    state: State<'_, AppState>,
    exec_key: String,
) -> Result<SyncTcResult, String> {
    let pool = get_pool!(state);
    let config = crate::commands::load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let client = jira_service
        .client(&config.jira)
        .map_err(|e| format!("Gagal membuat Jira client: {e}"))?;

    // ── 1. Fetch TC list from TE ──
    // Xray Server /testexec/{key}/test hard-caps results at 200 and does not
    // honor startAt/limit for pagination (both are ignored, returning the
    // same first page every time), so we can only fetch a single page.
    // `detailed=true` is required to get `assignee`/`executedBy` on every
    // TC (not just ones that already ran) — without it those fields are
    // simply absent from the response.
    let list_path = format!("/testexec/{exec_key}/test?detailed=true");
    log::info!("[sync_tc] fetching url base={} prefix=/rest/raven/1.0/api path={list_path}",
        config.jira.base_url);
    const PAGE_SIZE: usize = 200;
    let mut over_cap = false;
    let mut arr: Vec<serde_json::Value> = match client.xray.get_json(&list_path, &[]).await {
        Ok(raw) => {
            log::info!("[sync_tc] exec={exec_key} raw_type={} raw_preview={}",
                if raw.is_array() { "array" } else if raw.is_object() { "object" } else if raw.is_null() { "null" } else { "other" },
                raw.to_string().chars().take(500).collect::<String>()
            );
            let a = raw.as_array().cloned().unwrap_or_default();
            log::info!("[sync_tc] exec={exec_key} total_tc={}", a.len());
            if a.len() >= PAGE_SIZE {
                over_cap = true;
            }
            a
        }
        Err(e) if e.to_string().contains("Maximum results per request exceeded") => {
            // Xray Server refuses to return the list at all once the TE has
            // more TCs than its hard cap (no partial page, straight HTTP 400).
            log::warn!("[sync_tc] exec={exec_key} /testexec/test rejected — TE exceeds the {PAGE_SIZE}-result cap ({e})");
            over_cap = true;
            Vec::new()
        }
        Err(e) => {
            log::error!("[sync_tc] exec={exec_key} fetch_error={e}");
            return Err(format!("Gagal mengambil daftar TC untuk {exec_key}: {e}"));
        }
    };

    // Xray's /testexec/{key}/test hard-caps at 200 results with no working
    // pagination (either truncating to 200, or — once past the cap —
    // refusing the request entirely with HTTP 400). Either way, fall back to
    // Jira's own paginated JQL search (which Xray Server exposes via the
    // issueFunction JQL library) to discover the full key list, and merge in
    // any keys the capped/failed Xray response was missing.
    if over_cap {
        log::warn!("[sync_tc] exec={exec_key} hit the {PAGE_SIZE}-result cap on /testexec/test; \
            attempting full key discovery via JQL issueFunction fallback");
        let jql = format!("issueFunction in testExecutionTests(\"{exec_key}\")");
        match client.search_issues_paginated(&jql, "summary").await {
            Ok(issues) if !issues.is_empty() => {
                let known: std::collections::HashSet<String> = arr.iter()
                    .filter_map(|t| t["key"].as_str())
                    .map(|k| k.to_string())
                    .collect();
                let mut added = 0u32;
                for issue in &issues {
                    if let Some(key) = issue["key"].as_str() {
                        if !known.contains(key) {
                            arr.push(serde_json::json!({ "key": key }));
                            added += 1;
                        }
                    }
                }
                log::info!("[sync_tc] exec={exec_key} JQL fallback found {} TCs total, {added} not present in capped list", issues.len());
                // Full key list recovered — no longer truncated.
                over_cap = false;
            }
            Ok(_) => {
                log::warn!("[sync_tc] exec={exec_key} JQL fallback returned no issues; \
                    'JQL Functions for Xray' plugin may not be installed. Proceeding with capped {PAGE_SIZE} TCs only.");
            }
            Err(e) => {
                log::warn!("[sync_tc] exec={exec_key} JQL fallback failed ({e}); \
                    proceeding with capped {PAGE_SIZE} TCs only.");
            }
        }
    }
    if arr.is_empty() {
        if over_cap {
            return Err(format!(
                "{exec_key} memiliki lebih dari {PAGE_SIZE} test case. Xray menolak permintaan ini \
                 dan pencarian JQL cadangan (issueFunction) juga tidak mengembalikan hasil — \
                 kemungkinan plugin 'JQL Functions for Xray' belum aktif di Jira. \
                 Hubungi admin Jira untuk mengaktifkannya, atau pecah Test Execution ini menjadi beberapa TE lebih kecil."
            ));
        }
        return Ok(SyncTcResult { count: 0, truncated: false });
    }

    // Collect tc_keys for batch Jira fetch
    let tc_keys: Vec<String> = arr.iter()
        .filter_map(|t| t["key"].as_str())
        .filter(|k| !k.is_empty())
        .map(|k| k.to_string())
        .collect();

    // ── 2. Batch fetch Jira summaries via JQL ──
    let mut summaries: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if !tc_keys.is_empty() {
        let keys_joined = tc_keys.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(",");
        let jql = format!("key in ({keys_joined})");
        if let Ok(issues) = client.search_issues(&jql, tc_keys.len() as u32, "summary").await {
            for issue in &issues {
                if let (Some(key), Some(summary)) = (
                    issue["key"].as_str(),
                    issue["fields"]["summary"].as_str(),
                ) {
                    summaries.insert(key.to_string(), summary.to_string());
                }
            }
        }
    }

    // ── 3. Per-TC: fetch Test Run detail to get executedBy + status + finishedOn ──
    // Endpoint: GET /rest/raven/1.0/api/test/{tc_key}/testrun?testExecIssueKey={exec_key}
    // Returns array of runs; we take the first one matching exec_key
    struct RunDetail {
        status: Option<String>,
        assignee: Option<String>,
        executed_by: Option<String>,
        executed_at: Option<String>,
    }

    fn parse_datetime(s: &str) -> String {
        // "2026-07-20T13:19:00+07:00" → "2026-07-20 13:19:00"
        let s = s.replace('T', " ");
        // strip timezone (+07:00 or Z)
        let s = if let Some(pos) = s.find('+') { s[..pos].to_string() } else { s };
        let s = s.trim().to_string();
        if s.len() >= 19 { s[..19].to_string() } else { s }
    }

    fn extract_run_detail(run_data: &serde_json::Value, exec_key: &str) -> RunDetail {
        // run_data may be an array or a single object
        let run = if let Some(arr) = run_data.as_array() {
            // find run for this exec key
            arr.iter()
                .find(|r| r["testExecIssueKey"].as_str() == Some(exec_key)
                    || r["testExecKey"].as_str() == Some(exec_key)
                    || r["testExecution"]["key"].as_str() == Some(exec_key))
                .or_else(|| arr.first())
                .cloned()
                .unwrap_or(serde_json::Value::Null)
        } else {
            run_data.clone()
        };

        let status = run["status"].as_str()
            .or_else(|| run["statusName"].as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let assignee = run["assignee"]["displayName"].as_str()
            .or_else(|| run["assignee"].as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let executed_by = run["executedBy"]["displayName"].as_str()
            .or_else(|| run["executedBy"].as_str())
            .or_else(|| run["executor"]["displayName"].as_str())
            .or_else(|| run["executor"].as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let executed_at = run["finishedOn"].as_str()
            .or_else(|| run["endedOn"].as_str())
            .or_else(|| run["finished"].as_str())
            .filter(|s| !s.is_empty())
            .map(|s| parse_datetime(s));

        RunDetail { status, assignee, executed_by, executed_at }
    }

    // ── 4. Upsert each TC ──
    let mut count = 0u32;
    for t in &arr {
        let tc_key = match t["key"].as_str().filter(|k| !k.is_empty()) {
            Some(k) => k.to_string(),
            None => continue,
        };

        let title = summaries.get(&tc_key).cloned();

        // id_jira_repo: everything before the last "-NNN"
        let id_jira_repo: Option<String> = tc_key
            .rfind('-')
            .map(|i| tc_key[..i].to_string());

        // Use status directly from TC list response (avoids 1 HTTP call per TC).
        // The /testexec/{key}/test response already contains status, assignee, executedBy
        // as sibling fields — assignee (who the test is assigned to) and executedBy (who
        // actually ran it) are kept as separate columns, not folded into one fallback chain.
        let status_from_list = t["status"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());
        let assignee_from_list = t["assignee"].as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let executed_by_from_list = t["executedBy"].as_str()
            .or_else(|| t["executor"].as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let executed_at_from_list = t["finishedOn"].as_str()
            .or_else(|| t["endedOn"].as_str())
            .filter(|s| !s.is_empty())
            .map(|s| parse_datetime(s));

        // Only call /testrun if list response lacks status (fallback for edge cases)
        let detail = if status_from_list.is_some() {
            RunDetail {
                status: status_from_list,
                assignee: assignee_from_list,
                executed_by: executed_by_from_list,
                executed_at: executed_at_from_list,
            }
        } else {
            let run_data_v1 = client.xray.get_json_or_none("/testrun", &[
                ("testExecIssueKey", exec_key.clone()),
                ("testIssueKey", tc_key.clone()),
            ]).await;
            let run_data = if run_data_v1.is_some() {
                run_data_v1.unwrap_or(serde_json::Value::Null)
            } else {
                let run_path_v2 = format!("/test/{tc_key}/testrun");
                client.xray.get_json_or_none(&run_path_v2, &[
                    ("testExecIssueKey", exec_key.clone()),
                ]).await.unwrap_or(serde_json::Value::Null)
            };
            if run_data.is_null() {
                RunDetail {
                    status: None,
                    assignee: assignee_from_list,
                    executed_by: executed_by_from_list,
                    executed_at: executed_at_from_list,
                }
            } else {
                extract_run_detail(&run_data, &exec_key)
            }
        };

        let test_run_status = detail.status.clone();
        let assignee = detail.assignee.clone();
        let executed_by = detail.executed_by.clone();
        let executed_at = detail.executed_at.clone();

        sqlx::query(
            r#"
            INSERT INTO test_case
                (tc_key, te_jira_key, title, id_jira_repo, test_run_status, assignee, executed_by, executed_at, last_sync)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                title           = COALESCE(VALUES(title), title),
                id_jira_repo    = COALESCE(VALUES(id_jira_repo), id_jira_repo),
                test_run_status = COALESCE(VALUES(test_run_status), test_run_status),
                assignee        = COALESCE(VALUES(assignee), assignee),
                executed_by     = COALESCE(VALUES(executed_by), executed_by),
                executed_at     = COALESCE(VALUES(executed_at), executed_at),
                last_sync       = NOW()
            "#,
        )
        .bind(&tc_key)
        .bind(&exec_key)
        .bind(title.as_deref())
        .bind(id_jira_repo.as_deref())
        .bind(test_run_status.as_deref())
        .bind(assignee.as_deref())
        .bind(executed_by.as_deref())
        .bind(executed_at.as_deref())
        .execute(&pool)
        .await
        .map_err(|e| format!("Gagal upsert {tc_key}/{exec_key}: {e}"))?;

        count += 1;
    }

    Ok(SyncTcResult { count, truncated: over_cap })
}

// ── Given a list of TP Jira keys, return which ones already exist in DB ───────

#[tauri::command]
pub async fn check_test_plans_in_db(
    state: State<'_, AppState>,
    tp_keys: Vec<String>,
) -> Result<Vec<String>, String> {
    if tp_keys.is_empty() {
        return Ok(vec![]);
    }

    let pool = get_pool!(state);

    let placeholders = tp_keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT tp_jira_key FROM test_plan WHERE tp_jira_key IN ({})",
        placeholders
    );

    let mut q = sqlx::query(&sql);
    for k in &tp_keys {
        q = q.bind(k);
    }

    let rows = q
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Gagal cek test_plan di DB: {e}"))?;

    let found: Vec<String> = rows
        .into_iter()
        .map(|row| row.get::<String, _>("tp_jira_key"))
        .collect();

    Ok(found)
}

/// Fetch defect detail from Jira and upsert into `defect` table.
/// summary is passed directly from frontend (already in DefectRecord).
/// Only fetches resolution, assignee, issuelinks from Jira (single request, no retry).
#[tauri::command]
pub async fn sync_defect_to_db(
    state: State<'_, AppState>,
    defect_key: String,
    judul_defect: String,
) -> Result<(), String> {
    let pool = get_pool!(state);
    let config = crate::commands::load_config(state.clone()).await?;
    let jira_service = state.jira_service.lock().await;
    let client = jira_service
        .client(&config.jira)
        .map_err(|e| format!("Gagal membuat Jira client: {e}"))?;

    // Single Jira fetch — only fields not available in DefectRecord
    let path = format!("/issue/{defect_key}");
    let issue = client.api.get_json(&path, &[
        ("fields", "resolution,assignee,issuelinks".to_string()),
    ]).await.map_err(|e| format!("Gagal fetch issue {defect_key}: {e}"))?;

    let fields = &issue["fields"];

    let resolution = fields["resolution"]["name"].as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let assignee = fields["assignee"]["displayName"].as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    // Extract tp_jira_key from issuelinks where type is "is contained on" / "Test"
    let tp_jira_key: Option<String> = fields["issuelinks"]
        .as_array()
        .and_then(|links| {
            links.iter().find_map(|link| {
                // "is contained on" → outwardIssue or inwardIssue depending on link direction
                let link_type = link["type"]["name"].as_str().unwrap_or("").to_lowercase();
                let inward = link["type"]["inward"].as_str().unwrap_or("").to_lowercase();
                let outward = link["type"]["outward"].as_str().unwrap_or("").to_lowercase();

                let is_contained = link_type.contains("test")
                    || link_type.contains("contained")
                    || inward.contains("contained")
                    || outward.contains("contained")
                    || inward.contains("test plan")
                    || outward.contains("test plan");

                if !is_contained {
                    return None;
                }

                // Try outwardIssue first, then inwardIssue
                link["outwardIssue"]["key"].as_str()
                    .or_else(|| link["inwardIssue"]["key"].as_str())
                    .map(|k| k.to_string())
            })
        });

    sqlx::query(
        r#"
        INSERT INTO defect (id_jira_defect, judul_defect, tp_jira_key, resolution, assignee)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            judul_defect = VALUES(judul_defect),
            tp_jira_key  = COALESCE(VALUES(tp_jira_key), tp_jira_key),
            resolution   = COALESCE(VALUES(resolution), resolution),
            assignee     = COALESCE(VALUES(assignee), assignee)
        "#,
    )
    .bind(&defect_key)
    .bind(&judul_defect)
    .bind(tp_jira_key.as_deref())
    .bind(resolution.as_deref())
    .bind(assignee.as_deref())
    .execute(&pool)
    .await
    .map_err(|e| format!("Gagal upsert defect {defect_key}: {e}"))?;

    Ok(())
}

/// Check which defect keys already exist in the `defect` table.
#[tauri::command]
pub async fn check_defects_in_db(
    state: State<'_, AppState>,
    defect_keys: Vec<String>,
) -> Result<Vec<String>, String> {
    if defect_keys.is_empty() {
        return Ok(vec![]);
    }

    let pool = get_pool!(state);
    let placeholders = defect_keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT id_jira_defect FROM defect WHERE id_jira_defect IN ({})",
        placeholders
    );

    let mut q = sqlx::query(&sql);
    for k in &defect_keys {
        q = q.bind(k);
    }

    let rows = q
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Gagal cek defect di DB: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|row| row.get::<String, _>("id_jira_defect"))
        .collect())
}

// ── Monitoring screen queries ──────────────────────────────────────────────

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct MonitoringUqaProject {
    pub uqa_key: String,
    pub project_name: Option<String>,
    pub assignee: Option<String>,
    pub product_tester: Option<String>,
    pub status: Option<String>,
    pub start_qa: Option<String>,
    pub finish_qa: Option<String>,
    pub finish_uat: Option<String>,
    pub last_sync: Option<String>,
}

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct MonitoringTestExecution {
    pub te_jira_key: String,
    pub title: Option<String>,
    pub tp_jira_key: Option<String>,
    pub uqa_key: Option<String>,
    pub assignee: Option<String>,
    pub execution_status: Option<String>,
    pub last_sync: Option<String>,
}

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct MonitoringTestCase {
    pub tc_key: String,
    pub te_jira_key: String,
    pub title: Option<String>,
    pub test_run_status: Option<String>,
    pub assignee: Option<String>,
    pub executed_by: Option<String>,
    pub executed_at: Option<String>,
}

/// Fetch UQA projects from DB where assignee OR product_tester matches username or display name.
/// product_tester may contain comma-separated names (e.g. "Alice, Bob"), so we use LIKE.
#[tauri::command]
pub async fn get_my_uqa_projects(
    state: State<'_, AppState>,
    username: String,
    display_name: String,
) -> Result<Vec<MonitoringUqaProject>, String> {
    let pool = get_pool!(state);
    // name_a = display name when available, else fall back to username
    let name_a = if display_name.is_empty() { username.clone() } else { display_name.clone() };
    let like_username = format!("%{}%", username);
    let like_name_a  = format!("%{}%", name_a);
    let rows = sqlx::query_as::<_, MonitoringUqaProject>(
        r#"
        SELECT
            uqa_key,
            project_name,
            assignee,
            product_tester,
            status,
            DATE_FORMAT(start_qa, '%Y-%m-%d') AS start_qa,
            DATE_FORMAT(finish_qa, '%Y-%m-%d') AS finish_qa,
            DATE_FORMAT(finish_uat, '%Y-%m-%d') AS finish_uat,
            DATE_FORMAT(last_sync, '%Y-%m-%d %H:%i:%s') AS last_sync
        FROM uqa_project
        WHERE assignee LIKE ?
           OR assignee LIKE ?
           OR product_tester LIKE ?
           OR product_tester LIKE ?
        ORDER BY last_sync DESC
        "#,
    )
    .bind(&like_username)
    .bind(&like_name_a)
    .bind(&like_username)
    .bind(&like_name_a)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Gagal fetch UQA projects: {e}"))?;
    Ok(rows)
}

/// Fetch all test executions linked to UQA projects where user is assignee or product_tester.
#[tauri::command]
pub async fn get_my_test_executions(
    state: State<'_, AppState>,
    username: String,
    display_name: String,
) -> Result<Vec<MonitoringTestExecution>, String> {
    let pool = get_pool!(state);
    let name_a = if display_name.is_empty() { &username } else { &display_name };
    let like_username = format!("%{}%", username);
    let like_name_a  = format!("%{}%", name_a);
    let rows = sqlx::query_as::<_, MonitoringTestExecution>(
        r#"
        SELECT
            te.te_jira_key,
            te.title,
            te.tp_jira_key,
            tp.uqa_key,
            te.assignee,
            te.execution_status,
            DATE_FORMAT(te.last_sync, '%Y-%m-%d %H:%i:%s') AS last_sync
        FROM test_execution te
        LEFT JOIN test_plan tp ON tp.tp_jira_key = te.tp_jira_key
        LEFT JOIN uqa_project uqa ON uqa.uqa_key = tp.uqa_key
        WHERE uqa.assignee LIKE ?
           OR uqa.assignee LIKE ?
           OR uqa.product_tester LIKE ?
           OR uqa.product_tester LIKE ?
        ORDER BY te.last_sync DESC
        "#,
    )
    .bind(&like_username)
    .bind(&like_name_a)
    .bind(&like_username)
    .bind(&like_name_a)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Gagal fetch test executions: {e}"))?;
    Ok(rows)
}

/// Fetch test executions from DB whose te_jira_key starts with the given project prefix.
#[tauri::command]
pub async fn get_te_by_project_prefix(
    state: State<'_, AppState>,
    project_prefix: String,
) -> Result<Vec<MonitoringTestExecution>, String> {
    let pool = get_pool!(state);
    let pattern = format!("{}-%", project_prefix);
    let rows = sqlx::query_as::<_, MonitoringTestExecution>(
        r#"
        SELECT
            te.te_jira_key,
            te.title,
            te.tp_jira_key,
            tp.uqa_key,
            te.assignee,
            te.execution_status,
            DATE_FORMAT(te.last_sync, '%Y-%m-%d %H:%i:%s') AS last_sync
        FROM test_execution te
        LEFT JOIN test_plan tp ON tp.tp_jira_key = te.tp_jira_key
        WHERE te.te_jira_key LIKE ?
        ORDER BY te.last_sync DESC
        "#,
    )
    .bind(&pattern)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Gagal fetch test executions by prefix: {e}"))?;
    Ok(rows)
}

/// Fetch test cases from DB for a given TE key, filtered by executed_by = username.
#[tauri::command]
pub async fn get_my_test_cases_by_execution(
    state: State<'_, AppState>,
    te_jira_key: String,
    username: String,
    display_name: Option<String>,
) -> Result<Vec<MonitoringTestCase>, String> {
    let pool = get_pool!(state);
    // "Mine" means assigned to me in Xray — match on either PN/username or
    // display name, since Xray's `assignee` field can surface either
    // depending on how the instance is configured (e.g. "00400291" or
    // "Mirza Raevan Faisal"). Falls back to matching username alone when no
    // display name is available.
    let display_name = display_name.filter(|s| !s.trim().is_empty());
    let rows = sqlx::query_as::<_, MonitoringTestCase>(
        r#"
        SELECT
            tc_key,
            te_jira_key,
            title,
            test_run_status,
            assignee,
            executed_by,
            DATE_FORMAT(executed_at, '%Y-%m-%d %H:%i:%s') AS executed_at
        FROM test_case
        WHERE te_jira_key = ? AND (assignee = ? OR assignee = ?)
        ORDER BY tc_key ASC
        "#,
    )
    .bind(&te_jira_key)
    .bind(&username)
    .bind(display_name.as_deref().unwrap_or(&username))
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Gagal fetch test cases: {e}"))?;
    Ok(rows)
}

/// Fetch test cases from DB for a given TE key (no username filter).
#[tauri::command]
pub async fn get_test_cases_by_te_key(
    state: State<'_, AppState>,
    te_jira_key: String,
) -> Result<Vec<MonitoringTestCase>, String> {
    let pool = get_pool!(state);
    let rows = sqlx::query_as::<_, MonitoringTestCase>(
        r#"
        SELECT
            tc_key,
            te_jira_key,
            title,
            test_run_status,
            assignee,
            executed_by,
            DATE_FORMAT(executed_at, '%Y-%m-%d %H:%i:%s') AS executed_at
        FROM test_case
        WHERE te_jira_key = ?
        ORDER BY tc_key ASC
        "#,
    )
    .bind(&te_jira_key)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Gagal fetch test cases: {e}"))?;
    Ok(rows)
}

/// Summarise TC statuses per Test Execution for a given UQA key, using the
/// DB chain: uqa_project → test_plan → test_execution → test_case.
/// Only Test Executions whose last_sync date is today are included.
/// Returns one row per TE with aggregated status counts.
#[tauri::command]
pub async fn get_uqa_db_execution_summary(
    state: State<'_, AppState>,
    uqa_key: String,
) -> Result<Vec<crate::models::uqa::DbTeSummary>, String> {
    let pool = get_pool!(state);
    let rows = sqlx::query(
        r#"
        SELECT
            te.te_jira_key,
            te.title                                          AS te_title,
            COALESCE(te.execution_status, '')                 AS execution_status,
            DATE_FORMAT(te.last_sync, '%Y-%m-%d %H:%i:%s')   AS last_sync,
            COUNT(tc.tc_key)                                  AS total,
            CAST(SUM(tc.test_run_status IN ('PASS','DONE','Done','Pass')) AS SIGNED) AS done_count,
            CAST(SUM(tc.test_run_status IN ('FAIL','FAILED','Failed','Fail')) AS SIGNED) AS failed_count,
            CAST(SUM(tc.test_run_status IN ('ABORTED','Aborted')) AS SIGNED) AS aborted_count,
            CAST(SUM(tc.test_run_status IN ('EXECUTING','IN_PROGRESS','In Progress','In progress','Executing'))
                                                              AS SIGNED) AS in_progress_count,
            CAST(SUM(tc.test_run_status IN ('TODO','To Do','To do','todo'))
                                                              AS SIGNED) AS todo_count
        FROM test_plan tp
        JOIN test_execution te ON te.tp_jira_key = tp.tp_jira_key
        LEFT JOIN test_case tc ON tc.te_jira_key = te.te_jira_key
        WHERE tp.uqa_key = ?
          AND DATE(te.last_sync) = CURDATE()
        GROUP BY te.te_jira_key, te.title, te.execution_status, te.last_sync
        ORDER BY te.last_sync DESC
        "#,
    )
    .bind(&uqa_key)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Gagal fetch DB execution summary: {e}"))?;

    let result = rows
        .iter()
        .map(|row| crate::models::uqa::DbTeSummary {
            te_jira_key:    row.get("te_jira_key"),
            te_title:       row.get("te_title"),
            execution_status: row.get("execution_status"),
            last_sync:      row.get("last_sync"),
            total:          row.try_get::<i64, _>("total").unwrap_or(0) as u32,
            done:           row.try_get::<i64, _>("done_count").unwrap_or(0) as u32,
            failed:         row.try_get::<i64, _>("failed_count").unwrap_or(0) as u32,
            aborted:        row.try_get::<i64, _>("aborted_count").unwrap_or(0) as u32,
            in_progress:    row.try_get::<i64, _>("in_progress_count").unwrap_or(0) as u32,
            todo:           row.try_get::<i64, _>("todo_count").unwrap_or(0) as u32,
        })
        .collect();

    Ok(result)
}

/// Batch fetch tc_key → title. First checks test_case DB table, then falls back
/// to Jira API for any keys missing or without a title.
#[tauri::command]
pub async fn get_test_case_titles(
    state: State<'_, AppState>,
    tc_keys: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    if tc_keys.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // ── 1. Try DB first ──
    if let Ok(pool) = state.db_pool.lock().await.as_ref().ok_or("no pool").map(|p| p.clone()) {
        let placeholders = tc_keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT tc_key, title FROM test_case WHERE tc_key IN ({}) AND title IS NOT NULL AND title != ''",
            placeholders
        );
        let mut q = sqlx::query(&sql);
        for key in &tc_keys {
            q = q.bind(key);
        }
        if let Ok(rows) = q.fetch_all(&pool).await {
            for row in rows {
                use sqlx::Row;
                let key: String = row.get("tc_key");
                let title: String = row.get("title");
                map.insert(key, title);
            }
        }
    }

    // ── 2. Fetch missing keys from Jira ──
    let missing: Vec<String> = tc_keys.iter().filter(|k| !map.contains_key(*k)).cloned().collect();
    if !missing.is_empty() {
        if let Ok(config) = crate::commands::load_config(state.clone()).await {
            let jira_service = state.jira_service.lock().await;
            if let Ok(client) = jira_service.client(&config.jira) {
                let keys_joined = missing.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(",");
                let jql = format!("key in ({keys_joined})");
                if let Ok(issues) = client.search_issues(&jql, missing.len() as u32, "summary").await {
                    for issue in &issues {
                        if let (Some(key), Some(summary)) = (
                            issue["key"].as_str(),
                            issue["fields"]["summary"].as_str(),
                        ) {
                            map.insert(key.to_string(), summary.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(map)
}

/// Update test_run_status, executed_by, executed_at, and last_sync for a specific TC in the DB.
#[tauri::command]
pub async fn update_test_case_run_status(
    state: State<'_, AppState>,
    tc_key: String,
    te_jira_key: String,
    test_run_status: String,
    executed_by: String,
) -> Result<(), String> {
    let pool = get_pool!(state);
    sqlx::query(
        r#"UPDATE test_case
           SET test_run_status = ?, executed_by = ?, executed_at = NOW(), last_sync = NOW()
           WHERE tc_key = ? AND te_jira_key = ?"#,
    )
    .bind(&test_run_status)
    .bind(&executed_by)
    .bind(&tc_key)
    .bind(&te_jira_key)
    .execute(&pool)
    .await
    .map_err(|e| format!("Gagal update test_run_status: {e}"))?;
    Ok(())
}

/// Update assignee and last_sync for a specific TC in the DB.
#[tauri::command]
pub async fn update_test_case_assignee(
    state: State<'_, AppState>,
    tc_key: String,
    te_jira_key: String,
    assignee: String,
) -> Result<(), String> {
    let pool = get_pool!(state);
    sqlx::query(
        r#"UPDATE test_case
           SET assignee = ?, last_sync = NOW()
           WHERE tc_key = ? AND te_jira_key = ?"#,
    )
    .bind(&assignee)
    .bind(&tc_key)
    .bind(&te_jira_key)
    .execute(&pool)
    .await
    .map_err(|e| format!("Gagal update assignee: {e}"))?;
    Ok(())
}

/// Update execution_status and last_sync for a specific TE in the DB.
#[tauri::command]
pub async fn update_test_execution_status(
    state: State<'_, AppState>,
    te_jira_key: String,
    execution_status: String,
) -> Result<(), String> {
    let pool = get_pool!(state);
    sqlx::query(
        r#"UPDATE test_execution
           SET execution_status = ?, last_sync = NOW()
           WHERE te_jira_key = ?"#,
    )
    .bind(&execution_status)
    .bind(&te_jira_key)
    .execute(&pool)
    .await
    .map_err(|e| format!("Gagal update execution_status: {e}"))?;
    Ok(())
}

// ── User auth & token sync ────────────────────────────────────────────────────

/// Update jira_api_token and confluence_api_token for a user after saving settings.
#[tauri::command]
pub async fn update_user_tokens(
    state: State<'_, AppState>,
    pn: String,
    jira_api_token: String,
    confluence_api_token: String,
) -> Result<(), String> {
    let pool = get_pool!(state);
    sqlx::query(
        "UPDATE users SET jira_api_token = ?, confluence_api_token = ? WHERE pn = ?",
    )
    .bind(&jira_api_token)
    .bind(&confluence_api_token)
    .bind(&pn)
    .execute(&pool)
    .await
    .map_err(|e| format!("Gagal update token user: {e}"))?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct LoginResult {
    pub success: bool,
    pub role: Option<String>,
    pub jira_api_token: Option<String>,
    pub confluence_api_token: Option<String>,
    pub message: String,
}

#[tauri::command]
pub async fn login_user(
    state: State<'_, AppState>,
    pn: String,
    password: String,
) -> Result<LoginResult, String> {
    let pool = get_pool!(state);

    let row = sqlx::query(
        "SELECT password, role, jira_api_token, confluence_api_token FROM users WHERE pn = ?",
    )
    .bind(&pn)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("Gagal query users: {e}"))?;

    match row {
        None => Ok(LoginResult {
            success: false,
            role: None,
            jira_api_token: None,
            confluence_api_token: None,
            message: "PN tidak ditemukan. Silakan daftar terlebih dahulu.".into(),
        }),
        Some(r) => {
            let stored_hash: String = r.try_get("password").unwrap_or_default();
            let valid = bcrypt::verify(&password, &stored_hash).unwrap_or(false);
            if valid {
                let role: String = r.try_get("role").unwrap_or_default();
                let jira_token: Option<String> = r.try_get("jira_api_token").ok().filter(|s: &String| !s.is_empty());
                let conf_token: Option<String> = r.try_get("confluence_api_token").ok().filter(|s: &String| !s.is_empty());
                Ok(LoginResult {
                    success: true,
                    role: Some(role),
                    jira_api_token: jira_token,
                    confluence_api_token: conf_token,
                    message: "Login berhasil.".into(),
                })
            } else {
                Ok(LoginResult {
                    success: false,
                    role: None,
                    jira_api_token: None,
                    confluence_api_token: None,
                    message: "Password salah.".into(),
                })
            }
        }
    }
}

#[tauri::command]
pub async fn register_user(
    state: State<'_, AppState>,
    pn: String,
    password: String,
    role: String,
) -> Result<LoginResult, String> {
    let pool = get_pool!(state);

    // Cek apakah PN sudah terdaftar
    let exists: bool = sqlx::query("SELECT COUNT(*) as cnt FROM users WHERE pn = ?")
        .bind(&pn)
        .fetch_one(&pool)
        .await
        .map(|r| r.try_get::<i64, _>("cnt").unwrap_or(0) > 0)
        .map_err(|e| format!("Gagal cek users: {e}"))?;

    if exists {
        return Ok(LoginResult {
            success: false,
            role: None,
            jira_api_token: None,
            confluence_api_token: None,
            message: "PN sudah terdaftar.".into(),
        });
    }

    // Hash password dengan bcrypt cost 12
    let hashed = bcrypt::hash(&password, 12)
        .map_err(|e| format!("Gagal hash password: {e}"))?;

    sqlx::query("INSERT INTO users (pn, password, role) VALUES (?, ?, ?)")
        .bind(&pn)
        .bind(&hashed)
        .bind(&role)
        .execute(&pool)
        .await
        .map_err(|e| format!("Gagal registrasi: {e}"))?;

    Ok(LoginResult {
        success: true,
        role: Some(role),
        jira_api_token: None,
        confluence_api_token: None,
        message: "Registrasi berhasil.".into(),
    })
}
