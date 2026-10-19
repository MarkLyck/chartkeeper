import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotWriter } from '../../src/core/snapshot';
import { TvClient } from '../../src/core/tv/client';
import { PoliteHttp } from '../../src/core/tv/http';
import type { TvAccount } from '../../src/main/account';
import { AppStatus } from '../../src/main/appState';
import { emit, registerIpc } from '../../src/main/ipc';
import type { Shell } from '../../src/main/shell';
import { Store } from '../../src/main/store';
import type { Tasks } from '../../src/main/tasks';
import { INVOKE_CHANNELS, type AppState, type Invoke, type SnapshotSummary } from '../../src/shared/api';
import { FakeTradingView } from '../fakes/fakeTradingView';
import { referenceInAccount } from '../fakes/fixtures';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  openedPaths: [] as string[],
  openedUrls: [] as string[],
  loginItems: [] as unknown[],
  packaged: false,
  picked: { canceled: true, filePaths: [] as string[] },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => 'test',
    getPath: () => os.tmpdir(),
    get isPackaged() {
      return electron.packaged;
    },
    setLoginItemSettings: (s: unknown) => electron.loginItems.push(s),
  },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => electron.handlers.set(channel, fn) },
  dialog: { showOpenDialog: async () => electron.picked },
  shell: {
    openPath: async (p: string) => (electron.openedPaths.push(p), ''),
    openExternal: async (u: string) => void electron.openedUrls.push(u),
  },
}));
vi.mock('../../src/main/tvSession', () => ({ hasSessionCookie: async () => true, countOnChartPage: async () => null }));
vi.mock('../../src/main/signIn', () => ({ signIn: async () => undefined }));

const fast = { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} };
let dir: string;
let backups: string;
let store: Store;
let status: AppStatus;
let tv: FakeTradingView;
let signedOut: boolean;
let trayUpdates: number;
const realPlatform = process.platform;

const call = <K extends keyof Invoke>(method: K, ...args: Parameters<Invoke[K]>) => electron.handlers.get(INVOKE_CHANNELS[method])!({}, ...args) as ReturnType<Invoke[K]>;
const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-ipc-'));
  backups = path.join(dir, 'backups');
  await fs.mkdir(backups);
  store = await Store.open(path.join(dir, 'settings.json'), { backupFolder: backups, dailyBackup: false, dailyHour: 18, includePrices: false });
  tv = new FakeTradingView().add(referenceInAccount('AbCd1234', 'Min AAPL'));
  signedOut = false;
  trayUpdates = 0;
  const account = {
    username: 'demo_user',
    client: async () => new TvClient(new PoliteHttp(tv, fast), tv.account!),
    signOut: async () => void (signedOut = true),
  } as unknown as TvAccount;
  status = new AppStatus(store, account, () => undefined);
  const shell = { window: null, updateTray: () => void trayUpdates++, show: () => undefined } as unknown as Shell;
  Object.assign(electron, { openedPaths: [], openedUrls: [], loginItems: [], packaged: false, picked: { canceled: true, filePaths: [] } });
  registerIpc({ status, tasks: {} as Tasks, shell });
});

afterEach(() => setPlatform(realPlatform));

describe('opening things from the window', () => {
  it('opens folders inside the backup folder', async () => {
    const snap = path.join(backups, 'snapshots', '2026-10-17_18-00-00');
    await fs.mkdir(snap, { recursive: true });
    await call('openFolder', snap);
    await call('openFolder', backups);
    expect(electron.openedPaths).toEqual([snap, backups]);
  });

  it('refuses folders outside the backup folder, including look-alike names and ../ paths', async () => {
    const sibling = `${backups}-evil`;
    await fs.mkdir(sibling);
    await call('openFolder', sibling);
    await call('openFolder', path.join(backups, '..'));
    await call('openFolder', os.tmpdir());
    expect(electron.openedPaths).toEqual([]);
  });

  it('refuses a file inside the backup folder, because opening a file can run a program', async () => {
    const file = path.join(backups, 'run-me.command');
    await fs.writeFile(file, '#!/bin/sh');
    await call('openFolder', file);
    await call('openFolder', path.join(backups, 'missing'));
    expect(electron.openedPaths).toEqual([]);
  });

  it('opens only https pages on www.tradingview.com in the browser', async () => {
    await call('openOnTradingView', 'https://www.tradingview.com/chart/New1000/');
    for (const url of ['http://www.tradingview.com/chart/x/', 'https://www.tradingview.com.evil.example/', 'https://evil.example/?www.tradingview.com', 'file:///etc/passwd', 'javascript:alert(1)']) await call('openOnTradingView', url);
    expect(electron.openedUrls).toEqual(['https://www.tradingview.com/chart/New1000/']);
  });
});

describe('settings', () => {
  it('saves a change, returns the new state, and updates the tray menu', async () => {
    const state = await call('setSettings', { dailyHour: 7 });
    expect(state.settings.dailyHour).toBe(7);
    expect((await Store.open(path.join(dir, 'settings.json'), store.settings)).settings.dailyHour).toBe(7);
    expect(trayUpdates).toBe(1);
  });

  it('starts the installed app at login, hidden, when the daily backup is turned on, and stops when it is turned off', async () => {
    electron.packaged = true;
    setPlatform('darwin');
    await call('setSettings', { dailyBackup: true });
    await call('setSettings', { dailyBackup: true });
    await call('setSettings', { dailyBackup: false });
    expect(electron.loginItems).toEqual([{ openAtLogin: true, args: ['--hidden'] }, { openAtLogin: false, args: ['--hidden'] }]);
  });

  it('writes the Linux autostart entry for the AppImage', async () => {
    electron.packaged = true;
    setPlatform('linux');
    const prev = { xdg: process.env.XDG_CONFIG_HOME, appimage: process.env.APPIMAGE };
    process.env.XDG_CONFIG_HOME = path.join(dir, 'config');
    process.env.APPIMAGE = '/opt/ChartKeeper.AppImage';
    try {
      await call('setSettings', { dailyBackup: true });
      expect(await fs.readFile(path.join(dir, 'config/autostart/chartkeeper.desktop'), 'utf8')).toContain('Exec="/opt/ChartKeeper.AppImage" --hidden');
    } finally {
      for (const [k, v] of [['XDG_CONFIG_HOME', prev.xdg], ['APPIMAGE', prev.appimage]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
  });

  it('leaves login items alone in a development build', async () => {
    await call('setSettings', { dailyBackup: true });
    expect(electron.loginItems).toEqual([]);
  });

  it('uses the folder the user picked, and keeps the old one when the dialog is cancelled', async () => {
    expect((await call('chooseFolder')).settings.backupFolder).toBe(backups);
    electron.picked = { canceled: false, filePaths: [path.join(dir, 'elsewhere')] };
    expect((await call('chooseFolder')).settings.backupFolder).toBe(path.join(dir, 'elsewhere'));
  });
});

describe('the account', () => {
  it('does not sign out while a backup is using the session', async () => {
    let finish!: () => void;
    const backup = status.exclusive('backup', () => new Promise<void>((r) => (finish = r)));
    const state: AppState = await call('signOut');
    expect(signedOut).toBe(false);
    expect(state.busy).toBe('backup');
    finish();
    await backup;
    await call('signOut');
    expect(signedOut).toBe(true);
  });

  it('answers a sign-in with the state after it, not busy, so the buttons are enabled whatever order the window hears it in', async () => {
    expect(await call('signIn')).toMatchObject({ ok: true, value: { signedIn: true, busy: null } });
    expect(status.busy).toBeNull();
  });

  it('lists the layouts a restore can replace, with the free slots', async () => {
    tv.account = { ...tv.account!, plan: 'essential' };
    expect(await call('restoreTargets')).toEqual({ ok: true, value: { layouts: [{ uid: 'AbCd1234', name: 'Min AAPL' }], used: 1, limit: 5, plan: 'essential', free: true } });
  });
});

describe('backups on disk', () => {
  const body = { app: { name: 'ChartKeeper', version: 't' }, createdAt: '2026-10-17T10:00:00Z', account: { username: 'u', plan: null }, layouts: [], extras: { studyTemplates: 0, drawingTemplates: 0, themes: 0, scripts: 0, userDrawings: 0 }, warnings: [] };

  it('lists normal backups and the safety copies taken before a replace, marked as such', async () => {
    await (await SnapshotWriter.begin(backups, new Date(2026, 9, 17, 18))).finish(body);
    await (await SnapshotWriter.begin(path.join(backups, 'safety-copies'), new Date(2026, 9, 18, 9))).finish(body);
    const list: SnapshotSummary[] = await call('listSnapshots');
    expect(list.map((s) => [s.name, s.safetyCopy])).toEqual([['2026-10-17_18-00-00', false], ['2026-10-18_09-00-00', true]]);
  });

  it('answers a backup that cannot be opened with an error the window can show', async () => {
    expect(await call('loadLayout', path.join(backups, 'gone'), 'AbCd1234')).toMatchObject({ ok: false, error: { kind: 'unexpected', message: expect.stringContaining('ENOENT') } });
  });
});

describe('events to the window', () => {
  it('sends to an open window and skips a closed one', () => {
    const sent: unknown[] = [];
    const win = (destroyed: boolean) => ({ isDestroyed: () => destroyed, webContents: { send: (...a: unknown[]) => sent.push(a) } }) as never;
    emit(null, 'progress', { kind: 'restore', step: 'check' });
    emit(win(true), 'progress', { kind: 'restore', step: 'check' });
    emit(win(false), 'progress', { kind: 'restore', step: 'verify' });
    expect(sent).toEqual([['ck:progress', { kind: 'restore', step: 'verify' }]]);
  });
});
