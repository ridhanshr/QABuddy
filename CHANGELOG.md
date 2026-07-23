# Changelog

## 0.8.4 — 23 Jul 2026

### Bug Fixes

- Documentation Sync removes imported list prefixes when fetching Xray steps and expected results.
- Documentation Sync renders manually entered steps and expected results as Confluence lists.

## 0.7.0 — 18 Jun 2026

### ✨ New Features

**Defect Repository** — Local defect database with duplicate detection:
- Repository view with filtering (Project, Type, Status, Severity)
- Auto-duplicate detection via embedding similarity (`nomic-embed-text`)
- Jira project source management with scheduled auto-sync
- Statistics dashboard (defects per project, top components, issue types)
- Detail view with duplicate relation management

**Daily UQA** — Daily test activity management integrated with Jira/Xray:
- Filterable & sortable UQA issues table
- Quick Update Dialog with auto-generated notes from Xray Test Execution
- Phase breakdown (To Do, In Progress, Done, Failed, Aborted)
- Issue transitions & activity logging per issue
- Per-issue and global reminders

**Confluence Sync — Section / Module Grouping**:
- Collapsible section cards with H1 headings + TOC macro
- Backward compatible with existing pages (no sections → "Uncategorized")
- Section autocomplete from existing entry sections

### 🔧 Improvements

- **Jira Xray Integration**: Issue Key field in Confluence Sync entries now fetches test steps & expected result directly from Xray
- **Ollama Extraction**: Robust JSON parsing, 3-attempt retry with descending temperature, chunked extraction for large content, Indonesian language enforcement, sequential TC IDs
- **Dashboard**: Aggregate "Ready for QA" data across all projects
- **Confluence Sync**: Section input no longer loses focus on keystroke, proper `<h1>` stripping (handles Confluence `id` rewriting), XHTML escaping for storage format
- **Defect Repository UI**: Redesigned with better duplicate warning modal

### 🐛 Bug Fixes

- TOC duplicate entries due to Confluence rewriting `id` attribute on H1 headings
- Section/Module input field losing focus on every keystroke
- Ollama JSON parse failures on raw array responses
- Dashboard All-tab not aggregating data across all projects
- Duplicate warning modal scroll not working
- Tesseract OCR worker path in Electron

---

## 0.6.0 — Initial tracked release
