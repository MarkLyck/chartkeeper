import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { FAKE_TRADINGVIEW_ENV } from '../../src/main/fakeTradingView';
import { SEED_ENV, type FakeSeed } from '../fakes/fakeTradingViewApp';

export const ROOT = path.resolve(__dirname, '../..');

/**
 * Starts the built app with a fresh private folder and a backup folder that
 * holds the reference backup, like a PC where ChartKeeper ran before.
 * With `fake`, the app runs against the fake TradingView (needs
 * `node scripts/build.mjs --test-fake`) and the backup folder starts empty.
 */
export async function launchApp(extra: Partial<Parameters<typeof _electron.launch>[0]> = {}, baseDir?: string, fake?: FakeSeed): Promise<{ app: ElectronApplication; window: Page; userData: string; backups: string }> {
  const base = baseDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'ck-e2e-')));
  await fs.rm(base, { recursive: true, force: true });
  const userData = path.join(base, 'userData');
  const backups = path.join(base, 'My Backups');
  const reference = path.join(backups, 'snapshots', '2026-10-17_10-00-00');
  if (fake) await fs.mkdir(backups, { recursive: true });
  else await fs.cp(path.join(ROOT, 'test/fixtures/reference-snapshot'), reference, { recursive: true });
  await fs.mkdir(userData, { recursive: true });
  const lastBackup = fake ? null : { at: '2026-10-17T08:00:00.000Z', ok: true, dir: reference };
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ settings: { backupFolder: backups, dailyBackup: false, dailyHour: 18, includePrices: true }, lastBackup }));
  const fakeEnv: Record<string, string> = {};
  if (fake) {
    const seedFile = path.join(base, 'fake-seed.json');
    await fs.writeFile(seedFile, JSON.stringify(fake));
    Object.assign(fakeEnv, { [FAKE_TRADINGVIEW_ENV]: '1', [SEED_ENV]: seedFile });
  }
  const electronPath = require('electron') as unknown as string;
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [path.join(ROOT, 'dist/main.js'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    ...extra,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')), CHARTKEEPER_USER_DATA: userData, ...fakeEnv } as Record<string, string>,
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window, userData, backups };
}
