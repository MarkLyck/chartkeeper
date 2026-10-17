import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBackupDue, setLinuxAutostart } from '../../src/main/schedule';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

describe('daily backup timing', () => {
  it('waits until the chosen hour', () => {
    expect(isBackupDue(at(17, 17, 59), 18, at(16, 18, 5))).toBe(false);
    expect(isBackupDue(at(17, 18, 0), 18, at(16, 18, 5))).toBe(true);
  });
  it('runs once per day', () => {
    expect(isBackupDue(at(17, 21), 18, at(17, 18, 2))).toBe(false);
  });
  it('catches up after the computer was off at the chosen hour', () => {
    expect(isBackupDue(at(17, 23), 18, at(14, 18))).toBe(true);
  });
  it('runs the first time', () => {
    expect(isBackupDue(at(17, 19), 18, null)).toBe(true);
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
