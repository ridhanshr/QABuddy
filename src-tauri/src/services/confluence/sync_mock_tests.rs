//! End-to-end `sync_to_confluence` against a local mock Confluence server.
//! Regression guard: ALL images inside every Expand group must be uploaded
//! and referenced (bug: only the first image of each expand was uploaded).

use crate::models::app_config::{AuthMode, ConfluenceConfig};
use crate::models::misc::{
    ParseConfluenceEntriesOptions, ParseConfluenceEntriesResult, SyncToConfluencePayload,
    SyncToConfluenceResult,
};
use crate::services::confluence::ConfluenceService;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

#[derive(Default)]
struct MockState {
    uploads: Vec<String>,
    final_content: String,
    page_content: String,
    /// Next N POST attachment requests answer HTTP 500 (for retry tests).
    fail_next_uploads: usize,
    /// The next POST of this filename answers with the Confluence
    /// "same file name as an existing attachment" error (once).
    duplicate_name_error_for: Option<String>,
}

fn parse_request(buf: &[u8]) -> Option<(String, usize, usize)> {
    let header_end = buf.windows(4).position(|w| w == b"\r\n\r\n")?;
    let header = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = header.lines();
    let request_line = lines.next()?.to_string();
    let mut content_length = 0usize;
    for line in lines {
        if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }
    Some((request_line, header_end + 4, content_length))
}

async fn serve(listener: tokio::net::TcpListener, state: Arc<Mutex<MockState>>) {
    loop {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let state = state.clone();
        tokio::spawn(async move {
            let mut buf: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 65536];
            let (request_line, body_start, content_length) = loop {
                let n = socket.read(&mut chunk).await.unwrap_or(0);
                if n == 0 {
                    return;
                }
                buf.extend_from_slice(&chunk[..n]);
                if let Some(parsed) = parse_request(&buf) {
                    break parsed;
                }
                if buf.len() > 64 * 1024 * 1024 {
                    return;
                }
            };
            while buf.len() < body_start + content_length {
                let n = socket.read(&mut chunk).await.unwrap_or(0);
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            let body = String::from_utf8_lossy(&buf[body_start..]).to_string();

            let mut parts = request_line.split_whitespace();
            let verb = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();

            let (status, response) = if verb == "GET"
                && path.contains("/rest/api/content/")
                && path.contains("expand=body")
            {
                let page = state.lock().await.page_content.clone();
                (
                    200,
                    json!({
                        "title": "Mock Page",
                        "version": { "number": 1 },
                        "body": { "storage": { "value": page } },
                        "_links": { "base": "http://confluence.test" }
                    })
                    .to_string(),
                )
            } else if verb == "GET" && path.contains("/child/attachment") {
                (200, json!({ "results": [] }).to_string())
            } else if verb == "POST" && path.contains("/child/attachment") {
                let mut filename = String::new();
                if let Some(pos) = body.find("filename=\"") {
                    let rest = &body[pos + 10..];
                    if let Some(end) = rest.find('"') {
                        filename = rest[..end].to_string();
                    }
                }

                enum PostOutcome {
                    Dup,
                    Fail,
                    Ok,
                }
                let outcome = {
                    let mut st = state.lock().await;
                    if st.duplicate_name_error_for.as_deref() == Some(filename.as_str()) {
                        st.duplicate_name_error_for = None;
                        PostOutcome::Dup
                    } else if st.fail_next_uploads > 0 {
                        st.fail_next_uploads -= 1;
                        PostOutcome::Fail
                    } else {
                        st.uploads.push(filename.clone());
                        PostOutcome::Ok
                    }
                };
                match outcome {
                    PostOutcome::Dup => (
                        500,
                        json!({ "message": "Cannot add a new attachment with same file name as an existing attachment" }).to_string(),
                    ),
                    PostOutcome::Fail => {
                        (500, json!({ "message": "Confluence is busy" }).to_string())
                    }
                    PostOutcome::Ok => (
                        200,
                        json!({ "results": [ { "title": filename, "id": "att1" } ] }).to_string(),
                    ),
                }
            } else if verb == "DELETE" && path.contains("/child/attachment/") {
                (204, json!({}).to_string())
            } else if verb == "PUT" && path.contains("/rest/api/content/") {
                let payload: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let content = payload["body"]["storage"]["value"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                let mut st = state.lock().await;
                st.final_content = content.clone();
                st.page_content = content;
                (
                    200,
                    json!({ "id": "123", "_links": { "base": "http://confluence.test" } })
                        .to_string(),
                )
            } else {
                (404, json!({ "message": "not found" }).to_string())
            };

            let resp = format!(
                "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                response.len()
            );
            let _ = socket.write_all(resp.as_bytes()).await;
            let _ = socket.flush().await;
        });
    }
}

fn make_config(addr: std::net::SocketAddr) -> ConfluenceConfig {
    ConfluenceConfig {
        base_url: format!("http://{}", addr),
        auth_mode: AuthMode::Bearer,
        username: "u".into(),
        token: "t".into(),
        space_key: "QA".into(),
        target_page_id: "123".into(),
        jira_server_id: None,
        image_max_width: None,
    }
}

fn entry_json(id: &str, images: Value) -> Value {
    json!({
        "id": id,
        "testCaseNo": "TC001",
        "functionName": "Auth",
        "scenario": "Login flow",
        "category": "TC_HAPPY",
        "inputData": "user",
        "steps": "1. Login",
        "expectedResult": "Dashboard",
        "result": "PASS",
        "images": images,
    })
}

fn img(name: &str, order: u64, group: &str) -> Value {
    // 1x1 png data uri
    json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "name": name,
        "order": order,
        "expandGroup": group,
        "note": "",
        "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    })
}

async fn run_sync_with_state(
    state: Arc<Mutex<MockState>>,
    payload: SyncToConfluencePayload,
) -> (Arc<Mutex<MockState>>, SyncToConfluenceResult) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(serve(listener, state.clone()));

    let config = make_config(addr);
    let service = ConfluenceService::new();
    let result = service
        .sync_to_confluence(None, &config, "123", &payload)
        .await
        .expect("sync must succeed");
    (state, result)
}

async fn run_sync(
    payload: SyncToConfluencePayload,
) -> (Arc<Mutex<MockState>>, SyncToConfluenceResult) {
    let state = Arc::new(Mutex::new(MockState::default()));
    run_sync_with_state(state, payload).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sync_uploads_all_images_per_expand_group() {
    let images = json!([
        img("db1.png", 1, "DB"),
        img("db2.png", 2, "DB"),
        img("db3.png", 3, "DB"),
        img("excel1.png", 4, "Excel"),
        img("excel2.png", 5, "Excel"),
        img("api1.png", 6, "API"),
        img("api2.png", 7, "API"),
    ]);
    let payload = SyncToConfluencePayload {
        entries: vec![entry_json("entry-1", images)],
        deleted_table_indices: vec![],
    };

    let (state, result) = run_sync(payload).await;
    let st = state.lock().await;
    assert_eq!(
        st.uploads.len(),
        7,
        "all 7 images must be uploaded. uploaded: {:?}",
        st.uploads
    );
    assert_eq!(result.image_count, 7);
    assert_eq!(
        st.final_content.matches("<ac:image").count(),
        7,
        "final page must reference all 7 images. content: {}",
        st.final_content
    );
    assert_eq!(st.final_content.matches("ac:name=\"expand\"").count(), 3);
    for name in [
        "TC001-Login-flow-1.png",
        "TC001-Login-flow-2.png",
        "TC001-Login-flow-3.png",
        "TC001-Login-flow-4.png",
        "TC001-Login-flow-5.png",
        "TC001-Login-flow-6.png",
        "TC001-Login-flow-7.png",
    ] {
        assert!(st.final_content.contains(name), "missing {name} in final content");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sync_patches_existing_table_with_all_images_per_expand() {
    let images = json!([
        img("db1.png", 1, "DB"),
        img("db2.png", 2, "DB"),
        img("excel1.png", 3, "Excel"),
        img("excel2.png", 4, "Excel"),
    ]);
    let mut entry = entry_json("entry-1", images);
    entry["sourceTableIndex"] = json!(0);
    let payload = SyncToConfluencePayload {
        entries: vec![entry],
        deleted_table_indices: vec![],
    };

    let (state, result) = run_sync(payload).await;
    let st = state.lock().await;
    assert_eq!(st.uploads.len(), 4, "all 4 images uploaded, got {:?}", st.uploads);
    assert_eq!(result.image_count, 4);
    assert_eq!(
        st.final_content.matches("<ac:image").count(),
        4,
        "all 4 referenced. content: {}",
        st.final_content
    );
    assert_eq!(st.final_content.matches("ac:name=\"expand\"").count(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sync_updates_table_whose_screen_capture_cell_has_expand_macros() {
    // Second-sync scenario: the existing Screen Capture cell on the page
    // already contains Expand macros (from a previous sync).
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = Arc::new(Mutex::new(MockState::default()));
    let page_content = r#"<table class="wrapped confluenceTable"><tbody>
<tr><th class="confluenceTh">No. Test Case</th><td class="confluenceTd"><p>TC001</p></td></tr>
<tr><th class="confluenceTh">Function</th><td class="confluenceTd"><p>Auth</p></td></tr>
<tr><th class="confluenceTh">Scenario</th><td class="confluenceTd"><p>Login flow</p></td></tr>
<tr><th class="confluenceTh">Kategori</th><td class="confluenceTd"><p>Happy</p></td></tr>
<tr><th class="confluenceTh">Input Data</th><td class="confluenceTd"><p>user</p></td></tr>
<tr><th class="confluenceTh">Steps</th><td class="confluenceTd"><ol><li>Login</li></ol></td></tr>
<tr><th class="confluenceTh">Expected Result</th><td class="confluenceTd"><p>Dashboard</p></td></tr>
<tr><th class="confluenceTh">Result</th><td class="confluenceTd"><p>PASS</p></td></tr>
<tr><th class="confluenceTh">Screen Capture</th><td class="confluenceTd">
<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">DB</ac:parameter><ac:rich-text-body><p><ac:image ac:width="450"><ri:attachment ri:filename="old_eid_db1.png" /></ac:image></p></ac:rich-text-body></ac:structured-macro>
<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Excel</ac:parameter><ac:rich-text-body><p><ac:image ac:width="450"><ri:attachment ri:filename="old_eid_excel1.png" /></ac:image></p></ac:rich-text-body></ac:structured-macro>
</td></tr>
</tbody></table>"#;

    // handler needs to return page_content — reuse serve but we need custom page.
    // Simplest: patch state-based page content via a custom server here.
    struct PageServer;
    let state2 = Arc::new(Mutex::new(MockState::default()));
    let page_state = Arc::new(Mutex::new(page_content.to_string()));
    let st_clone = state2.clone();
    let pg_clone = page_state.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { return; };
            let st = st_clone.clone();
            let pg = pg_clone.clone();
            tokio::spawn(async move {
                let mut buf: Vec<u8> = Vec::new();
                let mut chunk = [0u8; 65536];
                let (request_line, body_start, content_length) = loop {
                    let n = socket.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 { return; }
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(parsed) = parse_request(&buf) { break parsed; }
                };
                while buf.len() < body_start + content_length {
                    let n = socket.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 { break; }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let body = String::from_utf8_lossy(&buf[body_start..]).to_string();
                let mut parts = request_line.split_whitespace();
                let verb = parts.next().unwrap_or("").to_string();
                let path = parts.next().unwrap_or("").to_string();
                let (status, response) = if verb == "GET" && path.contains("/rest/api/content/") && path.contains("expand=body") {
                    (200, json!({
                        "title": "Mock Page",
                        "version": { "number": 2 },
                        "body": { "storage": { "value": pg.lock().await.clone() } },
                        "_links": { "base": "http://confluence.test" }
                    }).to_string())
                } else if verb == "GET" && path.contains("/child/attachment") {
                    // existing attachments from previous sync (old naming)
                    (200, json!({ "results": [
                        { "title": "old_eid_db1.png", "id": "old-1" },
                        { "title": "old_eid_excel1.png", "id": "old-2" }
                    ] }).to_string())
                } else if verb == "POST" && path.contains("/child/attachment") {
                    let mut filename = String::new();
                    if let Some(pos) = body.find("filename=\"") {
                        let rest = &body[pos + 10..];
                        if let Some(end) = rest.find('"') { filename = rest[..end].to_string(); }
                    }
                    st.lock().await.uploads.push(filename.clone());
                    (200, json!({ "results": [ { "title": filename } ] }).to_string())
                } else if verb == "DELETE" && path.contains("/child/attachment/") {
                    (204, json!({}).to_string())
                } else if verb == "PUT" && path.contains("/rest/api/content/") {
                    let payload: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                    let content = payload["body"]["storage"]["value"].as_str().unwrap_or("").to_string();
                    st.lock().await.final_content = content;
                    (200, json!({ "id": "123", "_links": { "base": "http://confluence.test" } }).to_string())
                } else {
                    (404, json!({ "message": "not found" }).to_string())
                };
                let resp = format!(
                    "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                    response.len()
                );
                let _ = socket.write_all(resp.as_bytes()).await;
            });
        }
    });

    let config = make_config(addr);
    let service = ConfluenceService::new();

    // New image set: user added db2 + excel2 to the existing groups, names
    // for existing ones match the page attachments (parse-hydrated names).
    let images = json!([
        img("old_eid_db1.png", 1, "DB"),
        img("db2.png", 2, "DB"),
        img("old_eid_excel1.png", 3, "Excel"),
        img("excel2.png", 4, "Excel"),
    ]);
    let mut entry = entry_json("new-eid", images);
    entry["sourceTableIndex"] = json!(0);
    let payload = SyncToConfluencePayload {
        entries: vec![entry],
        deleted_table_indices: vec![],
    };

    let result = service
        .sync_to_confluence(None, &config, "123", &payload)
        .await
        .expect("sync must succeed");

    let st = state2.lock().await;
    // All 4 images are uploaded under the canonical names — the 2 old-named
    // attachments get renamed (uploaded anew + old ones deleted).
    assert_eq!(st.uploads.len(), 4, "all 4 images renamed+uploaded, got {:?}", st.uploads);
    assert_eq!(result.image_count, 4);
    assert_eq!(
        st.final_content.matches("<ac:image").count(),
        4,
        "all 4 images must be referenced. content: {}",
        st.final_content
    );
    assert_eq!(st.final_content.matches("ac:name=\"expand\"").count(), 2);
    for name in ["TC001-Login-flow-1.png", "TC001-Login-flow-2.png", "TC001-Login-flow-3.png", "TC001-Login-flow-4.png"] {
        assert!(st.final_content.contains(name), "{name} must be in content");
    }
    assert!(!st.final_content.contains("old_eid_"), "old names must be gone: {}", st.final_content);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sync_uploads_duplicate_named_images_as_distinct_attachments() {
    // Regression: images sharing a filename (same entry) used to collapse into
    // ONE Confluence attachment (version overwrite) — only the first image
    // survived. Each must now be uploaded and referenced distinctly.
    let images = json!([
        img("image.png", 1, "DB"),
        img("image.png", 2, "DB"),
        img("image.png", 3, "Excel"),
    ]);
    let payload = SyncToConfluencePayload {
        entries: vec![entry_json("entry-1", images)],
        deleted_table_indices: vec![],
    };

    let (state, result) = run_sync(payload).await;
    let st = state.lock().await;
    assert_eq!(st.uploads.len(), 3, "3 distinct uploads expected: {:?}", st.uploads);
    let unique: std::collections::HashSet<&String> = st.uploads.iter().collect();
    assert_eq!(unique.len(), 3, "upload names must be unique: {:?}", st.uploads);
    assert_eq!(result.image_count, 3);
    assert_eq!(st.final_content.matches("<ac:image").count(), 3);
    let refs: std::collections::HashSet<String> = st
        .final_content
        .split("ri:filename=\"")
        .skip(1)
        .map(|s| s.split('"').next().unwrap().to_string())
        .collect();
    assert_eq!(refs.len(), 3, "distinct attachment refs expected: {refs:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sync_retries_transient_upload_errors() {
    // First 2 POST attempts answer 500 (both attempts of the same file) —
    // the 3rd attempt succeeds, so the image still makes it to the page.
    let images = json!([img("db1.png", 1, "DB"), img("db2.png", 2, "DB")]);
    let payload = SyncToConfluencePayload {
        entries: vec![entry_json("entry-1", images)],
        deleted_table_indices: vec![],
    };
    let state = Arc::new(Mutex::new(MockState {
        fail_next_uploads: 2,
        ..Default::default()
    }));

    let (state, result) = run_sync_with_state(state, payload).await;
    let st = state.lock().await;
    assert_eq!(result.image_count, 2, "retry must recover transient 500s");
    assert_eq!(st.uploads.len(), 2);
    assert_eq!(st.final_content.matches("<ac:image").count(), 2);
    assert_eq!(result.upload_results.len(), 2);
    assert!(result.upload_results.iter().all(|r| r.success));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sync_reports_failed_uploads_in_result() {
    // All attempts answer 500 — the failure must be reported per attachment
    // so the UI log can show a card with the error detail.
    let images = json!([img("db1.png", 1, "DB")]);
    let payload = SyncToConfluencePayload {
        entries: vec![entry_json("entry-1", images)],
        deleted_table_indices: vec![],
    };
    let state = Arc::new(Mutex::new(MockState {
        fail_next_uploads: usize::MAX,
        ..Default::default()
    }));

    let (_state, result) = run_sync_with_state(state, payload).await;
    assert_eq!(result.image_count, 0);
    assert_eq!(result.upload_results.len(), 1);
    let failure = &result.upload_results[0];
    assert!(!failure.success);
    assert_eq!(failure.upload_name, "TC001-Login-flow-1.png");
    assert_eq!(failure.image_name, "db1.png");
    assert_eq!(failure.test_case_no, "TC001");
    assert!(
        failure.error.as_deref().unwrap_or("").contains("HTTP 500"),
        "error: {:?}",
        failure.error
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sync_replaces_existing_attachment_on_duplicate_name_error() {
    // Confluence configured to REJECT duplicate filenames: the first POST of
    // TC001-Login-flow-2.png answers "same file name as an existing
    // attachment". The client must DELETE the existing attachment and retry
    // the upload so the new content always wins.
    let images = json!([
        img("db1.png", 1, "DB"),
        img("db2.png", 2, "DB"),
    ]);
    let payload = SyncToConfluencePayload {
        entries: vec![entry_json("entry-1", images)],
        deleted_table_indices: vec![],
    };
    let state = Arc::new(Mutex::new(MockState {
        duplicate_name_error_for: Some("TC001-Login-flow-2.png".to_string()),
        ..Default::default()
    }));

    let (state, result) = run_sync_with_state(state, payload).await;
    let st = state.lock().await;
    assert_eq!(result.image_count, 2, "duplicate-name upload must succeed after delete+retry");
    assert_eq!(st.uploads.len(), 2);
    assert_eq!(st.final_content.matches("<ac:image").count(), 2);
    assert!(st.final_content.contains("TC001-Login-flow-2.png"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reparse_returns_all_images_per_expand_after_sync() {
    // Full roundtrip: sync (uploads + page write) → re-parse the SAME page
    // (what the UI shows right after sync). Every image must come back with
    // its expand group intact.
    let images = json!([
        img("db1.png", 1, "DB"),
        img("db2.png", 2, "DB"),
        img("db3.png", 3, "DB"),
        img("excel1.png", 4, "Excel"),
        img("excel2.png", 5, "Excel"),
        img("api1.png", 6, "API"),
        img("api2.png", 7, "API"),
    ]);
    let payload = SyncToConfluencePayload {
        entries: vec![entry_json("entry-1", images)],
        deleted_table_indices: vec![],
    };

    let (state, _result) = run_sync(payload).await;

    // Now serve attachments for download + re-parse
    let st = state.lock().await;
    let final_content = st.final_content.clone();
    let uploaded_names: Vec<String> = st.uploads.clone();
    drop(st);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let names = Arc::new(uploaded_names);
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { return; };
            let names = names.clone();
            let final_content = final_content.clone();
            tokio::spawn(async move {
                let mut buf: Vec<u8> = Vec::new();
                let mut chunk = [0u8; 65536];
                let (request_line, body_start, content_length) = loop {
                    let n = socket.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 { return; }
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(parsed) = parse_request(&buf) { break parsed; }
                };
                while buf.len() < body_start + content_length {
                    let n = socket.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 { break; }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let mut parts = request_line.split_whitespace();
                let verb = parts.next().unwrap_or("").to_string();
                let path = parts.next().unwrap_or("").to_string();
                let (status, ctype, response) = if verb == "GET"
                    && path.contains("/rest/api/content/")
                    && path.contains("expand=body")
                {
                    (200u16, "application/json".to_string(), json!({
                        "title": "Mock Page",
                        "version": { "number": 2 },
                        "body": { "storage": { "value": final_content } },
                        "_links": { "base": "http://confluence.test" }
                    }).to_string())
                } else if verb == "GET" && path.contains("/child/attachment") {
                    let results: Vec<Value> = names
                        .iter()
                        .map(|n| json!({ "title": n, "_links": { "download": format!("/download/{}", n) } }))
                        .collect();
                    (200, "application/json".to_string(), json!({ "results": results }).to_string())
                } else if verb == "GET" && path.contains("/download/") {
                    // 1x1 png bytes
                    let png: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        png.len()
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                    let _ = socket.write_all(&png).await;
                    let _ = socket.flush().await;
                    return;
                } else {
                    (404, "application/json".to_string(), json!({}).to_string())
                };
                let resp = format!(
                    "HTTP/1.1 {status} OK\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                    response.len()
                );
                let _ = socket.write_all(resp.as_bytes()).await;
            });
        }
    });

    let config = make_config(addr);
    let service = ConfluenceService::new();
    let options = ParseConfluenceEntriesOptions {
        debug: false,
        include_images: true,
        include_jira_server_id: false,
        update_from_confluence: false,
    };
    let parsed: ParseConfluenceEntriesResult = service
        .parse_confluence_entries(None, &config, "123", &options)
        .await
        .expect("parse must succeed");

    assert_eq!(parsed.entries.len(), 1);
    let entry = &parsed.entries[0];
    assert_eq!(
        entry.images.len(),
        7,
        "re-parse must return all 7 images, got {}: {:?}",
        entry.images.len(),
        entry.images.iter().map(|i| (&i.name, &i.expand_group)).collect::<Vec<_>>()
    );
    let groups: Vec<String> = entry
        .screen_capture_expand_groups
        .iter()
        .map(|g| g.to_string())
        .collect();
    assert_eq!(groups, vec!["DB", "DB", "DB", "Excel", "Excel", "API", "API"]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sync_updates_table_with_view_format_expand_cells() {
    // The existing page's Screen Capture cell uses view-format expand divs
    // (legacy Electron-generated markup): <div class="expand-container"> with
    // <ol><li><ac:image> children — one image per expand.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state2 = Arc::new(Mutex::new(MockState::default()));
    let page_content = r#"<table class="wrapped confluenceTable"><tbody>
<tr><th class="confluenceTh">No. Test Case</th><td class="confluenceTd"><p>TC001</p></td></tr>
<tr><th class="confluenceTh">Function</th><td class="confluenceTd"><p>Auth</p></td></tr>
<tr><th class="confluenceTh">Scenario</th><td class="confluenceTd"><p>Login flow</p></td></tr>
<tr><th class="confluenceTh">Kategori</th><td class="confluenceTd"><p>Happy</p></td></tr>
<tr><th class="confluenceTh">Input Data</th><td class="confluenceTd"><p>user</p></td></tr>
<tr><th class="confluenceTh">Steps</th><td class="confluenceTd"><ol><li>Login</li></ol></td></tr>
<tr><th class="confluenceTh">Expected Result</th><td class="confluenceTd"><p>Dashboard</p></td></tr>
<tr><th class="confluenceTh">Result</th><td class="confluenceTd"><p>PASS</p></td></tr>
<tr><th class="confluenceTh">Screen Capture</th><td class="confluenceTd"><div class="expand-container"><div class="expand-control"><span class="expand-control-text conf-macro-render">DB</span></div>
<div class="expand-content"><ol><li><ac:image ac:width="450"><ri:attachment ri:filename="old_eid_db1.png" /></ac:image></li></ol></div></div>
<div class="expand-container"><div class="expand-control"><span class="expand-control-text conf-macro-render">Excel</span></div>
<div class="expand-content"><ol><li><ac:image ac:width="450"><ri:attachment ri:filename="old_eid_excel1.png" /></ac:image></li></ol></div></div>
</td></tr>
</tbody></table>"#;
    let st_clone = state2.clone();
    let pg_state = Arc::new(Mutex::new(page_content.to_string()));
    let pg_clone = pg_state.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { return; };
            let st = st_clone.clone();
            let pg = pg_clone.clone();
            tokio::spawn(async move {
                let mut buf: Vec<u8> = Vec::new();
                let mut chunk = [0u8; 65536];
                let (request_line, body_start, content_length) = loop {
                    let n = socket.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 { return; }
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(parsed) = parse_request(&buf) { break parsed; }
                };
                while buf.len() < body_start + content_length {
                    let n = socket.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 { break; }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let body = String::from_utf8_lossy(&buf[body_start..]).to_string();
                let mut parts = request_line.split_whitespace();
                let verb = parts.next().unwrap_or("").to_string();
                let path = parts.next().unwrap_or("").to_string();
                let (status, response) = if verb == "GET" && path.contains("/rest/api/content/") && path.contains("expand=body") {
                    (200, json!({
                        "title": "Mock Page",
                        "version": { "number": 2 },
                        "body": { "storage": { "value": pg.lock().await.clone() } },
                        "_links": { "base": "http://confluence.test" }
                    }).to_string())
                } else if verb == "GET" && path.contains("/child/attachment") {
                    (200, json!({ "results": [
                        { "title": "old_eid_db1.png", "id": "old-1" },
                        { "title": "old_eid_excel1.png", "id": "old-2" }
                    ] }).to_string())
                } else if verb == "POST" && path.contains("/child/attachment") {
                    let mut filename = String::new();
                    if let Some(pos) = body.find("filename=\"") {
                        let rest = &body[pos + 10..];
                        if let Some(end) = rest.find('"') { filename = rest[..end].to_string(); }
                    }
                    st.lock().await.uploads.push(filename.clone());
                    (200, json!({ "results": [ { "title": filename } ] }).to_string())
                } else if verb == "DELETE" && path.contains("/child/attachment/") {
                    (204, json!({}).to_string())
                } else if verb == "PUT" && path.contains("/rest/api/content/") {
                    let payload: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                    let content = payload["body"]["storage"]["value"].as_str().unwrap_or("").to_string();
                    st.lock().await.final_content = content;
                    (200, json!({ "id": "123", "_links": { "base": "http://confluence.test" } }).to_string())
                } else {
                    (404, json!({ "message": "not found" }).to_string())
                };
                let resp = format!(
                    "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                    response.len()
                );
                let _ = socket.write_all(resp.as_bytes()).await;
            });
        }
    });

    let config = make_config(addr);
    let service = ConfluenceService::new();

    let images = json!([
        img("old_eid_db1.png", 1, "DB"),
        img("db2.png", 2, "DB"),
        img("old_eid_excel1.png", 3, "Excel"),
        img("excel2.png", 4, "Excel"),
    ]);
    let mut entry = entry_json("new-eid", images);
    entry["sourceTableIndex"] = json!(0);
    let payload = SyncToConfluencePayload {
        entries: vec![entry],
        deleted_table_indices: vec![],
    };

    let _result = service
        .sync_to_confluence(None, &config, "123", &payload)
        .await
        .expect("sync must succeed");

    let st = state2.lock().await;
    assert_eq!(
        st.final_content.matches("<ac:image").count(),
        4,
        "all 4 images must be referenced after patching view-format cell. content: {}",
        st.final_content
    );
    assert_eq!(st.final_content.matches("ac:name=\"expand\"").count(), 2);
    assert!(st.final_content.contains("TC001-Login-flow-2.png"), "db2 must be in content");
    assert!(st.final_content.contains("TC001-Login-flow-4.png"), "excel2 must be in content");
}
