# QA Buddy Desktop

QA Buddy adalah aplikasi desktop modern yang dirancang khusus untuk membantu tim Quality Assurance (QA) mengelola siklus pengujian, sinkronisasi dokumentasi Confluence, integrasi Jira secara massal, serta asisten AI lokal menggunakan Ollama.

---

## 🚀 Fitur Utama

### 1. Dashboard Utama & Digest
Menyajikan ringkasan metrik bug (kritis, tinggi, sedang, rendah) yang terintegrasi secara real-time dari proyek Jira Anda.

### 2. Chat Assistant (AI Agent)
Berinteraksi secara interaktif untuk menanyakan data Jira/Confluence. Asisten secara cerdas memilih rute kueri langsung ke Jira/Confluence API atau memanfaatkan database pengetahuan lokal.

### 3. Test Cases
Menu terpusat untuk seluruh kebutuhan manajemen test case, terdiri dari sub-menu:

- **Creation**
  - *Manual*: Buat test case secara manual dengan form lengkap (name, scenario type, steps, expected result, feature category, priority).
  - *Generate with AI (BRD)*: Generate test case secara otomatis dari dokumen BRD Confluence menggunakan model LLM lokal (Ollama). Proses dilakukan per-fitur secara streaming — setiap fitur yang selesai diproses langsung ditampilkan sebagai kartu test case tanpa menunggu keseluruhan selesai.
- **Test Case Search**: Cari test case yang sudah ada di Jira Xray berdasarkan JQL atau kata kunci.
- **Xray Organizer**: Pindahkan tiket pengujian secara massal ke dalam struktur folder Xray Test Repository.
- **Update from Confluence**: Perbarui langkah pengujian (*test steps*) dan hasil yang diharapkan (*expected result*) pada tiket Jira (Xray) secara massal langsung dari tabel pengujian di halaman Confluence, dengan opsi resolusi konflik (*Overwrite*, *Skip*, atau *Append*).
- **AI Extractor**: Ekstraksi skenario uji (Positive, Happy Path, Edge Case) secara cerdas dari tautan spesifikasi Confluence/Web eksternal menggunakan model LLM lokal.

### 4. Test Cycles
Manajemen siklus pengujian end-to-end, terdiri dari dua sub-menu:

- **Plan & Execution**: Buat dan kelola Test Plan beserta Test Execution di dalamnya. Mendukung sinkronisasi ke Jira Xray.
- **Execution Monitoring**: Monitor progres Test Execution dari Jira Xray secara real-time.
  - Input Jira Test Execution key — sistem memvalidasi bahwa issue yang dimasukkan benar-benar bertipe *Test Execution* (menampilkan error jika bukan).
  - Menampilkan ringkasan progres terkini: To Do, In Progress, Done, Failed, Blocked, pass rate.
  - Menyimpan **snapshot harian** secara otomatis setiap kali data di-refresh, dan menampilkannya sebagai **tabel historikal eksekusi** (terbaru di atas).
  - **Add to Daily Activity UQA**: Inject tabel historikal eksekusi langsung ke description Jira issue (misal issue di project *UAT QA Activity 2026*) dalam format wiki markup tiga kolom (Date / Activity / Notes). Re-inject bersifat idempotent — data lama digantikan tanpa duplikasi.

### 5. Documentation Sync
Sinkronisasi tabel pengujian dua arah ke Confluence. Dilengkapi dengan pengelolaan *screen capture* (penyusunan ulang gambar) dan catatan terisolasi per lampiran secara visual.

### 6. Advanced Jira Organizer
- **Visual JQL Builder**: Penyusun filter Jira visual tingkat lanjut (Project, Board, Sprint, Status, Tipe, Key, dan Filter Multi-Label dinamis).
- **Bulk Operations Dashboard**: Aksi massal terhadap tiket hasil filter — Bulk Transition, Bulk Assign, Bulk Add Labels, dan Bulk Xray folder movement.

### 7. Daily UQA
Pengelolaan catatan aktivitas harian QA (UQA) dengan integrasi langsung ke Jira issue description.

### 8. Defect Repository
Repositori defect terpusat dengan statistik dan riwayat eksekusi.

### 9. RAG Knowledge Base
Pengindeksan lokal dokumen Confluence & Jira secara offline ke dalam vector database lokal menggunakan model embeddings dari Ollama. Digunakan oleh Chat Assistant untuk menjawab pertanyaan berdasarkan data internal.

---

## 🛠️ Tech Stack & Arsitektur

| Layer | Teknologi |
|---|---|
| **Core Framework** | [Tauri v2](https://tauri.app/) (Rust backend) + [React 18](https://react.dev/) (renderer) |
| **Build System** | [Vite](https://vitejs.dev/) |
| **Language** | TypeScript (frontend) + Rust (backend) |
| **AI / LLM** | [Ollama](https://ollama.com/) — model lokal (Gemma, Qwen, Llama, dll) |
| **State & UI** | Vanilla CSS dengan CSS variable tokens, Material Design 3, Google Material Symbols |
| **Storage** | File JSON lokal via `app_data_dir` (Tauri), Sled embedded DB |
| **Jira Integration** | Jira REST API v2 + Xray Raven REST API v1 |
| **Confluence Integration** | Confluence REST API v1 |

---

## 📥 Instalasi Cepat (Windows)

```powershell
irm https://raw.githubusercontent.com/ridhanshr/QABuddy/main/install.ps1 | iex
```

---

## 📋 Prasyarat Sistem

1. **Rust** toolchain (`rustup`) — diperlukan untuk build backend Tauri.
2. **Node.js** versi `18.x` atau lebih baru.
3. **Ollama** terinstal secara lokal dan sedang berjalan (default: `http://127.0.0.1:11434`).
   ```bash
   ollama pull gemma3:12b
   ```
4. **Atlassian Jira & Confluence** account serta **API Token** yang valid.

---

## ⚙️ Cara Memulai

### 1. Instalasi Dependensi
```bash
npm install
```

### 2. Mode Pengembangan
```bash
npm run dev
```

### 3. Kompilasi Produksi
```bash
npm run build
```

### 4. Pengemasan Aplikasi
```bash
npm run tauri build
```

---

## 🔒 Desain Keamanan

- **Enkripsi Kredensial**: API Token tidak pernah disimpan dalam plaintext. Konfigurasi dienkripsi menggunakan mekanisme penyimpanan aman Tauri.
- **Validasi Input**: Tipe issue Jira divalidasi di backend sebelum operasi dijalankan (contoh: memastikan key yang diinput adalah *Test Execution* bukan tipe lain).
- **Penanganan Error**: Seluruh error dari Jira/Confluence API ditangkap di Rust service layer dan diteruskan sebagai pesan yang dapat dibaca user di UI.
