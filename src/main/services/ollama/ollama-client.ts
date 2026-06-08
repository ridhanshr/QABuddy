import axios from "axios";
import type { ChatHistoryMessage, OllamaConfig } from "@shared/types";
import { normalizeUrl } from "../utils";
import { logger } from "../logger";

interface OllamaGenerateResponse {
  response: string;
}

interface OllamaChatResponse {
  message: { role: string; content: string };
}

export class OllamaClient {
  private readonly config: OllamaConfig;

  constructor(config: OllamaConfig) {
    this.config = {
      ...config,
      endpoint: normalizeUrl(config.endpoint.replace(/\/api\/generate$/, "")),
    };
  }

  getEndpoint(): string {
    return this.config.endpoint;
  }

  getModel(): string {
    return this.config.model;
  }

  async validateConnection(): Promise<string> {
    const response = await axios.get(`${this.config.endpoint}/api/tags`, {
      timeout: 5000,
    });
    const modelCount = Array.isArray(response.data?.models) ? response.data.models.length : 0;
    return `Ollama ready, ${modelCount} model(s) available`;
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.endpoint}/api/tags`, {
        timeout: 5000,
      });
      if (Array.isArray(response.data?.models)) {
        return response.data.models.map((m: any) => m.name);
      }
      return [];
    } catch (err) {
      logger.warn("Ollama", "Failed to fetch models:", err);
      return [];
    }
  }

  async generateText(
    prompt: string,
    format?: "json",
    temperature?: number,
    modelOverride?: string
  ): Promise<string | null> {
    try {
      const body: Record<string, any> = {
        model: modelOverride || this.config.model,
        prompt,
        stream: false,
      };
      if (format) body.format = format;
      if (temperature !== undefined) body.temperature = temperature;

      const response = await axios.post<OllamaGenerateResponse>(
        `${this.config.endpoint}/api/generate`,
        body,
        { timeout: 600000 }
      );
      return response.data.response?.trim() || null;
    } catch (error: any) {
      logger.error("Ollama", "generateText error:", { message: error.message, response: error.response?.data });
      if (error.code === "ECONNRESET") {
        logger.error("Ollama", "Connection was reset. The model might be out of memory.");
      }
      return null;
    }
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    history: ChatHistoryMessage[] = [],
    temperature?: number,
    modelOverride?: string
  ): Promise<string | null> {
    try {
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: systemPrompt },
      ];

      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }

      messages.push({ role: "user", content: userMessage });

      const body: Record<string, any> = {
        model: modelOverride || this.config.model,
        messages,
        stream: false,
      };
      if (temperature !== undefined) body.temperature = temperature;

      const response = await axios.post<OllamaChatResponse>(
        `${this.config.endpoint}/api/chat`,
        body,
        { timeout: 600000 }
      );
      return response.data.message?.content?.trim() || null;
    } catch (error: any) {
      if (error.code === "ECONNRESET") {
        logger.error("Ollama", "Connection was reset during chat.");
      }
      return null;
    }
  }
}
