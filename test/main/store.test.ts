import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettings, lockDown, Store } from '../../src/main/store';

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

  it('starts with the defaults when the settings file is damaged or has impossible values', async () => {
    const defaults = defaultSettings('/documents');
    for (const text of ['{"settings": {', JSON.stringify({ settings: { dailyHour: 30 }, lastBackup: null })]) {
      const file = await tempFile();
      await fs.writeFile(file, text);
      const store = await Store.open(file, defaults);
      expect(store.settings).toEqual(defaults);
      expect(store.lastBackup).toBeNull();
    }
  });

  it('refuses an impossible setting and keeps the current one', async () => {
    const store = await Store.open(await tempFile(), defaultSettings('/documents'));
    expect(() => store.update({ settings: { dailyHour: 24 } })).toThrow();
    expect(store.settings.dailyHour).toBe(18);
  });

  it('keeps saving after one save failed', async () => {
    // A read-only folder makes the first save fail; Windows and root ignore it.
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const file = await tempFile();
    const dir = path.dirname(file);
    const store = await Store.open(file, defaultSettings(dir));
    await fs.chmod(dir, 0o500);
    try {
      await expect(store.update({ settings: { dailyHour: 5 } })).rejects.toThrow();
    } finally {
      await fs.chmod(dir, 0o700);
    }
    await store.update({ settings: { dailyHour: 6 } });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).settings.dailyHour).toBe(6);
  });
});

describe('the private app folder', () => {
  it('is readable only by the user, also when it already existed with wider permissions', async () => {
    if (process.platform === 'win32') return;
    const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ck-lock-')), 'userData');
    await fs.mkdir(dir, { mode: 0o755 });
    await fs.chmod(dir, 0o755);
    await lockDown(dir);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    await lockDown(path.join(dir, 'new'));
    expect((await fs.stat(path.join(dir, 'new'))).mode & 0o777).toBe(0o700);
  });
});
