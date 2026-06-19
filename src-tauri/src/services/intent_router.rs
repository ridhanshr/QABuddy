//! Intent router — classifies a natural-language query into a route
//! (`jira` | `confluence` | `mixed` | `clarify`). Ports `intent-router.ts`.

use crate::models::chat::{IntentClassification, IntentRoute};

const JIRA_KEYWORDS: &[&str] = &[
    "tiket", "ticket", "issue", "bug", "task", "story", "epic", "status", "priority", "prioritas",
    "assignee", "reporter", "sprint", "jql", "open", "closed", "resolve", "in progress",
    "ready for qa", "done", "to do", "backlog", "in analyze",
];

const STATUS_KEYWORDS: &[&str] = &[
    "in progress", "open", "closed", "done", "to do", "ready for qa", "resolved", "reopened",
    "blocked", "in review", "in analysis", "in testing", "ready for review",
];

const CONFLUENCE_KEYWORDS: &[&str] = &[
    "dokumen", "document", "dokumentasi", "documentation", "halaman", "page", "confluence",
    "knowledge base", "sop", "requirement", "acceptance criteria", "ringkasan", "summary",
    "jelaskan", "explain", "penjelasan", "panduan", "guide", "wiki",
];

const MIXED_INDICATORS: &[&str] = &[
    " dan ", " & ", " serta ", " plus ", "gabung", "combined", "hybrid", "both", "all",
];

pub struct IntentRouter;

impl IntentRouter {
    pub fn new() -> Self {
        Self
    }

    /// Classify a user query into a route + confidence + reason.
    pub fn classify(&self, query: &str) -> IntentClassification {
        let lower = query.to_lowercase();
        let lower = lower.trim();

        if lower.is_empty() {
            return IntentClassification {
                route: IntentRoute::Clarify,
                confidence: 0.0,
                reason: "Query kosong".into(),
                detected_keywords: vec![],
                project_key: None,
                status_hint: None,
            };
        }

        let mut detected: Vec<String> = Vec::new();
        let mut jira_score: f64 = 0.0;
        let mut confluence_score: f64 = 0.0;

        for kw in JIRA_KEYWORDS {
            if lower.contains(kw) {
                jira_score += 2.0;
                detected.push((*kw).to_string());
            }
        }
        for kw in STATUS_KEYWORDS {
            if lower.contains(kw) {
                jira_score += 3.0;
                if !detected.contains(&(*kw).to_string()) {
                    detected.push((*kw).to_string());
                }
            }
        }

        let explicit_jira = regex::Regex::new(
            r"(?i)(?:cari|tampilkan|list|daftar|cek)\w*\s+.*(?:jql|tiket|ticket|issue|bug|jira)",
        )
        .unwrap()
        .is_match(lower);
        if explicit_jira {
            jira_score += 5.0;
        }
        let has_issue_key = regex::Regex::new(r"[A-Z]{2,}-\d{1,9}").unwrap().is_match(query);
        if has_issue_key {
            jira_score += 5.0;
        }

        for kw in CONFLUENCE_KEYWORDS {
            if lower.contains(kw) {
                confluence_score += 2.0;
                if !detected.contains(&(*kw).to_string()) {
                    detected.push((*kw).to_string());
                }
            }
        }
        let confluence_url = regex::Regex::new(r"(?i)/wiki/|confluence\.").unwrap().is_match(lower);
        if confluence_url {
            confluence_score += 5.0;
        }

        let status_hint = extract_status_hint(lower);
        let project_key = extract_project_key(query);

        let is_mixed = MIXED_INDICATORS.iter().any(|ind| lower.contains(ind));
        let (route, confidence, reason) = if is_mixed && jira_score >= 2.0 && confluence_score >= 2.0 {
            (
                IntentRoute::Mixed,
                ((jira_score + confluence_score) / 15.0_f64).min(1.0_f64),
                "Mixed intent: both Jira and Confluence keywords detected".to_string(),
            )
        } else if jira_score > confluence_score {
            let top = detected.iter().take(4).cloned().collect::<Vec<_>>().join(", ");
            (
                IntentRoute::Jira,
                (jira_score / 12.0_f64).min(1.0_f64),
                format!("Jira-dominant: detected {top}"),
            )
        } else if confluence_score > jira_score {
            let top = detected.iter().take(4).cloned().collect::<Vec<_>>().join(", ");
            (
                IntentRoute::Confluence,
                (confluence_score / 12.0_f64).min(1.0_f64),
                format!("Confluence-dominant: detected {top}"),
            )
        } else if jira_score > 0.0 && (jira_score - confluence_score).abs() < f64::EPSILON {
            (
                IntentRoute::Mixed,
                0.5,
                "Equal Jira and Confluence signals".to_string(),
            )
        } else {
            (
                IntentRoute::Clarify,
                0.0,
                "No clear Jira or Confluence intent detected, need clarification".to_string(),
            )
        };

        IntentClassification {
            route,
            confidence,
            reason,
            detected_keywords: detected,
            project_key,
            status_hint,
        }
    }

    pub fn is_jira_intent(&self, query: &str) -> bool {
        matches!(self.classify(query).route, IntentRoute::Jira)
    }

    pub fn is_confluence_intent(&self, query: &str) -> bool {
        matches!(self.classify(query).route, IntentRoute::Confluence)
    }

    pub fn needs_clarification(&self, query: &str) -> bool {
        matches!(self.classify(query).route, IntentRoute::Clarify)
    }
}

fn extract_status_hint(lower: &str) -> Option<String> {
    for st in STATUS_KEYWORDS {
        if lower.contains(st) {
            return Some((*st).to_string());
        }
    }
    let re = regex::Regex::new(r"(?i)(?:status|tiket)\s+(\w+(?:\s+\w+){0,2})").unwrap();
    re.captures(lower).map(|c| c[1].trim().to_string())
}

fn extract_project_key(query: &str) -> Option<String> {
    let re = regex::Regex::new(r#"(?i)project\s*['"]?([A-Z0-9]{2,10})['"]?"#).unwrap();
    re.captures(query).map(|c| c[1].to_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_jira_intent() {
        let r = IntentRouter::new().classify("cari bug priority high di project QA");
        assert!(matches!(r.route, IntentRoute::Jira));
        assert!(r.project_key.as_deref() == Some("QA"));
    }

    #[test]
    fn classifies_confluence_intent() {
        let r = IntentRouter::new().classify("jelaskan requirement di dokumen confluence");
        assert!(matches!(r.route, IntentRoute::Confluence));
    }

    #[test]
    fn classifies_empty_as_clarify() {
        let r = IntentRouter::new().classify("");
        assert!(matches!(r.route, IntentRoute::Clarify));
    }

    #[test]
    fn detects_issue_key() {
        let r = IntentRouter::new().classify("status dari PROJ-123");
        assert!(matches!(r.route, IntentRoute::Jira));
    }
}
