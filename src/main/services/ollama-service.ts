import type {
  BugFormDraft,
  BugPreview,
  ChatHistoryMessage,
  ExtractedTestCase,
  ExtractionDepth,
  OllamaConfig,
} from "@shared/types";
import { extractJsonBlock, fallbackBugPreview } from "./utils";
import { logger } from "./logger";
import { OllamaClient } from "./ollama/ollama-client";
import {
  ProjectContext,
  getBugPolishPrompt,
  getJqlPrompt,
  getConfluenceSummaryPrompt,
  getDashboardInsightPrompt,
  getTestCaseExtractionPrompt,
  getRagAnswerPrompt,
} from "./ollama/prompts";

export class OllamaService {
  private readonly config: OllamaConfig;
  private readonly client: OllamaClient;

  constructor(config: OllamaConfig) {
    this.config = config;
    this.client = new OllamaClient(config);
  }

  private modelFor(type: "jql" | "chat" | "extraction" | "insight" | "default"): string {
    switch (type) {
      case "jql": return this.config.jqlModel || this.config.model;
      case "chat": return this.config.chatModel || this.config.model;
      case "extraction": return this.config.extractionModel || this.config.model;
      case "insight": return this.config.insightModel || this.config.model;
      default: return this.config.model;
    }
  }

  async validateConnection(): Promise<string> {
    return this.client.validateConnection();
  }

  async getAvailableModels(): Promise<string[]> {
    return this.client.getAvailableModels();
  }

  async polishBugReport(draft: BugFormDraft): Promise<BugPreview> {
    const fallback = fallbackBugPreview(draft);
    const prompt = getBugPolishPrompt(draft);

    const response = await this.generateJson<BugPreview>(prompt, undefined, this.modelFor("default"));
    return response ?? fallback;
  }

  async generateJql(
    prompt: string,
    projectKey: string,
    context?: ProjectContext,
    history?: ChatHistoryMessage[]
  ): Promise<string> {
    const fullPrompt = getJqlPrompt(prompt, projectKey, context, history);

    let rawResponse = await this.client.generateText(fullPrompt, "json", 0.1, this.modelFor("jql"));
    if (!rawResponse) {
      logger.warn("JQL Gen", "JSON mode request failed, retrying with standard text...");
      rawResponse = await this.client.generateText(fullPrompt, undefined, 0.1, this.modelFor("jql"));
    }

    logger.info("JQL Gen", "Raw response:", rawResponse);

    if (rawResponse) {
      const parsed = extractJsonBlock<Record<string, any>>(rawResponse);
      if (parsed) {
        const jqlKeys = ["jql", "query", "search_query", "jql_query", "filter", "result", "search", "response"];
        for (const key of jqlKeys) {
          if (typeof parsed[key] === "string" && /(?:project|status|issuetype|issue_type|priority|assignee)\s*[=~]/i.test(parsed[key])) {
            const fixed = this.fixJqlQuery(parsed[key].trim(), projectKey);
            logger.info("JQL Gen", `Extracted from '${key}' key:`, fixed);
            return fixed;
          }
        }

        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string" && /(?:project|status|issuetype|issue_type|priority|assignee)\s*[=~]/i.test(value)) {
            const fixed = this.fixJqlQuery(value.trim(), projectKey);
            logger.info("JQL Gen", `Found JQL-like string in '${key}' key:`, fixed);
            return fixed;
          }
        }

        const fieldMap: Record<string, string> = {
          issue_type: "issuetype", issuetype: "issuetype", type: "issuetype",
          issueType: "issuetype", issue_Type: "issuetype",
          status: "status",
          priority: "priority",
          assignee: "assignee",
          reporter: "reporter",
          labels: "labels",
          component: "component",
          resolution: "resolution",
          summary: "summary",
        };

        const clauses: string[] = [`project = "${projectKey}"`];
        for (const [key, value] of Object.entries(parsed)) {
          if (key === "jql" || key === "query" || key === "project" || key === "reasoning" || key === "explanation" || key === "response") continue;
          const jqlField = fieldMap[key.toLowerCase()] || fieldMap[key];
          if (jqlField && typeof value === "string" && value.trim().length > 0) {
            if (jqlField === "summary") {
              clauses.push(`summary ~ "${value.trim()}"`);
            } else {
              clauses.push(`${jqlField} = "${value.trim()}"`);
            }
          }
        }

        if (clauses.length > 1) {
          const builtJql = clauses.join(" AND ") + " ORDER BY updated DESC";
          logger.info("JQL Gen", "Built JQL from field-value pairs:", builtJql);
          return builtJql;
        }
      }

      const codeBlockMatch = rawResponse.match(/```(?:jql|sql|project|)?\s*([\s\S]*?)```/i);
      let potentialJql = codeBlockMatch ? codeBlockMatch[1] : rawResponse;
      potentialJql = potentialJql.trim();
      potentialJql = potentialJql.replace(/^(jql|query|search|result|answer):\s*/i, "");

      if (/(?:project|status|issuetype|issue_type|priority|assignee)\s*[=~]/i.test(potentialJql)) {
        const fixed = this.fixJqlQuery(potentialJql, projectKey);
        logger.info("JQL Gen", "Extracted raw JQL from text:", fixed);
        return fixed;
      }
    }

    const deterministicJql = this.buildJqlFromUserInput(prompt, projectKey);
    logger.warn("JQL Gen", "AI failed, built JQL deterministically:", deterministicJql);
    return deterministicJql;
  }

  private buildJqlFromUserInput(prompt: string, projectKey: string): string {
    const clauses: string[] = [`project = "${projectKey}"`];

    const statusMatch = prompt.match(/status\s*[=:]?\s*(?:=\s*)?["']?([A-Za-z][A-Za-z ]+?)["']?\s*(?:,|$|pada|dengan|dan|yang|untuk|di|type|tipe|priority|assign)/i);
    if (statusMatch) {
      clauses.push(`status = "${statusMatch[1].trim()}"`);
    }

    const typeMatch = prompt.match(/(?:type|tipe|issuetype)\s*[=:]?\s*(?:=\s*)?["']?([A-Za-z][A-Za-z ]*?)["']?\s*(?:,|$|dengan|dan|yang|untuk|di|status|priority|assign|pada)/i);
    if (typeMatch) {
      clauses.push(`issuetype = "${typeMatch[1].trim()}"`);
    }

    const priorityMatch = prompt.match(/(?:priority|prioritas)\s*[=:]?\s*(?:=\s*)?["']?([A-Za-z]+)["']?/i);
    if (priorityMatch) {
      const priorityMap: Record<string, string> = {
        tinggi: "High", sedang: "Medium", rendah: "Low", tertinggi: "Highest", terendah: "Lowest",
      };
      const val = priorityMatch[1].trim();
      clauses.push(`priority = "${priorityMap[val.toLowerCase()] || val}"`);
    }

    const assigneeMatch = prompt.match(/(?:assign(?:ee)?|ditugaskan)\s*(?:ke|=|:)?\s*(?:=\s*)?["']?([A-Za-z][A-Za-z._ ]+?)["']?\s*(?:,|$|dengan|dan|yang|untuk|di|status|type|priority|pada)/i);
    if (assigneeMatch) {
      clauses.push(`assignee = "${assigneeMatch[1].trim()}"`);
    }

    const labelMatch = prompt.match(/(?:label|labels)\s*[=:]?\s*(?:=\s*)?["']?([A-Za-z][A-Za-z_-]+)["']?/i);
    if (labelMatch) {
      clauses.push(`labels = "${labelMatch[1].trim()}"`);
    }

    return clauses.join(" AND ") + " ORDER BY updated DESC";
  }

  private fixJqlQuery(jql: string, correctProjectKey: string): string {
    let fixed = jql;
    fixed = fixed.replace(/\bissue_type\b/gi, "issuetype");

    fixed = fixed.replace(
      /project\s*=\s*['"]([^'"]+)['"]/i,
      `project = "${correctProjectKey}"`
    );

    if (!/project\s*=/i.test(fixed)) {
      fixed = `project = "${correctProjectKey}" AND ${fixed}`;
    }

    if (!/ORDER\s+BY/i.test(fixed)) {
      fixed += " ORDER BY updated DESC";
    }

    return fixed;
  }

  /**
   * Public chat method — delegates to OllamaClient.chat().
   * Used by qa-service for hybrid (RAG + Jira) and Jira-only chat answers.
   */
  async chat(
    systemPrompt: string,
    userMessage: string,
    history: ChatHistoryMessage[] = [],
    temperature?: number
  ): Promise<string | null> {
    return this.client.chat(systemPrompt, userMessage, history, temperature, this.modelFor("chat"));
  }

  async summarizeConfluence(query: string, content: string): Promise<string> {
    const prompt = getConfluenceSummaryPrompt(query, content);
    const response = await this.client.generateText(prompt, undefined, undefined, this.modelFor("chat"));
    return response || "Ringkasan tidak tersedia dari Ollama.";
  }

  async buildDashboardInsight(serializedData: string): Promise<string> {
    const prompt = getDashboardInsightPrompt(serializedData);
    const response = await this.client.generateText(prompt, undefined, 0.4, this.modelFor("insight"));
    return response || "Belum ada insight AI. Periksa koneksi Ollama untuk analisis yang lebih akurat.";
  }

  async extractTestCases(
    content: string,
    depth: ExtractionDepth,
    ragContext?: string
  ): Promise<ExtractedTestCase[] | null> {
    const prompt = getTestCaseExtractionPrompt(content, depth, ragContext);
    const response = await this.generateJson<{ testCases: ExtractedTestCase[] }>(
      prompt,
      0.7,
      this.modelFor("extraction")
    );
    return response?.testCases ?? null;
  }

  async answerWithContext(
    query: string,
    contextChunks: { content: string; sourceTitle: string; sourceUrl: string }[],
    history?: ChatHistoryMessage[]
  ): Promise<string> {
    const contextText = contextChunks
      .map((c, i) => `--- Document ${i + 1}: ${c.sourceTitle} (${c.sourceUrl}) ---\n${c.content}`)
      .join("\n\n");

    const systemPrompt = getRagAnswerPrompt(query, contextText);

    if (history && history.length > 0) {
      const response = await this.client.chat(systemPrompt, query, history, 0.5, this.modelFor("chat"));
      return response || "Maaf, tidak dapat menghasilkan jawaban dari knowledge base.";
    }

    const response = await this.client.generateText(
      systemPrompt,
      undefined,
      0.5,
      this.modelFor("chat")
    );

    return response || "Maaf, tidak dapat menghasilkan jawaban dari knowledge base.";
  }

  private async generateJson<T>(prompt: string, temperature?: number, modelOverride?: string): Promise<T | null> {
    let response = await this.client.generateText(prompt, "json", temperature, modelOverride);
    
    if (!response) {
      logger.warn("Ollama", "JSON format request failed, falling back to standard text...");
      response = await this.client.generateText(prompt, undefined, temperature, modelOverride);
    }

    if (!response) {
      return null;
    }
    return extractJsonBlock<T>(response);
  }
}
export type { ProjectContext };
