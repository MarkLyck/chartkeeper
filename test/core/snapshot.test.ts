import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupInterrupted, listSnapshots, renameWithRetry, SnapshotReader, SnapshotWriter, snapshotStamp } from '../../src/core/snapshot';

const body = { app: { name: 'ChartKeeper', version: 't' }, createdAt: '2026-10-17T10:00:00Z', account: { username: 'u', plan: null }, layouts: [], extras: { studyTemplates: 0, drawingTemplates: 0, themes: 0, scripts: 0, userDrawings: 0 }, warnings: [] };

describe('snapshot folders', () => {
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
});
