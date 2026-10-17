import { z } from 'zod';
import { isObj } from '../props';

/**
 * TradingView's layout `content`: charts -> panes -> sources. Only the fields
 * ChartKeeper walks are declared; everything else passes through untouched.
 * See docs/INVESTIGATION.md, "Layout content".
 */
// Sources stay permissive: one odd indicator or drawing must not make a whole
// backup INCOMPLETE or stop an old backup from opening. Readers check fields as they use them.
const TvSourceShape = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.unknown().optional(),
  state: z.unknown().optional(),
  ownerSource: z.unknown().optional(),
});
const TvPaneShape = z.looseObject({ sources: z.array(TvSourceShape) });
const TvChartShape = z.looseObject({ chartId: z.union([z.string(), z.number()]).optional(), panes: z.array(TvPaneShape) });
const TvContentShape = z.looseObject({ charts: z.array(TvChartShape) });

export type TvSource = z.infer<typeof TvSourceShape>;
export type TvPane = z.infer<typeof TvPaneShape>;
export type TvChart = z.infer<typeof TvChartShape>;
export type TvContent = z.infer<typeof TvContentShape>;

/**
 * Checks the shape but keeps the value itself. zod's output rebuilds every
 * object with the declared keys first, and this content goes back to
 * TradingView exactly as it was stored.
 */
export const TvContentSchema = z.custom<TvContent>().superRefine((value, ctx) => {
  const r = TvContentShape.safeParse(value);
  if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
});

const isTvSource = (v: unknown): v is TvSource => TvSourceShape.safeParse(v).success;

export class LayoutParseError extends Error {}

/** A source's id as text (TradingView ids are strings; a number is tolerated). */
export const sourceId = (s: TvSource): string => (s.id === undefined ? '' : String(s.id));

export const isDrawingType = (type: unknown): type is string => typeof type === 'string' && type.startsWith('LineTool');

/** The storage id of chart `index`: "1", "2", ... Drawing buckets and chart-<id>.json price files use the same key. */
export const chartIdOf = (chart: TvChart, index: number): string => (chart.chartId === undefined ? String(index + 1) : String(chart.chartId));

export const mainSeriesOf = (chart: TvChart): TvSource | undefined => chart.panes.flatMap((p) => p.sources).find((s) => s.type === 'MainSeries');

const symbolOf = (source: TvSource | undefined): string | null => (isObj(source?.state) && typeof source.state.symbol === 'string' ? source.state.symbol : null);

/** "BATS:AAPL" and "NASDAQ:AAPL" are the same company; TradingView shares drawings between them. */
export function sameTicker(a: string, b: string): boolean {
  const t = (s: string) => s.split(':').pop() ?? s;
  return t(a) === t(b);
}

/**
 * Turn one stored drawing (from drawing storage) into the content-source
 * shape `{type, id, state, points, ...}`.
 *
 * The storage DTO is `{id, ownerSource, state, symbol?, ...}`. Its `state` is
 * the drawing's own serialized state, which is the content-source shape. We
 * also accept a DTO whose `state` holds only the properties, with `type` and
 * `points` next to it, because TradingView has used both layouts over time.
 */
export function drawingSourceFromStored(id: string, stored: Record<string, unknown>): TvSource {
  const inner = stored.state;
  let source: unknown = null;
  if (isObj(inner) && isDrawingType(inner.type) && Array.isArray(inner.points)) {
    source = { ...inner, id: typeof inner.id === 'string' ? inner.id : id, ownerSource: inner.ownerSource ?? stored.ownerSource };
  } else if (isDrawingType(stored.type) && Array.isArray(stored.points) && isObj(inner)) {
    source = { type: stored.type, id, state: inner, points: stored.points, zorder: stored.zorder ?? 0, ownerSource: stored.ownerSource };
  }
  if (!isTvSource(source)) throw new LayoutParseError(`Drawing ${id} has a format ChartKeeper does not recognise.`);
  return source;
}

export interface Placement {
  chart: number;
  pane: number;
}

/** The pane holding the drawing's owner (its price series or indicator), else the price pane. */
function ownerPane(chart: TvChart, owner: unknown): number {
  const byOwner = owner === undefined || owner === null ? -1 : chart.panes.findIndex((p) => p.sources.some((s) => s.id !== undefined && String(s.id) === String(owner)));
  if (byOwner >= 0) return byOwner;
  return Math.max(0, chart.panes.findIndex((p) => p.sources.some((s) => s.type === 'MainSeries')));
}

/** Where a drawing from storage bucket `bucketId` belongs. "_shared" drawings belong to no single chart. */
export function placeDrawing(content: TvContent, bucketId: string, source: TvSource): Placement | 'shared' {
  if (bucketId === '_shared') return 'shared';
  const chart = Math.max(0, content.charts.findIndex((c, i) => chartIdOf(c, i) === bucketId));
  return { chart, pane: ownerPane(content.charts[chart]!, source.ownerSource) };
}

/** A shared drawing goes on the first chart showing its ticker, else the first chart. */
export function placeShared(content: TvContent, source: TvSource): Placement {
  const symbol = symbolOf(source);
  const chart = Math.max(0, content.charts.findIndex((c) => symbol !== null && sameTicker(symbolOf(mainSeriesOf(c)) ?? '', symbol)));
  return { chart, pane: ownerPane(content.charts[chart]!, source.ownerSource) };
}
