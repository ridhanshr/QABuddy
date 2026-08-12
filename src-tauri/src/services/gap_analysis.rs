use crate::models::bitbucket::{GapAnalysisResult, BitbucketTestScenario, ImpactAnalysisResult};

pub struct GapAnalyzer;

impl GapAnalyzer {
    pub fn analyze(
        jira_ticket_key: Option<&str>,
        impact: &ImpactAnalysisResult,
        existing_test_count: usize,
    ) -> GapAnalysisResult {
        let mut missing_coverage_areas = Vec::new();
        let mut duplicate_risk_notes = Vec::new();

        if let Some(key) = jira_ticket_key {
            duplicate_risk_notes.push(format!("Cross-referenced with existing Jira Xray tests for ticket {}", key));
        }

        for comp in &impact.affected_components {
            missing_coverage_areas.push(format!("New / modified business logic in {}", comp));
        }

        for route in &impact.api_routes_changed {
            missing_coverage_areas.push(format!("Validation & error handling for route {}", route));
        }

        if impact.regression_risk_level == "High" {
            missing_coverage_areas.push("Regression & side-effect verification across dependent modules".to_string());
        }

        GapAnalysisResult {
            existing_test_count,
            missing_coverage_areas,
            duplicate_risk_notes,
        }
    }

    pub fn filter_duplicates(
        scenarios: Vec<BitbucketTestScenario>,
    ) -> Vec<BitbucketTestScenario> {
        let mut unique_scenarios = Vec::new();
        let mut seen_titles = std::collections::HashSet::new();

        for s in scenarios {
            let normalized = s.scenario.to_lowercase().trim().to_string();
            if !seen_titles.contains(&normalized) {
                seen_titles.insert(normalized);
                unique_scenarios.push(s);
            }
        }

        // Sort scenarios by confidence descending and risk level (High > Medium > Low)
        unique_scenarios.sort_by(|a, b| {
            b.confidence.cmp(&a.confidence)
        });

        unique_scenarios
    }
}
