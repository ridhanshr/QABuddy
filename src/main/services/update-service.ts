import axios from "axios";
import { app, Notification, shell } from "electron";
import type { UpdateInfo } from "@shared/types";
import { logger } from "./logger";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export class UpdateService {
  private cachedUpdateInfo: UpdateInfo | null = null;
  private readonly repoUrl = "https://api.github.com/repos/ridhanshr/QABuddy/releases/latest";

  /**
   * Mengembalikan status update yang terakhir kali disimpan
   */
  public getCachedStatus(): UpdateInfo | null {
    return this.cachedUpdateInfo;
  }

  /**
   * Logika perbandingan semver sederhana (current vs latest)
   * Mengembalikan true jika latest > current
   */
  public isNewerVersion(current: string, latest: string): boolean {
    const cleanCurrent = current.replace(/^v/i, "").trim();
    const cleanLatest = latest.replace(/^v/i, "").trim();

    const currentParts = cleanCurrent.split(".").map((val) => parseInt(val, 10) || 0);
    const latestParts = cleanLatest.split(".").map((val) => parseInt(val, 10) || 0);

    const maxLength = Math.max(currentParts.length, latestParts.length);
    for (let i = 0; i < maxLength; i++) {
      const curr = currentParts[i] || 0;
      const lat = latestParts[i] || 0;
      if (lat > curr) return true;
      if (curr > lat) return false;
    }
    return false;
  }

  /**
   * Melakukan request ke API GitHub untuk memeriksa update rilis terbaru
   */
  public async checkForUpdates(currentVersion: string, triggerNotification = false): Promise<UpdateInfo> {
    const checkedAt = new Date().toISOString();
    try {
      logger.info(`Checking for updates from GitHub... Current version: ${currentVersion}`);
      
      const response = await axios.get(this.repoUrl, {
        headers: {
          "User-Agent": "qa-buddy-desktop",
          // Mencegah cache agresif
          "Cache-Control": "no-cache",
        },
        timeout: 10000,
      });

      if (!response.data || !response.data.tag_name) {
        throw new Error("Invalid response from GitHub Releases API");
      }

      const latestVersion = response.data.tag_name; // e.g. "v0.2.0"
      const url = response.data.html_url || "https://github.com/ridhanshr/QABuddy/releases";
      const releaseNotes = response.data.body || "";
      const publishedAt = response.data.published_at || "";

      const updateAvailable = this.isNewerVersion(currentVersion, latestVersion);

      const updateInfo: UpdateInfo = {
        updateAvailable,
        currentVersion,
        latestVersion,
        releaseNotes,
        url,
        publishedAt,
        checkedAt,
      };

      this.cachedUpdateInfo = updateInfo;

      if (updateAvailable && triggerNotification) {
        this.showNativeNotification(latestVersion, url);
      }

      return updateInfo;
    } catch (err: any) {
      const errMsg = err.message || "Unknown error";
      logger.error("Failed to check for updates:", err);

      const errorUpdateInfo: UpdateInfo = {
        updateAvailable: false,
        currentVersion,
        latestVersion: this.cachedUpdateInfo?.latestVersion || currentVersion,
        releaseNotes: this.cachedUpdateInfo?.releaseNotes || "",
        url: this.cachedUpdateInfo?.url || "https://github.com/ridhanshr/QABuddy/releases",
        publishedAt: this.cachedUpdateInfo?.publishedAt || "",
        checkedAt,
        error: `Gagal memeriksa update: ${errMsg}`,
      };

      // Jangan menimpa cache sukses sebelumnya dengan status error jika sebelumnya terbukti ada update
      if (!this.cachedUpdateInfo) {
        this.cachedUpdateInfo = errorUpdateInfo;
      }

      return errorUpdateInfo;
    }
  }

  /**
   * Menampilkan notifikasi desktop sistem operasi
   */
  private showNativeNotification(latestVersion: string, releaseUrl: string): void {
    try {
      if (!Notification.isSupported()) {
        logger.warn("System does not support desktop notifications");
        return;
      }

      const notification = new Notification({
        title: "QA Buddy Update Tersedia! 🚀",
        body: `Versi ${latestVersion} telah dirilis di GitHub. Klik untuk mengunduh.`,
        silent: false,
      });

      notification.on("click", () => {
        logger.info(`Opening release URL: ${releaseUrl}`);
        shell.openExternal(releaseUrl).catch((err) => {
          logger.error("Failed to open release URL:", err);
        });
      });

      notification.show();
    } catch (err) {
      logger.error("Failed to trigger native notification:", err);
    }
  }

  /**
   * Mengunduh update dan menjalankan installer secara independen
   */
  public async downloadAndInstallUpdate(
    onProgress: (progress: { progress: number; downloaded: number; total: number }) => void
  ): Promise<void> {
    try {
      logger.info("Starting update download...");
      const response = await axios.get(this.repoUrl, {
        headers: {
          "User-Agent": "qa-buddy-desktop",
          "Cache-Control": "no-cache",
        },
        timeout: 10000,
      });

      const assets = response.data.assets || [];
      const exeAsset = assets.find((asset: any) => asset.name.endsWith(".exe"));
      if (!exeAsset) {
        throw new Error("Tidak ditemukan installer Windows (.exe) di rilis terbaru.");
      }

      const downloadUrl = exeAsset.browser_download_url;
      logger.info(`Downloading installer from: ${downloadUrl}`);

      const downloadResponse = await axios({
        method: "get",
        url: downloadUrl,
        responseType: "stream",
        headers: {
          "User-Agent": "qa-buddy-desktop",
        },
      });

      const totalLength = parseInt(String(downloadResponse.headers["content-length"] || "0"), 10) || 0;
      let downloadedBytes = 0;

      const tempPath = app.getPath("temp");
      const installerPath = path.join(tempPath, exeAsset.name);

      await fs.promises.mkdir(tempPath, { recursive: true });

      const writer = fs.createWriteStream(installerPath);
      downloadResponse.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        downloadResponse.data.on("data", (chunk: any) => {
          downloadedBytes += chunk.length;
          const progress = totalLength > 0 ? (downloadedBytes / totalLength) * 100 : 0;
          onProgress({ progress, downloaded: downloadedBytes, total: totalLength });
        });

        writer.on("finish", () => {
          logger.info(`Installer downloaded successfully to: ${installerPath}`);
          resolve();
        });

        writer.on("error", (err) => {
          logger.error("Writer error during update download:", err);
          reject(err);
        });

        downloadResponse.data.on("error", (err: any) => {
          logger.error("Download stream error:", err);
          reject(err);
        });
      });

      // Jalankan file installer setup .exe yang diunduh secara independen
      logger.info(`Running installer at: ${installerPath}`);
      const child = spawn(installerPath, [], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      logger.info("Quitting application to complete update...");
      app.quit();
    } catch (err: any) {
      logger.error("Failed to download and install update:", err);
      throw err;
    }
  }
}
