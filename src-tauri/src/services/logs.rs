use std::path::PathBuf;

use crate::services::error::Result;
use tauri::{AppHandle, Manager};

pub struct LogsService {
    app_handle: AppHandle,
    cache: Vec<serde_json::Value>,
}

impl LogsService {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
            cache: Vec::new(),
        }
    }

    fn logs_path(&self) -> PathBuf {
        self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_default()
            .join("qa-buddy-logs.json")
    }

    pub fn get_logs(&self) -> Vec<serde_json::Value> {
        if !self.cache.is_empty() {
            return self.cache.clone();
        }
        let path = self.logs_path();
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
                return parsed;
            }
        }
        Vec::new()
    }

    pub fn save_logs(&mut self, logs: &[serde_json::Value]) -> Result<()> {
        let path = self.logs_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("tmp");
        let data = serde_json::to_string_pretty(logs)?;
        std::fs::write(&tmp, data)?;
        std::fs::rename(&tmp, &path)?;
        self.cache = logs.to_vec();
        Ok(())
    }
}
