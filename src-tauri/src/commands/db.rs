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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbUqaProject {
    pub uqa_key: String,
    pub project_name: String,
    pub assignee: Option<String>,
    pub product_tester: Option<String>,
    pub status: Option<String>,
    pub start_sit: Option<String>,
    pub finish_sit: Option<String>,
    pub start_uat: Option<String>,
    pub last_sync: Option<String>,
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
                (uqa_key, project_name, assignee, product_tester, status, start_qa, finish_qa, start_uat, last_sync)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                project_name   = VALUES(project_name),
                assignee       = VALUES(assignee),
                product_tester = VALUES(product_tester),
                status         = VALUES(status),
                start_qa       = VALUES(start_qa),
                finish_qa      = VALUES(finish_qa),
                start_uat      = VALUES(start_uat),
                last_sync      = NOW()
            "#,
        )
        .bind(&p.uqa_key)
        .bind(&p.project_name)
        .bind(p.assignee.as_deref().unwrap_or(""))
        .bind(p.product_tester.as_deref().unwrap_or(""))
        .bind(p.status.as_deref().unwrap_or(""))
        .bind(p.start_sit.as_deref())
        .bind(p.finish_sit.as_deref())
        .bind(p.start_uat.as_deref())
        .execute(&pool)
        .await
        .map_err(|e| format!("Gagal upsert uqa_project {}: {e}", p.uqa_key))?;
    }

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
