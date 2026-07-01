use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::models::brd::{
    BRDGenerationRequest, BRDGenerationResult, BRDTestCase, BRDTestCaseExpectedResult,
    BRDTestCaseStep, BRDStoreData, ExecutionMonitoringData, TestExecution, TestPlan,
};
use crate::models::app_config::AppConfig;
use crate::services::confluence::ConfluenceService;
use crate::services::error::{Result, ServiceError};
use crate::services::ollama::OllamaClient;

/// Emitted after each per-feature AI chunk finishes — lets the frontend
/// append test cases incrementally without waiting for all features.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrdChunkProgress {
    /// 1-based index of the feature just completed
    pub feature_index: usize,
    /// Total number of features being processed
    pub feature_total: usize,
    /// Name of the feature just processed
    pub feature_name: String,
    /// Test cases generated for this feature
    pub test_cases: Vec<crate::models::brd::BRDTestCase>,
    /// The shared test_execution_id for this generation session
    pub test_execution_id: String,
}

pub struct BRDService {
    app_handle: AppHandle,
}

impl BRDService {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
        }
    }

    fn data_path(&self) -> PathBuf {
        self.app_handle
            .path()
            .app_data_dir()
            .unwrap_or_default()
            .join("brd-data.json")
    }

    fn load(&self) -> BRDStoreData {
        let path = self.data_path();
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<BRDStoreData>(&raw) {
                return parsed;
            }
        }
        BRDStoreData::default()
    }

    fn save(&self, data: &BRDStoreData) -> Result<()> {
        let path = self.data_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("tmp");
        let json = serde_json::to_string_pretty(data)?;
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

    // ── Test Plans ─────────────────────────────────────────────────────

    pub fn get_test_plans(&self) -> Vec<TestPlan> {
        self.load().test_plans
    }

    pub fn create_test_plan(
        &self,
        uqa_key: String,
        phase: String,
        name: String,
        description: String,
        project_key: String,
    ) -> Result<TestPlan> {
        let mut data = self.load();
        let plan = TestPlan {
            id: Uuid::new_v4().to_string(),
            jira_test_plan_key: None,
            uqa_key,
            phase,
            name,
            description,
            project_key,
            last_updated: Utc::now().to_rfc3339(),
        };
        data.test_plans.push(plan.clone());
        self.save(&data)?;
        Ok(plan)
    }

    pub fn update_test_plan(&self, plan: TestPlan) -> Result<TestPlan> {
        let mut data = self.load();
        let result = if let Some(existing) = data.test_plans.iter_mut().find(|p| p.id == plan.id) {
            *existing = plan.clone();
            existing.last_updated = Utc::now().to_rfc3339();
            let cloned = existing.clone();
            self.save(&data)?;
            Ok(cloned)
        } else {
            Err(ServiceError::Api("Test plan not found".into()))
        };
        result
    }

    pub fn delete_test_plan(&self, id: &str) -> Result<()> {
        let mut data = self.load();
        data.test_plans.retain(|p| p.id != id);
        data.test_executions.retain(|e| e.test_plan_id != id);
        let exec_ids: Vec<String> = data
            .test_executions
            .iter()
            .map(|e| e.id.clone())
            .collect();
        data.test_cases
            .retain(|tc| !exec_ids.contains(&tc.test_execution_id));
        self.save(&data)?;
        Ok(())
    }

    // ── Test Executions ────────────────────────────────────────────────

    pub fn get_test_executions(&self, test_plan_id: Option<&str>) -> Vec<TestExecution> {
        let data = self.load();
        if let Some(plan_id) = test_plan_id {
            data.test_executions
                .into_iter()
                .filter(|e| e.test_plan_id == plan_id)
                .collect()
        } else {
            data.test_executions
        }
    }

    pub fn create_test_execution(
        &self,
        test_plan_id: String,
        assignee: String,
        name: String,
        project_key: String,
        feature_name: String,
    ) -> Result<TestExecution> {
        let mut data = self.load();
        let execution = TestExecution {
            id: Uuid::new_v4().to_string(),
            jira_test_exec_key: None,
            test_plan_id,
            assignee,
            name,
            project_key,
            feature_name,
            last_updated: Utc::now().to_rfc3339(),
        };
        data.test_executions.push(execution.clone());
        self.save(&data)?;
        Ok(execution)
    }

    pub fn update_test_execution(&self, execution: TestExecution) -> Result<TestExecution> {
        let mut data = self.load();
        let result = if let Some(existing) = data
            .test_executions
            .iter_mut()
            .find(|e| e.id == execution.id)
        {
            *existing = execution.clone();
            existing.last_updated = Utc::now().to_rfc3339();
            let cloned = existing.clone();
            self.save(&data)?;
            Ok(cloned)
        } else {
            Err(ServiceError::Api("Test execution not found".into()))
        };
        result
    }

    pub fn delete_test_execution(&self, id: &str) -> Result<()> {
        let mut data = self.load();
        data.test_executions.retain(|e| e.id != id);
        data.test_cases.retain(|tc| tc.test_execution_id != id);
        self.save(&data)?;
        Ok(())
    }

    // ── BRD Test Cases ─────────────────────────────────────────────────

    pub fn get_test_cases(&self, test_execution_id: Option<&str>) -> Vec<BRDTestCase> {
        let data = self.load();
        if let Some(exec_id) = test_execution_id {
            data.test_cases
                .into_iter()
                .filter(|tc| tc.test_execution_id == exec_id)
                .collect()
        } else {
            data.test_cases
        }
    }

    pub fn update_test_case(&self, test_case: BRDTestCase) -> Result<BRDTestCase> {
        let mut data = self.load();
        let result = if let Some(existing) = data.test_cases.iter_mut().find(|tc| tc.id == test_case.id) {
            *existing = test_case.clone();
            existing.last_updated = Utc::now().to_rfc3339();
            let cloned = existing.clone();
            self.save(&data)?;
            Ok(cloned)
        } else {
            Err(ServiceError::Api("Test case not found".into()))
        };
        result
    }

    pub fn delete_test_case(&self, id: &str) -> Result<()> {
        let mut data = self.load();
        data.test_cases.retain(|tc| tc.id != id);
        self.save(&data)?;
        Ok(())
    }

    pub fn add_batch_test_cases(&self, test_cases: Vec<BRDTestCase>) -> Result<Vec<BRDTestCase>> {
        let mut data = self.load();
        let now = Utc::now().to_rfc3339();
        let cases: Vec<BRDTestCase> = test_cases
            .into_iter()
            .map(|mut tc| {
                tc.id = Uuid::new_v4().to_string();
                tc.last_updated = now.clone();
                tc
            })
            .collect();
        data.test_cases.extend(cases.clone());
        self.save(&data)?;
        Ok(cases)
    }

    // ── AI Generation from Confluence BRD ─────────────────────────────

    /// Find a section by heading keyword, or fall back to searching for the keyword
    /// text directly in the raw HTML. Returns (section_html, heading_text).
    fn find_fitur_section_html(html: &str, keywords: &[&str]) -> Option<(String, String)> {
        let style_re = regex::Regex::new(r"(?is)<style[\s\S]*?</style>").unwrap();
        let script_re = regex::Regex::new(r"(?is)<script[\s\S]*?</script>").unwrap();
        let no_style = style_re.replace_all(html, " ");
        let cleaned = script_re.replace_all(&no_style, " ");
        let s = cleaned.as_ref();

        // ── Try matching by heading tag ─────────────────────────────────
        let h_tag = regex::Regex::new(r"<(h[1-6])\b").unwrap();
        let all_heads: Vec<(usize, u32)> = h_tag.find_iter(s)
            .filter_map(|m| {
                let tag = m.as_str();
                let level = tag.trim_start_matches('<').chars().nth(1)?.to_digit(10)?;
                Some((m.start(), level))
            })
            .collect();

        eprintln!("[BRD Gen] Found {} headings in page", all_heads.len());

        let close_re = regex::Regex::new(r"(?is)</h[1-6]>").unwrap();
        for (hdr_i, &(start, level)) in all_heads.iter().enumerate() {
            let after = &s[start..];
            let close_pos = match close_re.find(after).map(|m| start + m.end()) {
                Some(p) => p,
                None => {
                    eprintln!("[BRD Gen] Heading at pos {start} has no closing tag, skipping");
                    continue;
                }
            };
            let inner = crate::services::text_utils::strip_html(&s[start..close_pos]);
            let lower = inner.to_lowercase().trim().to_string();
            eprintln!("[BRD Gen] Heading h{level}: \"{inner}\"", level = level, inner = inner.trim());

            let matched_kw = keywords.iter().find(|k| lower.contains(*k));
            let kw = match matched_kw {
                Some(k) => k,
                None => continue,
            };

            // Determine end of section:
            // - For "kebutuhan fungsional", find the next heading that contains
            //   "kebutuhan non fungsional" or "nfr" — this marks the boundary
            // - For narrow keywords like "fitur"/"fungsi", extract to next same/higher-level heading
            let section_end = if *kw == "kebutuhan fungsional" {
                all_heads[hdr_i + 1..]
                    .iter()
                    .position(|&(pos, _)| {
                        let close = match close_re.find(&s[pos..]).map(|m| pos + m.end()) {
                            Some(p) => p,
                            None => return false,
                        };
                        let text = crate::services::text_utils::strip_html(&s[pos..close]);
                        let lower = text.to_lowercase();
                        lower.contains("kebutuhan non fungsional") || lower.contains("nfr")
                    })
                    .map(|rel_idx| all_heads[hdr_i + 1 + rel_idx].0)
                    .unwrap_or(s.len())
            } else {
                all_heads[hdr_i + 1..]
                    .iter()
                    .find(|(_, l)| *l <= level)
                    .map(|(pos, _)| *pos)
                    .unwrap_or(s.len())
            };

            let section_html = s[start..section_end].to_string();
            let heading_text = inner.trim().to_string();
            eprintln!("[BRD Gen] Matched \"{kw}\" -> \"{heading_text}\", section = {} chars ({} to {})",
                section_html.len(),
                start,
                section_end);
            return Some((section_html, heading_text));
        }

        // ── Fallback: search for keyword text directly in the page ──────
        eprintln!("[BRD Gen] No heading matched keywords, trying raw text search");
        let plain = crate::services::text_utils::strip_html(s);
        for kw in keywords {
            if let Some(pos) = plain.to_lowercase().find(kw) {
                let start_byte = pos.saturating_sub(5000);
                let end_byte = (pos + 15000).min(plain.len());
                let chunk = plain[start_byte..end_byte].to_string();
                eprintln!("[BRD Gen] Found keyword \"{kw}\" at pos {pos}, extracted {} chars", chunk.len());
                return Some((chunk, format!("…{kw}…")));
            }
        }

        None
    }

    /// From the "Fitur" section HTML, extract feature descriptions from the
    /// table column whose header matches "feature" or "fitur". Returns the
    /// extracted feature list text or None.
    fn extract_feature_column(html: &str) -> Option<String> {
        let table_re = regex::Regex::new(r"(?is)<table\b[^>]*>([\s\S]*?)</table>").unwrap();
        let row_re = regex::Regex::new(r"(?is)<tr\b[^>]*>([\s\S]*?)</tr>").unwrap();
        let cell_re = regex::Regex::new(r"(?is)<t[dh][^>]*>([\s\S]*?)</t[dh]>").unwrap();

        for table_cap in table_re.captures_iter(html) {
            let body = &table_cap[1];
            let rows: Vec<Vec<String>> = row_re
                .captures_iter(body)
                .map(|row_cap| {
                    cell_re
                        .captures_iter(&row_cap[1])
                        .map(|c| {
                            let raw = &c[1];
                            // Strip inner HTML tags and decode entities
                            let tag_re = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
                            let ws = regex::Regex::new(r"\s+").unwrap();
                            let cleaned = tag_re.replace_all(raw, " ");
                            let collapsed = ws.replace_all(&cleaned, " ");
                            collapsed.trim().to_string()
                        })
                        .collect()
                })
                .collect();

            if rows.len() < 2 {
                continue;
            }

            // Find column index whose header matches "feature" or "fitur"
            let header = &rows[0];
            let col_idx = header.iter().position(|h| {
                let lower = h.to_lowercase();
                lower == "feature" || lower == "fitur" || lower.starts_with("feature") || lower.starts_with("fitur")
            });

            if let Some(idx) = col_idx {
                let features: Vec<&str> = rows[1..]
                    .iter()
                    .filter_map(|row| row.get(idx))
                    .map(|s| s.as_str().trim())
                    .filter(|s| !s.is_empty())
                    .collect();

                if features.is_empty() {
                    continue;
                }

                eprintln!("[BRD Gen] Found {} feature descriptions in '{}' column",
                    features.len(), header[idx]);
                return Some(features.join("\n---\n"));
            }
        }

        None
    }

    /// Extract the plain text of the "Fitur" section (fallback when no
    /// feature column is found).
    fn extract_section_text(html: &str, keywords: &[&str]) -> Option<String> {
        let (section_html, heading_text) = Self::find_fitur_section_html(html, keywords)?;
        let section_text = crate::services::text_utils::strip_html(&section_html);
        if section_text.trim().is_empty() {
            return None;
        }
        eprintln!("[BRD Gen] Extracted section \"{heading_text}\" ({} chars)", section_text.len());
        Some(section_text)
    }

    /// Extract only the "2.1 Proses Bisnis" section HTML (and all its sub-sections).
    /// Returns the HTML slice from the "2.1 Proses Bisnis" heading until the next
    /// sibling heading at the same or higher level (e.g. "2.2 …" or "3.…").
    fn extract_proses_bisnis_section(html: &str) -> Option<String> {
        let style_re  = regex::Regex::new(r"(?is)<style[\s\S]*?</style>").unwrap();
        let script_re = regex::Regex::new(r"(?is)<script[\s\S]*?</script>").unwrap();
        let no_style  = style_re.replace_all(html, " ");
        let cleaned   = script_re.replace_all(&no_style, " ");
        let s         = cleaned.as_ref();

        let tag_strip = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
        let ws_re     = regex::Regex::new(r"\s+").unwrap();

        let clean_text = |raw: &str| -> String {
            let no_tags = tag_strip.replace_all(raw, " ");
            ws_re.replace_all(no_tags.trim(), " ").trim().to_string()
        };

        // Collect ALL block-level elements (h1-h6, p, div) as candidate headings.
        // Confluence may store heading numbers inside <p> tags when using the
        // "Numbered Headings" or "Table of Contents" macro.
        // Note: Rust's `regex` crate does not support backreferences, so we match
        // any opening block tag + content using a non-greedy approach and strip tags
        // to get the plain text. This may nest slightly but is fine for heading text.
        let block_re = regex::Regex::new(
            r#"(?is)<(h[1-6]|p|div)\b[^>]*>([\s\S]*?)</(?:h[1-6]|p|div)>"#
        ).unwrap();

        // (byte_start, tag_name, plain_text)
        let blocks: Vec<(usize, String, String)> = block_re
            .captures_iter(s)
            .filter_map(|cap| {
                let tag  = cap[1].to_lowercase();
                let text = clean_text(&cap[2]);
                if text.is_empty() { return None; }
                Some((cap.get(0)?.start(), tag, text))
            })
            .collect();

        eprintln!("[BRD Gen] Scanning {} blocks for \"2.1 Proses Bisnis\"", blocks.len());

        // Match "2.1 Proses Bisnis" in either heading or paragraph text
        let is_proses_bisnis = |text: &str| -> bool {
            let lower = text.to_lowercase();
            (lower.starts_with("2.1") && lower.contains("proses bisnis"))
                || (lower.contains("2.1") && lower.contains("proses") && lower.contains("bisnis"))
        };

        let target = blocks.iter().find(|(_, _, text)| is_proses_bisnis(text));

        let start_pos = match target {
            Some((pos, _, text)) => {
                eprintln!("[BRD Gen] Found Proses Bisnis at byte {}: \"{}\"", pos, &text[..text.len().min(60)]);
                *pos
            }
            None => {
                // Last-resort fallback: search the raw text for the string
                eprintln!("[BRD Gen] Block scan missed; trying raw-text fallback");
                let lower = s.to_lowercase();
                lower.find("proses bisnis")?
            }
        };

        // End of section = the next <h*> heading whose text is a sibling section
        // number (e.g. "2.2", "3.") — we ONLY look at actual heading tags, never
        // at <p>/<div>, because numbered list items inside the section (e.g. "3. Terdapat...")
        // would otherwise be mis-detected as a new top-level section.
        let heading_only_re  = regex::Regex::new(r"(?i)<h([1-6])\b[^>]*>([\s\S]*?)</h[1-6]>").unwrap();
        let tag_strip2       = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
        // Matches real section numbers: "2.2 ...", "3. ...", "3 ..." etc.
        let section_num_re   = regex::Regex::new(r"^\d+[\.\s]").unwrap();

        let end_pos = heading_only_re.captures_iter(s)
            .filter_map(|cap| {
                let pos = cap.get(0)?.start();
                if pos <= start_pos { return None; }
                let text = tag_strip2.replace_all(&cap[2], " ");
                let text = text.trim().to_lowercase();
                // Only stop at headings that look like a real sibling section number
                // AND are NOT a sub-section of 2.1 (like 2.1.2, 2.1.3…)
                if section_num_re.is_match(&text) && !text.starts_with("2.1") {
                    Some(pos)
                } else {
                    None
                }
            })
            .next()
            .unwrap_or(s.len());

        let section = s[start_pos..end_pos].to_string();
        eprintln!("[BRD Gen] Proses Bisnis section: {} chars", section.len());
        Some(section)
    }

    /// Extract per-feature rows from the "2.1.3 Fungsi-Fungsi yang Diharapkan" table
    /// inside the Proses Bisnis section HTML.
    /// Returns a Vec of (feature_name, feature_full_text) — one entry per table row.
    fn extract_fungsi_features(proses_bisnis_html: &str) -> Vec<(String, String)> {
        let s = proses_bisnis_html;

        // ── Step 1: Try to narrow down to the 2.1.3 sub-section ──────────────
        // Confluence may render heading numbers inside the heading text OR as a
        // Confluence outline-macro prefix — match both <h*> tags AND <p>/<div>
        // elements whose text starts with "2.1.3".
        let heading_block_re = regex::Regex::new(
            r#"(?is)<(?:h[1-6]|p|div)\b[^>]*>([\s\S]*?)</(?:h[1-6]|p|div)>"#
        ).unwrap();
        let tag_strip_re = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
        let ws_re = regex::Regex::new(r"\s+").unwrap();

        let clean_text = |raw: &str| -> String {
            let no_tags = tag_strip_re.replace_all(raw, " ");
            ws_re.replace_all(no_tags.trim(), " ").trim().to_string()
        };

        // Collect candidate block positions whose plain text starts with "2.1.3"
        let fungsi_pos: Option<usize> = heading_block_re.find_iter(s).find_map(|m| {
            let text = clean_text(&s[m.start()..m.end()]).to_lowercase();
            if text.starts_with("2.1.3") || (text.contains("2.1.3") && (text.contains("fungsi") || text.contains("diharapkan"))) {
                Some(m.start())
            } else {
                None
            }
        });

        let section_html: &str = if let Some(pos) = fungsi_pos {
            eprintln!("[BRD Gen] Found 2.1.3 section at byte {}", pos);
            // Use everything from here to end of Proses Bisnis section
            &s[pos..]
        } else {
            eprintln!("[BRD Gen] No 2.1.3 heading found, scanning full Proses Bisnis HTML for table");
            s
        };

        // ── Step 2: Parse all tables using a tag-depth tokenizer ─────────
        // Regex non-greedy matching breaks on nested tags inside cells
        // (Confluence macros, nested divs, etc.). We tokenize by scanning
        // for opening/closing tags and tracking nesting depth instead.

        let clean_cell = |raw: &str| -> String {
            let no_tags = tag_strip_re.replace_all(raw, " ");
            ws_re.replace_all(no_tags.trim(), " ").trim().to_string()
        };

        // Tokenize: split HTML into a flat list of (tag_name, is_closing, start, end)
        // tag spans so we can walk them depth-aware.
        let tag_token_re = regex::Regex::new(r"(?i)<(/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>").unwrap();

        // Column-header detection helpers
        let is_feature_header = |h: &str| -> bool {
            let lower = h.to_lowercase();
            lower == "feature" || lower == "fitur"
                || lower.starts_with("feature") || lower.starts_with("fitur")
        };
        let is_ac_header = |h: &str| -> bool {
            let lower = h.to_lowercase();
            lower.contains("acceptance") || lower.contains("criteria") || lower.contains("kriteria")
        };
        let is_notes_header = |h: &str| -> bool {
            let lower = h.to_lowercase();
            lower.contains("catatan") || lower.contains("tambahan") || lower.contains("notes") || lower.contains("keterangan")
        };

        // Extract all top-level <table>…</table> blocks (depth-aware)
        let extract_tables = |html: &str| -> Vec<String> {
            let mut tables = Vec::new();
            let mut depth = 0usize;
            let mut table_start = 0usize;
            for cap in tag_token_re.captures_iter(html) {
                let is_close = &cap[1] == "/";
                let tag = cap[2].to_lowercase();
                let m = cap.get(0).unwrap();
                if tag == "table" {
                    if !is_close {
                        if depth == 0 { table_start = m.start(); }
                        depth += 1;
                    } else if depth > 0 {
                        depth -= 1;
                        if depth == 0 {
                            tables.push(html[table_start..m.end()].to_string());
                        }
                    }
                }
            }
            tables
        };

        // Extract rows from a single table HTML block (depth-aware, skips nested tables).
        // table_depth starts at -1 so the outer <table> tag brings it to 0, meaning
        // tr/td/th at depth==0 belong to the outermost table (the one we care about).
        let extract_rows = |table_html: &str| -> Vec<Vec<String>> {
            let mut rows: Vec<Vec<String>> = Vec::new();
            let mut row_cells: Vec<String> = Vec::new();
            let mut cell_start = 0usize;
            let mut in_cell = false;
            let mut table_depth: i32 = -1; // -1 so first <table> brings it to 0
            let mut cell_depth = 0i32;

            for cap in tag_token_re.captures_iter(table_html) {
                let is_close = &cap[1] == "/";
                let tag = cap[2].to_lowercase();
                let m = cap.get(0).unwrap();

                match tag.as_str() {
                    "table" => {
                        if !is_close { table_depth += 1; } else { table_depth -= 1; }
                    }
                    "tr" if table_depth == 0 => {
                        if is_close && !row_cells.is_empty() {
                            rows.push(std::mem::take(&mut row_cells));
                        }
                    }
                    "td" | "th" if table_depth == 0 => {
                        if !is_close {
                            if !in_cell {
                                cell_start = m.end();
                                in_cell = true;
                                cell_depth = 0;
                            } else {
                                cell_depth += 1;
                            }
                        } else if in_cell {
                            if cell_depth == 0 {
                                let raw = &table_html[cell_start..m.start()];
                                row_cells.push(clean_cell(raw));
                                in_cell = false;
                            } else {
                                cell_depth -= 1;
                            }
                        }
                    }
                    _ => {}
                }
            }
            rows
        };

        for table_html in extract_tables(section_html) {
            let rows = extract_rows(&table_html);

            if rows.len() < 2 {
                continue;
            }

            // Find the header row — may NOT be rows[0] due to merged-title rows above
            let header_row_idx = rows.iter().take(5).position(|row| {
                row.iter().any(|cell| is_feature_header(cell))
            });

            let Some(hdr_idx) = header_row_idx else {
                eprintln!("[BRD Gen] Table skipped (no Feature col in first 5 rows). Row 0: {:?}, Row 1: {:?}",
                    rows.get(0).map(|r| r.iter().take(4).collect::<Vec<_>>()),
                    rows.get(1).map(|r| r.iter().take(4).collect::<Vec<_>>()));
                continue;
            };

            let header = &rows[hdr_idx];
            let feature_col = header.iter().position(|h| is_feature_header(h));
            let ac_col      = header.iter().position(|h| is_ac_header(h));
            let notes_col   = header.iter().position(|h| is_notes_header(h));

            eprintln!("[BRD Gen] Feature table found (header row {}): feature_col={:?} ac_col={:?} notes_col={:?}",
                hdr_idx, feature_col, ac_col, notes_col);

            let Some(feat_idx) = feature_col else { continue };

            let mut features: Vec<(String, String)> = Vec::new();
            // Data rows start after the header row (skip title rows + header row)
            for row in &rows[hdr_idx + 1..] {
                let feature_raw = row.get(feat_idx).cloned().unwrap_or_default();
                if feature_raw.trim().is_empty() {
                    continue;
                }

                // Feature name = FIRST line only, but skip lines that are user-story sentences
                // ("As a...", "I want...", "Sebagai...", "Saya ingin...") — those are context, not the label
                let is_user_story = |line: &str| -> bool {
                    let l = line.trim().to_lowercase();
                    l.starts_with("as a") || l.starts_with("as an")
                        || l.starts_with("i want") || l.starts_with("i need")
                        || l.starts_with("sebagai") || l.starts_with("saya ingin")
                        || l.starts_with("saya dapat") || l.starts_with("agar")
                };
                let feature_name = feature_raw
                    .lines()
                    .find(|l| !l.trim().is_empty() && !is_user_story(l))
                    .unwrap_or(feature_raw.trim())
                    .trim()
                    .trim_end_matches('.')
                    .to_string();

                // Build a rich context string from ALL columns — this is what the AI reads
                let mut context_parts = vec![format!("Feature (nama fitur):\n{}", feature_name)];

                // Full feature cell text as user story context (may contain "As a..." lines)
                let user_story_lines: String = feature_raw
                    .lines()
                    .filter(|l| !l.trim().is_empty() && l.trim() != feature_name)
                    .collect::<Vec<_>>()
                    .join("\n");
                if !user_story_lines.is_empty() {
                    context_parts.push(format!("Konteks fitur (user story):\n{user_story_lines}"));
                }

                if let Some(ac_idx) = ac_col {
                    if let Some(ac) = row.get(ac_idx) {
                        if !ac.trim().is_empty() {
                            context_parts.push(format!("Acceptance Criteria:\n{ac}"));
                        }
                    }
                }
                if let Some(notes_idx) = notes_col {
                    if let Some(notes) = row.get(notes_idx) {
                        if !notes.trim().is_empty() {
                            context_parts.push(format!("Catatan Tambahan:\n{notes}"));
                        }
                    }
                }

                features.push((feature_name, context_parts.join("\n\n")));
            }

            if !features.is_empty() {
                eprintln!("[BRD Gen] Extracted {} features from 2.1.3 table", features.len());
                return features;
            }
        }

        eprintln!("[BRD Gen] No feature table found in 2.1.3 section");
        Vec::new()
    }

    /// Fetch image attachments from the Confluence page and run OCR on them.
    async fn extract_image_ocr(
        &self,
        config: &crate::models::app_config::ConfluenceConfig,
        page_id: &str,
    ) -> String {
        let confluence = ConfluenceService::new();
        let attachments = match confluence.get_attachments(config, page_id).await {
            Ok(a) => a,
            Err(e) => {
                eprintln!("[BRD Gen] Failed to list attachments: {e}");
                return String::new();
            }
        };

        let image_attachments: Vec<&Value> = attachments
            .iter()
            .filter(|att| {
                let ct = att["contentType"].as_str().unwrap_or("").to_lowercase();
                let mime = att["mimeType"].as_str().unwrap_or("").to_lowercase();
                ct.starts_with("image/") || mime.starts_with("image/")
            })
            .take(5)
            .collect();

        if image_attachments.is_empty() {
            eprintln!("[BRD Gen] No image attachments found for OCR");
            return String::new();
        }

        let ocr = crate::services::ocr::OcrService::new();
        let mut texts: Vec<String> = Vec::new();

        for (idx, att) in image_attachments.iter().enumerate() {
            let title = att["title"].as_str().unwrap_or("attachment").to_string();
            let download = att["_links"]["download"]
                .as_str()
                .or_else(|| att["downloadUrl"].as_str());
            let Some(download_path) = download else {
                eprintln!("[BRD Gen] Skipping attachment {title}: no download URL");
                continue;
            };

            let bytes = match confluence.download_attachment(config, download_path).await {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("[BRD Gen] Failed to download {title}: {e}");
                    continue;
                }
            };

            eprintln!("[BRD Gen] OCR-ing image {}/{}: {} ({} bytes)",
                idx + 1, image_attachments.len(), title, bytes.len());

            if let Some(result) = ocr.extract_text_from_bytes(&bytes, &title) {
                let text = result.text.trim().to_string();
                if !text.is_empty() {
                    eprintln!("[BRD Gen] OCR extracted {} chars from {title}", text.len());
                    texts.push(format!(
                        "[Screenshot {}: {}]\n{}",
                        idx + 1, result.source_attachment, text
                    ));
                }
            }
        }

        texts.join("\n\n")
    }

    /// Attempt to repair a JSON string that was truncated (missing closing
    /// braces/brackets) by tracking nesting stack and appending in correct order.
    fn repair_incomplete_json(text: &str) -> Option<Value> {
        let mut in_string = false;
        let mut escaped = false;
        let mut stack: Vec<char> = Vec::new(); // tracks open braces/brackets in order

        for ch in text.chars() {
            if escaped {
                escaped = false;
                if ch == '"' || ch == '\\' {
                    continue;
                }
            }
            if ch == '\\' && in_string {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = !in_string;
                continue;
            }
            if in_string {
                continue;
            }
            match ch {
                '{' => stack.push('}'),
                '[' => stack.push(']'),
                '}' => { stack.pop(); }
                ']' => { stack.pop(); }
                _ => {}
            }
        }

        if stack.is_empty() {
            return None; // already balanced
        }

        let mut repaired = text.to_string();
        for closing in stack.iter().rev() {
            repaired.push(*closing);
        }

        eprintln!("[BRD Gen] Repaired truncated JSON (added {} closing chars: {})",
            stack.len(),
            stack.iter().rev().collect::<String>());

        serde_json::from_str::<Value>(&repaired).ok()
    }

    pub async fn generate_from_confluence(
        &self,
        config: &AppConfig,
        request: BRDGenerationRequest,
    ) -> Result<BRDGenerationResult> {
        let confluence = ConfluenceService::new();
        let page: Value = confluence
            .get_page(&config.confluence, &request.confluence_page_id)
            .await
            .map_err(|e| ServiceError::Api(format!("Failed to fetch Confluence page: {e}")))?;

        let title = page["title"].as_str().unwrap_or("Untitled").to_string();
        let raw_html = page["body"]["storage"]["value"].as_str().unwrap_or("").to_string();

        eprintln!("[BRD Gen] Raw HTML: {} chars", raw_html.len());

        // ── Step 1: Extract the "2.1 Proses Bisnis" section only ────────
        let proses_bisnis_html = Self::extract_proses_bisnis_section(&raw_html)
            .unwrap_or_else(|| {
                eprintln!("[BRD Gen] \"2.1 Proses Bisnis\" section not found, falling back to full page");
                raw_html.clone()
            });

        // ── Step 2: Extract per-feature rows from 2.1.3 table ──────────
        let features = Self::extract_fungsi_features(&proses_bisnis_html);

        if features.is_empty() {
            return Err(ServiceError::Api(
                "Tabel fitur (2.1.3 Fungsi-Fungsi yang Diharapkan) tidak ditemukan pada halaman Confluence ini. \
                 Pastikan halaman memiliki heading \"2.1.3\" dan tabel dengan kolom \"Feature\" atau \"Fitur\"."
                    .into(),
            ));
        }

        eprintln!("[BRD Gen] {} fitur ditemukan pada tabel 2.1.3", features.len());

        // ── Step 3: Plain-text context of the full Proses Bisnis section ─
        // Truncated to avoid overwhelming the model — used as background context per chunk
        let proses_bisnis_plain = {
            let full = crate::services::text_utils::strip_html(&proses_bisnis_html);
            if full.len() > 6000 { format!("{}…", &full[..6000]) } else { full }
        };

        // ── Step 4: OCR any images in the page ─────────────────────────
        let ocr_text = self.extract_image_ocr(&config.confluence, &request.confluence_page_id).await;
        if !ocr_text.is_empty() {
            eprintln!("[BRD Gen] OCR text extracted ({} chars)", ocr_text.len());
        }

        let model = config.ollama.extraction_model.as_deref().unwrap_or(&config.ollama.model);
        let ollama_client = OllamaClient::new(&config.ollama.endpoint, model);

        let system_prompt = r#"Anda adalah senior QA engineer berpengalaman di bidang perbankan Indonesia. Tugas Anda adalah membuat test case yang sangat komprehensif dari BRD (Business Requirements Document).

Anda akan menerima satu baris dari tabel "2.1.3 Fungsi-Fungsi yang Diharapkan" yang berisi:
- Feature (nama fitur): label singkat nama fitur
- Konteks fitur (user story): kalimat "As a... I want..." yang menjelaskan kebutuhan user — GUNAKAN untuk memahami skenario
- Acceptance Criteria: DAFTAR kriteria yang HARUS dipenuhi sistem — SETIAP butir criteria HARUS menghasilkan minimal 1 test case
- Catatan Tambahan: informasi tambahan, constraint, atau edge case — WAJIB dimasukkan ke dalam test case

CARA MEMBUAT TEST CASE:
1. Baca setiap butir Acceptance Criteria satu per satu
2. Untuk setiap butir AC: buat minimal 1 TC_HAPPY (scenario berhasil) dan 1 TC_UNHAPPY (scenario gagal/edge case)
3. Tambahkan TC_REGRESSION untuk integrasi dengan fitur lain
4. Gunakan Catatan Tambahan sebagai tambahan scenario khusus (constraint, validasi, format data, dll)
5. Total test case MINIMAL = (jumlah butir AC × 2) + 2 regression. Jika ada 5 butir AC → minimal 12 test case

TIPE SKENARIO (hanya 3 pilihan, WAJIB salah satu):
- TC_HAPPY: Happy path — input valid, sistem berjalan normal, output sesuai ekspektasi
- TC_UNHAPPY: Unhappy path — input tidak valid, format salah, data kosong, batas melebihi limit, error handling, unauthorized access
- TC_REGRESSION: Regression — fitur yang sudah ada tidak rusak, integrasi dengan modul lain tetap berjalan

ATURAN WAJIB:
- SETIAP butir Acceptance Criteria HARUS punya test case (jangan lewatkan satupun)
- featureCategory HARUS berisi nama fitur yang diberikan (bukan user story)
- scenarioType HARUS salah satu dari: TC_HAPPY, TC_UNHAPPY, TC_REGRESSION
- SEMUA field output dalam Bahasa Indonesia
- Steps minimal 3, maksimal 7 langkah per test case
- Setiap step HARUS memiliki expected result yang sesuai dan spesifik
- Nama test case harus deskriptif: "Verifikasi [aksi] [kondisi] [hasil yang diharapkan]"

Respond ONLY with valid JSON (no explanation, no markdown, just JSON):
{
  "featureName": "nama fitur",
  "testCases": [
    {
      "name": "Verifikasi [aksi] [kondisi] menghasilkan [ekspektasi]",
      "featureCategory": "Nama fitur (sama dengan featureName di atas)",
      "scenarioType": "TC_HAPPY",
      "steps": [
        { "stepNumber": 1, "action": "Langkah pertama dalam Bahasa Indonesia" },
        { "stepNumber": 2, "action": "Langkah kedua dalam Bahasa Indonesia" }
      ],
      "expectedResult": [
        { "stepNumber": 1, "result": "Hasil yang diharapkan dari langkah 1" },
        { "stepNumber": 2, "result": "Hasil yang diharapkan dari langkah 2" }
      ]
    }
  ]
}"#;

        // ── Step 5: One AI call per feature (chunk = feature) ───────────
        let exec_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let feature_total = features.len();
        let mut all_test_cases: Vec<BRDTestCase> = Vec::new();
        let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

        for (feat_idx, (feature_name, feature_context)) in features.iter().enumerate() {
            eprintln!(
                "[BRD Gen] Chunk {}/{} — fitur: \"{}\"",
                feat_idx + 1, feature_total, feature_name
            );

            // Build the full prompt for this feature chunk
            let mut prompt_parts = vec![
                format!("Halaman BRD: {title}"),
                String::new(),
                format!("=== FITUR YANG HARUS DIGENERATE TEST CASE-NYA (fitur ke-{}/{}) ===", feat_idx + 1, feature_total),
                feature_context.clone(),
            ];

            if !proses_bisnis_plain.is_empty() {
                prompt_parts.push(String::new());
                prompt_parts.push("=== KONTEKS: Section 2.1 Proses Bisnis (untuk pemahaman sistem) ===".into());
                prompt_parts.push(proses_bisnis_plain.clone());
            }

            if !ocr_text.is_empty() {
                prompt_parts.push(String::new());
                prompt_parts.push("=== TEXT DARI DIAGRAM/SCREENSHOT (gunakan untuk memahami alur sistem) ===".into());
                prompt_parts.push(ocr_text.clone());
            }

            // Count AC bullet points to tell the model the minimum expected output
            let ac_count = feature_context
                .lines()
                .filter(|l| {
                    let t = l.trim();
                    !t.is_empty() && (t.starts_with('-') || t.starts_with('•') || t.starts_with('*')
                        || (t.len() > 2 && t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)))
                })
                .count()
                .max(3); // at least 3 AC assumed even if formatting wasn't detected

            prompt_parts.push(String::new());
            prompt_parts.push(format!(
                "INSTRUKSI WAJIB untuk fitur \"{feature_name}\" (fitur ke-{} dari {feature_total}):\n\
                 \n\
                 1. Baca SETIAP butir Acceptance Criteria di atas — ada sekitar {ac_count} butir.\n\
                 2. Untuk setiap butir AC buat MINIMAL 2 test case: satu TC_HAPPY (berhasil) dan satu TC_UNHAPPY (gagal/invalid).\n\
                 3. Tambahkan minimal 2 TC_REGRESSION untuk memastikan fitur ini tidak merusak fitur lain.\n\
                 4. Gunakan Catatan Tambahan sebagai scenario tambahan (constraint, format, validasi khusus).\n\
                 5. TOTAL test case yang diharapkan: MINIMAL {} test case.\n\
                 \n\
                 JANGAN buat hanya 1 test case. JANGAN lewatkan butir Acceptance Criteria manapun.\n\
                 WAJIB output seluruh test case dalam satu JSON response.\n\
                 Semua teks dalam Bahasa Indonesia.",
                feat_idx + 1,
                (ac_count * 2) + 2
            ));

            let full_prompt = format!("{system_prompt}\n\n{}", prompt_parts.join("\n"));

            let response = ollama_client
                .generate_text(&full_prompt, true, None, None)
                .await
                .unwrap_or_default();

            eprintln!(
                "[BRD Gen] Chunk {}/{} response: {} chars",
                feat_idx + 1, feature_total, response.len()
            );

            if response.len() < 10 {
                eprintln!("[BRD Gen] Chunk {}/{} — empty response, skipping", feat_idx + 1, feature_total);
                continue;
            }

            // Parse JSON response — handle both complete and truncated responses.
            // Strategy: try full parse first, then extract all complete {"name":...}
            // objects directly from the text so truncation never drops all cases.
            let cleaned = response
                .trim()
                .strip_prefix("```json")
                .or_else(|| response.trim().strip_prefix("```"))
                .map(|s| s.strip_suffix("```").unwrap_or(s))
                .unwrap_or(response.trim());

            let raw_cases: Vec<Value> = if let Ok(v) = serde_json::from_str::<Value>(cleaned) {
                // Full parse succeeded
                v.get("testCases").and_then(|a| a.as_array()).cloned().unwrap_or_default()
            } else {
                // Truncated — extract every complete {...} object that appears after
                // a "testCases" array opener. Walk char by char tracking brace depth
                // and collect each top-level object that parses cleanly.
                let mut cases: Vec<Value> = Vec::new();
                let bytes = cleaned.as_bytes();
                let len = bytes.len();
                // Skip to "testCases":[
                if let Some(start) = cleaned.find("\"testCases\"") {
                    let mut i = start;
                    // Advance to the '[' that opens the array
                    while i < len && bytes[i] != b'[' { i += 1; }
                    i += 1; // skip '['
                    // Now extract each top-level '{...}' object
                    while i < len {
                        // Skip whitespace and commas
                        while i < len && (bytes[i] == b' ' || bytes[i] == b'\n' || bytes[i] == b'\r' || bytes[i] == b'\t' || bytes[i] == b',') { i += 1; }
                        if i >= len || bytes[i] != b'{' { break; }
                        // Find matching closing brace
                        let obj_start = i;
                        let mut depth = 0i32;
                        let mut in_str = false;
                        let mut esc = false;
                        let mut j = i;
                        while j < len {
                            let b = bytes[j];
                            if esc { esc = false; j += 1; continue; }
                            if b == b'\\' && in_str { esc = true; j += 1; continue; }
                            if b == b'"' { in_str = !in_str; j += 1; continue; }
                            if !in_str {
                                if b == b'{' { depth += 1; }
                                else if b == b'}' { depth -= 1; if depth == 0 { j += 1; break; } }
                            }
                            j += 1;
                        }
                        if depth == 0 {
                            let obj_str = &cleaned[obj_start..j];
                            if let Ok(v) = serde_json::from_str::<Value>(obj_str) {
                                cases.push(v);
                            }
                        }
                        i = j;
                    }
                }
                eprintln!(
                    "[BRD Gen] Chunk {}/{} — partial parse extracted {}/{} test case objects",
                    feat_idx + 1, feature_total, cases.len(),
                    cleaned.matches("\"name\"").count()
                );
                cases
            };

            // Parse each test case
            let mut chunk_cases: Vec<BRDTestCase> = Vec::new();
            for tc in &raw_cases {
                let name = tc.get("name").and_then(|v| v.as_str()).unwrap_or("Unnamed TC").to_string();
                if !seen_names.insert(name.clone()) { continue; }

                let feature_category = tc
                    .get("featureCategory")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(feature_name.as_str())
                    .to_string();

                let raw_scenario = tc.get("scenarioType").and_then(|v| v.as_str()).unwrap_or("TC_HAPPY");
                let scenario_type = match raw_scenario {
                    "Positive" | "positive" | "Happy" | "happy" => "TC_HAPPY",
                    "Negative" | "negative" | "Boundary" | "boundary"
                    | "ErrorHandling" | "DataValidation" | "Security"
                    | "Performance" | "Integration" | "Usability" => "TC_UNHAPPY",
                    "Regression" | "regression" => "TC_REGRESSION",
                    other => if other.starts_with("TC_") { other } else { "TC_HAPPY" },
                }.to_string();

                let steps = tc.get("steps").and_then(|v| v.as_array())
                    .map(|arr| arr.iter().enumerate().map(|(i, s)| BRDTestCaseStep {
                        step_number: s.get("stepNumber").and_then(|v| v.as_i64()).unwrap_or((i + 1) as i64) as i32,
                        action: s.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    }).collect())
                    .unwrap_or_default();

                let expected = tc.get("expectedResult").and_then(|v| v.as_array())
                    .map(|arr| arr.iter().enumerate().map(|(i, s)| BRDTestCaseExpectedResult {
                        step_number: s.get("stepNumber").and_then(|v| v.as_i64()).unwrap_or((i + 1) as i64) as i32,
                        result: s.get("result").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    }).collect())
                    .unwrap_or_default();

                chunk_cases.push(BRDTestCase {
                    id: Uuid::new_v4().to_string(),
                    test_execution_id: exec_id.clone(),
                    name,
                    feature_category,
                    scenario_type,
                    steps,
                    expected_result: expected,
                    assignee: String::new(),
                    execution_status: "Unexecuted".to_string(),
                    sync_status: "Draft AI".to_string(),
                    jira_test_case_key: None,
                    last_updated: now.clone(),
                });
            }

            eprintln!(
                "[BRD Gen] Chunk {}/{} — {} test cases generated for \"{}\"",
                feat_idx + 1, feature_total, chunk_cases.len(), feature_name
            );

            if chunk_cases.is_empty() { continue; }

            // Persist this chunk to storage immediately so the frontend can read it
            {
                let mut store = self.load();
                store.test_cases.extend(chunk_cases.clone());
                let _ = self.save(&store);
            }

            // Emit progress event so the frontend can append these cards right away
            let _ = self.app_handle.emit(
                "brd-chunk-progress",
                BrdChunkProgress {
                    feature_index: feat_idx + 1,
                    feature_total,
                    feature_name: feature_name.clone(),
                    test_cases: chunk_cases.clone(),
                    test_execution_id: exec_id.clone(),
                },
            );

            all_test_cases.extend(chunk_cases);
        }

        if all_test_cases.is_empty() {
            return Err(ServiceError::Api(
                "Tidak ada test case yang berhasil digenerate. Cek koneksi ke Ollama model dan pastikan model berjalan."
                    .into(),
            ));
        }

        // Cases were already persisted individually after each chunk — return the full list.
        Ok(BRDGenerationResult {
            success: true,
            feature_name: title,
            test_cases: all_test_cases,
            test_execution_id: Some(exec_id),
            error: None,
        })
    }

    // ── Sync to Jira ───────────────────────────────────────────────────

    pub async fn sync_test_plan_to_jira(
        &self,
        config: &AppConfig,
        plan_id: &str,
    ) -> Result<Option<(String, String)>> {
        let data = self.load();
        let plan = data
            .test_plans
            .iter()
            .find(|p| p.id == plan_id)
            .ok_or_else(|| ServiceError::Api(format!("Test plan {plan_id} not found")))?
            .clone();

        let jira = crate::services::jira::JiraService::new();
        let description_text = format!("{}\n\nPhase: {}", plan.description, plan.phase);
        let result = jira
            .create_issue(
                &config.jira,
                &plan.project_key,
                "Test Plan",
                &plan.name,
                &description_text,
                None,
                None,
                None,
            )
            .await
            .map_err(|e| ServiceError::Api(format!("Failed to create Test Plan in Jira: {e}")))?;

        let mut data = self.load();
        if let Some(existing) = data.test_plans.iter_mut().find(|p| p.id == plan_id) {
            existing.jira_test_plan_key = Some(result.key.clone());
            existing.last_updated = Utc::now().to_rfc3339();
            self.save(&data)?;
        }

        Ok(Some((result.key, result.url)))
    }

    pub async fn sync_test_execution_to_jira(
        &self,
        config: &AppConfig,
        execution_id: &str,
    ) -> Result<Option<(String, String)>> {
        let data = self.load();
        let execution = data
            .test_executions
            .iter()
            .find(|e| e.id == execution_id)
            .ok_or_else(|| ServiceError::Api(format!("Test execution {execution_id} not found")))?
            .clone();

        let jira = crate::services::jira::JiraService::new();
        let description = format!(
            "Feature: {}\n\nPart of test management workflow.",
            execution.feature_name
        );
        let result = jira
            .create_issue(
                &config.jira,
                &execution.project_key,
                "Test Execution",
                &execution.name,
                &description,
                None,
                None,
                None,
            )
            .await
            .map_err(|e| ServiceError::Api(format!("Failed to create Test Execution in Jira: {e}")))?;

        let mut data = self.load();
        if let Some(existing) = data
            .test_executions
            .iter_mut()
            .find(|e| e.id == execution_id)
        {
            existing.jira_test_exec_key = Some(result.key.clone());
            existing.last_updated = Utc::now().to_rfc3339();
            self.save(&data)?;
        }

        Ok(Some((result.key, result.url)))
    }

    pub async fn sync_test_cases_to_jira(
        &self,
        config: &AppConfig,
        test_execution_id: &str,
        project_key: &str,
        folder_path: Option<&str>,
    ) -> Result<Vec<(String, bool, String)>> {
        let data = self.load();
        let cases: Vec<BRDTestCase> = data
            .test_cases
            .iter()
            .filter(|tc| tc.test_execution_id == test_execution_id)
            .cloned()
            .collect();

        let total = cases.len();
        if total == 0 {
            return Err(ServiceError::Api(
                "Tidak ada test case ditemukan untuk test_execution_id ini. Coba Generate ulang.".into(),
            ));
        }

        eprintln!("[BRD Sync] Memulai sync {} test case ke Jira project \"{}\"", total, project_key);

        let jira = crate::services::jira::JiraService::new();
        let mut results: Vec<(String, bool, String)> = Vec::new();
        let mut synced_keys: Vec<String> = Vec::new();

        // Use the project selected by the user, not the global config project
        let mut jira_cfg = config.jira.clone();
        if !project_key.is_empty() {
            jira_cfg.project_key = project_key.to_string();
        }

        // Resolve the accountId of whoever is running the sync (for the assignee field)
        let assignee_account_id: Option<String> = match jira.client(&jira_cfg) {
            Ok(client) => match client.get_current_user().await {
                Ok(user) => {
                    let id = user["accountId"].as_str().map(str::to_string);
                    eprintln!("[BRD Sync] Assignee: {} (accountId: {:?})",
                        user["displayName"].as_str().unwrap_or("unknown"), id);
                    id
                }
                Err(e) => {
                    eprintln!("[BRD Sync] Tidak bisa ambil current user, assignee akan dikosongkan: {e}");
                    None
                }
            },
            Err(e) => {
                eprintln!("[BRD Sync] Gagal membuat Jira client: {e}");
                None
            }
        };

        let mut done = 0usize;

        for tc in &cases {
            // Skip already-synced cases
            if tc.sync_status == "Synced to Jira" && tc.jira_test_case_key.is_some() {
                let key = tc.jira_test_case_key.clone().unwrap_or_default();
                synced_keys.push(key.clone());
                results.push((key, true, String::new()));
                done += 1;
                eprintln!("[BRD Sync] [{}/{}] ({:.0}%) SKIPPED (sudah sync): \"{}\"",
                    done, total, done as f64 / total as f64 * 100.0, tc.name);
                continue;
            }

            // ── Build description: Test Steps section + Expected Result section ──
            let steps_lines: String = tc
                .steps
                .iter()
                .map(|s| format!("{}. {}", s.step_number, s.action))
                .collect::<Vec<_>>()
                .join("\n");
            let expected_lines: String = tc
                .expected_result
                .iter()
                .map(|r| format!("{}. {}", r.step_number, r.result))
                .collect::<Vec<_>>()
                .join("\n");
            let description = format!(
                "Test Steps\n{steps_lines}\n\nExpected Result\n{expected_lines}"
            );

            // ── Build the Jira issue payload with ONLY the 5 required fields ──
            let mut fields = serde_json::json!({
                "project":   { "key": jira_cfg.project_key },
                "summary":   tc.name,
                "issuetype": { "name": "Test" },
                "description": description,
                "labels": [tc.scenario_type.clone()],
            });

            // assignee — only set when we successfully resolved accountId
            if let Some(ref account_id) = assignee_account_id {
                fields["assignee"] = serde_json::json!({ "accountId": account_id });
            }

            let body = serde_json::json!({ "fields": fields });

            match jira.client(&jira_cfg) {
                Err(e) => {
                    let msg = format!("Client error: {e}");
                    eprintln!("[BRD Sync] [{}/{}] ERROR: \"{}\" — {}", done + 1, total, tc.name, msg);
                    results.push((tc.name.clone(), false, msg));
                }
                Ok(client) => {
                    match client.api.post_json("/issue", &body).await {
                        Ok(resp) => {
                            let key = resp["key"].as_str().unwrap_or("").to_string();
                            done += 1;
                            eprintln!("[BRD Sync] [{}/{}] ({:.0}%) OK: \"{}\" → {}",
                                done, total, done as f64 / total as f64 * 100.0, tc.name, key);

                            // Persist jira key + sync status locally
                            let mut store = self.load();
                            if let Some(existing) = store.test_cases.iter_mut().find(|c| c.id == tc.id) {
                                existing.jira_test_case_key = Some(key.clone());
                                existing.sync_status = "Synced to Jira".to_string();
                                existing.last_updated = Utc::now().to_rfc3339();
                                let _ = self.save(&store);
                            }
                            synced_keys.push(key.clone());
                            results.push((key, true, String::new()));
                        }
                        Err(e) => {
                            let msg = e.to_string();
                            eprintln!("[BRD Sync] [{}/{}] FAIL: \"{}\" — {}", done + 1, total, tc.name, msg);
                            results.push((tc.name.clone(), false, msg));
                        }
                    }
                }
            }
        }

        let succeeded = results.iter().filter(|r| r.1).count();
        let failed = results.iter().filter(|r| !r.1).count();
        eprintln!("[BRD Sync] Selesai: {} berhasil, {} gagal", succeeded, failed);

        // Move all successfully-synced test cases into the chosen Xray folder
        if let Some(fp) = folder_path {
            if !fp.is_empty() && !synced_keys.is_empty() {
                eprintln!("[BRD Sync] Memindahkan {} issue ke folder \"{}\"", synced_keys.len(), fp);
                if let Ok(client) = jira.client(&jira_cfg) {
                    match client.move_tests_to_folder(&jira_cfg.project_key, fp, &synced_keys).await {
                        Ok(()) => eprintln!("[BRD Sync] Folder assignment berhasil"),
                        Err(e) => eprintln!("[BRD Sync] Folder assignment gagal (non-fatal): {e}"),
                    }
                }
            }
        }

        Ok(results)
    }

    // ── Monitoring ─────────────────────────────────────────────────────

    pub fn get_monitoring_data(
        &self,
        test_execution_id: Option<&str>,
    ) -> Vec<ExecutionMonitoringData> {
        let data = self.load();
        let executions = if let Some(exec_id) = test_execution_id {
            data.test_executions
                .iter()
                .filter(|e| e.id == exec_id)
                .cloned()
                .collect::<Vec<_>>()
        } else {
            data.test_executions.clone()
        };

        executions
            .into_iter()
            .map(|exec| {
                let cases: Vec<&BRDTestCase> = data
                    .test_cases
                    .iter()
                    .filter(|tc| tc.test_execution_id == exec.id)
                    .collect();
                let total = cases.len();
                let passed = cases.iter().filter(|tc| tc.execution_status == "Pass").count();
                let failed = cases.iter().filter(|tc| tc.execution_status == "Fail").count();
                let blocked = cases.iter().filter(|tc| tc.execution_status == "Blocked").count();
                let unexecuted = cases.iter().filter(|tc| tc.execution_status == "Unexecuted").count();
                let pass_rate = if total > 0 {
                    (passed as f64 / total as f64) * 100.0
                } else {
                    0.0
                };

                ExecutionMonitoringData {
                    test_execution_id: exec.id,
                    test_execution_name: exec.name,
                    total,
                    passed,
                    failed,
                    blocked,
                    unexecuted,
                    pass_rate,
                }
            })
            .collect()
    }

    // ── Semantic Search ────────────────────────────────────────────────

    pub async fn semantic_search(
        &self,
        config: &AppConfig,
        query: &str,
        project_key: &str,
    ) -> Result<Vec<crate::models::brd::SemanticSearchResult>> {
        let jira = crate::services::jira::JiraService::new();
        let jql = format!(
            "project = {} AND issuetype in (\"Test Case\", \"Test\", \"Task\") ORDER BY updated DESC",
            project_key
        );
        let issues = jira
            .find_issues_by_jql(&config.jira, &jql, 50)
            .await
            .map_err(|e| ServiceError::Api(format!("JQL search failed: {e}")))?;

        let model = &config.ollama.model;
        let endpoint = &config.ollama.endpoint;
        eprintln!("[BRD SemanticSearch] Using endpoint={endpoint}, model={model}, query=\"{query}\"");
        let ollama_client = OllamaClient::new(endpoint, model);
        let issues_context: String = issues
            .iter()
            .map(|i| format!("{}: {} [{}]", i.key, i.summary, i.status))
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "You are a semantic search matcher. Given a user query and a list of Jira issues, \
             identify which issues are semantically related to the query. \
             Respond with JSON array only: [{{ \"issueKey\": \"...\", \"summary\": \"...\", \
             \"score\": 0.0-1.0, \"matchReason\": \"...\" }}]\n\n\
             User query: \"{}\"\n\nProject: {}\n\nAvailable issues:\n{}\n\n\
             Return matching issues with relevance scores.",
            query, project_key, issues_context
        );

        let response = ollama_client
            .generate_text(&prompt, true, None, None)
            .await;

        eprintln!("[BRD SemanticSearch] generate_text returned: {:?}", response.as_deref().unwrap_or("None"));

        match response {
            Some(resp) => {
                let cleaned = resp
                    .trim()
                    .strip_prefix("```json")
                    .or_else(|| resp.trim().strip_prefix("```"))
                    .map(|s| s.strip_suffix("```").unwrap_or(s))
                    .unwrap_or(resp.trim());

                let parsed = serde_json::from_str::<Vec<crate::models::brd::SemanticSearchResult>>(cleaned)
                    .or_else(|_| {
                        // Ollama sometimes wraps the array in {"issues": [...]}
                        #[derive(serde::Deserialize)]
                        struct Wrapper {
                            issues: Vec<crate::models::brd::SemanticSearchResult>,
                        }
                        serde_json::from_str::<Wrapper>(cleaned).map(|w| w.issues)
                    });
                match parsed {
                    Ok(results) => {
                        let mut filtered: Vec<_> = results.into_iter().filter(|r| r.score >= 0.5).collect();
                        filtered.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
                        Ok(filtered)
                    },
                    Err(e) => {
                        eprintln!("[BRD SemanticSearch] JSON parse failed: {e}, cleaned: {cleaned}");
                        Ok(self.fallback_search(query, &issues))
                    }
                }
            }
            None => Ok(self.fallback_search(query, &issues)),
        }
    }

    fn fallback_search(
        &self,
        query: &str,
        issues: &[crate::models::connection::JiraIssueSummary],
    ) -> Vec<crate::models::brd::SemanticSearchResult> {
        let q_lower = query.to_lowercase();
        let q_terms: Vec<&str> = q_lower.split_whitespace().collect();
        issues
            .iter()
            .filter_map(|i| {
                let s_lower = i.summary.to_lowercase();
                let matches = q_terms.iter().filter(|t| s_lower.contains(*t)).count();
                let score = if q_terms.is_empty() {
                    0.0
                } else {
                    matches as f64 / q_terms.len() as f64
                };
                if score > 0.0 {
                    Some(crate::models::brd::SemanticSearchResult {
                        issue_key: i.key.clone(),
                        summary: i.summary.clone(),
                        score,
                        match_reason: format!(
                            "Keyword match: {}/{} terms",
                            matches,
                            q_terms.len()
                        ),
                    })
                } else {
                    None
                }
            })
            .collect()
    }
}


