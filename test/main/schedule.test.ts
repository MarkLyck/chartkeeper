import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBackupDue, setLinuxAutostart } from '../../src/main/schedule';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

describe('daily backup timing', () => {
  it('runs once a day, after the chosen hour', () => {
    expect(isBackupDue(at(17, 17, 59), 18, at(16, 18, 5), null)).toBe(false);
    expect(isBackupDue(at(17, 18, 0), 18, at(16, 18, 5), null)).toBe(true);
    expect(isBackupDue(at(17, 21), 18, at(17, 18, 2), null)).toBe(false);
  });
  it('catches up the next morning when the computer was off in the evening', () => {
    expect(isBackupDue(at(18, 9), 18, at(16, 18, 5), null)).toBe(true);
  });
  it('catches up after several days off', () => {
    expect(isBackupDue(at(17, 23), 18, at(14, 18), null)).toBe(true);
  });
  it('runs the first time', () => {
    expect(isBackupDue(at(17, 19), 18, null, null)).toBe(true);
  });
  it('waits three hours after a failed attempt instead of retrying every check', () => {
    expect(isBackupDue(at(17, 18, 45), 18, at(16, 18), at(17, 18, 0))).toBe(false);
    expect(isBackupDue(at(17, 21, 1), 18, at(16, 18), at(17, 18, 0))).toBe(true);
    expect(isBackupDue(at(17, 18, 45), 18, null, at(17, 18, 0))).toBe(false);
  });
});

describe('Linux autostart', () => {
  it('writes and removes the XDG autostart entry with the app path quoted', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-home-'));
    const prev = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    try {
      await setLinuxAutostart(true, '/home/t/Apps/Chart Keeper.AppImage', home);
      const file = path.join(home, '.config/autostart/chartkeeper.desktop');
      expect(await fs.readFile(file, 'utf8')).toContain('Exec="/home/t/Apps/Chart Keeper.AppImage" --hidden');
      await setLinuxAutostart(false, '', home);
      await expect(fs.stat(file)).rejects.toThrow();
    } finally {
      if (prev !== undefined) process.env.XDG_CONFIG_HOME = prev;
    }
  });
});
