use std::path::PathBuf;

use crate::services::error::Result;
use tauri::{AppHandle, Manager};

pub struct LogsService {
    app_handle: AppHandle,
    cache: Vec<serde_json::Value>,
}

impl LogsService {
    pub fn new(app_handle: &AppHandle) -> Self {
        let mut svc = Self {
            app_handle: app_handle.clone(),
            cache: Vec::new(),
        };
        svc.migrate_from_electron();
        svc
    }

    fn logs_path(&self) -> PathBuf {
        self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_default()
            .join("qa-buddy-logs.json")
    }

    /// One-time migration: copy logs from the old Electron app data dir
    /// (`qa-buddy-desktop`) to the new Tauri app data dir (`com.qabuddy.desktop`)
    /// if the Tauri path doesn't exist yet.
    fn migrate_from_electron(&mut self) {
        let tauri_path = self.logs_path();
        if tauri_path.exists() {
            return;
        }
        // Try the sibling directory used by the Electron build
        if let Some(parent) = tauri_path.parent().and_then(|p| p.parent()) {
            let electron_path = parent.join("qa-buddy-desktop").join("qa-buddy-logs.json");
            if electron_path.exists() {
                if let Ok(raw) = std::fs::read_to_string(&electron_path) {
                    if let Ok(parsed) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
                        // Ensure dest dir exists
                        if let Some(dest_parent) = tauri_path.parent() {
                            let _ = std::fs::create_dir_all(dest_parent);
                        }
                        if std::fs::copy(&electron_path, &tauri_path).is_ok() {
                            self.cache = parsed;
                            log::info!("[logs] migrated {} entries from Electron data dir", self.cache.len());
                        }
                    }
                }
            }
        }
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
