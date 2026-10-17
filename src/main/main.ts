import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBackup } from '../core/backup';
import { restoreLayout, RestoreJournal, restoreTemplates } from '../core/restore';
import { cleanupInterrupted, listSnapshots, SnapshotReader } from '../core/snapshot';
import { compareSnapshots, openLayout } from '../core/snapshotView';
import { TvClient } from '../core/tv/client';
import { nodeSocketFactory } from '../core/tv/datafeed';
import { urls } from '../core/tv/endpoints';
import { TvError } from '../core/tv/errors';
import { PoliteHttp } from '../core/tv/http';
import { IPC, type AppError, type AppState, type ProgressEvent, type RestoreRequest, type Result, type Settings } from '../shared/api';
import { findBrowser } from './browsers';
import { SignInCancelled, signInWithBrowser } from './browserSignIn';
import { isBackupDue, setLinuxAutostart } from './schedule';
import { defaultSettings, lockDown, Store } from './store';
import { countOnChartPage, ElectronPageTransport, hasSessionCookie, importCookies, signOut, tvSession } from './tvSession';

if (process.env.CHARTKEEPER_USER_DATA) app.setPath('userData', process.env.CHARTKEEPER_USER_DATA);
const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin === true;

let store: Store;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let busy: AppState['busy'] = null;
let username: string | null = null;
let quitting = false;
const transport = new ElectronPageTransport();
/** One rate limiter for every request, so a backup and the restore screen can't add up to more than one request at a time. */
const http = new PoliteHttp(transport);

const logFile = () => path.join(app.getPath('userData'), 'logs', 'chartkeeper.log');
function log(line: string) {
  try {
    const f = logFile();
    mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    if ((statSync(f, { throwIfNoEntry: false })?.size ?? 0) > 2_000_000) renameSync(f, `${f}.old`);
    appendFileSync(f, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch {
    /* logging must never break the app */
  }
}

function toAppError(e: unknown): AppError {
  if (e instanceof TvError) {
    log(`error ${e.kind}: ${e.message} ${e.detail}`);
    return { kind: e.kind, message: e.message, params: e.params };
  }
  if (e instanceof SignInCancelled) return { kind: 'cancelled', message: e.message, params: {} };
  const err = e as Error;
  log(`unexpected: ${err?.stack ?? String(e)}`);
  return { kind: 'unexpected', message: err?.message ?? String(e), params: {} };
}

async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: toAppError(e) };
  }
}

async function exclusive<T>(kind: NonNullable<AppState['busy']>, fn: () => Promise<T>): Promise<Result<T>> {
  if (busy) return { ok: false, error: { kind: 'busy', message: `ChartKeeper is busy (${busy}).`, params: { task: busy } } };
  busy = kind;
  void pushState();
  try {
    return await guarded(fn);
  } finally {
    busy = null;
    void pushState();
  }
}

async function state(): Promise<AppState> {
  const signedIn = await hasSessionCookie();
  if (!signedIn) username = null;
  return {
    version: app.getVersion(),
    platform: process.platform as AppState['platform'],
    settings: store.settings,
    signedIn,
    username,
    browserName: findBrowser()?.name ?? null,
    lastBackup: store.lastBackup,
    busy,
  };
}

async function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.state, await state());
  updateTray();
}

function progress(e: ProgressEvent) {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.progress, e);
}

/** A client for the signed-in account, or a plain "please sign in" error. */
async function client(): Promise<TvClient> {
  if (!(await hasSessionCookie())) throw new TvError('not-signed-in', 'You are not signed in to TradingView.');
  // A fresh page each time: the tray app may run for weeks, and the sign-in, token and build can change.
  transport.reset();
  const user = await transport.user().catch((e: unknown) => {
    throw new TvError('network', 'Could not reach TradingView. Check the internet connection and try again.', String(e));
  });
  if (!user) {
    transport.reset();
    throw new TvError('not-signed-in', 'TradingView does not recognise the saved sign-in any more. Please sign in again.');
  }
  username = user.username;
  return new TvClient(http, user);
}

async function doSignIn(): Promise<AppState> {
  const browser = findBrowser();
  const isTv = (c: { domain: string }) => c.domain === 'tradingview.com' || c.domain.endsWith('.tradingview.com');
  const isSignedIn = (cs: { name: string; domain: string }[]) => cs.some((c) => c.name === 'sessionid' && isTv(c));
  let cookies;
  const started = Date.now();
  try {
    if (!browser) throw new Error('no browser found');
    log(`sign-in with ${browser.name}`);
    cookies = await signInWithBrowser({ browserPath: browser.path, profileDir: path.join(app.getPath('userData'), 'signin-profile'), startUrl: urls.signIn, isSignedIn, keep: isTv });
  } catch (e) {
    // A browser that quits right away couldn't start (e.g. a sandboxed snap package); offer the in-app window instead.
    if (browser && !(e instanceof SignInCancelled && Date.now() - started < 8000)) throw e;
    log(`sign-in with app window (${(e as Error).message})`);
    cookies = await signInWithAppWindow();
  }
  await importCookies(cookies);
  transport.reset();
  await client();
  win?.show();
  win?.focus();
  return state();
}

/**
 * Used only when no Chrome, Edge, Brave or Chromium is installed. Google
 * refuses sign-in inside app windows, so this window suits email sign-in.
 */
async function signInWithAppWindow() {
  const { session } = await import('electron');
  const partition = 'signin-temporary';
  const s = session.fromPartition(partition);
  const w = new BrowserWindow({ width: 520, height: 760, title: 'TradingView', parent: win ?? undefined, webPreferences: { partition, contextIsolation: true, sandbox: true } });
  await w.loadURL(urls.signIn);
  try {
    return await new Promise<import('./browserSignIn').CdpCookie[]>((resolve, reject) => {
      w.on('closed', () => reject(new SignInCancelled()));
      const poll = async () => {
        if (w.isDestroyed()) return;
        const all = await s.cookies.get({});
        const tv = all.filter((c) => c.domain?.endsWith('tradingview.com'));
        if (tv.some((c) => c.name === 'sessionid')) {
          resolve(tv.map((c) => ({ name: c.name, value: c.value, domain: c.domain!, path: c.path ?? '/', expires: c.expirationDate ?? -1, httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: c.sameSite === 'strict' ? 'Strict' : c.sameSite === 'no_restriction' ? 'None' : 'Lax' })));
          w.destroy();
        } else setTimeout(poll, 1500);
      };
      void poll();
    });
  } finally {
    await s.clearStorageData();
  }
}

async function doBackup(silent: boolean) {
  const c = await client();
  await cleanupInterrupted(store.settings.backupFolder);
  const user = await transport.user();
  log(`backup start (silent=${silent})`);
  const r = await runBackup(c, {
    root: store.settings.backupFolder,
    appVersion: app.getVersion(),
    includePrices: store.settings.includePrices,
    bars: 5000,
    authToken: user?.authToken ?? null,
    socketFactory: nodeSocketFactory,
    onProgress: (p) => progress({ kind: 'backup', progress: p }),
  });
  const at = new Date().toISOString();
  await store.update({ lastBackup: { at, ok: r.ok, dir: r.dir }, ...(r.ok ? { lastSuccessAt: at } : {}) });
  log(`backup ${r.ok ? 'ok' : 'FAILED'}: ${r.dir} ${r.error?.message ?? ''} warnings=${r.warnings.length}`);
  if (silent || !win?.isVisible()) notify(r.ok, r.ok ? `${r.layouts}` : (r.error?.message ?? ''));
  return r;
}

function notify(ok: boolean, detail: string) {
  if (!Notification.isSupported()) return;
  const da = store.settings.lang === 'da';
  const title = ok ? (da ? 'Backup gennemført' : 'Backup complete') : da ? 'Backup mislykkedes' : 'Backup failed';
  const body = ok ? (da ? `${detail} layouts er gemt.` : `${detail} layouts saved.`) : (da ? 'Åbn ChartKeeper for at se hvorfor. ' : 'Open ChartKeeper to see why. ') + detail.slice(0, 120);
  const n = new Notification({ title, body });
  n.on('click', showWindow);
  n.show();
}

async function doRestore(req: RestoreRequest) {
  const c = await client();
  const reader = await SnapshotReader.open(req.snapshotDir);
  let mode: Parameters<typeof restoreLayout>[3] = { kind: 'new' };
  if (req.mode === 'replace') {
    const target = (await c.listLayouts()).find((l) => l.uid === req.targetUid);
    if (!target || target.name !== req.confirmedName) throw new TvError('not-found', 'The layout name you typed does not match the layout you chose. Nothing was changed.');
    mode = { kind: 'replace', targetUid: req.targetUid, confirmedByUser: true };
  }
  log(`restore ${req.uid} from ${req.snapshotDir} mode=${req.mode}`);
  const r = await restoreLayout(c, reader, req.uid, mode, {
    root: store.settings.backupFolder,
    journal: new RestoreJournal(path.join(app.getPath('userData'), 'restore-journal.json')),
    buildTime: await transport.buildTime(),
    restoredWord: store.settings.lang === 'da' ? 'gendannet' : 'restored',
    onProgress: (step, name) => progress({ kind: 'restore', step, ...(name === undefined ? {} : { name }) }),
  });
  progress({ kind: 'restore', step: 'verify' });
  const onChart = await countOnChartPage(r.uid);
  // What TradingView itself shows is the real test; the read-back alone only proves what was stored.
  const shownOk = onChart === null || (onChart.drawings === r.check.expected.drawings && onChart.studies >= r.check.expected.studies);
  const check = { ...r.check, ok: r.check.ok && shownOk };
  log(`restore done ${r.uid} ok=${check.ok} missing=${r.check.missingDrawings.length} onChart=${JSON.stringify(onChart)}`);
  return { ...r, check, onChart };
}

async function applyAutostart(enabled: boolean) {
  if (!app.isPackaged) return;
  if (process.platform === 'linux') await setLinuxAutostart(enabled, process.env.APPIMAGE ?? process.execPath);
  else app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

function registerIpc() {
  ipcMain.handle(IPC.getState, () => state());
  ipcMain.handle(IPC.setSettings, async (_e, patch: Partial<Settings>) => {
    const before = store.settings.dailyBackup;
    await store.update({ settings: patch });
    if (patch.dailyBackup !== undefined && patch.dailyBackup !== before) await applyAutostart(patch.dailyBackup);
    updateTray();
    return state();
  });
  ipcMain.handle(IPC.chooseFolder, async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], defaultPath: store.settings.backupFolder });
    if (!r.canceled && r.filePaths[0]) await store.update({ settings: { backupFolder: r.filePaths[0] } });
    return state();
  });
  ipcMain.handle(IPC.signIn, () => exclusive('signin', doSignIn));
  ipcMain.handle(IPC.signOut, async () => {
    await signOut();
    transport.reset();
    username = null;
    return state();
  });
  ipcMain.handle(IPC.backupNow, () => exclusive('backup', () => doBackup(false)));
  ipcMain.handle(IPC.listSnapshots, async () => [
    ...(await listSnapshots(store.settings.backupFolder)).map((s) => ({ ...s, safetyCopy: false })),
    ...(await listSnapshots(path.join(store.settings.backupFolder, 'safety-copies'))).map((s) => ({ ...s, safetyCopy: true })),
  ]);
  ipcMain.handle(IPC.loadLayout, (_e, dir: string, uid: string) => guarded(async () => openLayout(await SnapshotReader.open(dir), uid)));
  ipcMain.handle(IPC.compare, (_e, a: string, b: string) => guarded(async () => compareSnapshots(await SnapshotReader.open(a), await SnapshotReader.open(b))));
  ipcMain.handle(IPC.restoreTargets, () =>
    guarded(async () => {
      const c = await client();
      const list = await c.listLayouts();
      const slots = await c.slots(list.length);
      return { layouts: list.map((l) => ({ uid: l.uid, name: l.name })), ...slots };
    }),
  );
  ipcMain.handle(IPC.restore, (_e, req: RestoreRequest) => exclusive('restore', () => doRestore(req)));
  ipcMain.handle(IPC.restoreTemplates, (_e, dir: string) => exclusive('restore', async () => restoreTemplates(await client(), await SnapshotReader.open(dir))));
  ipcMain.handle(IPC.openFolder, async (_e, dir: string) => {
    await shell.openPath(dir);
  });
  ipcMain.handle(IPC.openOnTradingView, async (_e, url: string) => {
    if (new URL(url).hostname === 'www.tradingview.com') await shell.openExternal(url);
  });
}

function iconPath() {
  return path.join(__dirname, 'icon.png');
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win!.show();
  win!.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: 'ChartKeeper',
    icon: iconPath(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!startHidden) win?.show();
  });
  win.on('close', (e) => {
    if (!quitting && store.settings.dailyBackup) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function updateTray() {
  if (!tray) return;
  const da = store.settings.lang === 'da';
  tray.setToolTip(busy === 'backup' ? (da ? 'ChartKeeper tager backup…' : 'ChartKeeper is backing up…') : 'ChartKeeper');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: da ? 'Åbn ChartKeeper' : 'Open ChartKeeper', click: showWindow },
      { label: da ? 'Tag backup nu' : 'Back up now', enabled: !busy, click: () => void exclusive('backup', () => doBackup(true)) },
      { type: 'separator' },
      {
        label: da ? 'Afslut' : 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

async function scheduledCheck() {
  const s = store.settings;
  if (!s.dailyBackup || busy) return;
  const now = new Date();
  const lastSuccess = store.lastSuccessAt ? new Date(store.lastSuccessAt) : null;
  const lastAttempt = store.lastBackup ? new Date(store.lastBackup.at) : null;
  if (!isBackupDue(now, s.dailyHour, lastSuccess, lastAttempt)) return;
  if (!(await hasSessionCookie())) {
    const today = now.toISOString().slice(0, 10);
    if (store.signInNoticeDay !== today) {
      await store.update({ signInNoticeDay: today });
      notifySignIn();
    }
    return;
  }
  const r = await exclusive('backup', () => doBackup(true));
  if (!r.ok) {
    await store.update({ lastBackup: { at: now.toISOString(), ok: false, dir: '' } });
    if (r.error.kind === 'not-signed-in') notifySignIn();
    else notify(false, r.error.message);
  }
}

function notifySignIn() {
  if (!Notification.isSupported()) return;
  const da = store.settings.lang === 'da';
  const n = new Notification({
    title: da ? 'ChartKeeper kan ikke tage backup' : "ChartKeeper can't take today's backup",
    body: da ? 'Du er ikke længere logget ind på TradingView. Åbn ChartKeeper, og log ind igen.' : 'You are no longer signed in to TradingView. Open ChartKeeper and sign in again.',
  });
  n.on('click', showWindow);
  n.show();
}

async function main() {
  if (!app.requestSingleInstanceLock()) return app.quit();
  app.on('second-instance', showWindow);
  await app.whenReady();
  await lockDown(app.getPath('userData'));
  store = await Store.open(path.join(app.getPath('userData'), 'settings.json'), defaultSettings(app.getPath('documents'), app.getLocale()));
  tvSession();
  registerIpc();
  createWindow();
  tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 18, height: 18 }));
  tray.on('click', showWindow);
  updateTray();
  setInterval(() => void scheduledCheck(), 15 * 60_000);
  setTimeout(() => void scheduledCheck(), 60_000);
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    transport.close();
  });
  app.on('window-all-closed', () => {
    if (!store.settings.dailyBackup) app.quit();
  });
  log(`started v${app.getVersion()} on ${os.platform()} ${os.release()}${startHidden ? ' (hidden)' : ''}`);
}

void main();
