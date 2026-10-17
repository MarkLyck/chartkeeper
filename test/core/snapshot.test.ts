import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupInterrupted, listSnapshots, renameWithRetry, SnapshotReader, SnapshotWriter, snapshotStamp, writePrivate } from '../../src/core/snapshot';

const body = { app: { name: 'ChartKeeper', version: 't' }, createdAt: '2026-10-17T10:00:00Z', account: { username: 'u', plan: null }, layouts: [], extras: { studyTemplates: 0, drawingTemplates: 0, themes: 0, scripts: 0, userDrawings: 0 }, warnings: [] };

describe('snapshot folders', () => {
  it('refuses two files whose names only differ in case, which would overwrite each other on Windows and macOS', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const w = await SnapshotWriter.begin(root);
    await w.writeText('scripts/RSI Divergence.pine', 'a');
    await expect(w.writeText('scripts/rsi divergence.pine', 'b')).rejects.toThrow(/share one name/);
  });

  it('reads every file back before calling a backup complete', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const w = await SnapshotWriter.begin(root);
    await w.writeText('a.json', '{"a":1}');
    await fs.writeFile(path.join(w.workDir, 'a.json'), '{"a":2}');
    await expect(w.finish(body)).rejects.toThrow(/did not save correctly/);
  });

  it('lets overlapping writes of one file all succeed', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const file = path.join(dir, 'settings.json');
    await Promise.all(Array.from({ length: 50 }, (_, i) => writePrivate(file, String(i))));
    expect(Number(await fs.readFile(file, 'utf8'))).toBeGreaterThanOrEqual(0);
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('uses a timestamp that is a valid folder name on Windows, macOS and Linux', () => {
    expect(snapshotStamp(new Date(2026, 9, 17, 9, 5, 3))).toBe('2026-10-17_09-05-03');
  });

  it('only shows a finished snapshot under its final name, newest first', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const w1 = await SnapshotWriter.begin(root, new Date(2026, 0, 1));
    await w1.writeJson('a.json', { x: 1 });
    expect(await listSnapshots(root)).toEqual([]);
    await w1.finish(body);
    const w2 = await SnapshotWriter.begin(root, new Date(2026, 0, 2));
    await w2.fail(body, 'boom');
    const list = await listSnapshots(root);
    expect(list.map((s) => [s.name, s.manifest?.status])).toEqual([['2026-01-02_00-00-00-INCOMPLETE', 'incomplete'], ['2026-01-01_00-00-00', 'complete']]);
  });

  it('detects a file changed after the backup', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const w = await SnapshotWriter.begin(root);
    await w.writeJson('layouts/x/layout.json', { a: 1 });
    const dir = await w.finish(body);
    const r = await SnapshotReader.open(dir);
    expect(await r.verify()).toEqual([]);
    await fs.writeFile(path.join(dir, 'layouts/x/layout.json'), '{"a":2}');
    expect(await r.verify()).toEqual(['layouts/x/layout.json']);
  });

  it('writes files readable only by the owner (macOS and Linux)', async () => {
    if (process.platform === 'win32') return;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const w = await SnapshotWriter.begin(root);
    await w.writeJson('a.json', {});
    const dir = await w.finish(body);
    expect((await fs.stat(path.join(dir, 'a.json'))).mode & 0o777).toBe(0o600);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
  });

  it('keeps the work folder of a run that crashed, marked INCOMPLETE', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const w = await SnapshotWriter.begin(root, new Date(2026, 0, 3));
    await w.writeJson('layouts/x/layout.json', { a: 1 });
    expect(await cleanupInterrupted(root)).toBe(1);
    const list = await listSnapshots(root);
    expect(list.map((s) => [s.name, s.manifest])).toEqual([['2026-01-03_00-00-00-INCOMPLETE', null]]);
    expect(list[0]!.problem).toMatch(/cannot be read/);
  });

  it('retries a rename that Windows briefly refuses', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    await fs.writeFile(path.join(root, 'a'), 'x');
    let refusals = 0;
    const realRename = fs.rename;
    (fs as { rename: typeof fs.rename }).rename = async (a, b) => {
      if (refusals++ < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return realRename(a, b);
    };
    try {
      await renameWithRetry(path.join(root, 'a'), path.join(root, 'b'), async () => {});
    } finally {
      (fs as { rename: typeof fs.rename }).rename = realRename;
    }
    expect(await fs.readFile(path.join(root, 'b'), 'utf8')).toBe('x');
  });

  it('does not wait before failing a rename for a reason other than a lock', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    let waits = 0;
    await expect(renameWithRetry(path.join(root, 'missing'), path.join(root, 'b'), async () => void waits++)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(waits).toBe(0);
  });

  it('gives up on a rename that stays locked, after waiting long enough for a virus scan', async () => {
    const realRename = fs.rename;
    (fs as { rename: typeof fs.rename }).rename = async () => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    };
    const waited: number[] = [];
    try {
      await expect(renameWithRetry('a', 'b', async (ms) => void waited.push(ms))).rejects.toMatchObject({ code: 'EPERM' });
    } finally {
      (fs as { rename: typeof fs.rename }).rename = realRename;
    }
    const total = waited.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(10_000);
    expect(total).toBeLessThanOrEqual(20_000);
    expect(Math.max(...waited)).toBeLessThanOrEqual(2000);
  });

  it('removes a crashed work folder when its INCOMPLETE copy is already there', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const failed = await SnapshotWriter.begin(root, new Date(2026, 0, 4));
    const incomplete = await failed.fail(body, 'boom');
    const crashed = await SnapshotWriter.begin(root, new Date(2026, 0, 4));
    await crashed.writeJson('x.json', {});
    expect(await cleanupInterrupted(root)).toBe(1);
    expect(await fs.readdir(path.dirname(incomplete))).toEqual([path.basename(incomplete)]);
    expect((await listSnapshots(root))[0]!.manifest).toMatchObject({ status: 'incomplete', error: 'boom' });
  });

  it('lists only snapshot folders, ignoring stray files such as .DS_Store', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    expect(await listSnapshots(root)).toEqual([]);
    const dir = await (await SnapshotWriter.begin(root, new Date(2026, 0, 5))).finish(body);
    await fs.writeFile(path.join(root, 'snapshots', '.DS_Store'), '');
    expect((await listSnapshots(root)).map((s) => s.dir)).toEqual([dir]);
  });

  it('reports a missing file and refuses a layout the backup does not have', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const w = await SnapshotWriter.begin(root);
    await w.writeJson('templates/themes.json', { themes: {} });
    const dir = await w.finish(body);
    const r = await SnapshotReader.open(dir);
    await fs.rm(path.join(dir, 'templates/themes.json'));
    expect(await r.verify()).toEqual(['templates/themes.json']);
    expect(() => r.layout('Nope')).toThrow(/Layout Nope is not in this backup/);
  });

  it('reads damaged extras as absent, so the layouts can still be opened', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-'));
    const w = await SnapshotWriter.begin(root);
    await w.writeText('templates/themes.json', '{"themes": broken');
    await w.writeJson('user-drawings.json', { sources: 'not a map' });
    await w.writeJson('scripts/index.json', { scripts: [] });
    const r = await SnapshotReader.open(await w.finish(body));
    expect(await r.themes()).toBeNull();
    expect(await r.userDrawings()).toBeNull();
    expect(await r.scriptsIndex()).toEqual({ scripts: [] });
  });
});
