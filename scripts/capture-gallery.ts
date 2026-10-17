/**
 * Builds test/fixtures/gallery: for every scene in test/gallery/scenes.ts, a
 * real signed-out TradingView rendering of the scene's layout plus a ChartKeeper
 * snapshot of exactly that layout and its data, so the offline viewer can be
 * compared with TradingView tool by tool.
 *
 *   npx tsx scripts/capture-gallery.ts [sceneName...]
 *
 * Per scene it writes test/fixtures/gallery/<scene>/: the snapshot (manifest.json,
 * layouts/<scene>/...), tradingview.png (chart area), isolated/<drawing id>.png
 * (only that drawing visible), isolated/_base.png (no drawings) and meta.json.
 * Then it rewrites index.json and INDEX.md from every scene's meta.json.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { countLayout, parseLayout } from '../src/core/layout';
import type { Bar, ChartData, LayoutRecord } from '../src/core/model';
import { layoutDir, layoutFiles, noExtras, SnapshotWriter } from '../src/core/snapshot';
import { decodeFrames, fetchChartData, nodeSocketFactory } from '../src/core/tv/datafeed';
import type { TvChart, TvContent, TvSource } from '../src/core/tv/content';
import { chartStyle, CHART_STYLES, LINE_TOOL_TYPES, LINE_TOOLS, MAX_STUDIES_SIGNED_OUT, NOT_CAPTURABLE, PAID_STYLE_REASON, SAVED_AS, SOURCE_FIELDS, MULTI_CHART_REASON, type LineToolType } from '../test/gallery/catalog';
import { SCENES, type Anchor, type ChartSpec, type Props, type Scene } from '../test/gallery/scenes';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test/fixtures/gallery');
const BUILD = path.join(ROOT, '.test-output/gallery-build');
const VIEWPORT = { width: 1406, height: 681 };
const DATA_BARS = 600;
/** Width of `.chart-container` at VIEWPORT, and roughly what the price axis takes of it. */
const CHART_AREA_WIDTH = 1000;
const PRICE_AXIS_WIDTH = 66;

type Json = Record<string, unknown>;

interface SceneMeta {
  scene: string;
  description: string;
  uid: string;
  theme: Scene['theme'];
  /** TradingView's multi-chart code; always "s" (see MULTI_CHART_REASON). */
  arrangement: 's';
  capturedAt: string;
  tradingViewBuild: string | null;
  image: string;
  size: { width: number; height: number };
  charts: ChartMeta[];
  baseImage: string;
  drawings: { id: string; chartId: string; requestedType: LineToolType; type: string; image: string }[];
}

interface ChartMeta {
  chartId: string;
  symbol: string;
  interval: string;
  style: { id: number; name: string };
  /** `datafeed`: bars from ChartKeeper's fetchChartData. `tradingview`: the computed bars TradingView's page received for the main series. */
  barsSource: 'datafeed' | 'tradingview';
  /** The symbol spec TradingView resolved for a computed style, e.g. a BarSetRenko@tv-prostudies-73! request. */
  computedSeries: string | null;
  box: { x: number; y: number; width: number; height: number };
  visibleRange: { from: number; to: number };
  priceRange: { from: number; to: number } | null;
  /** `drawings`: drawing sources in TradingView's saved layout. `shapes`: getAllShapes(), which leaves out the left and right arrow marks. */
  tradingView: { drawings: number; shapes: number; studies: string[] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isPlain = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function deepMerge(base: Json, ...over: (Json | undefined)[]): Json {
  const out: Json = structuredClone(base);
  for (const o of over) {
    for (const [k, v] of Object.entries(o ?? {})) out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k] as Json, v) : structuredClone(v);
  }
  return out;
}

/** Turns off chart decorations the viewer does not draw: trading buttons, symbol logo, earnings/dividend/split and event markers, countdown. */
const QUIET_CHART: Json = {
  paneProperties: { legendProperties: { showTradingButtons: false, showTradingButtonsMobile: false, showLogo: false } },
  chartEventsSourceProperties: { visible: false },
};
const QUIET_SERIES: Json = { esdShowDividends: false, esdShowSplits: false, esdShowEarnings: false, esdShowBreaks: false, showCountdown: false };

/** Every websocket frame of the chart page, for readiness checks and for the bars of computed styles. */
class FrameLog {
  counts = new Map<string, number>();
  errors: string[] = [];
  /** Bars per "<session>/<series>", reset whenever the page (re)creates that series. */
  private series = new Map<string, Map<number, Bar>>();
  private resolved = new Map<string, string>();
  private seriesSymbol = new Map<string, string>();
  lastSeries: string | null = null;

  attach(page: Page) {
    page.on('websocket', (ws) => {
      if (!ws.url().includes('data.tradingview.com')) return;
      ws.on('framesent', (f) => this.onFrames(String(f.payload), 'out'));
      ws.on('framereceived', (f) => this.onFrames(String(f.payload), 'in'));
    });
  }

  count = (m: string) => this.counts.get(m) ?? 0;

  seriesBars(key: string): Bar[] {
    return [...(this.series.get(key)?.entries() ?? [])].sort((a, b) => a[0] - b[0]).map(([, bar]) => bar);
  }

  seriesSpec = (key: string) => this.resolved.get(this.seriesSymbol.get(key) ?? '') ?? null;

  private onFrames(data: string, dir: 'in' | 'out') {
    for (const f of decodeFrames(data)) {
      if (!f.startsWith('{')) continue;
      let m: { m?: string; p?: unknown[] };
      try {
        m = JSON.parse(f);
      } catch {
        continue;
      }
      const p = m.p ?? [];
      if (dir === 'out') {
        if (m.m === 'resolve_symbol') this.resolved.set(`${p[0]}/${p[1]}`, String(p[2]));
        if (m.m === 'create_series' || m.m === 'modify_series') {
          const key = `${p[0]}/${p[1]}`;
          this.series.set(key, new Map());
          this.seriesSymbol.set(key, `${p[0]}/${p[3]}`);
          this.lastSeries = key;
        }
        continue;
      }
      if (!m.m) continue;
      this.counts.set(m.m, this.count(m.m) + 1);
      if (m.m === 'study_error' || m.m === 'series_error' || m.m === 'critical_error') this.errors.push(`${m.m} ${JSON.stringify(p).slice(0, 300)}`);
      if (m.m === 'timescale_update' || m.m === 'du') {
        for (const [sid, u] of Object.entries((p[1] ?? {}) as Record<string, { s?: { i: number; v: unknown[] }[] }>)) {
          const bars = this.series.get(`${p[0]}/${sid}`);
          if (!bars || !u.s) continue;
          for (const r of u.s) {
            const v = r.v.map((x) => (typeof x === 'number' && Math.abs(x) < 1e90 ? x : 0));
            bars.set(r.i, [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0, v[4] ?? 0, v[5] ?? 0]);
          }
        }
      }
    }
  }
}

async function waitFor(what: string, check: () => Promise<boolean> | boolean, timeoutMs = 30000, everyMs = 300) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(everyMs);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// ---------------------------------------------------------------------------
// Placing drawings

interface SeriesWindow {
  bars: Bar[];
  /** Index of the last bar and the first visible bar. */
  last: number;
  first: number;
  lo: number;
  hi: number;
  step: number;
  /** Below 1 when the series has fewer bars than the scene shows (Point & Figure, Kagi, Renko): anchors shrink with it. */
  scale: number;
}

const barCache = new Map<string, Bar[]>();

async function plainBars(spec: ChartSpec): Promise<Bar[]> {
  const key = `${spec.symbol}@${spec.interval}`;
  const hit = barCache.get(key);
  if (hit) return hit;
  const chart = { chartId: '1', symbol: spec.symbol, shortName: spec.symbol, interval: spec.interval, style: 1, seriesState: {}, timezone: 'Etc/UTC', chartProperties: {}, panes: [] };
  const data = await fetchChartData(chart, [], nodeSocketFactory, { authToken: null, bars: DATA_BARS });
  if (data.bars.length < 50) throw new Error(`Only ${data.bars.length} bars for ${key}`);
  barCache.set(key, data.bars);
  return data.bars;
}

function seriesWindow(bars: Bar[], visibleBars: number): SeriesWindow {
  const last = bars.length - 1;
  const first = Math.max(0, last - visibleBars + 1);
  const shown = bars.slice(first);
  const gaps = bars.slice(-30).map((b, i, a) => (i ? b[0] - a[i - 1]![0] : Infinity)).sort((a, b) => a - b);
  return { bars, last, first, lo: Math.min(...shown.map((b) => b[3])), hi: Math.max(...shown.map((b) => b[2])), step: gaps[Math.floor(gaps.length / 2)]!, scale: Math.min(1, bars.length / visibleBars) };
}

function resolveAnchor(w: SeriesWindow, a: Anchor): { time: number; price: number } {
  const back = (bars: number) => Math.round(bars * w.scale);
  if (!Array.isArray(a)) {
    const { swing, from, to } = a as Extract<Anchor, { swing: unknown }>;
    let best = -1;
    for (let i = w.last - back(from); i <= w.last - back(to); i++) {
      const bar = w.bars[i];
      if (!bar) continue;
      if (best < 0 || (swing === 'high' ? bar[2] > w.bars[best]![2] : bar[3] < w.bars[best]![3])) best = i;
    }
    if (best < 0) throw new Error(`No bars for swing anchor ${JSON.stringify(a)}`);
    return { time: w.bars[best]![0], price: swing === 'high' ? w.bars[best]![2] : w.bars[best]![3] };
  }
  const [barsFromRight, price] = a as Extract<Anchor, readonly unknown[]>;
  const i = w.last - back(barsFromRight);
  if (i < 0) throw new Error(`Anchor ${barsFromRight} is left of the loaded bars`);
  const bar = w.bars[Math.min(i, w.last)]!;
  const time = i > w.last ? bar[0] + (i - w.last) * w.step : bar[0];
  const field = { open: 1, high: 2, low: 3, close: 4 } as const;
  return { time, price: typeof price === 'number' ? +(w.lo + price * (w.hi - w.lo)).toFixed(4) : bar[field[price]] };
}

const drawingId = (chartIndex: number, i: number) => `c${chartIndex + 1}d${String(i + 1).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Layout content

function buildContent(base: TvContent, scene: Scene, windows: SeriesWindow[], withDrawings = true): TvContent {
  const content = structuredClone(base) as TvContent & Json;
  const baseChart = content.charts[0]!;
  content.name = scene.name;
  content.layout = 's';
  delete content.layoutsSizes;
  content.charts = scene.charts.map((spec, ci): TvChart => {
    const chart = structuredClone(baseChart) as TvChart & Json;
    chart.chartId = String(ci + 1);
    const mainPane = chart.panes.find((p) => p.sources.some((s) => s.type === 'MainSeries'))!;
    const main = mainPane.sources.find((s) => s.type === 'MainSeries')!;
    main.state = deepMerge(main.state as Json, QUIET_SERIES, { symbol: spec.symbol, shortName: spec.symbol.split(':').pop(), interval: spec.interval, style: spec.style }, spec.series);
    chart.chartProperties = deepMerge(chart.chartProperties as Json, QUIET_CHART, spec.chartProperties);
    chart.lineToolsGroups = { groups: [] };
    const w = windows[ci]!;
    const plotWidth = CHART_AREA_WIDTH / scene.charts.length - PRICE_AXIS_WIDTH;
    const shownBars = w.last - w.first + 1 + spec.rightMarginBars;
    chart.timeScale = deepMerge(chart.timeScale as Json, { m_barSpacing: +(plotWidth / shownBars).toFixed(3), m_rightOffset: spec.rightMarginBars, usePercentageRightOffset: false });
    const drawings: TvSource[] = (withDrawings ? spec.drawings : []).map((dr, i) => ({
      type: dr.type,
      id: drawingId(ci, i),
      state: { symbol: spec.symbol, interval: spec.interval, ...structuredClone(dr.props ?? {}) },
      points: dr.at.map((a) => {
        const { time, price } = resolveAnchor(w, a);
        return { time_t: time, offset: 0, price, interval: spec.interval };
      }),
      zorder: -5000 + i,
      ownerSource: main.id,
      ...structuredClone(SOURCE_FIELDS[dr.type] ?? {}),
      ...structuredClone(dr.source ?? {}),
      linkKey: `lk${scene.name.replace(/[^a-z0-9]/gi, '')}${ci}${i}`,
    }));
    mainPane.sources = [main, ...drawings];
    chart.panes = [mainPane];
    return chart;
  });
  return content;
}

// ---------------------------------------------------------------------------
// The TradingView page

interface Session {
  page: Page;
  log: FrameLog;
  bases: Record<Scene['theme'], TvContent>;
  openedAt: number;
  close: () => Promise<void>;
}

/**
 * A fresh signed-out chart page. After about four minutes the page opens a
 * "Join for free" dialog that has no close button and stops drawing updates,
 * so sessions are replaced before they get that old.
 */
const SESSION_MS = 180000;

async function openSession(): Promise<Session> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const log = new FrameLog();
  log.attach(page);
  // tsx compiles named functions inside page.evaluate callbacks to __name(...) calls.
  await page.addInitScript('window.__name = (f) => f');
  await page.goto('https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL&interval=D', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).TradingViewApi?.activeChart, null, { timeout: 60000 });
  await sleep(6000);
  return { page, log, bases: await baseContents(page), openedAt: Date.now(), close: () => browser.close() };
}

async function baseContents(page: Page): Promise<Record<Scene['theme'], TvContent>> {
  const out = {} as Record<Scene['theme'], TvContent>;
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    out[theme] = await page.evaluate(() => JSON.parse((window as any).TradingViewApi.getSaveChartService().saveToJSON().content));
  }
  return out;
}

async function setTheme(page: Page, theme: Scene['theme']) {
  await page.evaluate(async (t) => {
    const themes = (window as any).TradingViewApi.themes();
    if (themes.getCurrentThemeName() !== t) await themes.setStdTheme(t);
  }, theme);
  await sleep(1500);
}

async function reconnectIfNeeded(page: Page): Promise<boolean> {
  const b = page.getByRole('button', { name: 'Reconnect' });
  if (!(await b.count()) || !(await b.first().isVisible())) return false;
  await b.first().click();
  return true;
}

async function loadScene(page: Page, log: FrameLog, scene: Scene, content: TvContent) {
  const seriesBefore = log.count('series_completed');
  await page.evaluate(async (st) => {
    await (window as any).TradingViewApi._chartWidgetCollection.loadLayoutState({ name: st.name, chartWidgetCollectionState: st });
  }, { ...content, name: scene.name, studyMetaInfoMap: {} });
  await sleep(3000);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await reconnectIfNeeded(page)) await sleep(4000);
    if (log.count('series_completed') >= seriesBefore + scene.charts.length && !(await reconnectIfNeeded(page))) break;
    await sleep(2000);
  }
}

async function applyStyle(page: Page, log: FrameLog, ci: number, style: number) {
  const type = () => page.evaluate((i) => (window as any).TradingViewApi.chart(i).chartType() as number, ci);
  if ((await type()) === style) return;
  const before = log.count('series_completed');
  await page.evaluate(([i, s]) => (window as any).TradingViewApi.chart(i).setChartType(s), [ci, style] as const);
  await waitFor(`style ${style}`, async () => (await type()) === style, 10000).catch(async () => {
    throw new Error(`TradingView kept chart style ${await type()} instead of ${style}`);
  });
  if (chartStyle(style).computed) await waitFor(`bars for style ${style}`, () => log.count('series_completed') > before, 30000);
}

async function addStudies(page: Page, log: FrameLog, ci: number, spec: ChartSpec) {
  for (const s of spec.studies) {
    const done = log.count('study_completed');
    const errors = log.errors.length;
    await page.evaluate(
      async ([i, st]) => {
        await (window as any).TradingViewApi.chart(i).createStudy(st.name, false, false, st.inputs, st.overrides);
      },
      [ci, { name: s.name, inputs: s.inputs ?? {}, overrides: s.overrides ?? {} }] as const,
    );
    await waitFor(`study ${s.name}`, () => log.count('study_completed') > done || log.errors.length > errors, 30000);
    const err = log.errors.slice(errors).find((e) => e.startsWith('study_error'));
    if (err) throw new Error(`TradingView could not compute ${s.name}: ${err}`);
  }
}

async function setVisibility(page: Page, ids: string[][], visible: (id: string) => boolean) {
  const want = ids.map((list) => list.map((id) => [id, visible(id)] as const));
  await page.evaluate((w) => {
    const tv = (window as any).TradingViewApi;
    w.forEach((list, ci) => {
      for (const [id, v] of list) tv.chart(ci).getShapeById(id).setProperties({ visible: v });
    });
  }, want);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(350);
}

/** Fails when something that is not the chart covers the chart area: error overlays, dialogs, toasts, popups. */
async function assertClean(page: Page) {
  const problems = await page.evaluate(() => {
    const areas = [...document.querySelectorAll('.chart-container')].map((e) => e.getBoundingClientRect());
    const overlaps = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') return false;
      return areas.some((a) => r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top);
    };
    const out: string[] = [];
    for (const box of document.querySelectorAll('[role="dialog"], [data-dialog-name], [class*="toast"], [class*="popup"]')) {
      const shown = [...box.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent ?? '').trim() && overlaps(el));
      if (shown) out.push(`popup: ${(box.textContent ?? '').trim().slice(0, 80)}`);
    }
    for (const el of document.querySelectorAll('.chart-container *')) {
      if (el.children.length === 0 && /Something went wrong|Reconnect|Sign in|Log in|Upgrade/.test(el.textContent ?? '') && overlaps(el)) out.push(`overlay: ${el.textContent}`);
    }
    return out;
  });
  if (problems.length) throw new Error(`The chart area is not clean: ${problems.join('; ')}`);
}

async function cleanShot(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  await assertClean(page);
  return page.screenshot({ clip });
}

// ---------------------------------------------------------------------------
// One scene

async function captureScene(page: Page, log: FrameLog, bases: Record<Scene['theme'], TvContent>, scene: Scene): Promise<void> {
  const started = Date.now();
  await setTheme(page, scene.theme);
  const windows: SeriesWindow[] = await Promise.all(scene.charts.map(async (c) => seriesWindow(await plainBars(c), c.visibleBars)));
  if (chartStyle(scene.charts[0].style).computed) {
    // Place the drawings on the bars TradingView computes for this style, which only the page knows: load it once without drawings.
    await loadScene(page, log, scene, buildContent(bases[scene.theme], scene, windows, false));
    await applyStyle(page, log, 0, scene.charts[0].style);
    const bars = log.lastSeries ? log.seriesBars(log.lastSeries) : [];
    if (bars.length < 10) throw new Error(`TradingView sent only ${bars.length} bars for style ${scene.charts[0].style}`);
    windows[0] = seriesWindow(bars, scene.charts[0].visibleBars);
  }
  await loadScene(page, log, scene, buildContent(bases[scene.theme], scene, windows));

  const ids = scene.charts.map((c, ci) => c.drawings.map((_, i) => drawingId(ci, i)));
  for (const [ci, spec] of scene.charts.entries()) {
    await applyStyle(page, log, ci, spec.style);
    await page.evaluate((i) => (window as any).TradingViewApi.chart(i).removeAllStudies(), ci);
    await addStudies(page, log, ci, spec);
  }
  await waitFor(
    'drawings',
    () =>
      page.evaluate((all) => {
        const tv = (window as any).TradingViewApi;
        return all.every((list, ci) => list.every((id) => tv.chart(ci).getShapeById(id)?.dataAndViewsReady?.() === true));
      }, ids),
    30000,
  );
  await page.mouse.move(VIEWPORT.width - 3, VIEWPORT.height - 3);
  await sleep(2000);

  const view = await page.evaluate((count) => {
    const tv = (window as any).TradingViewApi;
    const boxes = [...document.querySelectorAll('.chart-container')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const charts = Array.from({ length: count }, (_, i) => {
      const c = tv.chart(i);
      let priceRange = null;
      try {
        priceRange = c.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange();
      } catch {
        /* not exposed for this pane */
      }
      const r = boxes[i]!;
      return { visibleRange: c.getVisibleRange(), priceRange, shapes: c.getAllShapes().length, studies: c.getAllStudies().map((s: { name: string }) => s.name), style: c.chartType(), box: { x: r.x, y: r.y, width: r.width, height: r.height } };
    });
    const x = Math.min(...boxes.map((r) => r.x));
    const y = Math.min(...boxes.map((r) => r.y));
    const clip = { x, y, width: Math.max(...boxes.map((r) => r.right)) - x, height: Math.max(...boxes.map((r) => r.bottom)) - y };
    return { charts, clip, build: String((window as any).BUILD_TIME ?? '') || null };
  }, scene.charts.length);
  const saved = await page.evaluate(() => (window as any).TradingViewApi.getSaveChartService().saveToJSON());
  const shot = await cleanShot(page, view.clip);

  const isolated = new Map<string, Buffer>();
  for (const id of ids.flat()) {
    await setVisibility(page, ids, (x) => x === id);
    isolated.set(id, await cleanShot(page, view.clip));
  }
  await setVisibility(page, ids, () => false);
  isolated.set('_base', await cleanShot(page, view.clip));
  await setVisibility(page, ids, () => true);

  const record: LayoutRecord = {
    uid: scene.name,
    id: 1,
    name: scene.name,
    description: scene.description,
    lastModified: Math.floor(started / 1000),
    content: JSON.parse(saved.content),
    studyMetaInfoMap: JSON.parse(saved.study_meta_info_map),
    listEntry: { image_url: scene.name, url: scene.name, id: 1, name: scene.name },
  };
  const layout = parseLayout(record, null);
  if (layout.charts.length !== scene.charts.length) throw new Error(`TradingView saved ${layout.charts.length} charts, the scene has ${scene.charts.length}`);

  const datas: ChartData[] = [];
  const chartMetas: ChartMeta[] = [];
  for (const [ci, chart] of layout.charts.entries()) {
    const spec = scene.charts[ci]!;
    const style = chartStyle(spec.style);
    const v = view.charts[ci]!;
    if (v.style !== spec.style) throw new Error(`Chart ${ci + 1} shows style ${v.style}, the scene asks for ${spec.style}`);
    const savedDrawings = chart.panes.flatMap((p) => p.drawings);
    if (savedDrawings.length !== spec.drawings.length) throw new Error(`Chart ${ci + 1}: TradingView kept ${savedDrawings.length} of ${spec.drawings.length} drawings`);
    const studies = chart.panes.flatMap((p) => p.studies);
    let data: ChartData;
    let computedSeries: string | null = null;
    if (style.computed) {
      const key = log.lastSeries;
      if (!key) throw new Error('No main series frames were recorded');
      computedSeries = log.seriesSpec(key);
      data = { chartId: chart.chartId, symbol: chart.symbol, interval: chart.interval, fetchedAt: new Date().toISOString(), bars: log.seriesBars(key), studies: {} };
      if (!computedSeries?.includes('BarSet')) throw new Error(`Expected a computed series for style ${style.name}, TradingView resolved ${computedSeries}`);
    } else {
      data = await fetchChartData(chart, studies, nodeSocketFactory, { authToken: null, bars: DATA_BARS });
      const bad = Object.entries(data.studies).filter(([, s]) => s.status !== 'ok');
      if (bad.length) throw new Error(`The datafeed could not compute ${bad.map(([id, s]) => `${id}: ${s.status === 'error' ? s.error : ''}`).join(', ')}`);
    }
    datas.push(data);
    chartMetas.push({
      chartId: chart.chartId,
      symbol: chart.symbol,
      interval: chart.interval,
      style: { id: style.id, name: style.name },
      barsSource: style.computed ? 'tradingview' : 'datafeed',
      computedSeries,
      box: { x: v.box.x - view.clip.x, y: v.box.y - view.clip.y, width: v.box.width, height: v.box.height },
      visibleRange: v.visibleRange,
      priceRange: v.priceRange,
      tradingView: { drawings: savedDrawings.length, shapes: v.shapes, studies: v.studies },
    });
  }

  const dir = path.join(OUT, scene.name);
  await writeSnapshot(scene, record, datas, dir);
  await fs.mkdir(path.join(dir, 'isolated'), { recursive: true });
  await fs.writeFile(path.join(dir, 'tradingview.png'), shot);
  for (const [id, png] of isolated) await fs.writeFile(path.join(dir, 'isolated', `${id}.png`), png);
  const savedTypes = new Map(layout.charts.flatMap((c) => c.panes.flatMap((p) => p.drawings.map((dr) => [dr.id, dr.type] as const))));
  const meta: SceneMeta = {
    scene: scene.name,
    description: scene.description,
    uid: scene.name,
    theme: scene.theme,
    arrangement: 's',
    capturedAt: new Date(started).toISOString(),
    tradingViewBuild: view.build,
    image: 'tradingview.png',
    size: { width: view.clip.width, height: view.clip.height },
    charts: chartMetas,
    baseImage: 'isolated/_base.png',
    drawings: scene.charts.flatMap((c, ci) =>
      c.drawings.map((dr, i) => {
        const id = drawingId(ci, i);
        return { id, chartId: String(ci + 1), requestedType: dr.type, type: savedTypes.get(id) ?? 'missing', image: `isolated/${id}.png` };
      }),
    ),
  };
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`  ${scene.name}: ${meta.drawings.length} drawings, studies ${chartMetas.map((c) => c.tradingView.studies.join('+') || '-').join(' | ')}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

async function writeSnapshot(scene: Scene, record: LayoutRecord, datas: ChartData[], dir: string) {
  const at = new Date((record.lastModified ?? 0) * 1000);
  const parent = path.join(BUILD, scene.name);
  await fs.rm(parent, { recursive: true, force: true });
  const writer = await SnapshotWriter.begin(parent, at);
  const files = layoutFiles(layoutDir(record.uid));
  await writer.writeJson(files.layout, record);
  await writer.writeJson(files.drawings, { buckets: {}, reportedTotal: null });
  for (const data of datas) await writer.writeJson(files.chartData(data.chartId), data);
  const counts = countLayout(parseLayout(record, null));
  const final = await writer.finish({
    app: { name: 'ChartKeeper', version: 'gallery' },
    createdAt: at.toISOString(),
    account: { username: 'gallery', plan: null },
    layouts: [{ uid: record.uid, name: record.name, dir: layoutDir(record.uid), symbols: counts.symbols, charts: counts.charts, drawings: counts.drawings, studies: counts.studies, lastModified: record.lastModified, priceData: true }],
    extras: noExtras(),
    warnings: [],
  });
  await fs.rm(dir, { recursive: true, force: true });
  await fs.cp(final, dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Index and coverage

function validate(scenes: readonly Scene[]) {
  const names = new Set<string>();
  for (const s of scenes) {
    if (names.has(s.name)) throw new Error(`Two scenes are called ${s.name}`);
    names.add(s.name);
    for (const c of s.charts) {
      if (c.studies.length > MAX_STUDIES_SIGNED_OUT) throw new Error(`${s.name}: a signed-out chart computes at most ${MAX_STUDIES_SIGNED_OUT} indicators`);
      if (chartStyle(c.style).computed && (c.studies.length || s.charts.length > 1)) throw new Error(`${s.name}: computed styles are captured on single charts without indicators`);
      for (const dr of c.drawings) {
        const n = LINE_TOOLS[dr.type].points;
        if (n !== 'n' && dr.at.length !== n) throw new Error(`${s.name}: ${dr.type} takes ${n} points, got ${dr.at.length}`);
      }
    }
  }
}

async function readMetas(): Promise<SceneMeta[]> {
  const out: SceneMeta[] = [];
  for (const name of (await fs.readdir(OUT).catch(() => [] as string[])).sort()) {
    const file = path.join(OUT, name, 'meta.json');
    try {
      out.push(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch {
      /* not a scene folder */
    }
  }
  const order = new Map(SCENES.map((s, i) => [s.name, i]));
  return out.filter((m) => order.has(m.scene)).sort((a, b) => order.get(a.scene)! - order.get(b.scene)!);
}

/** Rewrites index.json and INDEX.md from the captured scenes. Returns what is neither captured nor excused. */
async function writeIndex(): Promise<string[]> {
  const metas = await readMetas();
  const toolScenes = new Map<LineToolType, Set<string>>();
  const toolSaved = new Map<LineToolType, Set<string>>();
  const styleScenes = new Map<number, Set<string>>();
  for (const m of metas) {
    for (const dr of m.drawings) {
      if (dr.type === 'missing') continue;
      (toolScenes.get(dr.requestedType) ?? toolScenes.set(dr.requestedType, new Set()).get(dr.requestedType)!).add(m.scene);
      (toolSaved.get(dr.requestedType) ?? toolSaved.set(dr.requestedType, new Set()).get(dr.requestedType)!).add(dr.type);
    }
    for (const c of m.charts) (styleScenes.get(c.style.id) ?? styleScenes.set(c.style.id, new Set()).get(c.style.id)!).add(m.scene);
  }
  const missing: string[] = [];
  const tools = LINE_TOOL_TYPES.map((type) => {
    const scenes = [...(toolScenes.get(type) ?? [])];
    const savedAs = [...(toolSaved.get(type) ?? [])].filter((t) => t !== type);
    const reason = NOT_CAPTURABLE[type] ?? null;
    if (!scenes.length && !reason) missing.push(type);
    return { type, ui: LINE_TOOLS[type].ui, scenes, savedAs: savedAs[0] ?? SAVED_AS[type] ?? null, notCapturable: scenes.length ? null : reason };
  });
  const styles = CHART_STYLES.map((s) => {
    const scenes = [...(styleScenes.get(s.id) ?? [])];
    const reason = 'paid' in s ? PAID_STYLE_REASON : null;
    if (!scenes.length && !reason) missing.push(`style ${s.id} ${s.name}`);
    return { id: s.id, name: s.name, computed: s.computed, scenes, notCapturable: scenes.length ? null : reason };
  });
  const index = {
    generatedBy: 'scripts/capture-gallery.ts',
    scenes: metas.map((m) => ({
      name: m.scene,
      dir: m.scene,
      uid: m.uid,
      description: m.description,
      theme: m.theme,
      arrangement: m.arrangement,
      capturedAt: m.capturedAt,
      charts: m.charts.map((c) => ({ chartId: c.chartId, symbol: c.symbol, interval: c.interval, style: c.style.id, barsSource: c.barsSource, studies: c.tradingView.studies })),
      drawings: m.drawings.map((dr) => ({ id: dr.id, type: dr.type, requestedType: dr.requestedType, image: dr.image })),
    })),
    coverage: { drawingTools: tools, chartStyles: styles, multiChartLayouts: { scenes: [], notCapturable: MULTI_CHART_REASON } },
  };
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');

  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const md: string[] = [
    '# Capture gallery',
    '',
    'Real TradingView renderings of known layouts, each next to a ChartKeeper snapshot of exactly that layout and its data.',
    'Generated by `npx tsx scripts/capture-gallery.ts [scene...]` from `test/gallery/scenes.ts`. Do not edit by hand.',
    '',
    'Each folder holds a snapshot (`manifest.json`, `layouts/<scene>/`), `tradingview.png` (chart area), `meta.json`',
    '(visible time and price range, pixel size, TradingView counts, chart style, drawing id to type), `isolated/<id>.png`',
    '(only that drawing visible) and `isolated/_base.png` (no drawings).',
    '',
    'Every layout turns off the trading buttons, the symbol logo, earnings/dividend/split markers and the countdown.',
    'TradingView still draws its watermark (bottom left) and the chart events button (bottom right) on every',
    'signed-out chart; mask those two corners when comparing pixels. Bars of computed styles (Renko, Kagi, Point & Figure,',
    'Line Break, Heikin Ashi, Range) are the bars TradingView itself received for the main series (`barsSource: "tradingview"`).',
    '',
    '## Scenes',
    '',
    '| Scene | Charts | Indicators | Drawings | Covers |',
    '| --- | --- | --- | --- | --- |',
    ...metas.map((m) => {
      const charts = m.charts.map((c) => `${c.symbol} ${c.interval} ${c.style.name}${c.barsSource === 'tradingview' ? ' (TradingView bars)' : ''}`).join('<br>');
      const studies = m.charts.map((c) => c.tradingView.studies.join(', ') || '-').join('<br>');
      return `| [${m.scene}](${m.scene}/) | ${cell(charts)} | ${cell(studies)} | ${m.drawings.length} | ${cell(m.description)} |`;
    }),
    '',
    `## Drawing tools (${tools.filter((t) => t.scenes.length).length} of ${tools.length} captured)`,
    '',
    '| Type | Tool | Scenes | Note |',
    '| --- | --- | --- | --- |',
    ...tools.map((t) => `| \`${t.type}\` | ${t.ui} | ${t.scenes.join(', ') || '**not captured**'} | ${cell(t.notCapturable ?? (t.savedAs ? `TradingView saves it as \`${t.savedAs}\`.` : ''))} |`),
    '',
    `## Chart styles (${styles.filter((s) => s.scenes.length).length} of ${styles.length} captured)`,
    '',
    '| Style | Name | Scenes | Note |',
    '| --- | --- | --- | --- |',
    ...styles.map((s) => `| ${s.id} | ${s.name} | ${s.scenes.join(', ') || '**not captured**'} | ${cell(s.notCapturable ?? (s.computed ? 'Bars computed by TradingView, stored as received.' : ''))} |`),
    '',
  ];
  md.push('## Multi-chart layouts', '', `Not captured. ${MULTI_CHART_REASON}`, '');
  if (missing.length) md.push('## Missing', '', ...missing.map((x) => `- ${x}`), '');
  await fs.writeFile(path.join(OUT, 'INDEX.md'), md.join('\n'));
  return missing;
}

async function main() {
  validate(SCENES);
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter((n) => !SCENES.some((s) => s.name === n));
  if (unknown.length) throw new Error(`Unknown scenes: ${unknown.join(', ')}. Known: ${SCENES.map((s) => s.name).join(', ')}`);
  const scenes = wanted.length ? SCENES.filter((s) => wanted.includes(s.name)) : SCENES;
  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(BUILD, { recursive: true });

  const started = Date.now();
  const failed: string[] = [];
  let session: Session | null = null;
  try {
    for (const scene of scenes) {
      console.log(`scene ${scene.name}`);
      for (let attempt = 1; ; attempt++) {
        if (!session || Date.now() - session.openedAt > SESSION_MS) {
          await session?.close();
          session = await openSession();
        }
        try {
          await captureScene(session.page, session.log, session.bases, scene);
          break;
        } catch (e) {
          console.error(`  ${attempt === 1 ? 'retrying on a fresh page' : 'FAILED'} ${scene.name}: ${(e as Error).message}`);
          await session.page.screenshot({ path: path.join(BUILD, `${scene.name}-failure-${attempt}.png`) }).catch(() => undefined);
          await session.close();
          session = null;
          if (attempt === 2) {
            failed.push(scene.name);
            break;
          }
        }
      }
    }
  } finally {
    await session?.close();
  }
  const missing = await writeIndex();
  console.log(`${scenes.length - failed.length} of ${scenes.length} scenes in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  if (missing.length) console.log(`not covered yet: ${missing.join(', ')}`);
  if (failed.length) {
    console.error(`failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
