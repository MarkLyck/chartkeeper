import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { obj } from '../../../core/props';
import { withTransparency } from '../colors';
import { FONT_FAMILY, pnum, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';
import { formatChange, formatPercent, formatSpan, formatTicks, formatVolume } from './stats';

type RangeKind = 'price' | 'date' | 'both';

export interface RangeMeasure {
  /** Second point's price minus the first's. */
  diff: number;
  fromPrice: number;
  bars: number;
  seconds: number;
  /** Total volume of the bars the range covers, null when no bar is inside it. */
  volume: number | null;
}

/** The label lines of a range tool, as TradingView writes them ("25.87 (8.36%) 2,587", "36 bars, 51d", "Vol 1.67 B"). */
export function rangeLabelLines(k: RangeKind, m: RangeMeasure, p: Props, formatPrice: (price: number) => string, priceStep: number): string[] {
  const lines: string[] = [];
  if (k !== 'date') {
    const price = p.showPriceRange !== false ? formatChange(m.diff, formatPrice) : '';
    const pct = p.showPercentPriceRange !== false ? formatPercent(m.fromPrice ? (100 * m.diff) / Math.abs(m.fromPrice) : 0, 2) : '';
    let text = price && pct ? `${price} (${pct})` : price || pct;
    if (p.showPipsPriceRange !== false) text += `${text ? (price && pct ? ' ' : ', ') : ''}${formatTicks(m.diff, priceStep)}`;
    if (text) lines.push(text);
  }
  if (k !== 'price') {
    const parts = [p.showBarsRange !== false ? `${m.bars} bars` : '', p.showDateTimeRange !== false ? formatSpan(m.seconds) : ''].filter(Boolean);
    if (parts.length) lines.push(parts.join(', '));
    if (p.showVolume !== false && m.volume !== null) lines.push(`Vol ${formatVolume(m.volume)}`);
  }
  return lines;
}

function measureRange(dc: DrawContext, p0: DrawingPoint, p1: DrawingPoint): RangeMeasure {
  const i0 = Math.round(dc.logical(p0));
  const i1 = Math.round(dc.logical(p1));
  const covered = dc.bars.slice(Math.max(0, Math.min(i0, i1)), Math.max(i0, i1) + 1);
  return {
    diff: p1.price - p0.price,
    fromPrice: p0.price,
    bars: i1 - i0,
    seconds: p1.time - p0.time,
    volume: covered.length ? covered.reduce((s, b) => s + b[5], 0) : null,
  };
}

/** TradingView applies a transparency only to hex colours; rgba colours keep their own alpha. */
const tvColor = (color: string, transparency: unknown) => (color.startsWith('#') ? withTransparency(color, transparency) : color);

/** Open 90° chevron at `tip`, arms 5×width back along the line from `from`. */
function chevron(ctx: CanvasRenderingContext2D, from: Pt, tip: Pt, width: number): void {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (len === 0) return;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const a = 5 * width;
  ctx.beginPath();
  ctx.moveTo(tip.x - a * ux - a * uy, tip.y - a * uy + a * ux);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - a * ux + a * uy, tip.y - a * uy - a * ux);
  ctx.stroke();
}

function arrowLine(ctx: CanvasRenderingContext2D, from: Pt, to: Pt, width: number, minArrowLength: number): void {
  strokeLine(ctx, from, to);
  if (Math.hypot(to.x - from.x, to.y - from.y) >= minArrowLength * width) chevron(ctx, from, to, width);
}

/** The measure label: a rounded box 10 px past the side the second point was dragged to, flipped when it would leave the pane. */
function drawRangeLabel(dc: DrawContext, p: Props, lines: string[], x: number, minY: number, maxY: number, upward: boolean): void {
  if (lines.length === 0) return;
  const ctx = dc.ctx;
  const fs = pnum(p, 'fontsize', 12);
  ctx.font = `${fs}px ${FONT_FAMILY}`;
  const padH = fs * 0.4 + fs / 3;
  const padV = fs * 0.2 + fs / 3;
  let w = Math.round(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 2 * padH);
  w += w % 2;
  const h = lines.length * fs + 8 * (lines.length - 1) + 2 * padV;
  const gap = 10 + h / 2;
  const above = minY - gap;
  const below = maxY + gap;
  const fitsAbove = above - h / 2 >= 0;
  const fitsBelow = below + h / 2 <= dc.height;
  const cy = upward ? (fitsAbove ? above : fitsBelow ? below : h / 2) : fitsBelow ? below : fitsAbove ? above : dc.height - h / 2;
  const top = cy - h / 2;
  if (p.fillLabelBackground !== false) {
    ctx.save();
    ctx.shadowColor = pstr(p, 'shadow', 'rgba(0, 0, 0, 0.2)');
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = pstr(p, 'labelBackgroundColor', dc.dark ? '#2E2E2E' : '#FFFFFF');
    ctx.beginPath();
    ctx.roundRect(x - w / 2, top, w, h, 4);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = pstr(p, 'textcolor', dc.dark ? '#FFFFFF' : '#000000');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, x, top + padV + fs / 2 + 0.05 * fs + i * (fs + 8)));
}

/** Price range, date range and date-and-price range: a shaded box between the two points with the measured distance. */
export function rangeDrawer(k: RangeKind) {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const [p0, p1] = points as [DrawingPoint, DrawingPoint];
    const a = dc.pt(p0);
    const b = dc.pt(p1);
    const ctx = dc.ctx;
    const width = pnum(p, 'linewidth', 2);
    let [minX, maxX] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    let [minY, maxY] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    if (k === 'price') [minX, maxX] = [p.extendLeft === true ? 0 : minX, p.extendRight === true ? dc.width : maxX];
    if (k === 'date') [minY, maxY] = [p.extendTop === true ? 0 : minY, p.extendBottom === true ? dc.height : maxY];
    if (p.fillBackground !== false) {
      ctx.fillStyle = tvColor(pstr(p, 'backgroundColor', 'rgba(41, 98, 255, 0.15)'), p.backgroundTransparency);
      ctx.fillRect(Math.round(minX), Math.round(minY), Math.round(maxX) - Math.round(minX), Math.round(maxY) - Math.round(minY));
    }
    setStroke(ctx, pstr(p, 'linecolor', '#2962FF'), width);
    ctx.lineCap = 'round';
    const midX = Math.round((a.x + b.x) / 2);
    const midY = Math.round((a.y + b.y) / 2);
    if (k === 'price') {
      strokeLine(ctx, { x: minX, y: a.y }, { x: maxX, y: a.y });
      strokeLine(ctx, { x: minX, y: b.y }, { x: maxX, y: b.y });
      arrowLine(ctx, { x: midX, y: a.y }, { x: midX, y: b.y }, width, 15);
    } else if (k === 'date') {
      strokeLine(ctx, { x: a.x, y: minY }, { x: a.x, y: maxY });
      strokeLine(ctx, { x: b.x, y: minY }, { x: b.x, y: maxY });
      arrowLine(ctx, { x: a.x, y: midY }, { x: b.x, y: midY }, width, 15);
    } else {
      arrowLine(ctx, { x: midX, y: a.y }, { x: midX, y: b.y }, width, 25);
      arrowLine(ctx, { x: a.x, y: midY }, { x: b.x, y: midY }, width, 25);
      if (p.drawBorder === true) {
        setStroke(ctx, pstr(p, 'borderColor', '#2962FF'), pnum(p, 'borderWidth', 1));
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      }
    }
    const lines = rangeLabelLines(k, measureRange(dc, p0, p1), p, dc.formatPrice, dc.priceStep);
    drawRangeLabel(dc, p, lines, (a.x + b.x) / 2, minY, maxY, a.y > b.y);
  };
}

const FALLBACK_GREY = '#808080';

/** A bar of a copied pattern: [time, open, high, low, close, volume]. */
type PatternBar = readonly number[];

/** Prices a bars pattern draws per bar, by mode: 0 bars (H-L), 1 close line, 2 open-close bars, 3 open, 4 high, 5 low, 6 (H+L)/2 lines. */
const PATTERN_MODES: Record<number, { bars: boolean; value: (b: PatternBar) => [number, number] }> = {
  0: { bars: true, value: (b) => [b[2]!, b[3]!] },
  1: { bars: false, value: (b) => [b[4]!, b[4]!] },
  2: { bars: true, value: (b) => [b[1]!, b[4]!] },
  3: { bars: false, value: (b) => [b[1]!, b[1]!] },
  4: { bars: false, value: (b) => [b[2]!, b[2]!] },
  5: { bars: false, value: (b) => [b[3]!, b[3]!] },
  6: { bars: false, value: (b) => [(b[2]! + b[3]!) / 2, (b[2]! + b[3]!) / 2] },
};

/** Where each copied bar lands: stretched between the two points, scaled so its first and last prices sit on them. */
export function placePattern(pattern: readonly PatternBar[], mode: number, a: Pt, b: Pt, y: (price: number) => number): { x: number; y0: number; y1: number }[] {
  const m = PATTERN_MODES[mode] ?? PATTERN_MODES[0]!;
  const n = pattern.length;
  const step = n > 1 ? Math.abs(a.x - b.x) / (n - 1) : 0;
  const xStart = Math.min(a.x, b.x);
  const first = m.value(pattern[0]!)[0];
  const last = m.value(pattern[n - 1]!)[1];
  const span = y(last) - y(first);
  const scale = span === 0 ? 1 : (b.y - a.y) / span;
  const yy = (v: number) => y(v) * scale + a.y - y(first) * scale;
  return pattern.map((bar, t) => {
    const [v0, v1] = m.value(bar);
    return { x: Math.round(xStart + t * step + 0.5), y0: yy(v0), y1: yy(v1) };
  });
}

/**
 * Bars pattern: TradingView copies the bars once while the tool is drawn and saves them as `pattern`;
 * without them it shows two full-height grey lines at the points joined by a line.
 */
function drawBarsPattern(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const ctx = dc.ctx;
  const pattern = obj(drawing.source).pattern;
  if (!Array.isArray(pattern) || pattern.length === 0) {
    const crisp = (v: number) => Math.round(v) + 0.5;
    setStroke(ctx, FALLBACK_GREY, 1);
    strokeLine(ctx, { x: crisp(a.x), y: 0 }, { x: crisp(a.x), y: dc.height });
    strokeLine(ctx, { x: crisp(b.x), y: 0 }, { x: crisp(b.x), y: dc.height });
    strokeLine(ctx, { x: a.x, y: crisp(a.y) }, { x: b.x, y: crisp(b.y) });
    return;
  }
  const mode = pnum(p, 'mode', 0);
  const color = withTransparency(pstr(p, 'color', '#2962FF'), 10);
  const placed = placePattern(pattern as PatternBar[], mode, a, b, dc.y);
  if (PATTERN_MODES[mode]?.bars ?? true) {
    setStroke(ctx, color, 1);
    ctx.fillStyle = color;
    for (const bar of placed) {
      ctx.fillRect(bar.x - 1, Math.min(bar.y0, bar.y1), 2, Math.abs(bar.y1 - bar.y0));
      ctx.strokeRect(bar.x - 1.5, Math.min(bar.y0, bar.y1) - 0.5, 3, Math.abs(bar.y1 - bar.y0) + 1);
    }
    return;
  }
  setStroke(ctx, color, 2);
  ctx.beginPath();
  placed.forEach((bar, i) => (i ? ctx.lineTo(bar.x, bar.y0) : ctx.moveTo(bar.x, bar.y0)));
  ctx.stroke();
}

interface GhostBar {
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Saved ghost candles of one segment: dense `{o,h,l,c}` rows, or sparse `{i, b}` entries. */
function segmentBars(segment: unknown): (GhostBar | undefined)[] {
  const bars = obj(segment).bars;
  if (!Array.isArray(bars)) return [];
  const out: (GhostBar | undefined)[] = [];
  bars.forEach((entry, k) => {
    const e = obj(entry);
    if (typeof e.i === 'number') out[e.i] = obj(e.b) as unknown as GhostBar;
    else out[k] = e as unknown as GhostBar;
  });
  return out;
}

/**
 * Ghost feed: a grey line through its points, plus the candles TradingView generated (randomly) while the tool
 * was drawn, when the layout saved them as `segments`. Each candle's prices are offsets from a baseline running
 * straight from one point to the next.
 */
function drawGhostFeed(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const ctx = dc.ctx;
  const style = obj(p.candleStyle);
  const segments = obj(drawing.source).segments;
  ctx.save();
  ctx.globalAlpha = 1 - pnum(p, 'transparency', 50) / 100;
  const body = Math.max(1, Math.floor(dc.barSpacing * 0.8));
  (Array.isArray(segments) ? segments : []).forEach((segment, k) => {
    const [s, e] = [points[k], points[k + 1]];
    if (!s || !e) return;
    const [left, right] = dc.logical(s) <= dc.logical(e) ? [s, e] : [e, s];
    const origin = dc.logical(left) + (k > 0 ? 1 : 0);
    const bars = segmentBars(segment);
    const yl = dc.y(left.price);
    const yr = dc.y(right.price);
    bars.forEach((bar, i) => {
      if (!bar) return;
      const base = dc.price(bars.length > 1 ? yl + ((yr - yl) * i) / (bars.length - 1) : yl);
      const x = dc.x(origin + i);
      const up = bar.c >= bar.o;
      if (style.drawWick !== false) {
        setStroke(ctx, pstr(style, 'wickColor', '#808080'), 1);
        strokeLine(ctx, { x: Math.round(x) + 0.5, y: dc.y(base + bar.h) }, { x: Math.round(x) + 0.5, y: dc.y(base + bar.l) });
      }
      const top = dc.y(base + Math.max(bar.o, bar.c));
      const height = Math.max(1, dc.y(base + Math.min(bar.o, bar.c)) - top);
      ctx.fillStyle = pstr(style, up ? 'upColor' : 'downColor', up ? '#ACE5DC' : '#FAA1A4');
      ctx.fillRect(Math.round(x - body / 2), top, body, height);
      if (style.drawBorder !== false) {
        setStroke(ctx, pstr(style, up ? 'borderUpColor' : 'borderDownColor', up ? '#089981' : '#F23645'), 1);
        ctx.strokeRect(Math.round(x - body / 2) + 0.5, top + 0.5, body - 1, height - 1);
      }
    });
  });
  ctx.restore();
  setStroke(ctx, FALLBACK_GREY, 1);
  ctx.beginPath();
  points.forEach((pt, i) => {
    const q = dc.pt(pt);
    if (i) ctx.lineTo(q.x, q.y);
    else ctx.moveTo(q.x, q.y);
  });
  ctx.stroke();
}

export const MEASURE_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolPriceRange: kind(2, rangeDrawer('price')),
  LineToolDateRange: kind(2, rangeDrawer('date')),
  LineToolDateAndPriceRange: kind(2, rangeDrawer('both')),
  LineToolBarsPattern: kind(2, drawBarsPattern),
  LineToolGhostFeed: kind(2, drawGhostFeed),
};
