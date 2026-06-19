use std::process::Command;
use std::time::Duration;

use crate::models::misc::{DownloadProgress, UpdateInfo};
use crate::services::error::{Result, ServiceError};
use reqwest::Client;
use tauri::AppHandle;

pub struct UpdateService {
    cached_update_info: Option<UpdateInfo>,
    repo_url: String,
}

impl UpdateService {
    pub fn new() -> Self {
        Self {
            cached_update_info: None,
            repo_url: "https://api.github.com/repos/ridhanshr/QABuddy/releases/latest".to_string(),
        }
    }

    pub fn get_cached_status(&self) -> Option<UpdateInfo> {
        self.cached_update_info.clone()
    }

    pub fn is_newer_version(&self, current: &str, latest: &str) -> bool {
        let clean_current = current.trim_start_matches(['v', 'V']).trim();
        let clean_latest = latest.trim_start_matches(['v', 'V']).trim();
        let current_parts: Vec<i64> = clean_current
            .split('.')
            .map(|p| p.parse::<i64>().unwrap_or(0))
            .collect();
        let latest_parts: Vec<i64> = clean_latest
            .split('.')
            .map(|p| p.parse::<i64>().unwrap_or(0))
            .collect();
        let max_len = current_parts.len().max(latest_parts.len());
        for i in 0..max_len {
            let cur = *current_parts.get(i).unwrap_or(&0);
            let lat = *latest_parts.get(i).unwrap_or(&0);
            if lat > cur {
                return true;
            }
            if cur > lat {
                return false;
            }
        }
        false
    }

    async fn github_release(&self) -> Result<serde_json::Value> {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(ServiceError::from)?;
        let resp = client
            .get(&self.repo_url)
            .header("User-Agent", "qa-buddy-desktop")
            .header("Cache-Control", "no-cache")
            .send()
            .await
            .map_err(ServiceError::from)?;
        let status = resp.status();
        let body = resp.text().await.map_err(ServiceError::from)?;
        if !status.is_success() {
            return Err(ServiceError::Api(format!("HTTP {status}: {body}")));
        }
        serde_json::from_str(&body).map_err(ServiceError::from)
    }

    pub async fn check_for_updates(&mut self, current_version: &str) -> UpdateInfo {
        let checked_at = chrono::Utc::now().to_rfc3339();
        match self.github_release().await {
            Ok(release) => {
                let latest_version = release["tag_name"].as_str().unwrap_or(current_version).to_string();
                let url = release["html_url"].as_str().unwrap_or("https://github.com/ridhanshr/QABuddy/releases").to_string();
                let release_notes = release["body"].as_str().unwrap_or("").to_string();
                let published_at = release["published_at"].as_str().unwrap_or("").to_string();
                let update_available = self.is_newer_version(current_version, &latest_version);
                let info = UpdateInfo {
                    update_available,
                    current_version: current_version.to_string(),
                    latest_version,
                    release_notes,
                    url,
                    published_at,
                    checked_at,
                    error: None,
                };
                self.cached_update_info = Some(info.clone());
                info
            }
            Err(err) => {
                let cached = self.cached_update_info.clone().unwrap_or_default();
                let info = UpdateInfo {
                    update_available: false,
                    current_version: current_version.to_string(),
                    latest_version: cached.latest_version,
                    release_notes: cached.release_notes,
                    url: if cached.url.is_empty() {
                        "https://github.com/ridhanshr/QABuddy/releases".to_string()
                    } else {
                        cached.url
                    },
                    published_at: cached.published_at,
                    checked_at,
                    error: Some(format!("Gagal memeriksa update: {err}")),
                };
                if self.cached_update_info.is_none() {
                    self.cached_update_info = Some(info.clone());
                }
                info
            }
        }
    }

    pub async fn download_and_install_update(
        &mut self,
        app_handle: &AppHandle,
        on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
    ) -> Result<()> {
        let release = self.github_release().await?;
        let assets = release["assets"].as_array().cloned().unwrap_or_default();
        let exe_asset = assets
            .iter()
            .find(|asset| asset["name"].as_str().map(|n| n.ends_with(".exe")).unwrap_or(false))
            .ok_or_else(|| ServiceError::NotFound("Tidak ditemukan installer Windows (.exe) di rilis terbaru.".into()))?;
        let download_url = exe_asset["browser_download_url"].as_str().unwrap_or("");
        let asset_name = exe_asset["name"].as_str().unwrap_or("qa-buddy-installer.exe");
        if download_url.is_empty() {
            return Err(ServiceError::NotFound("Download URL installer tidak tersedia".into()));
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(ServiceError::from)?;
        let mut resp = client
            .get(download_url)
            .header("User-Agent", "qa-buddy-desktop")
            .send()
            .await
            .map_err(ServiceError::from)?;
        if !resp.status().is_success() {
            return Err(ServiceError::Api(format!("HTTP {}", resp.status())));
        }

        let total = resp.content_length().unwrap_or(0);
        let temp_dir = std::env::temp_dir();
        let installer_path = temp_dir.join(asset_name);
        let mut file = std::fs::File::create(&installer_path)?;
        let mut downloaded = 0u64;

        while let Some(chunk) = resp.chunk().await.map_err(ServiceError::from)? {
            use std::io::Write;
            file.write_all(&chunk)?;
            downloaded += chunk.len() as u64;
            let progress = if total > 0 { downloaded as f64 / total as f64 * 100.0 } else { 0.0 };
            on_progress(DownloadProgress { progress, downloaded, total });
        }

        let _ = Command::new(&installer_path)
            .spawn()
            .map_err(ServiceError::from)?;
        let _ = app_handle;
        Ok(())
    }
}
