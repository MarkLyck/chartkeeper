import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runBackup } from '../../src/core/backup';
import type { BackupProgress } from '../../src/core/backupProgress';
import { countLayout, parseLayout } from '../../src/core/layout';
import { LayoutRecordSchema } from '../../src/core/model';
import { contentWithDrawings, restoreLayout, RestoreJournal, restoreTemplates, saveForm, symbolFields, type RestoreStep } from '../../src/core/restore';
import { checkRestore } from '../../src/core/restorePolicy';
import { listSnapshots, SNAPSHOT_FILES, SnapshotReader } from '../../src/core/snapshot';
import { parseLayoutJson, parseListEntry, TvClient } from '../../src/core/tv/client';
import { drawingSourceFromStored, isDrawingType, type TvContent } from '../../src/core/tv/content';
import { TEMPLATE_TOOLS } from '../../src/core/tv/endpoints';
import { PoliteHttp } from '../../src/core/tv/http';
import { fakeDataSocket } from '../fakes/fakeDataSocket';
import { FakeTradingView, type FakeLayout } from '../fakes/fakeTradingView';
import { FIXTURES, referenceInAccount, referenceRecord } from '../fakes/fixtures';

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
      if (s.type === 'MainSeries') s.state = { ...(s.state as object), symbol: 'NASDAQ:MSFT', shortName: 'MSFT' };
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
    expect(snap!.manifest).toMatchObject({ status: 'complete', account: { username: 'demo_user' }, extras: { studyTemplates: 1, drawingTemplates: 1, themes: 1, scripts: 1, userDrawings: 1 } });
    expect(snap!.manifest!.layouts[0]).toMatchObject({ uid: 'AbCd1234', name: 'Min AAPL', drawings: 11, studies: 2, priceData: true, symbols: ['NASDAQ:AAPL'] });
    const reader = await SnapshotReader.open(snap!.dir);
    expect(await reader.verify()).toEqual([]);
    const data = await reader.chartData('AbCd1234', '1');
    expect(data!.bars).toHaveLength(50);
    expect(Object.values(data!.studies).every((s) => s.status === 'ok')).toBe(true);
    expect(await fs.readFile(path.join(snap!.dir, 'scripts/My Trend.pine'), 'utf8')).toContain('indicator("My Trend")');
  });

  it('keeps two Pine scripts whose names differ only in case as two files', async () => {
    tv.scripts.push({ scriptIdPart: 'USER;def456', scriptName: 'my trend', version: '1.0', source: '//@version=6\nindicator("lower")' });
    const r = await backup();
    expect(r.ok).toBe(true);
    const dir = (await listSnapshots(root))[0]!.dir;
    const files = (await fs.readdir(path.join(dir, 'scripts'))).filter((f) => f.endsWith('.pine')).sort();
    expect(files).toEqual(['My Trend.pine', 'my trend (2).pine']);
    expect(await fs.readFile(path.join(dir, 'scripts', 'my trend (2).pine'), 'utf8')).toContain('lower');
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

  it('reports progress step by step, never backwards, ending at exactly the total', async () => {
    tv.add(referenceInAccount('Second01', 'Second'));
    const seen: BackupProgress[] = [];
    await backup({ onProgress: (p) => seen.push(p) });
    const steps = seen.map((p) => `${p.step}${p.name ? ` ${p.name}` : ''}`).filter((s, i, all) => s !== all[i - 1]);
    expect(steps).toEqual(['list', 'layout Min AAPL', 'layout Second', 'userDrawings', 'studyTemplates', 'drawingTemplates', 'themes', 'scripts', 'prices Min AAPL', 'prices Second', 'finish']);
    expect(seen[0]).toEqual({ step: 'list', done: 0, total: 0 });
    const counted = seen.slice(1);
    expect(counted.every((p, i) => p.done <= p.total && (i === 0 || p.done >= counted[i - 1]!.done))).toBe(true);
    expect(seen.at(-1)!.done).toBe(seen.at(-1)!.total);
  });

  it('estimates the whole backup from the layout list: the total holds and matches the requests made', async () => {
    tv.add(referenceInAccount('Second01', 'Second'));
    tv.studyTemplates = [];
    tv.themes = {};
    tv.scripts = [];
    tv.drawingTemplates = {};
    const seen: BackupProgress[] = [];
    await backup({ includePrices: false, onProgress: (p) => seen.push(p) });
    expect(new Set(seen.slice(1).map((p) => p.total))).toEqual(new Set([tv.requests.length - 1]));
  });

  it('corrects the estimate for a layout with several charts, ending at the requests made', async () => {
    tv.add(numericChartIds());
    tv.studyTemplates = [];
    tv.themes = {};
    tv.scripts = [];
    tv.drawingTemplates = {};
    const seen: BackupProgress[] = [];
    await backup({ includePrices: false, onProgress: (p) => seen.push(p) });
    expect(seen.at(-1)!.total).toBe(tv.requests.length - 1);
    expect(seen.filter((p) => p.step === 'layout').map((p) => p.part)).toEqual([{ done: 0, total: 2 }, { done: 1, total: 2 }]);
  });

  it('moves the bar while it asks about every drawing tool, which is most of the requests', async () => {
    const seen: BackupProgress[] = [];
    await backup({ onProgress: (p) => seen.push(p) });
    const tools = seen.filter((p) => p.step === 'drawingTemplates');
    expect(tools.map((p) => p.part?.done ?? null)).toEqual([null, ...Array.from({ length: TEMPLATE_TOOLS.length + 1 }, (_, i) => i)]);
    expect(tools.every((p) => p.part === undefined || p.part.total === TEMPLATE_TOOLS.length)).toBe(true);
    const share = (tools.at(-1)!.done - tools[0]!.done) / seen.at(-1)!.total;
    expect(share).toBeGreaterThan(0.6);
  });

  it('counts the templates, themes and scripts it finds into the total', async () => {
    tv.themes = { A: { content: {} }, B: { content: {} }, C: { content: {} } };
    const seen: BackupProgress[] = [];
    await backup({ onProgress: (p) => seen.push(p) });
    const themes = seen.filter((p) => p.step === 'themes');
    expect(themes.map((p) => p.part && `${p.part.done}/${p.part.total}`)).toEqual([undefined, '0/3', '1/3', '2/3', '3/3']);
    expect(themes.at(-1)!.done - themes[0]!.done).toBe(4);
  });

  it('without prices, opens no price connection and says the snapshot has none', async () => {
    let sockets = 0;
    const { factory } = fakeDataSocket();
    const r = await backup({ includePrices: false, socketFactory: (u, o) => (sockets++, factory(u, o)) });
    expect(r.ok).toBe(true);
    expect(sockets).toBe(0);
    const reader = await SnapshotReader.open(r.dir);
    expect(reader.manifest.layouts[0]!.priceData).toBe(false);
    expect(await reader.chartData('AbCd1234', '1')).toBeNull();
  });

  it('warns when TradingView sends no prices for a symbol', async () => {
    const r = await backup({ socketFactory: fakeDataSocket({ bars: 0 }).factory });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(['"Min AAPL": prices for NASDAQ:AAPL (D) could not be saved: no prices returned']);
    const reader = await SnapshotReader.open(r.dir);
    expect(reader.manifest.layouts[0]!.priceData).toBe(false);
    expect(await reader.chartData('AbCd1234', '1')).toBeNull();
  });

  it('stops with an INCOMPLETE snapshot when a stored drawing has a format it does not know', async () => {
    tv.layouts.get('AbCd1234')!.storage['1']!.odd = { id: 'odd', state: { foo: 1 } };
    const r = await backup();
    expect(r).toMatchObject({ ok: false, error: { kind: 'format-changed', message: 'Some drawings in "Min AAPL" have an unknown format.' } });
    const [snap] = await listSnapshots(root);
    expect(snap!.name).toMatch(/-INCOMPLETE$/);
    expect(snap!.manifest!.error).toMatch(/Drawing odd has a format ChartKeeper does not recognise/);
  });

  it('calls a failure that is not a TradingView answer "unexpected", and still keeps the INCOMPLETE folder', async () => {
    for (const p of tv.layouts.get('AbCd1234')!.content.charts[0]!.panes) p.sources = p.sources.filter((s) => s.type !== 'MainSeries');
    const r = await backup();
    expect(r).toMatchObject({ ok: false, layouts: 0, error: { kind: 'unexpected', params: {}, message: 'The backup stopped because of an unexpected error: Chart 1 in "Min AAPL" has no price series.' } });
    expect(path.basename(r.dir)).toMatch(/-INCOMPLETE$/);
  });

  it('keeps a Pine script with path characters in its name inside the scripts folder', async () => {
    tv.scripts = [{ scriptIdPart: 'USER;x', scriptName: '../../outside', version: '1.0', source: 'a' }, { scriptIdPart: 'USER;y', scriptName: '', version: '1.0', source: 'b' }];
    const r = await backup({ includePrices: false });
    expect((await fs.readdir(path.join(r.dir, 'scripts'))).sort()).toEqual(['.._.._outside.pine', 'index.json', 'script.pine']);
    expect(await fs.readdir(path.dirname(r.dir))).toEqual([path.basename(r.dir)]);
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
    const inlined = sent.charts.flatMap((c) => c.panes.flatMap((p) => p.sources.filter((s) => stored.has(String(s.id)))));
    expect(inlined).toEqual([...stored.values()].filter((s) => inlined.some((i) => i.id === s.id)));
    expect(inlined.map((s) => s.id).sort()).toEqual([...stored.keys()].sort());
    for (const c of sent.charts) for (const p of c.panes) p.sources = p.sources.filter((s) => !stored.has(String(s.id)));
    expect(JSON.stringify(sent)).toBe(JSON.stringify({ ...fake.content, name: 'Kopi' }));
  });

  it('sends the stored content back with its keys in the original order, through the real parse path', () => {
    const tvSaved = JSON.parse(readFileSync(path.join(FIXTURES, 'tv-saved-layout.json'), 'utf8'));
    const rec = parseLayoutJson({ content: tvSaved.content, content_study_meta: tvSaved.study_meta_info_map, name: 'X' }, parseListEntry({ image_url: 'Ord1' }));
    const onDisk = LayoutRecordSchema.parse(JSON.parse(JSON.stringify(rec)));
    const sent = saveForm(onDisk, { buckets: {}, reportedTotal: null }, 'X').content!;
    expect(sent).toBe(JSON.stringify({ ...JSON.parse(tvSaved.content), name: 'X' }));
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
      skipped: [{ kind: 'study-template', name: 'My RSI setup' }, { kind: 'theme', name: 'My dark' }],
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

  it('adds missing indicator templates and themes with their content', async () => {
    const snap = await snapshot();
    const [study] = tv.studyTemplates;
    const theme = tv.themes['My dark'];
    tv.studyTemplates = [];
    tv.themes = {};
    const r = await restoreTemplates(client(), snap);
    expect(r.added).toEqual([{ kind: 'study-template', name: 'My RSI setup' }, { kind: 'theme', name: 'My dark' }]);
    expect(tv.studyTemplates).toEqual([{ id: expect.any(Number), name: 'My RSI setup', content: study!.content, meta_info: study!.meta_info }]);
    expect(tv.themes).toEqual({ 'My dark': theme });
  });

  it('says every template kind a backup lacks, and adds nothing', async () => {
    const snap = await snapshot();
    for (const f of [SNAPSHOT_FILES.studyTemplates, SNAPSHOT_FILES.drawingTemplates, SNAPSHOT_FILES.themes]) await fs.rm(path.join(snap.dir, f));
    tv.studyTemplates = [];
    tv.drawingTemplates = {};
    tv.themes = {};
    expect(await restoreTemplates(client(), snap)).toEqual({ added: [], skipped: [], missing: ['study-template', 'drawing-template', 'theme'] });
    expect(tv.requests.filter((q) => q.method === 'POST')).toEqual([]);
  });

  it('finishes the layout an interrupted restore already created, even after it was renamed', async () => {
    const snap = await snapshot();
    const opts = { root, journal: journal(), buildTime: null, countOnPage: shownBy(tv) };
    tv.failOn = (req) => (/^\/chart\/New\d+\/json\/$/.test(new URL(req.url).pathname) ? { status: 500, contentType: 'text/plain', body: 'down' } : null);
    await expect(restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, opts)).rejects.toMatchObject({ kind: 'server' });
    tv.failOn = null;
    const created = [...tv.layouts.values()].find((l) => l.uid !== 'AbCd1234')!;
    created.name = 'Renamed on TradingView';
    const r = await restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, opts);
    expect(r).toMatchObject({ uid: created.uid, name: 'Renamed on TradingView', resumed: true, check: { verdict: 'verified' } });
    expect(tv.layouts.size).toBe(2);
    expect(tv.requests.filter((q) => q.method === 'POST')).toHaveLength(1);
  });

  it('creates the layout afresh when the interrupted save never reached TradingView', async () => {
    const snap = await snapshot();
    const opts = { root, journal: journal(), buildTime: null, countOnPage: shownBy(tv) };
    tv.failOn = (req) => (req.method === 'POST' ? { status: 500, contentType: 'text/html', body: 'down' } : null);
    await expect(restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, opts)).rejects.toMatchObject({ kind: 'server' });
    expect(tv.layouts.size).toBe(1);
    tv.failOn = null;
    const r = await restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, opts);
    expect(r).toMatchObject({ resumed: false, check: { verdict: 'verified' } });
    expect(r.uid).not.toBe('AbCd1234');
    expect(tv.layouts.size).toBe(2);
  });

  it('replace: stops when the chosen layout was deleted on TradingView meanwhile', async () => {
    const snap = await snapshot();
    tv.requests.length = 0;
    const mode = { kind: 'replace' as const, targetUid: 'Gone0001', confirmedName: 'Gone' };
    await expect(restoreLayout(client(), snap, 'AbCd1234', mode, { root, journal: journal(), buildTime: null })).rejects.toMatchObject({ kind: 'not-found', message: expect.stringMatching(/no longer exists/) });
    expect(tv.requests.filter((q) => q.method !== 'GET')).toEqual([]);
  });

  it('names the plan and its limit when no layout slot is free', async () => {
    const snap = await snapshot();
    for (let i = 0; i < 4; i++) tv.add(referenceInAccount(`Extra00${i}`, `Extra ${i}`));
    tv.account = { ...tv.account!, plan: 'essential' };
    await expect(restoreLayout(client(), snap, 'AbCd1234', { kind: 'new' }, { root, journal: journal(), buildTime: null })).rejects.toMatchObject({
      kind: 'limit-reached',
      params: { limit: 5, plan: 'essential' },
      message: expect.stringContaining('Your TradingView plan (essential) allows 5 saved layouts, and all are in use.'),
    });
  });

  it('reads the older list entry fields for the save request', () => {
    expect(symbolFields({ ...referenceRecord(), listEntry: { symbol: 'NYSE:IBM', interval: '15', short_symbol: 'IBM', legs: [{ symbol: 'NYSE:IBM' }] } })).toEqual({
      resolution: '15', symbol_type: 'stock', exchange: 'NYSE', listed_exchange: 'NYSE', symbol: 'NYSE:IBM', short_name: 'IBM', legs: '[{"symbol":"NYSE:IBM"}]',
    });
    expect(symbolFields({ ...referenceRecord(), listEntry: { legs: '[{"symbol":"X"}]' } }).legs).toBe('[{"symbol":"X"}]');
  });
});
