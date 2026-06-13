export class Normalizer {
  normalize(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\s+/g, " ")
      .replace(/[^\w\s]/g, "")
      .trim();
  }

  extractSearchText(summary: string, description: string, steps: string): string {
    const parts = [summary, description, steps].filter(Boolean);
    const combined = parts
      .join(" ")
      .toLowerCase()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return combined;
  }

  computeFingerprint(summary: string, description: string): string {
    const norm = this.normalize(`${summary} ${description}`);
    const words = norm.split(/\s+/).filter(w => w.length > 2);
    const unique = [...new Set(words)].sort();
    return unique.slice(0, 20).join("::");
  }

  sanitizeForSearch(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
