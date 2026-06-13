import type { DefectRecord, DuplicateCandidate, SearchFilters } from "@shared/types";
import { Normalizer } from "./normalizer";

export class DuplicateHeuristicEngine {
  private norm = new Normalizer();

  score(defect: DefectRecord, candidates: DefectRecord[], filters: SearchFilters): DuplicateCandidate[] {
    const queryTerms = this.norm.sanitizeForSearch(filters.query).split(/\s+/).filter(Boolean);

    return candidates
      .map(candidate => {
        let score = 0;
        const reasons: string[] = [];

        const titleSimilarity = this.titleSimilarity(
          defect.normalizedTitle,
          candidate.normalizedTitle
        );
        if (titleSimilarity > 0) {
          score += titleSimilarity * 40;
          if (titleSimilarity > 0.7) {
            reasons.push("Judul sangat mirip");
          } else {
            reasons.push("Judul memiliki kemiripan");
          }
        }

        const componentMatch = this.componentMatch(defect.component, candidate.component);
        if (componentMatch) {
          score += 15;
          reasons.push(`Component sama: ${defect.component}`);
        }

        const versionMatch = this.versionMatch(defect.version, candidate.version);
        if (versionMatch) {
          score += 10;
          reasons.push(`Version sama: ${defect.version}`);
        }

        const projectMatch = defect.sourceProjectKey === candidate.sourceProjectKey;
        if (projectMatch) {
          score += 5;
          reasons.push(`Project sama: ${defect.sourceProjectKey}`);
        }

        const severityMatch = defect.severity === candidate.severity;
        if (severityMatch) {
          score += 5;
          reasons.push(`Severity sama: ${defect.severity}`);
        }

        const descriptionOverlap = this.descriptionOverlap(defect, candidate);
        score += descriptionOverlap * 20;
        if (descriptionOverlap > 0.3) {
          reasons.push("Deskripsi memiliki kesamaan");
        }

        return {
          defect: candidate,
          score: Math.min(Math.round(score), 100),
          reasons,
        };
      })
      .filter(c => c.score > 10)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  private titleSimilarity(titleA: string, titleB: string): number {
    if (!titleA || !titleB) return 0;
    if (titleA === titleB) return 1;

    const wordsA = titleA.split(/\s+/).filter(Boolean);
    const wordsB = titleB.split(/\s+/).filter(Boolean);

    if (wordsA.length === 0 || wordsB.length === 0) return 0;

    const setA = new Set(wordsA);
    const setB = new Set(wordsB);

    let overlap = 0;
    for (const w of setA) {
      if (setB.has(w)) overlap++;
    }

    const jaccard = overlap / Math.max(setA.size + setB.size - overlap, 1);

    const longer = wordsA.length >= wordsB.length ? wordsA : wordsB;
    const shorter = wordsA.length >= wordsB.length ? wordsB : wordsA;

    let subsequenceScore = 0;
    for (let i = 0; i <= longer.length - shorter.length; i++) {
      let match = 0;
      for (let j = 0; j < shorter.length; j++) {
        if (longer[i + j] === shorter[j]) match++;
      }
      subsequenceScore = Math.max(subsequenceScore, match / shorter.length);
    }

    return Math.max(jaccard, subsequenceScore * 0.8);
  }

  private componentMatch(compA: string, compB: string): boolean {
    if (!compA || !compB) return false;
    return compA.toLowerCase() === compB.toLowerCase();
  }

  private versionMatch(verA: string, verB: string): boolean {
    if (!verA || !verB) return false;
    return verA.toLowerCase() === verB.toLowerCase();
  }

  private descriptionOverlap(a: DefectRecord, b: DefectRecord): number {
    const descA = this.norm.normalize(a.normalizedDescription);
    const descB = this.norm.normalize(b.normalizedDescription);
    if (!descA || !descB) return 0;

    const wordsA = new Set(descA.split(/\s+/).filter(w => w.length > 3));
    const wordsB = descB.split(/\s+/).filter(w => w.length > 3);

    if (wordsA.size === 0 || wordsB.length === 0) return 0;

    let match = 0;
    for (const w of wordsB) {
      if (wordsA.has(w)) match++;
    }

    return match / Math.max(wordsA.size + wordsB.length - match, 1);
  }
}
