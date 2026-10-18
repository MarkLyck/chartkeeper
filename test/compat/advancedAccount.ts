import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isObj, type Props } from '../../src/core/props';
import type { TvChart, TvContent, TvSource } from '../../src/core/tv/content';
import type { FakeLayout } from '../fakes/fakeTradingView';
import { FIXTURES } from '../fakes/fixtures';

/** Where the account keeps a drawing: inside the layout content, or in a drawing storage bucket. */
export type StoredIn = 'content' | 'storage:1' | 'storage:2' | 'storage:_shared';

export interface ExpectedDrawing {
  id: string;
  type: string;
  storedIn: StoredIn;
  /** Chart index and pane index the drawing must end up in after a restore. */
  chart: number;
  pane: number;
  /** The drawing source exactly as the account holds it. */
  source: TvSource;
}

export interface ExpectedStudy {
  id: string;
  chart: number;
  pane: number;
  metaInfo: string;
  inputs: Props;
  styles: Props;
}

export interface ExpectedChart {
  chartId: string;
  timezone: string;
  chartProperties: Props;
  timeScale: Props;
  /** The MainSeries state: symbol, interval, style and every series style property. */
  series: Props;
  /** Pane price-scale state (log, percentage, ...) of the price pane. */
  priceScale: Props;
}

export interface ExpectedLayout {
  uid: string;
  name: string;
  arrangement: string;
  /** Layout-level settings such as crosshairLock. */
  settings: Props;
  charts: ExpectedChart[];
  drawings: ExpectedDrawing[];
  studies: ExpectedStudy[];
}

export interface AdvancedAccount {
  layouts: FakeLayout[];
  expected: ExpectedLayout[];
}

interface LineToolsFixture {
  tradingViewBuild: string | null;
  unsupportedSignedOut: Record<string, string>;
  tools: Record<string, TvSource>;
}

export const lineToolsFixture = (): LineToolsFixture => JSON.parse(readFileSync(path.join(FIXTURES, 'compat/line-tools.json'), 'utf8'));

const savedLayout = () => {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES, 'tv-saved-layout.json'), 'utf8')) as { content: string; study_meta_info_map: string };
  return { content: JSON.parse(raw.content) as TvContent, meta: JSON.parse(raw.study_meta_info_map) as Record<string, Props> };
};
const referenceLayout = () => JSON.parse(readFileSync(path.join(FIXTURES, 'reference-snapshot/layouts/RefAAPL1/layout.json'), 'utf8')) as { content: TvContent; studyMetaInfoMap: Record<string, Props> };

/** A stable, distinct "#rrggbb" for each seed, so every customized color differs from TradingView's defaults and from each other. */
function colorFor(seed: string): string {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `#${((h >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
}

const isColor = (v: unknown) => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\(.*\))$/i.test(v);
/** Bookkeeping fields TradingView owns; changing them would not be a user's style choice. */
const NOT_STYLE = new Set(['symbol', 'interval', 'currencyId', 'unitId', 'metricId', 'symbolStateVersion', 'zOrderVersion', 'adjustedToSplitTime', 'frozen', 'visible', 'title', 'anchored', 'intervalsVisibilities', 'display', 'plottype', 'inputs', 'inputInfo']);

/**
 * Sets every color, line width, font size, transparency, text and
 * bold/italic/extend/show flag to a value a user could pick that differs
 * from TradingView's default, recursing into nested style groups such as
 * Fibonacci levels.
 */
export function customizeStyle(value: Props, seed: string): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(value)) {
    const at = `${seed}.${k}`;
    if (NOT_STYLE.has(k)) out[k] = v;
    else if (isObj(v)) out[k] = customizeStyle(v, at);
    else if (isColor(v)) out[k] = colorFor(at);
    else if (k === 'text' && typeof v === 'string') out[k] = `Custom text: ${seed}`;
    else if (/^line[wW]idth$/.test(k) && typeof v === 'number') out[k] = v === 3 ? 2 : 3;
    else if (/^font[sS]ize$/.test(k) && typeof v === 'number') out[k] = v === 20 ? 16 : 20;
    else if (/[tT]ransparency$/.test(k) && typeof v === 'number') out[k] = v === 37 ? 40 : 37;
    else if (/^(bold|italic|extendLeft|extendRight|show[A-Z]\w*)$/.test(k) && typeof v === 'boolean') out[k] = !v;
    else out[k] = v;
  }
  return out;
}

const DAY = 86400;
const HOUR = 3600;

interface ChartSpec {
  symbol: string;
  interval: string;
  /** The interval as drawings store it ("1D" for "D"). */
  drawingInterval: string;
  /** Start of the first point and the spacing between points, aligned to the chart's bars. */
  firstTime: number;
  step: number;
  basePrice: number;
}

const AAPL_D: ChartSpec = { symbol: 'NASDAQ:AAPL', interval: 'D', drawingInterval: '1D', firstTime: Date.UTC(2026, 3, 1) / 1000, step: 7 * DAY, basePrice: 250 };
const MSFT_60: ChartSpec = { symbol: 'NASDAQ:MSFT', interval: '60', drawingInterval: '60', firstTime: Date.UTC(2026, 8, 1, 14) / 1000, step: 2 * HOUR, basePrice: 410 };

/** The fixture draws every tool from this bar, one week per point step, from this price. */
const FIXTURE_START = Date.UTC(2026, 3, 1) / 1000;
const FIXTURE_STEP = 7 * DAY;
const FIXTURE_PRICE = 250;

/**
 * One fixture tool, customized and moved onto `chart`'s bars and prices.
 * Points keep their relative layout from the fixture, because TradingView
 * ties some points together (a parallel channel's third point shares the
 * first point's time). `futureOffset` puts the last point that many bars past its time.
 */
function drawing(template: TvSource, id: string, chart: ChartSpec, zorder: number, owner = '_seriesId', futureOffset = 0): TvSource {
  const points = (Array.isArray(template.points) ? (template.points as Props[]) : []).map((p, k, all) => ({
    time_t: chart.firstTime + ((Number(p.time_t) - FIXTURE_START) / FIXTURE_STEP) * chart.step,
    offset: futureOffset && k === all.length - 1 ? futureOffset : 0,
    price: chart.basePrice + (Number(p.price) - FIXTURE_PRICE) + 0.25,
    interval: chart.drawingInterval,
  }));
  const source: TvSource = {
    ...structuredClone(template),
    id,
    state: { ...customizeStyle(isObj(template.state) ? template.state : {}, id), symbol: chart.symbol, interval: chart.drawingInterval },
    points,
    zorder,
    ownerSource: owner,
    linkKey: `lk${id}`,
  };
  if (isObj(template.positionPercents)) source.positionPercents = { x: 0.31, y: 0.42 };
  return source;
}

/** The drawing storage's DTO around a source, as charts-storage.tradingview.com returns it. */
const storedDto = (source: TvSource, symbol: string) => ({ id: source.id, ownerSource: source.ownerSource, state: source, symbol, currencyId: null, unitId: null, serverUpdateTime: 1792000000 });

/** Inputs a user changed: numbers moved inside their allowed range, another option picked, booleans flipped. Pine bookkeeping inputs stay. */
function customizeInputs(inputs: Props, meta: Props | undefined): Props {
  const defs = Array.isArray(meta?.inputs) ? (meta.inputs as Props[]) : [];
  const out: Props = { ...inputs };
  for (const def of defs) {
    const id = String(def.id);
    const v = inputs[id];
    if (v === undefined || id.startsWith('__') || id.startsWith('pine')) continue;
    const options = Array.isArray(def.options) ? def.options : null;
    if (options && options.length > 1) out[id] = options[(options.indexOf(v) + 2) % options.length];
    else if (def.type === 'integer' && typeof v === 'number') out[id] = Math.min(Number(def.max ?? Infinity), v + 7);
    else if (def.type === 'float' && typeof v === 'number') out[id] = v + 0.5;
    else if (def.type === 'bool' && typeof v === 'boolean') out[id] = !v;
  }
  return out;
}

function study(template: TvSource, meta: Record<string, Props>): TvSource {
  const state = structuredClone(template.state) as Props;
  state.inputs = customizeInputs(state.inputs as Props, meta[String(template.metaInfo)]);
  state.styles = customizeStyle(state.styles as Props, `${template.id}`);
  return { ...structuredClone(template), state };
}

/** A pane holding one indicator, shaped like TradingView's own (price scale listing that indicator). */
function indicatorPane(model: Props, studyId: string): Props {
  const pane = structuredClone(model);
  pane.mainSourceId = studyId;
  const axis = (pane.rightAxisesState as { state: Props; sources: string[] }[])[0]!;
  axis.state.id = `axis${studyId}`;
  axis.sources = [studyId];
  return pane;
}

function chartFrom(template: TvChart, chartId: string, spec: ChartSpec, seriesStyle: number, customize: (chart: TvChart, series: Props, priceScale: Props) => void): TvChart {
  const chart = structuredClone(template);
  chart.chartId = chartId;
  const series = chart.panes[0]!.sources.find((s) => s.type === 'MainSeries')!;
  const state = series.state as Props;
  Object.assign(state, { symbol: spec.symbol, shortName: spec.symbol.split(':')[1], interval: spec.interval, style: seriesStyle });
  const pricePane = chart.panes[0]!;
  const overlays = pricePane.overlayPriceScales as Props;
  const ids = pricePane.sources.map((s) => String(s.id));
  pricePane.overlayPriceScales = Object.fromEntries(Object.entries(overlays).filter(([id]) => ids.includes(id)));
  const axis = (pricePane.rightAxisesState as { state: Props; sources: string[] }[])[0]!;
  axis.sources = ids.filter((id) => !(id in overlays));
  customize(chart, state, axis.state);
  return chart;
}

/** A drawing kept inside the content, listed on the price scale the way TradingView saves it. */
function addToPricePane(chart: TvChart, source: TvSource) {
  const pane = chart.panes[0]!;
  pane.sources.push(source);
  (pane.rightAxisesState as { sources: string[] }[])[0]!.sources.push(String(source.id));
}

const expectedChart = (chart: TvChart): ExpectedChart => {
  const series = chart.panes[0]!.sources.find((s) => s.type === 'MainSeries')!;
  return {
    chartId: String(chart.chartId),
    timezone: String(chart.timezone),
    chartProperties: structuredClone(chart.chartProperties) as Props,
    timeScale: structuredClone(chart.timeScale) as Props,
    series: structuredClone(series.state) as Props,
    priceScale: structuredClone((chart.panes[0]!.rightAxisesState as { state: Props }[])[0]!.state),
  };
};

const studyOf = (s: TvSource, chart: number, pane: number): ExpectedStudy => {
  const state = s.state as Props;
  return { id: String(s.id), chart, pane, metaInfo: String(s.metaInfo), inputs: structuredClone(state.inputs) as Props, styles: structuredClone(state.styles) as Props };
};

/**
 * An "advanced" TradingView account, built from real TradingView data
 * (test/fixtures): two layouts that together use every drawing tool a
 * signed-out chart can load, in every place a real account keeps drawings,
 * with customized styles, indicators with changed inputs and styles,
 * customized chart properties, and a two-chart layout.
 *
 * Returns the account for FakeTradingView and, built alongside it, the
 * features a restore must keep. The expectation never goes through
 * ChartKeeper's own parsing or placement code.
 */
export function advancedAccount(): AdvancedAccount {
  const saved = savedLayout();
  const reference = referenceLayout();
  const meta = { ...saved.meta, ...reference.studyMetaInfoMap };
  const tools = lineToolsFixture().tools;

  const template = saved.content.charts[0]!;
  const templateSources = template.panes.flatMap((p) => p.sources);
  const bySavedId = (id: string) => templateSources.find((s) => s.id === id)!;
  const referenceStudies = reference.content.charts[0]!.panes.flatMap((p) => p.sources).filter((s) => s.metaInfo);
  const byRefId = (id: string) => referenceStudies.find((s) => s.id === id)!;
  const pricePaneModel = Object.fromEntries(Object.entries(template.panes[0]!).filter(([k]) => k !== 'sources'));
  const indicatorPaneModel = Object.fromEntries(Object.entries(template.panes[1]!).filter(([k]) => k !== 'sources'));

  // Layout 1: every tool on one AAPL daily chart, five indicators in three panes.
  const volume = study(bySavedId('8rwg3A'), meta);
  const bollinger = study(bySavedId('CRwkdm'), meta);
  const rsiPine = study(bySavedId('q1aEhE'), meta);
  const smaLegacy = study(byRefId('TKTOAM'), meta);
  const rsiLegacy = study(byRefId('YuxZ0W'), meta);
  const main1 = structuredClone(template.panes[0]!.sources.find((s) => s.type === 'MainSeries')!);
  const every = chartFrom({ ...template, panes: [{ ...pricePaneModel, sources: [main1, volume, bollinger, smaLegacy] }, { ...indicatorPaneModel, sources: [rsiPine] }, { ...indicatorPane(indicatorPaneModel, 'YuxZ0W'), sources: [rsiLegacy] }] } as TvChart, '1', AAPL_D, 1, (chart, series, priceScale) => {
    chart.timezone = 'America/New_York';
    chart.timeScale = { ...(chart.timeScale as Props), m_barSpacing: 9, m_rightOffset: 15 };
    chart.chartProperties = customizeStyle(chart.chartProperties as Props, 'chart1');
    Object.assign(series.candleStyle as Props, { upColor: '#00897b', downColor: '#d81b60', borderUpColor: '#00695c', borderDownColor: '#ad1457', wickUpColor: '#26a69a', wickDownColor: '#ec407a', drawBorder: false });
    Object.assign(series.priceAxisProperties as Props, { log: true, autoScale: true });
    Object.assign(series, { showCountdown: true, priceLineColor: '#5e35b1' });
    priceScale.m_isLog = true;
  });

  const storage1: FakeLayout['storage'] = { '1': {}, _shared: {} };
  const drawings1: ExpectedDrawing[] = [];
  const places: StoredIn[] = ['content', 'storage:1', 'storage:_shared'];
  Object.entries(tools).forEach(([type, tool], i) => {
    const id = `t${String(i).padStart(2, '0')}${type.replace('LineTool', '').slice(0, 8)}`;
    const future = type === 'LineToolTrendLine' || type === 'LineToolRay' ? 5 : 0;
    const source = drawing(tool, id, AAPL_D, -4000 + i, '_seriesId', future);
    const storedIn = places[i % places.length]!;
    if (storedIn === 'content') addToPricePane(every, source);
    else storage1[storedIn.slice('storage:'.length)]![id] = storedDto(source, AAPL_D.symbol);
    drawings1.push({ id, type, storedIn, chart: 0, pane: 0, source });
  });
  // A drawing on the RSI pane: TradingView keeps its owner, and restore must put it back in that pane.
  const onRsi = drawing(tools.LineToolHorzLine!, 'rsiLevel', AAPL_D, -3000, 'q1aEhE');
  (onRsi.points as Props[])[0]!.price = 63.5;
  storage1['1']!.rsiLevel = storedDto(onRsi, AAPL_D.symbol);
  drawings1.push({ id: 'rsiLevel', type: 'LineToolHorzLine', storedIn: 'storage:1', chart: 0, pane: 1, source: onRsi });

  const content1: TvContent = { ...structuredClone(saved.content), name: 'Every tool', layout: 's', charts: [every], crosshairLock: 0 };
  const layout1: FakeLayout = { uid: 'AdvAll01', id: 601, name: 'Every tool', content: content1, studyMeta: meta, storage: storage1, listExtra: { symbol: AAPL_D.symbol, resolution: '1D', short_name: 'AAPL' } };
  const expected1: ExpectedLayout = {
    uid: layout1.uid,
    name: layout1.name,
    arrangement: 's',
    settings: { crosshairLock: 0 },
    charts: [expectedChart(every)],
    drawings: drawings1,
    studies: [studyOf(volume, 0, 0), studyOf(bollinger, 0, 0), studyOf(smaLegacy, 0, 0), studyOf(rsiPine, 0, 1), studyOf(rsiLegacy, 0, 2)],
  };

  // Layout 2: two charts side by side, AAPL daily candles and MSFT hourly Heikin Ashi, drawings in every bucket.
  const bollinger2 = { ...study(bySavedId('CRwkdm'), meta), id: 'bb2Aapl' };
  const left = chartFrom({ ...template, panes: [{ ...pricePaneModel, sources: [structuredClone(main1), bollinger2] }] } as TvChart, '1', AAPL_D, 9, (chart, series) => {
    chart.timezone = 'Asia/Tokyo';
    chart.chartProperties = customizeStyle(chart.chartProperties as Props, 'two-left');
    Object.assign(series.hollowCandleStyle as Props, { upColor: '#43a047', downColor: '#e53935' });
  });
  const right = chartFrom({ ...template, panes: [{ ...pricePaneModel, sources: [structuredClone(main1)] }] } as TvChart, '2', MSFT_60, 8, (chart, series, priceScale) => {
    chart.timezone = 'Europe/London';
    chart.timeScale = { ...(chart.timeScale as Props), m_barSpacing: 4 };
    chart.chartProperties = customizeStyle(chart.chartProperties as Props, 'two-right');
    Object.assign(series.haStyle as Props, { upColor: '#1e88e5', downColor: '#fb8c00', drawWick: false });
    Object.assign(series.priceAxisProperties as Props, { percentage: true });
    priceScale.m_isPercentage = true;
  });
  const storage2: FakeLayout['storage'] = { '1': {}, '2': {}, _shared: {} };
  const drawings2: ExpectedDrawing[] = [];
  const put = (type: string, id: string, chart: 0 | 1, storedIn: StoredIn, zorder: number) => {
    const spec = chart === 0 ? AAPL_D : MSFT_60;
    const source = drawing(tools[type]!, id, spec, zorder);
    if (storedIn === 'content') addToPricePane([left, right][chart]!, source);
    else storage2[storedIn.slice('storage:'.length)]![id] = storedDto(source, spec.symbol);
    drawings2.push({ id, type, storedIn, chart, pane: 0, source });
  };
  put('LineToolTrendLine', 'twoAaplTrend', 0, 'content', -900);
  put('LineToolRectangle', 'twoAaplRect', 0, 'storage:1', -899);
  put('LineToolHorzLine', 'twoMsftHline', 1, 'content', -898);
  put('LineToolFibRetracement', 'twoMsftFib', 1, 'storage:2', -897);
  put('LineToolText', 'twoMsftText', 1, 'storage:2', -896);
  // A shared drawing for MSFT: restore must put it on the MSFT chart, not the first chart.
  put('LineToolCallout', 'twoMsftShared', 1, 'storage:_shared', -895);
  put('LineToolPriceLabel', 'twoAaplShared', 0, 'storage:_shared', -894);

  const content2: TvContent = { ...structuredClone(saved.content), name: 'Two charts', layout: '2h', charts: [left, right], crosshairLock: 1, layoutsSizes: { '2h': [{ percent: 0.6 }, { percent: 0.4 }] } };
  const layout2: FakeLayout = { uid: 'AdvTwo02', id: 602, name: 'Two charts', content: content2, studyMeta: meta, storage: storage2, listExtra: { symbol: AAPL_D.symbol, resolution: '1D', short_name: 'AAPL' } };
  const expected2: ExpectedLayout = {
    uid: layout2.uid,
    name: layout2.name,
    arrangement: '2h',
    settings: { crosshairLock: 1, layoutsSizes: { '2h': [{ percent: 0.6 }, { percent: 0.4 }] } },
    charts: [expectedChart(left), expectedChart(right)],
    drawings: drawings2,
    studies: [studyOf(bollinger2, 0, 0)],
  };

  const [layout3, expected3] = replicaInAccount();
  return { layouts: [layout1, layout2, layout3], expected: [expected1, expected2, expected3] };
}

/**
 * Layout 3: the gallery's copy of a user's real chart (TSX Venture weekly) exactly as TradingView saved
 * it: a log price scale, the view scrolled 950 bars past the last bar, points as far out as 2043, sine
 * lines, time cycles, a fib time zone, Elliott waves in eight degrees, text, a box and paths. Its drawings
 * are spread over the content and both storage buckets, the places a real account keeps them.
 */
function replicaInAccount(): [FakeLayout, ExpectedLayout] {
  const scene = 'replica-tsxv-weekly-log';
  const record = JSON.parse(readFileSync(path.join(FIXTURES, `gallery/${scene}/layouts/${scene}/layout.json`), 'utf8')) as { content: TvContent; studyMetaInfoMap: Record<string, Props> };
  const content = structuredClone(record.content);
  const chart = content.charts[0]!;
  const pane = chart.panes[0]!;
  const axis = (pane.rightAxisesState as { sources: string[] }[])[0]!;
  const symbol = 'TSX:JX';
  const storage: FakeLayout['storage'] = { '1': {}, _shared: {} };
  const places: StoredIn[] = ['content', 'storage:1', 'storage:_shared'];
  const drawings: ExpectedDrawing[] = pane.sources
    .filter((s) => String(s.type).startsWith('LineTool'))
    .map((source, i) => {
      const storedIn = places[i % places.length]!;
      if (storedIn !== 'content') {
        pane.sources = pane.sources.filter((s) => s !== source);
        axis.sources = axis.sources.filter((id) => id !== source.id);
        storage[storedIn.slice('storage:'.length)]![String(source.id)] = storedDto(source, symbol);
      }
      return { id: String(source.id), type: String(source.type), storedIn, chart: 0, pane: 0, source: structuredClone(source) };
    });
  const layout: FakeLayout = { uid: 'AdvRepl3', id: 603, name: 'TSX Venture replica', content: { ...content, name: 'TSX Venture replica' }, studyMeta: record.studyMetaInfoMap, storage, listExtra: { symbol, resolution: '1W', short_name: 'JX' } };
  const expected: ExpectedLayout = { uid: layout.uid, name: layout.name, arrangement: 's', settings: {}, charts: [expectedChart(chart)], drawings, studies: [] };
  return [layout, expected];
}
