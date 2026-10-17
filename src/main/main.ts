import { app } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { TvAccount } from './account';
import { AppStatus } from './appState';
import { registerIpc } from './ipc';
import { log } from './log';
import { Shell } from './shell';
import { defaultSettings, lockDown, Store } from './store';
import { Tasks } from './tasks';
import { tvSession } from './tvSession';

if (process.env.CHARTKEEPER_USER_DATA) app.setPath('userData', process.env.CHARTKEEPER_USER_DATA);
const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin === true;

async function main() {
  if (!app.requestSingleInstanceLock()) return app.quit();
  await app.whenReady();
  await lockDown(app.getPath('userData'));
  const store = await Store.open(path.join(app.getPath('userData'), 'settings.json'), defaultSettings(app.getPath('documents'), app.getLocale()));
  const account = new TvAccount();
  const status = new AppStatus(store, account, () => void shell.pushState());
  const shell = new Shell(status, startHidden, () => void tasks.backup(true));
  const tasks = new Tasks(status, shell);

  app.on('second-instance', () => shell.show());
  tvSession();
  registerIpc({ status, tasks, shell });
  shell.start();
  setInterval(() => void tasks.scheduledCheck(), 15 * 60_000);
  setTimeout(() => void tasks.scheduledCheck(), 60_000);
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
