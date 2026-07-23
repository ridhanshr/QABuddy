use sqlx::{mysql::MySqlPoolOptions, MySql, Pool};
use std::time::Duration;

pub type DbPool = Pool<MySql>;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("Database connection failed: {0}")]
    Connection(#[from] sqlx::Error),
    #[error("Environment variable missing: {0}")]
    EnvVar(String),
}

/// Build the DATABASE_URL from individual env vars as fallback,
/// or use DATABASE_URL directly if set.
fn resolve_database_url() -> Result<String, DbError> {
    // Prefer explicit DATABASE_URL
    if let Ok(url) = std::env::var("DATABASE_URL") {
        if !url.is_empty() {
            return Ok(url);
        }
    }

    // Assemble from parts
    let host = std::env::var("DB_HOST")
        .map_err(|_| DbError::EnvVar("DB_HOST".into()))?;
    let port = std::env::var("DB_PORT").unwrap_or_else(|_| "3306".into());
    let user = std::env::var("DB_USER")
        .map_err(|_| DbError::EnvVar("DB_USER".into()))?;
    let password = std::env::var("DB_PASSWORD")
        .map_err(|_| DbError::EnvVar("DB_PASSWORD".into()))?;
    let name = std::env::var("DB_NAME")
        .map_err(|_| DbError::EnvVar("DB_NAME".into()))?;

    // URL-encode the password (handles special chars like @)
    let encoded_password = urlencoding::encode(&password).into_owned();

    Ok(format!("mysql://{}:{}@{}:{}/{}", user, encoded_password, host, port, name))
}

/// Create a MySQL connection pool. Called once at app startup.
/// Reads config from environment variables (loaded from .env by dotenvy).
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
