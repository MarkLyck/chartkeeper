import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runBackup } from '../../src/core/backup';
import { countLayout, parseLayout } from '../../src/core/layout';
import { contentWithDrawings, restoreLayout, RestoreJournal, restoreTemplates, saveForm, symbolFields, type RestoreStep } from '../../src/core/restore';
import { checkRestore } from '../../src/core/restorePolicy';
import { listSnapshots, SNAPSHOT_FILES, SnapshotReader } from '../../src/core/snapshot';
import { TvClient } from '../../src/core/tv/client';
import { drawingSourceFromStored, isDrawingType, type TvContent } from '../../src/core/tv/content';
import { PoliteHttp } from '../../src/core/tv/http';
import { fakeDataSocket } from '../fakes/fakeDataSocket';
import { FakeTradingView, type FakeLayout } from '../fakes/fakeTradingView';
import { referenceInAccount, referenceRecord } from '../fakes/fixtures';

const fast = { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} };
let root: string;
let tv: FakeTradingView;
const client = () => new TvClient(new PoliteHttp(tv, fast), tv.account!);
const backup = (extra: Partial<Parameters<typeof runBackup>[1]> = {}) =>
  runBackup(client(), { root, appVersion: 'test', includePrices: true, bars: 50, authToken: 'tok', socketFactory: fakeDataSocket().factory, pauseMs: 0, ...extra });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'chartkeeper-'));
  tv = new FakeTradingView().add(referenceInAccount('AbCd1234', 'Min AAPL'));
});

/**
 * Two charts whose numeric chartIds are not their positions: chart 2 (AAPL)
 * comes first, chart 1 (MSFT) second. Storage bucket "2" holds the AAPL
 * drawings, bucket "1" one MSFT drawing.
 */
function numericChartIds(): FakeLayout {
  const l = referenceInAccount('Num00001', 'Two charts');
  const aapl = l.content.charts[0]!;
  const msft = structuredClone(aapl);
  aapl.chartId = 2;
  msft.chartId = 1;
  for (const pane of msft.panes) {
    pane.sources = pane.sources.filter((s) => !isDrawingType(s.type));
    for (const s of pane.sources) {
      if (s.type === 'MainSeries') s.state = { ...s.state, symbol: 'NASDAQ:MSFT', shortName: 'MSFT' };
      else s.id += '-msft';
    }
  }
  l.content.charts.push(msft);
  const msftLine = { type: 'LineToolHorzLine', id: 'msft1', ownerSource: '_seriesId', state: { linecolor: '#fff', symbol: 'NASDAQ:MSFT' }, points: [{ time_t: 1780000000, offset: 0, price: 400 }] };
  l.storage = { '2': l.storage['1']!, '1': { msft1: { id: 'msft1', ownerSource: '_seriesId', state: msftLine, symbol: 'NASDAQ:MSFT' } }, _shared: l.storage._shared! };
  return l;
}

const bucketsOf = (l: FakeLayout) => Object.fromEntries(Object.entries(l.storage).map(([k, v]) => [k, { sources: v, drawing_groups: {} }]));
/** TradingView's own count of a layout in the fake account, as the chart page would show it. */
const shownBy = (fake: FakeTradingView) => async (uid: string) => {
  const l = fake.layouts.get(uid)!;
  const counts = countLayout(parseLayout({ ...referenceRecord(), content: l.content, studyMetaInfoMap: l.studyMeta as Record<string, Record<string, unknown>> }, { buckets: bucketsOf(l), reportedTotal: null }));
  return { drawings: counts.drawings, studies: counts.studies };
};
const drawingIdsIn = (content: TvContent, chart: number) => content.charts[chart]!.panes.flatMap((p) => p.sources.filter((s) => isDrawingType(s.type)).map((s) => s.id)).sort();

describe('numeric chartIds', () => {
  it('name each chart by its own chartId and put each bucket on that chart', () => {
    const l = numericChartIds();
    const layout = parseLayout({ ...referenceRecord(), content: l.content }, { buckets: bucketsOf(l), reportedTotal: null });
    expect(layout.charts.map((c) => [c.chartId, c.symbol])).toEqual([['2', 'NASDAQ:AAPL'], ['1', 'NASDAQ:MSFT']]);
    const onChart = (i: number) => layout.charts[i]!.panes.flatMap((p) => p.drawings.map((d) => d.id)).sort();
    expect(onChart(1)).toEqual(['msft1']);
    expect(onChart(0)).toEqual(expect.arrayContaining(Object.keys(l.storage['2']!)));
  });

  it('back up prices under the same chart id as the drawings, and restore each bucket onto its chart', async () => {
    tv = new FakeTradingView().add(numericChartIds());
    const r = await backup();
    expect(r).toMatchObject({ ok: true, drawings: 12 });
    const snap = await SnapshotReader.open((await listSnapshots(root))[0]!.dir);
    expect(Object.keys((await snap.drawings('Num00001')).buckets).sort()).toEqual(['1', '2', '_shared']);
    expect((await snap.chartData('Num00001', '2'))!.symbol).toBe('NASDAQ:AAPL');
    expect((await snap.chartData('Num00001', '1'))!.symbol).toBe('NASDAQ:MSFT');

    const restored = await restoreLayout(client(), snap, 'Num00001', { kind: 'new' }, { root, journal: new RestoreJournal(path.join(root, 'j.json')), buildTime: null, countOnPage: shownBy(tv) });
    expect(restored.check).toMatchObject({ verdict: 'verified', missingDrawings: [], extraDrawings: [] });
    const saved = tv.layouts.get(restored.uid)!.content;
    expect(saved.charts.map((c) => c.chartId)).toEqual([2, 1]);
    expect(drawingIdsIn(saved, 1)).toEqual(['msft1']);
    expect(drawingIdsIn(saved, 0)).toEqual(expect.arrayContaining(Object.keys(numericChartIds().storage['2']!)));
  });
});

describe('backup', () => {
  it('writes a complete snapshot with every drawing, indicator, template and script', async () => {
    const r = await backup();
    expect(r).toEqual({ ok: true, dir: expect.any(String), layouts: 1, drawings: 11, warnings: [] });
    const [snap] = await listSnapshots(root);
    expect(snap!.manifest).toMatchObject({ status: 'complete', account: { username: 'thomas' }, extras: { studyTemplates: 1, drawingTemplates: 1, themes: 1, scripts: 1, userDrawings: 1 } });
    expect(snap!.manifest!.layouts[0]).toMatchObject({ uid: 'AbCd1234', name: 'Min AAPL', drawings: 11, studies: 2, priceData: true, symbols: ['NASDAQ:AAPL'] });
    const reader = await SnapshotReader.open(snap!.dir);
    expect(await reader.verify()).toEqual([]);
    const data = await reader.chartData('AbCd1234', '1');
    expect(data!.bars).toHaveLength(50);
    expect(Object.values(data!.studies).every((s) => s.status === 'ok')).toBe(true);
    expect(await fs.readFile(path.join(snap!.dir, 'scripts/Thomas Trend.pine'), 'utf8')).toContain('indicator("Thomas Trend")');
  });

  it('only reads: it sends no POST or PUT to TradingView', async () => {
    await backup();
    expect(tv.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  });

  it('marks the snapshot INCOMPLETE when only some drawings arrive', async () => {
    tv.failOn = (req) => {
      if (!req.url.includes('/get/layout/') || !req.url.includes('chart_id=_shared')) return null;
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, payload: { sources: {} } }) };
    };
    expect(await backup()).toMatchObject({ ok: false, error: { message: expect.stringMatching(/has 8 drawings but sent 6/) } });
  });

  it('marks the snapshot INCOMPLETE when drawings are reported but not sent', async () => {
    tv.storageIgnoresCookies = true;
    expect(await backup()).toMatchObject({ ok: false, error: { kind: 'format-changed', message: expect.stringMatching(/has 8 drawings but sent 0/) } });
    const [snap] = await listSnapshots(root);
    expect(snap!.name).toMatch(/-INCOMPLETE$/);
    expect(snap!.manifest!.status).toBe('incomplete');
  });

  it('marks the snapshot INCOMPLETE when TradingView changes its answer format', async () => {
    tv.failOn = (req) => (req.url.endsWith('/my-charts/') ? { status: 200, contentType: 'application/json', body: '{"unexpected":true}' } : null);
    expect(await backup()).toMatchObject({ ok: false, error: { message: expect.stringMatching(/does not recognise/) } });
  });

  it('reports an expired sign-in as "please sign in", not as a TradingView change', async () => {
    // A signed-out session gets a redirect to the sign-in page, which the page does not follow.
    tv.failOn = (req) => (req.url.endsWith('/my-charts/') ? { status: 0, contentType: '', body: '' } : null);
    expect(await backup()).toMatchObject({ ok: false, error: { kind: 'not-signed-in' } });
  });

  it('keeps the layout backup when one symbol has no prices, and says so', async () => {
    const r = await backup({ socketFactory: fakeDataSocket({ unknownSymbols: ['NASDAQ:AAPL'] }).factory });
    expect(r.ok).toBe(true);
    expect(r.warnings.join('\n')).toMatch(/prices for NASDAQ:AAPL .* could not be saved/);
    const [snap] = await listSnapshots(root);
    expect(snap!.manifest!.layouts[0]!.priceData).toBe(false);
  });

  it('records indicators TradingView refuses instead of dropping them', async () => {
    const r = await backup({ socketFactory: fakeDataSocket({ failStudies: (id) => (id.startsWith('RSI') ? 'study_limit_exceeded' : null) }).factory });
    expect(r.warnings.join('\n')).toMatch(/could not be calculated/);
    const reader = await SnapshotReader.open((await listSnapshots(root))[0]!.dir);
    const studies = Object.values((await reader.chartData('AbCd1234', '1'))!.studies);
    expect(studies.map((s) => s.status).sort()).toEqual(['error', 'ok']);
  });
});

describe('restore', () => {
  const journal = () => new RestoreJournal(path.join(root, 'restore-journal.json'));
  async function snapshot() {
    await backup();
    return SnapshotReader.open((await listSnapshots(root))[0]!.dir);
  }

  it('puts storage drawings back into the right chart and pane of the content', () => {
    const fake = referenceInAccount();
    const rec = { ...referenceRecord(), content: fake.content };
    const buckets = Object.fromEntries(Object.entries(fake.storage).map(([k, v]) => [k, { sources: v, drawing_groups: {} }]));
    const content = contentWithDrawings(rec, { buckets, reportedTotal: null });
    const counts = countLayout(parseLayout({ ...rec, content }, null));
    expect(counts.drawings).toBe(11);
    expect(rec.content).toEqual(fake.content);
  });

  it('sends the stored content unchanged except for the re-inlined drawings', () => {
    const fake = referenceInAccount();
    const rec = { ...referenceRecord(), content: fake.content };
    const drawings = { buckets: bucketsOf(fake), reportedTotal: null };
    const stored = new Map(Object.values(fake.storage).flatMap((b) => Object.entries(b)).map(([id, dto]) => [id, drawingSourceFromStored(id, dto)]));
    const sent = JSON.parse(saveForm(rec, drawings, 'Kopi').content!) as TvContent;
    expect(sent.name).toBe('Kopi');
    const inlined = sent.charts.flatMap((c) => c.panes.flatMap((p) => p.sources.filter((s) => stored.has(s.id))));
    expect(inlined).toEqual([...stored.values()].filter((s) => inlined.some((i) => i.id === s.id)));
    expect(inlined.map((s) => s.id).sort()).toEqual([...stored.keys()].sort());
    for (const c of sent.charts) for (const p of c.panes) p.sources = p.sources.filter((s) => !stored.has(s.id));
    expect(JSON.stringify(sent)).toBe(JSON.stringify({ ...fake.content, name: 'Kopi' }));
  });

  it('takes symbol fields from the list entry, or else from the price series', () => {
    expect(symbolFields({ ...referenceRecord(), listEntry: { symbol: 'NASDAQ:MSFT', resolution: '60' } })).toMatchObject({ symbol: 'NASDAQ:MSFT', resolution: '60', exchange: 'NASDAQ' });
    expect(symbolFields({ ...referenceRecord(), listEntry: {} })).toMatchObject({ symbol: 'NASDAQ:AAPL', short_name: 'AAPL', exchange: 'NASDAQ', resolution: 'D' });
  });

  it('round trip: back up, restore as a NEW layout, and the copy matches the backup', async () => {
    const snap = await snapshot();
    const before = new Map([...tv.layouts].map(([k, v]) => [k, JSON.stringify(v)]));
    const steps: RestoreStep[] = [];
    const r = await restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, { root, journal: journal(), buildTime: null, now: new Date('2026-10-17T12:00:00Z'), countOnPage: shownBy(tv), onProgress: (s) => steps.push(s) });
    expect(r.uid).not.toBe('AbCd1234');
    expect(r.name).toBe('Min AAPL (restored 2026-10-17)');
    expect(r.check).toMatchObject({
      verdict: 'verified',
      charts: { expected: 1, saved: { count: 1, ok: true } },
      drawings: { expected: 11, saved: { count: 11, ok: true }, shown: { count: 11, ok: true } },
      indicators: { expected: 2, saved: { count: 2, ok: true }, shown: { count: 2, ok: true } },
      missingDrawings: [],
      extraDrawings: [],
    });
    expect(steps).toEqual(['check', 'create', 'verify']);
    // The original layout is untouched.
    expect(JSON.stringify(tv.layouts.get('AbCd1234'))).toBe(before.get('AbCd1234'));
  });

  it('stops before saving when the plan has no free layout slot, and explains why', async () => {
    const snap = await snapshot();
    tv.layoutLimit = 1;
    tv.account = { ...tv.account!, plan: 'free' };
    await expect(restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, { root, journal: journal(), buildTime: null })).rejects.toThrow(/allows 1 saved layout, and all are in use/);
    expect(tv.requests.filter((r) => r.method === 'POST')).toEqual([]);
  });

  it('restoring the same backup twice on purpose makes two copies', async () => {
    const snap = await snapshot();
    const opts = { root, journal: journal(), buildTime: null };
    const a = await restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, opts);
    const b = await restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, opts);
    expect(b.resumed).toBe(false);
    expect(b.uid).not.toBe(a.uid);
    expect(tv.layouts.size).toBe(3);
  });

  it('a second confirmed replace overwrites again, with a new safety copy', async () => {
    const snap = await snapshot();
    tv.add(referenceInAccount('Target01', 'Old layout'));
    const opts = { root, journal: journal(), buildTime: null, countOnPage: shownBy(tv) };
    const mode = { kind: 'replace' as const, targetUid: 'Target01', confirmedName: 'Old layout' };
    await restoreLayout(client(), snap, 'AbCd1234', mode, opts);
    const edited = tv.layouts.get('Target01')!.content;
    edited.charts[0]!.panes[0]!.sources.push({ type: 'LineToolHorzLine', id: 'edit1', state: {}, points: [{ time_t: 1780000000, offset: 0, price: 1 }] });
    const posts = tv.requests.filter((r) => r.method === 'POST').length;
    const r = await restoreLayout(client(), snap, 'AbCd1234', mode, opts);
    expect(r).toMatchObject({ resumed: false, check: { verdict: 'verified' } });
    expect(r.safetyBackup).not.toBeNull();
    expect(tv.requests.filter((q) => q.method === 'POST').length).toBe(posts + 1);
    expect(JSON.stringify(tv.layouts.get('Target01')!.content)).not.toContain('edit1');
  });

  it('adopts the layout when the answer to the save was lost', async () => {
    const snap = await snapshot();
    const opts = { root, journal: journal(), buildTime: null, countOnPage: shownBy(tv) };
    tv.failOn = (req) => {
      if (req.method !== 'POST') return null;
      tv.failOn = null;
      void tv.send(req);
      return { status: 502, contentType: 'text/html', body: 'gateway timeout' };
    };
    await expect(restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, opts)).rejects.toThrow();
    const r = await restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, opts);
    expect(r).toMatchObject({ resumed: true, check: { verdict: 'verified' } });
    expect(tv.layouts.size).toBe(2);
  });

  it('replace: saves a safety copy first, overwrites only the chosen layout, and clears old stored drawings', async () => {
    const snap = await snapshot();
    tv.add({ ...referenceInAccount('Target01', 'Old layout'), storage: { '1': { stale: { id: 'stale', ownerSource: '_seriesId', state: { type: 'LineToolHorzLine', id: 'stale', state: {}, points: [{ time_t: 1, offset: 0, price: 1 }] } } } } });
    const r = await restoreLayout(client(), snap, 'AbCd1234', { kind: 'replace', targetUid: 'Target01', confirmedName: 'Old layout' }, { root, journal: journal(), buildTime: 'bt', countOnPage: shownBy(tv) });
    expect(r.uid).toBe('Target01');
    expect(r.check.verdict).toBe('verified');
    expect(tv.layouts.get('Target01')!.storage['1']).toEqual({});
    const safety = await listSnapshots(path.join(root, 'safety-copies'));
    expect(safety[0]!.manifest!.layouts[0]).toMatchObject({ uid: 'Target01', name: 'Old layout' });
    expect(tv.requests.find((q) => q.method === 'PUT')!.headers).toEqual({ 'X-BUILD-TIME': 'bt' });
  });

  it('replace: refuses a confirmed name that does not match the target, before writing anything', async () => {
    const snap = await snapshot();
    tv.add(referenceInAccount('Target01', 'Old layout'));
    tv.requests.length = 0;
    const replace = (confirmedName: string) => restoreLayout(client(), snap, 'AbCd1234', { kind: 'replace', targetUid: 'Target01', confirmedName }, { root, journal: journal(), buildTime: null });
    await expect(replace('Min AAPL')).rejects.toMatchObject({ kind: 'not-found', message: expect.stringMatching(/does not match/) });
    expect(tv.requests.filter((q) => q.method !== 'GET')).toEqual([]);
    expect(await listSnapshots(path.join(root, 'safety-copies'))).toEqual([]);
    await expect(replace('  OLD   layout ')).resolves.toMatchObject({ uid: 'Target01' });
  });

  it('a layout TradingView shows with a drawing missing is a mismatch, even when the read-back matched', async () => {
    const snap = await snapshot();
    const countOnPage = async (uid: string) => ({ ...(await shownBy(tv)(uid)), drawings: 10 });
    const r = await restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, { root, journal: journal(), buildTime: null, countOnPage });
    expect(r.check).toMatchObject({ verdict: 'mismatch', drawings: { saved: { ok: true }, shown: { count: 10, ok: false } }, missingDrawings: [] });
  });

  it('says the chart page was not checked when TradingView could not be counted', async () => {
    const snap = await snapshot();
    const r = await restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, { root, journal: journal(), buildTime: null, countOnPage: async () => null });
    expect(r.check).toMatchObject({ verdict: 'shown-unchecked', drawings: { saved: { ok: true }, shown: 'unchecked' }, indicators: { shown: 'unchecked' } });
  });

  it('verification rules: every drawing exactly, at least every indicator, and drawings that did not come back', () => {
    const expected = { charts: 1, drawings: 2, studies: 1, drawingIds: ['a', 'b'], studyIds: ['s'], symbols: [] };
    expect(checkRestore(expected, { ...expected, drawings: 1, drawingIds: ['a'] }, { drawings: 2, studies: 1 })).toMatchObject({ verdict: 'mismatch', drawings: { saved: { count: 1, ok: false } }, missingDrawings: ['b'] });
    expect(checkRestore(expected, { ...expected, drawings: 1, drawingIds: ['a'] }, null)).toMatchObject({ verdict: 'mismatch' });
    expect(checkRestore(expected, expected, { drawings: 3, studies: 1 })).toMatchObject({ verdict: 'mismatch', drawings: { shown: { count: 3, ok: false } } });
    expect(checkRestore(expected, expected, { drawings: 2, studies: 0 })).toMatchObject({ verdict: 'mismatch', indicators: { shown: { count: 0, ok: false } } });
    expect(checkRestore(expected, expected, { drawings: 2, studies: 2 })).toMatchObject({ verdict: 'verified', indicators: { shown: { count: 2, ok: true } } });
    expect(checkRestore(expected, { ...expected, charts: 2 }, { drawings: 2, studies: 1 })).toMatchObject({ verdict: 'mismatch', charts: { saved: { count: 2, ok: false } } });
  });

  it('adds missing templates and leaves existing ones alone', async () => {
    const snap = await snapshot();
    tv.drawingTemplates = { LineToolTrendLine: {} };
    const r = await restoreTemplates(client(), snap);
    expect(r).toEqual({
      added: [{ kind: 'drawing-template', name: 'Thick orange' }],
      skipped: [{ kind: 'study-template', name: 'My RSI setup' }, { kind: 'theme', name: 'Thomas dark' }],
      missing: [],
    });
    expect(tv.drawingTemplates.LineToolTrendLine).toEqual({ 'Thick orange': { linecolor: '#ff9800', linewidth: 4 } });
  });

  it('skips template files a backup does not have, and says which', async () => {
    const snap = await snapshot();
    await fs.rm(path.join(snap.dir, SNAPSHOT_FILES.themes));
    tv.themes = {};
    expect(await restoreTemplates(client(), snap)).toMatchObject({ added: [], missing: ['theme'] });
    expect(tv.themes).toEqual({});
  });
});
