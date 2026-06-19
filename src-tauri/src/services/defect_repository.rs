use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::models::app_config::AppConfig;
use crate::models::defect::{
    DefectRecord, DefectRepositoryStats, DuplicateCandidate, DuplicateRelation, JiraIssueSource,
    JiraProjectSource, SearchFilters, SyncState,
};
use crate::services::error::{Result, ServiceError};
use crate::services::jira::JiraService;
use crate::services::text_utils::strip_html;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoreData {
    sources: Vec<JiraProjectSource>,
    defects: Vec<DefectRecord>,
    duplicate_relations: Vec<DuplicateRelation>,
    sync_states: Vec<SyncState>,
}

#[derive(Debug, Clone)]
struct Normalizer;

impl Normalizer {
    fn normalize(text: &str) -> String {
        text.to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn sanitize_for_search(text: &str) -> String {
        Self::normalize(text)
    }

    fn extract_search_text(summary: &str, description: &str, steps: &str) -> String {
        format!("{summary} {description} {steps}")
    }

    fn compute_fingerprint(summary: &str, description: &str) -> String {
        let mut words = Self::normalize(&format!("{summary} {description}"))
            .split_whitespace()
            .filter(|w| w.len() > 2)
            .map(|w| w.to_string())
            .collect::<Vec<_>>();
        words.sort();
        words.dedup();
        words.join(" ")
    }
}

#[derive(Debug, Clone)]
struct SearchIndex {
    defects: Vec<DefectRecord>,
    inverted: HashMap<String, HashSet<String>>,
}

impl SearchIndex {
    fn new() -> Self {
        Self {
            defects: Vec::new(),
            inverted: HashMap::new(),
        }
    }

    fn build(&mut self, defects: Vec<DefectRecord>) {
        self.defects = defects;
        self.inverted.clear();
        for defect in &self.defects {
            for term in Self::tokenize(&defect.search_text) {
                self.inverted
                    .entry(term)
                    .or_default()
                    .insert(defect.id.clone());
            }
        }
    }

    fn tokenize(text: &str) -> Vec<String> {
        text.to_lowercase()
            .split_whitespace()
            .filter(|w| w.len() > 1)
            .map(|w| w.to_string())
            .collect()
    }

    fn search(&self, filters: &SearchFilters) -> (Vec<DuplicateCandidate>, Vec<DefectRecord>) {
        let query_terms = Self::tokenize(&Normalizer::sanitize_for_search(&filters.query));
        let mut candidate_ids: Option<HashSet<String>> = if query_terms.is_empty() {
            None
        } else {
            let mut ids = HashSet::new();
            for term in &query_terms {
                if let Some(set) = self.inverted.get(term) {
                    ids.extend(set.iter().cloned());
                }
            }
            Some(ids)
        };

        let filter_ids = |source: &[DefectRecord], predicate: &dyn Fn(&DefectRecord) -> bool| -> HashSet<String> {
            source
                .iter()
                .filter(|d| predicate(d))
                .map(|d| d.id.clone())
                .collect()
        };

        let apply_filter = |current: Option<HashSet<String>>, next: HashSet<String>| -> Option<HashSet<String>> {
            match current {
                Some(curr) => Some(curr.intersection(&next).cloned().collect()),
                None => Some(next),
            }
        };

        if !filters.project_keys.is_empty() {
            let set = filters
                .project_keys
                .iter()
                .map(|s| s.to_lowercase())
                .collect::<HashSet<_>>();
            candidate_ids = apply_filter(candidate_ids, filter_ids(&self.defects, &|d| set.contains(&d.source_project_key.to_lowercase())));
        }
        if !filters.issue_types.is_empty() {
            let set = filters
                .issue_types
                .iter()
                .map(|s| s.to_lowercase())
                .collect::<HashSet<_>>();
            candidate_ids = apply_filter(candidate_ids, filter_ids(&self.defects, &|d| set.contains(&d.issue_type.to_lowercase())));
        }
        if !filters.statuses.is_empty() {
            let set = filters
                .statuses
                .iter()
                .map(|s| s.to_lowercase())
                .collect::<HashSet<_>>();
            candidate_ids = apply_filter(candidate_ids, filter_ids(&self.defects, &|d| set.contains(&d.status.to_lowercase())));
        }
        if !filters.components.is_empty() {
            let set = filters
                .components
                .iter()
                .map(|s| s.to_lowercase())
                .collect::<HashSet<_>>();
            candidate_ids = apply_filter(candidate_ids, filter_ids(&self.defects, &|d| set.contains(&d.component.to_lowercase())));
        }
        if !filters.versions.is_empty() {
            let set = filters
                .versions
                .iter()
                .map(|s| s.to_lowercase())
                .collect::<HashSet<_>>();
            candidate_ids = apply_filter(candidate_ids, filter_ids(&self.defects, &|d| set.contains(&d.version.to_lowercase())));
        }
        if !filters.severities.is_empty() {
            let set = filters
                .severities
                .iter()
                .map(|s| s.to_lowercase())
                .collect::<HashSet<_>>();
            candidate_ids = apply_filter(candidate_ids, filter_ids(&self.defects, &|d| set.contains(&d.severity.to_lowercase())));
        }

        let selected: Vec<DefectRecord> = match candidate_ids {
            Some(ids) => self
                .defects
                .iter()
                .filter(|d| ids.contains(&d.id))
                .cloned()
                .collect(),
            None => self.defects.clone(),
        };

        if query_terms.is_empty() {
            return (Vec::new(), selected);
        }

        let mut candidates: Vec<DuplicateCandidate> = Vec::new();
        for defect in &selected {
            let mut score = 0.0f64;
            let mut reasons = Vec::new();
            let title_terms = Self::tokenize(&defect.normalized_title);
            let desc_terms = Self::tokenize(&defect.normalized_description);
            let search_terms = Self::tokenize(&defect.search_text);
            let fingerprint_terms = Self::tokenize(&defect.similarity_fingerprint);
            let query_text = Normalizer::sanitize_for_search(&filters.query);

            let title_match = query_terms.iter().filter(|t| title_terms.contains(t)).count();
            let desc_match = query_terms.iter().filter(|t| desc_terms.contains(t)).count();
            let search_match = query_terms.iter().filter(|t| search_terms.contains(t)).count();
            let fingerprint_match = query_terms.iter().filter(|t| fingerprint_terms.contains(t)).count();

            if title_match > 0 {
                score += (title_match as f64 / query_terms.len() as f64) * 45.0;
                reasons.push(format!("Judul cocok ({title_match}/{})", query_terms.len()));
            }
            if desc_match > 0 {
                score += (desc_match as f64 / query_terms.len() as f64) * 25.0;
            }
            if search_match > 0 {
                score += (search_match as f64 / query_terms.len() as f64) * 10.0;
            }
            if fingerprint_match > 0 {
                score += (fingerprint_match as f64 / query_terms.len().max(1) as f64) * 15.0;
            }
            if !query_text.is_empty() && !defect.normalized_title.is_empty() {
                let title = Normalizer::sanitize_for_search(&defect.normalized_title);
                if title.contains(&query_text) || query_text.contains(&title) {
                    score += 15.0;
                    reasons.push("Judul mengandung frasa serupa".into());
                }
            }
            if !defect.component.is_empty()
                && filters
                    .components
                    .iter()
                    .any(|c| c.eq_ignore_ascii_case(&defect.component))
            {
                score += 10.0;
                reasons.push(format!("Component sama: {}", defect.component));
            }
            if !defect.version.is_empty()
                && filters
                    .versions
                    .iter()
                    .any(|v| v.eq_ignore_ascii_case(&defect.version))
            {
                score += 5.0;
                reasons.push(format!("Version sama: {}", defect.version));
            }

            if score > 0.0 {
                candidates.push(DuplicateCandidate {
                    defect: defect.clone(),
                    score: score.min(100.0),
                    reasons,
                });
            }
        }

        candidates.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        candidates.truncate(20);
        (candidates, selected)
    }
}

pub struct DefectRepositoryService {
    app_handle: AppHandle,
    index: SearchIndex,
}

impl DefectRepositoryService {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
            index: SearchIndex::new(),
        }
    }

    fn data_dir(&self) -> PathBuf {
        self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_default()
            .join("defect-repository")
    }

    fn file_path(&self) -> PathBuf {
        self.data_dir().join("data.json")
    }

    fn init_data(&self) -> StoreData {
        StoreData::default()
    }

    fn normalize_project_key(&self, project_key: &str) -> String {
        project_key.trim().to_uppercase()
    }

    fn defect_identity(&self, source_project_key: &str, source_issue_key: &str) -> String {
        format!(
            "{}::{}",
            self.normalize_project_key(source_project_key),
            source_issue_key.trim().to_uppercase()
        )
    }

    fn load(&self) -> StoreData {
        let path = self.file_path();
        match std::fs::read_to_string(path) {
            Ok(raw) => serde_json::from_str::<StoreData>(&raw).unwrap_or_else(|_| self.init_data()),
            Err(_) => self.init_data(),
        }
    }

    fn save(&self, data: &StoreData) -> Result<()> {
        let path = self.file_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("tmp");
        let raw = serde_json::to_string_pretty(data)?;
        std::fs::write(&tmp, raw)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

    fn normalize_source(&self, source: &JiraProjectSource) -> JiraProjectSource {
        JiraProjectSource {
            project_key: self.normalize_project_key(&source.project_key),
            project_name: source.project_name.trim().to_string(),
            auto_sync_enabled: source.auto_sync_enabled.or(Some(false)),
            auto_sync_days: Some(
                source
                    .auto_sync_days
                    .clone()
                    .filter(|days| !days.is_empty())
                    .unwrap_or_else(|| vec![1, 2, 3, 4, 5]),
            ),
            auto_sync_time: Some(
                source
                    .auto_sync_time
                    .clone()
                    .filter(|t| !t.trim().is_empty())
                    .unwrap_or_else(|| "09:00".to_string()),
            ),
            issue_types: Some(
                source
                    .issue_types
                    .clone()
                    .filter(|items| !items.is_empty())
                    .unwrap_or_else(|| vec!["Bug".into(), "Task".into(), "Defect".into()]),
            ),
            last_auto_sync_at: source.last_auto_sync_at.clone(),
            ..source.clone()
        }
    }

    fn normalize_source_mut(&self, source: &mut JiraProjectSource) {
        *source = self.normalize_source(source);
    }

    pub async fn get_sources(&self) -> Result<Vec<JiraProjectSource>> {
        Ok(self.load().sources)
    }

    pub async fn save_source(&self, source: JiraProjectSource) -> Result<Vec<JiraProjectSource>> {
        let mut data = self.load();
        let mut normalized = source.clone();
        if normalized.id.trim().is_empty() {
            normalized.id = Uuid::new_v4().to_string();
        }
        self.normalize_source_mut(&mut normalized);
        let normalized_key = self.normalize_project_key(&normalized.project_key);
        let key_idx = data
            .sources
            .iter()
            .position(|s| self.normalize_project_key(&s.project_key) == normalized_key);
        let id_idx = data.sources.iter().position(|s| s.id == normalized.id);

        if let Some(idx) = key_idx {
            let existing = data.sources[idx].clone();
            data.sources[idx] = JiraProjectSource {
                id: existing.id,
                project_key: existing.project_key,
                ..normalized
            };
            if let Some(id_idx) = id_idx {
                if id_idx != idx && id_idx < data.sources.len() {
                    data.sources.remove(id_idx);
                }
            }
        } else if let Some(idx) = id_idx {
            data.sources[idx] = normalized;
        } else {
            data.sources.push(normalized);
        }
        self.save(&data)?;
        Ok(data.sources)
    }

    pub async fn delete_source(&self, id: String) -> Result<Vec<JiraProjectSource>> {
        let mut data = self.load();
        if let Some(source) = data.sources.iter().find(|s| s.id == id).cloned() {
            let normalized_key = self.normalize_project_key(&source.project_key);
            let removed_defects: HashSet<String> = data
                .defects
                .iter()
                .filter(|d| self.normalize_project_key(&d.source_project_key) == normalized_key)
                .map(|d| d.id.clone())
                .collect();
            data.defects.retain(|d| self.normalize_project_key(&d.source_project_key) != normalized_key);
            data.duplicate_relations
                .retain(|r| !removed_defects.contains(&r.primary_defect_id) && !removed_defects.contains(&r.duplicate_defect_id));
            data.sync_states.retain(|s| self.normalize_project_key(&s.project_key) != normalized_key);
            data.sources
                .retain(|s| s.id != id && self.normalize_project_key(&s.project_key) != normalized_key);
        } else {
            data.sources.retain(|s| s.id != id);
        }
        self.save(&data)?;
        Ok(data.sources)
    }

    fn build_issue_source(&self, issue: &Value, fallback_project_key: &str) -> Option<JiraIssueSource> {
        let fields = issue.get("fields")?;
        let key = issue.get("key").and_then(|v| v.as_str())?.to_string();
        let summary = fields.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let description_value = fields.get("description").cloned().unwrap_or(Value::Null);
        let description = if let Some(s) = description_value.as_str() {
            s.to_string()
        } else if description_value.is_object() {
            strip_html(&description_value.to_string())
        } else {
            String::new()
        };
        let steps = extract_steps_from_description(&description);
        let issue_type = fields["issuetype"]["name"].as_str().unwrap_or("").to_string();
        let status = fields["status"]["name"].as_str().unwrap_or("").to_string();
        let priority = fields["priority"]["name"].as_str().unwrap_or("").to_string();
        let components = fields["components"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|v| v.get("name").and_then(|x| x.as_str()).map(String::from))
            .collect::<Vec<_>>()
            .join(", ");
        let versions = fields["fixVersions"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|v| v.get("name").and_then(|x| x.as_str()).map(String::from))
            .collect::<Vec<_>>()
            .join(", ");
        let labels = fields["labels"].as_array().cloned().unwrap_or_default();
        let labels = labels
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect::<Vec<_>>();
        let created_at = fields["created"].as_str().unwrap_or("").to_string();
        let updated_at = fields["updated"].as_str().unwrap_or("").to_string();
        Some(JiraIssueSource {
            id: key.clone(),
            jira_issue_key: key,
            project_key: fields["project"]["key"]
                .as_str()
                .unwrap_or(fallback_project_key)
                .to_string(),
            issue_type,
            summary,
            description: description.clone(),
            steps_to_reproduce: steps.steps_to_reproduce,
            expected_result: steps.expected_result,
            actual_result: steps.actual_result,
            status,
            priority: priority.clone(),
            severity: priority,
            component: components,
            version: versions,
            reporter: fields["reporter"]["displayName"].as_str().unwrap_or("").to_string(),
            assignee: fields["assignee"]["displayName"].as_str().unwrap_or("").to_string(),
            labels,
            resolution: fields["resolution"]["name"].as_str().unwrap_or("").to_string(),
            created_at,
            updated_at,
            comments: String::new(),
            attachments_metadata: String::new(),
        })
    }

    fn map_to_defect_record(&self, issue: &JiraIssueSource, existing_id: Option<String>) -> DefectRecord {
        DefectRecord {
            id: existing_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            source_issue_key: issue.jira_issue_key.clone(),
            source_project_key: issue.project_key.clone(),
            issue_type: issue.issue_type.clone(),
            normalized_title: Normalizer::normalize(&issue.summary),
            normalized_description: Normalizer::normalize(&format!(
                "{} {} {} {}",
                issue.description, issue.steps_to_reproduce, issue.expected_result, issue.actual_result
            )),
            search_text: Normalizer::extract_search_text(&issue.summary, &issue.description, &issue.steps_to_reproduce),
            status: issue.status.clone(),
            component: issue.component.clone(),
            version: issue.version.clone(),
            severity: issue.severity.clone(),
            priority: issue.priority.clone(),
            similarity_fingerprint: Normalizer::compute_fingerprint(&issue.summary, &issue.description),
            embedding: None,
            created_at: issue.created_at.clone(),
            updated_at: issue.updated_at.clone(),
        }
    }

    pub async fn sync_source(
        &mut self,
        config: &AppConfig,
        project_key: &str,
    ) -> Result<(u32, u32)> {
        let mut data = self.load();
        let normalized_project_key = self.normalize_project_key(project_key);
        let mut source = data
            .sources
            .iter()
            .find(|s| self.normalize_project_key(&s.project_key) == normalized_project_key)
            .cloned()
            .ok_or_else(|| ServiceError::NotFound(format!("Source {project_key} not found")))?;
        let sync_state = data
            .sync_states
            .iter()
            .find(|s| self.normalize_project_key(&s.project_key) == normalized_project_key)
            .cloned();
        let cursor = sync_state.as_ref().map(|s| s.last_cursor.clone()).unwrap_or_default();

        source.sync_status = crate::models::defect::DefectSyncStatus::Syncing;
        self.upsert_source(&mut data, source.clone());
        self.save(&data)?;

        let jira = JiraService::new();
        let client = jira.client(&config.jira)?;
        let issue_types = source.issue_types.clone().unwrap_or_default();
        let selected_types = if issue_types.is_empty() {
            vec!["Bug".to_string(), "Task".to_string(), "Defect".to_string()]
        } else {
            issue_types
        };
        let type_filter = selected_types
            .iter()
            .map(|t| format!("issuetype = \"{}\"", t))
            .collect::<Vec<_>>()
            .join(" OR ");
        let jql = if cursor.trim().is_empty() {
            format!("project = \"{project_key}\" AND ({type_filter}) ORDER BY updated ASC")
        } else {
            format!("project = \"{project_key}\" AND ({type_filter}) AND updated >= \"{cursor}\" ORDER BY updated ASC")
        };

        let mut issues: Vec<Value> = Vec::new();
        let mut start_at = 0u32;
        loop {
            let page: Value = client
                .api
                .get_json(
                    "/search",
                    &[
                        ("jql", jql.clone()),
                        ("startAt", start_at.to_string()),
                        ("maxResults", "100".to_string()),
                        (
                            "fields",
                            "summary,description,status,priority,issuetype,created,updated,assignee,reporter,resolution,labels,components,fixVersions"
                                .to_string(),
                        ),
                    ],
                )
                .await?;
            let page_issues = page["issues"].as_array().cloned().unwrap_or_default();
            let total = page["total"].as_u64().unwrap_or(page_issues.len() as u64) as usize;
            if page_issues.is_empty() {
                break;
            }
            let page_issue_count = page_issues.len();
            issues.extend(page_issues);
            if issues.len() >= total || page_issue_count < 100 {
                break;
            }
            start_at += 100;
        }

        let mut existing_by_identity = HashMap::new();
        for defect in &data.defects {
            existing_by_identity.insert(
                self.defect_identity(&defect.source_project_key, &defect.source_issue_key),
                defect.clone(),
            );
        }

        let mut indexed = 0u32;
        let mut skipped = 0u32;
        let mut new_defects = Vec::new();
        for issue in issues {
            if let Some(issue_source) = self.build_issue_source(&issue, &normalized_project_key) {
                let identity = self.defect_identity(&issue_source.project_key, &issue_source.jira_issue_key);
                if let Some(existing) = existing_by_identity.get(&identity) {
                    if existing.updated_at == issue_source.updated_at {
                        skipped += 1;
                        continue;
                    }
                }
                let existing_id = existing_by_identity.get(&identity).map(|d| d.id.clone());
                new_defects.push(self.map_to_defect_record(&issue_source, existing_id));
                indexed += 1;
            }
        }

        if !new_defects.is_empty() {
            data.defects.retain(|d| self.normalize_project_key(&d.source_project_key) != normalized_project_key);
            data.defects.extend(new_defects);
        }

        let now = Utc::now().to_rfc3339();
        data.sync_states.retain(|s| self.normalize_project_key(&s.project_key) != normalized_project_key);
        data.sync_states.push(SyncState {
            id: Uuid::new_v4().to_string(),
            project_key: normalized_project_key.clone(),
            last_cursor: if cursor.is_empty() { now.clone() } else { cursor },
            last_sync_at: now.clone(),
            last_sync_status: "success".into(),
            error_message: String::new(),
        });

        source.last_synced_at = Some(now);
        source.sync_status = crate::models::defect::DefectSyncStatus::Success;
        self.upsert_source(&mut data, source);
        self.save(&data)?;
        Ok((indexed, skipped))
    }

    fn upsert_source(&self, data: &mut StoreData, source: JiraProjectSource) {
        if let Some(idx) = data.sources.iter().position(|s| s.id == source.id) {
            data.sources[idx] = source;
        } else if let Some(idx) = data
            .sources
            .iter()
            .position(|s| self.normalize_project_key(&s.project_key) == self.normalize_project_key(&source.project_key))
        {
            data.sources[idx] = source;
        } else {
            data.sources.push(source);
        }
    }

    pub async fn get_defect(&self, id: String) -> Result<Option<DefectRecord>> {
        Ok(self.load().defects.into_iter().find(|d| d.id == id))
    }

    pub async fn get_duplicate_relations(&self, defect_id: String) -> Result<Vec<DuplicateRelation>> {
        Ok(self
            .load()
            .duplicate_relations
            .into_iter()
            .filter(|r| r.primary_defect_id == defect_id || r.duplicate_defect_id == defect_id)
            .collect())
    }

    pub async fn mark_duplicate(
        &self,
        relation: OmitIdRelation,
    ) -> Result<DuplicateRelation> {
        let mut data = self.load();
        let full = DuplicateRelation {
            id: Uuid::new_v4().to_string(),
            created_at: Utc::now().to_rfc3339(),
            primary_defect_id: relation.primary_defect_id,
            duplicate_defect_id: relation.duplicate_defect_id,
            reason: relation.reason,
            confidence_score: relation.confidence_score,
            created_by: relation.created_by,
        };
        data.duplicate_relations.push(full.clone());
        self.save(&data)?;
        Ok(full)
    }

    pub async fn remove_duplicate_link(&self, id: String) -> Result<()> {
        let mut data = self.load();
        data.duplicate_relations.retain(|r| r.id != id);
        self.save(&data)
    }

    pub async fn get_stats(&self) -> Result<DefectRepositoryStats> {
        let data = self.load();
        let mut defects_per_project = BTreeMap::<String, u64>::new();
        let mut duplicates_per_project = BTreeMap::<String, u64>::new();
        let mut components = BTreeMap::<String, u64>::new();
        let mut issue_types = BTreeMap::<String, u64>::new();
        let duplicate_ids: HashSet<String> = data
            .duplicate_relations
            .iter()
            .flat_map(|r| [r.primary_defect_id.clone(), r.duplicate_defect_id.clone()])
            .collect();

        for defect in &data.defects {
            *defects_per_project.entry(defect.source_project_key.clone()).or_insert(0) += 1;
            if !defect.component.is_empty() {
                for comp in defect.component.split(',').map(|c| c.trim()).filter(|c| !c.is_empty()) {
                    *components.entry(comp.to_string()).or_insert(0) += 1;
                }
            }
            *issue_types.entry(defect.issue_type.clone()).or_insert(0) += 1;
            if duplicate_ids.contains(&defect.id) {
                *duplicates_per_project.entry(defect.source_project_key.clone()).or_insert(0) += 1;
            }
        }

        Ok(DefectRepositoryStats {
            total_defects: data.defects.len() as u64,
            total_duplicates: data.duplicate_relations.len() as u64,
            defects_per_project: defects_per_project
                .into_iter()
                .map(|(name, count)| crate::models::defect::NameCount { name, count })
                .collect(),
            duplicates_per_project: duplicates_per_project
                .into_iter()
                .map(|(name, count)| crate::models::defect::NameCount { name, count })
                .collect(),
            top_components: components
                .into_iter()
                .map(|(name, count)| crate::models::defect::NameCount { name, count })
                .collect(),
            top_issue_types: issue_types
                .into_iter()
                .map(|(name, count)| crate::models::defect::NameCount { name, count })
                .collect(),
        })
    }

    pub async fn reindex_all(&mut self) -> Result<()> {
        let data = self.load();
        self.index.build(data.defects);
        Ok(())
    }

    pub async fn search_defects(
        &mut self,
        filters: SearchFilters,
    ) -> Result<(Vec<DuplicateCandidate>, Vec<DefectRecord>)> {
        let data = self.load();
        self.index.build(data.defects);
        Ok(self.index.search(&filters))
    }

    pub async fn find_duplicate_candidates(
        &mut self,
        filters: SearchFilters,
    ) -> Result<Vec<DuplicateCandidate>> {
        let (candidates, _) = self.search_defects(filters).await?;
        Ok(candidates)
    }

    pub async fn get_sources_and_reindex(&mut self) -> Result<()> {
        let data = self.load();
        self.index.build(data.defects);
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct OmitIdRelation {
    pub primary_defect_id: String,
    pub duplicate_defect_id: String,
    pub reason: String,
    pub confidence_score: f64,
    pub created_by: String,
}

#[derive(Debug, Clone)]
struct ExtractedSteps {
    steps_to_reproduce: String,
    expected_result: String,
    actual_result: String,
}

fn extract_steps_from_description(description: &str) -> ExtractedSteps {
    let steps_regex = regex::Regex::new(r"(?is)steps?\s*(?:to\s+)?reproduce:?([\s\S]*?)(?=\n\s*(expected\s+result|actual\s+result|environment|additional|$))").unwrap();
    let expected_regex = regex::Regex::new(r"(?is)expected\s+result:?([\s\S]*?)(?=\n\s*(actual\s+result|environment|additional|steps?\s*(?:to\s+)?reproduce|$))").unwrap();
    let actual_regex = regex::Regex::new(r"(?is)actual\s+result:?([\s\S]*?)(?=\n\s*(expected\s+result|environment|additional|steps?\s*(?:to\s+)?reproduce|$))").unwrap();

    let steps = steps_regex
        .captures(description)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
        .unwrap_or_default();
    let expected = expected_regex
        .captures(description)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
        .unwrap_or_default();
    let actual = actual_regex
        .captures(description)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
        .unwrap_or_default();

    ExtractedSteps {
        steps_to_reproduce: steps,
        expected_result: expected,
        actual_result: actual,
    }
}
