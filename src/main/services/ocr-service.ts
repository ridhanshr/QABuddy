import { createWorker } from "tesseract.js";
import { logger } from "./logger";
import type { OcrResult } from "@shared/types";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

const WORKER_PATH = path.join(app.getAppPath(), "node_modules", "tesseract.js", "dist", "worker.min.js");

/**
 * OCR service using Tesseract.js v5 (Node.js native worker support).
 * v5 uses Node.js worker_threads instead of Web Workers, so it runs
 * correctly in Electron's main process without DOM API issues.
 */
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
          langPath: "https://tessdata.projectnaptha.com/4.0.0/",
          logger: (m: any) => logger.debug("Tesseract", m),
        };

        this.worker = await createWorker("eng+ind", 1, workerOptions);
        logger.info("OCR", "Tesseract worker created successfully");
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
      return null;
    }

    this.busy = true;
    try {
      const worker = await this.getWorker();
      if (!worker) {
        logger.warn("OCR", "No worker available, skipping OCR");
        return null;
      }

      // Add a 10-second timeout to prevent OCR from hanging the IPC thread
      const recognizePromise = worker.recognize(imageBuffer);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("OCR operation timed out")), 10000)
      );

      const { data } = await Promise.race([recognizePromise, timeoutPromise]);

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
      // If worker fails fatally, mark it as failed for future calls
      if (error.message?.includes("worker") || error.message?.includes("terminated") || error.message?.includes("timeout")) {
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
