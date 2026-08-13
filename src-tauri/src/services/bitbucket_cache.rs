use crate::models::bitbucket::BitbucketGenerateResponse;
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

    pub fn make_key(project_key: &str, repo_slug: &str, pr_id: u64, commit_hash: &str, model: &str, files: &[String]) -> String {
        // Include the active model + file selection so two generations with
        // different models/selections don't serve each other's cached result.
        let mut file_part: Vec<String> = files.to_vec();
        file_part.sort();
        format!(
            "{}:{}:PR_{}:{}:{}:{}",
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
                    if let Some(oldest) = mem.iter().min_by_key(|(_, (_, at))| *at).map(|(k, _)| k.clone()) {
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
