import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import type { Bar, StudyValues } from '../../../core/model';
import { num, obj, type Props } from '../../../core/props';
import { withTransparency } from '../colors';
import { alignRows, type Column } from '../studies';
import { pstr, setStroke, type DrawContext } from './canvas';
import { kind, type AxisEnv, type AxisLabel, type DrawingKind } from './kind';

/** AnchoredVWAP@tv-basicstudies plot order; stored rows are [time, ...these]. */
const VWAP_PLOTS = ['VWAP', 'UpperBand', 'LowerBand', 'UpperBand_2', 'LowerBand_2', 'UpperBand_3', 'LowerBand_3'] as const;
const BAND_INPUTS = [
  ['calculate_stDev', 'bands_multiplier'],
  ['calculate_stDev_2', 'bands_multiplier_2'],
  ['calculate_stDev_3', 'bands_multiplier_3'],
] as const;

export interface VwapSettings {
  percent: boolean;
  /** Multiplier of each band pair, null when the pair is turned off. */
  multipliers: (number | null)[];
}

export function vwapSettings(p: Props): VwapSettings {
  const inputs = obj(p.inputs);
  return {
    percent: inputs['Bands Calculation Mode'] === 'Percentage',
    multipliers: BAND_INPUTS.map(([on, mult], k) => (inputs[on] === true || (inputs[on] === undefined && k === 0) ? num(inputs[mult], k + 1) : null)),
  };
}

const hlc3 = (b: Bar) => (b[2] + b[3] + b[4]) / 3;

/**
 * Anchored VWAP from bar `from` (inclusive) on, as TradingView's built-in computes it: vwap = Σ(hlc3·vol)/Σvol,
 * bands at vwap ± multiplier × the volume-weighted standard deviation √(Σ(vol·hlc3²)/Σvol − vwap²),
 * or ± multiplier percent of the VWAP in percentage mode. Columns follow VWAP_PLOTS.
 */
export function anchoredVwap(bars: readonly Bar[], from: number, s: VwapSettings): Column[] {
  const cols: Column[] = VWAP_PLOTS.map(() => bars.map(() => null));
  let sv = 0;
  let spv = 0;
  let sp2v = 0;
  for (let i = Math.max(0, from); i < bars.length; i++) {
    const b = bars[i]!;
    const src = hlc3(b);
    sv += b[5];
    spv += src * b[5];
    sp2v += src * src * b[5];
    if (sv === 0) continue;
    const vwap = spv / sv;
    const unit = s.percent ? vwap / 100 : Math.sqrt(Math.max(0, sp2v / sv - vwap * vwap));
    cols[0]![i] = vwap;
    s.multipliers.forEach((m, k) => {
      if (m === null) return;
      cols[1 + 2 * k]![i] = vwap + m * unit;
      cols[2 + 2 * k]![i] = vwap - m * unit;
    });
  }
  return cols;
}

/** Index of the bar that opened at or before `time` (TradingView's anchor bar). */
export function barAt(bars: readonly Bar[], time: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  if (hi < 0 || time < bars[0]![0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid]![0] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** TradingView's own values when the backup has them, else the local calculation. */
function vwapColumns(bars: readonly Bar[], p: Props, anchor: DrawingPoint, stored: StudyValues | undefined): Column[] {
  if (stored?.status === 'ok' && stored.rows.length) {
    return alignRows(
      stored.rows,
      VWAP_PLOTS.length,
      bars.map((b) => b[0]),
    );
  }
  return anchoredVwap(bars, barAt(bars, anchor.time), vwapSettings(p));
}

function plotLine(dc: DrawContext, col: Column, style: Props): void {
  if (style.visible === false) return;
  setStroke(dc.ctx, withTransparency(pstr(style, 'color', '#2962FF'), style.transparency), num(style.linewidth, 1), style.linestyle);
  dc.ctx.beginPath();
  let pen = false;
  col.forEach((v, i) => {
    if (v === null) return void (pen = false);
    const x = dc.x(i);
    const y = dc.y(v);
    if (pen) dc.ctx.lineTo(x, y);
    else dc.ctx.moveTo(x, y);
    pen = true;
  });
  dc.ctx.stroke();
}

function fillBetween(dc: DrawContext, a: Column, b: Column, color: string): void {
  const idx = a.flatMap((v, i) => (v !== null && b[i] !== null ? [i] : []));
  if (idx.length < 2) return;
  const ctx = dc.ctx;
  ctx.fillStyle = color;
  ctx.beginPath();
  idx.forEach((i, k) => (k ? ctx.lineTo(dc.x(i), dc.y(a[i]!)) : ctx.moveTo(dc.x(i), dc.y(a[i]!))));
  for (const i of [...idx].reverse()) ctx.lineTo(dc.x(i), dc.y(b[i]!));
  ctx.closePath();
  ctx.fill();
}

function drawAnchoredVwap(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const cols = vwapColumns(dc.bars, p, points[0]!, dc.drawingStudy(drawing.id));
  const styles = obj(p.styles);
  const area = obj(p.areaBackground);
  if (area.fillBackground !== false) fillBetween(dc, cols[1]!, cols[2]!, withTransparency(pstr(area, 'backgroundColor', '#4caf50'), num(area.transparency, 95)));
  const on = vwapSettings(p).multipliers;
  VWAP_PLOTS.forEach((id, k) => {
    if (k > 0 && on[Math.floor((k - 1) / 2)] === null) return;
    plotLine(dc, cols[k]!, obj(styles[id]));
  });
}

function vwapAxisLabels(p: Props, points: DrawingPoint[], env: AxisEnv, drawing: ParsedDrawing): AxisLabel[] {
  if (p.showLabelsOnPriceScale === false || p.axisLabelVisible === false) return [];
  const vwap = vwapColumns(env.bars, p, points[0]!, env.drawingStudies[drawing.id])[0]!;
  const last = vwap.findLast((v) => v !== null);
  return last == null ? [] : [{ axis: 'price', price: last, color: pstr(obj(obj(p.styles).VWAP), 'color', '#1e88e5') }];
}

export const VOLUME_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolAnchoredVWAP: kind(1, drawAnchoredVwap, vwapAxisLabels),
};
