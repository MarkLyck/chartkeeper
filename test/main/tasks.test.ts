import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TvClient } from '../../src/core/tv/client';
import { TvError } from '../../src/core/tv/errors';
import { PoliteHttp } from '../../src/core/tv/http';
import type { TvAccount } from '../../src/main/account';
import { AppStatus } from '../../src/main/appState';
import type { Shell } from '../../src/main/shell';
import { Store } from '../../src/main/store';
import { Tasks } from '../../src/main/tasks';
import type { ProgressEvent } from '../../src/shared/api';
import { FakeTradingView } from '../fakes/fakeTradingView';
import { referenceInAccount } from '../fakes/fixtures';

const env = vi.hoisted(() => ({ userData: '', cookie: true }));
vi.mock('electron', () => ({ app: { getVersion: () => 'test', getPath: () => env.userData } }));
vi.mock('../../src/main/tvSession', () => ({ hasSessionCookie: async () => env.cookie, countOnChartPage: async () => null }));

const fast = { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} };
let tv: FakeTradingView;
let store: Store;
let status: AppStatus;
let signedIn: boolean;
let visible: boolean;
let notices: unknown[];
let progress: ProgressEvent[];
let tasks: Tasks;

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-tasks-'));
  env.userData = path.join(dir, 'userData');
  env.cookie = true;
  store = await Store.open(path.join(dir, 'settings.json'), { backupFolder: path.join(dir, 'backups'), dailyBackup: true, dailyHour: 18, includePrices: false });
  tv = new FakeTradingView().add(referenceInAccount());
  signedIn = true;
  visible = false;
  notices = [];
  progress = [];
  const account = {
    username: null,
    transport: { buildTime: async () => 'build-1' },
    client: async () => {
      if (!signedIn) throw new TvError('not-signed-in', 'TradingView does not recognise the saved sign-in any more.');
      return new TvClient(new PoliteHttp(tv, fast), tv.account!);
    },
  } as unknown as TvAccount;
  const shell = {
    get visible() {
      return visible;
    },
    progress: (e: ProgressEvent) => progress.push(e),
    notifyBackup: (r: unknown) => notices.push(r),
    notifySignIn: () => notices.push('sign in'),
  } as unknown as Shell;
  status = new AppStatus(store, account, () => undefined);
  tasks = new Tasks(status, shell);
});

describe('reporting a backup', () => {
  it('records a success and tells a hidden window', async () => {
    const r = await tasks.backup(true);
    expect(r).toMatchObject({ ok: true, value: { ok: true, layouts: 1 } });
    expect(store.lastBackup).toMatchObject({ ok: true, dir: expect.stringContaining('snapshots') });
    expect(store.lastSuccessAt).toBe(store.lastBackup!.at);
    expect(notices).toEqual([{ ok: true, layouts: 1 }]);
  });

  it('records a backup that stopped partway, with its INCOMPLETE folder', async () => {
    tv.storageIgnoresCookies = true;
    await tasks.backup(true);
    expect(store.lastBackup).toMatchObject({ ok: false, dir: expect.stringMatching(/-INCOMPLETE$/) });
    expect(store.lastSuccessAt).toBeNull();
    expect(notices).toEqual([{ ok: false, message: expect.stringMatching(/has 8 drawings but sent 0/) }]);
  });

  it('records a backup that could not start, and asks to sign in again', async () => {
    signedIn = false;
    const r = await tasks.backup(true);
    expect(r).toMatchObject({ ok: false, error: { kind: 'not-signed-in' } });
    expect(store.lastBackup).toMatchObject({ ok: false, dir: '' });
    expect(notices).toEqual(['sign in']);
  });

  it('shows no notification for a backup started in the open window', async () => {
    visible = true;
    await tasks.backup(false);
    expect(store.lastBackup).toMatchObject({ ok: true });
    expect(notices).toEqual([]);
  });

  it('does not record a second backup refused while one runs', async () => {
    const [first, second] = await Promise.all([tasks.backup(true), tasks.backup(true)]);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: { kind: 'busy' } });
    expect(notices).toHaveLength(1);
  });
});

describe('the daily schedule', () => {
  it('still runs the daily backup after a failed manual backup', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 17, 18, 30));
      signedIn = false;
      await tasks.backup(false);
      expect(store.lastBackup).toMatchObject({ ok: false });
      signedIn = true;
      vi.setSystemTime(new Date(2026, 9, 17, 18, 45));
      await tasks.scheduledCheck();
      expect(store.lastBackup).toMatchObject({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits three hours after its own failed attempt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 17, 18, 30));
      signedIn = false;
      await tasks.scheduledCheck();
      const failedAt = store.lastBackup!.at;
      signedIn = true;
      vi.setSystemTime(new Date(2026, 9, 17, 19, 30));
      await tasks.scheduledCheck();
      expect(store.lastBackup!.at).toBe(failedAt);
      vi.setSystemTime(new Date(2026, 9, 17, 21, 31));
      await tasks.scheduledCheck();
      expect(store.lastBackup).toMatchObject({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks a signed-out user to sign in once a day, not at every check', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      env.cookie = false;
      vi.setSystemTime(new Date(2026, 9, 17, 18, 30));
      await tasks.scheduledCheck();
      vi.setSystemTime(new Date(2026, 9, 17, 18, 45));
      await tasks.scheduledCheck();
      expect(notices).toEqual(['sign in']);
      expect(store.lastBackup).toBeNull();
      vi.setSystemTime(new Date(2026, 9, 18, 18, 30));
      await tasks.scheduledCheck();
      expect(notices).toEqual(['sign in', 'sign in']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when the daily backup is off, or while another task runs', async () => {
    await store.update({ settings: { dailyBackup: false } });
    await tasks.scheduledCheck();
    expect(tv.requests).toEqual([]);
    await store.update({ settings: { dailyBackup: true } });
    let finish!: () => void;
    const restore = status.exclusive('restore', () => new Promise<void>((r) => (finish = r)));
    await tasks.scheduledCheck();
    finish();
    await restore;
    expect(tv.requests).toEqual([]);
    expect(store.lastBackup).toBeNull();
    // A refused run must not count as an attempt, or the daily backup would wait three more hours.
    expect(store.lastScheduledAttemptAt).toBeNull();
  });
});

describe('backup and restore through the app', () => {
  const snapshotDir = async () => {
    const r = await tasks.backup(false);
    if (!r.ok || !r.value.ok) throw new Error('backup failed');
    return r.value.dir;
  };

  it('shows backup progress in the window from the first step to the last', async () => {
    await tasks.backup(false);
    const steps = progress.map((e) => (e.kind === 'backup' ? e.progress.step : null));
    expect(steps[0]).toBe('list');
    expect(steps.at(-1)).toBe('finish');
    expect(steps).not.toContain(null);
  });

  it('restores a layout as a new one, shows each step, and records it as finished', async () => {
    const dir = await snapshotDir();
    progress = [];
    const r = await tasks.restore({ snapshotDir: dir, uid: 'AbCd1234', mode: 'new' });
    expect(r).toMatchObject({ ok: true, value: { resumed: false, check: { verdict: 'shown-unchecked' } } });
    expect(tv.layouts.size).toBe(2);
    expect(progress.map((e) => (e.kind === 'restore' ? e.step : null))).toEqual(['check', 'create', 'verify']);
    const journal = JSON.parse(await fs.readFile(path.join(env.userData, 'restore-journal.json'), 'utf8'));
    expect(journal).toEqual([expect.objectContaining({ createdUid: r.ok && r.value.uid, finished: true })]);
  });

  it('replaces a layout, sending the page build time with the drawing changes', async () => {
    const dir = await snapshotDir();
    tv.add(referenceInAccount('Target01', 'Old layout'));
    const r = await tasks.restore({ snapshotDir: dir, uid: 'AbCd1234', mode: 'replace', targetUid: 'Target01', confirmedName: 'Old layout' });
    expect(r).toMatchObject({ ok: true, value: { uid: 'Target01', safetyBackup: expect.stringContaining('safety-copies') } });
    const puts = tv.requests.filter((q) => q.method === 'PUT');
    expect(puts.length).toBeGreaterThan(0);
    expect(puts.every((q) => q.headers?.['X-BUILD-TIME'] === 'build-1')).toBe(true);
  });

  it('refuses a restore while a backup runs, before contacting TradingView', async () => {
    const dir = await snapshotDir();
    tv.requests.length = 0;
    let finish!: () => void;
    const backup = status.exclusive('backup', () => new Promise<void>((r) => (finish = r)));
    expect(await tasks.restore({ snapshotDir: dir, uid: 'AbCd1234', mode: 'new' })).toMatchObject({ ok: false, error: { kind: 'busy' } });
    expect(await tasks.restoreTemplates(dir)).toMatchObject({ ok: false, error: { kind: 'busy' } });
    finish();
    await backup;
    expect(tv.requests).toEqual([]);
  });

  it('adds the templates an account is missing from a backup', async () => {
    const dir = await snapshotDir();
    tv.themes = {};
    expect(await tasks.restoreTemplates(dir)).toMatchObject({ ok: true, value: { added: [{ kind: 'theme', name: 'My dark' }] } });
    expect(Object.keys(tv.themes)).toEqual(['My dark']);
  });
});
