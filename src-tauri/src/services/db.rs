use sqlx::{mysql::MySqlPoolOptions, MySql, Pool};
use std::time::Duration;

pub type DbPool = Pool<MySql>;

// Compile-time defaults injected via CI secrets (QABUDDY_DB_* env vars at build time).
// Falls back to empty string if not set — runtime env vars / .env still take precedence.
const DEFAULT_DB_HOST: &str = env!("QABUDDY_DB_HOST");
const DEFAULT_DB_PORT: &str = env!("QABUDDY_DB_PORT");
const DEFAULT_DB_USER: &str = env!("QABUDDY_DB_USER");
const DEFAULT_DB_PASSWORD: &str = env!("QABUDDY_DB_PASSWORD");
const DEFAULT_DB_NAME: &str = env!("QABUDDY_DB_NAME");

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("Database connection failed: {0}")]
    Connection(#[from] sqlx::Error),
    #[error("Environment variable missing: {0}")]
    EnvVar(String),
}

fn resolve_database_url() -> Result<String, DbError> {
    // 1. Explicit DATABASE_URL env var (runtime) takes top priority
    if let Ok(url) = std::env::var("DATABASE_URL") {
        if !url.is_empty() {
            return Ok(url);
        }
    }

    // 2. Individual runtime env vars
    let host = std::env::var("DB_HOST").ok().filter(|s| !s.is_empty());
    let port = std::env::var("DB_PORT").ok().filter(|s| !s.is_empty());
    let user = std::env::var("DB_USER").ok().filter(|s| !s.is_empty());
    let password = std::env::var("DB_PASSWORD").ok().filter(|s| !s.is_empty());
    let name = std::env::var("DB_NAME").ok().filter(|s| !s.is_empty());

    // 3. Fall back to compile-time defaults baked in at CI build
    let host = host.unwrap_or_else(|| DEFAULT_DB_HOST.to_string());
    let port = port.unwrap_or_else(|| DEFAULT_DB_PORT.to_string());
    let user = user.unwrap_or_else(|| DEFAULT_DB_USER.to_string());
    let password = password.unwrap_or_else(|| DEFAULT_DB_PASSWORD.to_string());
    let name = name.unwrap_or_else(|| DEFAULT_DB_NAME.to_string());

    if host.is_empty() || user.is_empty() || name.is_empty() {
        return Err(DbError::EnvVar(
            "DB credentials not configured (set QABUDDY_DB_HOST, QABUDDY_DB_USER, QABUDDY_DB_NAME at build time)".into(),
        ));
    }

    let encoded_password = urlencoding::encode(&password).into_owned();
    Ok(format!("mysql://{}:{}@{}:{}/{}", user, encoded_password, host, port, name))
}

pub async fn create_pool() -> Result<DbPool, DbError> {
    let max_conn: u32 = std::env::var("DB_POOL_MAX_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);

    let timeout_secs: u64 = std::env::var("DB_CONNECT_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);

    let url = resolve_database_url()?;

    let pool = MySqlPoolOptions::new()
        .max_connections(max_conn)
        .acquire_timeout(Duration::from_secs(timeout_secs))
        .connect(&url)
        .await?;

    log::info!("MySQL connection pool established (max_conn={})", max_conn);
    Ok(pool)
}
