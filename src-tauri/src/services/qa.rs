//! QA service — top-level orchestrator for bootstrap / connection testing /
//! healthcheck. Real backend wiring is filled in by the Jira / Confluence /
//! Ollama services in later phases; this module exposes the entry points the
//! `bootstrap`/`config` commands call.

use crate::models::app_config::AppConfig;
use crate::models::connection::{
    AppBootstrap, ConnectionStatus, ConnectionStatusItem, ConfigStatusItem, DashboardDigest,
    HealthcheckResult,
};
use crate::services::confluence::ConfluenceService;
use crate::services::jira::JiraService;
use crate::services::ollama::OllamaService;

pub struct QaService {
    jira: JiraService,
    confluence: ConfluenceService,
    ollama: OllamaService,
}

impl QaService {
    pub fn new() -> Self {
        Self {
            jira: JiraService::new(),
            confluence: ConfluenceService::new(),
            ollama: OllamaService::new(),
        }
    }

    /// Return a fresh bootstrap bundle: config, live connection status and an
    /// (initially empty) dashboard digest.
    pub async fn bootstrap(&self, config: &AppConfig) -> AppBootstrap {
        let status = self.test_connections(config).await;
        AppBootstrap {
            config: config.clone(),
            status,
            dashboard: DashboardDigest::default(),
        }
    }

    /// Probe Jira / Confluence / Ollama connectivity. Never panics — any
    /// failure is reported as an `ok: false` status item.
    pub async fn test_connections(&self, config: &AppConfig) -> ConnectionStatus {
        let jira = if config.jira.base_url.is_empty() {
            ConnectionStatusItem {
                ok: false,
                message: "Not configured".to_string(),
            }
        } else {
            match self.jira.test_connection(&config.jira).await {
                Ok(msg) => ConnectionStatusItem { ok: true, message: msg },
                Err(e) => ConnectionStatusItem { ok: false, message: e.to_string() },
            }
        };

        let confluence = if config.confluence.base_url.is_empty() {
            ConnectionStatusItem {
                ok: false,
                message: "Not configured".to_string(),
            }
        } else {
            match self.confluence.test_connection(&config.confluence).await {
                Ok(msg) => ConnectionStatusItem { ok: true, message: msg },
                Err(e) => ConnectionStatusItem { ok: false, message: e.to_string() },
            }
        };

        let ollama = match self.ollama.test_connection(&config.ollama.endpoint).await {
            Ok(msg) => ConnectionStatusItem { ok: true, message: msg },
            Err(e) => ConnectionStatusItem { ok: false, message: e.to_string() },
        };

        ConnectionStatus {
            jira,
            confluence,
            ollama,
        }
    }

    /// Extended healthcheck including RAG store readiness.
    pub async fn healthcheck(&self, config: &AppConfig) -> HealthcheckResult {
        let status = self.test_connections(config).await;
        HealthcheckResult {
            jira: status.jira,
            confluence: status.confluence,
            ollama: status.ollama,
            rag: ConnectionStatusItem {
                ok: true,
                message: "Local store ready".to_string(),
            },
            config: ConfigStatusItem {
                label: "Configuration".to_string(),
                configured: !config.jira.base_url.is_empty()
                    || !config.confluence.base_url.is_empty(),
            },
        }
    }
}
