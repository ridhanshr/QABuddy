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
  getOcrGroundedExtractionPrompt,
  getRagEnrichedExtractionPrompt,
  getRagAnswerPrompt,
  getJiraFirstChatPrompt,
  getKnowledgeBaseChatPrompt,
  getHybridChatPrompt,
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
            const fixed = this.fixJqlQuery(parsed[key].trim(), projectKey, prompt);
            logger.info("JQL Gen", `Extracted from '${key}' key:`, fixed);
            return fixed;
          }
        }

        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string" && /(?:project|status|issuetype|issue_type|priority|assignee)\s*[=~]/i.test(value)) {
            const fixed = this.fixJqlQuery(value.trim(), projectKey, prompt);
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

        const clauses: string[] = [];
        let projectFromPayload = "";
        for (const [key, value] of Object.entries(parsed)) {
          if (key === "jql" || key === "query" || key === "reasoning" || key === "explanation" || key === "response") continue;
          if (key === "project" && typeof value === "string") {
            projectFromPayload = value.trim();
            continue;
          }
          const jqlField = fieldMap[key.toLowerCase()] || fieldMap[key];
          if (jqlField && typeof value === "string" && value.trim().length > 0) {
            if (jqlField === "summary") {
              clauses.push(`summary ~ "${value.trim()}"`);
            } else {
              clauses.push(`${jqlField} = "${value.trim()}"`);
            }
          }
        }

        // Determine correct project key
        let targetProject = projectKey;
        const projectMatch = prompt.match(/project\s*['"]?([A-Z0-9]+)['"]?/i);
        if (projectMatch) {
          targetProject = projectMatch[1].toUpperCase();
        } else if (projectFromPayload) {
          targetProject = projectFromPayload.toUpperCase();
        }
        clauses.unshift(`project = "${targetProject}"`);

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
        const fixed = this.fixJqlQuery(potentialJql, projectKey, prompt);
        logger.info("JQL Gen", "Extracted raw JQL from text:", fixed);
        return fixed;
      }
    }

    const deterministicJql = this.buildJqlFromUserInput(prompt, projectKey, context);
    logger.warn("JQL Gen", "AI failed, built JQL deterministically:", deterministicJql);
    return deterministicJql;
  }

  private buildJqlFromUserInput(prompt: string, projectKey: string, context?: ProjectContext): string {
    let targetProject = projectKey;
    const projectMatch = prompt.match(/project\s*['"]?([A-Z0-9]+)['"]?/i);
    if (projectMatch) {
      targetProject = projectMatch[1].toUpperCase();
    }
    const clauses: string[] = [`project = "${targetProject}"`];

    // Smarter status matching
    let statusFound = "";
    if (context?.statuses && context.statuses.length > 0) {
      for (const st of context.statuses) {
        const escaped = st.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const reg = new RegExp(`\\b${escaped}\\b`, 'i');
        if (reg.test(prompt)) {
          statusFound = st;
          break;
        }
      }
    }
    if (!statusFound) {
      const commonStatuses = ["Open", "In Progress", "Resolved", "Closed", "Reopened", "Done", "To Do", "Ready for QA"];
      for (const st of commonStatuses) {
        const reg = new RegExp(`\\b${st}\\b`, 'i');
        if (reg.test(prompt)) {
          statusFound = st;
          break;
        }
      }
    }
    if (statusFound) {
      clauses.push(`status = "${statusFound}"`);
    } else {
      const statusMatch = prompt.match(/status\s*[=:]?\s*(?:=\s*)?["']?([A-Za-z][A-Za-z ]+?)["']?\s*(?:,|$|pada|dengan|dan|yang|untuk|di|type|tipe|priority|assign)/i);
      if (statusMatch) {
        clauses.push(`status = "${statusMatch[1].trim()}"`);
      }
    }

    const typeMatch = prompt.match(/(?:type|tipe|issuetype)\s*[=:]?\s*(?:=\s*)?["']?([A-Za-z][A-Za-z ]*?)["']?\s*(?:,|$|dengan|dan|yang|untuk|di|status|priority|assign|pada)/i);
    if (typeMatch) {
      clauses.push(`issuetype = "${typeMatch[1].trim()}"`);
    }

    // Smarter priority matching
    let priorityFound = "";
    const priorityMap: Record<string, string> = {
      tinggi: "High", high: "High",
      sedang: "Medium", medium: "Medium",
      rendah: "Low", low: "Low",
      kritis: "Critical", critical: "Critical",
      tertinggi: "Highest", highest: "Highest",
      terendah: "Lowest", lowest: "Lowest"
    };
    for (const [key, val] of Object.entries(priorityMap)) {
      const reg = new RegExp(`\\b${key}\\b`, 'i');
      if (reg.test(prompt)) {
        priorityFound = val;
        break;
      }
    }
    if (priorityFound) {
      clauses.push(`priority = "${priorityFound}"`);
    } else {
      const priorityMatch = prompt.match(/(?:priority|prioritas)\s*[=:]?\s*(?:=\s*)?["']?([A-Za-z]+)["']?/i);
      if (priorityMatch) {
        const val = priorityMatch[1].trim();
        clauses.push(`priority = "${priorityMap[val.toLowerCase()] || val}"`);
      }
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

  private fixJqlQuery(jql: string, correctProjectKey: string, userPrompt?: string): string {
    let fixed = jql;
    fixed = fixed.replace(/\bissue_type\b/gi, "issuetype");

    let projectKeyToUse = correctProjectKey;
    if (userPrompt) {
      const projectMatch = userPrompt.match(/project\s*['"]?([A-Z0-9]+)['"]?/i);
      if (projectMatch) {
        projectKeyToUse = projectMatch[1].toUpperCase();
      }
    }

    const existingProjectMatch = fixed.match(/project\s*=\s*['"]([^'"]+)['"]/i);
    if (existingProjectMatch) {
      const existingProject = existingProjectMatch[1].toUpperCase();
      if (existingProject !== correctProjectKey.toUpperCase() && userPrompt) {
        const reg = new RegExp(`\\b${existingProject}\\b`, 'i');
        if (reg.test(userPrompt)) {
          projectKeyToUse = existingProject;
        }
      }
      fixed = fixed.replace(
        /project\s*=\s*['"]([^'"]+)['"]/i,
        `project = "${projectKeyToUse}"`
      );
    } else {
      fixed = `project = "${projectKeyToUse}" AND ${fixed}`;
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
    ragContext?: string,
    ocrText?: string
  ): Promise<ExtractedTestCase[] | null> {
    const prompt = getTestCaseExtractionPrompt(content, depth, ragContext, ocrText);
    const response = await this.generateJson<{ testCases: ExtractedTestCase[] }>(
      prompt,
      0.7,
      this.modelFor("extraction")
    );
    return response?.testCases ?? null;
  }

  async extractTestCasesOcrGrounded(
    htmlContent: string,
    ocrText: string,
    depth: ExtractionDepth,
    ragContext?: string,
  ): Promise<ExtractedTestCase[] | null> {
    const prompt = getOcrGroundedExtractionPrompt(htmlContent, ocrText, depth, ragContext);
    const response = await this.generateJson<{ testCases: ExtractedTestCase[] }>(
      prompt,
      0.7,
      this.modelFor("extraction")
    );
    return response?.testCases ?? null;
  }

  async extractTestCasesRagEnriched(
    htmlContent: string,
    ocrText: string | undefined,
    ragContext: string,
    depth: ExtractionDepth,
  ): Promise<ExtractedTestCase[] | null> {
    const prompt = getRagEnrichedExtractionPrompt(htmlContent, ocrText, ragContext, depth);
    const response = await this.generateJson<{ testCases: ExtractedTestCase[] }>(
      prompt,
      0.7,
      this.modelFor("extraction")
    );
    return response?.testCases ?? null;
  }

  async chatJiraFirst(
    jiraContext: string,
    userQuery: string,
    projectKey?: string,
    history?: ChatHistoryMessage[],
  ): Promise<string | null> {
    const systemPrompt = getJiraFirstChatPrompt(jiraContext, userQuery, projectKey);
    return this.client.chat(systemPrompt, userQuery, history || [], 0.3, this.modelFor("chat"));
  }

  async chatKnowledgeBase(
    ragContext: string,
    userQuery: string,
    history?: ChatHistoryMessage[],
  ): Promise<string | null> {
    const systemPrompt = getKnowledgeBaseChatPrompt(ragContext, userQuery);
    return this.client.chat(systemPrompt, userQuery, history || [], 0.3, this.modelFor("chat"));
  }

  async chatHybrid(
    jiraContext: string,
    ragContext: string,
    userQuery: string,
    history?: ChatHistoryMessage[],
  ): Promise<string | null> {
    const systemPrompt = getHybridChatPrompt(jiraContext, ragContext, userQuery);
    return this.client.chat(systemPrompt, userQuery, history || [], 0.3, this.modelFor("chat"));
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
