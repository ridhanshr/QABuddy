import type { DefectRecord, DuplicateRelation, DefectRepositoryStats } from "@shared/types";

export class DefectReportingService {
  computeStats(defects: DefectRecord[], relations: DuplicateRelation[]): DefectRepositoryStats {
    const defectsPerProject = new Map<string, number>();
    const duplicatesPerProject = new Map<string, number>();
    const components = new Map<string, number>();
    const issueTypes = new Map<string, number>();

    for (const d of defects) {
      defectsPerProject.set(d.sourceProjectKey, (defectsPerProject.get(d.sourceProjectKey) || 0) + 1);
      if (d.component) {
        const comps = d.component.split(", ").filter(Boolean);
        for (const c of comps) {
          components.set(c, (components.get(c) || 0) + 1);
        }
      }
      issueTypes.set(d.issueType, (issueTypes.get(d.issueType) || 0) + 1);
    }

    const duplicateDefectIds = new Set<string>();
    for (const r of relations) {
      duplicateDefectIds.add(r.duplicateDefectId);
      duplicateDefectIds.add(r.primaryDefectId);
    }

    for (const d of defects) {
      if (duplicateDefectIds.has(d.id)) {
        duplicatesPerProject.set(d.sourceProjectKey, (duplicatesPerProject.get(d.sourceProjectKey) || 0) + 1);
      }
    }

    return {
      totalDefects: defects.length,
      totalDuplicates: relations.length,
      defectsPerProject: [...defectsPerProject.entries()]
        .map(([projectKey, count]) => ({ projectKey, count }))
        .sort((a, b) => b.count - a.count),
      duplicatesPerProject: [...duplicatesPerProject.entries()]
        .map(([projectKey, count]) => ({ projectKey, count }))
        .sort((a, b) => b.count - a.count),
      topComponents: [...components.entries()]
        .map(([component, count]) => ({ component, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topIssueTypes: [...issueTypes.entries()]
        .map(([issueType, count]) => ({ issueType, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
