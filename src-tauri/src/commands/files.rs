use std::path::{Path, PathBuf};

use tauri::command;
use base64::Engine as _;

#[command]
pub async fn read_local_file(file_path: String, base_dir: Option<String>) -> Result<serde_json::Value, String> {
    let resolved = resolve_path(&file_path, base_dir.as_deref())?;
    let data = std::fs::read(&resolved).map_err(|e| e.to_string())?;
    let name = resolved
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&file_path)
        .to_string();
    Ok(serde_json::json!({
        "name": name,
        "data": base64::engine::general_purpose::STANDARD.encode(data),
    }))
}

#[command]
pub async fn get_directory_name(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    path.parent()
        .and_then(|p| p.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Directory tidak ditemukan".to_string())
}

fn resolve_path(file_path: &str, base_dir: Option<&str>) -> Result<PathBuf, String> {
    let path = Path::new(file_path);
    if path.is_absolute() || base_dir.is_none() {
        return Ok(path.to_path_buf());
    }
    Ok(Path::new(base_dir.unwrap()).join(path))
}
