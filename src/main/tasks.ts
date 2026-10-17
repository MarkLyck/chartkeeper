import { app } from 'electron';
import path from 'node:path';
import { runBackup } from '../core/backup';
import { restoreLayout, RestoreJournal, restoreTemplates, type RestoreMode } from '../core/restore';
import { cleanupInterrupted, SnapshotReader } from '../core/snapshot';
import { nodeSocketFactory } from '../core/tv/datafeed';
import type { BackupOutcome, RestoreOutcome, RestoreRequest, Result, TemplatesOutcome } from '../shared/api';
import type { AppStatus } from './appState';
import { log } from './log';
import { isBackupDue } from './schedule';
import type { Shell } from './shell';
import { countOnChartPage, hasSessionCookie } from './tvSession';

/** Backups and restores: one at a time, with progress in the window and notifications when it is hidden. */
export class Tasks {
  constructor(
    private readonly status: AppStatus,
    private readonly shell: Shell,
  ) {}

  private get store() {
    return this.status.store;
  }

  /** `silent`: started by the schedule or the tray, so the result is also told by a notification. */
  async backup(silent: boolean): Promise<Result<BackupOutcome>> {
    const r = await this.status.exclusive('backup', () => this.runBackup(silent));
    if (r.ok || r.error.kind !== 'busy') await this.reportBackup(r, silent);
    return r;
  }

  private async runBackup(silent: boolean): Promise<BackupOutcome> {
    const client = await this.status.account.client();
    const { settings } = this.store;
    await cleanupInterrupted(settings.backupFolder);
    log(`backup start (silent=${silent})`);
    return runBackup(client, {
      root: settings.backupFolder,
      appVersion: app.getVersion(),
      includePrices: settings.includePrices,
      bars: 5000,
      authToken: client.authToken,
      socketFactory: nodeSocketFactory,
      onProgress: (p) => this.shell.progress({ kind: 'backup', progress: p }),
    });
  }

  /** Every backup attempt ends here, whether it failed before it started or partway through. */
  private async reportBackup(r: Result<BackupOutcome>, silent: boolean): Promise<void> {
    const at = new Date().toISOString();
    const dir = r.ok ? r.value.dir : '';
    const error = !r.ok ? r.error : !r.value.ok ? r.value.error : null;
    await this.store.update({ lastBackup: { at, ok: error === null, dir }, ...(error ? {} : { lastSuccessAt: at }) });
    log(`backup ${error ? 'FAILED' : 'ok'}: ${dir} ${error?.message ?? ''} warnings=${r.ok ? r.value.warnings.length : 0}`);
    if (!silent && this.shell.visible) return;
    if (error?.kind === 'not-signed-in') this.shell.notifySignIn();
    else if (error) this.shell.notifyBackup({ ok: false, message: error.message });
    else if (r.ok) this.shell.notifyBackup({ ok: true, layouts: r.value.layouts });
  }

  /** Runs the daily backup when it is due. Called every 15 minutes. */
  async scheduledCheck(): Promise<void> {
    const s = this.store.settings;
    if (!s.dailyBackup || this.status.busy) return;
    const now = new Date();
    const lastSuccess = this.store.lastSuccessAt ? new Date(this.store.lastSuccessAt) : null;
    // Only the schedule's own attempts count here: a failed manual click doesn't push the daily backup back.
    const lastAttempt = this.store.lastScheduledAttemptAt ? new Date(this.store.lastScheduledAttemptAt) : null;
    if (!isBackupDue(now, s.dailyHour, lastSuccess, lastAttempt)) return;
    if (!(await hasSessionCookie())) {
      const today = now.toISOString().slice(0, 10);
      if (this.store.signInNoticeDay !== today) {
        await this.store.update({ signInNoticeDay: today });
        this.shell.notifySignIn();
      }
      return;
    }
    await this.store.update({ lastScheduledAttemptAt: now.toISOString() });
    await this.backup(true);
  }

  restore(req: RestoreRequest): Promise<Result<RestoreOutcome>> {
    return this.status.exclusive('restore', async () => {
      const client = await this.status.account.client();
      const reader = await SnapshotReader.open(req.snapshotDir);
      const mode: RestoreMode = req.mode === 'replace' ? { kind: 'replace', targetUid: req.targetUid, confirmedName: req.confirmedName } : { kind: 'new' };
      log(`restore ${req.uid} from ${req.snapshotDir} mode=${req.mode}`);
      const r = await restoreLayout(client, reader, req.uid, mode, {
        root: this.store.settings.backupFolder,
        journal: new RestoreJournal(path.join(app.getPath('userData'), 'restore-journal.json')),
        buildTime: await this.status.account.transport.buildTime(),
        countOnPage: countOnChartPage,
        onProgress: (step, name) => this.shell.progress({ kind: 'restore', step, ...(name === undefined ? {} : { name }) }),
      });
      log(`restore done ${r.uid} verdict=${r.check.verdict} missing=${r.check.missingDrawings.length} shown=${JSON.stringify([r.check.drawings.shown, r.check.indicators.shown])}`);
      return r;
    });
  }

  restoreTemplates(snapshotDir: string): Promise<Result<TemplatesOutcome>> {
    return this.status.exclusive('restore', async () => restoreTemplates(await this.status.account.client(), await SnapshotReader.open(snapshotDir)));
  }
}
