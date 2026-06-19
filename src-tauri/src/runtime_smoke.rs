#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use chrono::Utc;
    use uuid::Uuid;

    use crate::models::app_config::AppConfig;
    use crate::models::misc::ParseConfluenceEntriesOptions;
    use crate::services::confluence::ConfluenceService;
    use crate::services::jira::JiraService;
    use crate::services::ollama::OllamaService;
    use crate::services::qa::QaService;
    use crate::services::rag::{RagService, VectorChunk};
    use crate::services::text_utils::{chunk_content, strip_html};

    fn load_runtime_config() -> AppConfig {
        let appdata = std::env::var("APPDATA").expect("APPDATA is not set");
        let path = PathBuf::from(appdata)
            .join("qa-buddy-desktop")
            .join("qa-buddy-config.json");
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("failed to read runtime config at {}: {e}", path.display()));
        serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("failed to parse runtime config at {}: {e}", path.display()))
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn live_runtime_smoke() {
        let config = load_runtime_config();
        let mut blockers: Vec<String> = Vec::new();

        assert!(
            !config.jira.base_url.trim().is_empty(),
            "jira base url missing from runtime config"
        );
        assert!(
            !config.confluence.base_url.trim().is_empty(),
            "confluence base url missing from runtime config"
        );
        assert!(
            !config.ollama.endpoint.trim().is_empty(),
            "ollama endpoint missing from runtime config"
        );

        let qa = QaService::new();
        let status = qa.test_connections(&config).await;
        println!(
            "connection status: jira={} confluence={} ollama={}",
            status.jira.ok, status.confluence.ok, status.ollama.ok
        );
        if !status.jira.ok {
            blockers.push(format!("jira connectivity failed: {}", status.jira.message));
        }
        if !status.confluence.ok {
            blockers.push(format!(
                "confluence connectivity failed: {}",
                status.confluence.message
            ));
        }
        assert!(status.ollama.ok, "ollama connectivity failed: {}", status.ollama.message);

        let jira = JiraService::new();
        match jira.get_projects(&config.jira).await {
            Ok(projects) => {
                println!("jira projects returned: {}", projects.len());
                if projects.is_empty() {
                    blockers.push("jira returned no projects".to_string());
                }
                if !projects
                    .iter()
                    .any(|project| project.key.eq_ignore_ascii_case(&config.jira.project_key))
                {
                    blockers.push(format!(
                        "jira project {} not found in returned project list",
                        config.jira.project_key
                    ));
                }
            }
            Err(e) => blockers.push(format!("jira project query failed: {e}")),
        }

        let jql = format!(
            "project = \"{}\" ORDER BY updated DESC",
            config.jira.project_key
        );
        match jira.find_issues_by_jql(&config.jira, &jql, 5).await {
            Ok(issues) => {
                println!("jira issues returned: {}", issues.len());
                if issues.is_empty() {
                    blockers.push("jira returned no issues for smoke query".to_string());
                }
            }
            Err(e) => blockers.push(format!("jira issue query failed: {e}")),
        }

        let confluence = ConfluenceService::new();
        let mut preview: Option<(String, String, u32)> = None;
        let mut chunk_text: Option<String> = None;
        match confluence
            .parse_confluence_entries(
                &config.confluence,
                &config.confluence.target_page_id,
                &ParseConfluenceEntriesOptions { debug: false },
            )
            .await
        {
            Ok(parse) => {
                println!(
                    "confluence parse: page={} title={} entries={}",
                    parse.page_id,
                    parse.page_title,
                    parse.entries.len()
                );
                if !parse.content_loaded {
                    blockers.push("confluence page content was not loaded".to_string());
                }
                if parse.page_title.trim().is_empty() {
                    blockers.push("confluence page title is empty".to_string());
                }
            }
            Err(e) => blockers.push(format!("confluence parse failed: {e}")),
        }

        match confluence
            .get_page_preview(&config.confluence, &config.confluence.target_page_id)
            .await
        {
            Ok(page) => {
                let plain = strip_html(&page.1);
                let chunks = chunk_content(&plain, 800);
                let text = chunks
                    .first()
                    .cloned()
                    .unwrap_or_else(|| plain.chars().take(800).collect());
                if text.trim().is_empty() {
                    blockers.push("confluence body produced an empty chunk".to_string());
                } else {
                    chunk_text = Some(text);
                    preview = Some(page);
                }
            }
            Err(e) => blockers.push(format!("confluence preview failed: {e}")),
        }

        let ollama = OllamaService::new();
        if let (Some(page), Some(chunk_text)) = (preview, chunk_text) {
            let embed_model = config
                .ollama
                .defect_embedding_model
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(config.ollama.model.as_str());
            let client = ollama.client_for(&config.ollama.endpoint, embed_model).await;
            match client.embed(&chunk_text, Some(embed_model)).await {
                Ok(embedding) => {
                    println!("ollama embedding dims: {}", embedding.len());
                    if embedding.is_empty() {
                        blockers.push("ollama returned an empty embedding".to_string());
                    } else {
                        let rag_store = RagService::open(
                            std::env::temp_dir()
                                .join(format!("qa-buddy-rag-smoke-{}", Uuid::new_v4())),
                        );
                        if let Err(e) = rag_store.upsert_chunk(VectorChunk {
                            id: format!("smoke-{}", Uuid::new_v4()),
                            source: "confluence".into(),
                            source_id: config.confluence.target_page_id.clone(),
                            container_id: Some(config.confluence.space_key.clone()),
                            source_title: page.0.clone(),
                            source_url: format!(
                                "{}/pages/viewpage.action?pageId={}",
                                config.confluence.base_url.trim_end_matches('/'),
                                config.confluence.target_page_id
                            ),
                            content: chunk_text.clone(),
                            embedding: embedding.clone(),
                            indexed_at: Utc::now().to_rfc3339(),
                        }) {
                            blockers.push(format!("rag upsert failed: {e}"));
                        } else {
                            let results = rag_store.search(&embedding, 1, Some("confluence"));
                            println!("rag search results: {}", results.len());
                            if results.is_empty() {
                                blockers.push(
                                    "rag search did not return the indexed chunk".to_string(),
                                );
                            } else if results[0].score <= 0.0 {
                                blockers.push("rag search score was not positive".to_string());
                            }
                        }
                    }
                }
                Err(e) => blockers.push(format!("ollama embedding failed: {e}")),
            }
        }

        if !blockers.is_empty() {
            println!("smoke blockers:");
            for blocker in blockers {
                println!(" - {blocker}");
            }
        }
    }
}
