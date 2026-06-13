import type { DefectRecord, DuplicateCandidate, SearchFilters } from "@shared/types";
import { Normalizer } from "./normalizer";

interface InvertedIndex {
  [term: string]: Set<string>;
}

export class SearchIndex {
  private index: InvertedIndex = {};
  private defects: Map<string, DefectRecord> = new Map();
  private norm = new Normalizer();

  isEmpty(): boolean {
    return this.defects.size === 0;
  }

  build(defects: DefectRecord[]): void {
    this.index = {};
    this.defects.clear();
    for (const d of defects) {
      this.defects.set(d.id, d);
      const terms = this.tokenize(d.searchText);
      for (const term of terms) {
        if (!this.index[term]) this.index[term] = new Set();
        this.index[term].add(d.id);
      }
    }
  }

  add(defect: DefectRecord): void {
    this.defects.set(defect.id, defect);
    const terms = this.tokenize(defect.searchText);
    for (const term of terms) {
      if (!this.index[term]) this.index[term] = new Set();
      this.index[term].add(defect.id);
    }
  }

  update(defect: DefectRecord): void {
    this.remove(defect.id);
    this.add(defect);
  }

  remove(id: string): void {
    const defect = this.defects.get(id);
    if (!defect) return;
    this.defects.delete(id);
    const terms = this.tokenize(defect.searchText);
    for (const term of terms) {
      this.index[term]?.delete(id);
      if (this.index[term]?.size === 0) delete this.index[term];
    }
  }

  search(filters: SearchFilters): { candidates: DuplicateCandidate[]; defects: DefectRecord[] } {
    const queryTerms = this.tokenize(this.norm.sanitizeForSearch(filters.query));
    const hasQuery = queryTerms.length > 0;
    const candidates = new Map<string, { score: number; reasons: string[] }>();

    let candidateIds: Set<string> | null = null;

    if (hasQuery) {
      candidateIds = new Set<string>();
      for (const term of queryTerms) {
        const matched = this.index[term];
        if (matched) {
          for (const id of matched) {
            candidateIds!.add(id);
          }
        }
      }
    }

    if (filters.projectKeys?.length) {
      const projectFilter = new Set(filters.projectKeys);
      const filtered = new Set<string>();
      const source = candidateIds || new Set(this.defects.keys());
      for (const id of source) {
        const d = this.defects.get(id);
        if (d && projectFilter.has(d.sourceProjectKey)) filtered.add(id);
      }
      candidateIds = filtered;
    }

    if (filters.issueTypes?.length) {
      const typeFilter = new Set(filters.issueTypes.map(t => t.toLowerCase()));
      const filtered = new Set<string>();
      const source = candidateIds || new Set(this.defects.keys());
      for (const id of source) {
        const d = this.defects.get(id);
        if (d && typeFilter.has(d.issueType.toLowerCase())) filtered.add(id);
      }
      candidateIds = filtered;
    }

    if (filters.statuses?.length) {
      const statusFilter = new Set(filters.statuses.map(s => s.toLowerCase()));
      const filtered = new Set<string>();
      const source = candidateIds || new Set(this.defects.keys());
      for (const id of source) {
        const d = this.defects.get(id);
        if (d && statusFilter.has(d.status.toLowerCase())) filtered.add(id);
      }
      candidateIds = filtered;
    }

    if (filters.components?.length) {
      const compFilter = new Set(filters.components.map(c => c.toLowerCase()));
      const filtered = new Set<string>();
      const source = candidateIds || new Set(this.defects.keys());
      for (const id of source) {
        const d = this.defects.get(id);
        if (d && compFilter.has(d.component.toLowerCase())) filtered.add(id);
      }
      candidateIds = filtered;
    }

    if (filters.versions?.length) {
      const verFilter = new Set(filters.versions.map(v => v.toLowerCase()));
      const filtered = new Set<string>();
      const source = candidateIds || new Set(this.defects.keys());
      for (const id of source) {
        const d = this.defects.get(id);
        if (d && d.version && verFilter.has(d.version.toLowerCase())) filtered.add(id);
      }
      candidateIds = filtered;
    }

    if (filters.severities?.length) {
      const sevFilter = new Set(filters.severities.map(s => s.toLowerCase()));
      const filtered = new Set<string>();
      const source = candidateIds || new Set(this.defects.keys());
      for (const id of source) {
        const d = this.defects.get(id);
        if (d && sevFilter.has(d.severity.toLowerCase())) filtered.add(id);
      }
      candidateIds = filtered;
    }

    const defectList: DefectRecord[] = [];
    const source = candidateIds || new Set(this.defects.keys());

    for (const id of source) {
      const d = this.defects.get(id);
      if (!d) continue;
      defectList.push(d);

      if (!hasQuery) {
        continue;
      }

      let score = 0;
      const reasons: string[] = [];
      const queryText = this.norm.sanitizeForSearch(filters.query);
      const queryFingerprint = this.tokenize(this.norm.computeFingerprint(filters.query, ""));
      const titleTerms = this.tokenize(d.normalizedTitle);
      const descTerms = this.tokenize(d.normalizedDescription);
      const searchTerms = this.tokenize(d.searchText);
      const fingerprintTerms = this.tokenize(d.similarityFingerprint);

      const titleMatch = queryTerms.filter(t => titleTerms.includes(t)).length;
      const descMatch = queryTerms.filter(t => descTerms.includes(t)).length;
      const searchMatch = queryTerms.filter(t => searchTerms.includes(t)).length;
      const fingerprintMatch = queryFingerprint.filter(t => fingerprintTerms.includes(t)).length;

      if (titleMatch > 0) {
        score += (titleMatch / queryTerms.length) * 45;
        reasons.push(`Judul cocok (${titleMatch}/${queryTerms.length} kata)`);
      }
      if (descMatch > 0) {
        score += (descMatch / queryTerms.length) * 25;
      }
      if (searchMatch > 0) {
        score += (searchMatch / queryTerms.length) * 10;
      }
      if (fingerprintMatch > 0) {
        score += (fingerprintMatch / Math.max(queryFingerprint.length, 1)) * 15;
      }

      if (queryText && d.normalizedTitle) {
        const titleText = this.norm.sanitizeForSearch(d.normalizedTitle);
        if (titleText.includes(queryText) || queryText.includes(titleText)) {
          score += 15;
          reasons.push("Judul mengandung frasa serupa");
        }
      }

      if (queryText && d.similarityFingerprint) {
        const queryFingerprintText = queryFingerprint.join(" ");
        const defectFingerprintText = fingerprintTerms.join(" ");
        if (queryFingerprintText && defectFingerprintText && queryFingerprintText === defectFingerprintText) {
          score += 20;
          reasons.push("Fingerprint identik");
        }
      }

      if (filters.projectKeys?.includes(d.sourceProjectKey)) {
        score += 10;
        reasons.push(`Project sama: ${d.sourceProjectKey}`);
      }

      if (filters.components?.some(c => c.toLowerCase() === d.component.toLowerCase())) {
        score += 10;
        reasons.push(`Component sama: ${d.component}`);
      }

      if (filters.versions?.some(v => v.toLowerCase() === (d.version || "").toLowerCase())) {
        score += 5;
        reasons.push(`Version sama: ${d.version}`);
      }

      candidates.set(id, { score: Math.min(score, 100), reasons });
    }

    const sorted = [...candidates.entries()]
      .filter(([, c]) => c.score > 0)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 20);

    return {
      candidates: sorted.map(([id, c]) => ({
        defect: this.defects.get(id)!,
        score: c.score,
        reasons: c.reasons,
      })),
      defects: defectList,
    };
  }

  private tokenize(text: string): string[] {
    if (!text) return [];
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 1);
  }
}
