use crate::models::bitbucket::{BitbucketExplainResponse, BitbucketGenerateResponse};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const CACHE_TTL: Duration = Duration::from_secs(30 * 60);
const CACHE_MAX_ENTRIES: usize = 200;

pub struct BitbucketCacheService {
    memory_cache: Mutex<HashMap<String, (BitbucketGenerateResponse, Instant)>>,
}

impl BitbucketCacheService {
    pub fn new() -> Self {
        Self {
            memory_cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn make_key(
        schema_version: &str,
        project_key: &str,
        repo_slug: &str,
        pr_id: u64,
        commit_hash: &str,
        model: &str,
        files: &[String],
    ) -> String {
        // Include the active model + file selection so two generations with
        // different models/selections don't serve each other's cached result.
        // `schema_version` ensures results from an older prompt/schema are
        // never served once the generation prompt or JSON schema changes.
        let mut file_part: Vec<String> = files.to_vec();
        file_part.sort();
        file_part.dedup();
        format!(
            "{}:{}:{}:PR_{}:{}:{}:{}",
            schema_version,
            project_key.to_lowercase(),
            repo_slug.to_lowercase(),
            pr_id,
            commit_hash,
            model.trim(),
            file_part.join(",")
        )
    }

    pub fn get(&self, cache_key: &str) -> Option<BitbucketGenerateResponse> {
        let mut mem = self.memory_cache.lock().ok()?;
        if let Some((res, fetched_at)) = mem.get(cache_key) {
            if fetched_at.elapsed() < CACHE_TTL {
                let mut clone = res.clone();
                clone.cache_hit = true;
                return Some(clone);
            }
            mem.remove(cache_key);
        }
        None
    }

    pub fn set(&self, cache_key: &str, value: BitbucketGenerateResponse) {
        if let Ok(mut mem) = self.memory_cache.lock() {
            if mem.len() >= CACHE_MAX_ENTRIES {
                // Evict expired entries first; if still full, drop the oldest.
                let now = Instant::now();
                mem.retain(|_, (_, at)| now.duration_since(*at) < CACHE_TTL);
                if mem.len() >= CACHE_MAX_ENTRIES {
                    if let Some(oldest) = mem
                        .iter()
                        .min_by_key(|(_, (_, at))| *at)
                        .map(|(k, _)| k.clone())
                    {
                        mem.remove(&oldest);
                    }
                }
            }
            mem.insert(cache_key.to_string(), (value, Instant::now()));
        }
    }
}

static GLOBAL_BITBUCKET_CACHE_INSTANCE: OnceLock<BitbucketCacheService> = OnceLock::new();

pub fn get_global_bitbucket_cache() -> &'static BitbucketCacheService {
    GLOBAL_BITBUCKET_CACHE_INSTANCE.get_or_init(BitbucketCacheService::new)
}

/// In-memory TTL cache for AI Code Explainer results, keyed by
/// namespace:file:line-range:mode:model so Force Re-Analyze / repeat explains
/// reuse the previous answer within the TTL.
pub struct BitbucketExplainCacheService {
    memory_cache: Mutex<HashMap<String, (BitbucketExplainResponse, Instant)>>,
}

impl BitbucketExplainCacheService {
    pub fn new() -> Self {
        Self {
            memory_cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn make_key(
        namespace: &str,
        file_path: &str,
        start_line: Option<usize>,
        end_line: Option<usize>,
        mode: &str,
        model: &str,
    ) -> String {
        format!(
            "{namespace}:{file_path}:{start:?}:{end:?}:{mode}:{model}",
            start = start_line,
            end = end_line
        )
    }

    pub fn get(&self, cache_key: &str) -> Option<BitbucketExplainResponse> {
        let mut mem = self.memory_cache.lock().ok()?;
        if let Some((res, at)) = mem.get(cache_key) {
            if at.elapsed() < CACHE_TTL {
                return Some(res.clone());
            }
            mem.remove(cache_key);
        }
        None
    }

    pub fn set(&self, cache_key: &str, value: BitbucketExplainResponse) {
        if let Ok(mut mem) = self.memory_cache.lock() {
            if mem.len() >= CACHE_MAX_ENTRIES {
                let now = Instant::now();
                mem.retain(|_, (_, at)| now.duration_since(*at) < CACHE_TTL);
                if mem.len() >= CACHE_MAX_ENTRIES {
                    if let Some(oldest) = mem
                        .iter()
                        .min_by_key(|(_, (_, at))| *at)
                        .map(|(k, _)| k.clone())
                    {
                        mem.remove(&oldest);
                    }
                }
            }
            mem.insert(cache_key.to_string(), (value, Instant::now()));
        }
    }
}

static GLOBAL_BITBUCKET_EXPLAIN_CACHE: OnceLock<BitbucketExplainCacheService> = OnceLock::new();

pub fn get_global_bitbucket_explain_cache() -> &'static BitbucketExplainCacheService {
    GLOBAL_BITBUCKET_EXPLAIN_CACHE.get_or_init(BitbucketExplainCacheService::new)
}
