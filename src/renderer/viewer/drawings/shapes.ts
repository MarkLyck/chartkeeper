import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor } from '../colors';
import { drawText, font, measureText, pnum, pobj, pstr, setStroke, strokeLine, type Box, type DrawContext, type Pt } from './canvas';
import { addArrow, strokePolygon } from './freehand';
import { kind, type DrawingKind } from './kind';

const ARROW = 1;
const SQRT2 = Math.SQRT2;

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const mid = (a: Pt, b: Pt): Pt => scale(add(a, b), 0.5);
const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
/** Signed distance of `c` from the line through a and b; positive on the side of the normal (-dy, dx). */
const sideDistance = (a: Pt, b: Pt, c: Pt): number => ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / (dist(a, b) || 1);

/** Corners of TradingView's rotated rectangle: side a-b runs down its middle, c sets the half-width. */
export function rotatedRectCorners(a: Pt, b: Pt, c: Pt): [Pt, Pt, Pt, Pt] {
  const len = dist(a, b) || 1;
  const half = Math.abs(sideDistance(a, b, c));
  const n = { x: ((b.y - a.y) / len) * half, y: (-(b.x - a.x) / len) * half };
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
}

/**
 * TradingView's arc: a 60 degree slice of a circle through a and b, stretched
 * across the chord until it bulges toward c by c's distance from the chord.
 */
export function arcPoints(a: Pt, b: Pt, c: Pt, steps = 64): Pt[] {
  const chord = dist(a, b);
  const bulge = sideDistance(a, b, c);
  if (chord === 0 || Math.abs(bulge) < 1) return [a, b];
  const along = scale(sub(b, a), 1 / chord);
  const normal = { x: -along.y, y: along.x };
  const sagitta = 1 - Math.sqrt(3) / 2;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (-2 * Math.PI) / 3 + (i / steps) * (Math.PI / 3);
    const x = chord * (0.5 + Math.cos(angle));
    const rise = -(Math.sqrt(3) / 2 + Math.sin(angle)) / sagitta;
    return add(a, add(scale(along, x), scale(normal, rise * bulge)));
  });
}

/** Curve: two quadratic pieces meeting at the middle point, whose tangent there runs parallel to start-end. */
export function curveControls(start: Pt, end: Pt, middle: Pt): [Pt, Pt] {
  const d = scale(sub(end, start), 0.25);
  return [sub(middle, d), add(middle, d)];
}

/** Double curve: a quadratic into p3, a cubic from p3 to p4 and a quadratic out to the end. */
export function doubleCurveControls(start: Pt, end: Pt, p3: Pt, p4: Pt): [Pt, Pt, Pt, Pt] {
  const d3 = scale(sub(p4, start), 0.25);
  const d4 = scale(sub(end, p3), 0.25);
  return [sub(p3, d3), add(p3, d3), sub(p4, d4), add(p4, d4)];
}

const quadAt = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => add(add(scale(p0, (1 - t) * (1 - t)), scale(c, 2 * t * (1 - t))), scale(p1, t * t));

/** Continues the quadratic piece from p0 through p1 past p1 until it leaves the pane by a wide margin. */
export function extendQuad(p0: Pt, c: Pt, p1: Pt, pane: { width: number; height: number }): Pt[] {
  const step = 3 / Math.max(1, dist(p0, c) + dist(c, p1));
  const far = pane.width + pane.height;
  const out = [p1];
  for (let t = 1 + step; out.length < 4000; t += step) {
    const q = quadAt(p0, c, p1, t);
    out.push(q);
    if (q.x < -far || q.y < -far || q.x > pane.width + far || q.y > pane.height + far) break;
  }
  return out;
}

const background = (p: Props, fallback: string) => fillColor(pstr(p, 'backgroundColor', fallback), p.transparency);

interface TextLayout {
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  baseline: 'top' | 'middle' | 'bottom';
  wrap: number | null;
}

/**
 * Rectangle text: "middle" sits inside, padded by a third of the font size;
 * TradingView's "top" hangs below the bottom edge and "bottom" sits above the top edge.
 */
export function rectangleTextLayout(p: Props, box: Box): TextLayout {
  const pad = pnum(p, 'fontSize', 14) / 3;
  const h = pstr(p, 'horzLabelsAlign', 'center');
  const v = pstr(p, 'vertLabelsAlign', 'middle');
  const inner = v === 'middle' ? pad : 0;
  const align = h === 'left' ? 'left' : h === 'right' ? 'right' : 'center';
  const x = align === 'left' ? box.x + inner : align === 'right' ? box.x + box.w - inner : box.x + box.w / 2;
  if (v === 'top') return { x, y: box.y + box.h + pad, align, baseline: 'top', wrap: null };
  if (v === 'bottom') return { x, y: box.y - pad, align, baseline: 'bottom', wrap: null };
  return { x, y: box.y + box.h / 2, align, baseline: 'middle', wrap: Math.max(1, box.w - 2 * pad) };
}

const textOptions = (p: Props, fallbackColor: string) => ({ font: font(p, 'fontSize', 14), color: pstr(p, 'textColor', fallbackColor) });

export function drawRectangle(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const width = pnum(p, 'linewidth', 2);
  const crisp = (v: number) => Math.round(v) + (width % 2) / 2;
  const left = p.extendLeft === true ? -width : crisp(Math.min(a.x, b.x));
  const right = p.extendRight === true ? dc.width + width : crisp(Math.max(a.x, b.x));
  const top = crisp(Math.min(a.y, b.y));
  const box = { x: left, y: top, w: right - left, h: crisp(Math.max(a.y, b.y)) - top };
  const color = pstr(p, 'color', '#9C27B0');
  const ctx = dc.ctx;
  if (p.fillBackground !== false) {
    ctx.fillStyle = background(p, 'rgba(156, 39, 176, 0.2)');
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  const text = pstr(p, 'text', '');
  const layout = rectangleTextLayout(p, { ...box, x: Math.max(box.x, 0), w: Math.min(box.x + box.w, dc.width) - Math.max(box.x, 0) });
  const options = { ...textOptions(p, color), align: layout.align, baseline: layout.baseline, wrapWidth: layout.wrap };
  const middle = pobj(p, 'middleLine');
  if (middle.showLine === true) {
    const y = box.y + box.h / 2;
    setStroke(ctx, pstr(middle, 'lineColor', color), pnum(middle, 'lineWidth', 1), pnum(middle, 'lineStyle', 2));
    const gap = text && layout.baseline === 'middle' ? textBox(ctx, text, layout, options) : null;
    if (gap) {
      strokeLine(ctx, { x: box.x, y }, { x: gap.x, y });
      strokeLine(ctx, { x: gap.x + gap.w, y }, { x: box.x + box.w, y });
    } else strokeLine(ctx, { x: box.x, y }, { x: box.x + box.w, y });
  }
  setStroke(ctx, color, width, p.linestyle);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  if (text) drawText(ctx, text, layout.x, layout.y, options);
}

function textBox(ctx: CanvasRenderingContext2D, text: string, layout: TextLayout, o: { font: string; wrapWidth: number | null }): Box {
  const m = measureText(ctx, text, { font: o.font, color: '', wrapWidth: o.wrapWidth });
  const x = layout.align === 'left' ? layout.x : layout.align === 'right' ? layout.x - m.w : layout.x - m.w / 2;
  return { x, y: layout.y - m.h / 2, w: m.w, h: m.h };
}

/** Centred text, turned to `angle` and wrapped to `wrap` pixels, as in circles and ellipses. */
function centredText(ctx: CanvasRenderingContext2D, p: Props, center: Pt, angle: number, wrap: number, fallbackColor: string): void {
  const text = pstr(p, 'text', '');
  if (!text) return;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  drawText(ctx, text, 0, 0, { ...textOptions(p, fallbackColor), align: 'center', baseline: 'middle', wrapWidth: wrap });
  ctx.restore();
}

/**
 * Ellipse: a-b is one axis and c sets the other radius by its distance from it.
 * Version 1 drawings stored the two corners of the bounding box instead.
 */
export function ellipseAxes(pts: readonly Pt[]): [Pt, Pt, Pt] {
  const [a, b, c] = pts as [Pt, Pt, Pt | undefined];
  if (c) return [a, b, c];
  const y = (a.y + b.y) / 2;
  return [{ x: a.x, y }, { x: b.x, y }, a];
}

export function drawEllipse(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const [a, b, c] = ellipseAxes(points.slice(0, 3).map((pt) => dc.pt(pt)));
  const ctx = dc.ctx;
  const ry = Math.abs(sideDistance(a, b, c));
  setStroke(ctx, pstr(p, 'color', '#F23645'), pnum(p, 'linewidth', 2));
  ctx.beginPath();
  if (ry < 1) {
    strokeLine(ctx, a, b);
    return;
  }
  const center = mid(a, b);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.ellipse(center.x, center.y, dist(a, b) / 2, ry, angle, 0, Math.PI * 2);
  ctx.stroke();
  if (p.fillBackground !== false) {
    ctx.fillStyle = background(p, 'rgba(242, 54, 69, 0.2)');
    ctx.fill();
  }
  centredText(ctx, p, center, Math.atan((a.y - b.y) / (a.x - b.x)) || 0, dist(a, b) / SQRT2, pstr(p, 'color', '#F23645'));
}

/** Circle: TradingView keeps the stroke inside the radius and fills only inside the stroke. */
export function drawCircle(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const c = dc.pt(points[0]!);
  const r = dist(c, dc.pt(points[1]!));
  const width = pnum(p, 'linewidth', 2);
  const ctx = dc.ctx;
  if (p.fillBackground !== false && r - width > 0) {
    ctx.fillStyle = pstr(p, 'backgroundColor', 'rgba(255, 152, 0, 0.2)');
    ctx.beginPath();
    ctx.arc(c.x, c.y, r - width, 0, Math.PI * 2);
    ctx.fill();
  }
  setStroke(ctx, pstr(p, 'color', '#FF9800'), width);
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.max(0.5, r - width / 2), 0, Math.PI * 2);
  ctx.stroke();
  centredText(ctx, p, c, 0, r * SQRT2, pstr(p, 'color', '#FF9800'));
}

function drawTriangle(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  strokePolygon(
    dc.ctx,
    points.slice(0, 3).map((pt) => dc.pt(pt)),
    {
      color: pstr(p, 'color', '#F23645'),
      width: pnum(p, 'linewidth', 2),
      style: p.linestyle,
      fill: p.fillBackground !== false ? background(p, 'rgba(242, 54, 69, 0.2)') : null,
      close: true,
      leftArrow: false,
      rightArrow: false,
    },
  );
}

function drawRotatedRectangle(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const [a, b, c] = points.map((pt) => dc.pt(pt)) as [Pt, Pt, Pt | undefined];
  const color = pstr(p, 'color', '#089981');
  if (!c) {
    strokePolygon(dc.ctx, [a, b], { color, width: 1, style: 0, fill: null, close: false, leftArrow: false, rightArrow: false });
    return;
  }
  strokePolygon(dc.ctx, rotatedRectCorners(a, b, c), {
    color,
    width: pnum(p, 'linewidth', 2),
    style: 0,
    fill: p.fillBackground !== false ? background(p, 'rgba(8, 153, 129, 0.2)') : null,
    close: true,
    leftArrow: false,
    rightArrow: false,
  });
}

/** TradingView strokes the arc first and fills the region between it and its chord over the stroke. */
function drawArc(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const [a, b, c] = points.map((pt) => dc.pt(pt)) as [Pt, Pt, Pt];
  const pts = arcPoints(a, b, c);
  const ctx = dc.ctx;
  setStroke(ctx, pstr(p, 'color', '#2962FF'), pnum(p, 'linewidth', 2));
  ctx.beginPath();
  pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
  ctx.stroke();
  if (pts.length > 2 && p.fillBackground !== false) {
    ctx.fillStyle = background(p, 'rgba(41, 98, 255, 0.2)');
    ctx.fill();
  }
}

interface CurvePieces {
  start: Pt;
  end: Pt;
  /** Control point next to the start and the end, for arrows and extensions. */
  startControl: Pt;
  endControl: Pt;
  /** The point the first and last quadratic pieces turn around, for extensions. */
  startPivot: Pt;
  endPivot: Pt;
  trace(ctx: CanvasRenderingContext2D): void;
}

function curvePieces(pts: readonly Pt[]): CurvePieces {
  const [start, end, p3, p4] = pts as [Pt, Pt, Pt, Pt | undefined];
  if (!p4) {
    const [c1, c2] = curveControls(start, end, p3);
    return {
      start,
      end,
      startControl: c1,
      endControl: c2,
      startPivot: p3,
      endPivot: p3,
      trace(ctx) {
        ctx.moveTo(start.x, start.y);
        ctx.quadraticCurveTo(c1.x, c1.y, p3.x, p3.y);
        ctx.quadraticCurveTo(c2.x, c2.y, end.x, end.y);
      },
    };
  }
  const [c1, c2, c3, c4] = doubleCurveControls(start, end, p3, p4);
  return {
    start,
    end,
    startControl: c1,
    endControl: c4,
    startPivot: p3,
    endPivot: p4,
    trace(ctx) {
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(c1.x, c1.y, p3.x, p3.y);
      ctx.bezierCurveTo(c2.x, c2.y, c3.x, c3.y, p4.x, p4.y);
      ctx.quadraticCurveTo(c4.x, c4.y, end.x, end.y);
    },
  };
}

/** Curve and double curve: background first, then the line with its extensions and arrow ends. */
function drawCurve(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const pts = points.map((pt) => dc.pt(pt));
  const ctx = dc.ctx;
  const width = pnum(p, 'linewidth', 2);
  setStroke(ctx, pstr(p, 'linecolor', '#2962FF'), width, p.linestyle);
  ctx.lineCap = 'round';
  if (pts.length < 3) {
    strokeLine(ctx, pts[0]!, pts[1]!);
    return;
  }
  const curve = curvePieces(pts);
  if (p.fillBackground === true) {
    ctx.fillStyle = background(p, 'rgba(41, 98, 255, 0.2)');
    ctx.beginPath();
    curve.trace(ctx);
    ctx.fill();
  }
  ctx.beginPath();
  curve.trace(ctx);
  const extensions = [
    p.extendLeft === true && extendQuad(curve.startPivot, curve.startControl, curve.start, dc),
    p.extendRight === true && extendQuad(curve.endPivot, curve.endControl, curve.end, dc),
  ];
  for (const line of extensions) {
    if (!line) continue;
    ctx.moveTo(line[0]!.x, line[0]!.y);
    for (const q of line) ctx.lineTo(q.x, q.y);
  }
  if (pnum(p, 'leftEnd', 0) === ARROW) addArrow(ctx, curve.startControl, curve.start, width);
  if (pnum(p, 'rightEnd', 0) === ARROW) addArrow(ctx, curve.endControl, curve.end, width);
  ctx.stroke();
}

export const SHAPE_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolRectangle: kind(2, drawRectangle),
  LineToolRotatedRectangle: kind(2, drawRotatedRectangle),
  LineToolEllipse: kind(2, drawEllipse),
  LineToolCircle: kind(2, drawCircle),
  LineToolTriangle: kind(3, drawTriangle),
  LineToolArc: kind(3, drawArc),
  LineToolBezierQuadro: kind(2, drawCurve),
  LineToolBezierCubic: kind(2, drawCurve),
};
