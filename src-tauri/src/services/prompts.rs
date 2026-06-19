//! LLM prompt templates ported from `src/main/services/ollama/prompts.ts`.
//! These build the exact instruction strings the Ollama service feeds to the
//! model for bug polishing, JQL generation, test-case extraction, dashboard
//! insight and Confluence summarisation.

use crate::models::jira::BugFormDraft;

/// Prompt to polish a raw bug-form draft into a structured JSON bug report.
pub fn bug_polish_prompt(draft: &BugFormDraft) -> String {
    let env = if draft.environment.is_empty() {
        "(tidak disebutkan)"
    } else {
        &draft.environment
    };
    let steps = if draft.steps_to_reproduce.is_empty() {
        "(tidak disebutkan)"
    } else {
        &draft.steps_to_reproduce
    };
    let actual = if draft.actual_result.is_empty() {
        "(tidak disebutkan)"
    } else {
        &draft.actual_result
    };
    let expected = if draft.expected_result.is_empty() {
        "(tidak disebutkan)"
    } else {
        &draft.expected_result
    };
    [
        "Anda adalah seorang QA Engineer ahli yang bertugas menyempurnakan laporan bug (bug report).",
        "Kembalikan HANYA objek JSON dengan key tepat seperti ini: summary, description, priority, labels.",
        "PENTING: Tulis seluruh konten teks (summary dan description) dalam Bahasa Indonesia yang profesional dan jelas.",
        "CRITICAL: Nilai 'description' HARUS berupa string terformat rapi dan detail yang memisahkan bagian-bagian berikut dengan jelas:",
        "1. Lingkungan (Environment)",
        "2. Langkah-langkah Reproduksi (Steps to Reproduce)",
        "3. Hasil Aktual (Actual Result)",
        "4. Hasil Diharapkan (Expected Result)",
        "Jangan hilangkan detail langkah atau lingkungan apa pun yang diberikan oleh pengguna.",
        "",
        "=== ATURAN ANTI-HALUSINASI ===",
        "DILARANG KERAS menambahkan fakta, detail environment (OS, browser, versi), atau langkah reproduksi yang TIDAK disebutkan secara eksplisit oleh pengguna di input di bawah ini.",
        "Jika input pengguna kurang detail, gunakan HANYA informasi yang ada tanpa mengarang skenario baru.",
        "Jika field environment kosong, tulis 'Tidak disebutkan' — jangan menebak OS, browser, atau versi apa pun.",
        "Tugas Anda adalah MENYEMPURNAKAN format dan bahasa, BUKAN menambahkan informasi baru.",
        "",
        "=== FORMAT OUTPUT ===",
        "Keluarkan HANYA raw JSON. Karakter pertama HARUS '{' dan karakter terakhir HARUS '}'. Jangan gunakan markdown block (```json), jangan tambahkan teks pengantar atau penjelasan apa pun.",
        "",
        &format!("Input title: {}", draft.title),
        &format!("Environment: {env}"),
        &format!("Steps: {steps}"),
        &format!("Actual result: {actual}"),
        &format!("Expected result: {expected}"),
        &format!("Labels: {}", draft.labels),
    ]
    .join("\n")
}

/// Prompt to convert a natural-language request into a Jira JQL query.
pub fn jql_prompt(prompt: &str, project_key: &str) -> String {
    [
        "You are a Jira JQL query generator.",
        "Your ONLY job is to convert a user's natural language request into a single Jira JQL query string.",
        "",
        "=== OUTPUT FORMAT ===",
        "You MUST return a JSON object with exactly one key \"jql\" containing the complete JQL query string.",
        "WARNING: Keluarkan HANYA raw JSON. Jangan gunakan markdown block (```json), jangan berikan teks pengantar, and jangan berikan penjelasan apa pun.",
        "Karakter pertama output HARUS '{' dan karakter terakhir HARUS '}'.",
        "Contoh format yang benar: {\"jql\": \"project = ...\"}",
        "",
        "=== EXAMPLES ===",
        "User: \"cari bug priority high\"",
        &format!("Answer: {{\"jql\": \"project = \\\"{project_key}\\\" AND issuetype = \\\"Bug\\\" AND priority = \\\"High\\\" ORDER BY updated DESC\"}}"),
        "User: \"tiket dengan status In Progress\"",
        &format!("Answer: {{\"jql\": \"project = \\\"{project_key}\\\" AND status = \\\"In Progress\\\" ORDER BY updated DESC\"}}"),
        "",
        &format!("User request: {prompt}"),
    ]
    .join("\n")
}

/// Prompt to summarise a Confluence document for a user query.
pub fn confluence_summary_prompt(query: &str, content: &str) -> String {
    let snippet = if content.len() > 15000 { &content[..15000] } else { content };
    [
        "Sebagai asisten QA ahli, buatlah ringkasan dokumen Confluence berikut ini dalam Bahasa Indonesia yang mudah dipahami dan aplikatif untuk pengujian.",
        &format!("Pertanyaan Pengguna: {query}"),
        "",
        "=== FORMAT RINGKASAN ===",
        "Strukturkan ringkasan Anda ke dalam bagian-bagian berikut:",
        "1. **Tujuan Utama Fitur**: Apa yang dilakukan fitur/halaman ini secara ringkas.",
        "2. **Kriteria Penerimaan (Acceptance Criteria)**: Daftar syarat agar fitur dianggap selesai/lulus uji. Jika tidak tersedia secara eksplisit, tulis 'Tidak disebutkan secara eksplisit di dokumen'.",
        "3. **Poin yang Harus Dites (Testability)**: Skenario pengujian utama yang bisa diidentifikasi dari dokumen ini.",
        "",
        "=== ATURAN ===",
        "- Rangkum HANYA informasi yang ada di dalam dokumen. JANGAN menambahkan asumsi atau informasi dari luar.",
        "- Gunakan Bahasa Indonesia yang profesional dan jelas.",
        "",
        "=== ISI DOKUMEN ===",
        snippet,
    ]
    .join("\n")
}

/// Prompt to generate a short daily dashboard insight from serialised metrics.
pub fn dashboard_insight_prompt(serialized_data: &str) -> String {
    [
        "You are a QA lead assistant analyzing real-time Jira project data.",
        "Give one short daily insight in Indonesian based on the dashboard data below.",
        "CRITICAL: Do NOT use any markdown formatting, tables, lists, or asterisks. Write in plain text paragraph format only.",
        "",
        "=== ANTI-HALLUCINATION RULES ===",
        "- Base your insight ONLY on the data provided below. Do NOT invent metrics, trends, or numbers that are not in the data.",
        "- If the data is insufficient to draw a conclusion, say so honestly instead of fabricating insights.",
        "- Refer to actual issue keys, status names, and metric values from the data when making observations.",
        "- If no Jira data is available, state that insight is not available and suggest connecting Jira.",
        "",
        "=== INSIGHT FOCUS ===",
        "1. Summarize sprint completion progress with real numbers.",
        "2. Highlight critical or high priority bugs that need attention.",
        "3. Note any unusual patterns (e.g. many open issues, blocked items).",
        "4. Mention Ready for QA count if any.",
        "",
        "=== DASHBOARD DATA (from live Jira) ===",
        serialized_data,
    ]
    .join("\n")
}

/// Depth-specific extraction instructions.
fn depth_instructions(depth: &str) -> &'static str {
    match depth {
        "comprehensive" => {
            "Extract the supported test cases covering explicit scenarios found in the source:\n\
             - Happy path / positive flows\n\
             - Negative / error handling flows\n\
             - Boundary value and edge cases\n\
             - Input validation (empty, max length, special chars)\n\
             - Permission / role-based access scenarios\n\
             Do not invent missing variants just to reach a target count."
        }
        "happy-path" => {
            "Extract ONLY the main successful user flows explicitly supported by the source:\n\
             - Core business logic working correctly\n\
             - Standard user journeys from start to finish\n\
             - Expected inputs producing expected outputs\n\
             Skip happy-path cases when the source does not describe them."
        }
        "edge-case" => {
            "Extract ONLY edge cases, boundaries, and failure scenarios explicitly supported by the source:\n\
             - Boundary values (min, max, zero, negative, overflow)\n\
             - Invalid / malformed inputs\n\
             - Empty states, null values, missing required fields\n\
             - Timeout and network failure handling\n\
             Skip generic edge cases when the source does not mention them."
        }
        _ => "Extract a balanced set of test cases only from explicit source evidence.",
    }
}

/// Prompt to extract structured test cases from requirement text.
pub fn test_case_extraction_prompt(
    content: &str,
    depth: &str,
    rag_context: Option<&str>,
    ocr_text: Option<&str>,
) -> String {
    let mut parts: Vec<String> = vec![
        "You are a Senior QA Engineer with 10+ years of experience in software testing.".into(),
        "Your task is to extract well-structured test cases from the requirement text and OCR results provided below.".into(),
        "".into(),
        "=== OUTPUT FORMAT ===".into(),
        "Return ONLY valid JSON with this exact shape:".into(),
        "{\"testCases\":[{\"id\":\"TC-001\",\"title\":\"...\",\"objective\":\"...\",\"priority\":\"P1|P2|P3\",\"category\":\"...\",\"selected\":true,\"sourceEvidence\":\"exact copied phrase from source\"}]}".into(),
        "WARNING: Keluarkan HANYA raw JSON. Karakter pertama output HARUS '{' dan karakter terakhir HARUS '}'. Jangan gunakan markdown block (```json).".into(),
        "".into(),
        "=== FIELD GUIDELINES ===".into(),
        "- id: Sequential ID starting from TC-001".into(),
        "- title: Short, actionable title starting with a verb".into(),
        "- objective: Clear description of WHAT is being tested and the expected outcome".into(),
        "- priority: P1 = Critical, P2 = Important, P3 = Minor".into(),
        "- category: Functional, UI/UX, Security, Performance, Integration, Data Validation, Accessibility, Error Handling".into(),
        "- selected: Always true".into(),
        "- sourceEvidence: wajib berupa kutipan singkat yang disalin persis dari REQUIREMENT TEXT atau OCR TEXT. Jangan parafrase.".into(),
        "".into(),
        "=== EXTRACTION DEPTH ===".into(),
        depth_instructions(depth).into(),
        "".into(),
        "=== ATURAN ANTI-HALUSINASI ===".into(),
        "- Ekstrak test case HANYA dari REQUIREMENT TEXT dan OCR TEXT. JANGAN mengarang fitur, role, validasi, limit, status, field, atau integrasi yang tidak tertulis.".into(),
        "- EXISTING PROJECT CONTEXT/RAG hanya boleh membantu memahami istilah, bukan menjadi sumber test case baru.".into(),
        "- Jika sebuah skenario tidak punya sourceEvidence yang bisa dikutip, jangan keluarkan skenario tersebut.".into(),
        "- Jika tidak ada skenario yang cukup jelas, balas {\"testCases\":[]}.".into(),
        "- Selalu tulis title dan objective dalam Bahasa Indonesia.".into(),
        "".into(),
        "=== REQUIREMENT TEXT ===".into(),
        content.into(),
    ];

    if let Some(rag) = rag_context {
        parts.push("".into());
        parts.push("=== EXISTING PROJECT CONTEXT (from Knowledge Base / RAG) ===".into());
        parts.push(rag.into());
    }
    if let Some(ocr) = ocr_text {
        parts.push("".into());
        parts.push("=== OCR TEXT (from screenshots) ===".into());
        parts.push(ocr.into());
    }
    parts.join("\n")
}

/// System prompt for the Jira-first chat route (used by the QA service).
pub fn jira_first_chat_system_prompt() -> &'static str {
    "Anda adalah QA Buddy, asisten QA yang menjawab pertanyaan tiket Jira secara akurat. \
     Jawab dalam Bahasa Indonesia berdasarkan data Jira yang disediakan. \
     Jangan mengarang angka, status, atau key tiket yang tidak ada di data. \
     Jangan gunakan history percakapan sebagai sumber fakta kecuali faktanya juga muncul di data Jira terbaru. \
     Jika data tidak cukup, katakan apa yang kurang."
}

/// System prompt for the knowledge-base (Confluence/RAG) chat route.
pub fn knowledge_base_chat_system_prompt() -> &'static str {
    "Anda adalah QA Buddy, asisten QA yang menjawab berdasarkan dokumen Knowledge Base. \
     Jawab dalam Bahasa Indonesia, merujuk hanya pada konteks yang diberikan. \
     Jangan gunakan pengetahuan umum atau history percakapan untuk mengisi fakta yang tidak ada di konteks. \
     Jika informasi tidak ada di konteks, katakan bahwa informasi tidak tersedia."
}

/// System prompt for the hybrid (Jira + KB) chat route.
pub fn hybrid_chat_system_prompt() -> &'static str {
    "Anda adalah QA Buddy, asisten QA yang menjawab menggunakan data Jira dan dokumen Knowledge Base. \
     Jawab dalam Bahasa Indonesia. Utamakan data tiket Jira untuk pertanyaan status/issue, \
     dan gunakan dokumen Knowledge Base untuk pertanyaan requirement/proses. \
     Jangan mengarang issue key, angka, status, requirement, atau keputusan yang tidak ada di konteks. \
     Sebutkan sumber data yang Anda gunakan."
}

/// System prompt for the clarify route (ambiguous intent).
pub fn clarify_chat_system_prompt() -> &'static str {
    "Anda adalah QA Buddy. Permintaan pengguna ambigu. \
     Bantulah pengguna memperjelas apakah mereka bertanya tentang tiket Jira, \
     dokumen Confluence, atau hal lain. Jawab singkat dalam Bahasa Indonesia."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bug_polish_prompt_contains_all_fields() {
        let draft = BugFormDraft {
            title: "Login gagal".into(),
            steps_to_reproduce: "Klik login".into(),
            actual_result: "Error".into(),
            expected_result: "Masuk dashboard".into(),
            environment: "Chrome 120".into(),
            priority: "High".into(),
            labels: "auth".into(),
        };
        let prompt = bug_polish_prompt(&draft);
        assert!(prompt.contains("Login gagal"));
        assert!(prompt.contains("Chrome 120"));
        assert!(prompt.contains("raw JSON"));
    }

    #[test]
    fn jql_prompt_embeds_project_key() {
        let prompt = jql_prompt("cari bug", "QA");
        assert!(prompt.contains("QA"));
        assert!(prompt.contains("jql"));
    }

    #[test]
    fn extraction_prompt_includes_depth() {
        let p = test_case_extraction_prompt("req text", "happy-path", None, None);
        assert!(p.contains("successful"));
        assert!(p.contains("testCases"));
        assert!(p.contains("sourceEvidence"));
        assert!(p.contains("JANGAN mengarang"));
    }
}
