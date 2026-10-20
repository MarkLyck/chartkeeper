import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TvAccount } from '../../src/main/account';
import { AppStatus } from '../../src/main/appState';
import { Store } from '../../src/main/store';
import { failsWithin, nextUpdate, plainNotes, RELEASES_PAGE, stableFirst, Updater, type UpdateSource } from '../../src/main/update';
import type { UpdateHow, UpdateState } from '../../src/shared/api';

vi.mock('electron', () => ({ app: { getVersion: () => '1.0.0-rc.10', getPath: () => os.tmpdir() } }));
vi.mock('../../src/main/tvSession', () => ({ hasSessionCookie: async () => true }));
vi.mock('../../src/main/log', () => ({ log: () => undefined }));

/** An update source whose download waits for `finish()`, so the test can look at the state while it runs. */
function fakeSource(how: UpdateHow, opts: { found?: { version: string; notes: string } | null; checkError?: Error; downloadError?: Error } = {}) {
  let finish!: () => void;
  const source = {
    how,
    downloads: 0,
    installs: 0,
    progress: (_percent: number) => undefined as void,
    finish: () => finish(),
    async check() {
      if (opts.checkError) throw opts.checkError;
      return opts.found === undefined ? { version: '1.0.0-rc.11', notes: 'Faster backups.' } : opts.found;
    },
    async download(onPercent: (percent: number) => void) {
      source.downloads++;
      source.progress = onPercent;
      onPercent(0);
      await new Promise<void>((r) => (finish = r));
      if (opts.downloadError) throw opts.downloadError;
      onPercent(100);
    },
    async install() {
      source.installs++;
    },
  } satisfies UpdateSource & Record<string, unknown>;
  return source;
}

let status: AppStatus;
let pushes: number;
let logged: string[];

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-update-'));
  const store = await Store.open(path.join(dir, 'settings.json'), { backupFolder: dir, dailyBackup: false, dailyHour: 18, includePrices: true });
  pushes = 0;
  logged = [];
  status = new AppStatus(store, { username: 'trader' } as TvAccount, () => pushes++);
});

const updater = (source: UpdateSource) => new Updater(source, status, (line) => logged.push(line));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('looking for a new version when the app opens', () => {
  it('offers the newer release with its notes and the way this computer installs it', async () => {
    await updater(fakeSource('restart')).check();
    expect((await status.read()).update).toEqual({ k: 'available', version: '1.0.0-rc.11', notes: 'Faster backups.', how: 'restart' });
  });

  it('says nothing when this is the newest version', async () => {
    await updater(fakeSource('restart', { found: null })).check();
    expect((await status.read()).update).toEqual({ k: 'none' });
    expect(pushes).toBe(0);
  });

  it('only logs a check that fails, without bothering the user', async () => {
    await updater(fakeSource('installer', { checkError: new Error('net::ERR_INTERNET_DISCONNECTED') })).check();
    expect((await status.read()).update).toEqual({ k: 'none' });
    expect(logged.join('\n')).toContain('net::ERR_INTERNET_DISCONNECTED');
  });
});

describe('Later', () => {
  it('hides the popup and keeps the release, so the top bar can show it again', async () => {
    const u = updater(fakeSource('restart'));
    await u.check();
    u.postpone();
    expect(status.update).toEqual({ k: 'later', version: '1.0.0-rc.11', notes: 'Faster backups.', how: 'restart' });
    u.show();
    expect(status.update).toMatchObject({ k: 'available', version: '1.0.0-rc.11' });
  });

  it('does not start a download from the hidden popup', async () => {
    const source = fakeSource('restart');
    const u = updater(source);
    await u.check();
    u.postpone();
    void u.start();
    await flush();
    expect(source.downloads).toBe(0);
    expect(status.update.k).toBe('later');
  });
});

describe('Update now, on Windows and Linux', () => {
  it('downloads with progress while no other task may start, then installs and restarts', async () => {
    const source = fakeSource('restart');
    const u = updater(source);
    await u.check();
    const run = u.start();
    expect(status.update).toMatchObject({ k: 'downloading', percent: 0, how: 'restart' });
    expect(status.busy).toBe('update');
    source.progress(41.6);
    expect(status.update).toMatchObject({ k: 'downloading', percent: 42 });
    expect(await status.exclusive('backup', async () => 'started')).toMatchObject({ ok: false, error: { kind: 'busy' } });
    expect(source.installs).toBe(0);
    source.finish();
    await run;
    expect(source.installs).toBe(1);
    expect(status.update).toMatchObject({ k: 'downloading', percent: 100 });
  });

  it('tells the window only when the whole percent changes', async () => {
    const source = fakeSource('restart');
    const u = updater(source);
    await u.check();
    void u.start();
    const before = pushes;
    for (let p = 0; p <= 10; p += 0.01) source.progress(p);
    expect(pushes - before).toBe(10);
    source.finish();
  });

  it('refuses while a backup or restore runs, and starts once it is over', async () => {
    const source = fakeSource('restart');
    const u = updater(source);
    await u.check();
    let backupDone!: () => void;
    const backup = status.exclusive('backup', () => new Promise<void>((r) => (backupDone = r)));
    await u.start();
    expect(source.downloads).toBe(0);
    expect(status.update.k).toBe('available');
    backupDone();
    await backup;
    void u.start();
    expect(source.downloads).toBe(1);
    source.finish();
  });

  it('shows why a download failed, keeps the release, and frees the app for other tasks', async () => {
    const source = fakeSource('restart', { downloadError: new Error('sha512 checksum mismatch') });
    const u = updater(source);
    await u.check();
    const run = u.start();
    source.finish();
    await run;
    expect(status.update).toEqual({ k: 'failed', version: '1.0.0-rc.11', notes: 'Faster backups.', how: 'restart', message: 'sha512 checksum mismatch' });
    expect(source.installs).toBe(0);
    expect(status.busy).toBeNull();
    u.postpone();
    expect(status.update.k).toBe('later');
  });
});

describe('Update now, on a Mac', () => {
  it('opens the downloaded installer and waits for the user to replace the app', async () => {
    const source = fakeSource('installer');
    const u = updater(source);
    await u.check();
    const run = u.start();
    expect(status.update).toMatchObject({ k: 'downloading', how: 'installer' });
    source.finish();
    await run;
    expect(source.installs).toBe(1);
    expect(status.update).toEqual({ k: 'installer-open', version: '1.0.0-rc.11', notes: 'Faster backups.', how: 'installer' });
    expect(status.busy).toBeNull();
  });
});

describe('the update states', () => {
  const release = { version: '2.0.0', notes: '', how: 'restart' as const };
  const states: UpdateState[] = [
    { k: 'none' },
    { k: 'available', ...release },
    { k: 'later', ...release },
    { k: 'downloading', percent: 30, ...release },
    { k: 'installer-open', ...release },
    { k: 'failed', message: 'x', ...release },
  ];

  it('keeps a running download on screen: Later and Escape do not hide it', () => {
    const downloading = states[3]!;
    expect(nextUpdate(downloading, { k: 'postpone' })).toBe(downloading);
    expect(nextUpdate(downloading, { k: 'show' })).toBe(downloading);
  });

  it('finds a release only once per launch', () => {
    for (const s of states.slice(1)) expect(nextUpdate(s, { k: 'found', release: { ...release, version: '3.0.0' } })).toBe(s);
  });

  it('ignores progress and results that arrive outside a download', () => {
    for (const s of states.filter((x) => x.k !== 'downloading')) {
      expect(nextUpdate(s, { k: 'progress', percent: 50 })).toBe(s);
      expect(nextUpdate(s, { k: 'installed' })).toBe(s);
      expect(nextUpdate(s, { k: 'failed', message: 'late' })).toBe(s);
    }
  });
});

describe('release notes as plain text', () => {
  it('drops the HTML GitHub sends and decodes its entities', () => {
    expect(plainNotes('<h2>What&#39;s new</h2>\n<ul>\n<li>Backups are <strong>faster</strong> &amp; smaller</li>\n<li>Fixed &lt;Unnamed&gt; layouts</li>\n</ul>')).toBe(
      "What's new\n• Backups are faster & smaller\n• Fixed <Unnamed> layouts",
    );
  });

  it('turns markdown into readable lines', () => {
    expect(plainNotes('## Changes\r\n\r\n\r\n* **Faster** backups\r\n- See [the guide](https://example.com)')).toBe('Changes\n• Faster backups\n• See the guide');
  });

  it('joins notes of several releases and is empty without notes', () => {
    expect(plainNotes([{ version: '1', note: '<p>One</p>' }, { version: '2', note: null }, { version: '3', note: 'Three' }])).toBe('One\nThree');
    expect(plainNotes(null)).toBe('');
    expect(plainNotes(undefined)).toBe('');
  });

  it('cuts very long notes', () => {
    const notes = plainNotes('word '.repeat(1000));
    expect(notes.length).toBeLessThanOrEqual(801);
    expect(notes.endsWith('…')).toBe(true);
  });
});

describe('which release to offer', () => {
  const found = (version: string) => ({ version, notes: '' });

  it('offers a newer stable release before any prerelease, so an rc install moves on to 1.0.0', async () => {
    const asked: boolean[] = [];
    const r = await stableFirst(async (prerelease) => (asked.push(prerelease), prerelease ? found('1.0.0-rc.11') : found('1.0.0')));
    expect(r).toEqual(found('1.0.0'));
    expect(asked).toEqual([false]);
  });

  it('looks at prereleases when there is no newer stable release, or none at all', async () => {
    await expect(stableFirst(async (pre) => (pre ? found('1.0.0-rc.11') : null))).resolves.toEqual(found('1.0.0-rc.11'));
    await expect(stableFirst(async (pre) => { if (!pre) throw new Error('404 releases/latest'); return found('1.0.0-rc.11'); })).resolves.toEqual(found('1.0.0-rc.11'));
    await expect(stableFirst(async () => null)).resolves.toBeNull();
  });

  it('links to the list of releases, since every release so far is a prerelease', () => {
    expect(RELEASES_PAGE).toBe('https://github.com/MarkLyck/chartkeeper/releases');
  });
});

describe('an install that does not quit the app', () => {
  it('fails when the installer reports an error, such as a cancelled password prompt', async () => {
    let fail: (e: Error) => void = () => undefined;
    const run = failsWithin((onError) => (fail = onError), () => setTimeout(() => fail(new Error('pkexec: dismissed')), 10), 5000);
    await expect(run).rejects.toThrow('pkexec: dismissed');
  });

  it('fails when the app is still running long after the install should have quit it', async () => {
    await expect(failsWithin(() => undefined, () => undefined, 50)).rejects.toThrow(/did not start/);
  });
});
