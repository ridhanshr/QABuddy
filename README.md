# QA Buddy Desktop

QA Buddy adalah aplikasi desktop modern yang dirancang khusus untuk membantu tim Quality Assurance (QA) mengelola siklus pengujian, sinkronisasi dokumentasi Confluence, integrasi Jira secara massal, serta asisten AI lokal menggunakan Ollama.

---

## Fitur Utama

### 1. Dashboard
Menyajikan ringkasan metrik bug (kritis, tinggi, sedang, rendah) yang terintegrasi secara real-time dari proyek Jira Anda.

---

### 2. Project Management
Manajemen proyek QA secara menyeluruh, terdiri dari tiga sub-menu:

- **UQA Project**: Menampilkan daftar tiket UQA (UAT QA Activity) yang ditugaskan kepada atau diuji oleh pengguna. Setiap UQA key ditampilkan sebagai tautan langsung ke Jira issue. Mendukung pencarian cepat dan refresh manual.
- **Test Plans**: Kelola Test Plan yang ada di Jira Xray — lihat daftar, status, dan detail test plan per proyek.
- **Test Executions**: Monitor dan kelola Test Execution per proyek — tampilkan progres eksekusi, riwayat, dan inject ringkasan ke Daily Activity UQA.

---

### 3. Test Cases Management
Menu terpusat untuk seluruh kebutuhan manajemen test case, terdiri dari sub-menu:

- **Creation**: Buat test case baru dengan dua mode:
  - *Manual*: Form lengkap (nama, tipe skenario, langkah, expected result, kategori fitur, prioritas).
  - *Generate with AI (BRD)*: Generate test case otomatis dari dokumen BRD Confluence menggunakan model LLM lokal (Ollama). Proses dilakukan per-fitur secara streaming — setiap fitur yang selesai langsung ditampilkan sebagai kartu test case tanpa menunggu keseluruhan selesai.
- **Test Case Search**: Cari test case yang sudah ada di Jira Xray berdasarkan JQL atau kata kunci.
- **Xray Organizer**: Pindahkan tiket pengujian secara massal ke dalam struktur folder Xray Test Repository.
- **Update from Confluence**: Perbarui test steps dan expected result pada tiket Jira Xray secara massal langsung dari tabel pengujian di halaman Confluence, dengan opsi resolusi konflik (Overwrite, Skip, atau Append).
- **Test Executions**: Kelola Test Execution secara langsung dari konteks Test Cases Management:
  - *Test Execution Monitoring*: Monitor progres eksekusi (To Do, In Progress, Done, Failed, Blocked) dan inject riwayat ke Daily Activity UQA.
  - *Test Execution Organizer*: Pilih proyek dan folder Xray, pilih test case, lalu tambahkan ke Test Execution yang dituju.

---

### 4. Test Evidence Management
Sinkronisasi tabel pengujian dua arah ke Confluence, terdiri dari:

- **Form**: Input URL halaman Confluence, parse entri tabel pengujian, edit konten, dan sinkronisasi ulang.
- **Settings**: Konfigurasi template tabel dan halaman sumber Confluence untuk import/export.

Dilengkapi dengan pengelolaan screen capture (penyusunan ulang gambar) dan catatan terisolasi per lampiran secara visual.

---

### 5. Test Defect Management
Repositori defect terpusat, terdiri dari tiga sub-menu:

- **Repository**: Cari dan kelola defect dari Jira berdasarkan filter (proyek, status, label, dll).
- **Sources**: Kelola sumber data defect — tambahkan atau hapus proyek Jira yang dipantau sebagai sumber defect.
- **Stats**: Statistik defect terpusat — total defect, distribusi severity/priority, dan tren historis.

---

### 6. Daily Activities
Pengelolaan catatan aktivitas harian QA (UQA) dengan integrasi langsung ke Jira issue description. Mendukung penulisan aktivitas harian dalam format tabel wiki markup Jira dan inject otomatis ke issue UQA yang dipilih.

---

### 7. Logs
Riwayat lengkap seluruh operasi yang dilakukan di QA Buddy — sinkronisasi, submit ke Jira, Xray Organizer, Defect Repository, dan lainnya. Setiap entri menampilkan waktu, sumber operasi, status (success/error/info), pesan, dan detail teknis jika tersedia.

---

### 8. Settings
Konfigurasi koneksi dan preferensi aplikasi:

- **Connections**: Konfigurasi Jira URL, Confluence URL, API Token, email, dan model Ollama yang digunakan.
- **Preferences**: Preferensi tampilan (tema light/dark/system) dan pengaturan lainnya.
- **Updates**: Cek dan unduh pembaruan aplikasi terbaru.

---

## Tech Stack & Arsitektur

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

## Instalasi Cepat (Windows)

```powershell
irm https://raw.githubusercontent.com/ridhanshr/QABuddy/main/install.ps1 | iex
```

---

## Prasyarat Sistem

1. **Rust** toolchain (`rustup`) — diperlukan untuk build backend Tauri.
2. **Node.js** versi `18.x` atau lebih baru.
3. **Ollama** terinstal secara lokal dan sedang berjalan (default: `http://127.0.0.1:11434`).
   ```bash
   ollama pull gemma3:12b
   ```
4. **Atlassian Jira & Confluence** account serta **API Token** yang valid.

---

## Cara Memulai

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

## Desain Keamanan

- **Enkripsi Kredensial**: API Token tidak pernah disimpan dalam plaintext. Konfigurasi dienkripsi menggunakan mekanisme penyimpanan aman Tauri.
- **Validasi Input**: Tipe issue Jira divalidasi di backend sebelum operasi dijalankan (contoh: memastikan key yang diinput adalah *Test Execution* bukan tipe lain).
- **Penanganan Error**: Seluruh error dari Jira/Confluence API ditangkap di Rust service layer dan diteruskan sebagai pesan yang dapat dibaca user di UI.
- **Session Management**: Login session disimpan di `sessionStorage` browser — otomatis terhapus saat aplikasi ditutup tanpa perlu logout manual.
