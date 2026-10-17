import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TvError } from '../../src/core/tv/errors';
import type { TvAccount } from '../../src/main/account';
import { AppStatus, guarded, type Task } from '../../src/main/appState';
import { SignInCancelled } from '../../src/main/browserSignIn';
import { Store } from '../../src/main/store';

const cookie = vi.hoisted(() => ({ present: true }));
vi.mock('electron', () => ({ app: { getVersion: () => '9.9.9', getPath: () => os.tmpdir() } }));
vi.mock('../../src/main/tvSession', () => ({ hasSessionCookie: async () => cookie.present }));
vi.mock('../../src/main/log', () => ({ log: () => undefined }));

let status: AppStatus;
let busyWhenChanged: (Task | null)[];

beforeEach(async () => {
  cookie.present = true;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-state-'));
  const store = await Store.open(path.join(dir, 'settings.json'), { backupFolder: dir, dailyBackup: false, dailyHour: 18, includePrices: true });
  busyWhenChanged = [];
  status = new AppStatus(store, { username: 'trader' } as TvAccount, () => busyWhenChanged.push(status.busy));
});

describe('errors the window can explain', () => {
  it('passes on the kind, message and wording values of a TradingView error', async () => {
    const r = await guarded(async () => {
      throw new TvError('limit-reached', 'No free slot.', 'detail for the log', { limit: 1, plan: 'free' });
    });
    expect(r).toEqual({ ok: false, error: { kind: 'limit-reached', message: 'No free slot.', params: { limit: 1, plan: 'free' } } });
  });

  it('calls a closed sign-in browser "cancelled", not an error', async () => {
    expect(await guarded(async () => Promise.reject(new SignInCancelled()))).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
  });

  it('calls anything else "unexpected", with its message', async () => {
    expect(await guarded(async () => Promise.reject(new RangeError('bad index')))).toEqual({ ok: false, error: { kind: 'unexpected', message: 'bad index', params: {} } });
    expect(await guarded(async () => Promise.reject('plain text'))).toMatchObject({ ok: false, error: { kind: 'unexpected', message: 'plain text' } });
  });

  it('returns the value of a task that worked', async () => {
    expect(await guarded(async () => 42)).toEqual({ ok: true, value: 42 });
  });
});

describe('one task at a time', () => {
  it('refuses a second task while one runs, and names the one running', async () => {
    let finish!: () => void;
    const first = status.exclusive('backup', () => new Promise<string>((r) => (finish = () => r('done'))));
    expect(await status.exclusive('restore', async () => 'never')).toEqual({ ok: false, error: { kind: 'busy', message: 'ChartKeeper is busy (backup).', params: { task: 'backup' } } });
    finish();
    expect(await first).toEqual({ ok: true, value: 'done' });
    expect(await status.exclusive('restore', async () => 'next')).toEqual({ ok: true, value: 'next' });
  });

  it('tells the window when a task starts and when it ends, even when it fails', async () => {
    await status.exclusive('signin', async () => {
      throw new Error('boom');
    });
    expect(busyWhenChanged).toEqual(['signin', null]);
    expect(status.busy).toBeNull();
  });
});

describe('what the window shows', () => {
  it('shows the account name only while the sign-in cookie is there', async () => {
    expect(await status.read()).toMatchObject({ version: '9.9.9', signedIn: true, username: 'trader', busy: null, lastBackup: null });
    cookie.present = false;
    expect(await status.read()).toMatchObject({ signedIn: false, username: null });
  });
});
