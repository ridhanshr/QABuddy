import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";

const SECTIONS = [
  { id: "register-login", label: "1. Register & Login" },
  { id: "settings", label: "2. Konfigurasi Koneksi (Settings)" },
  { id: "dashboard", label: "3. Dashboard" },
  { id: "project-management", label: "4. Project Management" },
  { id: "test-cases-management", label: "5. Test Cases Management" },
  { id: "test-evidence", label: "6. Test Evidence Management" },
  { id: "qa-doc-review", label: "7. QA Documentation Review" },
  { id: "defect-management", label: "8. Test Defect Management" },
  { id: "daily-activities", label: "9. Daily Activities" },
  { id: "notifications", label: "10. Notifications" },
  { id: "app-docs", label: "11. Documentation (bawaan aplikasi)" },
  { id: "db-notes", label: "12. Modul yang Butuh Database" },
];

export default function Documentation() {
  const { loading, activeView } = useApp();
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const articleRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (loading || activeView !== "documentation") return;
    const container = document.querySelector(".documentation-layout");
    if (!container) return;

    const onScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top - containerTop;
        if (top <= 96) current = s.id;
      }
      setActiveId(current);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener("scroll", onScroll);
  }, [loading, activeView]);

  if (loading || activeView !== "documentation") {
    return null;
  }

  return (
    <div className="documentation-layout">
      <div className="doc-container">
        <div className="doc-grid">
          {/* Table of Contents */}
          <aside className="doc-toc">
            <nav>
              <h3 className="toc-title">Daftar Isi</h3>
              <ul className="toc-list">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={`toc-link${activeId === s.id ? " active" : ""}`}
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Main Content */}
          <article className="doc-content" ref={articleRef}>
            <header className="doc-header">
              <h1>Panduan Penggunaan QA Buddy</h1>
              <p>
                QA Buddy adalah aplikasi desktop untuk membantu tim QA BRI mengelola Test Case,
                Test Execution, Test Evidence, Defect, dan aktivitas harian UQA — terintegrasi
                langsung dengan Jira, Confluence, dan Bitbucket. Panduan ini mengikuti urutan
                penggunaan aplikasi yang sebenarnya: mulai dari Register/Login, konfigurasi
                koneksi (PAT token) di Settings, sampai penggunaan setiap modul di sidebar.
              </p>
            </header>

            {/* 1. Register & Login */}
            <section id="register-login" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">how_to_reg</span>
                <h2>1. Register &amp; Login</h2>
              </div>
              <p>
                Berbeda dengan anggapan umum, <strong>login QA Buddy tidak langsung memakai PAT
                Jira</strong>. Aplikasi punya sistem akun sendiri (PN + Password) yang tersimpan
                di database pusat (MySQL). PAT token Jira/Confluence/Bitbucket baru diisi
                belakangan di halaman <strong>Settings</strong>, setelah Anda berhasil login.
              </p>

              <h3 className="doc-h3">
                <span className="material-symbols" style={{ fontSize: 18 }}>person_add</span>
                Mendaftar Akun Baru
              </h3>
              <ol>
                <li>Buka QA Buddy, di layar pembuka pilih tab <strong>&quot;Daftar&quot;</strong>.</li>
                <li>
                  Isi form:
                  <ul className="doc-list">
                    <li><strong>PN (Employee ID)</strong> — contoh: <code>00400291</code></li>
                    <li>
                      <strong>Role</strong> — pilih salah satu dari dropdown:{" "}
                      <code>Team Leader</code>, <code>Tester Leader</code>, <code>Product Tester</code>,{" "}
                      <code>Technical Writer</code>, <code>Admin</code>
                    </li>
                    <li><strong>Password</strong> — minimal 6 karakter</li>
                    <li><strong>Konfirmasi Password</strong></li>
                  </ul>
                </li>
                <li>Klik tombol <strong>&quot;Daftar&quot;</strong>.</li>
              </ol>

              <div className="callout-box info">
                <span className="material-symbols text-primary" style={{ marginTop: 2 }}>info</span>
                <div>
                  <p>
                    Jika muncul error koneksi, biasanya artinya database pusat belum terhubung —
                    hubungi admin/PIC infrastruktur QA Buddy.
                  </p>
                </div>
              </div>

              <h3 className="doc-h3">
                <span className="material-symbols" style={{ fontSize: 18 }}>login</span>
                Login
              </h3>
              <ol>
                <li>Pilih tab <strong>&quot;Masuk&quot;</strong>.</li>
                <li>Isi <strong>PN (Employee ID)</strong> dan <strong>Password</strong>.</li>
                <li>Klik tombol <strong>&quot;Masuk&quot;</strong> (tombol akan berubah jadi &quot;Masuk...&quot; saat proses berjalan).</li>
                <li>Setelah berhasil, Anda akan diarahkan ke halaman <strong>Dashboard</strong>.</li>
              </ol>
              <p className="secondary-text">
                Role yang dipilih saat register akan memengaruhi menu yang tampil — misalnya
                menu <strong>Project Management</strong> disembunyikan untuk role{" "}
                <code>Product Tester</code>.
              </p>
            </section>

            {/* 2. Settings */}
            <section id="settings" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">settings</span>
                <h2>2. Konfigurasi Koneksi (Settings)</h2>
              </div>
              <p>
                Setelah login, langkah wajib berikutnya adalah membuka menu{" "}
                <strong>Settings</strong> (di bagian bawah sidebar) untuk menghubungkan QA Buddy
                ke Jira, Confluence, Bitbucket, dan (opsional) AI lokal Ollama. Tanpa langkah
                ini, hampir semua modul tidak akan berfungsi.
              </p>
              <p className="secondary-text">
                Settings punya 3 tab: <strong>General Settings</strong>, <strong>Knowledge
                Base</strong>, <strong>Updates</strong>.
              </p>

              <h3 className="doc-h3">2.1 Tab &quot;General Settings&quot;</h3>

              <p><strong>Konfigurasi Jira</strong></p>
              <div className="doc-table-wrap">
                <table className="doc-table">
                  <thead>
                    <tr><th>Field</th><th>Keterangan</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Jira Workspace URL</td><td>URL Jira instance Anda, contoh <code>https://company.atlassian.net</code> (wajib)</td></tr>
                    <tr><td>Jira Project Key</td><td>Kode project default, contoh <code>QA</code></td></tr>
                    <tr><td>Test Case Issue Type</td><td>Nama issue type untuk Test Case, contoh <code>Test</code></td></tr>
                    <tr><td>Bug Issue Type</td><td>Nama issue type untuk Bug, contoh <code>Bug</code></td></tr>
                    <tr><td>Jira Username / Email</td><td>Terisi otomatis dari akun Anda (read-only, tidak bisa diedit manual)</td></tr>
                    <tr><td>Jira API Token</td><td>Isi PAT (Personal Access Token) Jira Anda di sini. Ada tombol show/hide untuk menampilkan token</td></tr>
                    <tr><td>Auth Mode</td><td>Pilih <code>Basic (Email + Token)</code> atau <code>Bearer (PAT)</code>, sesuaikan dengan tipe token yang Anda punya</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="secondary-text">
                Setelah diisi, klik tombol <strong>&quot;Test Jira&quot;</strong> untuk memvalidasi
                koneksi. Badge status akan berubah menjadi <strong>&quot;Jira Connected&quot;</strong> jika
                berhasil, atau tetap <strong>&quot;Connection Pending&quot;</strong> jika gagal.
              </p>

              <p><strong>Konfigurasi Confluence</strong></p>
              <p className="secondary-text">Pola yang sama seperti Jira:</p>
              <ul className="doc-list">
                <li>Confluence URL</li>
                <li>Space Key</li>
                <li>Confluence Username / Email (read-only)</li>
                <li>Confluence PAT / Token</li>
                <li>Auth Mode (<code>Basic (Email + Token)</code> / <code>Bearer (PAT)</code>)</li>
              </ul>
              <p className="secondary-text">Klik <strong>&quot;Test Confluence&quot;</strong> untuk memvalidasi.</p>

              <p><strong>Konfigurasi Bitbucket (Self-Hosted)</strong></p>
              <ul className="doc-list">
                <li>Bitbucket Server URL (Self-Hosted)</li>
                <li>Username / User ID</li>
                <li>Bitbucket HTTP Access Token</li>
                <li>Default Project Key / Repo Slug</li>
              </ul>
              <p className="secondary-text">
                Badge status: <strong>&quot;Bitbucket Configured&quot;</strong> / <strong>&quot;Not Configured&quot;</strong>.
              </p>

              <p><strong>Local AI Configuration (Ollama)</strong></p>
              <p className="secondary-text">
                Bagian ini opsional, dipakai untuk fitur AI (generate test case, chat assistant,
                dsb) yang berjalan lokal (tidak mengirim data ke luar):
              </p>
              <ul className="doc-list">
                <li><strong>Active Model</strong> — pilih dari daftar model Ollama yang terpasang</li>
                <li><strong>Local API Endpoint</strong> — biasanya <code>http://localhost:11434</code></li>
                <li>Model khusus (opsional, default mengikuti Active Model): <strong>JQL Model</strong>, <strong>Chat Model</strong>, <strong>Extraction Model</strong>, <strong>Defect Repo Embedding Model</strong></li>
              </ul>
              <p className="secondary-text">
                Klik <strong>&quot;Test Ollama&quot;</strong> untuk validasi koneksi, lalu{" "}
                <strong>&quot;Save AI Settings&quot;</strong> untuk menyimpan.
              </p>

              <p><strong>System Healthcheck</strong></p>
              <p className="secondary-text">
                Klik <strong>&quot;Run Healthcheck&quot;</strong> untuk mengecek status Jira,
                Confluence, Ollama, Knowledge Base, dan validasi konfigurasi sekaligus dalam
                satu tampilan grid pass/fail.
              </p>

              <p><strong>General Preferences</strong></p>
              <p className="secondary-text">Pengaturan tema: Light / Dark / System.</p>

              <div className="callout-box checklist">
                <div>
                  <h4>Menyimpan</h4>
                  <p style={{ fontSize: 13.5, color: "var(--on-surface-variant)" }}>
                    Setelah semua field diisi, klik tombol <strong>&quot;Save All Changes&quot;</strong> di
                    bagian bawah halaman untuk menyimpan seluruh konfigurasi.
                  </p>
                </div>
              </div>

              <h3 className="doc-h3">2.2 Tab &quot;Knowledge Base&quot;</h3>
              <p>
                Tab ini mengatur RAG (Retrieval-Augmented Generation) — indeks pengetahuan lokal
                yang dipakai fitur AI untuk menjawab berdasarkan data Confluence/Jira Anda.{" "}
                <strong>Tidak memerlukan database MySQL</strong>, hanya butuh Ollama aktif (model{" "}
                <code>nomic-embed-text</code> untuk embedding).
              </p>
              <ul className="doc-list">
                <li>4 kartu statistik: Total Chunks, Confluence Pages, Jira Issues, Bitbucket PR Cache — masing-masing menampilkan waktu sync terakhir.</li>
                <li><strong>Sync Confluence Space</strong>: isi &quot;Target Space Key / Page ID&quot;, klik <strong>&quot;Sync Confluence&quot;</strong>.</li>
                <li><strong>Sync Jira Project</strong>: isi &quot;Target Project Key&quot;, klik <strong>&quot;Sync Jira&quot;</strong>.</li>
                <li>Penjelasan cara kerja RAG (4 langkah: chunk → embed → cocokkan pertanyaan → kirim ke AI).</li>
                <li>Panel &quot;Hapus Index&quot;: tombol <strong>&quot;Hapus Confluence Index&quot;</strong>, <strong>&quot;Hapus Jira Index&quot;</strong>, <strong>&quot;Hapus Bitbucket Cache&quot;</strong>, <strong>&quot;Hapus Semua&quot;</strong>.</li>
              </ul>

              <h3 className="doc-h3">2.3 Tab &quot;Updates&quot;</h3>
              <p className="secondary-text">
                Menampilkan versi aplikasi saat ini vs versi terbaru beserta release notes.
              </p>
              <ul className="doc-list">
                <li><strong>&quot;Periksa Update&quot;</strong> — cek versi terbaru</li>
                <li><strong>&quot;Unduh &amp; Pasang Update&quot;</strong> — download dan install update</li>
                <li><strong>&quot;GitHub Releases&quot;</strong> — buka halaman release di GitHub</li>
              </ul>
            </section>

            {/* 3. Dashboard */}
            <section id="dashboard" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">dashboard</span>
                <h2>3. Dashboard</h2>
              </div>
              <p className="secondary-text">Halaman pertama setelah login. Berisi:</p>
              <ul className="doc-list">
                <li>
                  <strong>&quot;My Projects&quot;</strong> — daftar tiket UQA yang ditugaskan ke Anda,
                  bisa difilter berdasarkan status (<code>Queue</code>, <code>In Progress</code>,{" "}
                  <code>Under Review</code>, <code>Done - UAT</code>, <code>Done - Deploy</code>,{" "}
                  <code>Done - Live</code>, <code>Cancel</code>). Klik pill status untuk expand
                  daftar, tersedia link &quot;Open in Jira&quot;.
                </li>
                <li>
                  <strong>&quot;Project SDLC Types&quot;</strong> — tiket UQA yang sama, dikelompokkan
                  berdasarkan tipe SDLC (<code>NCM</code>, <code>NCM OPS</code>, <code>ECM</code>,{" "}
                  <code>Support</code>).
                </li>
                <li><strong>Tab project</strong> — chip &quot;All&quot; ditambah per-project untuk filter cepat.</li>
                <li>
                  <strong>&quot;AI Daily Insight&quot;</strong> — ringkasan harian dari AI, dengan tombol{" "}
                  <strong>&quot;Refresh&quot;</strong> dan <strong>&quot;Share Report&quot;</strong> (menyalin ke
                  clipboard).
                </li>
                <li>
                  <strong>Tabel &quot;Ready for QA&quot;</strong> — bisa difilter per tipe issue (Bug, Test
                  Execution, Test Plan, Task, Epic), toggle &quot;Milik saya&quot; / &quot;Semua&quot;, ada kolom
                  pencarian, dan pagination.
                </li>
                <li><strong>Recent Activity</strong> — ringkasan aktivitas terakhir (dari Notifications).</li>
                <li><strong>Connection Status</strong> — status koneksi Jira/Confluence/Ollama sekilas.</li>
              </ul>
              <p className="secondary-text">
                Admin bisa membuka modal &quot;Dashboard Project Settings&quot; untuk menambah project
                Jira lain yang dipantau (project key, issue type, label/status yang
                di-include/exclude, toggle ON/OFF).
              </p>
            </section>

            {/* 4. Project Management */}
            <section id="project-management" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">folder_managed</span>
                <h2>4. Project Management</h2>
              </div>
              <p className="doc-role-note">Menu ini tidak muncul untuk role Product Tester.</p>
              <p>
                Berisi 5 tab: <strong>Sync Manually</strong>, <strong>Test Repository</strong>,{" "}
                <strong>UQA Project</strong>, <strong>Test Plans</strong>,{" "}
                <strong>Test Executions</strong>.
              </p>
              <div className="doc-badge-row">
                <span className="doc-badge db">Memerlukan Database</span>
                <span>&nbsp;— semua aksi &quot;sync ke DB&quot; di modul ini.</span>
              </div>

              <h3 className="doc-h3">Sync Manually</h3>
              <p className="secondary-text">
                Untuk menghubungkan relasi UQA Project ↔ Test Plan ↔ Test Execution secara
                manual jika data tidak otomatis tertaut. Isi minimal 2 dari 3 field (UQA
                Project Key, Test Plan Key, Test Execution Key), lalu klik{" "}
                <strong>&quot;Simpan ke Database&quot;</strong>.
              </p>

              <h3 className="doc-h3">Test Repository</h3>
              <p className="secondary-text">
                Pilih project Jira dari dropdown, tambahkan ke daftar, lalu klik{" "}
                <strong>&quot;Sync ke DB&quot;</strong> untuk mendaftarkannya sebagai test repository.
              </p>

              <h3 className="doc-h3">UQA Project</h3>
              <p className="secondary-text">
                Menampilkan tiket UQA yang di-assign ke Anda (diambil langsung dari Jira).
                Setiap tiket bisa disinkronkan ke database satu per satu atau sekaligus (bulk).
                Tiket yang sudah tersinkron ditandai badge &quot;Synced to DB&quot; — arahkan kursor
                untuk re-sync.
              </p>

              <h3 className="doc-h3">Test Plans</h3>
              <p className="secondary-text">
                Cari/telusuri Test Plan di bawah suatu project (drill-down dari UQA), lalu
                sinkronkan Test Plan terpilih ke database.
              </p>

              <h3 className="doc-h3">Test Executions</h3>
              <p className="secondary-text">
                Drill-down dari Test Plan. Menampilkan statistik eksekusi Xray (bar
                Pass/Fail/Blocked/In Progress/Unexecuted). Bisa sinkronkan Test Execution
                beserta seluruh Test Case-nya ke database.
              </p>

              <div className="callout-box warning">
                <span className="material-symbols" style={{ marginTop: 2 }}>warning</span>
                <div>
                  <p>
                    <strong>Catatan penting</strong>: sinkronisasi Test Case dari Xray Server
                    memiliki batas maksimum <strong>200 TC per Test Execution</strong>{" "}
                    (keterbatasan API Xray Server). Jika TE Anda punya lebih dari 200 TC,
                    sebagian TC mungkin tidak ikut tersinkron — pertimbangkan memecah TE besar
                    menjadi beberapa TE lebih kecil.
                  </p>
                </div>
              </div>
            </section>

            {/* 5. Test Cases Management */}
            <section id="test-cases-management" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">assignment</span>
                <h2>5. Test Cases Management</h2>
              </div>
              <p>
                Berisi 4 tab utama: <strong>Test Case Search</strong>, <strong>Creation</strong>,{" "}
                <strong>Sync to Repository</strong>, <strong>Monitoring</strong>.
              </p>

              <h3 className="doc-h3">Test Case Search</h3>
              <p className="secondary-text">Pencarian Test Case yang sudah ada di Jira/Xray.</p>

              <h3 className="doc-h3">Creation</h3>
              <p className="secondary-text">Dua sub-tab:</p>
              <ul className="doc-list">
                <li><strong>Manual</strong> — buat Test Case dengan mengisi form secara manual.</li>
                <li><strong>Generate with AI</strong> — Test Case dibuat dengan bantuan AI lokal (Ollama), kemudian dikirim ke Jira/Xray.</li>
              </ul>
              <p className="secondary-text">
                Tersedia juga fitur ekstraksi Test Case dari URL/dokumen eksternal, serta
                download template dan upload file untuk import massal.
              </p>

              <h3 className="doc-h3">Sync to Repository</h3>
              <p className="secondary-text">
                Mengimpor/memperbarui Test Case yang bersumber dari halaman Confluence atau
                hasil pencarian JQL, dengan deteksi konflik step dan pengecekan duplikat
                sebelum data dikirim balik ke Jira.
              </p>

              <h3 className="doc-h3">Monitoring</h3>
              <p className="secondary-text">
                Papan status Test Execution / Test Case berbasis Xray. Anda bisa mengubah
                status langsung lewat dropdown inline:
              </p>
              <ul className="doc-list">
                <li>Status Test Execution: <code>OPEN</code> → <code>IN PROGRESS</code> → <code>DONE</code> → <code>OPEN</code></li>
                <li>Status Test Case: <code>TODO</code>, <code>EXECUTING</code>, <code>PASS</code>, <code>FAIL</code>, <code>ABORTED</code></li>
              </ul>
              <p className="secondary-text">Klik salah satu Test Execution untuk melihat daftar Test Case di dalamnya.</p>
            </section>

            {/* 6. Test Evidence Management */}
            <section id="test-evidence" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">fact_check</span>
                <h2>6. Test Evidence Management</h2>
              </div>
              <p>
                Halaman untuk menyusun dan menyinkronkan dokumentasi bukti pengujian (Test
                Evidence) langsung ke halaman Confluence.
              </p>
              <h3 className="doc-h3">Alur Penggunaan</h3>
              <ol>
                <li><strong>Isi Target Page ID</strong> di bagian atas — ID halaman Confluence tempat template tabel evidence berada.</li>
                <li>Klik <strong>&quot;Parse Entries from Page&quot;</strong> untuk mengambil dan mengurai tabel yang sudah ada di halaman tersebut (Jira Server ID untuk Jira macro akan terdeteksi otomatis).</li>
                <li>Klik <strong>&quot;Save Sync Settings&quot;</strong> untuk menyimpan konfigurasi Page ID.</li>
                <li>
                  Di bawahnya akan muncul daftar entry (row) Test Case — masing-masing berisi:
                  Issue Key (dengan tombol &quot;Fetch dari Jira/Xray&quot;), Test Case No., Function,
                  Kategori (<code>TC_HAPPY</code> / <code>TC_UNHAPPY</code> / <code>TC_REGRESSION</code>),
                  toggle hasil PASS/FAILED, Scenario, Input Data, Steps, Expected Result, dan
                  area drag-and-drop/paste untuk lampiran screenshot (bisa diurutkan,
                  dikelompokkan, diberi catatan).
                </li>
                <li>
                  Gunakan tombol <strong>&quot;Import Test Execution&quot;</strong> untuk menarik Test
                  Case dari sebuah Test Execution key secara otomatis, atau{" "}
                  <strong>&quot;Add Entry&quot;</strong> untuk menambah entry kosong secara manual.
                </li>
                <li>Tombol <strong>&quot;Clear All&quot;</strong> menghapus seluruh entry dan reset Page ID.</li>
                <li>
                  Setelah semua entry siap, klik tombol <strong>&quot;Sync to Confluence&quot;</strong> di
                  bagian bawah untuk mengirim seluruh dokumentasi ke halaman Confluence yang
                  dituju.
                </li>
              </ol>
            </section>

            {/* 7. QA Documentation Review */}
            <section id="qa-doc-review" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">rule_folder</span>
                <h2>7. QA Documentation Review</h2>
              </div>
              <p>
                Alat audit <strong>read-only</strong> untuk mengecek kelengkapan dokumentasi QA
                di Confluence dibandingkan data eksekusi di Jira/Xray — tidak ada perubahan
                yang dikirim ke Confluence atau Jira.
              </p>
              <ol>
                <li>Isi <strong>Page ID</strong> (Confluence) dan <strong>Jira Project Key</strong>.</li>
                <li>Klik <strong>&quot;Run Review&quot;</strong>.</li>
                <li>
                  Proses berjalan dengan progress live, lalu menghasilkan laporan lengkap: skor
                  keseluruhan, jumlah temuan per kategori (<code>PASS</code>, <code>WARNING</code>,{" "}
                  <code>FAIL</code>, <code>NOT_APPLICABLE</code>), detail per temuan (status,
                  bagian, judul, deskripsi, rekomendasi, tingkat keyakinan, bukti, tautan
                  sumber), serta tabel rekonsiliasi antara total eksekusi di Jira vs yang
                  terdokumentasi di Confluence.
                </li>
                <li>Hasil laporan bisa diekspor ke format <strong>XLSX</strong> atau <strong>CSV</strong>.</li>
              </ol>
            </section>

            {/* 8. Test Defect Management */}
            <section id="defect-management" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">bug_report</span>
                <h2>8. Test Defect Management</h2>
              </div>
              <p>Berisi 3 tab: <strong>Repository</strong>, <strong>Sources</strong>, <strong>Stats</strong>.</p>

              <h3 className="doc-h3">Repository</h3>
              <p className="secondary-text">
                Tabel defect yang bisa dicari dan difilter (per project, issue type, status).
                Sebelum membuat defect baru, sistem otomatis mendeteksi kandidat duplikat
                (skor kemiripan minimal 20). Klik <strong>&quot;Add Defect&quot;</strong> untuk membuka
                modal pembuatan defect baru — dilengkapi preview &quot;polish&quot; AI dan peringatan
                jika terdeteksi duplikat.
              </p>

              <h3 className="doc-h3">Sources</h3>
              <p className="secondary-text">
                Mengatur project Jira mana saja yang menjadi sumber data defect repository,
                termasuk jadwal auto-sync (hari dalam seminggu, jam, tipe issue Bug/Task/Defect).
              </p>

              <h3 className="doc-h3">Stats</h3>
              <p className="secondary-text">
                Statistik: Total Defects, Total Duplicates, Projects, Components, beserta
                breakdown-nya.
              </p>
            </section>

            {/* 9. Daily Activities */}
            <section id="daily-activities" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">event_note</span>
                <h2>9. Daily Activities</h2>
              </div>
              <p>
                Papan tiket UQA yang ditugaskan ke Anda, dengan pencarian, filter status, dan
                kolom yang bisa diurutkan (Project, Issue, Summary, Last Activity, Status).
              </p>
              <p className="secondary-text">
                Klik salah satu baris tiket untuk membuka dialog <strong>Quick Update</strong>,
                berisi 3 bagian:
              </p>

              <h3 className="doc-h3">1. Auto Generate dari Test Execution</h3>
              <p className="secondary-text">
                Klik <strong>&quot;Generate Notes&quot;</strong> — sistem mengambil statistik Test
                Execution hari ini (dari database jika sudah disinkronkan hari itu, atau
                langsung dari Xray jika belum) dan otomatis mengisi teks ringkasannya ke dalam
                field manual di bagian bawah (lihat poin 3). Hasilnya tetap bisa Anda edit
                sebelum disimpan.
              </p>

              <h3 className="doc-h3">2. Transition</h3>
              <p className="secondary-text">
                Pilih status baru dari dropdown transisi Jira yang tersedia, lalu klik{" "}
                <strong>&quot;Apply&quot;</strong>. Status akan diperbarui baik di Jira maupun di
                database lokal.
              </p>

              <h3 className="doc-h3">3. Aktivitas Hari Ini (Manual)</h3>
              <p className="secondary-text">
                Pilih <strong>Fase</strong> (<code>SIT</code> / <code>UAT</code> / <code>DT</code>),
                isi/edit teks aktivitas di textarea (baik hasil ketikan manual maupun hasil
                Auto Generate), lalu klik <strong>&quot;Catat Aktivitas&quot;</strong> untuk menyimpan —
                hanya ada satu tombol simpan untuk kedua cara input tersebut.
              </p>

              <p className="secondary-text">
                Terdapat juga ikon pengaturan (gear) di dalam halaman ini untuk mengatur mode
                pencarian tiket UQA (<code>Product Tester</code> / <code>Assignee</code> /{" "}
                <code>Both</code>) dan daftar filter Project Key.
              </p>
            </section>

            {/* 10. Notifications */}
            <section id="notifications" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">notifications</span>
                <h2>10. Notifications</h2>
              </div>
              <p>
                Log aktivitas aplikasi (sync, submit, organize, dll), masing-masing entry
                ditandai warna sesuai status (sukses/error/info), dengan badge sumber, waktu,
                pesan, dan detail tambahan jika ada (termasuk debug report untuk proses
                parsing Confluence). Klik <strong>&quot;Clear All&quot;</strong> untuk menghapus seluruh
                log.
              </p>
            </section>

            {/* 11. App docs */}
            <section id="app-docs" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">menu_book</span>
                <h2>11. Documentation (bawaan aplikasi)</h2>
              </div>
              <p className="secondary-text">Halaman ini sendiri — berisi:</p>
              <ul className="doc-list">
                <li><strong>Panduan lengkap penggunaan</strong> — dokumen yang sedang Anda baca ini</li>
                <li><strong>Navigasi cepat</strong> — daftar isi di sisi kiri mengikuti section yang sedang dibaca</li>
              </ul>
            </section>

            {/* 12. DB notes */}
            <section id="db-notes" className="doc-section">
              <div className="section-title">
                <span className="material-symbols text-primary">database</span>
                <h2>12. Catatan: Modul yang Butuh Koneksi Database</h2>
              </div>
              <p>
                Beberapa modul <strong>memerlukan koneksi database MySQL pusat</strong> agar
                berfungsi penuh, sementara yang lain bekerja murni lewat API
                Jira/Confluence/Bitbucket tanpa database.
              </p>

              <p><strong>Memerlukan koneksi database MySQL:</strong></p>
              <ul className="doc-list">
                <li>Register &amp; Login</li>
                <li>Project Management (semua aksi &quot;sync ke DB&quot;)</li>
                <li>Test Defect Management (penyimpanan repository defect, deteksi duplikat, statistik)</li>
                <li>Daily Activities — fitur Auto Generate (membaca data Test Execution yang tersinkron hari itu)</li>
                <li>Test Evidence Management — toggle status PASS/FAILED pada entry (menulis status ke database)</li>
                <li>Dashboard — kartu &quot;My Projects&quot; dan &quot;Project SDLC Types&quot;</li>
              </ul>

              <p><strong>Bekerja murni lewat API (tanpa database):</strong></p>
              <ul className="doc-list">
                <li>Test Jira/Confluence/Ollama di Settings</li>
                <li>Test Cases Management (pencarian, pembuatan, ekstraksi via API Jira/Xray)</li>
                <li>Test Evidence Management — proses sync ke Confluence itu sendiri</li>
                <li>QA Documentation Review (rekonsiliasi read-only Jira/Confluence/Xray)</li>
                <li>Knowledge Base / RAG (hanya butuh Ollama, indeksnya tersimpan lokal terpisah dari database MySQL)</li>
              </ul>

              <div className="callout-box info">
                <span className="material-symbols text-primary" style={{ marginTop: 2 }}>info</span>
                <div>
                  <p>
                    Jika suatu modul di atas tidak berfungsi atau menampilkan error, periksa
                    dulu apakah koneksi database pusat aktif — bisa dicek lewat menu{" "}
                    <strong>Settings → &quot;Run Healthcheck&quot;</strong>.
                  </p>
                </div>
              </div>
            </section>

            <p className="secondary-text" style={{ fontStyle: "italic", fontSize: 12.5 }}>
              Dokumen ini dibuat berdasarkan struktur aplikasi QA Buddy versi terbaru. Beberapa
              detail UI (label tombol, urutan field) dapat berubah mengikuti pembaruan aplikasi.
            </p>

            <p
              className="secondary-text"
              style={{
                textAlign: "center",
                fontSize: 12.5,
                marginTop: 32,
                paddingTop: 20,
                borderTop: "1px solid var(--outline-variant)",
              }}
            >
              Courtesy of <strong>Mirza Raevan Faisal</strong> and <strong>Muhammad Ridha Anshari</strong>
            </p>
          </article>
        </div>
      </div>
    </div>
  );
}
