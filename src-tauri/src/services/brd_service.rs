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
use crate::services::rag::RagService;

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
        //
        // BRD authors routinely restart plain numbering from 1 for their OWN
        // sub-narrative inside a feature description (e.g. "1. Proses Transaksi
        // di Merchant", "2. Proses Pembayaran di QITA", "3. …", "4. …" as h3/h4
        // flow steps inside a feature's "Catatan Tambahan"/"Acceptance Criteria"
        // cell). Those restarts can themselves reach numbers >= the current
        // section's own number (2, 3, 4…), so comparing leading numbers alone
        // isn't reliable either. What actually distinguishes a real sibling
        // section heading in this BRD template is a two-part DECIMAL number
        // ("2.2", "3.1" — never a bare "2." or "3." on its own), or the literal
        // "Aturan Bisnis" section title that always immediately follows "Proses
        // Bisnis" in this template. A heading only counts as a real sibling if
        // it matches one of those two shapes AND isn't a sub-section of 2.1
        // itself (2.1.2, 2.1.3, …).
        let heading_only_re  = regex::Regex::new(r"(?i)<h([1-6])\b[^>]*>([\s\S]*?)</h[1-6]>").unwrap();
        let tag_strip2       = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
        // Matches a real decimal section number: "2.2 ...", "3.1 ..." etc.
        // (deliberately requires the second numeric component — bare "3. Judul"
        // style numbering is how in-feature narrative flow steps are written).
        let decimal_section_re = regex::Regex::new(r"^\d+\.\d+\b").unwrap();

        // Fallback for BRDs that skip straight from "2.1 Proses Bisnis" to the
        // next top-level chapter without a "2.2"/"Aturan Bisnis" section:
        // a bare "N. Judul" heading only counts as a real chapter boundary when
        // it's an <h1> — in-feature narrative flow steps use h3/h4 (see above),
        // never h1, for their restarted "1. / 2. / 3. …" numbering.
        let bare_section_re = regex::Regex::new(r"^(\d+)[\.\s]").unwrap();

        let end_pos = heading_only_re.captures_iter(s)
            .filter_map(|cap| {
                let pos = cap.get(0)?.start();
                if pos <= start_pos { return None; }
                let level: u8 = cap[1].parse().unwrap_or(6);
                let text = tag_strip2.replace_all(&cap[2], " ");
                let text = text.trim().to_lowercase();
                // Not a sub-section of 2.1 itself (2.1.2, 2.1.3…)
                if text.starts_with("2.1") { return None; }
                let is_sibling = decimal_section_re.is_match(&text)
                    || text.contains("aturan bisnis")
                    || (level == 1 && bare_section_re.is_match(&text));
                if is_sibling {
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

    /// Extract per-feature rows from the "Fungsi-Fungsi yang Diharapkan" table
    /// inside the Proses Bisnis section HTML. The section number (e.g. 2.1.3)
    /// is ignored — only the title text is matched.
    /// Returns a Vec of (feature_name, feature_full_text, image_filenames) — one entry per table row.
    fn extract_fungsi_features(proses_bisnis_html: &str) -> Vec<(String, String, Vec<String>)> {
        let s = proses_bisnis_html;

        // ── Step 1: Try to narrow down to the "Fungsi-Fungsi yang Diharapkan" sub-section ──
        // Match any heading/block element whose plain text CONTAINS "fungsi" AND "diharapkan"
        // regardless of any section number prefix (2.1.3, 3.2.1, etc.).
        let heading_block_re = regex::Regex::new(
            r#"(?is)<(?:h[1-6]|p|div)\b[^>]*>([\s\S]*?)</(?:h[1-6]|p|div)>"#
        ).unwrap();
        let tag_strip_re = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
        let ws_re = regex::Regex::new(r"\s+").unwrap();

        let clean_text = |raw: &str| -> String {
            let no_tags = tag_strip_re.replace_all(raw, " ");
            ws_re.replace_all(no_tags.trim(), " ").trim().to_string()
        };

        // Find first block whose text contains both "fungsi" and "diharapkan" (case-insensitive)
        let fungsi_pos: Option<usize> = heading_block_re.find_iter(s).find_map(|m| {
            let text = clean_text(&s[m.start()..m.end()]).to_lowercase();
            if text.contains("fungsi") && text.contains("diharapkan") {
                Some(m.start())
            } else {
                None
            }
        });

        let section_html: &str = if let Some(pos) = fungsi_pos {
            eprintln!("[BRD Gen] Found \"Fungsi-Fungsi yang Diharapkan\" section at byte {}", pos);
            &s[pos..]
        } else {
            eprintln!("[BRD Gen] \"Fungsi-Fungsi yang Diharapkan\" heading not found, scanning full Proses Bisnis HTML for table");
            s
        };

        // ── Step 2: Parse all tables using a tag-depth tokenizer ─────────
        // Regex non-greedy matching breaks on nested tags inside cells
        // (Confluence macros, nested divs, etc.). We tokenize by scanning
        // for opening/closing tags and tracking nesting depth instead.

        // Rich cell text: strips tags but preserves nested table row structure ("|" separated)
        // and extracts Confluence image attachment filenames from <ri:attachment> / <ac:image>.
        // Returns (plain_text, Vec<attachment_filename>)
        let rich_cell_text = |raw: &str| -> (String, Vec<String>) {
            // Extract Confluence image attachment filenames
            let ri_re = regex::Regex::new(
                r#"(?i)<ri:attachment\b[^>]*\bri:filename\s*=\s*"([^"]+)"[^>]*/?>|<img\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*/?>|<ac:image[^>]*>\s*<ri:attachment\b[^>]*\bri:filename\s*=\s*"([^"]+)""#
            ).unwrap();
            let images: Vec<String> = ri_re.captures_iter(raw)
                .filter_map(|c| {
                    c.get(1).or(c.get(2)).or(c.get(3)).map(|m| m.as_str().to_string())
                })
                .filter(|s| !s.is_empty())
                .collect();

            // Convert nested tables to readable text: each <tr> becomes a "| col | col |" line
            let tr_re    = regex::Regex::new(r"(?is)<tr\b[^>]*>([\s\S]*?)</tr>").unwrap();
            let td_th_re = regex::Regex::new(r"(?is)<t[dh][^>]*>([\s\S]*?)</t[dh]>").unwrap();
            let table_re2 = regex::Regex::new(r"(?is)<table\b[^>]*>[\s\S]*?</table>").unwrap();

            // Replace nested tables with a text representation before stripping tags
            let with_tables_flattened = table_re2.replace_all(raw, |caps: &regex::Captures| {
                let table_html = &caps[0];
                let mut table_text = String::from("\n");
                for tr_cap in tr_re.captures_iter(table_html) {
                    let cells: Vec<String> = td_th_re.captures_iter(&tr_cap[1])
                        .map(|c| {
                            let no_tags = tag_strip_re.replace_all(&c[1], " ");
                            ws_re.replace_all(no_tags.trim(), " ").trim().to_string()
                        })
                        .filter(|s| !s.is_empty())
                        .collect();
                    if !cells.is_empty() {
                        table_text.push_str(&format!("| {} |\n", cells.join(" | ")));
                    }
                }
                table_text
            });

            let no_tags = tag_strip_re.replace_all(&with_tables_flattened, " ");
            let collapsed = ws_re.replace_all(no_tags.trim(), " ");
            let text = collapsed.trim().to_string();
            (text, images)
        };

        // Tokenize: split HTML into a flat list of (tag_name, is_closing, start, end)
        // tag spans so we can walk them depth-aware.
        let tag_token_re = regex::Regex::new(r"(?i)<(/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>").unwrap();

        // Column-header detection helpers
        // Feature/requirement name column — covers both "Feature"/"Fitur" style BRDs
        // and "Requirement Name" style BRDs
        let is_feature_header = |h: &str| -> bool {
            let lower = h.to_lowercase();
            lower == "feature" || lower == "fitur"
                || lower.starts_with("feature") || lower.starts_with("fitur")
                || lower.contains("requirement name") || lower.contains("nama requirement")
                || lower.contains("nama fitur") || lower.contains("requirement")
                || lower == "name" || lower == "nama"
        };
        // Acceptance criteria / expected output columns
        let is_ac_header = |h: &str| -> bool {
            let lower = h.to_lowercase();
            lower.contains("acceptance") || lower.contains("criteria") || lower.contains("kriteria")
                || lower.contains("expected output") || lower.contains("output")
                || lower.contains("test requirement") || lower.contains("test req")
                || lower.contains("skenario") || lower.contains("scenario")
                || lower.contains("requirement detail") || lower.contains("deskripsi")
        };
        // Business flow / context column
        let is_flow_header = |h: &str| -> bool {
            let lower = h.to_lowercase();
            lower.contains("business flow") || lower.contains("alur bisnis")
                || lower.contains("flow") || lower.contains("alur")
                || lower.contains("proses") || lower.contains("process")
        };
        // Notes / additional info column
        let is_notes_header = |h: &str| -> bool {
            let lower = h.to_lowercase();
            lower.contains("catatan") || lower.contains("tambahan") || lower.contains("notes")
                || lower.contains("keterangan") || lower.contains("additional")
                || lower.contains("test requirement") || lower.contains("test req")
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
        // Returns Vec of rows, each row is Vec of (plain_text, image_filenames) per cell.
        // table_depth starts at -1 so the outer <table> tag brings it to 0.
        let extract_rows = |table_html: &str| -> Vec<Vec<(String, Vec<String>)>> {
            let mut rows: Vec<Vec<(String, Vec<String>)>> = Vec::new();
            let mut row_cells: Vec<(String, Vec<String>)> = Vec::new();
            let mut cell_start = 0usize;
            let mut in_cell = false;
            let mut table_depth: i32 = -1;
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
                                row_cells.push(rich_cell_text(raw));
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

        // Build the full candidate list up front: tables from the narrowed
        // slice first (fast path for well-formed pages), THEN every other
        // table in the untruncated section not already included. This
        // matters because if the heading sits INSIDE a table used purely for
        // page layout (common in Confluence templates: a wrapping
        // <table><tr><td>…heading…nested data table…</td></tr></table>),
        // slicing at the heading's byte position cuts off that wrapper's
        // opening <table> tag. The depth-aware tokenizer then desyncs on the
        // wrapper's lone closing </table> and either finds nothing, or finds
        // only small, unrelated tables that happen to be fully contained
        // after the heading (e.g. callout/info boxes) — neither of which is
        // an "empty list", so a fallback gated on emptiness alone would never
        // trigger. Always append the full-document candidates instead, and
        // let the per-table row/header checks below pick the real one.
        let narrowed_tables = extract_tables(section_html);
        let mut candidate_tables = narrowed_tables.clone();
        if fungsi_pos.is_some() {
            let all_tables = extract_tables(s);
            let heading_pos = fungsi_pos.unwrap();
            let already: std::collections::HashSet<&String> = narrowed_tables.iter().collect();
            // Prefer tables at/after the heading; fall back to any table at
            // all (in case byte offsets don't line up cleanly across scans).
            let mut after: Vec<String> = Vec::new();
            let mut before: Vec<String> = Vec::new();
            for t in all_tables {
                if already.contains(&t) { continue; }
                if let Some(t_pos) = s.find(&t) {
                    if t_pos >= heading_pos { after.push(t); continue; }
                }
                before.push(t);
            }
            if !after.is_empty() || !before.is_empty() {
                eprintln!("[BRD Gen] Adding {} extra candidate(s) from full Proses Bisnis HTML ({} after heading, {} before)",
                    after.len() + before.len(), after.len(), before.len());
            }
            candidate_tables.extend(after);
            candidate_tables.extend(before);
        }

        eprintln!("[BRD Gen] {} candidate table(s) found for row/header parsing", candidate_tables.len());

        for (t_idx, table_html) in candidate_tables.iter().enumerate() {
            let rows = extract_rows(table_html);
            eprintln!("[BRD Gen] Candidate table {t_idx}: {} chars, {} rows parsed", table_html.len(), rows.len());

            if rows.len() < 2 {
                eprintln!("[BRD Gen] Candidate table {t_idx} skipped (fewer than 2 rows)");
                continue;
            }

            // Header detection uses plain text only (no images in headers)
            let text_rows: Vec<Vec<String>> = rows.iter()
                .map(|row| row.iter().map(|(t, _)| t.clone()).collect())
                .collect();

            let header_row_idx = text_rows.iter().take(5).position(|row| {
                row.iter().any(|cell| is_feature_header(cell))
                    || row.iter().any(|cell| is_ac_header(cell))
                    || row.iter().any(|cell| is_flow_header(cell))
            });

            let Some(hdr_idx) = header_row_idx else {
                eprintln!("[BRD Gen] Table skipped (no recognisable header in first 5 rows). Headers: {:?}",
                    text_rows.get(0).map(|r| r.iter().take(5).collect::<Vec<_>>()));
                continue;
            };

            let header: Vec<String> = text_rows[hdr_idx].clone();
            eprintln!("[BRD Gen] Header row {}: {:?}", hdr_idx, header.iter().take(6).collect::<Vec<_>>());

            let feature_col = header.iter().position(|h| is_feature_header(h));
            let ac_col      = header.iter().position(|h| is_ac_header(h));
            let flow_col    = header.iter().position(|h| is_flow_header(h));
            let notes_col   = header.iter().position(|h| is_notes_header(h)
                && header.iter().position(|h2| is_notes_header(h2)) != ac_col);

            eprintln!("[BRD Gen] Column mapping: feature={:?} ac={:?} flow={:?} notes={:?}",
                feature_col, ac_col, flow_col, notes_col);

            let Some(feat_idx) = feature_col.or_else(|| {
                header.iter().position(|h| {
                    let l = h.to_lowercase();
                    l != "no" && l != "#" && l != "no." && !l.is_empty()
                })
            }) else { continue };

            let mut features: Vec<(String, String, Vec<String>)> = Vec::new();

            for row in &rows[hdr_idx + 1..] {
                let (feature_raw, _) = row.get(feat_idx).cloned().unwrap_or_default();
                if feature_raw.trim().is_empty() {
                    continue;
                }

                // Collect all image filenames from every cell in this row
                let mut row_images: Vec<String> = row.iter()
                    .flat_map(|(_, imgs)| imgs.clone())
                    .collect();
                row_images.dedup();

                let is_boilerplate = |line: &str| -> bool {
                    let l = line.trim().to_lowercase();
                    // user story template lines
                    l.starts_with("as a") || l.starts_with("as an")
                        || l.starts_with("i want") || l.starts_with("i need")
                        || l.starts_with("sebagai") || l.starts_with("saya ingin")
                        || l.starts_with("saya dapat") || l.starts_with("agar")
                        // format instruction lines like "Gunakan format :", "…", single words
                        || l == "…" || l == "..." || l.ends_with("format :")
                        || l.ends_with("format:") || l == "cdd" || l == "admin"
                        || l == "nasabah" || l == "maker" || l == "signer"
                        || l.chars().count() <= 3  // very short lines are role labels
                };
                // Prefer the LAST substantive line (the actual feature description usually
                // appears at the bottom of the cell, after "As a / I want" template lines)
                let feature_name = feature_raw
                    .lines()
                    .filter(|l| !l.trim().is_empty() && !is_boilerplate(l))
                    .last()
                    .or_else(|| feature_raw.lines().find(|l| !l.trim().is_empty()))
                    .unwrap_or(feature_raw.trim())
                    .trim()
                    .trim_end_matches('.')
                    .to_string();

                let mut context_parts = vec![format!("Feature (nama fitur):\n{}", feature_name)];

                let user_story_lines: String = feature_raw
                    .lines()
                    .filter(|l| !l.trim().is_empty() && l.trim() != feature_name)
                    .collect::<Vec<_>>()
                    .join("\n");
                if !user_story_lines.is_empty() {
                    context_parts.push(format!("Konteks fitur (user story):\n{user_story_lines}"));
                }

                if let Some(ac_idx) = ac_col {
                    if let Some((ac, _)) = row.get(ac_idx) {
                        if !ac.trim().is_empty() {
                            let col_label = header.get(ac_idx).map(|h| h.as_str())
                                .unwrap_or("Acceptance Criteria / Expected Output");
                            context_parts.push(format!("{col_label}:\n{ac}"));
                        }
                    }
                }
                if let Some(flow_idx) = flow_col {
                    if Some(flow_idx) != ac_col {
                        if let Some((flow, _)) = row.get(flow_idx) {
                            if !flow.trim().is_empty() {
                                let col_label = header.get(flow_idx).map(|h| h.as_str())
                                    .unwrap_or("Business Flow");
                                context_parts.push(format!("{col_label}:\n{flow}"));
                            }
                        }
                    }
                }
                if let Some(notes_idx) = notes_col {
                    if Some(notes_idx) != ac_col && Some(notes_idx) != flow_col {
                        if let Some((notes, _)) = row.get(notes_idx) {
                            if !notes.trim().is_empty() {
                                let col_label = header.get(notes_idx).map(|h| h.as_str())
                                    .unwrap_or("Catatan Tambahan");
                                context_parts.push(format!("{col_label}:\n{notes}"));
                            }
                        }
                    }
                }
                // Remaining columns
                for (col_idx, col_header) in header.iter().enumerate() {
                    if col_idx == feat_idx
                        || Some(col_idx) == ac_col
                        || Some(col_idx) == flow_col
                        || Some(col_idx) == notes_col
                    { continue; }
                    let l = col_header.to_lowercase();
                    if l == "no" || l == "#" || l == "no." || l.is_empty() { continue; }
                    if let Some((val, _)) = row.get(col_idx) {
                        if !val.trim().is_empty() {
                            context_parts.push(format!("{col_header}:\n{val}"));
                        }
                    }
                }

                features.push((feature_name, context_parts.join("\n\n"), row_images));
            }

            if !features.is_empty() {
                eprintln!("[BRD Gen] Extracted {} features from Fungsi-Fungsi yang Diharapkan table", features.len());
                return features;
            }
        }

        eprintln!("[BRD Gen] No feature table found in Fungsi-Fungsi yang Diharapkan section");
        Vec::new()
    }

    /// Fetch image attachments from the Confluence page and run OCR on them.
    /// If `only_filenames` is non-empty, only attachments whose title matches one of those
    /// filenames are processed (used for per-feature OCR of images in "Catatan Tambahan" cells).
    /// If `only_filenames` is empty, all image attachments are processed (up to `limit`).
    async fn extract_image_ocr(
        &self,
        config: &crate::models::app_config::ConfluenceConfig,
        page_id: &str,
        only_filenames: &[String],
        limit: usize,
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
                let is_image = ct.starts_with("image/") || mime.starts_with("image/");
                if !is_image { return false; }
                if only_filenames.is_empty() { return true; }
                let title = att["title"].as_str().unwrap_or("").to_lowercase();
                only_filenames.iter().any(|f| f.to_lowercase() == title)
            })
            .take(limit)
            .collect();

        if image_attachments.is_empty() {
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
                        "[Gambar dari Catatan Tambahan — {}: {}]\n{}",
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

        // ── Step 2: Extract per-feature rows from Fungsi-Fungsi yang Diharapkan table ──
        let features = Self::extract_fungsi_features(&proses_bisnis_html);

        if features.is_empty() {
            return Err(ServiceError::Api(
                "Tabel fitur tidak ditemukan pada halaman Confluence ini. \
                 Pastikan halaman memiliki heading yang mengandung teks \"Fungsi-Fungsi yang Diharapkan\" \
                 dan tabel dengan kolom \"Feature\" atau \"Fitur\"."
                    .into(),
            ));
        }

        eprintln!("[BRD Gen] {} fitur ditemukan pada tabel Fungsi-Fungsi yang Diharapkan", features.len());

        // ── Step 3: Plain-text context of the full Proses Bisnis section ─
        // Kept short — only background context, not the feature detail itself.
        // The per-feature row already contains the relevant AC/flow/notes columns.
        let proses_bisnis_plain = {
            let full = crate::services::text_utils::strip_html(&proses_bisnis_html);
            if full.len() > 2000 { format!("{}…", &full[..2000]) } else { full }
        };

        // ── Step 4: Pre-fetch all attachment metadata once for per-feature OCR ─
        // We fetch the list upfront so each feature can do targeted OCR without
        // making a separate list API call. Actual image bytes are fetched on demand.
        let confluence_for_ocr = ConfluenceService::new();
        let all_attachments: Vec<Value> = confluence_for_ocr
            .get_attachments(&config.confluence, &request.confluence_page_id)
            .await
            .unwrap_or_default();
        eprintln!("[BRD Gen] Found {} total attachments on page", all_attachments.len());

        let model = config.ollama.extraction_model.as_deref().unwrap_or(&config.ollama.model);

        let system_prompt = r#"Kamu adalah QA engineer senior perbankan Indonesia dengan pengalaman mendalam menguji sistem core banking, payment, dan integrasi antar-layanan. Tugasmu: menganalisis SATU fitur BRD secara menyeluruh dan menghasilkan test case yang benar-benar melacak setiap kondisi yang bisa terjadi di lapangan — bukan sekadar satu TC per kategori.

── CARA MENGANALISIS FITUR (lakukan ini secara diam-diam sebelum menulis JSON) ──
Baca requirement (user story, Acceptance Criteria, Business Flow, Catatan Tambahan) dan pecah menjadi daftar elemen yang bisa diuji:
  a. Setiap FIELD INPUT yang disebut (nomor, nominal, tanggal, kode, PIN, dsb) — dan aturan validasinya (wajib/opsional, format, panjang, batas nilai minimum/maksimum).
  b. Setiap KONDISI/CABANG yang disebut secara eksplisit di requirement (mis. "jika terdaftar" vs "jika tidak terdaftar", "jika saldo cukup" vs "tidak cukup", "eligible" vs "tidak eligible", pilihan tenor/skema, status sukses/gagal dari sistem lain).
  c. Setiap SISTEM/LAYANAN LAIN yang berinteraksi dengan fitur ini (disebut di Business Flow atau Catatan Tambahan) — ini kandidat TC_REGRESSION jika responsnya memengaruhi hasil.
  d. Aturan BISNIS/PERHITUNGAN yang disebut (fee, rounding, limit, prioritas, urutan proses) — ini sumber TC_UNHAPPY batas nilai (boundary) dan TC_HAPPY variasi hasil.
Dari daftar itu, rancang test case yang MELACAK SETIAP ITEM secara individual — jangan menggabungkan dua kondisi berbeda ke dalam satu TC, dan jangan melewatkan kondisi yang disebut eksplisit di requirement hanya karena terlihat kecil.

── ATURAN PENULISAN TEST CASE ──
1. Gunakan HANYA role/aktor/sistem yang disebut eksplisit di requirement. Jangan mengarang Maker/Signer/OTP/dsb kalau tidak disebutkan.
2. Klasifikasi:
   - TC_HAPPY: setiap jalur berhasil (success path) YANG BERBEDA — termasuk variasi input valid yang menghasilkan hasil/cabang berbeda (mis. metode pembayaran A vs B, tenor 1 vs 3 bulan, eligible vs kondisi lain yang tetap sukses). Bukan hanya satu "happy path" tunggal.
   - TC_UNHAPPY: SETIAP field wajib diuji kosong satu per satu (bukan digabung), setiap aturan format/panjang diuji dengan nilai salah, setiap batas nilai (boundary: tepat di batas, sedikit di bawah, sedikit di atas) bila requirement menyebut angka/limit, dan setiap kondisi "gagal"/"tidak eligible"/"tidak terdaftar"/"ditolak" yang disebut di requirement.
   - TC_REGRESSION: HANYA jika requirement menyebut integrasi dengan modul/sistem lain (mis. Way4, BRINET, Kafka, core banking lain) DAN ada skenario di mana sistem lain itu gagal/lambat/mengembalikan data tak terduga yang harus ditangani fitur ini. Jangan buat TC_REGRESSION jika tidak ada integrasi eksplisit.
3. JANGAN membuat generalisasi seperti "Input tidak valid" untuk mewakili banyak field — pecah menjadi TC terpisah per field/per aturan validasi yang disebut requirement.
4. Jika requirement menyebutkan >1 channel/tampilan (mis. remark tampil di SMS, WA, Email, atau di QITA, BCCM, Billing Statement), buat TC yang memverifikasi tiap channel bila formatnya bisa berbeda per channel; jika formatnya identik di semua channel, cukup satu TC yang menyebutkan seluruh channel di expected result — jangan duplikasi TC yang isinya sama persis.
5. Satu skenario/kondisi = satu TC terpisah. Jangan digabung menjadi satu TC besar.
6. Nama TC: kalimat natural berbahasa Indonesia yang deskriptif dan spesifik tentang KONDISI yang diuji (bukan judul generik seperti "Test Berhasil"), TANPA prefix/kategori (jangan diawali "TC_HAPPY", "Happy Path:", "TC_UNHAPPY", dsb — kategori sudah ada di field scenarioType terpisah) dan TANPA format identifier seperti snake_case atau PascalCase (contoh SALAH: "TC_HAPPY_GenerateToken_Success", "Inquiry_Success_CardholderName_Available"). Tidak harus diawali "Verifikasi".
7. Steps: 3–8 langkah, setiap step punya expected result spesifik yang bisa diverifikasi (bukan hanya "berhasil" atau "sesuai").
8. Sebelum selesai, periksa ulang: apakah ada field wajib, kondisi eksplisit, atau integrasi di requirement yang BELUM punya TC? Jika ada, tambahkan.
9. JANGAN berhenti sebelum JSON ditutup. Output harus JSON lengkap dan valid.

── featureCategory (WAJIB, satu nilai untuk SELURUH fitur ini) ──
Analisis judul dan isi fitur ini secara menyeluruh, lalu simpulkan MODUL UTAMA yang diuji dalam 1-3 kata singkat berbahasa Indonesia (contoh: "Notifikasi Transaksi", "Billing", "Rekonsiliasi", "Tokenisasi", "Migrasi Data"). Ini BUKAN ringkasan judul fitur, melainkan nama modul/domain fungsional yang paling mewakili fitur ini secara umum.
featureCategory ditulis SATU KALI di root JSON (bukan per test case) — nilai yang sama ini otomatis berlaku untuk semua test case dari fitur ini.

Output HANYA raw JSON:
{"featureName":"...","featureCategory":"...","testCases":[{"name":"...","scenarioType":"TC_HAPPY|TC_UNHAPPY|TC_REGRESSION","steps":[{"stepNumber":1,"action":"..."}],"expectedResult":[{"stepNumber":1,"result":"..."}]}]}"#;

        // ── Step 5: Parallel AI calls — one per feature ─────────────────
        // All features are sent to Ollama concurrently. Results are collected
        // via a channel ordered by feat_idx so emit order stays predictable.
        let exec_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let feature_total = features.len();

        // Normalize an AI-generated TC name into a plain, readable sentence.
        // The scenario type (TC_HAPPY/TC_UNHAPPY/TC_REGRESSION) already has its
        // own badge in the UI, so the model restating it as a name prefix (or
        // as a raw identifier like "TC_HAPPY_GenerateToken_Success_With_CIF")
        // is redundant and unreadable. This strips that category noise and
        // converts snake_case/PascalCase identifiers into spaced-out words.
        fn normalize_tc_name(raw: &str) -> String {
            let mut name = raw.trim().to_string();

            // Drop a leading scenario-type/category label, with or without a
            // separating colon or dash (e.g. "TC_HAPPY: ...", "Happy Path: ...",
            // "[TC_UNHAPPY] ...", "TC_HAPPY_GenerateToken..." with underscore).
            let prefix_re = regex::Regex::new(
                r"(?i)^\s*[\[(]?\s*(?:tc[_ ]?)?(?:happy(?:[ _]path)?|unhappy|negative|regression|positive|boundary)\s*[\])]?\s*[:\-_\s]\s*"
            ).unwrap();
            loop {
                let stripped = prefix_re.replace(&name, "").to_string();
                if stripped == name { break; }
                name = stripped;
            }
            // Also handle a bare leading "TC_" / "TC " with no category word
            // (e.g. "TC_001_Something") — just drop the "TC" marker itself.
            let bare_tc_re = regex::Regex::new(r"(?i)^\s*tc[_ ]").unwrap();
            name = bare_tc_re.replace(&name, "").to_string();

            // If what's left still reads like an identifier (snake_case or
            // PascalCase/camelCase with no spaces), convert it into words:
            // underscores become spaces, and a lower-to-upper letter boundary
            // gets a space inserted (GenerateToken -> Generate Token).
            let looks_like_identifier = !name.contains(' ') && (name.contains('_')
                || name.chars().filter(|c| c.is_ascii_uppercase()).count() >= 2);
            if looks_like_identifier {
                let spaced = name.replace('_', " ");
                let mut out = String::with_capacity(spaced.len() + 8);
                let chars: Vec<char> = spaced.chars().collect();
                for (i, &c) in chars.iter().enumerate() {
                    if i > 0 {
                        let prev = chars[i - 1];
                        let boundary = (prev.is_lowercase() && c.is_uppercase())
                            || (prev.is_ascii_digit() && c.is_alphabetic() && c.is_uppercase())
                            || (prev.is_alphabetic() && c.is_ascii_digit());
                        if boundary && prev != ' ' {
                            out.push(' ');
                        }
                    }
                    out.push(c);
                }
                name = regex::Regex::new(r"\s+").unwrap().replace_all(&out, " ").trim().to_string();
            }

            name.trim().trim_matches(|c: char| c == '_' || c == '-' || c == ':').trim().to_string()
        }

        // Helper: parse raw JSON response into (featureCategory, Vec<Value> of test case objects).
        // featureCategory is read once from the response root — see the prompt's
        // "── featureCategory ──" section — so every TC in this chunk shares the
        // exact same short module name instead of each TC inventing its own.
        fn parse_tc_response(response: &str, feat_idx: usize, feature_total: usize) -> (Option<String>, Vec<Value>) {
            let cleaned = response
                .trim()
                .strip_prefix("```json").or_else(|| response.trim().strip_prefix("```"))
                .map(|s| s.strip_suffix("```").unwrap_or(s))
                .unwrap_or(response.trim());

            if let Ok(v) = serde_json::from_str::<Value>(cleaned) {
                let category = v.get("featureCategory").and_then(|c| c.as_str())
                    .filter(|s| !s.is_empty()).map(|s| s.to_string());
                let cases = v.get("testCases").and_then(|a| a.as_array()).cloned().unwrap_or_default();
                return (category, cases);
            }

            // Partial parse fallback: pull featureCategory out with a plain
            // string search since the JSON as a whole may not parse.
            let category = regex::Regex::new(r#""featureCategory"\s*:\s*"([^"]*)""#).unwrap()
                .captures(cleaned)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .filter(|s| !s.is_empty());

            // Partial parse: extract complete {...} objects from "testCases":[
            let mut cases: Vec<Value> = Vec::new();
            let bytes = cleaned.as_bytes();
            let len = bytes.len();
            if let Some(start) = cleaned.find("\"testCases\"") {
                let mut i = start;
                while i < len && bytes[i] != b'[' { i += 1; }
                i += 1;
                while i < len {
                    while i < len && matches!(bytes[i], b' ' | b'\n' | b'\r' | b'\t' | b',') { i += 1; }
                    if i >= len || bytes[i] != b'{' { break; }
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
                        if let Ok(v) = serde_json::from_str::<Value>(&cleaned[obj_start..j]) {
                            cases.push(v);
                        }
                    }
                    i = j;
                }
            }
            eprintln!("[BRD Gen] Chunk {}/{} — partial parse: {}/{} TC objects",
                feat_idx + 1, feature_total, cases.len(), cleaned.matches("\"name\"").count());
            (category, cases)
        }

        // Build one prompt string per feature (OCR is still sequential here since it's I/O bound
        // and Confluence rate-limits; the heavy Ollama inference runs in parallel below).
        let mut prompts: Vec<(String, String)> = Vec::new(); // (feature_name, prompt)
        for (feat_idx, (feature_name, feature_context, row_images)) in features.iter().enumerate() {
            let feature_ocr_text = if !row_images.is_empty() {
                self.extract_image_ocr(&config.confluence, &request.confluence_page_id, row_images, row_images.len().min(8)).await
            } else if feat_idx == 0 {
                self.extract_image_ocr(&config.confluence, &request.confluence_page_id, &[], 3).await
            } else {
                String::new()
            };

            let mut parts = vec![
                format!("BRD: {title}\n\nFITUR ({}/{feature_total}):\n{feature_context}", feat_idx + 1),
            ];
            if !proses_bisnis_plain.is_empty() {
                parts.push(format!("KONTEKS PROSES BISNIS:\n{proses_bisnis_plain}"));
            }
            if !feature_ocr_text.is_empty() {
                parts.push(format!("GAMBAR/DIAGRAM DI CATATAN TAMBAHAN:\n{feature_ocr_text}"));
            }
            parts.push(format!(
                "Analisis fitur \"{feature_name}\" di atas secara menyeluruh sesuai cara analisis yang dijelaskan, lalu buat test case-nya. \
                 Susuri setiap field, kondisi/cabang, aturan bisnis, dan integrasi yang disebutkan di Acceptance Criteria/Business Flow/Catatan Tambahan — \
                 pastikan TIDAK ADA satupun kondisi eksplisit yang disebutkan requirement terlewat tanpa test case. \
                 Output HANYA JSON valid lengkap."
            ));

            let full_prompt = format!("{system_prompt}\n\n{}", parts.join("\n\n"));
            prompts.push((feature_name.clone(), full_prompt));
        }

        // Spawn all Ollama calls into a JoinSet — all run concurrently.
        // join_next() returns each task the moment it finishes, so we can
        // parse and emit to the frontend immediately without waiting for others.
        let mut join_set: tokio::task::JoinSet<(usize, String, String)> = tokio::task::JoinSet::new();
        for (feat_idx, (feature_name, prompt)) in prompts.into_iter().enumerate() {
            let ollama = OllamaClient::new(&config.ollama.endpoint, model);
            let ftotal = feature_total;
            join_set.spawn(async move {
                eprintln!("[BRD Gen] Chunk {}/{} START — \"{}\"", feat_idx + 1, ftotal, feature_name);
                let response = ollama
                    // num_ctx raised alongside the more thorough system prompt: a deeper,
                    // per-field/per-condition analysis produces more test cases per feature,
                    // so both the prompt and the JSON output need more room before truncating.
                    .generate_text_with_ctx(&prompt, true, Some(0.3), None, Some(24576))
                    .await
                    .unwrap_or_default();
                eprintln!("[BRD Gen] Chunk {}/{} DONE — {} chars", feat_idx + 1, ftotal, response.len());
                (feat_idx, feature_name, response)
            });
        }

        let mut all_test_cases: Vec<BRDTestCase> = Vec::new();
        let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

        // Builds the BRDTestCase list for one feature's raw AI response. Pulled
        // out of the completion loop below so it can be called strictly in
        // feat_idx order (see the buffering loop) rather than in whatever order
        // each Ollama call happens to finish.
        let build_chunk_cases = |feat_idx: usize,
                                  feature_name: &str,
                                  response: &str,
                                  seen_names: &mut std::collections::HashSet<String>|
         -> Vec<BRDTestCase> {
            if response.len() < 10 {
                eprintln!("[BRD Gen] Chunk {}/{} — empty response, skipping", feat_idx + 1, feature_total);
                return Vec::new();
            }

            let (ai_feature_category, raw_cases) = parse_tc_response(response, feat_idx, feature_total);
            // Read once per chunk (one chunk = one BRD feature row) and applied
            // identically to every TC below — never let the model choose a
            // per-TC value, or TCs from the same BRD row end up with different
            // category text (e.g. "Service Inquiry Way4" on one TC vs
            // "Tokenization and Binding API" on another), which breaks any UI
            // grouping/heading keyed on "which BRD row this TC came from".
            // Falls back to the full BRD feature name if the model omitted it.
            let feature_category = ai_feature_category.unwrap_or_else(|| feature_name.to_string());
            let mut chunk_cases: Vec<BRDTestCase> = Vec::new();

            for tc in &raw_cases {
                let raw_name = tc.get("name").and_then(|v| v.as_str()).unwrap_or("Unnamed TC");
                let name = normalize_tc_name(raw_name);
                let name = if name.is_empty() { "Unnamed TC".to_string() } else { name };
                if !seen_names.insert(name.clone()) { continue; }

                let feature_category = feature_category.clone();

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
                        step_number: s.get("stepNumber").and_then(|v| v.as_i64()).unwrap_or((i+1) as i64) as i32,
                        action: s.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    }).collect()).unwrap_or_default();

                let expected = tc.get("expectedResult").and_then(|v| v.as_array())
                    .map(|arr| arr.iter().enumerate().map(|(i, s)| BRDTestCaseExpectedResult {
                        step_number: s.get("stepNumber").and_then(|v| v.as_i64()).unwrap_or((i+1) as i64) as i32,
                        result: s.get("result").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    }).collect()).unwrap_or_default();

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

            eprintln!("[BRD Gen] Chunk {}/{} — {} TC untuk \"{}\"", feat_idx + 1, feature_total, chunk_cases.len(), feature_name);
            chunk_cases
        };

        // Emits + persists one feature's chunk, in the order this fn is called.
        let mut emit_chunk = |feat_idx: usize, feature_name: &str, chunk_cases: Vec<BRDTestCase>| {
            if chunk_cases.is_empty() { return; }

            {
                let mut store = self.load();
                store.test_cases.extend(chunk_cases.clone());
                let _ = self.save(&store);
            }

            let _ = self.app_handle.emit("brd-chunk-progress", BrdChunkProgress {
                feature_index: feat_idx + 1,
                feature_total,
                feature_name: feature_name.to_string(),
                test_cases: chunk_cases.clone(),
                test_execution_id: exec_id.clone(),
            });

            all_test_cases.extend(chunk_cases);
        };

        // All Ollama calls still run fully in parallel (generation speed is
        // unaffected) — but results are buffered here and only emitted to the
        // frontend/DB strictly in feat_idx order (Fitur 1, 2, 3, …), regardless
        // of which call actually finishes first. A feature that finishes late
        // simply holds up the display of later (already-finished) features
        // until its own turn comes, instead of them appearing out of order.
        let mut pending: std::collections::HashMap<usize, (String, String)> = std::collections::HashMap::new();
        let mut next_to_emit = 0usize;

        while let Some(join_result) = join_set.join_next().await {
            let (feat_idx, feature_name, response) = match join_result {
                Ok(r) => r,
                Err(e) => { eprintln!("[BRD Gen] Task join error: {e}"); continue; }
            };
            pending.insert(feat_idx, (feature_name, response));

            // Drain as many in-order entries as are currently available.
            while let Some((feature_name, response)) = pending.remove(&next_to_emit) {
                let chunk_cases = build_chunk_cases(next_to_emit, &feature_name, &response, &mut seen_names);
                emit_chunk(next_to_emit, &feature_name, chunk_cases);
                next_to_emit += 1;
            }
        }
        // Safety net: if any chunks never drained (e.g. a task panicked and its
        // feat_idx was skipped, stalling the in-order sequence), flush whatever
        // is left in whatever order remains rather than silently dropping them.
        let mut leftover: Vec<usize> = pending.keys().copied().collect();
        leftover.sort_unstable();
        for feat_idx in leftover {
            if let Some((feature_name, response)) = pending.remove(&feat_idx) {
                let chunk_cases = build_chunk_cases(feat_idx, &feature_name, &response, &mut seen_names);
                emit_chunk(feat_idx, &feature_name, chunk_cases);
            }
        }

        if all_test_cases.is_empty() {
            return Err(ServiceError::Api(
                "Tidak ada test case yang berhasil digenerate. Cek koneksi ke Ollama model dan pastikan model berjalan.".into(),
            ));
        }

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
            .find_issues_by_jql(&config.jira, &jql, 200)
            .await
            .map_err(|e| ServiceError::Api(format!("JQL search failed: {e}")))?;

        let embed_model = config
            .ollama
            .defect_embedding_model
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(config.ollama.model.as_str());
        let endpoint = &config.ollama.endpoint;
        eprintln!("[BRD SemanticSearch] endpoint={endpoint}, embed_model={embed_model}, query=\"{query}\"");

        let ollama_client = OllamaClient::new(endpoint, embed_model);

        let query_emb = match ollama_client.embed(query, Some(embed_model)).await {
            Ok(emb) if !emb.is_empty() => emb,
            _ => {
                eprintln!("[BRD SemanticSearch] query embedding failed, using keyword fallback");
                return Ok(self.fallback_search(query, &issues));
            }
        };

        let mut scored: Vec<(f64, crate::models::brd::SemanticSearchResult)> = Vec::new();
        for issue in issues.iter() {
            let summary = issue.summary.trim();
            if summary.is_empty() {
                continue;
            }
            match ollama_client.embed(summary, Some(embed_model)).await {
                Ok(emb) if !emb.is_empty() => {
                    let score = RagService::cosine_similarity(&query_emb, &emb);
                    scored.push((
                        score,
                        crate::models::brd::SemanticSearchResult {
                            issue_key: issue.key.clone(),
                            summary: issue.summary.clone(),
                            score,
                            match_reason: format!("Cosine similarity: {:.0}%", score * 100.0),
                        },
                    ));
                }
                Ok(_) => eprintln!("[BRD SemanticSearch] empty embedding for {}", issue.key),
                Err(e) => eprintln!("[BRD SemanticSearch] embed failed for {}: {e}", issue.key),
            }
        }

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        const SIM_THRESHOLD: f64 = 0.55;
        const MAX_RESULTS: usize = 20;
        let filtered: Vec<crate::models::brd::SemanticSearchResult> = scored
            .into_iter()
            .filter(|(score, _)| *score >= SIM_THRESHOLD)
            .take(MAX_RESULTS)
            .map(|(_, r)| r)
            .collect();

        if filtered.is_empty() {
            eprintln!("[BRD SemanticSearch] no embedding matches, using keyword fallback");
            return Ok(self.fallback_search(query, &issues));
        }

        Ok(filtered)
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

    /// Find existing test cases whose summaries are semantically similar to the
    /// given candidate titles, using the configured Ollama embedding model (see
    /// `config.ollama.defect_embedding_model`).
    ///
    /// Scoping: when `candidate.folder_path` is non-empty the check is limited
    /// to issues inside that Xray folder; otherwise the whole project is used.
    pub async fn find_test_case_duplicate_candidates(
        &self,
        config: &AppConfig,
        project_key: &str,
        candidates: &[crate::models::brd::TestCaseDuplicateCandidate],
    ) -> Result<Vec<crate::models::brd::TestCaseDuplicateCheck>> {
        if candidates.is_empty() || project_key.trim().is_empty() {
            return Ok(Vec::new());
        }

        let jira = crate::services::jira::JiraService::new();

        let embed_model = config
            .ollama
            .defect_embedding_model
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(config.ollama.model.as_str());
        let endpoint = &config.ollama.endpoint;

        let ollama_client = OllamaClient::new(endpoint, embed_model);

        // For each distinct xray folder, fetch + embed its issues once.
        let mut scope_cache: std::collections::HashMap<
            String,
            Vec<(String, String, Vec<f64>)>,
        > = Default::default();
        let distinct_folders: Vec<String> = candidates
            .iter()
            .map(|c| c.folder_path.trim().to_string())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();

        for folder_path in &distinct_folders {
            let existing = if folder_path.is_empty() {
                // Whole-project scope.
                let jql = format!(
                    "project = {} AND issuetype in (\"Test Case\", \"Test\", \"Task\") ORDER BY updated DESC",
                    project_key
                );
                let issues = jira
                    .find_issues_by_jql(&config.jira, &jql, 500)
                    .await
                    .map_err(|e| ServiceError::Api(format!("JQL search failed: {e}")))?;
                issues
                    .iter()
                    .map(|i| (i.key.clone(), i.summary.clone()))
                    .collect::<Vec<_>>()
            } else {
                // Folder scope: resolve folder id then fetch issues inside it.
                let folders = jira
                    .get_xray_folders(&config.jira, project_key)
                    .await
                    .unwrap_or_default();
                let parts = crate::services::jira::client::JiraClient::split_folder_path(folder_path);
                let folder_id = crate::services::jira::client::JiraClient::find_folder_id(&folders, &parts);
                match folder_id {
                    Some(id) => {
                        let raw = jira
                            .get_xray_folder_issues(&config.jira, project_key, id, Some(folder_path.as_str()))
                            .await
                            .unwrap_or_default();
                        raw.iter()
                            .filter_map(|v| {
                                let key = v["key"].as_str()?.to_string();
                                let summary = v["summary"].as_str().unwrap_or("").to_string();
                                Some((key, summary))
                            })
                            .collect::<Vec<_>>()
                    }
                    None => {
                        eprintln!("[BRD DuplicateCheck] folder not found: {folder_path}");
                        Vec::new()
                    }
                }
            };

            eprintln!(
                "[BRD DuplicateCheck] folder=\"{folder_path}\" scope={} (model={embed_model})",
                existing.len()
            );

            // Embed existing summaries in this scope once.
            let mut existing_emb: Vec<(String, String, Vec<f64>)> = Vec::new();
            for (key, summary) in existing.iter() {
                let text = summary.trim();
                if text.is_empty() {
                    continue;
                }
                match ollama_client.embed(text, Some(embed_model)).await {
                    Ok(emb) if !emb.is_empty() => {
                        existing_emb.push((key.clone(), text.to_string(), emb));
                    }
                    Ok(_) => eprintln!("[BRD DuplicateCheck] empty embedding for {}", key),
                    Err(e) => eprintln!("[BRD DuplicateCheck] embed failed for {}: {e}", key),
                }
            }

            if !existing.is_empty() && existing_emb.is_empty() {
                // Issues exist but all embeddings failed → embedding unavailable.
                eprintln!("[BRD DuplicateCheck] no embedding available for folder=\"{folder_path}\"");
                return Err(ServiceError::Api(
                    "Ollama embedding model tidak tersedia — embedding gagal untuk semua summary. Cek Ollama dan setting embedding model.".into(),
                ));
            }
            scope_cache.insert(folder_path.clone(), existing_emb);
        }

        // Emit results in caller order, scoring each candidate against its folder scope.
        let mut results: Vec<crate::models::brd::TestCaseDuplicateCheck> = Vec::with_capacity(candidates.len());
        for candidate in candidates {
            let title = candidate.title.trim().to_string();
            if title.is_empty() {
                results.push(crate::models::brd::TestCaseDuplicateCheck {
                    title: String::new(),
                    matches: Vec::new(),
                });
                continue;
            }
            let existing_emb = scope_cache
                .get(candidate.folder_path.trim())
                .cloned()
                .unwrap_or_default();

            let query_emb = match ollama_client.embed(&title, Some(embed_model)).await {
                Ok(emb) if !emb.is_empty() => emb,
                _ => {
                    results.push(crate::models::brd::TestCaseDuplicateCheck {
                        title: title.clone(),
                        matches: Vec::new(),
                    });
                    continue;
                }
            };

            let mut scored: Vec<(f64, String, String)> = existing_emb
                .iter()
                .map(|(key, summary, emb)| {
                    let score = RagService::cosine_similarity(&query_emb, emb);
                    (score, key.clone(), summary.clone())
                })
                .collect();
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

            const DUP_THRESHOLD: f64 = 0.5;
            const MAX_MATCHES: usize = 3;
            let matches = scored
                .into_iter()
                .filter(|(score, _, _)| *score >= DUP_THRESHOLD)
                .take(MAX_MATCHES)
                .map(|(score, key, summary)| crate::models::brd::TestCaseDuplicateMatch {
                    key,
                    summary,
                    score,
                })
                .collect();

            results.push(crate::models::brd::TestCaseDuplicateCheck {
                title,
                matches,
            });
        }

        Ok(results)
    }
}


