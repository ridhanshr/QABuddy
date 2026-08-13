use crate::models::bitbucket::{BitbucketFileChange, ImpactAnalysisResult};
use regex::Regex;

const MAX_SYMBOL_LEN: usize = 120;
const MAX_SYMBOLS: usize = 15;

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
            if let Some(filename) = file.path.rsplit('/').next() {
                affected_components.push(filename.to_string());
            }

            if path_lower.contains("service")
                || path_lower.contains("controller")
                || path_lower.contains("logic")
                || path_lower.contains("repository")
                || path_lower.contains("handler")
            {
                has_core_logic_change = true;
            }

            if path_lower.contains("api")
                || path_lower.contains("controller")
                || path_lower.contains("route")
                || path_lower.contains("endpoint")
            {
                api_routes_changed.push(file.path.clone());
            }
        }

        // Extract modified functions/methods/classes from added/removed diff lines.
        // Skips comments, file headers and obviously-not-signatures lines.
        for line in raw_diff.lines() {
            let trimmed = line.trim();
            if !(trimmed.starts_with('+') || trimmed.starts_with('-')) {
                continue;
            }
            if trimmed.starts_with("+++") || trimmed.starts_with("---") {
                continue;
            }
            let code = trimmed[1..].trim();
            if code.is_empty() {
                continue;
            }
            if let Some(symbol) = Self::extract_symbol(code) {
                if symbol.len() <= MAX_SYMBOL_LEN {
                    modified_functions.push(symbol);
                }
            }
        }

        affected_components.dedup();
        modified_functions.dedup();
        api_routes_changed.dedup();

        if modified_functions.len() > MAX_SYMBOLS {
            modified_functions.truncate(MAX_SYMBOLS);
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

    /// Try to extract a readable declaration ("fn foo", "class Foo", "method bar")
    /// from a single added/removed source line. Returns `None` for comments,
    /// blank-ish lines, and lines that aren't obviously declarations.
    fn extract_symbol(code: &str) -> Option<String> {
        // Strip inline line comments and trailing block openers.
        let cleaned = code
            .split("//")
            .next()
            .unwrap_or(code)
            .split('#')
            .next()
            .unwrap_or(code)
            .trim_end_matches('{')
            .trim_end_matches(';')
            .trim();

        if cleaned.is_empty() {
            return None;
        }
        // Skip obvious comment / doc lines.
        if cleaned.starts_with("//")
            || cleaned.starts_with("/*")
            || cleaned.starts_with('*')
            || cleaned.starts_with('#')
            || cleaned.starts_with('\"')
            || cleaned.starts_with('\'')
        {
            return None;
        }

        // fn foo(...) / def foo(...) / func Foo(...) / function foo(...)
        if let Some(c) = Regex::new(r"(?i)\b(?:fn|def|func|function)\s+([A-Za-z_][A-Za-z0-9_]*)")
            .ok()
            .and_then(|re| re.captures(cleaned))
        {
            return Some(format!("fn {}", &c[1]));
        }

        // class Foo / interface Foo / struct Foo / enum Foo / trait Foo
        if let Some(c) = Regex::new(r"(?i)\b(class|interface|struct|enum|trait)\s+([A-Za-z_][A-Za-z0-9_]*)")
            .ok()
            .and_then(|re| re.captures(cleaned))
        {
            return Some(format!("{} {}", c[1].to_lowercase(), &c[2]));
        }

        // Access-modified method: public/private/protected [static|final] RetType name(...)
        if let Some(c) = Regex::new(r"(?i)\b(?:public|private|protected)\b.*?\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")
            .ok()
            .and_then(|re| re.captures(cleaned))
        {
            return Some(format!("method {}", &c[1]));
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_symbol_captures_rust_fn() {
        assert_eq!(ImpactAnalyzer::extract_symbol("+    pub fn process_payment(&self) {"), Some("fn process_payment".to_string()));
    }

    #[test]
    fn extract_symbol_captures_python_def() {
        assert_eq!(ImpactAnalyzer::extract_symbol("+def validate_payload():"), Some("fn validate_payload".to_string()));
    }

    #[test]
    fn extract_symbol_captures_class() {
        assert_eq!(ImpactAnalyzer::extract_symbol("+public class PaymentService {"), Some("class PaymentService".to_string()));
    }

    #[test]
    fn extract_symbol_captures_java_method() {
        assert_eq!(ImpactAnalyzer::extract_symbol("+    public BigDecimal calculateTotal(Order order) {"), Some("method calculateTotal".to_string()));
    }

    #[test]
    fn extract_symbol_skips_comments_and_data_lines() {
        assert_eq!(ImpactAnalyzer::extract_symbol("+    // just a comment"), None);
        assert_eq!(ImpactAnalyzer::extract_symbol("+    return result;"), None);
        assert_eq!(ImpactAnalyzer::extract_symbol("+  \"key\": \"value\""), None);
    }

    #[test]
    fn extract_symbol_skips_diff_file_headers() {
        assert_eq!(ImpactAnalyzer::extract_symbol("+++ b/src/main.rs"), None);
    }
}
