use crate::models::bitbucket::BitbucketGenerateResponse;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

pub struct BitbucketCacheService {
    memory_cache: Mutex<HashMap<String, BitbucketGenerateResponse>>,
}

impl BitbucketCacheService {
    pub fn new() -> Self {
        Self {
            memory_cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn make_key(project_key: &str, repo_slug: &str, pr_id: u64, commit_hash: &str) -> String {
        format!("{}:{}:PR_{}:{}", project_key.to_lowercase(), repo_slug.to_lowercase(), pr_id, commit_hash)
    }

    pub fn get(&self, cache_key: &str) -> Option<BitbucketGenerateResponse> {
        let mem = self.memory_cache.lock().ok()?;
        if let Some(res) = mem.get(cache_key) {
            let mut clone = res.clone();
            clone.cache_hit = true;
            return Some(clone);
        }
        None
    }

    pub fn set(&self, cache_key: &str, value: BitbucketGenerateResponse) {
        if let Ok(mut mem) = self.memory_cache.lock() {
            mem.insert(cache_key.to_string(), value);
        }
    }
}

static GLOBAL_BITBUCKET_CACHE_INSTANCE: OnceLock<BitbucketCacheService> = OnceLock::new();

pub fn get_global_bitbucket_cache() -> &'static BitbucketCacheService {
    GLOBAL_BITBUCKET_CACHE_INSTANCE.get_or_init(BitbucketCacheService::new)
}
