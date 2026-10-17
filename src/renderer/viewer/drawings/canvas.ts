import type { DrawingPoint } from '../../../core/layout';
import type { Bar, StudyValues } from '../../../core/model';
import { num, obj, str, type Props } from '../../../core/props';
import { dashPattern } from '../colors';

export interface Pt {
  x: number;
  y: number;
}

/** What a drawing renderer gets: a canvas in CSS pixels plus the chart's coordinate conversions. */
export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  pt(p: DrawingPoint): Pt;
  y(price: number): number;
  /** Price at a y coordinate, the inverse of `y`. */
  price(y: number): number;
  /** x coordinate of a bar position (whole or fractional, may lie outside the bars). */
  x(logical: number): number;
  barSpacing: number;
  /** Bar position of a point; differences give bar counts. */
  logical(p: DrawingPoint): number;
  /** Bar position of a time, as `logical` places points. */
  logicalOfTime(time: number): number;
  /** The chart's bars, oldest first: bar `i` sits at bar position `i`. */
  bars: readonly Bar[];
  formatPrice(price: number): string;
  /** Smallest price step of the symbol, for tools that store distances in ticks. */
  priceStep: number;
  /** True on a dark chart background. */
  dark: boolean;
  background: string;
  /** TradingView's own values for a study-backed drawing (Anchored VWAP, Fixed Range Volume Profile), when the backup has them. */
  drawingStudy(drawingId: string): StudyValues | undefined;
}

export const FONT_FAMILY = `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`;

export const pnum = (p: Props, key: string, fallback: number): number => num(p[key], fallback);
export const pstr = (p: Props, key: string, fallback: string): string => str(p[key], fallback);
export const pobj = (p: Props, key: string): Props => obj(p[key]);

export function font(p: Props, sizeKey = 'fontsize', fallback = 14): string {
  const size = pnum(p, sizeKey, pnum(p, sizeKey === 'fontsize' ? 'fontSize' : 'fontsize', fallback));
  return `${p.italic === true ? 'italic ' : ''}${p.bold === true ? 'bold ' : ''}${size}px ${FONT_FAMILY}`;
}

export function setStroke(ctx: CanvasRenderingContext2D, color: string, width: number, tvStyle: unknown = 0): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashPattern(tvStyle, width));
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
}

export function strokeLine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Stretches segment a-b past the pane edges on the requested sides. */
export function extendSegment(a: Pt, b: Pt, left: boolean, right: boolean, dc: Pick<DrawContext, 'width' | 'height'>): [Pt, Pt] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [a, b];
  const far = (dc.width + dc.height) * 4;
  const ux = (dx / len) * far;
  const uy = (dy / len) * far;
  return [left ? { x: a.x - ux, y: a.y - uy } : a, right ? { x: b.x + ux, y: b.y + uy } : b];
}

export function arrowHead(ctx: CanvasRenderingContext2D, from: Pt, tip: Pt, width: number): void {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const size = 6 + width * 2;
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tip.x - size * Math.cos(angle - Math.PI / 6), tip.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(angle + Math.PI / 6), tip.y - size * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
  ctx.restore();
}

export function fillPolygon(ctx: CanvasRenderingContext2D, pts: Pt[], color: string): void {
  if (pts.length < 3) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();
}

export interface TextOptions {
  font: string;
  color: string;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom';
  background?: string | null;
  border?: string | null;
  padding?: number;
  /** Wrap lines longer than this many pixels. */
  wrapWidth?: number | null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number | null | undefined): string[] {
  const lines = text.split('\n');
  if (!width) return lines;
  const out: string[] = [];
  for (const line of lines) {
    let cur = '';
    for (const word of line.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(next).width > width) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

export function measureText(ctx: CanvasRenderingContext2D, text: string, o: TextOptions): { lines: string[]; w: number; h: number; lineHeight: number } {
  ctx.font = o.font;
  const lines = wrap(ctx, text, o.wrapWidth);
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(o.font)?.[1] ?? 14);
  const lineHeight = Math.round(size * 1.25);
  const pad = o.padding ?? 0;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  return { lines, w, h: lines.length * lineHeight + pad * 2, lineHeight };
}

/** Draws (multi-line) text whose box is aligned to (x, y); returns the box. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOptions): Box {
  const m = measureText(ctx, text, o);
  const pad = o.padding ?? 0;
  const bx = o.align === 'center' ? x - m.w / 2 : o.align === 'right' ? x - m.w : x;
  const by = o.baseline === 'middle' ? y - m.h / 2 : o.baseline === 'bottom' ? y - m.h : y;
  ctx.setLineDash([]);
  if (o.background) {
    ctx.fillStyle = o.background;
    ctx.fillRect(bx, by, m.w, m.h);
  }
  if (o.border) {
    ctx.strokeStyle = o.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, m.w - 1, m.h - 1);
  }
  ctx.fillStyle = o.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  m.lines.forEach((line, i) => ctx.fillText(line, bx + pad, by + pad + m.lineHeight * (i + 0.5)));
  return { x: bx, y: by, w: m.w, h: m.h };
}

/** Rounded box with a small tail pointing down at `anchor`, used by balloons, comments and price labels. */
export function drawBubble(ctx: CanvasRenderingContext2D, text: string, anchor: Pt, o: TextOptions & { background: string; border: string | null }): void {
  const m = measureText(ctx, text, { ...o, padding: o.padding ?? 6 });
  const tail = 8;
  const x = anchor.x - 10;
  const y = anchor.y - tail - m.h;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.roundRect(x, y, m.w, m.h, 4);
  ctx.moveTo(anchor.x - 4, y + m.h);
  ctx.lineTo(anchor.x, anchor.y);
  ctx.lineTo(anchor.x + 4, y + m.h);
  ctx.fillStyle = o.background;
  ctx.fill();
  if (o.border) {
    ctx.strokeStyle = o.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  drawText(ctx, text, x, y, { ...o, background: null, border: null, padding: o.padding ?? 6 });
}

/** Text drawn along a line, kept upright; vertLabelsAlign "top" puts it above the line, "bottom" below. */
export function textAlongLine(ctx: CanvasRenderingContext2D, text: string, a: Pt, b: Pt, p: Props, color: string): void {
  if (!text) return;
  const align = pstr(p, 'horzLabelsAlign', 'center');
  const vAlign = pstr(p, 'vertLabelsAlign', 'bottom');
  const anchor = align === 'left' ? a : align === 'right' ? b : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(angle);
  drawText(ctx, text, 0, vAlign === 'top' ? -4 : vAlign === 'middle' ? 0 : 4, {
    font: font(p, 'fontsize', 14),
    color,
    align: align === 'left' ? 'left' : align === 'right' ? 'right' : 'center',
    baseline: vAlign === 'top' ? 'bottom' : vAlign === 'middle' ? 'middle' : 'top',
  });
  ctx.restore();
}
