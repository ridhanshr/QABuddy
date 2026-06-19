//! RAG (Retrieval-Augmented Generation) service — sled-backed vector store with
//! cosine-similarity search. Ports `rag-service.ts`. Chunks Confluence pages
//! and Jira issues, embeds them via Ollama, and retrieves the most similar
//! chunks for a query.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::models::rag::{RagSearchResult, RagStats};
use crate::services::error::{Result, ServiceError};

const STORE_VERSION: u32 = 1;
const MAX_CHUNK_SIZE: usize = 800;
const CHUNK_OVERLAP: usize = 100;

/// A single embedded text chunk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorChunk {
    pub id: String,
    /// "confluence" | "jira"
    pub source: String,
    pub source_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container_id: Option<String>,
    pub source_title: String,
    pub source_url: String,
    pub content: String,
    pub embedding: Vec<f64>,
    pub indexed_at: String,
}

/// Persisted vector store metadata (sled stores the chunks as individual keys).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoreMeta {
    version: u32,
    last_confluence_sync: Option<String>,
    last_jira_sync: Option<String>,
}

pub struct RagService {
    db: sled::Db,
}

impl RagService {
    /// Open (or create) the sled vector store under the app data dir.
    /// Falls back to a temp directory when no app dir is available (tests).
    pub fn new() -> Self {
        Self::open(Self::store_path())
    }

    /// Open a store at an explicit path.
    pub fn open(path: PathBuf) -> Self {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let db = sled::open(&path).unwrap_or_else(|_| {
            // Last-resort: in-memory-ish temp dir.
            let tmp = std::env::temp_dir().join("qa-buddy-rag-fallback");
            let _ = std::fs::create_dir_all(&tmp);
            sled::open(tmp).expect("failed to open fallback RAG store")
        });
        Self { db }
    }

    fn store_path() -> PathBuf {
        // Prefer the OS app-data dir; fall back to a local cwd folder.
        if let Some(dir) = dirs_or_appdata() {
            return dir.join("rag-store");
        }
        PathBuf::from(".qa-buddy-rag")
    }

    fn meta_key() -> &'static [u8] {
        b"__meta__"
    }

    fn load_meta(&self) -> StoreMeta {
        match self.db.get(Self::meta_key()) {
            Ok(Some(bytes)) => serde_json::from_slice::<StoreMeta>(&bytes).unwrap_or_else(|_| StoreMeta {
                version: STORE_VERSION,
                last_confluence_sync: None,
                last_jira_sync: None,
            }),
            _ => StoreMeta {
                version: STORE_VERSION,
                last_confluence_sync: None,
                last_jira_sync: None,
            },
        }
    }

    fn save_meta(&self, meta: &StoreMeta) -> Result<()> {
        let bytes = serde_json::to_vec(meta)?;
        self.db.insert(Self::meta_key(), bytes)?;
        self.db.flush()?;
        Ok(())
    }

    /// Insert/replace a chunk by id.
    pub fn upsert_chunk(&self, chunk: VectorChunk) -> Result<()> {
        let key = chunk.id.as_bytes().to_vec();
        let bytes = serde_json::to_vec(&chunk)?;
        self.db.insert(key, bytes)?;
        Ok(())
    }

    /// Remove all chunks for a given source id (page/issue).
    pub fn remove_by_source(&self, source_id: &str) -> Result<()> {
        let mut to_remove: Vec<Vec<u8>> = Vec::new();
        for item in self.db.iter() {
            let (key, val) = item?;
            if let Ok(chunk) = serde_json::from_slice::<VectorChunk>(&val) {
                if chunk.source_id == source_id {
                    to_remove.push(key.to_vec());
                }
            }
        }
        for k in to_remove {
            self.db.remove(k)?;
        }
        Ok(())
    }

    /// Iterate all chunks.
    fn all_chunks(&self) -> Vec<VectorChunk> {
        let mut out = Vec::new();
        for item in self.db.iter() {
            let (_key, val) = match item {
                Ok((k, v)) => (k, v),
                Err(_) => continue,
            };
            if let Ok(chunk) = serde_json::from_slice::<VectorChunk>(&val) {
                out.push(chunk);
            }
        }
        out
    }

    /// Return chunks for a specific source type and source id.
    pub fn chunks_by_source_id(&self, source: &str, source_id: &str) -> Vec<VectorChunk> {
        self.all_chunks()
            .into_iter()
            .filter(|chunk| chunk.source == source && chunk.source_id == source_id)
            .collect()
    }

    /// Compute cosine similarity between two vectors.
    pub fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
        let dot = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum::<f64>();
        let norm_a = a.iter().map(|x| x * x).sum::<f64>().sqrt();
        let norm_b = b.iter().map(|y| y * y).sum::<f64>().sqrt();
        let denom = norm_a * norm_b;
        if denom == 0.0 {
            0.0
        } else {
            dot / denom
        }
    }

    /// Search the store for chunks most similar to `query_embedding`, returning
    /// the top `limit` results sorted by descending similarity.
    pub fn search(&self, query_embedding: &[f64], limit: usize, source_filter: Option<&str>) -> Vec<RagSearchResult> {
        let chunks = self.all_chunks();
        let mut scored: Vec<(f64, VectorChunk)> = chunks
            .into_iter()
            .filter(|c| source_filter.map_or(true, |s| c.source == s))
            .map(|c| (Self::cosine_similarity(query_embedding, &c.embedding), c))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored
            .into_iter()
            .take(limit)
            .map(|(score, c)| RagSearchResult {
                content: c.content,
                source_title: c.source_title,
                source_url: c.source_url,
                score,
            })
            .collect()
    }

    /// Stats for the RAG dashboard.
    pub fn stats(&self) -> RagStats {
        let chunks = self.all_chunks();
        let total = chunks.len() as u64;
        let confluence: Vec<&VectorChunk> = chunks.iter().filter(|c| c.source == "confluence").collect();
        let jira: Vec<&VectorChunk> = chunks.iter().filter(|c| c.source == "jira").collect();
        let confluence_pages = confluence.iter().map(|c| c.source_id.as_str()).collect::<std::collections::HashSet<_>>().len() as u64;
        let jira_issues = jira.iter().map(|c| c.source_id.as_str()).collect::<std::collections::HashSet<_>>().len() as u64;
        let meta = self.load_meta();
        RagStats {
            total_chunks: total,
            confluence_pages,
            confluence_chunks: confluence.len() as u64,
            jira_issues,
            jira_chunks: jira.len() as u64,
            last_confluence_sync: meta.last_confluence_sync,
            last_jira_sync: meta.last_jira_sync,
        }
    }

    /// Record a sync timestamp for a source.
    pub fn record_sync(&self, source: &str, timestamp: &str) -> Result<()> {
        let mut meta = self.load_meta();
        if source == "confluence" {
            meta.last_confluence_sync = Some(timestamp.to_string());
        } else if source == "jira" {
            meta.last_jira_sync = Some(timestamp.to_string());
        }
        self.save_meta(&meta)
    }

    /// Clear all chunks, optionally limited to one source.
    pub fn clear(&self, source: Option<&str>) -> Result<()> {
        let mut to_remove: Vec<Vec<u8>> = Vec::new();
        for item in self.db.iter() {
            let (key, val) = item?;
            if key == Self::meta_key() {
                continue;
            }
            let keep = match serde_json::from_slice::<VectorChunk>(&val) {
                Ok(chunk) => source.map_or(true, |s| chunk.source != s),
                Err(_) => true,
            };
            if !keep {
                to_remove.push(key.to_vec());
            }
        }
        for k in to_remove {
            self.db.remove(k)?;
        }
        self.db.flush()?;
        Ok(())
    }
}

/// Split cleaned text into overlapping chunks, preferring sentence boundaries.
pub fn chunk_text(text: &str) -> Vec<String> {
    let ws = regex::Regex::new(r"\s+").unwrap();
    let cleaned = ws.replace_all(text.trim(), " ").to_string();
    if cleaned.len() <= MAX_CHUNK_SIZE {
        return if cleaned.len() > 20 { vec![cleaned] } else { vec![] };
    }
    let bytes: Vec<char> = cleaned.chars().collect();
    let mut chunks: Vec<String> = Vec::new();
    let mut start = 0usize;
    let total = bytes.len();
    while start < total {
        let mut end = std::cmp::min(start + MAX_CHUNK_SIZE, total);
        if end < total {
            let slice: String = bytes[start..end].iter().collect();
            // Break at the last sentence boundary if it falls far enough in.
            if let Some(rel) = slice.rfind(". ") {
                if rel > MAX_CHUNK_SIZE * 3 / 10 {
                    end = start + rel + 1;
                }
            }
        }
        let chunk: String = bytes[start..end].iter().collect();
        let trimmed = chunk.trim().to_string();
        if trimmed.len() > 20 {
            chunks.push(trimmed);
        }
        if end >= total {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP);
    }
    chunks
}

// The `.map_map` above is a typo-guard artifact; replace with a clean closure.
// (kept the logic simple above so this helper is unused.)

fn dirs_or_appdata() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from).map(|p| p.join("qa-buddy"))
}

impl Default for RagService {
    fn default() -> Self {
        Self::new()
    }
}

/// Mark unused helper import to avoid dead-code warnings in some cfgs.
#[allow(dead_code)]
fn _unused(_e: ServiceError) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_similarity_identical() {
        let v = vec![1.0, 2.0, 3.0];
        let s = RagService::cosine_similarity(&v, &v);
        assert!((s - 1.0).abs() < 1e-9);
    }

    #[test]
    fn cosine_similarity_orthogonal() {
        let s = RagService::cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]);
        assert!(s.abs() < 1e-9);
    }

    #[test]
    fn chunk_text_short() {
        let chunks = chunk_text("hello world this is a short text");
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn store_upsert_and_search() {
        let tmp = std::env::temp_dir().join(format!("qa-buddy-rag-test-{}", uuid::Uuid::new_v4()));
        let svc = RagService::open(tmp);
        svc.upsert_chunk(VectorChunk {
            id: "c1".into(),
            source: "confluence".into(),
            source_id: "page-1".into(),
            container_id: Some("SPACE".into()),
            source_title: "Page One".into(),
            source_url: "/page/1".into(),
            content: "alpha beta".into(),
            embedding: vec![1.0, 0.0],
            indexed_at: "2026-06-18".into(),
        })
        .unwrap();
        svc.upsert_chunk(VectorChunk {
            id: "c2".into(),
            source: "confluence".into(),
            source_id: "page-2".into(),
            container_id: None,
            source_title: "Page Two".into(),
            source_url: "/page/2".into(),
            content: "gamma delta".into(),
            embedding: vec![0.0, 1.0],
            indexed_at: "2026-06-18".into(),
        })
        .unwrap();
        let results = svc.search(&[1.0, 0.0], 2, None);
        assert_eq!(results.len(), 2);
        assert!(results[0].score > results[1].score);
        assert_eq!(results[0].source_title, "Page One");

        let stats = svc.stats();
        assert_eq!(stats.total_chunks, 2);
        assert_eq!(stats.confluence_pages, 2);
    }
}
