import { createWorker, createScheduler } from "tesseract.js";
import { logger } from "./logger";
import type { OcrResult } from "@shared/types";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

const WORKER_PATH = path.join(app.getAppPath(), "node_modules", "tesseract.js", "dist", "worker.min.js");

export class OcrService {
  private worker: Tesseract.Worker | null = null;
  private busy = false;
  private workerInitError: Error | null = null;

  private async getWorker(): Promise<Tesseract.Worker | null> {
    if (this.workerInitError) {
      return null;
    }

    if (!this.worker) {
      try {
        const workerOptions: any = {
          langPath: path.join(app.getAppPath(), "node_modules", "tesseract.js", "dist"),
          logger: (m: any) => logger.debug("Tesseract", m),
        };

        if (fs.existsSync(WORKER_PATH)) {
          workerOptions.workerPath = WORKER_PATH;
        }

        this.worker = await createWorker("eng+ind", 1, workerOptions);
      } catch (error: any) {
        logger.error("OCR", "Failed to create Tesseract worker:", error);
        this.workerInitError = error;
        this.worker = null;
        return null;
      }
    }
    return this.worker;
  }

  async extractText(imageBuffer: Buffer, attachmentName: string, sourcePageId: string): Promise<OcrResult | null> {
    if (this.busy) {
      logger.warn("OCR", "Worker busy, skipping OCR for", attachmentName);
      return null;
    }

    if (this.workerInitError) {
      logger.warn("OCR", "Skipping OCR due to worker initialization error:", this.workerInitError.message);
      return null;
    }

    this.busy = true;
    try {
      const worker = await this.getWorker();
      if (!worker) {
        logger.warn("OCR", "No worker available, skipping OCR");
        return null;
      }

      const { data } = await worker.recognize(imageBuffer);

      const text = data.text?.trim() || "";
      const confidence = data.confidence || 0;

      if (text.length < 10) {
        logger.info("OCR", `OCR result too short (${text.length} chars) for ${attachmentName}, skipping`);
        return null;
      }

      logger.info("OCR", `Extracted ${text.length} chars from ${attachmentName} (confidence: ${confidence.toFixed(1)}%)`);

      return {
        text,
        confidence,
        sourceAttachment: attachmentName,
        sourcePageId,
      };
    } catch (error: any) {
      logger.error("OCR", `Failed to OCR ${attachmentName}:`, error);
      // If worker fails, mark it as failed for future calls
      if (error.message?.includes("addEventListener") || error.message?.includes("worker")) {
        this.workerInitError = error;
        this.worker = null;
      }
      return null;
    } finally {
      this.busy = false;
    }
  }

  async extractTextFromBase64(base64Data: string, attachmentName: string, sourcePageId: string): Promise<OcrResult | null> {
    const buffer = Buffer.from(base64Data.split(",")[1] || base64Data, "base64");
    return this.extractText(buffer, attachmentName, sourcePageId);
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (error) {
        logger.warn("OCR", "Error terminating worker:", error);
      }
      this.worker = null;
    }
  }
}
