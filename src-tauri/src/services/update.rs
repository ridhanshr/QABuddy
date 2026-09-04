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
                // Store the tag without the "v" prefix — the UI renders it as
                // "v{latestVersion}" and is_newer_version expects bare semver.
                let latest_version = release["tag_name"]
                    .as_str()
                    .unwrap_or(current_version)
                    .trim_start_matches(['v', 'V'])
                    .to_string();
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
        let (asset_name, download_url) =
            pick_installer_asset(&assets, std::env::consts::OS, std::env::consts::ARCH)?;
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
        let installer_path = temp_dir.join(&asset_name);
        let mut file = std::fs::File::create(&installer_path)?;
        let mut downloaded = 0u64;

        while let Some(chunk) = resp.chunk().await.map_err(ServiceError::from)? {
            use std::io::Write;
            file.write_all(&chunk)?;
            downloaded += chunk.len() as u64;
            let progress = if total > 0 { downloaded as f64 / total as f64 * 100.0 } else { 0.0 };
            on_progress(DownloadProgress { progress, downloaded, total });
        }

        // Windows cannot replace the running executable. Keep a detached shell
        // alive long enough for Tauri to exit before starting the installer.
        #[cfg(target_os = "windows")]
        {
            let command = format!(
                "timeout /t 2 /nobreak > NUL & start \"\" \"{}\"",
                installer_path.display()
            );
            Command::new("cmd")
                .args(["/C", &command])
                .spawn()
                .map_err(ServiceError::from)?;
            app_handle.exit(0);
            return Ok(());
        }

        // macOS mounts the DMG; it is not an executable.
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(&installer_path)
                .spawn()
                .map_err(ServiceError::from)?;
            let _ = app_handle;
            Ok(())
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let _ = app_handle;
            Err(ServiceError::NotFound(
                "Auto-update belum didukung untuk sistem operasi ini".into(),
            ))
        }
    }
}

/// Pick the release asset matching the user's OS/architecture.
/// Returns `(asset_name, browser_download_url)`.
///   - windows → first `.exe` (NSIS setup)
///   - macos   → `.dmg` matching the CPU arch (`aarch64` / `x64`)
fn pick_installer_asset(
    assets: &[serde_json::Value],
    os: &str,
    arch: &str,
) -> Result<(String, String)> {
    let wanted = |name: &str| -> bool {
        match os {
            "windows" => name.to_lowercase().ends_with(".exe"),
            "macos" => {
                let dmg_arch = if arch == "aarch64" { "aarch64" } else { "x64" };
                name.to_lowercase().ends_with(".dmg") && name.contains(dmg_arch)
            }
            _ => false,
        }
    };
    for asset in assets {
        let Some(name) = asset["name"].as_str() else { continue };
        if !wanted(name) {
            continue;
        }
        let url = asset["browser_download_url"].as_str().unwrap_or("");
        if !url.is_empty() {
            return Ok((name.to_string(), url.to_string()));
        }
    }
    let hint = match os {
        "windows" => "installer Windows (.exe)".to_string(),
        "macos" => format!("installer macOS (.dmg) untuk arsitektur {arch}"),
        other => format!("installer untuk sistem operasi {other}"),
    };
    Err(ServiceError::NotFound(format!(
        "Tidak ditemukan {hint} di rilis terbaru. Unduh manual dari halaman Releases."
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release_assets() -> Vec<serde_json::Value> {
        vec![
            json!({"name": "QA.Buddy_1.1.4_aarch64.dmg", "browser_download_url": "https://x/aarch64.dmg"}),
            json!({"name": "QA.Buddy_1.1.4_x64-setup.exe", "browser_download_url": "https://x/setup.exe"}),
            json!({"name": "QA.Buddy_1.1.4_x64.dmg", "browser_download_url": "https://x/x64.dmg"}),
            json!({"name": "QA.Buddy_1.1.4_x64_en-US.msi", "browser_download_url": "https://x/setup.msi"}),
        ]
    }

    #[test]
    fn is_newer_version_compares_semver_with_v_prefix() {
        let svc = UpdateService::new();
        assert!(svc.is_newer_version("1.1.3", "1.1.4"));
        assert!(svc.is_newer_version("1.1.3", "v1.1.4"));
        assert!(svc.is_newer_version("1.1.3", "2.0.0"));
        assert!(svc.is_newer_version("1.1", "1.1.1"));
        assert!(!svc.is_newer_version("1.1.4", "v1.1.3"));
        assert!(!svc.is_newer_version("1.1.3", "v1.1.3"));
        assert!(!svc.is_newer_version("1.1.3", "v1.1.2"));
    }

    #[test]
    fn pick_installer_asset_windows_picks_exe() {
        let (name, url) = pick_installer_asset(&release_assets(), "windows", "x86_64").unwrap();
        assert_eq!(name, "QA.Buddy_1.1.4_x64-setup.exe");
        assert_eq!(url, "https://x/setup.exe");
    }

    #[test]
    fn pick_installer_asset_macos_picks_dmg_per_arch() {
        let (name, _) = pick_installer_asset(&release_assets(), "macos", "aarch64").unwrap();
        assert_eq!(name, "QA.Buddy_1.1.4_aarch64.dmg");
        let (name, _) = pick_installer_asset(&release_assets(), "macos", "x86_64").unwrap();
        assert_eq!(name, "QA.Buddy_1.1.4_x64.dmg");
    }

    #[test]
    fn pick_installer_asset_errors_without_match() {
        assert!(pick_installer_asset(&[], "windows", "x86_64").is_err());
        assert!(pick_installer_asset(&release_assets(), "linux", "x86_64").is_err());
        // macOS x64 must not pick the aarch64 dmg
        let only_arm = vec![json!({"name": "QA.Buddy_aarch64.dmg", "browser_download_url": "https://x/a.dmg"})];
        assert!(pick_installer_asset(&only_arm, "macos", "x86_64").is_err());
    }
}
