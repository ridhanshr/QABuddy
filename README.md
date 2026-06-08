# QA Buddy Desktop

QA Buddy adalah aplikasi desktop modern yang dirancang khusus untuk membantu tim Quality Assurance (QA) mengelola siklus pengujian, sinkronisasi dokumentasi Confluence, integrasi Jira secara massal, serta asisten AI lokal menggunakan Ollama.

---

## 🚀 Fitur Utama

1. **Dashboard Utama & Digest**: Menyajikan ringkasan metrik bug (kritis, tinggi, sedang, rendah) yang terintegrasi secara real-time dari proyek Jira Anda.
2. **Chat Assistant (AI Agent)**: Berinteraksi secara interaktif untuk menanyakan data Jira/Confluence. Asisten secara cerdas memilih rute kueri langsung ke Jira/Confluence API atau memanfaatkan database pengetahuan lokal.
3. **Bug Report Polishing**: Membantu memoles langkah-langkah reproduksi bug (*steps to reproduce*) secara otomatis menggunakan AI sebelum dikirimkan ke Jira.
4. **Test Case Extractor (AI-Driven)**: Ekstraksi skenario uji (Positive, Happy Path, Edge Case) secara cerdas dari tautan spesifikasi Confluence/Web eksternal menggunakan model LLM lokal.
5. **Manual Test Case Creator & Xray Organizer**: Manajemen test case manual dan kemampuan memindahkan tiket pengujian secara massal ke dalam struktur folder Xray Test Repository.
6. **Documentation Sync**: Modul sinkronisasi tabel pengujian dua arah ke Confluence. Dilengkapi dengan pengelolaan *screen capture* (penyusunan ulang gambar) dan *catatan terisolasi* per lampiran secara visual.
7. **Advanced Jira Organizer**:
   * **Visual JQL Builder**: Penyusun filter Jira visual tingkat lanjut (Project, Board, Sprint, Status, Tipe, Key, dan Filter Multi-Label dinamis).
   * **Bulk Operations Dashboard**: Melakukan aksi massal terhadap tiket hasil filter (Bulk Transition, Bulk Assign, Bulk Add Labels, dan Bulk Xray folder movement).
8. **RAG Knowledge Base**: Melakukan pengindeksan lokal dokumen Confluence & Jira secara offline ke dalam vector database lokal menggunakan model embeddings dari Ollama.

---

## 🛠️ Tech Stack & Arsitektur

* **Core Framework**: [Electron](https://www.electronjs.org/) (Main process & Preload) + [React 18](https://react.dev/) (Renderer process)
* **Build System**: [electron-vite](https://electron-vite.org/) & [Vite](https://vitejs.dev/)
* **Language**: TypeScript
* **State Management & UI**: Vanilla CSS dengan token variabel CSS, Material Design 3, Google Material Symbols, & Searchable Select Components.
* **Security & Storage**: Credential API tokens Jira/Confluence dienkripsi secara lokal di disk pengguna menggunakan API **Electron safeStorage** (berbasis DPAPI Windows / macOS Keychain).

---

## 📋 Prasyarat Sistem

Sebelum menjalankan aplikasi, pastikan Anda telah menyiapkan:
1. **Node.js** versi `18.x` atau lebih baru.
2. **Ollama** terinstal secara lokal dan sedang berjalan (Default: `http://127.0.0.1:11434`).
   * Pastikan model target sudah diunduh (misalnya `qwen2.5:7b` atau `llama3`):
     ```bash
     ollama pull qwen2.5:7b
     ```
3. **Atlassian Jira & Confluence Cloud account** serta **API Token** yang valid.

---

## ⚙️ Cara Memulai & Panduan Deployment

### 1. Instalasi Dependensi
Jalankan perintah berikut di direktori root project:
```bash
npm install
```

### 2. Mode Pengembangan (Development)
Jalankan aplikasi dalam mode dev dengan fitur Hot-Module Replacement (HMR):
```bash
npm run dev
```

### 3. Menjalankan Unit Tests
Lakukan pengujian lokal terhadap service layer & utilitas parsing:
```bash
npm run test
```

### 4. Kompilasi Produksi (Production Build)
Untuk melakukan compile aset dan kode menjadi bundel siap pakai:
```bash
npm run build
```

### 5. Pengemasan Aplikasi (Packaging / Distribution)
Untuk membuat file installer portabel Windows (`.exe` x64) di folder `dist/`:
```bash
npm run dist
```

---

## 🔒 Desain Keamanan & Pengawasan

* **Enkripsi Kredensial**: API Token tidak pernah disimpan dalam format teks biasa (*plaintext*). File `qa-buddy-config.json` di folder `userData` dienkripsi dengan hardware-bound encryption key.
* **Input Validation**: Struktur data IPC divalidasi menggunakan validasi tipe TypeScript statis dan pemeriksaan runtime pada service layer sebelum kueri dikirimkan ke pihak ketiga.
* **Penanganan Log**: Error penjelajahan jaringan dan API ditangkap menggunakan blok `try-catch` dan disajikan secara aman ke UI renderer untuk meminimalisir kegagalan tak terduga (*silent failures*).
