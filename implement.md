# QA Documentation Review Feature
## QABuddy - Implementation Design Document

### Version
1.5

### Author
Muhammad Ridha Anshari

### Status
Draft

---

# 1. Background

Saat ini proses review dokumentasi QA masih dilakukan secara manual menggunakan TW Checklist oleh tim Quality Assurance.

Reviewer harus membuka satu per satu halaman Confluence seperti:

- Test Management Process (TMP)
- SIT
- UAT
- Deployment Test

Kemudian melakukan pengecekan terhadap kelengkapan dokumentasi berdasarkan checklist yang berlaku.

Proses ini memiliki beberapa kendala:

- Memakan waktu.
- Berpotensi terjadi human error.
- Tidak ada standardisasi hasil review.
- Sulit mengetahui halaman mana yang belum lengkap.

Oleh karena itu diperlukan fitur **QA Documentation Review** pada QABuddy yang dapat melakukan validasi otomatis terhadap dokumentasi QA.

---

# 2. Objectives

Membantu QA Reviewer untuk:

1. Melakukan review dokumentasi secara otomatis.
2. Menemukan dokumen yang belum lengkap.
3. Menemukan field wajib yang belum terisi.
4. Menghasilkan skor kualitas dokumentasi.
5. Menghasilkan draft review TW Checklist.

---

# 3. Scope

## Included

### Test Management Process (TMP)

Review:

- Test Basis
- Risk Of Testing
- Items & Test Scope
- Assumption & Constraint
- Staffing
- Roles & Responsibilities
- Test Status Report
- Approval Form

### System Integration Test (SIT)

Review:

- Scenario Detail
- Screen Capture SIT
- SOP Verification
- Test Data
- Test Execution Log
- Test Incident Report
- Test Completion Report
- Lesson Learned
- Jira key validation for SIT
- Jira status and schedule validation
- Test Measures reconciliation with Jira Test Execution SIT

---

## Excluded (Phase 1)

- UAT document validation
- Deployment Test document validation
- Jira UQA validation
- Jira General Info validation outside SIT
- Jira UAT validation
- Jira Deploy validation
- Jira status synchronization or write/update operation

Jira/Xray API read-only integration untuk validasi SIT termasuk dalam Phase 1. Sistem hanya membaca data resmi dari Jira/Xray API dan tidak mengubah issue.

UAT dan Deployment Test direncanakan untuk phase berikutnya setelah rule dan template validasinya ditetapkan.

---

# 4. Source Structure

Input Page ID:

```text
1814292026
1814292033
```

Example:

```text
[20260620] - CCEDUR - Enhancement Dashboard URL Referral
01. System Integration Test For CCEDUR
```

Hierarchy:

```text
TMP
├── SIT
├── UAT
└── Deployment Test
```

System akan mendeteksi tipe halaman berdasarkan heading internal, struktur, konten, dan relasi parent-child Confluence. Judul halaman hanya digunakan sebagai metadata dan sinyal tambahan, bukan sebagai penentu utama tipe dokumen.

Jika input berupa Page ID TMP, sistem melakukan crawling seluruh child page berdasarkan relasi hierarchy Confluence. Jika input berupa Page ID SIT, sistem melakukan review langsung pada halaman SIT beserta child page, link evidence, dan referensi terkait.

### Page Type Detection Priority

Urutan deteksi tipe dokumen:

1. Mengambil halaman berdasarkan Page ID.
2. Memeriksa heading dan struktur konten utama.
3. Memeriksa metadata parent-child atau ancestor Confluence.
4. Menggunakan judul halaman sebagai sinyal tambahan.
5. Menandai halaman sebagai `AMBIGUOUS` jika lebih dari satu tipe dokumen terdeteksi.

TMP tidak boleh diidentifikasi hanya berdasarkan judul halaman. Pada template yang berlaku, halaman TMP dapat menggunakan judul project, misalnya:

```text
[20260620] - CCEDUR - Enhancement Dashboard URL Referral
```

Identifikasi TMP harus menemukan heading internal berikut pada konten utama:

```text
0. Test Management Process
```

Nomor section, kapitalisasi, whitespace, entity HTML, dan format inline HTML harus dinormalisasi sebelum dilakukan pencocokan. Contoh `0. Test Management Process`, `0. TEST MANAGEMENT PROCESS`, dan heading yang dibungkus `<strong>` harus dianggap ekuivalen.

Relasi parent-child harus divalidasi menggunakan metadata hierarchy Confluence, bukan hanya kemiripan judul. Jika halaman TMP ditemukan, child page SIT, UAT, dan Deployment Test dicari dari relasi hierarchy tersebut.

---

# 5. Review Architecture

```text
TMP URL / SIT URL
    │
    ▼
Confluence Parser
    │
    ▼
Page Type Detector
    │
    ▼
Page Tree Builder
    │
    ▼
Structure Validator
    │
    ▼
Content Validator
    │
    ▼
Jira Key Extractor
    │
    ▼
Jira Read-Only Connector
    │
    ▼
Jira Project & Issue Validator
    │
    ▼
Test Measures Reconciliation
    │
    ▼
AI Reviewer (Optional)
    │
    ▼
Review Result
```

---

# 6. Review Engine

## 6.1 Structure Validation

Memastikan seluruh halaman wajib tersedia.

### Example

```text
✓ SIT
✓ UAT
✓ Deployment Test
```

Jika tidak ditemukan:

```text
❌ UAT Page Missing
```

---

## 6.2 Content Validation

Memastikan field wajib sudah terisi.

### Example

```text
Maker
Checker
Signer
```

Jika kosong:

```text
❌ Approval Form Incomplete
```

---

## 6.3 AI Review (Optional)

Digunakan hanya untuk menghasilkan rekomendasi atau summary kualitas dokumentasi. Hasil AI tidak mengubah status PASS/WARNING/FAIL dan tidak memengaruhi score rule deterministik.

Contoh:

- Risk terlalu umum.
- Mitigation tidak jelas.
- Scope ambigu.
- Lesson Learned tidak lengkap.

---

# 7. TMP Validation Rules

## 7.0 TMP Page Identification

Validasi ini memastikan halaman yang diproses merupakan halaman **Test Management Process (TMP)** yang sah. Identifikasi TMP tidak bergantung pada judul halaman karena judul TMP biasanya menggunakan nama project atau change request.

### Required Detection Evidence

- Heading internal `0. Test Management Process` atau heading ekuivalen yang telah dikonfigurasi.
- Minimal satu section TMP yang dikenali dari daftar required section.
- Page ID dan Page URL tersedia.
- Space Key tersedia.

### Detection Rules

- Heading dicocokkan secara case-insensitive.
- Nomor section, whitespace berlebih, entity HTML, dan inline HTML seperti `<strong>` harus dinormalisasi.
- Judul halaman digunakan sebagai metadata dan sinyal tambahan saja.
- Jika input berasal dari parent TMP, hubungan child page harus berasal dari metadata hierarchy Confluence.
- Jika input berupa Page ID SIT langsung, halaman tidak wajib memiliki parent TMP.

PASS:

```text
TMP page detected from internal heading
TMP page metadata available
Required TMP structure found
```

WARNING:

```text
TMP page detected from an equivalent configured heading
Child page relationship is unavailable
Optional TMP metadata is missing
```

FAIL:

```text
Page cannot be accessed
TMP heading not found
Required TMP structure not found
Page hierarchy cannot be resolved for TMP crawling
```

### TMP Hierarchy Rules

Jika input berupa Page ID TMP, sistem harus:

1. Memvalidasi halaman root sebagai TMP.
2. Mengambil child page berdasarkan parent/ancestor relation Confluence.
3. Mengidentifikasi SIT, UAT, dan Deployment Test dari heading dan struktur konten child page.
4. Menyimpan parent page ID pada setiap hasil review child page.
5. Mencegah halaman yang sama diproses lebih dari satu kali.

## 7.1 Test Basis

Required:

- Requirement
- System Design

PASS:

```text
Requirement exists
System Design exists
```

FAIL:

```text
Requirement missing
System Design missing
```

---

## 7.2 Risk Of Testing

Required:

- Product Risk
- Project Risk
- Mitigation

PASS:

```text
Risk table exists
```

FAIL:

```text
Risk table not found
```

---

## 7.3 Items & Test Scope

Required:

- In Scope
- Out Scope

PASS:

```text
In Scope exists
Out Scope exists
```

WARNING:

```text
Out Scope = "-"
```

---

## 7.4 Assumption & Constraint

Required:

- Assumption
- Constraint

PASS:

```text
Assumption exists
Constraint exists
```

---

## 7.5 Staffing

Required Roles:

- Team Leader
- Tester Leader
- Product Tester
- Tim Pengembang
- Tim User

FAIL:

```text
Role not found
```

---

## 7.6 Test Status Report

Required:

- Test Status
- Progress

PASS:

```text
UQA reference found
```

FAIL:

```text
Status report missing
```

---

## 7.7 Approval Form

Required:

- Maker
- Checker
- Signer

PASS:

```text
All role assigned
```

FAIL:

```text
Maker missing
Checker missing
Signer missing
```

---

# 8. SIT Page Validation Rules

## 8.1 SIT Page Validation

Validasi ini memastikan URL atau child page yang diproses merupakan halaman **System Integration Test (SIT)** yang sah dan memiliki struktur minimum sesuai template Confluence SIT.

Page Identification Rules:

- Judul halaman mengandung `System Integration Test`, `SIT`, atau pola penamaan SIT yang dikonfigurasi.
- Halaman memiliki heading `TEST MANAGEMENT PROCESS SIT` atau section ekuivalen.
- Halaman memiliki minimal satu section Test Plan SIT dan satu section Test Completion Report SIT.
- Jika halaman ditemukan melalui TMP, relasi parent-child antara TMP dan SIT harus tersedia.
- Jika Page ID SIT dimasukkan langsung, sistem tidak mewajibkan halaman TMP sebagai parent, tetapi tetap melakukan validasi isi dan referensi.

Required Page Metadata:

- Page ID
- Page Title
- Page URL
- Space Key
- Parent Page ID jika tersedia
- Created By
- Last Updated By
- Last Updated Date

PASS:

```text
SIT page detected
SIT page metadata available
Minimum SIT structure found
```

WARNING:

```text
SIT page detected using an alternative configured title
Optional page metadata missing
Parent TMP relationship not found for direct SIT URL
```

FAIL:

```text
URL cannot be accessed
Page is not identified as an SIT document
Page content is empty
Minimum SIT structure not found
```

---

## 8.2 SIT Page Structure Validation

Required Sections:

- Test Plan SIT
- Test Strategy SIT
- Test Model Specification SIT
- Test Model & Traceability SIT
- Test Data & Environment SIT
- Test Data Requirement & Readiness SIT
- Test Environment Requirement and Readiness SIT
- Test Execution Log, Result & Incident Report SIT
- Test Completion Report SIT
- Summary of System Integration Test
- Residual Risk
- Lesson Learned

PASS:

```text
SIT page detected
All required SIT sections found
```

WARNING:

```text
Equivalent section found with a different title
```

FAIL:

```text
SIT page not found
Required SIT section missing
```

---

## 8.3 Test Strategy SIT

Required:

- Test Level / Test Types
- Entry Criteria
- Exit Criteria / Test Completion Criteria
- Degree Of Independence
- Test Design Techniques
- Test Data
- Test Environment
- Metrics to be Collected
- Retesting
- Regression
- Suspension Criteria
- Resumption Criteria
- Testing Schedule
- Jira key pada Testing Schedule
- Jira issue berasal dari Jira Project yang sesuai
- Jira Status = DONE
- Start Date terisi
- Finish Date terisi

PASS:

```text
All mandatory strategy fields exist and are populated
Testing Schedule Jira key exists in the configured Jira Project
Testing Schedule Jira Status is DONE
Testing Schedule Start Date and Finish Date are populated
```

WARNING:

```text
Testing Schedule exists but has no detailed period
Testing Schedule Jira Status is not DONE
Testing Schedule Start Date or Finish Date is empty
Optional strategy field is empty
```

FAIL:

```text
Test Level does not identify SIT
Entry Criteria missing
Exit Criteria missing
Mandatory strategy field missing
Testing Schedule Jira key not found
Testing Schedule Jira key belongs to a different project
```

---

## 8.4 Test Model and Traceability SIT

Required:

- Test Model
- Scenario-based or requirement-based reference
- Traceability between test plan and test execution
- Jira or test execution reference
- Jira key berasal dari Jira Project yang sesuai
- Jira Status = DONE
- Start Date terisi
- Finish Date terisi

PASS:

```text
Test Model defined
Scenario or requirement reference found
Test execution traceability found
Traceability Jira key matches the configured Jira Project
Traceability Jira Status is DONE
```

WARNING:

```text
Reference found but status or relationship is incomplete
Traceability Jira Status is not DONE
```

FAIL:

```text
Test Model missing
Traceability missing
Test execution reference missing
Traceability Jira key not found or belongs to another project
```

---

## 8.5 Scenario Detail and Screen Capture SIT

Required:

- Scenario Detail link or child page
- Screen Capture SIT evidence
- Test case or scenario identifier
- Expected Result
- Actual Result
- Test Result

PASS:

```text
Scenario Detail and evidence found
Each scenario has a test result
```

WARNING:

```text
Evidence cannot be mapped to a specific scenario
Screenshot count is below configurable threshold
```

FAIL:

```text
Scenario Detail missing
Screen Capture SIT missing
Expected Result, Actual Result, or Test Result missing
```

---

## 8.6 SOP Verification

Required when the change affects an operational process:

- SOP reference
- SOP verification status
- Verification result or Not Applicable reason

PASS:

```text
SOP verified
Not Applicable reason documented
```

WARNING:

```text
SOP reference exists but verification status is incomplete
```

FAIL:

```text
Operational impact found but SOP reference is missing
```

NOT APPLICABLE:

```text
No operational impact and reason documented
```

---

## 8.7 Test Data Requirement and Readiness SIT

Required Columns:

- Test Data Requirement
- Responsibility
- Period Needed
- Resetting Needs
- Archiving or Disposal
- Readiness Status

PASS:

```text
Test data table exists
Mandatory columns exist
Responsibility assigned
Readiness Status is Ready before execution
```

WARNING:

```text
Readiness Status is not Ready
Resetting Needs or Archiving/Disposal is incomplete
```

FAIL:

```text
Test data section missing
Test Data Requirement missing
Responsibility missing
Readiness Status missing
```

---

## 8.8 Test Environment Requirement and Readiness SIT

Required Columns:

- Hardware / Software
- Specification
- Purpose
- Responsibility
- Period Needed
- Readiness Status

PASS:

```text
Environment table exists
Mandatory columns exist
Readiness Status is Ready before execution
```

WARNING:

```text
Readiness Status is not Ready
Purpose or Period Needed is incomplete
```

FAIL:

```text
Environment section missing
Hardware/Software missing
Specification missing
Responsibility missing
Readiness Status missing
```

---

## 8.9 Test Execution Log and Result SIT

Required:

- Test execution reference
- Execution status
- Total test cases
- PASS, FAIL, BLOCKED, and NOT EXECUTED count when available
- Test cases executed percentage
- Jira key pada Test Execution Log
- Jira issue berasal dari Jira Project yang sesuai
- Jira Status = DONE
- Start Date terisi
- Finish Date terisi

PASS:

```text
Execution reference found
All test cases executed
No unresolved FAIL or BLOCKED result
Test Execution Log Jira key matches the configured Jira Project
Test Execution Log Jira Status is DONE
Test Execution Log Start Date and Finish Date are populated
```

WARNING:

```text
Execution below 100 percent
FAIL or BLOCKED result has a documented follow-up
Test Execution Log Jira Status is not DONE
Test Execution Log Start Date or Finish Date is empty
```

FAIL:

```text
Test Execution Log missing
Execution result missing
FAIL or BLOCKED result has no follow-up
Test Execution Log Jira key not found or belongs to another project
```

---

## 8.10 Test Incident Report SIT

Required:

- Incident or defect statement
- Defect reference when an incident exists
- Defect status and resolution
- Retest result for resolved defects

PASS:

```text
No-defect statement documented
All defects have reference, status, resolution, and retest result
```

WARNING:

```text
Open defect has a documented owner and target
```

FAIL:

```text
Incident report missing
Defect reference or status missing
Closed defect has no retest result
```

---

## 8.11 Test Completion Report SIT

Required:

- Summary of Testing Performed
- Deviation of Planned Testing
- Test Completion Evaluation
- Factor that Blocked Progress
- Test Measures
- Test Deliverables
- Jira key pada Summary of Testing Performed
- Jira issue berasal dari Jira Project yang sesuai
- Jira Status = DONE
- Start Date terisi
- Finish Date terisi

PASS:

```text
Mandatory completion fields exist
Exit Criteria fulfilled
Test Deliverables accessible
Summary of Testing Performed Jira key matches the configured Jira Project
Summary Jira Status is DONE
Summary Start Date and Finish Date are populated
```

WARNING:

```text
Deviation or blocking factor exists without complete follow-up
Summary Jira Status is not DONE
Summary Start Date or Finish Date is empty
```

FAIL:

```text
Test Completion Report missing
Test Completion Evaluation empty
Test Measures or Test Deliverables missing
Summary Jira key not found or belongs to another project
```

---

## 8.12 Test Measures Consistency

Required:

- Critical defects
- Test cases executed
- Total test cases
- Consistency with Test Execution Log
- Total Test Case pada Jira Test Execution SIT
- Jumlah PASS, FAIL, BLOCKED, dan NOT EXECUTED pada Jira jika tersedia

Comparison Formula:

```text
Confluence Total Test Case = Jira Test Execution SIT Total Test Case
Confluence Executed Test Case = Jira Executed Test Case
Confluence PASS/FAIL/BLOCKED = Jira PASS/FAIL/BLOCKED
```

PASS:

```text
Metrics available and consistent with execution result
Confluence Test Measures count equals Jira Test Execution SIT count
```

WARNING:

```text
Critical defects above zero with documented follow-up
Metric difference has a documented explanation
Jira execution is still running and reconciliation is marked provisional
```

FAIL:

```text
Metrics missing
Execution and completion metrics are inconsistent without explanation
Confluence Test Measures count differs from Jira Test Execution SIT count
```

---

## 8.13 Residual Risk

Required:

- Residual Risk statement
- Description, impact, owner, and mitigation when a risk exists

PASS:

```text
No-residual-risk statement documented
Residual risk has complete owner and mitigation
```

WARNING:

```text
Residual risk exists but owner or mitigation target is incomplete
```

FAIL:

```text
Residual Risk section missing
Residual risk has no description or mitigation
```

---

## 8.14 Lesson Learned

Required:

- Minimum one lesson learned
- Action or recommendation

PASS:

```text
Relevant lesson learned and action documented
```

WARNING:

```text
Lesson learned is too general or has no action
```

FAIL:

```text
Lesson Learned section missing or empty
```

---

## 8.15 SIT Review Scoring

```rust
pub struct SitScoreWeight {
    pub structure: u32,          // 10
    pub test_strategy: u32,      // 10
    pub traceability: u32,       // 10
    pub scenario_evidence: u32,  // 15
    pub sop_verification: u32,   // 5
    pub test_data: u32,          // 10
    pub test_environment: u32,   // 10
    pub execution_result: u32,   // 10
    pub incident_report: u32,    // 5
    pub completion_report: u32,  // 10
    pub residual_risk: u32,      // 3
    pub lesson_learned: u32,     // 2
}
```

Total Weight: 100

Scoring Rules:

- PASS = 100% dari bobot rule.
- WARNING = 50% dari bobot rule.
- FAIL = 0% dari bobot rule.
- NOT APPLICABLE tidak mengurangi skor. Bobotnya didistribusikan secara proporsional ke rule yang applicable.

---

## 8.16 SIT Cross-Section Consistency

System harus melakukan validasi antar-section:

- Test Data pada Test Strategy konsisten dengan Test Data Requirement and Readiness.
- Test Environment pada Test Strategy konsisten dengan Test Environment Requirement and Readiness.
- Total test case dan persentase eksekusi konsisten antara Test Execution Log dan Test Completion Report.
- Defect pada Test Incident Report konsisten dengan Critical Defects pada Test Measures.
- Test Deliverables mengarah ke Scenario Detail dan Screen Capture SIT.
- Exit Criteria konsisten dengan Test Completion Evaluation.

WARNING:

```text
Different value or status has a documented explanation
```

FAIL:

```text
Different value or status has no explanation
```

---

## 8.17 Jira Project Cross-Validation for SIT

Jira validation applies to Jira keys extracted from these Confluence fields:

1. Testing Schedule
2. Traceability between Test Execution and Test
3. Test Execution Log
4. Summary of Testing Performed

Required Configuration:

- Jira Base URL
- Authentication credential or service account
- Expected Jira Project Key
- Allowed issue types for SIT planning and execution
- DONE status mapping, configurable when Jira uses another final status name
- Start Date field ID
- Finish Date field ID
- Test Execution result field or endpoint

Validation Sequence:

```text
Extract Jira key from Confluence field
        ↓
Validate Jira key format
        ↓
Fetch issue from Jira API
        ↓
Validate issue exists
        ↓
Validate issue.project.key = expected Jira Project Key
        ↓
Validate issue type is allowed for the SIT field
        ↓
Validate status = DONE
        ↓
Validate Start Date is populated
        ↓
Validate Finish Date is populated
        ↓
Return PASS / WARNING / FAIL finding
```

Validation Rules:

PASS:

```text
Jira issue found
Jira issue belongs to the expected project
Jira issue type is allowed
Status is DONE
Start Date is populated
Finish Date is populated
```

WARNING:

```text
Jira issue and project are valid but Status is not DONE
Start Date or Finish Date is empty
Jira API is temporarily unavailable and validation cannot be completed
```

FAIL:

```text
Jira key format invalid
Jira issue not found
Jira issue belongs to a different project
Jira issue type is not allowed for the Confluence field
Confluence Jira key and Jira response key do not match
```

Security Rules:

- Integration must be read-only.
- Credentials must not be stored in logs or review findings.
- API error messages must be sanitized.
- Jira access must follow the current user's authorization or an approved service account scope.

---

## 8.18 Jira Field-Specific Rules

### Testing Schedule

Expected Jira Object:

- SIT planning or schedule issue.
- Project Key matches the configured project.
- Status = DONE.
- Start Date and Finish Date are populated.

### Traceability between Test Execution and Test

Expected Jira Object:

- SIT test plan or traceability issue.
- Project Key matches the configured project.
- Status = DONE.
- Linked test execution issue is available when required by the Jira test management model.

### Test Execution Log

Expected Jira Object:

- SIT Test Execution issue.
- Project Key matches the configured project.
- Status = DONE.
- Test execution result and total Test Case can be retrieved.

### Summary of Testing Performed

Expected Jira Object:

- Jira issue or issue collection representing completed SIT execution.
- Project Key matches the configured project.
- Status = DONE.
- Referenced execution keys are consistent with Test Execution Log.

---

## 8.19 Test Measures and Jira Test Execution Reconciliation

Data Sources:

- Confluence Test Measures.
- Seluruh Jira Test Execution SIT yang direferensikan oleh Test Execution Log dan/atau Summary of Testing Performed.

### Source of Truth

- Jira/Xray API adalah sumber resmi untuk status issue, execution summary, total test case, executed test case, PASS, FAIL, BLOCKED, dan NOT EXECUTED.
- Confluence hanya menjadi sumber untuk Test Measures yang ditulis pada dokumen dan Jira key/reference yang perlu divalidasi.
- Nilai metric yang tampil pada rendered Jira macro di Confluence tidak digunakan sebagai sumber metric final apabila Jira/Xray API dapat diakses.
- Jika Jira/Xray API tidak tersedia, metric tidak boleh dianggap valid secara otomatis. Sistem harus menghasilkan `WARNING` atau `FAIL` sesuai ketersediaan data dan menampilkan alasan pada finding.

### Multi-Test Execution Aggregation

Satu project dapat memiliki lebih dari satu Jira Test Execution untuk satu siklus SIT. Sistem tidak boleh hanya mengambil satu Jira key pertama. Semua Test Execution yang relevan harus dikumpulkan dari seluruh referensi pada section SIT.

Contoh:

```text
Jira Test Execution summary dari Jira/Xray API:
- CCEDUR-180 = PASS 60
- CCEDUR-191 = PASS 4

Aggregated Jira Test Measures:
- PASS = 60 + 4 = 64
- Executed = 60 + 4 = 64
- Total = 64
```

Aturan pemilihan Test Execution:

1. Ambil semua Jira key dari Test Execution Log dan Summary of Testing Performed.
2. Gabungkan Jira key dari Jira macro atau field referensi lain yang berada dalam section SIT yang sama.
3. Hilangkan duplikasi Jira key jika key yang sama muncul di lebih dari satu section.
4. Validasi setiap issue terhadap expected Jira Project, allowed issue type, dan status mapping.
5. Ambil status dan seluruh metric execution dari Jira/Xray API, bukan dari angka rendered pada Confluence.
6. Hanya issue yang teridentifikasi sebagai SIT Test Execution atau execution yang dikonfigurasi untuk field tersebut yang masuk kandidat agregasi.
7. Hanya execution dengan status issue `DONE` yang masuk agregasi metric.
8. Execution dengan status selain `DONE`, termasuk `IN PROGRESS` atau status gagal, tidak masuk agregasi tetapi harus ditampilkan sebagai finding pada screen.
9. Jika sebuah execution muncul pada lebih dari satu field, hitung satu kali saja berdasarkan Jira key unik.
10. Rollback execution tetap masuk agregasi jika statusnya `DONE` dan memenuhi validasi project/issue type.
11. Jika tidak ada execution `DONE` yang valid, hasil rekonsiliasi adalah `FAIL` karena tidak ada metric resmi yang dapat dipetakan.

Aggregation Formula:

```text
Aggregated Total = SUM(Jira Total Test Case dari setiap execution unik)
Aggregated Executed = SUM(Jira Executed Test Case dari setiap execution unik)
Aggregated PASS = SUM(Jira PASS dari setiap execution unik)
Aggregated FAIL = SUM(Jira FAIL dari setiap execution unik)
Aggregated BLOCKED = SUM(Jira BLOCKED dari setiap execution unik)
Aggregated NOT EXECUTED = SUM(Jira NOT EXECUTED dari setiap execution unik)
Aggregated Execution Percentage = Aggregated Executed / Aggregated Total * 100
```

Agregasi dilakukan berdasarkan summary metric dari setiap Jira Test Execution yang unik. Sistem tidak perlu memeriksa duplicate scenario atau duplicate test case antar execution. Dengan demikian, rollback atau execution terpisah tetap dijumlahkan sesuai summary resmi Jira/Xray API.

Hasil agregasi harus menyimpan seluruh Jira key yang digunakan, bukan hanya satu key:

```text
Jira Execution Keys: [CCEDUR-180, CCEDUR-191]
Jira Total: 64
Jira Executed: 64
Jira PASS: 64
Jira FAIL: 0
Jira BLOCKED: 0
Jira NOT EXECUTED: 0
```

Execution yang tidak masuk agregasi tetap ditampilkan, contoh:

```text
Excluded Jira Execution:
- CCEDUR-200: IN PROGRESS - excluded from aggregated metric
- CCEDUR-201: FAIL - excluded from aggregated metric
```

Required Comparison:

- Total Test Case.
- Executed Test Case.
- PASS Test Case.
- FAIL Test Case.
- BLOCKED Test Case.
- NOT EXECUTED Test Case, if available.
- Execution percentage.

Normalization Rules:

```text
Jira Total = PASS + FAIL + BLOCKED + NOT EXECUTED
Jira Executed = PASS + FAIL + BLOCKED
Jira Execution Percentage = Jira Executed / Jira Total * 100
```

The validator compares normalized Jira values with the values written in Confluence Test Measures.

PASS:

```text
Confluence Total Test Case equals Aggregated Jira Total Test Case
Confluence Executed Test Case equals Aggregated Jira Executed Test Case
Result breakdown and execution percentage are consistent
All referenced Jira Test Execution keys were validated
All aggregated executions have status DONE
```

FAIL:

```text
Confluence Total Test Case differs from Aggregated Jira Total Test Case
Confluence Executed Test Case differs from Aggregated Jira Executed Test Case
PASS, FAIL, or BLOCKED count differs
Execution percentage differs beyond the configured rounding tolerance
One or more Jira Test Execution data cannot be mapped to the referenced Confluence field
No valid Jira Test Execution was found
```

WARNING:

```text
One or more referenced Jira Test Execution has status other than DONE
Jira/Xray API is temporarily unavailable and official metric cannot be retrieved
Non-DONE execution was excluded from aggregation and shown to the reviewer
```

Example:

```text
Confluence Test Measures: 64 executed test cases
Jira/Xray API Test Execution summary:
- CCEDUR-180: 60 executed test cases
- CCEDUR-191: 4 executed test cases
Aggregated Jira Test Execution SIT: 64 executed test cases
Result: PASS - Test Measures matches aggregated Jira Test Execution SIT
```

Tolerance:

- Test Case count tolerance = 0.
- Percentage tolerance may be configured only for rounding, default 0.01%.
- A count difference must always be marked FAIL even when the percentage appears equal.

---

# 9. Review Status

```rust
pub enum ReviewStatus {
    Pass,
    Warning,
    Fail,
    NotApplicable,
}
```

---

# 10. Severity Level

```rust
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}
```

---

# 11. Review Result Model

```rust
pub enum DocumentType {
    Tmp,
    Sit,
    Uat,
    Deployment,
}

pub struct ReviewFinding {
    pub document_type: DocumentType,
    pub section: String,
    pub status: ReviewStatus,
    pub severity: Severity,
    pub title: String,
    pub description: String,
    pub recommendation: String,
    pub source_key: Option<String>,
    pub expected_value: Option<String>,
    pub actual_value: Option<String>,
}

pub struct JiraIssueValidation {
    pub confluence_field: String,
    pub jira_key: String,
    pub expected_project_key: String,
    pub actual_project_key: String,
    pub issue_type: String,
    pub status: String,
    pub start_date: Option<String>,
    pub finish_date: Option<String>,
    pub status_match: bool,
    pub project_match: bool,
    pub dates_complete: bool,
}

pub struct TestMeasureReconciliation {
    pub jira_execution_keys: Vec<String>,
    pub confluence_total: u32,
    pub jira_total: u32,
    pub confluence_executed: u32,
    pub jira_executed: u32,
    pub confluence_pass: Option<u32>,
    pub jira_pass: Option<u32>,
    pub confluence_fail: Option<u32>,
    pub jira_fail: Option<u32>,
    pub confluence_blocked: Option<u32>,
    pub jira_blocked: Option<u32>,
    pub confluence_not_executed: Option<u32>,
    pub jira_not_executed: Option<u32>,
    pub difference: i32,
    pub is_match: bool,
}
```

---

# 12. Review Summary Model

```rust
pub struct ReviewSummary {
    pub score: u32,
    pub pass_count: u32,
    pub warning_count: u32,
    pub fail_count: u32,
    pub findings: Vec<ReviewFinding>,
}
```

---

# 13. Backend Structure

```text
src-tauri/
└── src
    ├── commands
    │   └── document_review.rs
    │
    ├── services
    │   ├── confluence_parser.rs
    │   ├── page_type_detector.rs
    │   ├── confluence_hierarchy.rs
    │   ├── review_engine.rs
    │   ├── tmp_validator.rs
    │   ├── sit_page_validator.rs
    │   ├── sit_validator.rs
    │   ├── sit_rule_config.rs
    │   ├── evidence_validator.rs
    │   ├── consistency_validator.rs
    │   ├── jira_key_extractor.rs
    │   ├── jira_client.rs
    │   ├── jira_issue_validator.rs
    │   ├── jira_test_execution_parser.rs
    │   ├── test_measure_reconciler.rs
    │   ├── uat_validator.rs
    │   └── deployment_validator.rs
    │
    ├── models
    │   ├── review_result.rs
    │   ├── jira_issue_validation.rs
    │   └── test_measure_reconciliation.rs
    │
    ├── config
    │   └── jira_validation_config.rs
    │
    └── prompts
        └── document_review_prompt.rs
```

---

# 14. Frontend Structure

```text
src/
└── components
    └── DocumentationReview
        ├── DocumentationReview.tsx
        ├── ReviewSummary.tsx
        ├── ReviewFinding.tsx
        └── ReviewScore.tsx
```

---

# 15. User Flow

```text
Open Documentation Review
        │
        ▼
Input TMP Page ID / SIT Page ID
        │
        ▼
Detect Document Type
        │
        ▼
Crawl Confluence Page and References
        │
        ▼
Run TMP Validator / SIT Validator
        │
        ▼
Extract Jira Keys from SIT Fields
        │
        ▼
Validate Jira Project, Status, Start Date, and Finish Date
        │
        ▼
Reconcile Test Measures with Jira Test Execution SIT
        │
        ▼
Run Cross-Section Consistency Validation
        │
        ▼
Generate Review Result
```

---

# 16. Sample Output

```text
Documentation Review

Project
CCEDUR Enhancement Dashboard URL Referral

Document Type
SIT

Score
92 / 100

Overall Status
WARNING

PASS
✓ Test Strategy SIT
✓ Test Model & Traceability SIT
✓ Test Data Requirement & Readiness SIT
✓ Test Environment Requirement & Readiness SIT
✓ Test Execution Log
✓ Test Completion Evaluation
✓ Residual Risk
✓ Lesson Learned

WARNING
⚠ Testing Schedule has no detailed period
⚠ Evidence cannot be mapped to all scenarios
⚠ CCEDUR-179 Start Date is empty

FAIL
✗ CCEDUR-999 was not found in the configured Jira Project
✓ Test Measures matches aggregated Jira Test Execution SIT: 60 + 4 = 64

Recommendation
Complete the missing Jira date and correct the invalid Jira key. Test Measures is already aligned with the aggregated Jira Test Execution result.
```

---

# 17. Future Enhancement

## Phase 2

AI Quality Review

Phase 1 hanya menyediakan AI recommendation atau summary yang bersifat informatif dan tidak memengaruhi score. Analisis kualitas yang lebih mendalam masuk Phase 2.

Examples:

- Scope ambiguity detection.
- Risk quality analysis.
- Lesson Learned quality review.
- Missing mitigation recommendation.

## Phase 3

TW Checklist Auto Generator

Output:

```text
TW Checklist
PDF
Excel
Word
```

## Phase 4

Extended Jira Integration

Features:

- UQA Validation
- UAT and Deploy Validation
- Jira write/update operation after approval
- Status Synchronization

Note: Jira read-only validation for SIT is included in Phase 1.

---

# 18. Change Log

## Version 1.6

- Mengubah input review dari full Confluence URL menjadi Page ID numerik.
- Menambahkan validasi Page ID hanya berupa angka pada backend dan frontend.
- Menghapus placeholder URL atau data dokumen contoh dari screen review.
- Memperbarui user flow dan source structure agar menggunakan Page ID.

## Version 1.5

- Membatasi implementasi Phase 1 pada TMP dan SIT.
- Menetapkan Jira/Xray API sebagai source of truth untuk metric Test Execution.
- Menetapkan hanya execution berstatus `DONE` yang masuk agregasi.
- Menampilkan execution `IN PROGRESS` atau status gagal sebagai finding tanpa memasukkannya ke agregasi.
- Menetapkan rollback execution berstatus `DONE` tetap dijumlahkan.
- Menetapkan agregasi berdasarkan summary metric Jira/Xray tanpa validasi duplicate scenario antar execution.
- Menetapkan AI hanya sebagai sumber recommendation atau summary dan tidak memengaruhi score.

## Version 1.4

- Menambahkan dukungan agregasi beberapa Jira Test Execution dalam satu project/SIT.
- Menjumlahkan PASS, FAIL, BLOCKED, NOT EXECUTED, Total, dan Executed dari setiap execution unik.
- Menambahkan deduplikasi Jira key yang direferensikan oleh beberapa section.
- Memperbarui contoh CCEDUR-180 dan CCEDUR-191 menjadi agregasi 64 test case.
- Memperbarui `TestMeasureReconciliation` untuk menyimpan banyak Jira execution key dan breakdown metric.

## Version 1.3

- Memperjelas bahwa TMP tidak diidentifikasi dari judul halaman.
- Menambahkan deteksi heading internal `0. Test Management Process`.
- Menambahkan prioritas deteksi berdasarkan heading, struktur, dan hierarchy Confluence.
- Menambahkan aturan crawling child page berdasarkan parent-child/ancestor relation.
- Menambahkan status `AMBIGUOUS` untuk halaman dengan lebih dari satu sinyal tipe dokumen.
- Menambahkan `page_type_detector.rs` dan `confluence_hierarchy.rs` pada rancangan backend.

## Version 1.2

- Menambahkan Jira read-only validation untuk dokumen SIT.
- Memvalidasi Jira key pada Testing Schedule, Traceability, Test Execution Log, dan Summary of Testing Performed.
- Memvalidasi kesesuaian Jira Project, issue type, Status DONE, Start Date, dan Finish Date.
- Menambahkan rekonsiliasi Test Measures dengan Jira Test Execution SIT.
- Menetapkan perbedaan jumlah Test Case sebagai FAIL dengan tolerance count = 0.
- Menambahkan model hasil validasi, service backend, user flow, dan sample finding Jira.

## Version 1.1

- Menambahkan dukungan input Page ID SIT secara langsung.
- Menambahkan SIT Page Validation Rules, page metadata validation, page detection, dan structure validation.
- Menambahkan SIT content validation rules.
- Menambahkan Scenario Detail, Screen Capture, dan SOP Verification validation.
- Menambahkan cross-section consistency validation.
- Menambahkan SIT scoring weight.
- Memperbarui backend structure, user flow, result model, dan sample output.

---

# 19. Expected Benefits

- Mengurangi waktu review dokumentasi hingga >70%.
- Mengurangi human error.
- Standardisasi hasil review.
- Mempercepat proses TW Checklist.
- Meningkatkan kualitas dokumentasi QA.
