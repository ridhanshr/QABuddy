use thiserror::Error;

#[derive(Error, Debug)]
pub enum ServiceError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("API error: {0}")]
    Api(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Sled error: {0}")]
    Sled(#[from] sled::Error),
}

impl Clone for ServiceError {
    fn clone(&self) -> Self {
        match self {
            ServiceError::Config(s) => ServiceError::Config(s.clone()),
            ServiceError::Http(e) => ServiceError::Api(e.to_string()),
            ServiceError::Json(e) => ServiceError::Api(e.to_string()),
            ServiceError::Auth(s) => ServiceError::Auth(s.clone()),
            ServiceError::NotFound(s) => ServiceError::NotFound(s.clone()),
            ServiceError::Api(s) => ServiceError::Api(s.clone()),
            ServiceError::Io(e) => ServiceError::Api(e.to_string()),
            ServiceError::Sled(e) => ServiceError::Api(e.to_string()),
        }
    }
}

pub type Result<T> = std::result::Result<T, ServiceError>;
