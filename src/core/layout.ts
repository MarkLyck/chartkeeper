import type { DrawingBucket, DrawingsRecord, LayoutRecord } from './model';
import { chartIdOf, drawingSourceFromStored, isDrawingType, isObj, LayoutParseError, mainSeriesOf, placeDrawing, sameTicker, type TvSource } from './tv/content';

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
  panes: ParsedPane[];
}

export interface ParsedPane {
  index: number;
  stretchFactor: number;
  containsMainSeries: boolean;
  studies: ParsedStudy[];
  drawings: ParsedDrawing[];
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

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const STUDY_TYPES = /^(Study|study_|StudyStrategy|study$)/;
export const isStudyType = (type: unknown): boolean => typeof type === 'string' && STUDY_TYPES.test(type);

export function parseDrawing(source: TvSource, origin: DrawingOrigin): ParsedDrawing {
  const props = source.state ?? {};
  const points = Array.isArray(source.points) ? source.points : [];
  return {
    id: source.id,
    type: source.type,
    points: points.filter(isObj).map((p) => ({ time: num(p.time_t), offset: num(p.offset), price: num(p.price) })),
    props,
    symbol: typeof props.symbol === 'string' ? props.symbol : null,
    ownerSource: typeof source.ownerSource === 'string' ? source.ownerSource : null,
    visible: props.visible !== false,
    zorder: num(source.zorder),
    origin,
    source,
  };
}

export function parseBucket(bucket: DrawingBucket, origin: DrawingOrigin): { drawings: ParsedDrawing[]; problems: string[] } {
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
  if (meta) return str(meta.fullId) || str(meta.id);
  return '';
}

function parseStudy(source: TvSource, map: Record<string, Record<string, unknown>>): ParsedStudy {
  const meta = resolveMetaInfo(source, map);
  const state = source.state ?? {};
  const id = metaInfoId(source, meta);
  const plots = meta && Array.isArray(meta.plots) ? meta.plots.filter(isObj).map((p) => ({ id: str(p.id), type: str(p.type), ...(typeof p.target === 'string' ? { target: p.target } : {}) })) : [];
  const styles = isObj(state.styles) ? (state.styles as Record<string, Record<string, unknown>>) : {};
  return {
    id: source.id,
    metaInfoId: id,
    name: str(meta?.description, str(state.description, id)),
    shortName: str(meta?.shortDescription, str(meta?.description, id)),
    isPine: id.startsWith('Script') || isObj(meta?.pine) || str(meta?.productId) === 'pine',
    isPriceStudy: meta?.is_price_study === true,
    visible: state.visible !== false,
    inputs: isObj(state.inputs) ? state.inputs : {},
    styles,
    plots,
    state,
    metaInfo: meta,
  };
}

/** Parse TradingView's `content` JSON plus the drawing storage buckets of one layout. */
export function parseLayout(record: LayoutRecord, drawings: DrawingsRecord | null): ParsedLayout {
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
      };
    });
    const main = mainSeriesOf(chart);
    if (!main) throw new LayoutParseError(`Chart ${chartId} in "${record.name}" has no price series.`);
    const seriesState = main.state ?? {};
    return {
      chartId,
      symbol: str(seriesState.symbol),
      shortName: str(seriesState.shortName, str(seriesState.symbol)),
      interval: str(seriesState.interval, 'D'),
      style: num(seriesState.style, 1),
      seriesState,
      timezone: str(chart.timezone, 'Etc/UTC'),
      chartProperties: isObj(chart.chartProperties) ? chart.chartProperties : {},
      panes,
    };
  });

  const sharedDrawings: ParsedDrawing[] = [];
  for (const [bucketId, bucket] of Object.entries(drawings?.buckets ?? {})) {
    const parsed = parseBucket(bucket, `storage:${bucketId}`);
    problems.push(...parsed.problems);
    for (const d of parsed.drawings) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const at = placeDrawing(content, bucketId, d.source);
      if (at === 'shared') sharedDrawings.push(d);
      else charts[at.chart]!.panes[at.pane]!.drawings.push(d);
    }
  }

  return { uid: record.uid, name: record.name, arrangement: str(content.layout, 's'), charts, sharedDrawings, problems };
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
