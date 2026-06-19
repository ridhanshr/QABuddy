use std::io::Write;
use std::path::Path;
use std::process::Command;

use crate::models::rag::OcrResult;

pub struct OcrService;

impl OcrService {
    pub fn new() -> Self {
        Self
    }

    pub fn extract_text_from_file(&self, file_path: &str) -> Option<OcrResult> {
        let path = Path::new(file_path);
        if !path.exists() {
            return None;
        }

        let mut command = Command::new("tesseract");
        command.arg(file_path).arg("stdout").arg("-l").arg("eng+ind");

        if let Ok(cwd) = std::env::current_dir() {
            let eng = cwd.join("eng.traineddata");
            let ind = cwd.join("ind.traineddata");
            if eng.exists() && ind.exists() {
                command.env("TESSDATA_PREFIX", cwd);
            }
        }

        let output = command.output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.len() < 10 {
            return None;
        }

        Some(OcrResult {
            text,
            confidence: 0.0,
            source_attachment: path
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or(file_path)
                .to_string(),
            source_page_id: String::new(),
        })
    }

    pub fn extract_text_from_bytes(&self, bytes: &[u8], file_name_hint: &str) -> Option<OcrResult> {
        let mut temp_path = std::env::temp_dir();
        let temp_name = format!(
            "qa-buddy-ocr-{}-{}",
            uuid::Uuid::new_v4(),
            Path::new(file_name_hint)
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("attachment.png")
        );
        temp_path.push(temp_name);

        let mut file = std::fs::File::create(&temp_path).ok()?;
        file.write_all(bytes).ok()?;
        let result = self.extract_text_from_file(temp_path.to_str()?);
        let _ = std::fs::remove_file(&temp_path);
        result
    }
}
