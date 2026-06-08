import type {
  BugFormDraft,
  ChatHistoryMessage,
  ExtractionDepth,
} from "@shared/types";

export interface ProjectContext {
  projectKey: string;
  statuses?: string[];
  issueTypes?: string[];
  spaceKey?: string;
  users?: { displayName: string; accountId: string }[];
  priorities?: { id: string; name: string }[];
  components?: { id: string; name: string }[];
  labels?: string[];
  activeSprint?: { name: string; id: number; state: string };
  customFields?: { id: string; name: string; type: string; isCustom: boolean }[];
}

export function getBugPolishPrompt(draft: BugFormDraft): string {
  return [
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
    `Input title: ${draft.title}`,
    `Environment: ${draft.environment || "(tidak disebutkan)"}`,
    `Steps: ${draft.stepsToReproduce || "(tidak disebutkan)"}`,
    `Actual result: ${draft.actualResult || "(tidak disebutkan)"}`,
    `Expected result: ${draft.expectedResult || "(tidak disebutkan)"}`,
    `Labels: ${draft.labels}`,
  ].join("\n");
}

export function getJqlPrompt(
  prompt: string,
  projectKey: string,
  context?: ProjectContext,
  history?: ChatHistoryMessage[]
): string {
  const contextLines: string[] = [
    "You are a Jira JQL query generator.",
    "Your ONLY job is to convert a user's natural language request into a single Jira JQL query string.",
    "",
    "=== OUTPUT FORMAT ===",
    'You MUST return a JSON object with exactly one key "jql" containing the complete JQL query string.',
    "WARNING: Keluarkan HANYA raw JSON. Jangan gunakan markdown block (```json), jangan berikan teks pengantar, and jangan berikan penjelasan apa pun.",
    "Karakter pertama output HARUS '{' dan karakter terakhir HARUS '}'.",
    'Contoh format yang benar: {"jql": "project = ..."}',
    'Contoh format yang SALAH: ```json\n{"jql": "..."}\n``` atau "Here is the JQL: {...}"',
    "",
    "=== EXAMPLES ===",
    'User: "cari bug priority high"',
    `Answer: {"jql": "project = \\"${projectKey}\\" AND issuetype = \\"Bug\\" AND priority = \\"High\\" ORDER BY updated DESC"}`,
    "",
    'User: "tiket dengan status In Progress"',
    `Answer: {"jql": "project = \\"${projectKey}\\" AND status = \\"In Progress\\" ORDER BY updated DESC"}`,
    "",
    'User: "task yang assign ke john"',
    `Answer: {"jql": "project = \\"${projectKey}\\" AND issuetype = \\"Task\\" AND assignee = \\"john\\" ORDER BY updated DESC"}`,
    "",
    'User: "tiket type task status In Analyze"',
    `Answer: {"jql": "project = \\"${projectKey}\\" AND issuetype = \\"Task\\" AND status = \\"In Analyze\\" ORDER BY updated DESC"}`,
    "",
    "=== RULES ===",
    `1. ALWAYS include project = "${projectKey}" as the first filter.`,
    '2. Return ONLY the JSON object. No explanations, no markdown, no extra text.',
    '3. Map user keywords to correct JQL fields: type/tipe → issuetype, status → status, priority/prioritas → priority, assign/assignee → assignee.',
    '4. NEVER use "text ~ ..." for structured fields. Always use proper field = "value" syntax.',
    '5. Always end with ORDER BY updated DESC.',
    '6. CRITICAL: Use the EXACT values the user specifies. If user says "In Analyze", use "In Analyze" — do NOT change it to "In Progress" or any other value.',
    '7. JANGAN mengarang nama status, issue type, atau priority. Gunakan HANYA nilai yang disebutkan pengguna atau yang ada di daftar Available values di bawah.',
  ];

  if (context?.statuses && context.statuses.length > 0) {
    contextLines.push(`\nAvailable statuses: ${context.statuses.join(", ")}`);
    contextLines.push("Use exact status names from this list.");
  }
  if (context?.issueTypes && context.issueTypes.length > 0) {
    contextLines.push(`Available issue types: ${context.issueTypes.join(", ")}`);
    contextLines.push("Use exact issue type names from this list.");
  }
  if (context?.users && context.users.length > 0) {
    contextLines.push(`\nAvailable users: ${context.users.map(u => u.displayName).join(", ")}`);
    contextLines.push("Use exact display names from this list when user mentions a person.");
  }
  if (context?.priorities && context.priorities.length > 0) {
    contextLines.push(`Available priorities: ${context.priorities.map(p => p.name).join(", ")}`);
    contextLines.push("Use exact priority names from this list.");
  }
  if (context?.components && context.components.length > 0) {
    contextLines.push(`Available components: ${context.components.map(c => c.name).join(", ")}`);
    contextLines.push("Use exact component names from this list.");
  }
  if (context?.labels && context.labels.length > 0) {
    contextLines.push(`Available labels: ${context.labels.join(", ")}`);
  }
  if (context?.activeSprint) {
    contextLines.push(`Active sprint: ${context.activeSprint.name} (id: ${context.activeSprint.id})`);
    contextLines.push('Use this sprint in JQL as: sprint = "${activeSprint.id}"');
  }
  if (context?.customFields && context.customFields.length > 0) {
    const relevantFields = context.customFields.filter(f =>
      /epic|sprint|story.point|label|custom|team|feature|severity|phase|release/i.test(f.name)
    );
    if (relevantFields.length > 0) {
      contextLines.push("\nAvailable custom fields (use JQL field name syntax):");
      for (const f of relevantFields) {
        contextLines.push(`- "${f.name}" (${f.id}) type: ${f.type}`);
      }
      contextLines.push("Use custom field IDs with cf[id] syntax in JQL, e.g. cf[10001] = \"value\"");
    }
  }

  if (history && history.length > 0) {
    contextLines.push("\n=== RECENT CONVERSATION ===");
    const recent = history.slice(-6);
    for (const msg of recent) {
      contextLines.push(`${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`);
    }
    contextLines.push("=== END CONVERSATION ===");
  }

  contextLines.push("", `User: "${prompt}"`, "Answer:");
  return contextLines.join("\n");
}

export function getConfluenceSummaryPrompt(query: string, content: string): string {
  return [
    "Sebagai asisten QA ahli, buatlah ringkasan dokumen Confluence berikut ini dalam Bahasa Indonesia yang mudah dipahami dan aplikatif untuk pengujian.",
    `Pertanyaan Pengguna: ${query}`,
    "",
    "=== FORMAT RINGKASAN ===",
    "Strukturkan ringkasan Anda ke dalam bagian-bagian berikut:",
    "1. **Tujuan Utama Fitur**: Apa yang dilakukan fitur/halaman ini secara ringkas.",
    "2. **Kriteria Penerimaan (Acceptance Criteria)**: Daftar syarat agar fitur dianggap selesai/lulus uji. Jika tidak tersedia secara eksplisit, tulis 'Tidak disebutkan secara eksplisit di dokumen'.",
    "3. **Poin yang Harus Dites (Testability)**: Skenario pengujian utama yang bisa diidentifikasi dari dokumen ini.",
    "",
    "=== ATURAN ===",
    "- Rangkum HANYA informasi yang ada di dalam dokumen. JANGAN menambahkan asumsi atau informasi dari luar.",
    "- Jika dokumen tidak mengandung acceptance criteria atau requirement yang jelas, katakan secara jujur bahwa informasinya tidak tersedia.",
    "- Gunakan Bahasa Indonesia yang profesional dan jelas.",
    "",
    "=== ISI DOKUMEN ===",
    content.slice(0, 15000),
  ].join("\n");
}

export function getDashboardInsightPrompt(serializedData: string): string {
  return [
    "You are a QA lead assistant.",
    "Give one short daily insight in Indonesian based on the dashboard data below.",
    "CRITICAL: Do NOT use any markdown formatting, tables, lists, or asterisks. Write in plain text paragraph format only.",
    "",
    "=== ANTI-HALLUCINATION RULES ===",
    "- Base your insight ONLY on the data provided below. Do NOT invent metrics, trends, or numbers that are not in the data.",
    "- If the data is insufficient to draw a conclusion, say so honestly instead of fabricating insights.",
    "- Do NOT guess sprint deadlines, team capacity, or future predictions unless the data explicitly supports them.",
    "- Refer to actual issue keys, status names, and metric values from the data when making observations.",
    "",
    "=== DASHBOARD DATA ===",
    serializedData,
  ].join("\n");
}

export function getTestCaseExtractionPrompt(
  content: string,
  depth: ExtractionDepth,
  ragContext?: string
): string {
  const depthInstructions: Record<ExtractionDepth, string> = {
    "comprehensive": [
      "Generate a COMPLETE set of test cases covering ALL scenarios:",
      "- Happy path / positive flows",
      "- Negative / error handling flows",
      "- Boundary value and edge cases",
      "- Input validation (empty, max length, special chars, SQL injection)",
      "- Permission / role-based access scenarios",
      "- Concurrent / race condition scenarios if applicable",
      "- Data integrity and state transitions",
      "Aim for 10-25 test cases depending on complexity.",
    ].join("\n"),
    "happy-path": [
      "Focus ONLY on the main successful user flows:",
      "- Core business logic working correctly",
      "- Standard user journeys from start to finish",
      "- Expected inputs producing expected outputs",
      "- Key integration points functioning normally",
      "Aim for 5-10 test cases covering the primary scenarios.",
    ].join("\n"),
    "edge-case": [
      "Focus ONLY on edge cases, boundaries, and failure scenarios:",
      "- Boundary values (min, max, zero, negative, overflow)",
      "- Invalid / malformed inputs",
      "- Empty states, null values, missing required fields",
      "- Timeout and network failure handling",
      "- Race conditions and concurrent access",
      "- Security edge cases (XSS, injection, unauthorized access)",
      "Aim for 8-15 test cases targeting potential breaking points.",
    ].join("\n"),
  };

  const promptParts: string[] = [
    "You are a Senior QA Engineer with 10+ years of experience in software testing.",
    "Your task is to extract well-structured test cases from the requirement text provided below.",
    "",
    "=== OUTPUT FORMAT ===",
    "Return ONLY valid JSON with this exact shape:",
    "{\"testCases\":[{\"id\":\"TC-001\",\"title\":\"...\",\"objective\":\"...\",\"priority\":\"P1|P2|P3\",\"category\":\"...\",\"selected\":true}]}",
    "WARNING: Keluarkan HANYA raw JSON. Karakter pertama output HARUS '{' dan karakter terakhir HARUS '}'. Jangan gunakan markdown block (```json), jangan tambahkan teks pengantar atau penjelasan apa pun.",
    "",
    "=== FIELD GUIDELINES ===",
    "- id: Sequential ID starting from TC-001",
    "- title: Short, actionable title starting with a verb (e.g. 'Verify login with valid credentials', 'Validate error message for empty email field')",
    "- objective: Clear, measurable description of WHAT is being tested and WHAT the expected outcome is. Include preconditions if relevant.",
    "- priority:",
    "  P1 = Critical business flow, blocks release if failing (login, payment, core CRUD)",
    "  P2 = Important functionality, significant user impact (filters, search, notifications)",
    "  P3 = Minor feature, cosmetic, nice-to-have (tooltips, sorting preferences, UI polish)",
    "- category: One of: Functional, UI/UX, Security, Performance, Integration, Data Validation, Accessibility, Error Handling",
    "- selected: Always set to true",
    "",
    "=== EXTRACTION DEPTH ===",
    depthInstructions[depth],
    "",
    "=== ATURAN ANTI-HALUSINASI ===",
    "- Ekstrak test case HANYA dari requirement text yang diberikan. JANGAN mengarang fitur, endpoint, atau business rule yang tidak ada di teks.",
    "- Jika requirement text tidak jelas atau ambigu, buat test case berdasarkan apa yang eksplisit saja dan tandai di objective bahwa requirement perlu diklarifikasi.",
    "",
    "=== RULES ===",
    "1. Each test case must be UNIQUE — no duplicate or overlapping scenarios",
    "2. PENTING: Selalu tulis judul (title) dan tujuan (objective) dalam Bahasa Indonesia.",
    "3. Titles must be specific and testable — avoid vague phrases like 'check feature works'",
    "4. Objectives must describe the expected behavior, not just repeat the title",
    "5. Cover both the explicitly stated requirements AND implied/obvious test scenarios",
    "6. Group related scenarios logically (e.g. all validation cases together)",
  ];

  if (ragContext) {
    promptParts.push("");
    promptParts.push("=== EXISTING PROJECT CONTEXT (from Knowledge Base) ===");
    promptParts.push(ragContext);
    promptParts.push("=== END CONTEXT ===");
    promptParts.push("Use the context above to: (1) avoid generating duplicate test cases that already exist, (2) align terminology and naming conventions with the project, (3) reference related existing test scenarios when relevant.");
  }

  promptParts.push("");
  promptParts.push("=== REQUIREMENT TEXT TO ANALYZE ===");
  promptParts.push(content.slice(0, 20000));

  return promptParts.join("\n");
}

export function getRagAnswerPrompt(query: string, contextText: string): string {
  return [
    "Anda adalah asisten QA engineer ahli. Jawab pertanyaan pengguna HANYA menggunakan dokumen konteks yang disediakan di bawah ini.",
    "Selalu sebutkan judul dokumen sumber saat merujuk informasi.",
    "PENTING: Selalu berikan jawaban dalam Bahasa Indonesia yang profesional dan jelas.",
    "",
    "=== ATURAN ANTI-HALUSINASI ===",
    "- Jawab HANYA berdasarkan informasi yang ada di dalam CONTEXT DOCUMENTS di bawah. JANGAN menambahkan pengetahuan dari luar konteks.",
    "- Jika konteks tidak berisi informasi yang cukup untuk menjawab, katakan secara jujur: 'Informasi ini tidak tersedia di Knowledge Base saat ini.'",
    "- JANGAN mengarang URL, nama dokumen, nomor halaman, atau referensi yang tidak ada di konteks.",
    "- Jika diminta angka atau statistik yang tidak ada di konteks, katakan bahwa datanya belum tersedia.",
    "- Bedakan dengan jelas antara fakta dari dokumen dan interpretasi/analisis Anda.",
    "",
    "=== CONTEXT DOCUMENTS ===",
    contextText,
    "=== END CONTEXT ===",
    `\n\nUser question: ${query}`,
  ].join("\n");
}
