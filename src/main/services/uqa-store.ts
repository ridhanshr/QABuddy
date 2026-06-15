import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { UqaIssue } from "@shared/types";

const STORE_FILE = path.join(app.getPath("userData"), "uqa-issues.json");

export class UqaStore {
  private cache: UqaIssue[] | null = null;

  load(): UqaIssue[] {
    if (this.cache) return this.cache;
    try {
      if (!fs.existsSync(STORE_FILE)) return [];
      this.cache = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as UqaIssue[];
      return this.cache;
    } catch {
      return [];
    }
  }

  save(issues: UqaIssue[]): void {
    this.cache = issues;
    const tmp = STORE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(issues, null, 2), "utf-8");
    fs.renameSync(tmp, STORE_FILE);
  }

  clearCache(): void {
    this.cache = null;
  }
}
