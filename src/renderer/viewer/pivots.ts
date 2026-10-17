import type { ParsedStudy } from '../../core/layout';
import type { Bar } from '../../core/model';
import { num, obj, str, type Props } from '../../core/props';
import { opaque } from './studies';

/**
 * Pivot Points Standard and Pivot Points High Low have no plots: TradingView
 * stores their output in the study's non-series data (`graphics.d`, inflated
 * when the snapshot is opened) plus `graphics.indexes`, which maps the output's
 * point numbers to bar indexes of the series the study ran on. The snapshot
 * stores exactly those bars, so a mapped index is the bar's logical index.
 */

/** Each level, the key it has in a stored period, and the style group TradingView colours it by. */
const LEVELS = [
  ['P', 'p', 'P'],
  ['S1', 's1', 'S1/R1'],
  ['R1', 'r1', 'S1/R1'],
  ['S2', 's2', 'S2/R2'],
  ['R2', 'r2', 'S2/R2'],
  ['S3', 's3', 'S3/R3'],
  ['R3', 'r3', 'S3/R3'],
  ['S4', 's4', 'S4/R4'],
  ['R4', 'r4', 'S4/R4'],
  ['S5', 's5', 'S5/R5'],
  ['R5', 'r5', 'S5/R5'],
] as const;

export type PivotLevelName = (typeof LEVELS)[number][0];

export interface PivotLevel {
  name: PivotLevelName;
  price: number;
  /** Opaque level colour, as TradingView paints the level's price axis label. */
  color: string;
}

/** One horizontal line; levels at the same price share a line and a label like "S1/R1". */
export interface PivotLine {
  price: number;
  label: string;
  color: string;
  width: number;
}

export interface PivotPeriod {
  /** Bar indexes where the period starts and ends; the end may lie past the last bar. */
  start: number;
  end: number;
  levels: PivotLevel[];
  lines: PivotLine[];
}

export interface StandardPivots {
  kind: 'standard';
  periods: PivotPeriod[];
  showLabels: boolean;
  fontSize: number;
  showHistorical: boolean;
  /** Price axis labels with the current period's level prices. */
  axisLabels: boolean;
}

export interface HighLowPivot {
  index: number;
  price: number;
  /** A pivot high is labelled above its bar, a pivot low below. */
  high: boolean;
}

export interface HighLowPivots {
  kind: 'high-low';
  pivots: HighLowPivot[];
  fontSize: number;
  borderColor: string;
  backColor: string;
  textColor: string;
}

export type PivotsPlan = StandardPivots | HighLowPivots;

interface NonSeriesData {
  data: Props;
  indexes: readonly unknown[];
}

function nonSeriesData(graphics: unknown): NonSeriesData | null {
  const g = obj(graphics);
  if (typeof g.d !== 'string' || !Array.isArray(g.indexes)) return null;
  try {
    const data = obj(obj(JSON.parse(g.d)).data);
    return { data, indexes: g.indexes };
  } catch {
    return null;
  }
}

/** Bar index of output point `i`; TradingView marks points before the loaded bars with large negative numbers. */
function barIndex(indexes: readonly unknown[], i: unknown): number | null {
  const v = typeof i === 'number' ? num(indexes[i], null) : null;
  return v === null || v < 0 ? null : v;
}

function standardPivots(study: ParsedStudy, ns: NonSeriesData, axisLabels: boolean): StandardPivots | null {
  const style = obj(study.state.levelsStyle);
  const visible = obj(style.visibility);
  const colors = obj(style.colors);
  const widths = obj(style.widths);
  const periods: PivotPeriod[] = [];
  for (const raw of Array.isArray(ns.data.pivots) ? ns.data.pivots.map(obj) : []) {
    const start = barIndex(ns.indexes, raw.startIndex);
    const end = barIndex(ns.indexes, raw.endIndex);
    if (start === null || end === null) continue;
    const levels: PivotLevel[] = [];
    const lines = new Map<number, PivotLine>();
    for (const [name, key, group] of LEVELS) {
      const price = num(raw[key], null);
      if (price === null || visible[group] === false) continue;
      const color = str(colors[group], '#FB8C00');
      levels.push({ name, price, color: opaque(color) });
      const line = lines.get(price);
      if (line) line.label += `/${name}`;
      else lines.set(price, { price, label: name, color, width: num(widths[group], 1) });
    }
    periods.push({ start, end, levels, lines: [...lines.values()] });
  }
  if (!periods.length) return null;
  return {
    kind: 'standard',
    periods,
    showLabels: style.showLabels !== false,
    fontSize: num(study.state.fontsize, 11),
    showHistorical: study.inputs.showHistoricalPivots !== false,
    axisLabels,
  };
}

function highLowPivots(study: ParsedStudy, ns: NonSeriesData, bars: readonly Bar[]): HighLowPivots | null {
  const pivots: HighLowPivot[] = [];
  for (const raw of Array.isArray(ns.data.pivots) ? ns.data.pivots.map(obj) : []) {
    const index = barIndex(ns.indexes, raw.index);
    const bar = index === null ? undefined : bars[index];
    if (index === null || !bar) continue;
    const high = num(raw.type, 0) > 0;
    pivots.push({ index, high, price: high ? bar[2] : bar[3] });
  }
  if (!pivots.length) return null;
  const st = study.state;
  return {
    kind: 'high-low',
    pivots,
    fontSize: num(st.fontsize, 10),
    borderColor: str(st.borderColor, '#2962FF'),
    backColor: str(st.backColor, '#E3EFFD'),
    textColor: str(st.textColor, '#0F0F0F'),
  };
}

/**
 * The levels or labels of a pivot points indicator, or null for any other
 * indicator and when the stored output has nothing to draw.
 * `scales` is the chart's scalesProperties (for "show indicator last value").
 */
export function planPivots(study: ParsedStudy, graphics: unknown, bars: readonly Bar[], scales: Props): PivotsPlan | null {
  const kind = study.metaInfoId.split('@')[0];
  if (kind !== 'PivotPointsStandard' && kind !== 'PivotPointsHighLow') return null;
  const ns = nonSeriesData(graphics);
  if (!ns) return null;
  return kind === 'PivotPointsStandard' ? standardPivots(study, ns, scales.showStudyLastValue !== false) : highLowPivots(study, ns, bars);
}

/**
 * Which periods TradingView draws when `lastBar` is the last visible bar: the
 * period containing it, plus every earlier one when historical pivots are on.
 * Its price axis labels show the last of those periods.
 */
export function visiblePeriods(plan: StandardPivots, lastBar: number): { drawn: PivotPeriod[]; current: PivotPeriod | null } {
  const drawn = plan.periods.filter((p) => p.start <= lastBar && (p.end >= lastBar || plan.showHistorical));
  return { drawn, current: drawn.at(-1) ?? null };
}
