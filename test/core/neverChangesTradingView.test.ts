/**
 * The promise ChartKeeper makes to its user: backing up and restoring never
 * changes or deletes anything that already exists on TradingView. A restore
 * only adds a new layout, and templates and themes are only added under
 * names the account does not have.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { runBackup } from '../../src/core/backup';
import { restoreLayout, RestoreJournal, restoreTemplates } from '../../src/core/restore';
import { listSnapshots, SnapshotReader } from '../../src/core/snapshot';
import { TvClient } from '../../src/core/tv/client';
import { PoliteHttp } from '../../src/core/tv/http';
import { writeRefusal } from '../../src/core/tv/writePolicy';
import { fakeDataSocket } from '../fakes/fakeDataSocket';
import { FakeTradingView } from '../fakes/fakeTradingView';
import { referenceInAccount } from '../fakes/fixtures';

const fast = { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} };
const clientOf = (tv: FakeTradingView) => new TvClient(new PoliteHttp(tv, fast), tv.account!);

async function backUp(tv: FakeTradingView): Promise<SnapshotReader> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chartkeeper-'));
  const r = await runBackup(clientOf(tv), { root, appVersion: 'test', includePrices: false, bars: 0, authToken: null, socketFactory: fakeDataSocket().factory, pauseMs: 0 });
  expect(r).toMatchObject({ ok: true });
  return SnapshotReader.open((await listSnapshots(root))[0]!.dir);
}

/** An account with layouts (drawings in the drawing storage too), templates and themes. */
function account(): FakeTradingView {
  const tv = new FakeTradingView().add(referenceInAccount('AbCd1234', 'Min AAPL')).add({ ...referenceInAccount('Wk000001', 'AAPL weekly'), id: 502 });
  const empty = referenceInAccount('Empty001', 'Empty');
  for (const pane of empty.content.charts[0]!.panes) pane.sources = pane.sources.filter((s) => !String(s.type).startsWith('LineTool'));
  tv.add({ ...empty, id: 503, storage: {} });
  tv.studyTemplates.push({ id: 8, name: 'Trend set', content: { panes: [] }, meta_info: { indicators: [{ id: 'EMA', description: 'EMA' }] } });
  tv.drawingTemplates.LineToolHorzLine = { Support: { linecolor: '#2962ff' } };
  tv.themes.Paper = { content: { 'paneProperties.background': '#fffdf5' } };
  return tv;
}

/** Another account whose templates and themes reuse the names above, in the same and in another case, with other content. */
function sameNamesOtherContent(): FakeTradingView {
  const tv = new FakeTradingView();
  tv.studyTemplates = [
    { id: 1, name: 'My RSI setup', content: { panes: [] }, meta_info: { indicators: [{ id: 'MACD', description: 'other' }] } },
    { id: 2, name: 'TREND SET', content: { panes: [] }, meta_info: { indicators: [] } },
    { id: 3, name: 'Brand new study', content: { panes: [] }, meta_info: { indicators: [] } },
  ];
  tv.drawingTemplates = { LineToolTrendLine: { 'thick orange': { linecolor: '#000000' }, 'New line': { linecolor: '#00ff00' } }, LineToolHorzLine: { Support: { linecolor: '#ff0000' } } };
  tv.themes = { 'MY DARK': { content: { 'paneProperties.background': '#ffffff' } }, Paper: { content: {} }, Fresh: { content: {} } };
  return tv;
}

const state = (tv: FakeTradingView) =>
  structuredClone({ layouts: Object.fromEntries(tv.layouts), studyTemplates: tv.studyTemplates, drawingTemplates: tv.drawingTemplates, themes: tv.themes, scripts: tv.scripts });

it('never changes or deletes anything that already exists on TradingView', async () => {
  const tv = account();
  const otherSnapshot = await backUp(sameNamesOtherContent());
  const before = state(tv);
  const client = clientOf(tv);

  const snapshot = await backUp(tv);
  const journal = new RestoreJournal(path.join(snapshot.dir, '..', 'restore-journal.json'));
  for (const l of snapshot.manifest.layouts) await restoreLayout(client, snapshot, l.uid, { journal });
  await restoreLayout(client, snapshot, 'AbCd1234', { journal });

  tv.failOn = (req) => {
    if (req.method !== 'POST') return null;
    tv.failOn = null;
    void tv.send(req);
    return { status: 502, contentType: 'text/html', body: 'gateway timeout' };
  };
  await expect(restoreLayout(client, snapshot, 'Wk000001', { journal })).rejects.toThrow();
  await expect(restoreLayout(client, snapshot, 'Wk000001', { journal })).resolves.toMatchObject({ resumed: true });

  // The account's own backup goes first: after the other one it would put back what an overwrite changed.
  const ownTemplates = await restoreTemplates(client, snapshot);
  const templates = await restoreTemplates(client, otherSnapshot);

  const after = state(tv);
  for (const [uid, layout] of Object.entries(before.layouts)) expect(after.layouts[uid], `layout "${layout.name}" with its drawings`).toEqual(layout);
  for (const t of before.studyTemplates) expect(after.studyTemplates.find((a) => a.id === t.id), `indicator template "${t.name}"`).toEqual(t);
  for (const [tool, byName] of Object.entries(before.drawingTemplates))
    for (const [name, content] of Object.entries(byName)) expect(after.drawingTemplates[tool]?.[name], `drawing template "${name}"`).toEqual(content);
  for (const [name, content] of Object.entries(before.themes)) expect(after.themes[name], `theme "${name}"`).toEqual(content);
  expect(after.scripts).toEqual(before.scripts);

  const added = Object.keys(after.layouts).filter((uid) => !(uid in before.layouts));
  expect(added, 'one new layout per restore: three, the second restore and the resumed one').toHaveLength(5);
  expect(templates.skipped.map((t) => t.name).sort()).toEqual(['MY DARK', 'My RSI setup', 'Paper', 'Support', 'TREND SET', 'thick orange']);
  expect(templates.added.map((t) => t.name).sort()).toEqual(['Brand new study', 'Fresh', 'New line']);
  expect(ownTemplates.added).toEqual([]);
  const writes = tv.requests.filter((r) => r.method !== 'GET');
  expect(writes.map((r) => ({ write: `${r.method} ${r.url}`, refused: writeRefusal(r) })).filter((w) => w.refused)).toEqual([]);
});
