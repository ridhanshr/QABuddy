import axios from "axios";
import path from "node:path";
import fs from "node:fs";
import fsProm from "node:fs/promises";
import { app } from "electron";
import type { AppConfig, RagStats, RagIndexProgress } from "@shared/types";
import { createAtlassianClient } from "./http";
import { stripHtml } from "./utils";
import { logger } from "./logger";

// ─── Types ───────────────────────────────────────────────────────────────────

interface VectorChunk {
  id: string;
  source: "confluence" | "jira";
  sourceId: string;       // page ID or issue key
  containerId?: string;   // space key or project key
  sourceTitle: string;
  sourceUrl: string;
  content: string;
  embedding: number[];
  indexedAt: string;
}

interface VectorStore {
  version: number;
  chunks: VectorChunk[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

function chunkText(text: string, maxChunkSize = 800, overlap = 100): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChunkSize) {
    return cleaned.length > 20 ? [cleaned] : [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + maxChunkSize, cleaned.length);

    // Try to break at sentence boundary
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end);
      const lastPeriod = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf(".\n"),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? ")
      );
      if (lastPeriod > maxChunkSize * 0.3) {
        end = start + lastPeriod + 1;
      }
    }

    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }

    if (end >= cleaned.length) {
      break;
    }

    start = end - overlap;
  }
  return chunks;
}

// ─── RAG Service ─────────────────────────────────────────────────────────────

export class RagService {
  private readonly storePath: string;
  private store: VectorStore;
  private progressCallback?: (progress: RagIndexProgress) => void;

  constructor() {
    const dataDir = path.join(app.getPath("userData"), "rag");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.storePath = path.join(dataDir, "vector-store.json");
    this.store = this.loadStore();
  }

  private loadStore(): VectorStore {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, "utf-8");
        return JSON.parse(data);
      }
    } catch {
      logger.warn("RAG", "Failed to load RAG store, creating new one.");
    }
    return { version: 1, chunks: [] };
  }

  private async saveStore(): Promise<void> {
    await fsProm.writeFile(this.storePath, JSON.stringify(this.store), "utf-8");
  }

  onProgress(callback: (progress: RagIndexProgress) => void): void {
    this.progressCallback = callback;
  }

  private emitProgress(progress: RagIndexProgress): void {
    this.progressCallback?.(progress);
  }

  // ─── Embedding ───────────────────────────────────────────────────────────

  private async getEmbedding(text: string, endpoint: string, model: string): Promise<number[]> {
    const response = await axios.post(
      `${endpoint.replace(/\/+$/, "")}/api/embed`,
      { model, input: text },
      { timeout: 60000 }
    );
    // Ollama returns { embeddings: [[...]] } for /api/embed
    if (response.data.embeddings && Array.isArray(response.data.embeddings[0])) {
      return response.data.embeddings[0];
    }
    // Fallback: older endpoint /api/embeddings returns { embedding: [...] }
    if (response.data.embedding) {
      return response.data.embedding;
    }
    throw new Error("Unexpected embedding response format");
  }

  private async getEmbeddingsBatch(
    texts: string[],
    endpoint: string,
    model: string,
    batchSize = 10
  ): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await axios.post(
        `${endpoint.replace(/\/+$/, "")}/api/embed`,
        { model, input: batch },
        { timeout: 120000 }
      );
      if (response.data.embeddings) {
        results.push(...response.data.embeddings);
      } else if (response.data.embedding) {
        results.push(...batch.map(() => response.data.embedding));
      } else {
        throw new Error("Unexpected embedding response format");
      }
    }
    return results;
  }

  // ─── Confluence Indexing ─────────────────────────────────────────────────

  async indexConfluence(config: AppConfig, spaceKeyOrPageId: string): Promise<{ indexed: number; skipped: number }> {
    const { confluence, ollama } = config;
    if (!confluence.baseUrl || !confluence.token) {
      throw new Error("Confluence belum dikonfigurasi.");
    }
    if (!ollama.endpoint) {
      throw new Error("Ollama belum dikonfigurasi. Diperlukan untuk membuat embedding.");
    }

    const embeddingModel = "nomic-embed-text";
    const client = createAtlassianClient(confluence, "/rest/api");

    // Fetch all pages from the space
    this.emitProgress({ source: "confluence", status: "fetching", message: "Mengambil daftar halaman Confluence...", current: 0, total: 0 });

    const isPageId = /^\d+$/.test(spaceKeyOrPageId);

    let allPages: any[] = [];
    let start = 0;
    const limit = 25;
    let hasMore = true;

    while (hasMore) {
      let response;
      if (isPageId) {
        response = await client.get("/content/search", {
          params: {
            cql: `(id=${spaceKeyOrPageId} OR ancestor=${spaceKeyOrPageId}) AND type=page`,
            expand: "body.storage,space",
            start,
            limit,
          },
        });
      } else {
        response = await client.get("/content", {
          params: {
            spaceKey: spaceKeyOrPageId,
            type: "page",
            status: "current",
            expand: "body.storage,space",
            start,
            limit,
          },
        });
      }

      const results = response.data.results || [];
      allPages = allPages.concat(results);
      hasMore = results.length === limit;
      start += limit;

      this.emitProgress({
        source: "confluence",
        status: "fetching",
        message: `Mengambil halaman Confluence... (${allPages.length} ditemukan)`,
        current: allPages.length,
        total: 0,
      });
    }

    // Remove old confluence chunks for this specific space or page
    this.store.chunks = this.store.chunks.filter(
      (c) => !(c.source === "confluence" && c.containerId === spaceKeyOrPageId)
    );

    let indexed = 0;
    let skipped = 0;

    for (let i = 0; i < allPages.length; i++) {
      const page = allPages[i];
      const rawContent = page.body?.storage?.value || "";
      const plainText = stripHtml(rawContent);

      if (plainText.length < 50) {
        skipped++;
        continue;
      }

      const chunks = chunkText(plainText);
      const pageUrl = `${confluence.baseUrl.replace(/\/+$/, "")}/pages/viewpage.action?pageId=${page.id}`;

      this.emitProgress({
        source: "confluence",
        status: "embedding",
        message: `Memproses: ${page.title} (${i + 1}/${allPages.length})`,
        current: i + 1,
        total: allPages.length,
      });

      const embeddings = await this.getEmbeddingsBatch(chunks, ollama.endpoint, embeddingModel);

      for (let j = 0; j < chunks.length; j++) {
        this.store.chunks.push({
          id: `conf-${page.id}-${j}`,
          source: "confluence",
          sourceId: page.id,
          containerId: spaceKeyOrPageId,
          sourceTitle: page.title,
          sourceUrl: pageUrl,
          content: chunks[j],
          embedding: embeddings[j],
          indexedAt: new Date().toISOString(),
        });
      }

      indexed++;
      if (indexed % 10 === 0) {
        await this.saveStore();
      }
    }

    await this.saveStore();
    this.emitProgress({
      source: "confluence",
      status: "done",
      message: `Selesai! ${indexed} halaman diindeks, ${skipped} dilewati.`,
      current: allPages.length,
      total: allPages.length,
    });

    return { indexed, skipped };
  }

  // ─── Jira Indexing ───────────────────────────────────────────────────────

  async indexJira(config: AppConfig, projectKey: string): Promise<{ indexed: number; skipped: number }> {
    const { jira, ollama } = config;
    if (!jira.baseUrl || !jira.token) {
      throw new Error("Jira belum dikonfigurasi.");
    }
    if (!ollama.endpoint) {
      throw new Error("Ollama belum dikonfigurasi. Diperlukan untuk membuat embedding.");
    }

    const embeddingModel = "nomic-embed-text";
    const client = createAtlassianClient(jira, "/rest/api/2");

    this.emitProgress({ source: "jira", status: "fetching", message: "Mengambil issues dari Jira...", current: 0, total: 0 });

    // Fetch issues (tasks, bugs, stories etc.)
    let allIssues: any[] = [];
    let startAt = 0;
    const maxResults = 50;
    let hasMore = true;

    const jql = `project = "${projectKey}" ORDER BY updated DESC`;

    while (hasMore) {
      const response = await client.get("/search", {
        params: {
          jql,
          startAt,
          maxResults,
          fields: "summary,description,status,priority,assignee,issuetype,comment,labels",
        },
      });

      const issues = response.data.issues || [];
      allIssues = allIssues.concat(issues);
      hasMore = issues.length === maxResults && allIssues.length < response.data.total;
      startAt += maxResults;

      this.emitProgress({
        source: "jira",
        status: "fetching",
        message: `Mengambil issues Jira... (${allIssues.length}/${response.data.total})`,
        current: allIssues.length,
        total: response.data.total,
      });
    }

    // Remove old jira chunks for this specific project
    this.store.chunks = this.store.chunks.filter(
      (c) => !(c.source === "jira" && c.containerId === projectKey)
    );

    let indexed = 0;
    let skipped = 0;

    for (let i = 0; i < allIssues.length; i++) {
      const issue = allIssues[i];
      const fields = issue.fields;

      // Build full text from issue fields
      const parts: string[] = [
        `[${issue.key}] ${fields.summary}`,
        `Type: ${fields.issuetype?.name || "-"}`,
        `Status: ${fields.status?.name || "-"}`,
        `Priority: ${fields.priority?.name || "-"}`,
        `Labels: ${(fields.labels || []).join(", ") || "-"}`,
      ];

      if (fields.description) {
        parts.push(`Description: ${fields.description}`);
      }

      // Add comments
      const comments = fields.comment?.comments || [];
      for (const comment of comments.slice(-5)) {
        parts.push(`Comment by ${comment.author?.displayName || "Unknown"}: ${comment.body}`);
      }

      const fullText = parts.join("\n");

      if (fullText.length < 50) {
        skipped++;
        continue;
      }

      const chunks = chunkText(fullText);
      const issueUrl = `${jira.baseUrl.replace(/\/+$/, "")}/browse/${issue.key}`;

      this.emitProgress({
        source: "jira",
        status: "embedding",
        message: `Memproses: ${issue.key} - ${fields.summary} (${i + 1}/${allIssues.length})`,
        current: i + 1,
        total: allIssues.length,
      });

      const embeddings = await this.getEmbeddingsBatch(chunks, ollama.endpoint, embeddingModel);

      for (let j = 0; j < chunks.length; j++) {
        this.store.chunks.push({
          id: `jira-${issue.key}-${j}`,
          source: "jira",
          sourceId: issue.key,
          containerId: projectKey,
          sourceTitle: `${issue.key}: ${fields.summary}`,
          sourceUrl: issueUrl,
          content: chunks[j],
          embedding: embeddings[j],
          indexedAt: new Date().toISOString(),
        });
      }

      indexed++;
      if (indexed % 10 === 0) {
        await this.saveStore();
      }
    }

    await this.saveStore();
    this.emitProgress({
      source: "jira",
      status: "done",
      message: `Selesai! ${indexed} issues diindeks, ${skipped} dilewati.`,
      current: allIssues.length,
      total: allIssues.length,
    });

    return { indexed, skipped };
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  getChunksBySourceId(source: "confluence" | "jira", sourceId: string): { content: string; sourceTitle: string; sourceUrl: string; score: number }[] {
    return this.store.chunks
      .filter((c) => c.source === source && c.sourceId === sourceId)
      .map((c) => ({ content: c.content, sourceTitle: c.sourceTitle, sourceUrl: c.sourceUrl, score: 1 }));
  }

  async search(
    query: string,
    ollamaEndpoint: string,
    topK = 5
  ): Promise<{ content: string; sourceTitle: string; sourceUrl: string; score: number }[]> {
    if (this.store.chunks.length === 0) {
      return [];
    }

    const embeddingModel = "nomic-embed-text";
    const queryEmbedding = await this.getEmbedding(query, ollamaEndpoint, embeddingModel);

    const scored = this.store.chunks.map((chunk) => ({
      content: chunk.content,
      sourceTitle: chunk.sourceTitle,
      sourceUrl: chunk.sourceUrl,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Return top results with score > 0.3
    return scored.filter((r) => r.score > 0.3).slice(0, topK);
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats(): RagStats {
    const confluenceChunks = this.store.chunks.filter((c) => c.source === "confluence");
    const jiraChunks = this.store.chunks.filter((c) => c.source === "jira");

    const confluencePages = new Set(confluenceChunks.map((c) => c.sourceId));
    const jiraIssues = new Set(jiraChunks.map((c) => c.sourceId));

    const latestConfluence = confluenceChunks.reduce(
      (latest, c) => (c.indexedAt > latest ? c.indexedAt : latest),
      ""
    );
    const latestJira = jiraChunks.reduce(
      (latest, c) => (c.indexedAt > latest ? c.indexedAt : latest),
      ""
    );

    return {
      totalChunks: this.store.chunks.length,
      confluencePages: confluencePages.size,
      confluenceChunks: confluenceChunks.length,
      jiraIssues: jiraIssues.size,
      jiraChunks: jiraChunks.length,
      lastConfluenceSync: latestConfluence || null,
      lastJiraSync: latestJira || null,
    };
  }

  // ─── Clear ───────────────────────────────────────────────────────────────

  async clearIndex(source?: "confluence" | "jira"): Promise<void> {
    if (source) {
      this.store.chunks = this.store.chunks.filter((c) => c.source !== source);
    } else {
      this.store.chunks = [];
    }
    await this.saveStore();
  }

  // ─── OCR Text Indexing ──────────────────────────────────────────────

  async indexOcrText(
    ocrText: string,
    metadata: {
      sourcePageId: string;
      sourceTitle: string;
      sourceUrl: string;
      attachmentName: string;
      containerId?: string;
    },
    endpoint: string,
    embeddingModel = "nomic-embed-text",
  ): Promise<void> {
    if (ocrText.length < 20) return;

    const chunks = chunkText(ocrText);
    if (chunks.length === 0) return;

    const embeddings = await this.getEmbeddingsBatch(chunks, endpoint, embeddingModel);

    for (let j = 0; j < chunks.length; j++) {
      this.store.chunks.push({
        id: `ocr-${metadata.sourcePageId}-${metadata.attachmentName}-${j}`,
        source: "confluence",
        sourceId: metadata.sourcePageId,
        containerId: metadata.containerId,
        sourceTitle: `${metadata.sourceTitle} (OCR: ${metadata.attachmentName})`,
        sourceUrl: metadata.sourceUrl,
        content: `[OCR dari ${metadata.attachmentName}]\n${chunks[j]}`,
        embedding: embeddings[j],
        indexedAt: new Date().toISOString(),
      });
    }

    await this.saveStore();
  }
}
