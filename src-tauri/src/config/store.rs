use std::path::PathBuf;
use crate::models::app_config::AppConfig;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug)]
pub struct ConfigStore {
    app_handle: AppHandle,
    cached_config: Option<AppConfig>,
}

impl ConfigStore {
    pub fn new(app_handle: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            app_handle: app_handle.clone(),
            cached_config: None,
        })
    }

    fn config_path(&self) -> PathBuf {
        let app_dir = self.app_handle.path().app_data_dir().unwrap_or_default();
        app_dir.join("qa-buddy-config.json")
    }

    pub async fn load(&mut self) -> Result<AppConfig, Box<dyn std::error::Error>> {
        let path = self.config_path();
        if !path.exists() {
            let config = AppConfig::default();
            self.cached_config = Some(config.clone());
            return Ok(config);
        }
        let data = std::fs::read_to_string(&path)?;
        let config: AppConfig = serde_json::from_str(&data)?;
        self.cached_config = Some(config.clone());
        Ok(config)
    }

    pub async fn save(&mut self, config: &AppConfig) -> Result<AppConfig, Box<dyn std::error::Error>> {
        let path = self.config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp_path = path.with_extension("tmp");
        let data = serde_json::to_string_pretty(config)?;
        std::fs::write(&tmp_path, &data)?;
        std::fs::rename(&tmp_path, &path)?;
        self.cached_config = Some(config.clone());
        Ok(config.clone())
    }
}
