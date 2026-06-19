//! RAG + OCR models. Shapes mirror `src/shared/types.ts` and serialise as
//! camelCase.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RagStats {
    pub total_chunks: u64,
    pub confluence_pages: u64,
    pub confluence_chunks: u64,
    pub jira_issues: u64,
    pub jira_chunks: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_confluence_sync: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_jira_sync: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexProgress {
    /// "confluence" | "jira"
    pub source: String,
    /// "fetching" | "embedding" | "done" | "error"
    pub status: String,
    pub message: String,
    pub current: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResult {
    pub content: String,
    pub source_title: String,
    pub source_url: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub text: String,
    pub confidence: f64,
    pub source_attachment: String,
    pub source_page_id: String,
}
