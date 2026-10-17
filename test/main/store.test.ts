import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettings, Store } from '../../src/main/store';

const tempFile = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ck-store-')), 'settings.json');

describe('settings file', () => {
  it('keeps the newest state when many changes are saved at once', async () => {
    const file = await tempFile();
    const dir = path.dirname(file);
    const store = await Store.open(file, defaultSettings(dir));
    await Promise.all(Array.from({ length: 100 }, (_, h) => store.update({ settings: { dailyHour: h % 24, includePrices: h % 2 === 0 } })));
    const reopened = await Store.open(file, defaultSettings(dir));
    expect(reopened.settings.dailyHour).toBe(99 % 24);
    expect(reopened.settings.includePrices).toBe(false);
  });

  it('loads a settings file from an older version that still has a language, and drops it on the next save', async () => {
    const file = await tempFile();
    const saved = { backupFolder: '/backups/elsewhere', dailyBackup: true, dailyHour: 7, includePrices: false, lang: 'da' };
    await fs.writeFile(file, JSON.stringify({ settings: saved, lastBackup: { at: '2026-10-16T16:00:00.000Z', ok: true, dir: '/backups/elsewhere/snapshots/x' } }));
    const store = await Store.open(file, defaultSettings('/documents'));
    expect(store.settings).toEqual({ backupFolder: '/backups/elsewhere', dailyBackup: true, dailyHour: 7, includePrices: false });
    expect(store.lastBackup).toEqual({ at: '2026-10-16T16:00:00.000Z', ok: true, dir: '/backups/elsewhere/snapshots/x' });
    await store.update({ settings: { dailyHour: 8 } });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).settings).toEqual({ backupFolder: '/backups/elsewhere', dailyBackup: true, dailyHour: 8, includePrices: false });
  });
});
