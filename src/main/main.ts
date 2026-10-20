import { app, session } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { TvAccount } from './account';
import { AppStatus } from './appState';
import { loadFakeTradingView } from './fakeTradingView';
import { applyAutostart, registerIpc } from './ipc';
import { log } from './log';
import { DAILY_CHECK } from './schedule';
import { Shell } from './shell';
import { SIGNIN_PARTITION } from './signIn';
import { defaultSettings, lockDown, Store } from './store';
import { Tasks } from './tasks';
import { tvSession } from './tvSession';
import { Updater } from './update';
import { updateSource } from './updateSource';

if (process.env.CHARTKEEPER_USER_DATA) app.setPath('userData', process.env.CHARTKEEPER_USER_DATA);
/** Long enough for the window to be up first; the check only shows something when a newer version exists. */
const UPDATE_CHECK_DELAY_MS = 3000;
const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin === true;

async function main() {
  if (!app.requestSingleInstanceLock()) return app.quit();
  let shellReady: Shell | null = null;
  // Registered before startup finishes, so a second launch during startup still brings the window up.
  app.on('second-instance', () => shellReady?.show());
  // Windows only shows notifications for the id the installer's shortcuts carry.
  if (process.platform === 'win32') app.setAppUserModelId('dk.chartkeeper.app');
  const fake = loadFakeTradingView();
  await app.whenReady();
  await lockDown(app.getPath('userData'));
  const store = await Store.open(path.join(app.getPath('userData'), 'settings.json'), defaultSettings(app.getPath('documents')));
  const account = new TvAccount(fake?.rate);
  const status = new AppStatus(store, account, () => void shell.pushState());
  const shell = new Shell(status, startHidden, () => void tasks.backup(true));
  const tasks = new Tasks(status, shell, fake?.socketFactory);
  const source = updateSource();
  const updater = source && new Updater(source, status, log);

  shellReady = shell;
  tvSession();
  await fake?.intercept({ tradingView: tvSession(), signIn: session.fromPartition(SIGNIN_PARTITION) });
  registerIpc({ status, tasks, shell, updater, safari: fake?.safari });
  // The AppImage's path changes with each version, so the autostart entry is refreshed on every start.
  if (process.platform === 'linux' && store.settings.dailyBackup) void applyAutostart(true);
  shell.start();
  const schedule = fake?.schedule ?? DAILY_CHECK;
  setInterval(() => void tasks.scheduledCheck(), schedule.everyMs);
  setTimeout(() => void tasks.scheduledCheck(), schedule.firstCheckMs);
  if (updater) setTimeout(() => void updater.check(), UPDATE_CHECK_DELAY_MS);
  app.on('activate', () => shell.show());
  app.on('before-quit', () => {
    shell.prepareToQuit();
    account.transport.close();
  });
  app.on('window-all-closed', () => {
    if (!store.settings.dailyBackup) app.quit();
  });
  log(`started v${app.getVersion()} on ${os.platform()} ${os.release()}${startHidden ? ' (hidden)' : ''}`);
}

void main();
