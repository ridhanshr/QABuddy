import type { JiraProjectSource } from "@shared/types";

type SyncSourceFn = (projectKey: string) => Promise<void>;
type GetSourcesFn = () => Promise<JiraProjectSource[]>;

export class DefectAutoSyncScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private getSourcesFn: GetSourcesFn | null = null;
  private syncSourceFn: SyncSourceFn | null = null;
  private running = false;

  start(getSourcesFn: GetSourcesFn, syncSourceFn: SyncSourceFn): void {
    this.getSourcesFn = getSourcesFn;
    this.syncSourceFn = syncSourceFn;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    this.getSourcesFn = null;
    this.syncSourceFn = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  restart(getSourcesFn: GetSourcesFn, syncSourceFn: SyncSourceFn): void {
    this.stop();
    this.start(getSourcesFn, syncSourceFn);
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, 60_000);
  }

  private async tick(): Promise<void> {
    if (!this.running || !this.getSourcesFn || !this.syncSourceFn) return;

    try {
      const sources = await this.getSourcesFn();
      const now = new Date();
      const today = this.formatLocalDate(now);
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      for (const source of sources) {
        if (!source.isActive || !source.autoSyncEnabled) continue;
        if (!this.isScheduledDay(source.autoSyncDays, now.getDay())) continue;
        if (!this.isAtOrAfterScheduledTime(source.autoSyncTime, currentMinutes)) continue;
        if (source.lastAutoSyncAt && this.formatLocalDate(new Date(source.lastAutoSyncAt)) === today) continue;

        try {
          await this.syncSourceFn(source.projectKey);
        } catch {
          // Keep other sources eligible even if one source fails.
        }
      }
    } catch {
      // Keep scheduler resilient. A later tick will retry.
    } finally {
      this.scheduleNextTick();
    }
  }

  private isScheduledDay(days: number[] | undefined, dayOfWeek: number): boolean {
    if (!days || days.length === 0) return false;
    return days.includes(dayOfWeek);
  }

  private isAtOrAfterScheduledTime(time: string | undefined, currentMinutes: number): boolean {
    if (!time) return false;
    const [hours, minutes] = time.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
    const scheduledMinutes = hours * 60 + minutes;
    return currentMinutes >= scheduledMinutes;
  }

  private formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
