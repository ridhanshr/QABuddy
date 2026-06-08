# Functional Requirement Design: QA Buddy Desktop

## 1. Ringkasan Produk

QA Buddy adalah aplikasi desktop berbasis AI lokal (Ollama) yang berfungsi sebagai asisten pintar untuk memfasilitasi interaksi antara QA Engineer/User dengan ekosistem Jira dan Confluence tanpa harus membuka browser atau menulis query JQL yang rumit.

---

## 2. Arsitektur Sistem (High-Level)

- **UI Layer:** Electron / Tauri (Desktop App).
- **Logic Layer:** Python Controller (Jira API & Confluence API Integrator).
- **AI Engine:** Ollama (Model: Qwen2.5 7B atau Llama 3.1 8B) berjalan secara lokal.
- **Data Source:** Atlassian Cloud/On-Premise (via Personal Access Token).

---

## 3. Kebutuhan Fungsional (Functional Requirements)

### F-01: Manajemen Koneksi & Autentikasi

- **FR-1.1:** Aplikasi harus menyediakan menu pengaturan untuk input Personal Access Token (PAT) Jira dan Confluence.
- **FR-1.2:** Aplikasi harus dapat menyimpan konfigurasi URL domain Jira/Confluence perusahaan secara aman di level lokal.
- **FR-1.3:** Aplikasi harus memvalidasi koneksi ke Ollama (Local Server) saat startup.

### F-02: Smart Chat Assistant (Natural Language to Action)

- **FR-2.1:** User dapat bertanya menggunakan bahasa manusia (Indonesia/Inggris) untuk mencari tiket.  
  **Contoh:** "Cari tiket bug yang assign ke saya dan statusnya masih Open."

- **FR-2.2:** AI harus menerjemahkan permintaan user menjadi JQL (Jira Query Language) secara otomatis.

- **FR-2.3:** AI harus dapat merangkum konten dari halaman Confluence jika user menanyakan tentang dokumentasi teknis.

### F-03: Fitur "Quick Report" Bug

- **FR-3.1:** Aplikasi menyediakan formulir sederhana (Judul, Langkah Reproduksi, Hasil Aktual, Hasil Harapan).

- **FR-3.2:** AI harus dapat memperbaiki deskripsi bug yang diinput user agar lebih profesional dan mudah dipahami developer sebelum di-submit.

- **FR-3.3:** Aplikasi harus mendukung fitur one-click upload untuk mengirim data tersebut ke Jira sebagai tiket baru.

### F-04: Dashboard Ringkasan (Daily Digest)

- **FR-4.1:** Aplikasi harus menampilkan tabel ringkasan tiket yang berstatus "Ready for QA".

- **FR-4.2:** AI memberikan analisis singkat tentang beban kerja saat ini.  
  **Contoh:** "Hari ini ada peningkatan bug di modul Payment sebesar 20%."

### F-05: Ekstraksi Test Case (Confluence to Jira)

- **FR-5.1:** User dapat memasukkan URL halaman Confluence berisi Requirement.

- **FR-5.2:** AI harus mengekstrak poin-poin pengujian (Test Cases) dari halaman tersebut.

- **FR-5.3:** User dapat memilih poin mana saja yang ingin dijadikan tiket Test Case di Jira secara massal.

---

## 4. Kebutuhan Non-Fungsional (Non-Functional Requirements)

| Atribut | Spesifikasi |
|---|---|
| Keamanan | Semua data (PAT, Konten Tiket) diproses secara lokal. Tidak ada data yang dikirim ke OpenAI/Cloud AI pihak ketiga. |
| Kemudahan Penggunaan | Zero Learning Curve. User tidak perlu tahu JQL atau API, cukup gunakan kolom chat. |
| Performa | Respons AI lokal (Ollama) harus muncul dalam < 5 detik (tergantung hardware user). |
| Portabilitas | Aplikasi harus bisa dijalankan sebagai file .exe tunggal (portable) di Windows tanpa instal Python manual. |

---
