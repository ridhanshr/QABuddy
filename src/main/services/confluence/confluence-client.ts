import FormData from "form-data";
import type { ConfluenceConfig } from "@shared/types";
import { createAtlassianClient } from "../http";
import { logger } from "../logger";

function extractBase64Data(base64Data: string): { buffer: Buffer; mimeType: string } | null {
  if (!base64Data || typeof base64Data !== "string") {
    logger.error("ConfluenceClient", "Invalid base64 data: data is empty or not a string");
    return null;
  }

  let raw: string;
  let mimeType = "application/octet-stream";

  const commaIndex = base64Data.indexOf(",");
  if (commaIndex !== -1 && commaIndex < base64Data.length - 1) {
    const header = base64Data.slice(0, commaIndex);
    const mimeMatch = header.match(/^data:([^;]+)/i);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
    }
    raw = base64Data.slice(commaIndex + 1);
  } else {
    raw = base64Data;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    logger.error("ConfluenceClient", "Invalid base64 data: empty content");
    return null;
  }

  const buffer = Buffer.from(trimmed, "base64");
  if (buffer.length === 0) {
    logger.error("ConfluenceClient", "Invalid base64 data: decoded buffer is empty");
    return null;
  }

  return { buffer, mimeType };
}

export class ConfluenceClient {
  private readonly config: ConfluenceConfig;

  constructor(config: ConfluenceConfig) {
    this.config = config;
  }

  client(pathPrefix = "/rest/api") {
    return createAtlassianClient(this.config, pathPrefix);
  }

  async validateConnection(): Promise<string> {
    const response = await this.client().get("/user/current");
    const name = response.data?.displayName || response.data?.username || "connected";
    return `Connected as ${name}`;
  }

  async getPage(pageId: string) {
    const response = await this.client().get(
      `/content/${pageId}?expand=body.storage,body.view,version,space`,
      { timeout: 120000 }
    );
    return response.data;
  }

  async getPageByTitle(spaceKey: string, title: string) {
    const response = await this.client().get(
      `/content?spaceKey=${spaceKey}&title=${encodeURIComponent(title)}&expand=body.storage,body.view,version,space`,
      { timeout: 120000 }
    );
    if (response.data?.results && response.data.results.length > 0) {
      return response.data.results[0];
    }
    throw new Error(`Page not found with title "${title}" in space "${spaceKey}".`);
  }

  private async findAttachmentIdByName(pageId: string, filename: string): Promise<string | null> {
    try {
      const attachments = await this.getAttachments(pageId);
      const match = attachments.find(
        (att: any) => att.title?.toLowerCase() === filename.toLowerCase()
      );
      return match?.id || null;
    } catch {
      return null;
    }
  }

  private async updateExistingAttachment(
    pageId: string,
    attachmentId: string,
    filename: string,
    buffer: Buffer,
    mimeType: string
  ) {
    const formData = new FormData();
    formData.append("file", buffer, { filename, contentType: mimeType });
    formData.append("comment", "Updated via QA Buddy");

    const response = await this.client().post(
      `/content/${pageId}/child/attachment/${attachmentId}/data`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          "X-Atlassian-Token": "nocheck"
        },
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    return response.data.results?.[0] || response.data;
  }

  async uploadAttachment(pageId: string, filename: string, base64Data: string) {
    const validated = extractBase64Data(base64Data);
    if (!validated) {
      throw new Error(`Invalid or empty base64 data for attachment "${filename}"`);
    }

    const { buffer, mimeType } = validated;
    const formData = new FormData();
    formData.append("file", buffer, { filename, contentType: mimeType });
    formData.append("comment", "Uploaded via QA Buddy");

    try {
      const response = await this.client().post(
        `/content/${pageId}/child/attachment`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            "X-Atlassian-Token": "nocheck"
          },
          timeout: 120000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );
      return response.data.results[0];
    } catch (err: any) {
      if (err?.response?.status === 409 || err?.response?.status === 400) {
        logger.info("ConfluenceClient", `Attachment "${filename}" already exists (HTTP ${err.response.status}), updating...`);
        const existingId = this.extractAttachmentIdFromError(err, filename) || await this.findAttachmentIdByName(pageId, filename);
        if (existingId) {
          logger.info("ConfluenceClient", `Updating attachment "${filename}" (ID: ${existingId})`);
          return await this.updateExistingAttachment(pageId, existingId, filename, buffer, mimeType);
        }
      }
      throw err;
    }
  }

  private extractAttachmentIdFromError(err: any, filename: string): string | null {
    try {
      const data = err?.response?.data;
      if (!data) return null;
      const body = typeof data === "string" ? JSON.parse(data) : data;
      return body?.data?.attachment?.id || null;
    } catch {
      return null;
    }
  }

  async updatePage(pageId: string, title: string, content: string, version: number) {
    const response = await this.client().put(`/content/${pageId}`, {
      type: "page",
      title,
      version: { number: version + 1 },
      body: {
        storage: {
          value: content,
          representation: "storage"
        }
      }
    });
    return response.data;
  }

  async getAttachments(pageId: string) {
    const response = await this.client().get(`/content/${pageId}/child/attachment?limit=100`);
    return response.data?.results || [];
  }

  async downloadAttachment(downloadUrl: string): Promise<Buffer> {
    const response = await this.client("").get(downloadUrl, { responseType: "arraybuffer" });
    return Buffer.from(response.data);
  }

  async detectJiraServerIdFromAppLinks(): Promise<string | undefined> {
    const candidates = [
      "/rest/applinks/3.0/applinks",
      "/rest/applinks/latest/listApplicationlinks",
      "/rest/applinks/1.0/listApplicationlinks",
    ];

    for (const path of candidates) {
      try {
        const response = await this.client("").get(path, { headers: { Accept: "application/json, application/xml, text/xml" } });
        const serverId = this.extractJiraServerIdFromAppLinksResponse(response.data);
        if (serverId) {
          return serverId;
        }
      } catch (error) {
        const status = (error as any)?.response?.status;
        if (status === 401 || status === 403) {
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Confluence", `Unable to resolve Jira server ID from ${path}: ${message}`);
      }
    }

    return undefined;
  }

  extractJiraServerIdFromAppLinksResponse(payload: unknown): string | undefined {
    const decodeHtmlEntities = (value: string): string => {
      return value
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    };

    const fromJson = (value: any): string | undefined => {
      if (!value) return undefined;
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = fromJson(item);
          if (found) return found;
        }
        return undefined;
      }

      if (typeof value === "object") {
        const type = String(
          value.typeId || value.type || value.application?.typeId || value.application?.type || ""
        ).toLowerCase();
        const id = value.id || value.application?.id || value.serverId || value.applicationId;
        if (type.includes("jira") && typeof id === "string" && id.trim()) {
          return id.trim();
        }

        for (const nested of Object.values(value)) {
          const found = fromJson(nested);
          if (found) return found;
        }
      }

      return undefined;
    };

    if (typeof payload === "string") {
      const decoded = decodeHtmlEntities(payload);
      const applicationBlocks = decoded.match(/<application>[\s\S]*?<\/application>/gi) || [];
      for (const block of applicationBlocks) {
        if (!/<typeId>\s*jira\s*<\/typeId>/i.test(block)) {
          continue;
        }
        const idMatch = block.match(/<id>\s*([^<]+?)\s*<\/id>/i);
        if (idMatch?.[1]?.trim()) {
          return idMatch[1].trim();
        }
      }
      return undefined;
    }

    return fromJson(payload as any);
  }
}
