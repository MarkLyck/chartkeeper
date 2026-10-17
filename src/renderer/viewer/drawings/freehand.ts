import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor, lwcLineStyle } from '../colors';
import { pnum, pstr, setStroke, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';

const ARROW = 1;

/**
 * TradingView's brush smoothing: long segments get up to 4 evenly spaced
 * extra points (the segment start is repeated, as TradingView does), then
 * every point becomes the mean of a window of `smooth` points either side.
 */
export function smoothBrush(points: readonly Pt[], smooth: number): Pt[] {
  if (points.length < 2) return [...points];
  const window = Math.max(1, smooth);
  const dense: Pt[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const steps = Math.min(5, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / window));
    for (let k = 0; k < steps - 1; k++) dense.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
    dense.push(b);
  }
  const last = dense.length - 1;
  const smoothed = dense.map((_, r) => {
    let x = 0;
    let y = 0;
    for (let i = 0; i < window; i++) {
      const lo = dense[Math.max(r - i, 0)]!;
      const hi = dense[Math.min(r + i, last)]!;
      x += lo.x + hi.x;
      y += lo.y + hi.y;
    }
    return { x: x / (2 * window), y: y / (2 * window) };
  });
  smoothed.push(dense[last]!);
  return smoothed;
}

/** The two wings of TradingView's line-end arrow: 45 degrees each side, five line widths long. */
export function arrowWings(from: Pt, tip: Pt, width: number): [Pt, Pt] | null {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const size = 5 * width;
  const ux = (dx / len) * size;
  const uy = (dy / len) * size;
  const base = { x: tip.x - ux, y: tip.y - uy };
  return [
    { x: base.x - uy, y: base.y + ux },
    { x: base.x + uy, y: base.y - ux },
  ];
}

/** Adds an arrow at `tip`, pointing away from `from`, to the current path. */
export function addArrow(ctx: CanvasRenderingContext2D, from: Pt, tip: Pt, width: number): void {
  const wings = arrowWings(from, tip, width);
  if (!wings) return;
  ctx.moveTo(wings[0].x, wings[0].y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(wings[1].x, wings[1].y);
}

/** Round caps poke half a line width past the last point, so polygon arrows move their tip out to cover it. */
function capTip(from: Pt, tip: Pt, width: number): Pt {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (len < 1) return tip;
  const k = (len + width / 2) / len;
  return { x: from.x + (tip.x - from.x) * k, y: from.y + (tip.y - from.y) * k };
}

interface Stroke {
  color: string;
  width: number;
  style: unknown;
  /** Background, or null for none. */
  fill: string | null;
  close: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
}

/** TradingView's polygon renderer: one path through the points, filled, optionally closed, arrows, then stroked. */
export function strokePolygon(ctx: CanvasRenderingContext2D, pts: readonly Pt[], s: Stroke): void {
  if (!pts.length) return;
  const round = lwcLineStyle(s.style) === 0;
  setStroke(ctx, s.color, s.width, s.style);
  ctx.lineCap = round ? 'round' : 'butt';
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (const pt of pts) ctx.lineTo(pt.x, pt.y);
  if (s.fill) {
    ctx.fillStyle = s.fill;
    ctx.fill();
  }
  if (s.close) ctx.closePath();
  const arrow = (from: Pt, tip: Pt) => addArrow(ctx, from, round ? capTip(from, tip, s.width) : tip, s.width);
  if (pts.length > 1) {
    if (s.leftArrow) arrow(pts[1]!, pts[0]!);
    if (s.rightArrow) arrow(pts[pts.length - 2]!, pts[pts.length - 1]!);
  }
  if (s.width > 0) ctx.stroke();
}

const background = (p: Props) => fillColor(pstr(p, 'backgroundColor', 'rgba(0, 188, 212, 0.2)'), p.transparency);

function drawPath(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  strokePolygon(
    dc.ctx,
    points.map((pt) => dc.pt(pt)),
    {
      color: pstr(p, 'lineColor', '#2962FF'),
      width: pnum(p, 'lineWidth', 2),
      style: p.lineStyle,
      fill: null,
      close: false,
      leftArrow: pnum(p, 'leftEnd', 0) === ARROW,
      rightArrow: pnum(p, 'rightEnd', ARROW) === ARROW,
    },
  );
}

function drawPolyline(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const filled = p.filled === true;
  strokePolygon(
    dc.ctx,
    points.map((pt) => dc.pt(pt)),
    {
      color: pstr(p, 'linecolor', '#00BCD4'),
      width: pnum(p, 'linewidth', 2),
      style: p.linestyle,
      fill: filled && p.fillBackground !== false ? background(p) : null,
      close: filled,
      leftArrow: false,
      rightArrow: false,
    },
  );
}

const brushPoints = (dc: DrawContext, p: Props, points: DrawingPoint[]) =>
  smoothBrush(
    points.map((pt) => dc.pt(pt)),
    pnum(p, 'smooth', 5),
  );

function drawBrush(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  strokePolygon(dc.ctx, brushPoints(dc, p, points), {
    color: pstr(p, 'linecolor', '#00BCD4'),
    width: pnum(p, 'linewidth', 2),
    style: 0,
    fill: p.fillBackground === true ? background(p) : null,
    close: false,
    leftArrow: pnum(p, 'leftEnd', 0) === ARROW,
    rightArrow: pnum(p, 'rightEnd', 0) === ARROW,
  });
}

/** TradingView strokes the highlighter with its colour as stored; `transparency` only ever applied to fills. */
function drawHighlighter(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  strokePolygon(dc.ctx, brushPoints(dc, p, points), {
    color: pstr(p, 'linecolor', 'rgba(242, 54, 69, 0.2)'),
    width: pnum(p, 'width', 20),
    style: 0,
    fill: null,
    close: false,
    leftArrow: false,
    rightArrow: false,
  });
}

export const FREEHAND_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolPath: kind(2, drawPath),
  LineToolPolyline: kind(2, drawPolyline),
  LineToolBrush: kind(2, drawBrush),
  LineToolHighlighter: kind(2, drawHighlighter),
};
