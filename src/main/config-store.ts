import { app, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "@shared/types";
import { appConfigSchema, defaultConfig } from "@shared/types";

interface PersistedConfig extends Omit<AppConfig, "jira" | "confluence"> {
  jira: Omit<AppConfig["jira"], "token"> & { token: string };
  confluence: Omit<AppConfig["confluence"], "token"> & { token: string };
}

export class ConfigStore {
  private readonly filePath = path.join(app.getPath("userData"), "qa-buddy-config.json");
  private readonly tmpPath = this.filePath + ".tmp";
  private savePromise: Promise<void> = Promise.resolve();

  async load(): Promise<AppConfig> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedConfig;

      const validation = appConfigSchema.safeParse(parsed);
      if (!validation.success) {
        console.warn("[ConfigStore] Invalid config file, falling back to defaults:", validation.error.issues);
        return structuredClone(defaultConfig);
      }

      const jiraToken = parsed.jira.token ? this.decrypt(parsed.jira.token) : "";
      const confToken = parsed.confluence.token ? this.decrypt(parsed.confluence.token) : "";

      return {
        ...defaultConfig,
        ...parsed,
        jira: { ...defaultConfig.jira, ...parsed.jira, token: jiraToken },
        confluence: { ...defaultConfig.confluence, ...parsed.confluence, token: confToken },
      };
    } catch {
      return structuredClone(defaultConfig);
    }
  }

  async save(config: AppConfig): Promise<AppConfig> {
    const payload: PersistedConfig = {
      ...config,
      jira: { ...config.jira, token: this.encrypt(config.jira.token) },
      confluence: { ...config.confluence, token: this.encrypt(config.confluence.token) },
    };

    this.savePromise = this.savePromise.then(() => this.writeAtomic(payload));
    await this.savePromise;
    return config;
  }

  private async writeAtomic(payload: PersistedConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const data = JSON.stringify(payload, null, 2);
    await fs.writeFile(this.tmpPath, data, "utf8");
    await fs.rename(this.tmpPath, this.filePath);
  }

  private encrypt(value: string): string {
    if (!value) return "";

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "System encryption is not available. Cannot securely store credentials. " +
        "Ensure a keyring/credential manager is set up on this system."
      );
    }

    return safeStorage.encryptString(value).toString("base64");
  }

  private decrypt(value: string): string {
    if (!value) return "";

    try {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          "System encryption is not available. Cannot decrypt stored credentials."
        );
      }
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return "";
    }
  }
}
