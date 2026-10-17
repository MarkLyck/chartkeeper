import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor } from '../colors';
import { FONT_FAMILY, fillPolygon, pnum, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';

/** A dotted line between two pattern points with the ratio TradingView prints at its middle. */
export interface RatioLeg {
  from: number;
  to: number;
  ratio: number;
}

/** |move| / |base| to three decimals, the number TradingView prints on pattern legs. */
export const ratio = (move: number, base: number): number => Math.round(1000 * Math.abs(move / base)) / 1000;

/** XABCD: AB of XA on X-B, BC of AB on A-C, CD of BC on B-D, AD of XA on X-D. */
export function xabcdLegs([x, a, b, c, d]: number[]): RatioLeg[] {
  return [
    { from: 0, to: 2, ratio: ratio(b! - a!, a! - x!) },
    { from: 1, to: 3, ratio: ratio(c! - b!, b! - a!) },
    { from: 2, to: 4, ratio: ratio(d! - c!, c! - b!) },
    { from: 0, to: 4, ratio: ratio(d! - a!, a! - x!) },
  ];
}

/** Cypher measures C against XA and D against XC instead of the XABCD legs. */
export function cypherLegs([x, a, b, c, d]: number[]): RatioLeg[] {
  return [
    { from: 0, to: 2, ratio: ratio(b! - a!, a! - x!) },
    { from: 1, to: 3, ratio: ratio(c! - x!, a! - x!) },
    { from: 2, to: 4, ratio: ratio(d! - c!, c! - b!) },
    { from: 0, to: 4, ratio: ratio(d! - c!, x! - c!) },
  ];
}

/** ABCD: BC of AB on A-C, CD of BC on B-D. */
export function abcdLegs([a, b, c, d]: number[]): RatioLeg[] {
  return [
    { from: 0, to: 2, ratio: ratio(c! - b!, b! - a!) },
    { from: 1, to: 3, ratio: ratio(d! - c!, c! - b!) },
  ];
}

/** Point labels sit above a point that is higher than the one before it (the first point: lower than the next). */
export function labelAbove(pts: Pt[], i: number): boolean {
  return i === 0 ? pts[1]!.y > pts[0]!.y : pts[i]!.y < pts[i - 1]!.y;
}

/** Where the infinite line a-b crosses segment p-q, or null when it misses it. */
export function lineCrossSegment(a: Pt, b: Pt, p: Pt, q: Pt): Pt | null {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const e = { x: q.x - p.x, y: q.y - p.y };
  const cross = d.x * e.y - d.y * e.x;
  if (Math.abs(cross) < 1e-6) return null;
  const t = ((a.y - p.y) * e.x - (a.x - p.x) * e.y) / cross;
  const hit = { x: a.x + d.x * t, y: a.y + d.y * t };
  const along = Math.abs(e.x) > Math.abs(e.y) ? (hit.x - p.x) / e.x : (hit.y - p.y) / e.y;
  return along >= -1e-9 && along <= 1 + 1e-9 ? hit : null;
}

/**
 * Triangle pattern: lines A-C and B-D are cut at the leftmost point and meet at the apex;
 * when the apex lies left of the points, the lines are cut at the rightmost point instead.
 */
export function trianglePatternShape([a, b, c, d]: Pt[]): [Pt, Pt, Pt] | null {
  if (Math.abs(c!.x - a!.x) < 1 || Math.abs(d!.x - b!.x) < 1) return null;
  const k1 = (c!.y - a!.y) / (c!.x - a!.x);
  const k2 = (d!.y - b!.y) / (d!.x - b!.x);
  if (Math.abs(k1 - k2) < 1e-6) return null;
  const apexX = (b!.y - a!.y + (a!.x * k1 - b!.x * k2)) / (k1 - k2);
  const xs = [a!.x, b!.x, c!.x, d!.x];
  const baseX = apexX < Math.min(...xs) ? Math.max(...xs) : Math.min(...xs);
  return [
    { x: baseX, y: a!.y + (baseX - a!.x) * k1 },
    { x: baseX, y: b!.y + (baseX - b!.x) * k2 },
    { x: apexX, y: a!.y + (apexX - a!.x) * k1 },
  ];
}

const color = (p: Props) => pstr(p, 'color', '#2962FF');
const width = (p: Props) => pnum(p, 'linewidth', 2);
const background = (p: Props) => fillColor(pstr(p, 'backgroundColor', color(p)), p.transparency);

function polyline(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
  ctx.stroke();
}

function stroke(dc: DrawContext, p: Props, style: number, lineWidth = width(p)): void {
  setStroke(dc.ctx, color(p), lineWidth, style);
  dc.ctx.lineCap = style === 0 ? 'round' : 'butt';
}

/** TradingView's pattern label: text in a box of the line colour with 4 px corners and font/3 padding. */
function labelBox(dc: DrawContext, p: Props, text: string, at: Pt, place: 'above' | 'below' | 'center'): void {
  const { ctx } = dc;
  const size = Math.ceil(pnum(p, 'fontsize', 12));
  ctx.font = `${p.bold === true ? 'bold ' : ''}${p.italic === true ? 'italic ' : ''}${size}px ${FONT_FAMILY}`;
  const pad = size / 3;
  const raw = Math.round(ctx.measureText(text).width + 2 * pad);
  const w = raw % 2 ? raw + 1 : raw;
  const h = size + 2 * pad;
  const top = place === 'above' ? at.y - h - 5 : place === 'below' ? at.y + 5 : at.y - h / 2;
  const left = Math.round(at.x - w / 2);
  ctx.setLineDash([]);
  ctx.fillStyle = color(p);
  ctx.beginPath();
  ctx.roundRect(left, Math.round(top), w, Math.round(h), 4);
  ctx.fill();
  ctx.fillStyle = pstr(p, 'textcolor', '#ffffff');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + w / 2, Math.round(top) + pad + size / 2 + 0.05 * size);
}

function pointLabels(dc: DrawContext, p: Props, pts: Pt[], names: readonly (string | null)[]): void {
  names.forEach((name, i) => {
    if (name && pts[i]) labelBox(dc, p, name, pts[i], labelAbove(pts, i) ? 'above' : 'below');
  });
}

function ratioLegs(dc: DrawContext, p: Props, pts: Pt[], legs: RatioLeg[], legWidth: number): void {
  for (const leg of legs) {
    stroke(dc, p, 1, legWidth);
    strokeLine(dc.ctx, pts[leg.from]!, pts[leg.to]!);
  }
  for (const leg of legs) {
    const a = pts[leg.from]!;
    const b = pts[leg.to]!;
    labelBox(dc, p, String(leg.ratio), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'center');
  }
}

const fills = (p: Props) => p.fillBackground !== false;

function fivePoints(legs: (prices: number[]) => RatioLeg[]): DrawingKind['draw'] {
  return (dc, p, points) => {
    const pts = points.map((pt) => dc.pt(pt));
    if (fills(p)) {
      fillPolygon(dc.ctx, pts.slice(0, 3), background(p));
      fillPolygon(dc.ctx, pts.slice(2, 5), background(p));
    }
    stroke(dc, p, 0);
    polyline(dc.ctx, pts);
    ratioLegs(dc, p, pts, legs(points.map((pt) => pt.price)), 1);
    pointLabels(dc, p, pts, ['X', 'A', 'B', 'C', 'D']);
  };
}

function drawAbcd(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const pts = points.map((pt) => dc.pt(pt));
  stroke(dc, p, 0);
  polyline(dc.ctx, pts);
  pointLabels(dc, p, pts, ['A', 'B', 'C', 'D']);
  ratioLegs(dc, p, pts, abcdLegs(points.map((pt) => pt.price)), width(p));
}

function drawTrianglePattern(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const pts = points.map((pt) => dc.pt(pt));
  stroke(dc, p, 0);
  for (let i = 1; i < pts.length; i++) strokeLine(dc.ctx, pts[i - 1]!, pts[i]!);
  const shape = trianglePatternShape(pts);
  if (shape) {
    if (fills(p)) fillPolygon(dc.ctx, shape, background(p));
    stroke(dc, p, 1);
    dc.ctx.beginPath();
    dc.ctx.moveTo(shape[0].x, shape[0].y);
    dc.ctx.lineTo(shape[1].x, shape[1].y);
    dc.ctx.lineTo(shape[2].x, shape[2].y);
    dc.ctx.closePath();
    dc.ctx.stroke();
  }
  pointLabels(dc, p, pts, ['A', 'B', 'C', 'D']);
}

/** Points: start, left shoulder, trough, head, trough, right shoulder, end. The neckline runs through the troughs. */
function drawHeadAndShoulders(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const pts = points.map((pt) => dc.pt(pt));
  const [start, ls, t1, head, t2, rs, end] = pts as [Pt, Pt, Pt, Pt, Pt, Pt, Pt];
  const left = lineCrossSegment(t1, t2, start, ls);
  const right = lineCrossSegment(t1, t2, rs, end);
  if (fills(p)) {
    fillPolygon(dc.ctx, [t1, head, t2], background(p));
    if (left) fillPolygon(dc.ctx, [left, ls, t1], background(p));
    if (right) fillPolygon(dc.ctx, [t2, rs, right], background(p));
  }
  stroke(dc, p, 0);
  polyline(dc.ctx, pts);
  stroke(dc, p, 1);
  const far = (dc.width + dc.height) * 4;
  const dir = { x: t2.x - t1.x, y: t2.y - t1.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const reach = (from: Pt, sign: number): Pt => ({ x: from.x + (sign * far * dir.x) / len, y: from.y + (sign * far * dir.y) / len });
  strokeLine(dc.ctx, left ?? reach(t1, -1), right ?? reach(t2, 1));
  pointLabels(dc, p, pts, [null, 'Left Shoulder', null, 'Head', null, 'Right Shoulder', null]);
}

export const PATTERN_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineTool5PointsPattern: kind(5, fivePoints(xabcdLegs)),
  LineToolCypherPattern: kind(5, fivePoints(cypherLegs)),
  LineToolABCD: kind(4, drawAbcd),
  LineToolTrianglePattern: kind(4, drawTrianglePattern),
  LineToolHeadAndShoulders: kind(7, drawHeadAndShoulders),
};
