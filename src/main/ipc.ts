import { app, dialog, ipcMain, shell as osShell, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSnapshots, SnapshotReader } from '../core/snapshot';
import { compareSnapshots, openLayout } from '../core/snapshotView';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Events, type Invoke } from '../shared/api';
import { guarded, type AppStatus } from './appState';
import { setLinuxAutostart } from './schedule';
import type { Shell } from './shell';
import { cancelSignIn, signIn, type SafariSeam } from './signIn';
import type { Tasks } from './tasks';

/** Registers the handler for one method of the window's api, checked against its signature in src/shared/api.ts. */
export function handle<K extends keyof Invoke>(method: K, fn: (...args: Parameters<Invoke[K]>) => ReturnType<Invoke[K]>): void {
  ipcMain.handle(INVOKE_CHANNELS[method], (_e, ...args: unknown[]) => fn(...(args as Parameters<Invoke[K]>)));
}

export function emit<K extends keyof Events>(win: BrowserWindow | null, event: K, payload: Events[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNELS[event], payload);
}

export interface IpcDeps {
  status: AppStatus;
  tasks: Tasks;
  shell: Shell;
  /** Where Safari sign-in looks, when not the real Safari (end-to-end tests). */
  safari?: SafariSeam;
}

/** The app process's side of every call in src/shared/api.ts. */
export function registerIpc({ status, tasks, shell, safari }: IpcDeps): void {
  const { store, account } = status;
  handle('getState', () => status.read());
  handle('setSettings', async (patch) => {
    const before = store.settings.dailyBackup;
    await store.update({ settings: patch });
    if (patch.dailyBackup !== undefined && patch.dailyBackup !== before) await applyAutostart(patch.dailyBackup);
    shell.updateTray();
    return status.read();
  });
  handle('chooseFolder', async () => {
    const r = await dialog.showOpenDialog(shell.window!, { properties: ['openDirectory', 'createDirectory'], defaultPath: store.settings.backupFolder });
    if (!r.canceled && r.filePaths[0]) await store.update({ settings: { backupFolder: r.filePaths[0] } });
    return status.read();
  });
  handle('signIn', async () => {
    const r = await status.exclusive('signin', async () => {
      await signIn(account, shell.window, safari);
      shell.show();
    });
    // Read once the task is over: a state read inside it says "busy", and if this reply
    // reached the window after the "no longer busy" push, every button would stay disabled.
    return r.ok ? { ok: true as const, value: await status.read() } : r;
  });
  handle('cancelSignIn', async () => cancelSignIn());
  handle('signOut', async () => {
    // Not while a backup or restore is using the session.
    await status.exclusive('signin', () => account.signOut());
    return status.read();
  });
  handle('backupNow', () => tasks.backup(false));
  handle('listSnapshots', async () => [
    ...(await listSnapshots(store.settings.backupFolder)).map((s) => ({ ...s, safetyCopy: false })),
    ...(await listSnapshots(path.join(store.settings.backupFolder, 'safety-copies'))).map((s) => ({ ...s, safetyCopy: true })),
  ]);
  handle('loadLayout', (dir, uid) => guarded(async () => openLayout(await SnapshotReader.open(dir), uid)));
  handle('compare', (a, b) => guarded(async () => compareSnapshots(await SnapshotReader.open(a), await SnapshotReader.open(b))));
  handle('restoreTargets', () =>
    status.exclusive('restore', async () => {
      const c = await account.client();
      const list = await c.listLayouts();
      const slots = await c.slots(list.length);
      return { layouts: list.map((l) => ({ uid: l.uid, name: l.name })), ...slots };
    }),
  );
  handle('restore', (req) => tasks.restore(req));
  handle('restoreTemplates', (dir) => tasks.restoreTemplates(dir));
  handle('openFolder', async (dir) => {
    // Only folders inside the backup folder: shell.openPath would also run a program.
    if (isInside(store.settings.backupFolder, dir) && (await fs.stat(dir).catch(() => null))?.isDirectory()) await osShell.openPath(dir);
  });
  handle('openOnTradingView', async (url) => {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === 'www.tradingview.com') await osShell.openExternal(u.toString());
  });
}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function applyAutostart(enabled: boolean) {
  if (!app.isPackaged) return;
  if (process.platform === 'linux') await setLinuxAutostart(enabled, process.env.APPIMAGE ?? process.execPath);
  else app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}
