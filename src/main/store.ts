import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writePrivate } from '../core/snapshot';
import type { Settings } from '../shared/api';

const SettingsSchema = z.object({
  backupFolder: z.string().min(1),
  dailyBackup: z.boolean(),
  dailyHour: z.number().int().min(0).max(23),
  includePrices: z.boolean(),
});

const StateSchema = z.object({
  settings: SettingsSchema,
  lastBackup: z.object({ at: z.string(), ok: z.boolean(), dir: z.string() }).nullable(),
  lastSuccessAt: z.string().nullable().default(null),
  /** When the daily schedule last tried; a failure here waits 3 hours before the schedule tries again. */
  lastScheduledAttemptAt: z.string().nullable().default(null),
  /** Day (YYYY-MM-DD) we last told the user a scheduled backup couldn't run because they're signed out. */
  signInNoticeDay: z.string().nullable().default(null),
});
export type StoredState = z.infer<typeof StateSchema>;

export const defaultSettings = (documents: string): Settings => ({
  backupFolder: path.join(documents, 'ChartKeeper Backups'),
  dailyBackup: false,
  dailyHour: 18,
  includePrices: true,
});

/** Settings and the last backup result, in one small JSON file in the app's private folder. */
export class Store {
  private constructor(
    private readonly file: string,
    private state: StoredState,
  ) {}

  static async open(file: string, defaults: Settings): Promise<Store> {
    let state: StoredState = { settings: defaults, lastBackup: null, lastSuccessAt: null, lastScheduledAttemptAt: null, signInNoticeDay: null };
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      const parsed = StateSchema.safeParse({ ...raw, settings: { ...defaults, ...raw.settings } });
      if (parsed.success) state = parsed.data;
    } catch {
      /* first run */
    }
    return new Store(file, state);
  }

  get settings(): Settings {
    return this.state.settings;
  }
  get lastBackup() {
    return this.state.lastBackup;
  }
  get lastSuccessAt() {
    return this.state.lastSuccessAt;
  }
  get lastScheduledAttemptAt() {
    return this.state.lastScheduledAttemptAt;
  }
  get signInNoticeDay() {
    return this.state.signInNoticeDay;
  }

  private writing: Promise<void> = Promise.resolve();

  /** Applies the change at once; writes to disk one at a time, newest state last. */
  update(patch: { settings?: Partial<Settings>; lastBackup?: StoredState['lastBackup']; lastSuccessAt?: string | null; lastScheduledAttemptAt?: string | null; signInNoticeDay?: string | null }): Promise<void> {
    this.state = StateSchema.parse({ ...this.state, ...patch, settings: { ...this.state.settings, ...patch.settings } });
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writing = this.writing.catch(() => undefined).then(() => writePrivate(this.file, snapshot));
    return this.writing;
  }
}

/**
 * Restricts the app's private folder (the TradingView sign-in lives there) to
 * the current user. On Windows the folder inside the user profile is already
 * private; chmod is a no-op there. Disks without Unix permissions (FAT, exFAT)
 * refuse chmod, which is fine for a folder ChartKeeper doesn't keep secrets in.
 */
export async function lockDown(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(dir, 0o700).catch(() => undefined);
}
