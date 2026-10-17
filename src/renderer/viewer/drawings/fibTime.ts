import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import { num, type Props } from '../../../core/props';
import { extendSegment, pnum, pobj, pstr, type DrawContext, type Pt } from './canvas';
import { drawLabel, formatCoeff, labelBox, drawLabelIn, LEVEL_LAYOUT, parseFibLevels, tvDash, tvFill, tvFillRect, tvLine, withoutBoxes, type FibLevel, type HAlign, type VAlign } from './fib';
import { kind, type DrawingKind } from './kind';

// Fib time zones: vertical lines at bar offsets.

/** Bar positions of time levels: `from` plus each coefficient times `step` bars, rounded to whole bars as TradingView does. */
export function fibTimeBars(levels: readonly Pick<FibLevel, 'coeff'>[], from: number, step: number): number[] {
  return levels.map((l) => Math.round(from + l.coeff * step));
}

/** Version 1 time zones kept one colour, width and style for all levels; TradingView copies them into the levels on load. */
export function timeZoneLevels(props: Props, version: number): FibLevel[] {
  const levels = parseFibLevels(props, LEVEL_LAYOUT.styled);
  if (version >= 2 || !('linecolor' in props)) return levels;
  return levels.map((l, i) => ({
    ...l,
    color: pstr(props, i === 0 ? 'baselinecolor' : 'linecolor', l.color),
    width: pnum(props, 'linewidth', l.width ?? 1),
    style: pnum(props, 'linestyle', l.style ?? 0),
  }));
}

/** Labels sit beside the line: "right" draws them to its right, so TradingView's text box is left-aligned there. */
const besideLine: Record<string, HAlign> = { right: 'left', left: 'right', center: 'center' };

function drawTimeLevels(dc: DrawContext, props: Props, levels: FibLevel[], bars: number[], showLabels: boolean): void {
  const { ctx } = dc;
  const xs = bars.map((b) => dc.x(b));
  if (props.fillBackground === true) {
    for (let i = 1; i < levels.length; i++) tvFillRect(ctx, xs[i - 1]!, 0, xs[i]!, dc.height, tvFill(levels[i]!.color, pnum(props, 'transparency', 80)));
  }
  const vAlign = pstr(props, 'vertLabelsAlign', 'bottom') as VAlign;
  const hAlign = besideLine[pstr(props, 'horzLabelsAlign', 'right')] ?? 'left';
  const labelY = vAlign === 'top' ? 0 : vAlign === 'middle' ? dc.height / 2 : dc.height;
  levels.forEach((l, i) => {
    const x = xs[i]!;
    const style = { fontSize: 12, color: l.color, h: hAlign, v: vAlign, offsetX: 2, offsetY: 0 };
    const box = showLabels ? labelBox(ctx, String(l.coeff), x, labelY, style) : null;
    if (box) drawLabelIn(ctx, String(l.coeff), box, style);
    withoutBoxes(dc, box && hAlign === 'center' ? [box] : [], () => tvLine(ctx, { x, y: 0 }, { x, y: dc.height }, l.color, l.width ?? 2, l.style ?? 0, 'butt'));
  });
}

export function drawFibTimeZone(dc: DrawContext, props: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const levels = timeZoneLevels(props, num(drawing.source.version, 1)).filter((l) => l.visible);
  const from = dc.logical(points[0]!);
  const step = points[1] ? dc.logical(points[1]) - from : 1;
  drawTimeLevels(dc, props, levels, fibTimeBars(levels, from, step), props.showLabels !== false);
  if (points[1]) {
    const tl = pobj(props, 'trendline');
    tvLine(dc.ctx, dc.pt(points[0]!), dc.pt(points[1]), pstr(tl, 'color', '#808080'), pnum(tl, 'linewidth', 1), pnum(tl, 'linestyle', 2));
  }
}

function drawTrendline(dc: DrawContext, props: Props, a: Pt, b: Pt): void {
  const tl = pobj(props, 'trendline');
  if (tl.visible !== false) tvLine(dc.ctx, a, b, pstr(tl, 'color', '#808080'), pnum(tl, 'linewidth', 2), pnum(tl, 'linestyle', 2));
}

export function drawTrendBasedFibTime(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const [i1, i2, i3] = points.map((p) => dc.logical(p)) as [number, number, number];
  if (i1 === i2) return;
  const [a, b, c] = points.map((p) => dc.pt(p)) as [Pt, Pt, Pt];
  drawTrendline(dc, props, a, b);
  drawTrendline(dc, props, b, c);
  const levels = parseFibLevels(props, LEVEL_LAYOUT.styled).filter((l) => l.visible);
  drawTimeLevels(dc, props, levels, fibTimeBars(levels, i3, i2 - i1), props.showCoeffs !== false);
}

// Fib circles and speed resistance arcs: rings of fib-scaled radii.

/** Label to the left of the ring's apex, right-aligned 8px before it. */
function ringLabel(dc: DrawContext, props: Props, l: FibLevel, x: number, y: number): void {
  if (props.showCoeffs === false) return;
  drawLabel(dc.ctx, formatCoeff(l.coeff, props.coeffsAsPercents === true), x, y, { fontSize: pnum(props, 'labelFontSize', 12), color: l.color, h: 'right', v: 'middle', offsetX: 4 });
}

/** Circles: ellipses centred between the points, coefficient 1 inscribed in their box. */
export function fibCircleRadii(a: Pt, b: Pt, coeff: number): { rx: number; ry: number } {
  return { rx: (Math.abs(b.x - a.x) / 2) * coeff, ry: (Math.abs(b.y - a.y) / 2) * coeff };
}

export function drawFibCircles(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const [a, b] = points.map((p) => dc.pt(p)) as [Pt, Pt];
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const { ctx } = dc;
  let inner: { rx: number; ry: number } | null = null;
  for (const l of parseFibLevels(props, LEVEL_LAYOUT.styled).filter((l) => l.visible)) {
    const r = fibCircleRadii(a, b, l.coeff);
    if (r.rx * 2 < 1 || r.ry * 2 < 1) continue;
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.width ?? 2;
    ctx.lineCap = 'butt';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r.rx, r.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (props.fillBackground !== false) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r.rx, r.ry, 0, 0, Math.PI * 2);
      if (inner) {
        ctx.moveTo(c.x + inner.rx, c.y);
        ctx.ellipse(c.x, c.y, inner.rx, inner.ry, 0, 0, Math.PI * 2);
      }
      ctx.fillStyle = tvFill(l.color, pnum(props, 'transparency', 80));
      ctx.fill('evenodd');
    }
    ringLabel(dc, props, l, c.x, c.y + r.ry);
    inner = r;
  }
  drawTrendline(dc, props, a, b);
}

/** Speed resistance arcs: circles around point 1 whose radius is the coefficient times the distance to point 2. */
export function drawFibSpeedResistanceArcs(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const [a, b] = points.map((p) => dc.pt(p)) as [Pt, Pt];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const dir = Math.sign(b.y - a.y);
  const full = props.fullCircles === true;
  // The half circle bulges toward point 2's side: below when point 2 is lower on screen.
  const [from, to] = full ? [0, Math.PI * 2] : dir > 0 ? [0, Math.PI] : [Math.PI, Math.PI * 2];
  const { ctx } = dc;
  let inner = 0;
  for (const l of parseFibLevels(props, LEVEL_LAYOUT.styled).filter((l) => l.visible)) {
    const r = Math.abs(l.coeff) * d;
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.width ?? 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, from, to);
    ctx.stroke();
    if (props.fillBackground !== false) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, from, to);
      if (inner > 0) ctx.arc(a.x, a.y, inner, to, from, true);
      ctx.closePath();
      ctx.fillStyle = tvFill(l.color, pnum(props, 'transparency', 80));
      ctx.fill();
    }
    ringLabel(dc, props, l, a.x, a.y + dir * r);
    inner = r;
  }
  drawTrendline(dc, props, a, b);
}

// Fib spiral.

const FIB = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

/** Spiral radius in fifths of the point distance after `t` quarter turns: Fibonacci numbers, eased between them. */
export function fibSpiralRadius(t: number): number {
  const lo = Math.floor(t);
  const hi = Math.ceil(t);
  return FIB[lo]! + (FIB[hi]! - FIB[lo]!) * (t - lo) ** 1.15;
}

/** The spiral around point 1 that passes through point 2 after one full turn, about two and a half turns in all. */
export function fibSpiralPoints(a: Pt, b: Pt, counterclockwise: boolean): Pt[] {
  const unit = Math.hypot(b.x - a.x, b.y - a.y) / 5;
  const phi = Math.atan2(b.y - a.y, b.x - a.x);
  const out: Pt[] = [a];
  for (let e = 0; e < 500; e++) {
    const theta = ((counterclockwise ? -1 : 1) * e * Math.PI) / 100 + phi;
    const rho = fibSpiralRadius(e / 50) * unit;
    out.push({ x: a.x + rho * Math.cos(theta), y: a.y + rho * Math.sin(theta) });
  }
  return out;
}

export function drawFibSpiral(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const [a, b] = points.map((p) => dc.pt(p)) as [Pt, Pt];
  const color = pstr(props, 'linecolor', '#00bcd4');
  const width = pnum(props, 'linewidth', 2);
  const style = pnum(props, 'linestyle', 0);
  const { ctx } = dc;
  tvLine(ctx, a, extendSegment(a, b, false, true, dc)[1], color, width, style);
  ctx.lineWidth = width;
  ctx.setLineDash(tvDash(style, width));
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const p of fibSpiralPoints(a, b, props.counterclockwise === true)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

export const FIB_TIME_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolFibTimeZone: kind(1, drawFibTimeZone),
  LineToolTrendBasedFibTime: kind(3, drawTrendBasedFibTime),
  LineToolFibCircles: kind(2, drawFibCircles),
  LineToolFibSpeedResistanceArcs: kind(2, drawFibSpeedResistanceArcs),
  LineToolFibSpiral: kind(2, drawFibSpiral),
};
