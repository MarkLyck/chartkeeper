import { app, net, shell } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import path from 'node:path';
import { downloadVerified, installerFile } from './download';
import { log } from './log';
import { plainNotes, UPDATE_FEED_ENV, type UpdateSource } from './update';

const GITHUB_DOWNLOADS = 'https://github.com/MarkLyck/chartkeeper/releases/download/';

/**
 * New versions from the GitHub releases, through electron-updater (its own session, never the
 * TradingView one). Null for a development run without a test feed.
 */
export function updateSource(): UpdateSource | null {
  const feed = app.isPackaged ? undefined : process.env[UPDATE_FEED_ENV];
  if (!app.isPackaged && !feed) return null;
  autoUpdater.logger = { info: (m) => log(`updater: ${m}`), warn: (m) => log(`updater warning: ${m}`), error: (m) => log(`updater error: ${m}`) };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = true;
  if (feed) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  }

  let found: UpdateInfo | null = null;
  const check = async () => {
    const r = await autoUpdater.checkForUpdates();
    found = r?.isUpdateAvailable ? r.updateInfo : null;
    return found && { version: found.version, notes: plainNotes(found.releaseNotes) };
  };
  const release = () => {
    if (!found) throw new Error('No new version was found.');
    return found;
  };

  if (process.platform === 'darwin') {
    // Squirrel.Mac refuses an app without a paid developer signature, so the user installs the dmg.
    let dmg: string | null = null;
    return {
      how: 'installer',
      check,
      async download(onPercent) {
        const info = release();
        const tag = (info as UpdateInfo & { tag?: string }).tag ?? `v${info.version}`;
        const file = installerFile(info.files, feed ? feed.replace(/\/?$/, '/') : `${GITHUB_DOWNLOADS}${tag}/`);
        dmg = path.join(app.getPath('downloads'), file.name);
        await downloadVerified(net.fetch, file, dmg, onPercent);
      },
      async install() {
        if (!dmg) throw new Error('The installer was not downloaded.');
        const failure = await shell.openPath(dmg);
        if (failure) throw new Error(`Could not open ${dmg}: ${failure}`);
      },
    };
  }

  return {
    how: 'restart',
    check,
    async download(onPercent) {
      release();
      const progress = (p: ProgressInfo) => onPercent(p.percent);
      autoUpdater.on('download-progress', progress);
      try {
        await autoUpdater.downloadUpdate();
      } finally {
        autoUpdater.off('download-progress', progress);
      }
    },
    async install() {
      autoUpdater.quitAndInstall(true, true);
    },
  };
}
