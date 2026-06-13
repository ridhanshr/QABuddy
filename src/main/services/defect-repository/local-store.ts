import crypto from "node:crypto";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  JiraProjectSource,
  DefectRecord,
  DuplicateRelation,
  SyncState,
} from "@shared/types";

interface StoreData {
  sources: JiraProjectSource[];
  defects: DefectRecord[];
  duplicateRelations: DuplicateRelation[];
  syncStates: SyncState[];
}

export class LocalStore {
  private readonly dirPath: string;
  private readonly filePath: string;
  private readonly tmpPath: string;
  private cache: StoreData | null = null;
  private repairInFlight: Promise<void> | null = null;

  constructor() {
    this.dirPath = path.join(app.getPath("userData"), "defect-repository");
    this.filePath = path.join(this.dirPath, "data.json");
    this.tmpPath = this.filePath + ".tmp";
  }

  private initData(): StoreData {
    return { sources: [], defects: [], duplicateRelations: [], syncStates: [] };
  }

  private normalizeSource(source: JiraProjectSource): JiraProjectSource {
    return {
      ...source,
      projectKey: this.normalizeProjectKey(source.projectKey),
      projectName: source.projectName.trim(),
      autoSyncEnabled: source.autoSyncEnabled ?? false,
      autoSyncDays: Array.isArray(source.autoSyncDays) && source.autoSyncDays.length > 0 ? [...new Set(source.autoSyncDays)] : [1, 2, 3, 4, 5],
      autoSyncTime: source.autoSyncTime || "09:00",
      issueTypes: Array.isArray(source.issueTypes) && source.issueTypes.length > 0 ? source.issueTypes.map(t => t.trim()).filter(Boolean) : ["Bug", "Task", "Defect"],
      lastAutoSyncAt: source.lastAutoSyncAt ?? null,
    };
  }

  private normalizeProjectKey(projectKey: string): string {
    return projectKey.trim().toUpperCase();
  }

  private defectIdentity(sourceProjectKey: string, sourceIssueKey: string): string {
    return `${this.normalizeProjectKey(sourceProjectKey)}::${sourceIssueKey.trim().toUpperCase()}`;
  }

  private compareDates(left?: string, right?: string): number {
    const leftTime = left ? new Date(left).getTime() : Number.NEGATIVE_INFINITY;
    const rightTime = right ? new Date(right).getTime() : Number.NEGATIVE_INFINITY;
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
    if (Number.isNaN(leftTime)) return -1;
    if (Number.isNaN(rightTime)) return 1;
    if (leftTime === rightTime) return 0;
    return leftTime > rightTime ? 1 : -1;
  }

  private pickLatestByDate<T extends { createdAt?: string; updatedAt?: string }>(current: T, candidate: T): T {
    const updatedCompare = this.compareDates(candidate.updatedAt, current.updatedAt);
    if (updatedCompare > 0) return candidate;
    if (updatedCompare < 0) return current;

    const createdCompare = this.compareDates(candidate.createdAt, current.createdAt);
    if (createdCompare > 0) return candidate;
    if (createdCompare < 0) return current;

    return candidate;
  }

  private async repairLegacyData(): Promise<void> {
    if (!this.cache) return;

    const original = this.cache;
    const normalizedSources = new Map<string, JiraProjectSource>();
    for (const source of original.sources) {
      const normalized = this.normalizeSource(source);
      const existing = normalizedSources.get(normalized.projectKey);
      if (!existing) {
        normalizedSources.set(normalized.projectKey, normalized);
      } else {
        normalizedSources.set(normalized.projectKey, {
          ...existing,
          ...normalized,
          id: existing.id,
          projectKey: existing.projectKey,
        });
      }
    }

    const normalizedSourceKeys = new Set(normalizedSources.keys());
    const normalizedDefects = new Map<string, DefectRecord>();
    for (const defect of original.defects) {
      const normalized: DefectRecord = {
        ...defect,
        sourceProjectKey: this.normalizeProjectKey(defect.sourceProjectKey),
        sourceIssueKey: defect.sourceIssueKey.trim().toUpperCase(),
      };
      if (!normalizedSourceKeys.has(normalized.sourceProjectKey)) continue;

      const key = this.defectIdentity(normalized.sourceProjectKey, normalized.sourceIssueKey);
      const existing = normalizedDefects.get(key);
      if (!existing) {
        normalizedDefects.set(key, normalized);
      } else {
        normalizedDefects.set(key, this.pickLatestByDate(existing, normalized));
      }
    }

    const defectIds = new Set([...normalizedDefects.values()].map(d => d.id));
    const normalizedRelations = new Map<string, DuplicateRelation>();
    for (const relation of original.duplicateRelations) {
      if (relation.primaryDefectId === relation.duplicateDefectId) continue;
      if (!defectIds.has(relation.primaryDefectId) || !defectIds.has(relation.duplicateDefectId)) continue;
      const key = `${relation.primaryDefectId}::${relation.duplicateDefectId}`;
      const existing = normalizedRelations.get(key);
      if (!existing || this.compareDates(relation.createdAt, existing.createdAt) > 0) {
        normalizedRelations.set(key, relation);
      }
    }

    const normalizedSyncStates = new Map<string, SyncState>();
    for (const state of original.syncStates) {
      const projectKey = this.normalizeProjectKey(state.projectKey);
      if (!normalizedSourceKeys.has(projectKey)) continue;
      const normalized: SyncState = {
        ...state,
        projectKey,
      };
      const existing = normalizedSyncStates.get(projectKey);
      if (!existing || this.compareDates(normalized.lastSyncAt, existing.lastSyncAt) > 0) {
        normalizedSyncStates.set(projectKey, normalized);
      }
    }

    const repaired: StoreData = {
      sources: [...normalizedSources.values()],
      defects: [...normalizedDefects.values()],
      duplicateRelations: [...normalizedRelations.values()],
      syncStates: [...normalizedSyncStates.values()],
    };

    const changed =
      repaired.sources.length !== original.sources.length ||
      repaired.defects.length !== original.defects.length ||
      repaired.duplicateRelations.length !== original.duplicateRelations.length ||
      repaired.syncStates.length !== original.syncStates.length ||
      JSON.stringify(repaired) !== JSON.stringify(original);

    if (changed) {
      this.cache = repaired;
      await this.write();
    }
  }

  private async read(): Promise<StoreData> {
    if (this.cache) return this.cache;
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoreData;
      this.cache = {
        sources: parsed.sources || [],
        defects: parsed.defects || [],
        duplicateRelations: parsed.duplicateRelations || [],
        syncStates: parsed.syncStates || [],
      };
    } catch {
      this.cache = this.initData();
    }
    if (!this.repairInFlight) {
      this.repairInFlight = this.repairLegacyData().finally(() => {
        this.repairInFlight = null;
      });
    }
    await this.repairInFlight;
    return this.cache!;
  }

  private async write(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(this.dirPath, { recursive: true });
    const data = JSON.stringify(this.cache, null, 2);
    await fs.writeFile(this.tmpPath, data, "utf8");
    await fs.rename(this.tmpPath, this.filePath);
  }

  async getSources(): Promise<JiraProjectSource[]> {
    const data = await this.read();
    return data.sources;
  }

  async saveSource(source: JiraProjectSource): Promise<JiraProjectSource[]> {
    const data = await this.read();
    const normalized = this.normalizeSource({
      ...source,
      id: source.id || crypto.randomUUID(),
    });

    const keyIdx = data.sources.findIndex(s => this.normalizeProjectKey(s.projectKey) === normalized.projectKey);
    const idIdx = data.sources.findIndex(s => s.id === normalized.id);

    if (keyIdx >= 0) {
      const existing = data.sources[keyIdx];
      data.sources[keyIdx] = {
        ...existing,
        ...normalized,
        id: existing.id,
        projectKey: existing.projectKey ? this.normalizeProjectKey(existing.projectKey) : normalized.projectKey,
      };
      if (idIdx >= 0 && idIdx !== keyIdx) {
        data.sources.splice(idIdx, 1);
      }
    } else if (idIdx >= 0) {
      data.sources[idIdx] = normalized;
    } else {
      data.sources.push(normalized);
    }
    await this.write();
    return data.sources;
  }

  async deleteSource(id: string): Promise<JiraProjectSource[]> {
    const data = await this.read();
    const source = data.sources.find(s => s.id === id);
    if (source) {
      const normalizedKey = this.normalizeProjectKey(source.projectKey);
      const removedDefectIds = new Set(
        data.defects
          .filter(d => this.normalizeProjectKey(d.sourceProjectKey) === normalizedKey)
          .map(d => d.id),
      );
      data.defects = data.defects.filter(d => this.normalizeProjectKey(d.sourceProjectKey) !== normalizedKey);
      data.duplicateRelations = data.duplicateRelations.filter(
        relation =>
          !removedDefectIds.has(relation.primaryDefectId) &&
          !removedDefectIds.has(relation.duplicateDefectId),
      );
      data.syncStates = data.syncStates.filter(s => this.normalizeProjectKey(s.projectKey) !== normalizedKey);
      data.sources = data.sources.filter(s => s.id !== id && this.normalizeProjectKey(s.projectKey) !== normalizedKey);
    } else {
      data.sources = data.sources.filter(s => s.id !== id);
    }
    await this.write();
    return data.sources;
  }

  async getDefects(): Promise<DefectRecord[]> {
    const data = await this.read();
    return data.defects;
  }

  async getDefect(id: string): Promise<DefectRecord | null> {
    const data = await this.read();
    return data.defects.find(d => d.id === id) || null;
  }

  async saveDefects(defects: DefectRecord[]): Promise<void> {
    const data = await this.read();
    for (const defect of defects) {
      const idx = data.defects.findIndex(d => this.defectIdentity(d.sourceProjectKey, d.sourceIssueKey) === this.defectIdentity(defect.sourceProjectKey, defect.sourceIssueKey));
      if (idx >= 0) {
        data.defects[idx] = defect;
      } else {
        data.defects.push(defect);
      }
    }
    await this.write();
  }

  async getDuplicateRelations(): Promise<DuplicateRelation[]> {
    const data = await this.read();
    return data.duplicateRelations;
  }

  async getDuplicateRelationsForDefect(defectId: string): Promise<DuplicateRelation[]> {
    const data = await this.read();
    return data.duplicateRelations.filter(
      r => r.primaryDefectId === defectId || r.duplicateDefectId === defectId
    );
  }

  async saveDuplicateRelation(relation: DuplicateRelation): Promise<DuplicateRelation> {
    const data = await this.read();
    data.duplicateRelations.push(relation);
    await this.write();
    return relation;
  }

  async removeDuplicateRelation(id: string): Promise<void> {
    const data = await this.read();
    data.duplicateRelations = data.duplicateRelations.filter(r => r.id !== id);
    await this.write();
  }

  async getSyncStates(): Promise<SyncState[]> {
    const data = await this.read();
    return data.syncStates;
  }

  async saveSyncState(state: SyncState): Promise<void> {
    const data = await this.read();
    const normalized = {
      ...state,
      projectKey: this.normalizeProjectKey(state.projectKey),
    };
    const idx = data.syncStates.findIndex(s => this.normalizeProjectKey(s.projectKey) === normalized.projectKey);
    if (idx >= 0) {
      data.syncStates[idx] = normalized;
    } else {
      data.syncStates.push(normalized);
    }
    await this.write();
  }

  async clearAll(): Promise<void> {
    this.cache = this.initData();
    await this.write();
  }
}
