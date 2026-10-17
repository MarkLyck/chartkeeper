import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runBackup } from '../../src/core/backup';
import { countLayout } from '../../src/core/layout';
import { SNAPSHOT_FILES, SnapshotReader } from '../../src/core/snapshot';
import { compareSnapshots, openLayout } from '../../src/core/snapshotView';
import { TvClient } from '../../src/core/tv/client';
import { PoliteHttp } from '../../src/core/tv/http';
import { fakeDataSocket } from '../fakes/fakeDataSocket';
import { FakeTradingView } from '../fakes/fakeTradingView';
import { referenceInAccount } from '../fakes/fixtures';

const fast = { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} };
let root: string;
let tv: FakeTradingView;

async function snapshot(day: number): Promise<SnapshotReader> {
  const r = await runBackup(new TvClient(new PoliteHttp(tv, fast), tv.account!), {
    root, appVersion: 'test', includePrices: true, bars: 50, authToken: 'tok', socketFactory: fakeDataSocket().factory, pauseMs: 0, now: new Date(2026, 9, day, 18),
  });
  expect(r.ok).toBe(true);
  return SnapshotReader.open(r.dir);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'chartkeeper-'));
  tv = new FakeTradingView().add(referenceInAccount('AbCd1234', 'Min AAPL'));
});

describe('opening a layout from a snapshot', () => {
  it('shows the drawings synced to all layouts once each, next to the prices', async () => {
    const reader = await snapshot(1);
    const user = (await reader.userDrawings())!;
    const inContent = referenceInAccount().content.charts[0]!.panes[0]!.sources.find((s) => s.type.startsWith('LineTool'))!;
    user.sources[inContent.id] = { id: inContent.id, ownerSource: '_seriesId', state: inContent };
    await fs.writeFile(path.join(reader.dir, SNAPSHOT_FILES.userDrawings), JSON.stringify(user));

    const { layout, data } = await openLayout(reader, 'AbCd1234');
    expect(layout.sharedDrawings.filter((d) => d.origin === 'user').map((d) => d.id)).toEqual(['u1']);
    const counts = countLayout(layout);
    expect(counts.drawings).toBe(12);
    expect(new Set(counts.drawingIds).size).toBe(12);
    expect(data['1']!.bars).toHaveLength(50);
  });
});

describe('comparing two snapshots', () => {
  it('reports layout, template, theme and script changes, and leaves synced drawings out', async () => {
    const older = await snapshot(1);
    const sources = tv.layouts.get('AbCd1234')!.content.charts[0]!.panes[0]!.sources;
    sources.splice(sources.findIndex((s) => s.type === 'LineToolTrendLine'), 1);
    tv.themes['Lys'] = { content: {} };
    tv.studyTemplates = [];
    tv.scripts[0]!.version = '4.0';
    const newer = await snapshot(2);
    const synced = (await newer.userDrawings())!;
    synced.sources.u2 = { ...synced.sources.u1!, id: 'u2' };
    await fs.writeFile(path.join(newer.dir, SNAPSHOT_FILES.userDrawings), JSON.stringify(synced));

    const r = await compareSnapshots(older, newer);
    expect(r.layouts).toHaveLength(1);
    expect(r.layouts[0]).toMatchObject({ uid: 'AbCd1234', status: 'changed' });
    expect(r.layouts[0]!.changes.map((c) => `${c.kind} ${c.subject}`)).toEqual(['removed Trend line']);
    expect(r.other.map((c) => `${c.kind} ${c.subject}: ${c.detail}`).sort()).toEqual([
      'added Theme: Lys',
      'changed Pine script: Thomas Trend',
      'removed Indicator template: My RSI setup',
    ]);
  });

  it('treats a template file missing from the older snapshot as empty', async () => {
    const older = await snapshot(1);
    await fs.rm(path.join(older.dir, SNAPSHOT_FILES.themes));
    const newer = await snapshot(2);
    const r = await compareSnapshots(older, newer);
    expect(r.other).toEqual([{ kind: 'added', subject: 'Theme', detail: 'Thomas dark' }]);
  });
});
