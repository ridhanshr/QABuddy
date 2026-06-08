# 🧪 Jira & Confluence MCP Server — QA Toolkit

MCP (Model Context Protocol) Server untuk mengintegrasikan **Jira & Confluence Self-Hosted** dengan Claude AI. Dirancang khusus untuk workflow QA sehari-hari.

---

## 📦 Tools yang Tersedia

### Jira Tools
| Tool | Deskripsi |
|------|-----------|
| `jira_get_my_issues` | Ambil semua issue yang di-assign ke saya |
| `jira_get_sprint_issues` | Issue dalam sprint aktif |
| `jira_search_issues` | Cari issue dengan JQL query |
| `jira_get_issue` | Detail lengkap satu issue |
| `jira_create_bug` | Buat bug report dengan format QA standar |
| `jira_update_status` | Pindahkan status issue |
| `jira_add_comment` | Tambah komentar ke issue |
| `jira_link_issues` | Buat relasi antar issue |
| `jira_get_bug_metrics` | Statistik bug per project |
| `jira_get_projects` | Daftar semua project |

### Confluence Tools
| Tool | Deskripsi |
|------|-----------|
| `confluence_search_pages` | Cari halaman berdasarkan keyword |
| `confluence_get_page` | Ambil konten halaman by ID |
| `confluence_get_page_by_title` | Ambil halaman by judul |
| `confluence_create_page` | Buat halaman baru |
| `confluence_create_test_report` | Buat laporan test execution |
| `confluence_get_test_cases` | Parse test case dari tabel Confluence |
| `confluence_get_spaces` | Daftar semua space |

### Combined QA Tools
| Tool | Deskripsi |
|------|-----------|
| `qa_daily_summary` | Ringkasan harian untuk standup |
| `qa_release_readiness` | Cek kesiapan release (go/no-go) |

---

## 🚀 Cara Install & Setup

### 1. Clone & Install Dependencies

```bash
cd jira-confluence-mcp
npm install
```

### 2. Buat File .env

```bash
cp .env.example .env
```

Edit file `.env` dan isi dengan nilai yang sesuai:

```env
JIRA_BASE_URL=https://jira.perusahaan.com
JIRA_PAT=your_jira_pat_here
CONFLUENCE_BASE_URL=https://confluence.perusahaan.com
CONFLUENCE_PAT=your_confluence_pat_here
```

### 3. Build TypeScript

```bash
npm run build
```

### 4. Daftarkan di Claude Desktop

Buka file konfigurasi Claude Desktop:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Tambahkan konfigurasi berikut:

```json
{
  "mcpServers": {
    "jira-confluence-mcp": {
      "command": "node",
      "args": ["/path/ke/jira-confluence-mcp/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.perusahaan.com",
        "JIRA_PAT": "your_jira_pat_here",
        "CONFLUENCE_BASE_URL": "https://confluence.perusahaan.com",
        "CONFLUENCE_PAT": "your_confluence_pat_here"
      }
    }
  }
}
```

> **Ganti** `/path/ke/jira-confluence-mcp` dengan path absolut folder project ini.

### 5. Restart Claude Desktop

Tutup dan buka kembali Claude Desktop. Jika berhasil, tools akan muncul di Claude.

---

## 💡 Contoh Penggunaan di Claude

### Bug Reporting
```
"Saya menemukan bug: tombol checkout tidak bisa diklik di Safari iOS 17.
 Langkah: 1) Buka halaman cart, 2) Klik tombol Checkout.
 Expected: masuk halaman payment. Actual: tidak ada response.
 Tolong buat bug di project QA dengan priority High."
```

### Daily Standup
```
"Buatkan ringkasan harian QA saya untuk project APP"
```

### Release Check
```
"Cek apakah project QA sudah siap release sprint ini"
```

### Test Report
```
"Buat laporan test execution di Confluence space QA dengan hasil:
 TC-001 Login - PASS
 TC-002 Register - FAIL (ada error 500)
 TC-003 Forgot Password - SKIP"
```

---

## 🔑 Cara Generate Personal Access Token

### Jira
1. Login ke Jira → Klik foto profil → **Profile**
2. Di sidebar kiri → **Personal Access Tokens**
3. Klik **Create token**
4. Beri nama, pilih expiry, klik **Create**
5. Salin token (hanya tampil sekali!)

### Confluence
1. Login ke Confluence → Klik foto profil → **Profile**
2. Di sidebar kiri → **Personal Access Tokens**
3. Klik **Create token**
4. Beri nama, pilih expiry, klik **Create**
5. Salin token (hanya tampil sekali!)

---

## 📋 Format Tabel Test Case di Confluence

Untuk `confluence_get_test_cases`, halaman Confluence harus punya tabel dengan kolom:

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|-----------------|--------|-------|
| TC-001 | Login valid | 1. Buka halaman login ... | User berhasil masuk | PASS | |
| TC-002 | Login invalid | ... | Muncul pesan error | FAIL | Bug: QA-123 |

---

## 🛠️ Development

```bash
# Run langsung tanpa build (development)
npm run dev

# Build untuk production
npm run build

# Run setelah build
npm start
```

---

## 📁 Struktur Project

```
jira-confluence-mcp/
├── src/
│   ├── index.ts           # MCP Server utama + semua tool handlers
│   ├── jira-client.ts     # Jira REST API client
│   └── confluence-client.ts # Confluence REST API client
├── dist/                  # Output TypeScript (setelah npm run build)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```
