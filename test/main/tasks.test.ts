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
import { FakeTradingView } from '../fakes/fakeTradingView';
import { referenceInAccount } from '../fakes/fixtures';

vi.mock('electron', () => ({ app: { getVersion: () => 'test', getPath: () => os.tmpdir() } }));

const fast = { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} };
let tv: FakeTradingView;
let store: Store;
let signedIn: boolean;
let visible: boolean;
let notices: unknown[];
let tasks: Tasks;

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-tasks-'));
  store = await Store.open(path.join(dir, 'settings.json'), { backupFolder: path.join(dir, 'backups'), dailyBackup: true, dailyHour: 18, includePrices: false, lang: 'en' });
  tv = new FakeTradingView().add(referenceInAccount());
  signedIn = true;
  visible = false;
  notices = [];
  const account = {
    username: null,
    client: async () => {
      if (!signedIn) throw new TvError('not-signed-in', 'TradingView does not recognise the saved sign-in any more.');
      return new TvClient(new PoliteHttp(tv, fast), tv.account!);
    },
  } as unknown as TvAccount;
  const shell = {
    get visible() {
      return visible;
    },
    progress: () => undefined,
    notifyBackup: (r: unknown) => notices.push(r),
    notifySignIn: () => notices.push('sign in'),
  } as unknown as Shell;
  tasks = new Tasks(new AppStatus(store, account, () => undefined), shell);
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
