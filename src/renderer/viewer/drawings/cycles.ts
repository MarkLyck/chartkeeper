import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor } from '../colors';
import { pnum, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';

/** Bar positions of cyclic lines: from the first point every `step` bars (signed) up to the visible edge. */
export function cyclePositions(start: number, step: number, firstVisible: number, lastVisible: number): number[] {
  if (step === 0) return [];
  const out: number[] = [];
  for (let i = start; step > 0 ? i <= lastVisible : i >= firstVisible; i += step) out.push(i);
  return out;
}

/** Bar positions where time-cycle arcs start: every `period` bars back from the earlier point and on from the later one, covering the pane. */
export function timeCycleStarts(first: number, period: number, firstVisible: number, lastVisible: number): number[] {
  if (period <= 0) return [];
  const out: number[] = [];
  for (let i = first; i + period > firstVisible; i -= period) out.unshift(i);
  for (let i = first + period; i < lastVisible; i += period) out.push(i);
  return out;
}

/**
 * Sine line through two points: the first is an extreme, the second the opposite extreme half a period later.
 * Returns the curve's samples across [0, width], starting from the cycle start at or left of x = 0.
 */
export function sinePoints(a: Pt, b: Pt, width: number): Pt[] {
  const half = Math.abs(a.x - b.x);
  if (half === 0) return [];
  const amp = b.y - a.y;
  const period = 2 * half;
  const x0 = a.x > 0 ? a.x - Math.ceil(a.x / period) * period : a.x + Math.floor(-a.x / period) * period;
  const step = Math.max(1, half / 30);
  const out: Pt[] = [{ x: x0, y: a.y }];
  for (let e = 1; e <= width - x0 + step; e += step) out.push({ x: x0 + e, y: a.y + amp / 2 - (Math.cos((e * Math.PI) / half) * amp) / 2 });
  return out;
}

const lineColor = (p: Props, fallback: string) => pstr(p, 'linecolor', fallback);
const lineWidth = (p: Props) => pnum(p, 'linewidth', 2);

/** First and last bar positions on screen, extended by one bar so lines at the edges are kept. */
function visibleBars(dc: DrawContext): [number, number] {
  const spacing = dc.barSpacing || 1;
  const x0 = dc.x(0);
  return [Math.floor(-x0 / spacing) - 1, Math.ceil((dc.width - x0) / spacing) + 1];
}

function drawCyclicLines(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const [p0, p1] = points as [DrawingPoint, DrawingPoint];
  const start = Math.round(dc.logical(p0));
  const step = Math.round(dc.logical(p1)) - start;
  const [first, last] = visibleBars(dc);
  const { ctx } = dc;
  setStroke(ctx, '#808080', 1, 2);
  strokeLine(ctx, dc.pt(p0), dc.pt(p1));
  const width = lineWidth(p);
  setStroke(ctx, lineColor(p, '#80ccdb'), width, p.linestyle);
  for (const i of cyclePositions(start, step, first, last)) {
    const x = Math.round(dc.x(i)) + (width % 2 ? 0.5 : 0);
    strokeLine(ctx, { x, y: 0 }, { x, y: dc.height });
  }
}

/** Half circles standing on the first point's price, one per period between the two points. */
function drawTimeCycles(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const [p0, p1] = points as [DrawingPoint, DrawingPoint];
  const i0 = Math.round(dc.logical(p0));
  const i1 = Math.round(dc.logical(p1));
  const diameter = Math.abs(dc.pt(p0).x - dc.pt(p1).x);
  const y = dc.pt(p0).y;
  const [first, last] = visibleBars(dc);
  const { ctx } = dc;
  setStroke(ctx, lineColor(p, '#159980'), lineWidth(p), p.linestyle);
  for (const i of timeCycleStarts(Math.min(i0, i1), Math.abs(i1 - i0), first, last)) {
    const r = diameter / 2;
    ctx.beginPath();
    ctx.ellipse(dc.x(i) + 1 + r, y, Math.max(r, 0.5), Math.max(r, 0.5), 0, Math.PI, 0);
    ctx.stroke();
    if (p.fillBackground !== false) {
      ctx.fillStyle = fillColor(pstr(p, 'backgroundColor', 'rgba(106, 168, 79, 0.5)'), p.transparency);
      ctx.fill();
    }
  }
}

function drawSineLine(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const pts = sinePoints(dc.pt(points[0]!), dc.pt(points[1]!), dc.width);
  if (!pts.length) return;
  const { ctx } = dc;
  setStroke(ctx, lineColor(p, '#159980'), lineWidth(p), p.linestyle);
  ctx.beginPath();
  pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
  ctx.stroke();
}

export const CYCLE_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolCircleLines: kind(2, drawCyclicLines),
  LineToolTimeCycles: kind(2, drawTimeCycles),
  LineToolSineLine: kind(2, drawSineLine),
};
