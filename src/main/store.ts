import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Settings } from '../shared/api';

const SettingsSchema = z.object({
  backupFolder: z.string().min(1),
  dailyBackup: z.boolean(),
  dailyHour: z.number().int().min(0).max(23),
  includePrices: z.boolean(),
  lang: z.enum(['da', 'en']),
});

const StateSchema = z.object({
  settings: SettingsSchema,
  lastBackup: z.object({ at: z.string(), ok: z.boolean(), dir: z.string() }).nullable(),
});
export type StoredState = z.infer<typeof StateSchema>;

export const defaultSettings = (documents: string, locale: string): Settings => ({
  backupFolder: path.join(documents, 'ChartKeeper Backups'),
  dailyBackup: false,
  dailyHour: 18,
  includePrices: true,
  lang: locale.toLowerCase().startsWith('da') ? 'da' : 'en',
});

/** Settings and the last backup result, in one small JSON file in the app's private folder. */
export class Store {
  private constructor(
    private readonly file: string,
    private state: StoredState,
  ) {}

  static async open(file: string, defaults: Settings): Promise<Store> {
    let state: StoredState = { settings: defaults, lastBackup: null };
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

  async update(patch: { settings?: Partial<Settings>; lastBackup?: StoredState['lastBackup'] }): Promise<void> {
    this.state = StateSchema.parse({ ...this.state, ...patch, settings: { ...this.state.settings, ...patch.settings } });
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }
}

/**
 * Restricts the app's private folder (the TradingView sign-in lives there) to
 * the current user. On Windows the folder inside the user profile is already
 * private; chmod is a no-op there.
 */
export async function lockDown(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(dir, 0o700);
}
