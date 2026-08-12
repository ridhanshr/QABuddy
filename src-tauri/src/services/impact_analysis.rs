use crate::models::bitbucket::{BitbucketFileChange, ImpactAnalysisResult};

pub struct ImpactAnalyzer;

impl ImpactAnalyzer {
    pub fn analyze(files: &[BitbucketFileChange], raw_diff: &str) -> ImpactAnalysisResult {
        let mut affected_components = Vec::new();
        let mut modified_functions = Vec::new();
        let mut api_routes_changed = Vec::new();
        let mut has_core_logic_change = false;

        for file in files {
            let path_lower = file.path.to_lowercase();

            // Extract components from path
            let path_parts: Vec<&str> = file.path.split('/').collect();
            if let Some(filename) = path_parts.last() {
                affected_components.push(filename.to_string());
            }

            if path_lower.contains("service") || path_lower.contains("controller") || path_lower.contains("logic") || path_lower.contains("repository") || path_lower.contains("handler") {
                has_core_logic_change = true;
            }

            if path_lower.contains("api") || path_lower.contains("controller") || path_lower.contains("route") || path_lower.contains("endpoint") {
                api_routes_changed.push(file.path.clone());
            }
        }

        // Parse modified functions/methods from raw diff lines starting with '+' or '-' containing fn / function / def / public / private / class
        for line in raw_diff.lines() {
            let trimmed = line.trim();
            if (trimmed.starts_with('+') || trimmed.starts_with('-')) && !trimmed.starts_with("+++") && !trimmed.starts_with("---") {
                let code_content = &trimmed[1..].trim();
                if code_content.contains("fn ") 
                    || code_content.contains("def ") 
                    || code_content.contains("function ") 
                    || code_content.contains("public ") 
                    || code_content.contains("private ") 
                    || code_content.contains("class ") 
                    || code_content.contains("interface ") 
                {
                    if code_content.len() < 120 {
                        modified_functions.push(code_content.to_string());
                    }
                }
            }
        }

        affected_components.dedup();
        modified_functions.dedup();
        api_routes_changed.dedup();

        if modified_functions.len() > 15 {
            modified_functions.truncate(15);
        }

        let regression_risk_level = if has_core_logic_change || files.len() > 8 || api_routes_changed.len() > 2 {
            "High".to_string()
        } else if files.len() > 3 || !api_routes_changed.is_empty() {
            "Medium".to_string()
        } else {
            "Low".to_string()
        };

        let summary_notes = format!(
            "Analyzed {} modified files. Found {} affected components and {} API route modifications. Overall regression risk: {}.",
            files.len(),
            affected_components.len(),
            api_routes_changed.len(),
            regression_risk_level
        );

        ImpactAnalysisResult {
            affected_components,
            modified_functions,
            api_routes_changed,
            regression_risk_level,
            summary_notes,
        }
    }
}
