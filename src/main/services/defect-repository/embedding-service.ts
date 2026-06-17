export class EmbeddingService {
  private enabled = true;
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
  }

  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
  }

  async getEmbedding(text: string, model = "embeddinggemma"): Promise<number[]> {
    if (!this.enabled || !this.endpoint || !this.endpoint.startsWith("http")) return [];

    try {
      const response = await fetch(`${this.endpoint}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
      });

      if (!response.ok) {
        try {
          const fallback = await fetch(`${this.endpoint}/api/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "all-minilm", prompt: text }),
          });
          if (!fallback.ok) return [];
          const fallbackData = await fallback.json();
          return fallbackData.embedding || [];
        } catch {
          return [];
        }
      }

      const data = await response.json();
      return data.embedding || [];
    } catch {
      return [];
    }
  }

  async getEmbeddings(texts: string[], model = "embeddinggemma"): Promise<number[][]> {
    return Promise.all(texts.map(t => this.getEmbedding(t, model)));
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (!a?.length || !b?.length || a.length !== b.length) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  async rerank(query: string, candidates: { id: string; text: string }[], model = "embeddinggemma"): Promise<{ id: string; score: number }[]> {
    if (!this.enabled || candidates.length === 0) return candidates.map(c => ({ id: c.id, score: 0 }));

    const queryEmb = await this.getEmbedding(query, model);
    if (queryEmb.length === 0) return candidates.map(c => ({ id: c.id, score: 0 }));

    const texts = candidates.map(c => c.text);
    const embeddings = await this.getEmbeddings(texts, model);

    return candidates.map((c, i) => ({
      id: c.id,
      score: embeddings[i]?.length ? this.cosineSimilarity(queryEmb, embeddings[i]) : 0,
    }));
  }
}
