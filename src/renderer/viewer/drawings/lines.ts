import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import { num, type Props } from '../../../core/props';
import { drawText, font, FONT_FAMILY, measureText, pnum, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, priceLabel, timeLabel, type DrawingKind } from './kind';

const lineColor = (p: Props) => pstr(p, 'linecolor', '#2962FF');
const lineWidth = (p: Props) => pnum(p, 'linewidth', 1);
const flag = (p: Props, key: string, fallback: boolean) => (typeof p[key] === 'boolean' ? p[key] : fallback);
const crisp = (v: number, width: number) => Math.round(v) + (width % 2 ? 0.5 : 0);

/**
 * Segment a-b stretched to the pane edge on the requested sides. Stopping at the edge (not far
 * beyond it) starts a dashed line's pattern where it enters the pane, as TradingView's does.
 */
export function extendToPane(a: Pt, b: Pt, left: boolean, right: boolean, pane: Pick<DrawContext, 'width' | 'height'>): [Pt, Pt] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return [a, b];
  let enter = -Infinity;
  let exit = Infinity;
  const edges: [number, number][] = [
    [-dx, a.x],
    [dx, pane.width - a.x],
    [-dy, a.y],
    [dy, pane.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p < 0) enter = Math.max(enter, q / p);
    else if (p > 0) exit = Math.min(exit, q / p);
  }
  const at = (t: number): Pt => ({ x: a.x + dx * t, y: a.y + dy * t });
  return [left && enter < 0 ? at(enter) : a, right && exit > 1 ? at(exit) : b];
}

/** TradingView's open arrow end: two strokes from the tip, 45 degrees off the line, growing with the line width. */
function arrowEnd(ctx: CanvasRenderingContext2D, from: Pt, tip: Pt, width: number): void {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const size = 7.5 * width;
  const arm = (side: number): Pt => ({ x: tip.x - size * Math.cos(angle + (side * Math.PI) / 4), y: tip.y - size * Math.sin(angle + (side * Math.PI) / 4) });
  const [l, r] = [arm(-1), arm(1)];
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(l.x, l.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(r.x, r.y);
  ctx.stroke();
  ctx.restore();
}

export interface LineText {
  text: string;
  font: string;
  color: string;
  /** TradingView's horzLabelsAlign: "left", "center" or "right" along the line. */
  horz: string;
  /** TradingView's vertLabelsAlign: "bottom" sets the text's bottom on the line (text above it), "top" hangs it below, "middle" centres it. */
  vert: string;
}

/** Text riding a line, rotated with it and kept upright. */
export function textOnLine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, t: LineText): void {
  if (!t.text) return;
  const [l, r] = a.x < b.x || (a.x === b.x && a.y > b.y) ? [a, b] : [b, a];
  const anchor = t.horz === 'left' ? l : t.horz === 'right' ? r : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(Math.atan2(r.y - l.y, r.x - l.x));
  drawText(ctx, t.text, 0, t.vert === 'bottom' ? -2 : t.vert === 'top' ? 2 : 0, {
    font: t.font,
    color: t.color,
    align: t.horz === 'left' ? 'left' : t.horz === 'right' ? 'right' : 'center',
    baseline: t.vert === 'bottom' ? 'bottom' : t.vert === 'top' ? 'top' : 'middle',
  });
  ctx.restore();
}

export type StatsIcon = 'price' | 'bars' | 'angle';

export interface StatsRow {
  icon: StatsIcon;
  text: string;
}

export interface LineMeasure {
  from: DrawingPoint;
  to: DrawingPoint;
  /** Bars between the points. */
  bars: number;
  /** On-screen positions of the points, for distance and angle. */
  a: Pt;
  b: Pt;
  priceStep: number;
  formatPrice(price: number): string;
}

/** Time between two points as TradingView writes it: "38d", "4d 1h", "45m". */
export function formatSpan(seconds: number): string {
  const s = Math.abs(seconds);
  const parts: [number, string][] = [
    [Math.floor(s / 86400), 'd'],
    [Math.floor((s % 86400) / 3600), 'h'],
    [Math.floor((s % 3600) / 60), 'm'],
  ];
  const shown = parts.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`);
  return shown.length ? shown.join(' ') : '0m';
}

/** Angle of a-b on screen in degrees, counter-clockwise from the horizontal. */
export const screenAngle = (a: Pt, b: Pt): number => (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;

const joined = (sep: string, ...parts: (string | false)[]) => parts.filter((s): s is string => !!s).join(sep);

/** The rows of a trend line's stats box (the info line's box), each part switched by its `show*` property. */
export function lineStats(p: Props, m: LineMeasure): StatsRow[] {
  const diff = m.to.price - m.from.price;
  const pct = m.from.price !== 0 ? (diff / Math.abs(m.from.price)) * 100 : 0;
  const ticks = Math.round(diff / m.priceStep).toLocaleString('en-US');
  const distance = Math.round(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y));
  const rows: StatsRow[] = [
    {
      icon: 'price',
      text: joined(', ', joined(' ', p.showPriceRange === true && m.formatPrice(diff), p.showPercentPriceRange === true && `(${pct.toFixed(2)}%)`), p.showPipsPriceRange === true && ticks),
    },
    {
      icon: 'bars',
      text: joined(
        ', ',
        joined(' ', p.showBarsRange === true && `${m.bars} bars`, p.showDateTimeRange === true && `(${formatSpan(m.to.time - m.from.time)})`),
        p.showDistance === true && `distance: ${distance} px`,
      ),
    },
    { icon: 'angle', text: p.showAngle === true ? `${screenAngle(m.a, m.b).toFixed(2)}°` : '' },
  ];
  return rows.filter((r) => r.text !== '');
}

const STATS = { font: `14px ${FONT_FAMILY}`, row: 26, top: 20, iconLeft: 13, textLeft: 43, right: 12, offset: 12 };

function statsIcon(ctx: CanvasRenderingContext2D, icon: StatsIcon, x: number, y: number): void {
  const path: Record<StatsIcon, [number, number][][]> = {
    price: [
      [[3, -7.5], [13, -7.5]],
      [[3, 7.5], [13, 7.5]],
      [[8, -5], [8, 5]],
      [[6, -3], [8, -5], [10, -3]],
      [[6, 3], [8, 5], [10, 3]],
    ],
    bars: [
      [[1.5, -4.5], [1.5, 4.5]],
      [[14.5, -4.5], [14.5, 4.5]],
      [[5, 0.5], [11, 0.5]],
      [[7, -1.5], [5, 0.5], [7, 2.5]],
      [[9, -1.5], [11, 0.5], [9, 2.5]],
    ],
    angle: [[[16, 7.5], [1, 7.5], [10, -7.5]]],
  };
  ctx.beginPath();
  for (const stroke of path[icon]) stroke.forEach(([dx, dy], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
  ctx.stroke();
}

/** TradingView's stats box: light grey (dark grey on dark charts), below-right of the anchor that `statsPosition` picks. */
function drawStats(dc: DrawContext, rows: StatsRow[], anchor: Pt): void {
  if (rows.length === 0) return;
  const ctx = dc.ctx;
  ctx.font = STATS.font;
  const w = STATS.textLeft + Math.max(...rows.map((r) => ctx.measureText(r.text).width)) + STATS.right;
  const h = STATS.row * rows.length + 16;
  const x = Math.round(anchor.x + STATS.offset);
  const y = Math.round(anchor.y + STATS.offset);
  ctx.fillStyle = dc.dark ? '#404040' : '#f3f3f3';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  const color = dc.dark ? '#ffffff' : '#0f0f0f';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  rows.forEach((r, i) => {
    const cy = y + STATS.top + STATS.row * i;
    statsIcon(ctx, r.icon, x + STATS.iconLeft, cy);
    drawText(ctx, r.text, x + STATS.textLeft, cy, { font: STATS.font, color, baseline: 'middle' });
  });
}

/** statsPosition: 0 first point, 1 middle of the line, 2 second point. */
const statsAnchor = (position: number, a: Pt, b: Pt): Pt => (position === 0 ? a : position === 1 ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : b);

/** Trend line family (trend line, ray, extended line, info line, arrow): a segment, optionally extended, with arrow ends, text and stats. */
export function segmentDrawer(defaults: { extendLeft?: boolean; extendRight?: boolean; rightEnd?: number; alwaysShowStats?: boolean } = {}) {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const [p0, p1] = points as [DrawingPoint, DrawingPoint];
    const a = dc.pt(p0);
    const b = dc.pt(p1);
    const width = lineWidth(p);
    const [ea, eb] = extendToPane(a, b, flag(p, 'extendLeft', defaults.extendLeft ?? false), flag(p, 'extendRight', defaults.extendRight ?? false), dc);
    setStroke(dc.ctx, lineColor(p), width, p.linestyle);
    strokeLine(dc.ctx, ea, eb);
    if (pnum(p, 'leftEnd', 0) === 1) arrowEnd(dc.ctx, b, a, width);
    if (pnum(p, 'rightEnd', defaults.rightEnd ?? 0) === 1) arrowEnd(dc.ctx, a, b, width);
    textOnLine(dc.ctx, a, b, {
      text: pstr(p, 'text', ''),
      font: font(p, 'fontsize', 14),
      color: pstr(p, 'textcolor', lineColor(p)),
      horz: pstr(p, 'horzLabelsAlign', 'center'),
      vert: pstr(p, 'vertLabelsAlign', 'bottom'),
    });
    if (!flag(p, 'alwaysShowStats', defaults.alwaysShowStats ?? false)) return;
    const rows = lineStats(p, { from: p0, to: p1, bars: Math.round(dc.logical(p1) - dc.logical(p0)), a, b, priceStep: dc.priceStep, formatPrice: dc.formatPrice });
    drawStats(dc, rows, statsAnchor(pnum(p, 'statsPosition', 2), a, b));
  };
}

/**
 * Trend angle: TradingView rebuilds the second point from the saved on-screen angle (radians) and
 * distance (pixels), then draws a dotted horizontal, an arc from it to the line, and the angle in degrees.
 */
export function drawTrendAngle(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const a = dc.pt(points[0]!);
  const source = drawing.source as Props;
  const angle = num(source.angle, null);
  const distance = num(source.distance, null);
  const b = angle !== null && distance !== null ? { x: a.x + distance * Math.cos(angle), y: a.y - distance * Math.sin(angle) } : dc.pt(points[1] ?? points[0]!);
  const theta = Math.atan2(a.y - b.y, b.x - a.x);
  const color = lineColor(p);
  const ctx = dc.ctx;
  setStroke(ctx, color, lineWidth(p), p.linestyle);
  strokeLine(ctx, ...extendToPane(a, b, p.extendLeft === true, p.extendRight === true, dc));
  const radius = 50;
  setStroke(ctx, color, 1, 1);
  strokeLine(ctx, { x: a.x, y: crisp(a.y, 1) }, { x: a.x + radius, y: crisp(a.y, 1) });
  if (theta !== 0) {
    ctx.beginPath();
    ctx.arc(a.x, a.y, radius, 0, -theta, theta > 0);
    ctx.stroke();
  }
  const label = { x: a.x + (radius + 10) * Math.cos(theta / 2), y: a.y - (radius + 10) * Math.sin(theta / 2) };
  drawText(ctx, `${Math.round((theta * 180) / Math.PI)}°`, label.x, label.y, { font: font(p, 'fontsize', 12), color, baseline: 'middle' });
}

/** Space between a line and its text, and around text that interrupts a line. */
const LABEL_GAP = 4;

const textSize = (dc: DrawContext, p: Props, text: string) => measureText(dc.ctx, text, { font: font(p, 'fontsize', 12), color: '' });

const lineText = (dc: DrawContext, p: Props, text: string, at: Pt, align: 'left' | 'center' | 'right', baseline: 'top' | 'middle' | 'bottom') =>
  drawText(dc.ctx, text, at.x, at.y, { font: font(p, 'fontsize', 12), color: pstr(p, 'textcolor', lineColor(p)), align, baseline });

/** Horizontal line or ray from x1 to x2 with its text: horzLabelsAlign picks the spot, vertLabelsAlign puts it above, on (interrupting the line) or below. */
function horizontal(dc: DrawContext, p: Props, x1: number, x2: number, price: number): void {
  const width = lineWidth(p);
  const y = crisp(dc.y(price), width);
  const text = pstr(p, 'text', '');
  const h = pstr(p, 'horzLabelsAlign', 'center');
  const v = pstr(p, 'vertLabelsAlign', 'middle');
  const w = text ? textSize(dc, p, text).w : 0;
  const left = h === 'left' ? x1 + LABEL_GAP : h === 'right' ? x2 - LABEL_GAP - w : (x1 + x2 - w) / 2;
  setStroke(dc.ctx, lineColor(p), width, p.linestyle);
  if (text && v === 'middle') {
    strokeLine(dc.ctx, { x: x1, y }, { x: left - LABEL_GAP, y });
    strokeLine(dc.ctx, { x: left + w + LABEL_GAP, y }, { x: x2, y });
  } else strokeLine(dc.ctx, { x: x1, y }, { x: x2, y });
  if (!text) return;
  const offset = v === 'top' ? -(width / 2 + 2) : v === 'bottom' ? width / 2 + 2 : 0;
  lineText(dc, p, text, { x: left, y: y + offset }, 'left', v === 'top' ? 'bottom' : v === 'bottom' ? 'top' : 'middle');
}

export function drawHorzLine(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  horizontal(dc, p, 0, dc.width, points[0]!.price);
}

export function drawHorzRay(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  horizontal(dc, p, dc.pt(points[0]!).x, dc.width, points[0]!.price);
}

/** Vertical line with its text: centred text interrupts the line; vertLabelsAlign places it at the top, middle or bottom of the pane. */
export function drawVertLine(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const width = lineWidth(p);
  const x = crisp(dc.pt(points[0]!).x, width);
  const text = pstr(p, 'text', '');
  const ctx = dc.ctx;
  setStroke(ctx, lineColor(p), width, p.linestyle);
  if (!text) {
    strokeLine(ctx, { x, y: 0 }, { x, y: dc.height });
    return;
  }
  const h = pstr(p, 'horzLabelsAlign', 'center');
  const v = pstr(p, 'vertLabelsAlign', 'middle');
  const vertical = p.textOrientation === 'vertical';
  const size = textSize(dc, p, text);
  const along = vertical ? size.w : size.h;
  const top = v === 'top' ? LABEL_GAP : v === 'bottom' ? dc.height - LABEL_GAP - along : (dc.height - along) / 2;
  if (h === 'center') {
    strokeLine(ctx, { x, y: 0 }, { x, y: top - LABEL_GAP });
    strokeLine(ctx, { x, y: top + along + LABEL_GAP }, { x, y: dc.height });
  } else strokeLine(ctx, { x, y: 0 }, { x, y: dc.height });
  const side = h === 'left' ? -1 : h === 'right' ? 1 : 0;
  const tx = x + side * (width / 2 + LABEL_GAP);
  if (!vertical) {
    lineText(dc, p, text, { x: tx, y: top }, side < 0 ? 'right' : side > 0 ? 'left' : 'center', 'top');
    return;
  }
  ctx.save();
  ctx.translate(tx, top + along / 2);
  ctx.rotate(-Math.PI / 2);
  lineText(dc, p, text, { x: 0, y: 0 }, 'center', side < 0 ? 'bottom' : side > 0 ? 'top' : 'middle');
  ctx.restore();
}

export function drawCrossLine(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const w = lineWidth(p);
  setStroke(dc.ctx, lineColor(p), w, p.linestyle);
  strokeLine(dc.ctx, { x: 0, y: crisp(a.y, w) }, { x: dc.width, y: crisp(a.y, w) });
  strokeLine(dc.ctx, { x: crisp(a.x, w), y: 0 }, { x: crisp(a.x, w), y: dc.height });
}

export const LINE_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolTrendLine: kind(2, segmentDrawer()),
  LineToolRay: kind(2, segmentDrawer({ extendRight: true })),
  LineToolExtended: kind(2, segmentDrawer({ extendLeft: true, extendRight: true })),
  LineToolInfoLine: kind(2, segmentDrawer({ alwaysShowStats: true })),
  LineToolTrendAngle: kind(1, drawTrendAngle),
  LineToolArrow: kind(2, segmentDrawer({ rightEnd: 1 })),
  LineToolHorzLine: kind(1, drawHorzLine, priceLabel),
  LineToolHorzRay: kind(1, drawHorzRay, priceLabel),
  LineToolVertLine: kind(1, drawVertLine, timeLabel),
  LineToolCrossLine: kind(1, drawCrossLine, (p, pts) => [...priceLabel(p, pts), ...timeLabel(p, pts)]),
};
