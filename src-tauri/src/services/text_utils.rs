//! Text processing helpers ported from `src/main/services/utils.ts`.
//!
//! These cover the JSON-block extraction, content chunking, slugify, and
//! Confluence URL parsing routines that the Ollama / Confluence services rely
//! on. Kept dependency-light (regex + serde_json) so they can be unit-tested
//! in isolation.

use regex::Regex;

use crate::models::test_case::ExtractedTestCase;

/// Maximum characters per content chunk sent to the LLM. Reduced to leave
/// room for the prompt template plus a safety margin.
const CHUNK_SIZE: usize = 12_000;
/// Maximum window to search backwards for a sentence boundary when chunking.
const MAX_OVERLAP: usize = 300;

/// Split long text into chunks no larger than `max_chunk_size`, preferring to
/// break at paragraph/sentence boundaries with a small sentence-aware overlap.
pub fn chunk_content(text: &str, max_chunk_size: usize) -> Vec<String> {
    let max_chunk_size = if max_chunk_size == 0 { CHUNK_SIZE } else { max_chunk_size };
    let bytes = text.as_bytes();
    if bytes.len() <= max_chunk_size {
        return vec![text.to_string()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut start = 0usize;
    let len = bytes.len();

    while start < len {
        let mut end = std::cmp::min(start + max_chunk_size, len);

        if end < len {
            // Try paragraph boundary first.
            let window = &text[start..end];
            if let Some(rel) = window.rfind("\n\n") {
                let abs = start + rel;
                if abs > start + max_chunk_size / 2 {
                    end = abs + 2;
                } else {
                    end = sentence_boundary(text, start, end, max_chunk_size);
                }
            } else {
                end = sentence_boundary(text, start, end, max_chunk_size);
            }
        }

        chunks.push(text[start..end].trim().to_string());
        if end >= len {
            break;
        }

        // Sentence-aware overlap: look for the last boundary within the window.
        let min_overlap_pos = std::cmp::max(end.saturating_sub(MAX_OVERLAP), start + 1);
        let last_period = text[..end].rfind(". ").unwrap_or(0);
        let last_newline = text[..end].rfind('\n').unwrap_or(0);
        let boundary = last_period.max(last_newline);
        start = if boundary >= min_overlap_pos { boundary + 1 } else { end };
    }

    chunks
}

fn sentence_boundary(text: &str, start: usize, mut end: usize, max_chunk_size: usize) -> usize {
    let candidates = [". ", "? ", "! "];
    let mut best = 0usize;
    for c in candidates {
        if let Some(rel) = text[start..end].rfind(c) {
            best = best.max(start + rel);
        }
    }
    if best > start + max_chunk_size / 2 {
        end = best + 1;
    }
    end
}

/// Attempt to extract and parse a JSON object/array from an LLM response that
/// may be wrapped in markdown fences or contain trailing prose.
pub fn extract_json_block(value: &str) -> Option<serde_json::Value> {
    let trimmed = value.trim();

    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(v);
    }

    // Markdown code fence: ```json ... ``` or ``` ... ```
    let fence = Regex::new(r"(?s)```(?:json)?\s*\n?([\s\S]*?)\n?\s*```").unwrap();
    if let Some(caps) = fence.captures(trimmed) {
        if let Some(v) = parse_loose(&caps[1].trim()) {
            return Some(v);
        }
    }

    // Greedy outer object.
    if let Some(slice) = match_braces(trimmed, '{', '}') {
        if let Some(v) = parse_loose(&slice) {
            return Some(v);
        }
    }

    // Greedy outer array.
    if let Some(slice) = match_braces(trimmed, '[', ']') {
        if let Some(v) = parse_loose(&slice) {
            return Some(v);
        }
    }

    // Last resort: strip trailing commas + control chars, retry.
    let cleaned = clean_trailing(trimmed);
    if let Some(slice) = match_braces(&cleaned, '{', '}') {
        if let Some(v) = parse_loose(&slice) {
            return Some(v);
        }
    }
    if let Some(slice) = match_braces(&cleaned, '[', ']') {
        return parse_loose(&slice);
    }
    None
}

fn parse_loose(s: &str) -> Option<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(s).ok()
}

/// Clean trailing commas before `}` or `]` and remove control characters.
fn clean_trailing(s: &str) -> String {
    let no_trailing = Regex::new(r",\s*([}\]])").unwrap();
    let step1 = no_trailing.replace_all(s, "$1");
    let ctrl = Regex::new(r"[\x00-\x1F\x7F]").unwrap();
    ctrl.replace_all(&step1, " ").to_string()
}

/// Return the substring spanning the first `open` to its matching `close`.
fn match_braces(s: &str, open: char, close: char) -> Option<String> {
    let first = s.find(open)?;
    let mut depth = 0i32;
    let bytes = s.as_bytes();
    let mut idx = first;
    while idx < s.len() {
        let ch = bytes[idx] as char;
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
            if depth == 0 {
                return Some(s[first..=idx].to_string());
            }
        }
        idx += 1;
    }
    None
}

/// Extract all Jira issue keys (e.g. `PROJ-123`) from arbitrary text.
pub fn extract_jira_issue_keys(text: &str) -> Vec<String> {
    let re = Regex::new(r"([A-Z]{2,}-\d{1,9})").unwrap();
    re.find_iter(text).map(|m| m.as_str().to_string()).collect()
}

/// Parse a Confluence page id from a URL (`/pages/123`, `?pageId=123`, trailing digits).
pub fn parse_confluence_page_id(url: &str) -> Option<String> {
    let pages = Regex::new(r"(?i)/pages/(\d+)").unwrap();
    if let Some(c) = pages.captures(url) {
        return Some(c[1].to_string());
    }
    let query = Regex::new(r"(?i)[?&]pageId=(\d+)").unwrap();
    if let Some(c) = query.captures(url) {
        return Some(c[1].to_string());
    }
    let trailing = Regex::new(r"/(\d+)$").unwrap();
    trailing.captures(url).map(|c| c[1].to_string())
}

/// Parse a Confluence display URL into `(spaceKey, title)`.
pub fn parse_confluence_display_url(url: &str) -> Option<(String, String)> {
    let parsed = url::Url::parse(url).ok()?;
    let pathname = parsed.path().trim_end_matches('/');
    let segments: Vec<&str> = pathname.split('/').filter(|s| !s.is_empty()).collect();
    let display_index = segments.iter().position(|s| *s == "display")?;
    if segments.len() >= display_index + 2 {
        let last = segments.last()?;
        let title = percent_decode_str(last).replace('+', " ");
        let space_key = segments[segments.len() - 2].to_string();
        return Some((space_key, title));
    }
    None
}

fn percent_decode_str(s: &str) -> String {
    url::form_urlencoded::parse(s.as_bytes())
        .map(|(k, _)| k.to_string())
        .next()
        .unwrap_or_else(|| s.to_string())
}

/// Lowercase, hyphen-separated slug with a max length.
pub fn slugify(text: &str, max_len: usize) -> String {
    let max_len = if max_len == 0 { 30 } else { max_len };
    let lower = text.to_lowercase();
    let non_alnum = Regex::new(r"[^a-z0-9\s-]").unwrap();
    let step1 = non_alnum.replace_all(&lower, "");
    let spaces = Regex::new(r"\s+").unwrap();
    let step2 = spaces.replace_all(&step1, "-");
    let multi_dash = Regex::new(r"-+").unwrap();
    let mut out = multi_dash.replace_all(&step2, "-").to_string();
    if out.len() > max_len {
        out.truncate(max_len);
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// Strip HTML tags and decode common entities, collapsing whitespace.
pub fn strip_html(html: &str) -> String {
    let style = Regex::new(r"(?is)<style[\s\S]*?</style>").unwrap();
    let script = Regex::new(r"(?is)<script[\s\S]*?</script>").unwrap();
    let tags = Regex::new(r"<[^>]+>").unwrap();
    let whitespace = Regex::new(r"\s+").unwrap();

    let mut s = style.replace_all(html, " ").to_string();
    s = script.replace_all(&s, " ").to_string();
    s = tags.replace_all(&s, " ").to_string();
    s = decode_entities(&s);
    whitespace.replace_all(s.trim(), " ").to_string()
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&ndash;", "–")
        .replace("&mdash;", "—")
}

/// Convert an ADF (Atlassian Document Format) document to plain text /
/// wiki-storage markup. Mirrors `JiraClient.adfToPlainText`.
pub fn adf_to_plain_text(adf: &serde_json::Value) -> String {
    extract_nodes(adf.get("content").unwrap_or(&serde_json::Value::Null))
}

fn extract_nodes(nodes: &serde_json::Value) -> String {
    let mut result = String::new();
    if let Some(arr) = nodes.as_array() {
        for node in arr {
            extract_node(node, &mut result);
        }
    }
    result
}

fn extract_node(node: &serde_json::Value, out: &mut String) {
    let kind = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match kind {
        "text" => {
            if let Some(t) = node.get("text").and_then(|v| v.as_str()) {
                out.push_str(t);
            }
        }
        "hardBreak" | "hard_break" => out.push('\n'),
        "paragraph" => {
            out.push_str(&extract_nodes(node.get("content").unwrap_or(&serde_json::Value::Null)));
            out.push('\n');
        }
        "table" => {
            out.push_str(&adf_table_to_wiki(node));
            out.push('\n');
        }
        "tableRow" => {
            out.push('|');
            if let Some(cells) = node.get("content").and_then(|v| v.as_array()) {
                for cell in cells {
                    out.push_str(&extract_nodes(cell.get("content").unwrap_or(&serde_json::Value::Null)));
                    out.push('|');
                }
            }
            out.push('\n');
        }
        "tableHeader" => {
            out.push_str("||");
            if let Some(cells) = node.get("content").and_then(|v| v.as_array()) {
                for cell in cells {
                    out.push_str(&extract_nodes(cell.get("content").unwrap_or(&serde_json::Value::Null)));
                    out.push_str("||");
                }
            }
            out.push('\n');
        }
        _ => {
            if let Some(content) = node.get("content") {
                out.push_str(&extract_nodes(content));
            }
        }
    }
}

fn adf_table_to_wiki(table: &serde_json::Value) -> String {
    let mut wiki = String::new();
    if let Some(rows) = table.get("content").and_then(|v| v.as_array()) {
        for row in rows {
            if row.get("type").and_then(|v| v.as_str()) == Some("tableRow") {
                let cells = row.get("content").and_then(|v| v.as_array());
                let is_header = cells
                    .and_then(|c| c.first())
                    .and_then(|c| c.get("type"))
                    .and_then(|v| v.as_str())
                    == Some("tableHeader");
                let sep = if is_header { "||" } else { "|" };
                wiki.push_str(sep);
                if let Some(cells) = cells {
                    for cell in cells {
                        let txt = adf_to_plain_text(cell).replace('\n', " ");
                        wiki.push_str(&txt);
                        wiki.push_str(sep);
                    }
                }
                wiki.push('\n');
            }
        }
    }
    wiki
}

/// Word-overlap (Jaccard) similarity between two strings, in `[0,1]`.
pub fn title_similarity(a: &str, b: &str) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();
    let words_a: std::collections::HashSet<&str> = a_lower.split_whitespace().collect();
    let words_b: std::collections::HashSet<&str> = b_lower.split_whitespace().collect();
    if words_a.is_empty() && words_b.is_empty() {
        return 0.0;
    }
    let inter = words_a.intersection(&words_b).count();
    let union = words_a.union(&words_b).count();
    if union == 0 { 0.0 } else { inter as f64 / union as f64 }
}

/// Deduplicate extracted test cases by title similarity (>0.7), keeping the
/// entry with the longer objective, then re-number the IDs.
pub fn deduplicate_test_cases(cases: Vec<ExtractedTestCase>) -> Vec<ExtractedTestCase> {
    let mut seen: Vec<ExtractedTestCase> = Vec::new();
    for tc in cases {
        let mut replace_idx: Option<usize> = None;
        for (i, s) in seen.iter().enumerate() {
            if title_similarity(&s.title, &tc.title) > 0.7 {
                if tc.objective.len() > s.objective.len() {
                    replace_idx = Some(i);
                }
                break;
            }
        }
        match replace_idx {
            Some(i) => seen[i] = tc,
            None => seen.push(tc),
        }
    }
    seen.into_iter()
        .enumerate()
        .map(|(i, mut tc)| {
            tc.id = format!("TC-{:03}", i + 1);
            tc
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_content_short_text_returns_single_chunk() {
        let chunks = chunk_content("hello world", 0);
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn extract_json_block_direct() {
        let v = extract_json_block(r#"{"a":1}"#).unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn extract_json_block_fenced() {
        let v = extract_json_block("```json\n{\"a\":2}\n```").unwrap();
        assert_eq!(v["a"], 2);
    }

    #[test]
    fn extract_json_block_with_prose() {
        let v = extract_json_block("Here is the result: {\"b\":3} done.").unwrap();
        assert_eq!(v["b"], 3);
    }

    #[test]
    fn extract_jira_keys() {
        let keys = extract_jira_issue_keys("see PROJ-12 and QA-3");
        assert_eq!(keys, vec!["PROJ-12", "QA-3"]);
    }

    #[test]
    fn parse_page_id_variants() {
        assert_eq!(parse_confluence_page_id("/pages/123456").as_deref(), Some("123456"));
        assert_eq!(parse_confluence_page_id("https://x/page?spaceKey=A&pageId=99").as_deref(), Some("99"));
    }

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Hello World!", 30), "hello-world");
    }

    #[test]
    fn title_similarity_overlap() {
        let s = title_similarity("login page loads", "login screen loads");
        assert!(s >= 0.5);
    }
}
