import type { DrawingBucket, DrawingsRecord, LayoutRecord } from './model';
import { anyStr, isObj, num, obj } from './props';
import { chartIdOf, drawingSourceFromStored, isDrawingType, LayoutParseError, mainSeriesOf, placeDrawing, sameTicker, type TvSource, sourceId } from './tv/content';

/**
 * A layout reduced to what people recognise on screen: charts, panes,
 * indicators and drawings. Built from the raw TradingView JSON in a snapshot.
 * The viewer draws it, the diff compares it, and restore verification counts it.
 */
export interface ParsedLayout {
  uid: string;
  name: string;
  /** TradingView's multi-chart arrangement code: "s" (single), "2h", "2v", "3s", "4", ... */
  arrangement: string;
  charts: ParsedChart[];
  /** Drawings stored in the "_shared" bucket of the drawing storage. */
  sharedDrawings: ParsedDrawing[];
  problems: string[];
}

export interface ParsedChart {
  chartId: string;
  symbol: string;
  shortName: string;
  interval: string;
  /** TradingView series style: 0 bars, 1 candles, 2 line, 3 area, 8 Heikin Ashi, 9 hollow candles, ... */
  style: number;
  seriesState: Record<string, unknown>;
  timezone: string;
  chartProperties: Record<string, unknown>;
  /** TradingView's saved view: pixels per bar, and empty bars right of the last bar. Null when the layout has none. */
  timeScale: { barSpacing: number; rightOffset: number } | null;
  /** z-order of the main series; TradingView draws drawings with a lower z-order under it. */
  seriesZorder: number;
  /** The price scale of the main series. */
  priceScale: PriceScaleState;
  panes: ParsedPane[];
}

export interface ParsedPane {
  index: number;
  stretchFactor: number;
  containsMainSeries: boolean;
  studies: ParsedStudy[];
  drawings: ParsedDrawing[];
  /** The price scale each source of the pane sits on, by source id. Sources TradingView did not list keep the default scale. */
  priceScales: Readonly<Record<string, PriceScaleState>>;
}

/** How a price scale maps values to heights: TradingView's scale modes, in the order of its PriceScaleMode (and lightweight-charts'). */
export const PRICE_SCALE_MODES = ['normal', 'log', 'percentage', 'indexed-to-100'] as const;
export type PriceScaleMode = (typeof PRICE_SCALE_MODES)[number];

/** A price scale as TradingView saved it: `rightAxisesState[].state`, `leftAxisesState[].state` or `overlayPriceScales[id]`. */
export interface PriceScaleState {
  mode: PriceScaleMode;
  inverted: boolean;
  /**
   * Null while the scale fits the data (autoscale). Otherwise the values TradingView keeps between the top
   * and bottom margins, in the mode's own units: log10(price + 0.0001) + 4 on a log scale, percent on a
   * percentage scale, prices otherwise.
   */
  manualRange: { min: number; max: number } | null;
}

export const DEFAULT_PRICE_SCALE: PriceScaleState = { mode: 'normal', inverted: false, manualRange: null };

/** One saved scale state. Percentage and indexed-to-100 win over log, as in TradingView, which keeps the log flag underneath. */
export function parsePriceScale(raw: unknown): PriceScaleState {
  const s = obj(raw);
  const mode: PriceScaleMode = s.m_isPercentage === true ? 'percentage' : s.m_isIndexedTo100 === true ? 'indexed-to-100' : s.m_isLog === true ? 'log' : 'normal';
  const range = obj(s.m_priceRange);
  const min = num(range.m_minValue, null);
  const max = num(range.m_maxValue, null);
  const manualRange = s.m_isAutoScale === false && min !== null && max !== null && max > min ? { min, max } : null;
  return { mode, inverted: s.m_isInverted === true, manualRange };
}

/** Source id -> scale, from a pane's axis lists and overlay scales. */
function paneScales(pane: Record<string, unknown>): Record<string, PriceScaleState> {
  const out: Record<string, PriceScaleState> = {};
  for (const key of ['leftAxisesState', 'rightAxisesState']) {
    const axes = pane[key];
    if (!Array.isArray(axes)) continue;
    for (const axis of axes.filter(isObj)) {
      const scale = parsePriceScale(axis.state);
      for (const id of Array.isArray(axis.sources) ? axis.sources : []) if (typeof id === 'string') out[id] = scale;
    }
  }
  for (const [id, state] of Object.entries(obj(pane.overlayPriceScales))) out[id] = parsePriceScale(state);
  return out;
}

export interface PlotDef {
  id: string;
  type: string;
  target?: string;
}

export interface ParsedStudy {
  id: string;
  /** e.g. "BB@tv-basicstudies-280" or "Script$USER;abc123@tv-scripting-101" */
  metaInfoId: string;
  name: string;
  shortName: string;
  isPine: boolean;
  isPriceStudy: boolean;
  visible: boolean;
  inputs: Record<string, unknown>;
  styles: Record<string, Record<string, unknown>>;
  plots: PlotDef[];
  state: Record<string, unknown>;
  metaInfo: Record<string, unknown> | null;
}

export type DrawingOrigin = 'content' | `storage:${string}` | 'user';

export interface DrawingPoint {
  /** Unix seconds. */
  time: number;
  /** Bars to the right of `time`, for points placed in the future. */
  offset: number;
  price: number;
}

export interface ParsedDrawing {
  id: string;
  /** TradingView tool type, e.g. "LineToolTrendLine". */
  type: string;
  points: DrawingPoint[];
  /** Style and text properties exactly as TradingView stored them. */
  props: Record<string, unknown>;
  symbol: string | null;
  ownerSource: string | null;
  visible: boolean;
  zorder: number;
  origin: DrawingOrigin;
  /** The complete source object, in the format TradingView keeps inside layout content. */
  source: TvSource;
}


const STUDY_TYPES = /^(Study|study_|StudyStrategy|study$)/;
export const isStudyType = (type: unknown): boolean => typeof type === 'string' && STUDY_TYPES.test(type);

export function parseDrawing(source: TvSource, origin: DrawingOrigin): ParsedDrawing {
  const props = obj(source.state);
  const points = Array.isArray(source.points) ? source.points : [];
  return {
    id: sourceId(source),
    type: anyStr(source.type),
    points: points.filter(isObj).map((p) => ({ time: num(p.time_t, 0), offset: num(p.offset, 0), price: num(p.price, 0) })),
    props,
    symbol: typeof props.symbol === 'string' ? props.symbol : null,
    ownerSource: typeof source.ownerSource === 'string' ? source.ownerSource : null,
    visible: props.visible !== false,
    zorder: num(source.zorder, 0),
    origin,
    source,
  };
}

function drawingsOfBucket(bucket: DrawingBucket, origin: DrawingOrigin): { drawings: ParsedDrawing[]; problems: string[] } {
  const drawings: ParsedDrawing[] = [];
  const problems: string[] = [];
  for (const [id, stored] of Object.entries(bucket.sources)) {
    try {
      drawings.push(parseDrawing(drawingSourceFromStored(id, stored), origin));
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return { drawings, problems };
}

function resolveMetaInfo(source: TvSource, map: Record<string, Record<string, unknown>>): Record<string, unknown> | null {
  const m = source.metaInfo;
  if (isObj(m)) return m;
  if (typeof m === 'string') return map[m] ?? null;
  return null;
}

function metaInfoId(source: TvSource, meta: Record<string, unknown> | null): string {
  if (typeof source.metaInfo === 'string') return source.metaInfo;
  if (meta) return anyStr(meta.fullId) || anyStr(meta.id);
  return '';
}

function parseStudy(source: TvSource, map: Record<string, Record<string, unknown>>): ParsedStudy {
  const meta = resolveMetaInfo(source, map);
  const state = obj(source.state);
  const id = metaInfoId(source, meta);
  const plots = meta && Array.isArray(meta.plots) ? meta.plots.filter(isObj).map((p) => ({ id: anyStr(p.id), type: anyStr(p.type), ...(typeof p.target === 'string' ? { target: p.target } : {}) })) : [];
  const styles = isObj(state.styles) ? (state.styles as Record<string, Record<string, unknown>>) : {};
  return {
    id: sourceId(source),
    metaInfoId: id,
    name: anyStr(meta?.description, anyStr(state.description, id)),
    shortName: anyStr(meta?.shortDescription, anyStr(meta?.description, id)),
    isPine: id.startsWith('Script') || isObj(meta?.pine) || anyStr(meta?.productId) === 'pine' || meta?.isTVScript === true,
    isPriceStudy: meta?.is_price_study === true,
    visible: state.visible !== false,
    inputs: isObj(state.inputs) ? state.inputs : {},
    styles,
    plots,
    state,
    metaInfo: meta,
  };
}

/**
 * Parse TradingView's `content` JSON plus the drawing storage buckets of one
 * layout. Drawings synced to all layouts (`userDrawings`) join the shared ones.
 */
export function parseLayout(record: LayoutRecord, drawings: DrawingsRecord | null, userDrawings: DrawingBucket | null = null): ParsedLayout {
  const content = record.content;
  if (content.charts.length === 0) throw new LayoutParseError(`Layout "${record.name}" has no charts in it.`);
  const problems: string[] = [];
  const seen = new Set<string>();

  const charts = content.charts.map((chart, chartIndex): ParsedChart => {
    const chartId = chartIdOf(chart, chartIndex);
    const panes = chart.panes.map((pane, index): ParsedPane => {
      const drawingsHere = pane.sources.filter((s) => isDrawingType(s.type)).map((s) => parseDrawing(s, 'content'));
      for (const d of drawingsHere) seen.add(d.id);
      return {
        index,
        stretchFactor: num(pane.stretchFactor, 1000),
        containsMainSeries: pane.sources.some((s) => s.type === 'MainSeries'),
        studies: pane.sources.filter((s) => isStudyType(s.type)).map((s) => parseStudy(s, record.studyMetaInfoMap)),
        drawings: drawingsHere,
        priceScales: paneScales(pane),
      };
    });
    const main = mainSeriesOf(chart);
    if (!main) throw new LayoutParseError(`Chart ${chartId} in "${record.name}" has no price series.`);
    const seriesState = obj(main.state);
    const ts = obj(chart.timeScale);
    const barSpacing = num(ts.m_barSpacing, null);
    return {
      chartId,
      symbol: anyStr(seriesState.symbol),
      shortName: anyStr(seriesState.shortName, anyStr(seriesState.symbol)),
      interval: anyStr(seriesState.interval, 'D'),
      style: num(seriesState.style, 1),
      seriesState,
      timezone: anyStr(chart.timezone, 'Etc/UTC'),
      chartProperties: isObj(chart.chartProperties) ? chart.chartProperties : {},
      timeScale: barSpacing !== null && barSpacing > 0 ? { barSpacing, rightOffset: num(ts.m_rightOffset, 0) } : null,
      seriesZorder: num(main.zorder, 0),
      priceScale: panes.find((p) => p.containsMainSeries)?.priceScales[sourceId(main)] ?? DEFAULT_PRICE_SCALE,
      panes,
    };
  });

  const sharedDrawings: ParsedDrawing[] = [];
  for (const [bucketId, bucket] of Object.entries(drawings?.buckets ?? {})) {
    const parsed = drawingsOfBucket(bucket, `storage:${bucketId}`);
    problems.push(...parsed.problems);
    for (const d of parsed.drawings) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const at = placeDrawing(content, bucketId, d.source);
      if (at === 'shared') sharedDrawings.push(d);
      else charts[at.chart]!.panes[at.pane]!.drawings.push(d);
    }
  }
  if (userDrawings) {
    const parsed = drawingsOfBucket(userDrawings, 'user');
    problems.push(...parsed.problems);
    sharedDrawings.push(...parsed.drawings.filter((d) => !seen.has(d.id)));
  }

  return { uid: record.uid, name: record.name, arrangement: anyStr(content.layout, 's'), charts, sharedDrawings, problems };
}

/** Drawings that belong on a chart: its own plus shared ones for the same symbol. */
export function drawingsForChart(layout: ParsedLayout, chart: ParsedChart): ParsedDrawing[] {
  const own = chart.panes.flatMap((p) => p.drawings);
  const shared = layout.sharedDrawings.filter((d) => d.symbol === null || d.symbol === chart.symbol || sameTicker(d.symbol, chart.symbol));
  return [...own, ...shared];
}

export interface LayoutCounts {
  charts: number;
  drawings: number;
  studies: number;
  drawingIds: string[];
  studyIds: string[];
  symbols: string[];
}

export function countLayout(layout: ParsedLayout): LayoutCounts {
  const drawingIds = [...layout.charts.flatMap((c) => c.panes.flatMap((p) => p.drawings.map((d) => d.id))), ...layout.sharedDrawings.map((d) => d.id)].sort();
  const studyIds = layout.charts.flatMap((c) => c.panes.flatMap((p) => p.studies.map((s) => s.id))).sort();
  return {
    charts: layout.charts.length,
    drawings: drawingIds.length,
    studies: studyIds.length,
    drawingIds,
    studyIds,
    symbols: [...new Set(layout.charts.map((c) => c.symbol))],
  };
}
