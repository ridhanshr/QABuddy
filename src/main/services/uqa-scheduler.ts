import { Notification, BrowserWindow, app } from "electron";
import type { UqaIssue, UqaConfig, PerIssueReminder } from "@shared/types";

export type UqaReminderCallback = (issueKey: string, summary: string) => void;

export class UqaScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private config: UqaConfig | null = null;
  private getIssuesFn: (() => Promise<UqaIssue[]>) | null = null;
  private onRemind: UqaReminderCallback | null = null;
  private mainWindow: BrowserWindow | null = null;

  start(
    config: UqaConfig,
    getIssuesFn: () => Promise<UqaIssue[]>,
    onRemind: UqaReminderCallback
  ): void {
    this.config = config;
    this.getIssuesFn = getIssuesFn;
    this.onRemind = onRemind;
    this.mainWindow = BrowserWindow.getAllWindows()[0] || null;
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.config = null;
    this.getIssuesFn = null;
    this.onRemind = null;
  }

  restart(config: UqaConfig): void {
    if (!this.getIssuesFn || !this.onRemind) return;
    this.stop();
    this.config = config;
    this.start(config, this.getIssuesFn, this.onRemind);
  }

  isRunning(): boolean {
    return this.timer !== null && this.config !== null;
  }

  getConfig(): UqaConfig | null {
    return this.config;
  }

  private scheduleNext(): void {
    if (!this.config || !this.config.enabled) return;

    const now = new Date();
    const [hours, minutes] = this.config.remindTime.split(":").map(Number);
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);

    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();

    this.timer = setTimeout(() => {
      this.fireReminder();
      this.scheduleNext();
    }, delay);
  }

  private isReminderDay(issueKey: string, dayOfWeek: number): boolean {
    if (!this.config) return false;
    const perIssue = this.config.perIssueReminders?.[issueKey];
    if (perIssue && perIssue.remindDays) {
      return perIssue.remindDays.includes(dayOfWeek);
    }
    return this.config.remindDays.includes(dayOfWeek);
  }

  private isReminderEnabled(issueKey: string): boolean {
    if (!this.config) return false;
    const perIssue = this.config.perIssueReminders?.[issueKey];
    if (perIssue !== undefined) {
      return perIssue.enabled;
    }
    return this.config.enabled;
  }

  private async fireReminder(): Promise<void> {
    if (!this.config || !this.getIssuesFn || !this.onRemind) return;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const dayOfWeek = now.getDay();

    try {
      const issues = await this.getIssuesFn();
      for (const issue of issues) {
        if (!issue.needsUpdate) continue;

        // Check per-UQA or global enabled
        if (!this.isReminderEnabled(issue.issueKey)) continue;

        // Check per-UQA or global reminder days
        if (!this.isReminderDay(issue.issueKey, dayOfWeek)) continue;

        // Check anti-spam: already notified today?
        const lastNotified = this.config.lastNotifiedDate[issue.issueKey];
        if (lastNotified === today) continue;

        // Fire desktop notification
        this.sendNotification(issue);

        // Track notification
        this.config.lastNotifiedDate[issue.issueKey] = today;

        // Callback for renderer
        this.onRemind(issue.issueKey, issue.summary);
      }
    } catch {
      // Silently fail — will retry next day
    }
  }

  private sendNotification(issue: UqaIssue): void {
    try {
      const notif = new Notification({
        title: `⏰ Daily UQA — ${issue.projectKey}`,
        body: `"${issue.summary}" belum diupdate hari ini. Klik untuk buka Quick Update.`,
        silent: false,
      });
      notif.on("click", () => {
        // Focus the main window when notification is clicked
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          if (this.mainWindow.isMinimized()) this.mainWindow.restore();
          this.mainWindow.focus();
          // Send IPC to switch to daily-uqa view
          this.mainWindow.webContents.send("uqa-reminder", issue.issueKey, issue.summary);
        }
      });
      notif.show();
    } catch {
      // Notifications may fail on some platforms
    }
  }
}
