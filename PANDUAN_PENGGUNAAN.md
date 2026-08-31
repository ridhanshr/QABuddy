# Panduan Penggunaan QA Buddy

QA Buddy adalah aplikasi desktop untuk membantu tim QA BRI mengelola Test Case, Test Execution, Test Evidence, Defect, dan aktivitas harian UQA — terintegrasi langsung dengan Jira, Confluence, dan Bitbucket.

Panduan ini mengikuti urutan penggunaan aplikasi yang sebenarnya: mulai dari Register/Login, konfigurasi koneksi (PAT token) di Settings, sampai penggunaan setiap modul di sidebar.

---

## Daftar Isi

1. [Register & Login](#1-register--login)
2. [Konfigurasi Koneksi (Settings)](#2-konfigurasi-koneksi-settings)
3. [Dashboard](#3-dashboard)
4. [Project Management](#4-project-management)
5. [Test Cases Management](#5-test-cases-management)
6. [Test Evidence Management](#6-test-evidence-management)
7. [QA Documentation Review](#7-qa-documentation-review)
8. [Test Defect Management](#8-test-defect-management)
9. [Daily Activities](#9-daily-activities)
10. [Notifications](#10-notifications)
11. [Documentation (bawaan aplikasi)](#11-documentation-bawaan-aplikasi)
12. [Catatan: Modul yang Butuh Koneksi Database](#12-catatan-modul-yang-butuh-koneksi-database)

---

## 1. Register & Login

Berbeda dengan anggapan umum, **login QA Buddy tidak langsung memakai PAT Jira**. Aplikasi punya sistem akun sendiri (PN + Password) yang tersimpan di database pusat (MySQL). PAT token Jira/Confluence/Bitbucket baru diisi belakangan di halaman **Settings**, setelah Anda berhasil login.

### Mendaftar Akun Baru

1. Buka QA Buddy, di layar pembuka pilih tab **"Daftar"**.
2. Isi form:
   - **PN (Employee ID)** — contoh: `00400291`
   - **Role** — pilih salah satu dari dropdown: `Team Leader`, `Tester Leader`, `Product Tester`, `Technical Writer`, `Admin`
   - **Password** — minimal 6 karakter
   - **Konfirmasi Password**
3. Klik tombol **"Daftar"**.

> Jika muncul error koneksi, biasanya artinya database pusat belum terhubung — hubungi admin/PIC infrastruktur QA Buddy.

### Login

1. Pilih tab **"Masuk"**.
2. Isi **PN (Employee ID)** dan **Password**.
3. Klik tombol **"Masuk"** (tombol akan berubah jadi "Masuk..." saat proses berjalan).
4. Setelah berhasil, Anda akan diarahkan ke halaman **Dashboard**.

Role yang dipilih saat register akan memengaruhi menu yang tampil — misalnya menu **Project Management** disembunyikan untuk role `Product Tester`.

---

## 2. Konfigurasi Koneksi (Settings)

Setelah login, langkah wajib berikutnya adalah membuka menu **Settings** (di bagian bawah sidebar) untuk menghubungkan QA Buddy ke Jira, Confluence, Bitbucket, dan (opsional) AI lokal Ollama. Tanpa langkah ini, hampir semua modul tidak akan berfungsi.

Settings punya 3 tab: **General Settings**, **Knowledge Base**, **Updates**.

### 2.1 Tab "General Settings"

#### Konfigurasi Jira

| Field | Keterangan |
|---|---|
| **Jira Workspace URL** | URL Jira instance Anda, contoh `https://company.atlassian.net` (wajib) |
| **Jira Project Key** | Kode project default, contoh `QA` |
| **Test Case Issue Type** | Nama issue type untuk Test Case, contoh `Test` |
| **Bug Issue Type** | Nama issue type untuk Bug, contoh `Bug` |
| **Jira Username / Email** | Terisi otomatis dari akun Anda (read-only, tidak bisa diedit manual) |
| **Jira API Token** | Isi PAT (Personal Access Token) Jira Anda di sini. Ada tombol show/hide untuk menampilkan token |
| **Auth Mode** | Pilih `Basic (Email + Token)` atau `Bearer (PAT)`, sesuaikan dengan tipe token yang Anda punya |

Setelah diisi, klik tombol **"Test Jira"** untuk memvalidasi koneksi. Badge status akan berubah menjadi **"Jira Connected"** jika berhasil, atau tetap **"Connection Pending"** jika gagal.

#### Konfigurasi Confluence

Pola yang sama seperti Jira:
- **Confluence URL**
- **Space Key**
- **Confluence Username / Email** (read-only)
- **Confluence PAT / Token**
- **Auth Mode** (`Basic (Email + Token)` / `Bearer (PAT)`)

Klik **"Test Confluence"** untuk memvalidasi.

#### Konfigurasi Bitbucket (Self-Hosted)

- **Bitbucket Server URL (Self-Hosted)**
- **Username / User ID**
- **Bitbucket HTTP Access Token**
- **Default Project Key / Repo Slug**

Badge status: **"Bitbucket Configured"** / **"Not Configured"**.

#### Local AI Configuration (Ollama)

Bagian ini opsional, dipakai untuk fitur AI (generate test case, chat assistant, dsb) yang berjalan lokal (tidak mengirim data ke luar):

- **Active Model** — pilih dari daftar model Ollama yang terpasang
- **Local API Endpoint** — biasanya `http://localhost:11434`
- Model khusus (opsional, default mengikuti Active Model): **JQL Model**, **Chat Model**, **Extraction Model**, **Defect Repo Embedding Model**

Klik **"Test Ollama"** untuk validasi koneksi, lalu **"Save AI Settings"** untuk menyimpan.

#### System Healthcheck

Klik **"Run Healthcheck"** untuk mengecek status Jira, Confluence, Ollama, Knowledge Base, dan validasi konfigurasi sekaligus dalam satu tampilan grid pass/fail.

#### General Preferences

Pengaturan tema: **Light / Dark / System**.

#### Menyimpan

Setelah semua field diisi, klik tombol **"Save All Changes"** di bagian bawah halaman untuk menyimpan seluruh konfigurasi.

### 2.2 Tab "Knowledge Base"

Tab ini mengatur RAG (Retrieval-Augmented Generation) — indeks pengetahuan lokal yang dipakai fitur AI untuk menjawab berdasarkan data Confluence/Jira Anda. **Tidak memerlukan database MySQL**, hanya butuh Ollama aktif (model `nomic-embed-text` untuk embedding).

- 4 kartu statistik: Total Chunks, Confluence Pages, Jira Issues, Bitbucket PR Cache — masing-masing menampilkan waktu sync terakhir.
- **Sync Confluence Space**: isi "Target Space Key / Page ID", klik **"Sync Confluence"**.
- **Sync Jira Project**: isi "Target Project Key", klik **"Sync Jira"**.
- Penjelasan cara kerja RAG (4 langkah: chunk → embed → cocokkan pertanyaan → kirim ke AI).
- Panel "Hapus Index": tombol **"Hapus Confluence Index"**, **"Hapus Jira Index"**, **"Hapus Bitbucket Cache"**, **"Hapus Semua"**.

### 2.3 Tab "Updates"

Menampilkan versi aplikasi saat ini vs versi terbaru beserta release notes. Tombol:
- **"Periksa Update"** — cek versi terbaru
- **"Unduh & Pasang Update"** — download dan install update
- **"GitHub Releases"** — buka halaman release di GitHub

---

## 3. Dashboard

Halaman pertama setelah login. Berisi:

- **"My Projects"** — daftar tiket UQA yang ditugaskan ke Anda, bisa difilter berdasarkan status (`Queue`, `In Progress`, `Under Review`, `Done - UAT`, `Done - Deploy`, `Done - Live`, `Cancel`). Klik pill status untuk expand daftar, tersedia link "Open in Jira".
- **"Project SDLC Types"** — tiket UQA yang sama, dikelompokkan berdasarkan tipe SDLC (`NCM`, `NCM OPS`, `ECM`, `Support`).
- **Tab project** — chip "All" ditambah per-project untuk filter cepat.
- **"AI Daily Insight"** — ringkasan harian dari AI, dengan tombol **"Refresh"** dan **"Share Report"** (menyalin ke clipboard).
- **Tabel "Ready for QA"** — bisa difilter per tipe issue (Bug, Test Execution, Test Plan, Task, Epic), toggle "Milik saya" / "Semua", ada kolom pencarian, dan pagination.
- **Recent Activity** — ringkasan aktivitas terakhir (dari Notifications).
- **Connection Status** — status koneksi Jira/Confluence/Ollama sekilas.

Admin bisa membuka modal "Dashboard Project Settings" untuk menambah project Jira lain yang dipantau (project key, issue type, label/status yang di-include/exclude, toggle ON/OFF).

---

## 4. Project Management

> Menu ini **tidak muncul** untuk role `Product Tester`.

Berisi 5 tab: **Sync Manually**, **Test Repository**, **UQA Project**, **Test Plans**, **Test Executions**.

Semua aksi "sync ke DB" di modul ini **memerlukan koneksi database MySQL pusat** aktif.

### Sync Manually
Untuk menghubungkan relasi UQA Project ↔ Test Plan ↔ Test Execution secara manual jika data tidak otomatis tertaut. Isi minimal 2 dari 3 field (UQA Project Key, Test Plan Key, Test Execution Key), lalu klik **"Simpan ke Database"**.

### Test Repository
Pilih project Jira dari dropdown, tambahkan ke daftar, lalu klik **"Sync ke DB"** untuk mendaftarkannya sebagai test repository.

### UQA Project
Menampilkan tiket UQA yang di-assign ke Anda (diambil langsung dari Jira). Setiap tiket bisa disinkronkan ke database satu per satu atau sekaligus (bulk). Tiket yang sudah tersinkron ditandai badge "Synced to DB" — arahkan kursor untuk re-sync.

### Test Plans
Cari/telusuri Test Plan di bawah suatu project (drill-down dari UQA), lalu sinkronkan Test Plan terpilih ke database.

### Test Executions
Drill-down dari Test Plan. Menampilkan statistik eksekusi Xray (bar Pass/Fail/Blocked/In Progress/Unexecuted). Bisa sinkronkan Test Execution beserta seluruh Test Case-nya ke database.

> **Catatan penting**: sinkronisasi Test Case dari Xray Server memiliki batas maksimum **200 TC per Test Execution** (keterbatasan API Xray Server). Jika TE Anda punya lebih dari 200 TC, sebagian TC mungkin tidak ikut tersinkron — pertimbangkan memecah TE besar menjadi beberapa TE lebih kecil.

---

## 5. Test Cases Management

Berisi 4 tab utama: **Test Case Search**, **Creation**, **Sync to Repository**, **Monitoring**.

### Test Case Search
Pencarian Test Case yang sudah ada di Jira/Xray.

### Creation
Dua sub-tab:
- **Manual** — buat Test Case dengan mengisi form secara manual.
- **Generate with AI** — Test Case dibuat dengan bantuan AI lokal (Ollama), kemudian dikirim ke Jira/Xray.

Tersedia juga fitur ekstraksi Test Case dari URL/dokumen eksternal, serta download template dan upload file untuk import massal.

### Sync to Repository
Mengimpor/memperbarui Test Case yang bersumber dari halaman Confluence atau hasil pencarian JQL, dengan deteksi konflik step dan pengecekan duplikat sebelum data dikirim balik ke Jira.

### Monitoring
Papan status Test Execution / Test Case berbasis Xray. Anda bisa mengubah status langsung lewat dropdown inline:
- Status Test Execution: `OPEN` → `IN PROGRESS` → `DONE` → `OPEN`
- Status Test Case: `TODO`, `EXECUTING`, `PASS`, `FAIL`, `ABORTED`

Klik salah satu Test Execution untuk melihat daftar Test Case di dalamnya.

---

## 6. Test Evidence Management

Halaman untuk menyusun dan menyinkronkan dokumentasi bukti pengujian (Test Evidence) langsung ke halaman Confluence.

### Alur penggunaan

1. **Isi Target Page ID** di bagian atas — ID halaman Confluence tempat template tabel evidence berada.
2. Klik **"Parse Entries from Page"** untuk mengambil dan mengurai tabel yang sudah ada di halaman tersebut (Jira Server ID untuk Jira macro akan terdeteksi otomatis).
3. Klik **"Save Sync Settings"** untuk menyimpan konfigurasi Page ID.
4. Di bawahnya akan muncul daftar entry (row) Test Case — masing-masing berisi: Issue Key (dengan tombol "Fetch dari Jira/Xray"), Test Case No., Function, Kategori (`TC_HAPPY` / `TC_UNHAPPY` / `TC_REGRESSION`), toggle hasil PASS/FAILED, Scenario, Input Data, Steps, Expected Result, dan area drag-and-drop/paste untuk lampiran screenshot (bisa diurutkan, dikelompokkan, diberi catatan).
5. Gunakan tombol **"Import Test Execution"** untuk menarik Test Case dari sebuah Test Execution key secara otomatis, atau **"Add Entry"** untuk menambah entry kosong secara manual.
6. Tombol **"Clear All"** menghapus seluruh entry dan reset Page ID.
7. Setelah semua entry siap, klik tombol **"Sync to Confluence"** di bagian bawah untuk mengirim seluruh dokumentasi ke halaman Confluence yang dituju.

---

## 7. QA Documentation Review

Alat audit **read-only** untuk mengecek kelengkapan dokumentasi QA di Confluence dibandingkan data eksekusi di Jira/Xray — tidak ada perubahan yang dikirim ke Confluence atau Jira.

1. Isi **Page ID** (Confluence) dan **Jira Project Key**.
2. Klik **"Run Review"**.
3. Proses berjalan dengan progress live, lalu menghasilkan laporan lengkap: skor keseluruhan, jumlah temuan per kategori (`PASS`, `WARNING`, `FAIL`, `NOT_APPLICABLE`), detail per temuan (status, bagian, judul, deskripsi, rekomendasi, tingkat keyakinan, bukti, tautan sumber), serta tabel rekonsiliasi antara total eksekusi di Jira vs yang terdokumentasi di Confluence.
4. Hasil laporan bisa diekspor ke format **XLSX** atau **CSV**.

---

## 8. Test Defect Management

Berisi 3 tab: **Repository**, **Sources**, **Stats**.

### Repository
Tabel defect yang bisa dicari dan difilter (per project, issue type, status). Sebelum membuat defect baru, sistem otomatis mendeteksi kandidat duplikat (skor kemiripan minimal 20). Klik **"Add Defect"** untuk membuka modal pembuatan defect baru — dilengkapi preview "polish" AI dan peringatan jika terdeteksi duplikat.

### Sources
Mengatur project Jira mana saja yang menjadi sumber data defect repository, termasuk jadwal auto-sync (hari dalam seminggu, jam, tipe issue Bug/Task/Defect).

### Stats
Statistik: Total Defects, Total Duplicates, Projects, Components, beserta breakdown-nya.

---

## 9. Daily Activities

Papan tiket UQA yang ditugaskan ke Anda, dengan pencarian, filter status, dan kolom yang bisa diurutkan (Project, Issue, Summary, Last Activity, Status).

Klik salah satu baris tiket untuk membuka dialog **Quick Update**, berisi 3 bagian:

### 1. Auto Generate dari Test Execution
Klik **"Generate Notes"** — sistem mengambil statistik Test Execution hari ini (dari database jika sudah disinkronkan hari itu, atau langsung dari Xray jika belum) dan otomatis mengisi teks ringkasannya ke dalam field manual di bagian bawah (lihat poin 3). Hasilnya tetap bisa Anda edit sebelum disimpan.

### 2. Transition
Pilih status baru dari dropdown transisi Jira yang tersedia, lalu klik **"Apply"**. Status akan diperbarui baik di Jira maupun di database lokal.

### 3. Aktivitas Hari Ini (Manual)
Pilih **Fase** (`SIT` / `UAT` / `DT`), isi/edit teks aktivitas di textarea (baik hasil ketikan manual maupun hasil Auto Generate), lalu klik **"Catat Aktivitas"** untuk menyimpan — hanya ada satu tombol simpan untuk kedua cara input tersebut.

Terdapat juga ikon pengaturan (gear) di dalam halaman ini untuk mengatur mode pencarian tiket UQA (`Product Tester` / `Assignee` / `Both`) dan daftar filter Project Key.

---

## 10. Notifications

Log aktivitas aplikasi (sync, submit, organize, dll), masing-masing entry ditandai warna sesuai status (sukses/error/info), dengan badge sumber, waktu, pesan, dan detail tambahan jika ada (termasuk debug report untuk proses parsing Confluence). Klik **"Clear All"** untuk menghapus seluruh log.

---

## 11. Documentation (bawaan aplikasi)

Halaman bantuan statis di dalam aplikasi, berisi:
- **Getting Started** — panduan awal
- **Jira Integration** — contoh-contoh JQL dengan tombol copy
- **Writing Effective Bug Reports** — contoh laporan bug yang baik vs kurang baik
- **Local AI Privacy** — penjelasan bahwa inferensi AI berjalan lokal via Ollama dengan kebijakan **Zero-Telemetry** (tidak ada data yang dikirim keluar)

---

## 12. Catatan: Modul yang Butuh Koneksi Database

Beberapa modul **memerlukan koneksi database MySQL pusat** agar berfungsi penuh, sementara yang lain bekerja murni lewat API Jira/Confluence/Bitbucket tanpa database.

**Memerlukan koneksi database MySQL:**
- Register & Login
- Project Management (semua aksi "sync ke DB")
- Test Defect Management (penyimpanan repository defect, deteksi duplikat, statistik)
- Daily Activities — fitur Auto Generate (membaca data Test Execution yang tersinkron hari itu)
- Test Evidence Management — toggle status PASS/FAILED pada entry (menulis status ke database)
- Dashboard — kartu "My Projects" dan "Project SDLC Types"

**Bekerja murni lewat API (tanpa database):**
- Test Jira/Confluence/Ollama di Settings
- Test Cases Management (pencarian, pembuatan, ekstraksi via API Jira/Xray)
- Test Evidence Management — proses sync ke Confluence itu sendiri
- QA Documentation Review (rekonsiliasi read-only Jira/Confluence/Xray)
- Knowledge Base / RAG (hanya butuh Ollama, indeksnya tersimpan lokal terpisah dari database MySQL)

Jika suatu modul di atas tidak berfungsi atau menampilkan error, periksa dulu apakah koneksi database pusat aktif — bisa dicek lewat menu Settings → **"Run Healthcheck"**.

---

*Dokumen ini dibuat berdasarkan struktur aplikasi QA Buddy versi terbaru. Beberapa detail UI (label tombol, urutan field) dapat berubah mengikuti pembaruan aplikasi.*
