import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import type { Bar, StudyValues } from '../../../core/model';
import { num, obj, str, type Props } from '../../../core/props';
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

export interface ProfileRow {
  low: number;
  high: number;
  up: number;
  down: number;
  inValueArea: boolean;
}

export interface VolumeProfile {
  rows: ProfileRow[];
  /** Centre of the row with the most volume. */
  poc: number;
}

export interface ProfileSettings {
  /** Row count ("Number Of Rows") or ticks per row ("Ticks Per Row"). */
  rows: number;
  ticksPerRow: boolean;
  priceStep: number;
  /** Share of the volume the value area holds, in percent. */
  valueArea: number;
}

export function profileSettings(p: Props, priceStep: number): ProfileSettings {
  const inputs = obj(p.inputs);
  return { rows: Math.max(1, num(inputs.rows, 24)), ticksPerRow: inputs.rowsLayout === 'Ticks Per Row', priceStep, valueArea: num(inputs.vaVolume, 70) };
}

/** Rows growing from the POC one row at a time, toward the side with more volume, until the next row would pass the target share. */
function markValueArea(rows: ProfileRow[], poc: number, percent: number): void {
  const total = (r: ProfileRow | undefined) => (r ? r.up + r.down : -1);
  const target = (rows.reduce((s, r) => s + total(r), 0) * percent) / 100;
  let sum = total(rows[poc]);
  let lo = poc;
  let hi = poc;
  rows[poc]!.inValueArea = true;
  while (lo > 0 || hi < rows.length - 1) {
    const above = total(rows[hi + 1]);
    const below = total(rows[lo - 1]);
    const next = above >= below ? hi + 1 : lo - 1;
    if (sum + total(rows[next]) > target) break;
    sum += total(rows[next]);
    rows[next]!.inValueArea = true;
    if (next > hi) hi = next;
    else lo = next;
  }
}

/**
 * Volume profile of bars `from`..`to` (inclusive) over price rows spanning their lowest low to highest high, as
 * TradingView documents it. TradingView fills the rows from lower-timeframe bars; with only the chart's bars, each
 * bar's volume is spread over the rows in proportion to how much of its high-low range each row covers.
 * A bar is up volume when it closes at or above its open. Rows run from the lowest price up.
 */
export function volumeProfile(bars: readonly Bar[], from: number, to: number, s: ProfileSettings): VolumeProfile | null {
  const range = bars.slice(Math.max(0, from), to + 1);
  if (range.length === 0) return null;
  const lo = Math.min(...range.map((b) => b[3]));
  const hi = Math.max(...range.map((b) => b[2]));
  const ticks = s.ticksPerRow ? s.rows : Math.max(1, Math.round((hi - lo) / s.rows / s.priceStep));
  const height = ticks * s.priceStep;
  const count = Math.max(1, Math.ceil((hi - lo) / height - 1e-9));
  const rows: ProfileRow[] = Array.from({ length: count }, (_, i) => ({ low: lo + i * height, high: lo + (i + 1) * height, up: 0, down: 0, inValueArea: false }));
  for (const [, open, high, low, close, volume] of range) {
    const side = close >= open ? 'up' : 'down';
    if (high <= low) {
      rows[Math.min(count - 1, Math.floor((low - lo) / height))]![side] += volume;
      continue;
    }
    const first = Math.max(0, Math.floor((low - lo) / height));
    const last = Math.min(count - 1, Math.floor((high - lo) / height));
    for (let i = first; i <= last; i++) {
      const r = rows[i]!;
      r[side] += (volume * Math.max(0, Math.min(high, r.high) - Math.max(low, r.low))) / (high - low);
    }
  }
  let poc = 0;
  rows.forEach((r, i) => r.up + r.down > rows[poc]!.up + rows[poc]!.down && (poc = i));
  markValueArea(rows, poc, s.valueArea);
  return { rows, poc: (rows[poc]!.low + rows[poc]!.high) / 2 };
}

interface Graphics {
  graphicsCmds?: { create?: { hhists?: { styleId: string; data: { priceLow: number; priceHigh: number; rate: (number | null)[] }[] }[]; horizlines?: { styleId: string; data: { level: number }[] }[] } };
}

/** The histogram TradingView computed (VbPFixed graphics: one hhist per row, styleId histBarsVA inside the value area). */
export function storedProfile(stored: StudyValues | undefined): VolumeProfile | null {
  if (stored?.status !== 'ok') return null;
  const d = obj(stored.graphics).d;
  if (typeof d !== 'string') return null;
  const create = (JSON.parse(d) as Graphics).graphicsCmds?.create;
  const rows = (create?.hhists ?? []).flatMap((h) =>
    h.data.map((r) => ({ low: r.priceLow, high: r.priceHigh, up: r.rate[0] ?? 0, down: r.rate[1] ?? 0, inValueArea: h.styleId === 'histBarsVA' })),
  );
  const poc = create?.horizlines?.find((l) => l.styleId === 'pocLines')?.data[0]?.level;
  return rows.length && poc !== undefined ? { rows: rows.sort((a, b) => a.low - b.low), poc } : null;
}

/** TradingView applies a transparency only to hex colours; rgba colours already carry their alpha. */
const tvColor = (color: string, transparency: unknown) => (color.startsWith('#') ? withTransparency(color, transparency) : color);

function drawFixedRangeVolumeProfile(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const inputs = obj(p.inputs);
  const times = points.map((pt) => pt.time).sort((a, b) => a - b);
  const from = barAt(dc.bars, times[0]!);
  const to = inputs.extendToRight === true ? dc.bars.length - 1 : barAt(dc.bars, times[1]!);
  const profile = storedProfile(dc.drawingStudy(drawing.id)) ?? volumeProfile(dc.bars, from, to, profileSettings(p, dc.priceStep));
  if (!profile) return;
  const ctx = dc.ctx;
  const graphics = obj(p.graphics);
  const left = dc.x(from) - dc.barSpacing / 2;
  const right = dc.x(to) + dc.barSpacing / 2;
  const top = Math.round(dc.y(profile.rows.at(-1)!.high));
  const bottom = Math.round(dc.y(profile.rows[0]!.low));
  const lines = obj(graphics.horizlines);
  const va = profile.rows.filter((r) => r.inValueArea);
  const levels: [string, number | undefined][] = [
    ['pocLines', profile.poc],
    ['vahLines', va.at(-1)?.high],
    ['valLines', va[0]?.low],
  ];
  for (const [key, level] of levels) {
    const line = obj(lines[key]);
    if (line.visible === false || level === undefined) continue;
    setStroke(ctx, pstr(line, 'color', '#0F0F0F'), num(line.width, 2), line.style);
    const y = dc.y(level);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
  const box = obj(obj(graphics.polygons).histBoxBg);
  ctx.fillStyle = tvColor(pstr(box, 'color', '#37a6ef'), num(box.transparency, 94));
  ctx.fillRect(left, top, right - left, bottom - top);
  const hists = obj(graphics.hhists);
  const maxTotal = Math.max(...profile.rows.map((r) => r.up + r.down));
  const gap = (bottom - top) / profile.rows.length >= 1 ? 1 : 0;
  for (const r of profile.rows) {
    const style = obj(hists[r.inValueArea ? 'histBarsVA' : 'histBars2']);
    if (style.visible === false || maxTotal <= 0) continue;
    const colors = Array.isArray(style.colors) ? style.colors : [];
    const alphas = Array.isArray(style.transparencies) ? style.transparencies : [];
    const avail = Math.max(0, (num(style.percentWidth, 30) / 100) * (right - left) - 2);
    const rtl = style.direction === 'right_to_left';
    const yTop = Math.round(dc.y(r.high));
    const h = Math.max(1, Math.round(dc.y(r.low)) - yTop - gap);
    let x = rtl ? right : left;
    [r.up, r.down].forEach((v, k) => {
      const w = (avail * v) / maxTotal;
      if (w < 0.5) return;
      ctx.fillStyle = tvColor(str(colors[k], k ? '#ec407a' : '#26c6da'), alphas[k]);
      ctx.fillRect(rtl ? x - w : x, yTop, w, h);
      x += rtl ? -w : w;
    });
  }
}

export const VOLUME_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolAnchoredVWAP: kind(1, drawAnchoredVwap, vwapAxisLabels),
  LineToolFixedRangeVolumeProfile: kind(2, drawFixedRangeVolumeProfile, undefined, { code: 'computed-locally' }),
};
