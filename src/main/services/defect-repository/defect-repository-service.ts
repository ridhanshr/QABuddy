import crypto from "node:crypto";
import type { AppConfig, DefectRecord, DuplicateCandidate, DuplicateRelation, JiraProjectSource, JiraIssueSource, SearchFilters, DefectRepositoryStats } from "@shared/types";
import { LocalStore } from "./local-store";
import { Normalizer } from "./normalizer";
import { JiraConnector } from "./jira-connector";
import { SearchIndex } from "./search-index";
import { EmbeddingService } from "./embedding-service";
import { DefectReportingService } from "./defect-reporting-service";

export class DefectRepositoryService {
  private store = new LocalStore();
  private norm = new Normalizer();
  private jiraConnector = new JiraConnector();
  private searchIndex = new SearchIndex();
  private embedding: EmbeddingService;
  private reporting = new DefectReportingService();

  constructor(endpoint: string) {
    this.embedding = new EmbeddingService(endpoint);
  }

  setOllamaEndpoint(endpoint: string): void {
    this.embedding.setEndpoint(endpoint);
  }

  setAIEnabled(enabled: boolean): void {
    this.embedding.setEnabled(enabled);
  }

  isAIEnabled(): boolean {
    return this.embedding.isEnabled();
  }

  async getSources(): Promise<JiraProjectSource[]> {
    return this.store.getSources();
  }

  async saveSource(config: AppConfig, source: JiraProjectSource): Promise<JiraProjectSource[]> {
    if (!source.id) {
      source.id = crypto.randomUUID();
    }
    return this.store.saveSource(source);
  }

  async deleteSource(id: string): Promise<JiraProjectSource[]> {
    const sources = await this.store.deleteSource(id);
    await this.reindexAll();
    return sources;
  }

  async syncSource(config: AppConfig, projectKey: string): Promise<{ indexed: number; skipped: number }> {
    const sources = await this.store.getSources();
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    const source = sources.find(s => s.projectKey.trim().toUpperCase() === normalizedProjectKey);
    if (!source) throw new Error(`Source ${projectKey} not found`);

    const syncState = (await this.store.getSyncStates()).find(s => s.projectKey.trim().toUpperCase() === normalizedProjectKey);
    const cursor = syncState?.lastCursor || undefined;

    source.syncStatus = "syncing";
    await this.store.saveSource(source);

    try {
      const { issues, nextCursor } = await this.jiraConnector.fetchIssues(
        config,
        projectKey,
        cursor,
        source.issueTypes || [],
      );
      let indexed = 0;
      let skipped = 0;

      const existingDefects = await this.store.getDefects();
      const existingByIdentity = new Map(
        existingDefects.map(defect => [
          `${defect.sourceProjectKey.trim().toUpperCase()}::${defect.sourceIssueKey.trim().toUpperCase()}`,
          defect,
        ]),
      );

      const defects: DefectRecord[] = [];
      for (const issue of issues) {
        const identity = `${issue.projectKey.trim().toUpperCase()}::${issue.jiraIssueKey.trim().toUpperCase()}`;
        const existing = existingByIdentity.get(identity);
        if (existing && existing.updatedAt === issue.updatedAt) {
          skipped++;
          continue;
        }

        const defect = this.mapToDefectRecord(issue, existing?.id);
        defects.push(defect);
        indexed++;
      }

      if (defects.length > 0) {
        await this.store.saveDefects(defects);
        const allDefects = await this.store.getDefects();
        this.searchIndex.build(allDefects);
      }

      await this.store.saveSyncState({
        id: crypto.randomUUID(),
        projectKey,
        lastCursor: nextCursor || new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: "success",
        errorMessage: "",
      });

      source.lastSyncedAt = new Date().toISOString();
      source.syncStatus = "success";
      await this.store.saveSource(source);

      return { indexed, skipped };
    } catch (err: any) {
      source.syncStatus = "error";
      source.errorMessage = err.message;
      await this.store.saveSource(source);

      await this.store.saveSyncState({
        id: crypto.randomUUID(),
        projectKey,
        lastCursor: cursor || "",
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: "error",
        errorMessage: err.message,
      });

      throw err;
    }
  }

  async recordAutoSync(projectKey: string, autoSyncAt: string): Promise<void> {
    const sources = await this.store.getSources();
    const source = sources.find(s => s.projectKey.trim().toUpperCase() === projectKey.trim().toUpperCase());
    if (!source) return;
    source.lastAutoSyncAt = autoSyncAt;
    await this.store.saveSource(source);
  }

  async searchDefects(
    filters: SearchFilters,
    config: AppConfig,
  ): Promise<{ candidates: DuplicateCandidate[]; defects: DefectRecord[] }> {
    const analysis = await this.analyzeDuplicates(filters, config);

    return analysis;
  }

  async findDuplicateCandidates(
    filters: SearchFilters,
    config: AppConfig,
  ): Promise<DuplicateCandidate[]> {
    const analysis = await this.analyzeDuplicates(filters, config);
    return analysis.candidates;
  }

  private async analyzeDuplicates(
    filters: SearchFilters,
    config: AppConfig,
  ): Promise<{ candidates: DuplicateCandidate[]; defects: DefectRecord[] }> {
    const defects = await this.store.getDefects();

    this.embedding.setEndpoint(config.ollama.endpoint);

    this.searchIndex.build(defects);

    const result = this.searchIndex.search(filters);
    let candidates = result.candidates;

    if (this.embedding.isEnabled() && candidates.length > 0 && filters.query.trim()) {
      try {
        const rerankItems = candidates.map(c => ({
          id: c.defect.id,
          text: `${c.defect.normalizedTitle} ${c.defect.normalizedDescription}`,
        }));
        const scores = await this.embedding.rerank(
          filters.query,
          rerankItems,
          config.ollama.defectEmbeddingModel || config.ollama.model || "embeddinggemma",
        );

        const scoreMap = new Map(scores.map(s => [s.id, s.score]));
        candidates = candidates.map(c => ({
          ...c,
          score: Math.round((c.score + (scoreMap.get(c.defect.id) || 0) * 40) / 1.4),
        }));

        const explanationModel = config.ollama.defectExplanationModel?.trim();
        if (explanationModel && config.ollama.endpoint && config.ollama.endpoint.startsWith("http")) {
          try {
            const llmResponse = await fetch(`${config.ollama.endpoint}/api/generate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: explanationModel,
                prompt: `Explain in 1 short sentence why this defect might be duplicate. Title: "${candidates[0].defect.normalizedTitle}" vs new defect "${filters.query}"`,
                stream: false,
              }),
            });
            if (llmResponse.ok) {
              const llmData = await llmResponse.json();
              if (llmData.response && candidates[0]) {
                candidates[0].reasons.push(llmData.response.trim());
              }
            }
          } catch {}
        }
      } catch {}
    }

    const defectList = [...result.defects].sort((a, b) => {
      const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (Number.isFinite(updatedDiff) && updatedDiff !== 0) return updatedDiff;
      return a.sourceIssueKey.localeCompare(b.sourceIssueKey);
    });

    return {
      candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 10),
      defects: defectList,
    };
  }

  async getDefect(id: string): Promise<DefectRecord | null> {
    return this.store.getDefect(id);
  }

  async getDuplicateRelations(defectId: string): Promise<DuplicateRelation[]> {
    return this.store.getDuplicateRelationsForDefect(defectId);
  }

  async markDuplicate(relation: Omit<DuplicateRelation, "id" | "createdAt">): Promise<DuplicateRelation> {
    const full: DuplicateRelation = {
      ...relation,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    return this.store.saveDuplicateRelation(full);
  }

  async removeDuplicateLink(id: string): Promise<void> {
    return this.store.removeDuplicateRelation(id);
  }

  async getStats(): Promise<DefectRepositoryStats> {
    const defects = await this.store.getDefects();
    const relations = await this.store.getDuplicateRelations();
    return this.reporting.computeStats(defects, relations);
  }

  async reindexAll(): Promise<void> {
    const defects = await this.store.getDefects();
    this.searchIndex.build(defects);
  }

  private mapToDefectRecord(issue: JiraIssueSource, existingId?: string): DefectRecord {
    const searchText = this.norm.extractSearchText(issue.summary, issue.description, issue.stepsToReproduce);

    return {
      id: existingId || crypto.randomUUID(),
      sourceIssueKey: issue.jiraIssueKey,
      sourceProjectKey: issue.projectKey,
      issueType: issue.issueType,
      normalizedTitle: this.norm.normalize(issue.summary),
      normalizedDescription: this.norm.normalize(`${issue.description} ${issue.stepsToReproduce} ${issue.expectedResult} ${issue.actualResult}`),
      searchText,
      status: issue.status,
      component: issue.component,
      version: issue.version,
      severity: issue.severity,
      priority: issue.priority,
      similarityFingerprint: this.norm.computeFingerprint(issue.summary, issue.description),
      embedding: [],
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
  }
}
