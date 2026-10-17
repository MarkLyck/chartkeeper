import type { DrawingPoint } from '../../../core/layout';
import type { Bar } from '../../../core/model';
import { num, obj, type Props } from '../../../core/props';
import { fillColor, parseColor, rgbaCss } from '../colors';
import { drawText, fillPolygon, FONT_FAMILY, pnum, pobj, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';
import { extendToPane, textOnLine } from './lines';

interface LineStyle {
  color: string;
  width: number;
  style: number;
}

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const mid = (a: Pt, b: Pt): Pt => scale(add(a, b), 0.5);

function stroke(ctx: CanvasRenderingContext2D, s: LineStyle, a: Pt, b: Pt): void {
  setStroke(ctx, s.color, s.width, s.style);
  strokeLine(ctx, a, b);
}

const mainLine = (p: Props): LineStyle => ({ color: pstr(p, 'linecolor', '#2962FF'), width: pnum(p, 'linewidth', 1), style: pnum(p, 'linestyle', 0) });

const labelFont = (p: Props) => `${p.labelItalic === true ? 'italic ' : ''}${p.labelBold === true ? 'bold ' : ''}${pnum(p, 'labelFontSize', 14)}px ${FONT_FAMILY}`;

/** Parallel channel: line 1-2, a parallel copy through point 3, and the levels between them (0 = line 1-2, 1 = the copy). */
export function drawParallelChannel(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const c = dc.pt(points[2]!);
  const slope = b.x !== a.x ? (b.y - a.y) / (b.x - a.x) : 0;
  const dy = c.y - (a.y + slope * (c.x - a.x));
  const left = p.extendLeft === true;
  const right = p.extendRight === true;
  const at = (coeff: number): [Pt, Pt] => extendToPane({ x: a.x, y: a.y + dy * coeff }, { x: b.x, y: b.y + dy * coeff }, left, right, dc);
  const ctx = dc.ctx;

  if (p.fillBackground !== false) {
    const [l0a, l0b] = at(0);
    const [l1a, l1b] = at(1);
    fillPolygon(ctx, [l0a, l0b, l1b, l1a], fillColor(pstr(p, 'backgroundColor', 'rgba(41, 98, 255, 0.2)'), p.transparency));
  }

  const levels: (LineStyle & { coeff: number })[] = [];
  for (let i = 1; `level${i}` in p; i++) {
    const l = pobj(p, `level${i}`);
    if (l.visible === false || typeof l.coeff !== 'number') continue;
    levels.push({ coeff: l.coeff, color: pstr(l, 'color', '#2962FF'), width: pnum(l, 'lineWidth', 1), style: pnum(l, 'lineStyle', 0) });
  }
  if (levels.length === 0) {
    const line = mainLine(p);
    levels.push({ coeff: 0, ...line }, { coeff: 1, ...line });
    if (p.showMidline !== false) levels.push({ coeff: 0.5, color: pstr(p, 'midlinecolor', line.color), width: pnum(p, 'midlinewidth', 1), style: pnum(p, 'midlinestyle', 2) });
  }
  for (const l of levels) stroke(ctx, l, ...at(l.coeff));
  if (p.labelVisible === true) {
    const [la, lb] = at(1);
    textOnLine(ctx, la, lb, { text: pstr(p, 'labelText', ''), font: labelFont(p), color: pstr(p, 'labelTextColor', '#2962FF'), horz: pstr(p, 'labelHorzAlign', 'left'), vert: pstr(p, 'labelVertAlign', 'bottom') });
  }
}

/**
 * Flat top/bottom and disjoint channel: trend line 1-2 and a second line between the same two times,
 * filled between. The flat tool's second line is level at point 3's price; the disjoint channel's
 * runs back from point 3's price under point 2 with the first line's slope mirrored.
 */
export function secondLine(tool: 'flat' | 'disjoint', p0: DrawingPoint, p1: DrawingPoint, p2: DrawingPoint): [DrawingPoint, DrawingPoint] {
  if (tool === 'flat') return [{ ...p0, price: p2.price }, { ...p1, price: p2.price }];
  return [{ ...p0, price: p2.price + (p1.price - p0.price) }, { ...p1, price: p2.price }];
}

function twoLineChannel(tool: 'flat' | 'disjoint') {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const [p0, p1, p2] = points as [DrawingPoint, DrawingPoint, DrawingPoint];
    const [q0, q1] = secondLine(tool, p0, p1, p2);
    const [a, b, c, d] = [dc.pt(p0), dc.pt(p1), dc.pt(q0), dc.pt(q1)];
    const left = p.extendLeft === true;
    const right = p.extendRight === true;
    const [ea, eb] = extendToPane(a, b, left, right, dc);
    const [ec, ed] = extendToPane(c, d, left, right, dc);
    if (p.fillBackground !== false) fillPolygon(dc.ctx, [ea, eb, ed, ec], fillColor(pstr(p, 'backgroundColor', 'rgba(41, 98, 255, 0.2)'), p.transparency));
    const line = mainLine(p);
    stroke(dc.ctx, line, ea, eb);
    stroke(dc.ctx, line, ec, ed);
  };
}

export interface Regression {
  /** Fitted values at the first and last bar. */
  start: number;
  end: number;
  /** Sample standard deviation of the values around the fitted line. */
  deviation: number;
  /** Pearson's correlation between bar position and value. */
  pearson: number;
}

/** Least-squares line through values at bar positions 0..n-1, as TradingView's regression trend fits it. */
export function linearRegression(values: readonly number[]): Regression | null {
  const n = values.length;
  if (n < 2) return null;
  const mx = (n - 1) / 2;
  const my = values.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  values.forEach((v, x) => {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (v - my);
    syy += (v - my) ** 2;
  });
  const slope = sxy / sxx;
  const start = my - slope * mx;
  const residuals = values.reduce((s, v, x) => s + (v - (start + slope * x)) ** 2, 0);
  return { start, end: start + slope * (n - 1), deviation: Math.sqrt(residuals / (n - 1)), pearson: syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy) };
}

const SOURCES: Readonly<Record<string, (b: Bar) => number>> = {
  open: ([, o]) => o,
  high: ([, , h]) => h,
  low: ([, , , l]) => l,
  close: ([, , , , c]) => c,
  hl2: ([, , h, l]) => (h + l) / 2,
  hlc3: ([, , h, l, c]) => (h + l + c) / 3,
  ohlc4: ([, o, h, l, c]) => (o + h + l + c) / 4,
};

/** A colour at the given alpha, whatever alpha it had. */
function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return c ? rgbaCss({ ...c, a: alpha }) : color;
}

/**
 * Regression trend: the linear regression of the source over the bars between the two points,
 * with lines `upper/lower diviation` standard deviations away, the bands between them filled in
 * each line's colour, and Pearson's R under the start of the lower line.
 */
export function drawRegressionTrend(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const last = dc.bars.length - 1;
  const [i0, i1] = points.slice(0, 2).map((pt) => Math.min(last, Math.max(0, Math.round(dc.logical(pt))))).sort((x, y) => x - y) as [number, number];
  const inputs = pobj(p, 'inputs');
  const styles = pobj(p, 'styles');
  const source = SOURCES[pstr(inputs, 'source', 'close')] ?? SOURCES.close!;
  const fit = linearRegression(dc.bars.slice(i0, i1 + 1).map(source));
  if (!fit) return;
  const x0 = Math.round(dc.x(i0));
  const x1 = Math.round(dc.x(i1));
  const extend = styles.extendLines === true;
  const line = (key: string, offset: number | null) => {
    const s = obj(styles[key]);
    if (offset === null || s.display === 0) return null;
    const color = pstr(s, 'color', '#2962FF');
    const shift = offset * fit.deviation;
    const [a, b] = extendToPane({ x: x0, y: dc.y(fit.start + shift) }, { x: x1, y: dc.y(fit.end + shift) }, false, extend, dc);
    return { a, b, startPrice: fit.start + shift, color, width: pnum(s, 'linewidth', 1), style: pnum(s, 'linestyle', 0) };
  };
  const base = line('baseLine', 0);
  const up = line('upLine', inputs['use upper diviation'] === false ? null : pnum(inputs, 'upper diviation', 2));
  const down = line('downLine', inputs['use lower diviation'] === false ? null : pnum(inputs, 'lower diviation', -2));
  const alpha = 1 - pnum(styles, 'transparency', 70) / 100;
  const ctx = dc.ctx;
  for (const [edge, other] of [
    [base, down],
    [up, base],
  ] as const) {
    if (edge && other) fillPolygon(ctx, [edge.a, edge.b, other.b, other.a], withAlpha(edge.color, alpha));
  }
  for (const l of [base, down, up]) if (l) stroke(ctx, { ...l, color: withAlpha(l.color, 1) }, l.a, l.b);
  if (styles.showPearsons !== false && down) {
    drawText(ctx, String(fit.pearson), x0, dc.y(down.startPrice) + 8, { font: `12px ${FONT_FAMILY}`, color: withAlpha(down.color, 1), align: 'center', baseline: 'top' });
  }
}

export type PitchforkStyle = 'original' | 'schiff' | 'modifiedSchiff' | 'inside';

/** TradingView's pitchfork `style` property. */
const PITCHFORK_STYLES: Readonly<Record<number, PitchforkStyle>> = { 0: 'original', 1: 'modifiedSchiff', 2: 'inside', 3: 'schiff' };

export interface PitchforkGeometry {
  /** Where the median line starts and the direction it (and every level line) runs. */
  medianStart: Pt;
  direction: Pt;
  /** Middle of the handle (points 2-3); the levels sit along the handle around it. */
  center: Pt;
  /** Construction lines drawn in the median's style: the handle, plus the shifted-origin legs. */
  guides: [Pt, Pt][];
}

/**
 * Pitchfork variants. All share the handle between points 2 and 3. The original's median runs from point 1
 * through the handle's middle; Schiff moves the start to half way up leg 1-2, modified Schiff to the middle
 * of that leg; the inside pitchfork runs from the handle's middle parallel to (middle of leg 1-2 -> point 3).
 */
export function pitchforkGeometry(style: PitchforkStyle, p0: Pt, p1: Pt, p2: Pt): PitchforkGeometry {
  const center = mid(p1, p2);
  const handle: [Pt, Pt] = [p1, p2];
  const legMid = mid(p0, p1);
  switch (style) {
    case 'original':
      return { medianStart: p0, direction: sub(center, p0), center, guides: [handle] };
    case 'schiff': {
      const start = { x: p0.x, y: legMid.y };
      return { medianStart: start, direction: sub(center, start), center, guides: [[p0, p1], handle] };
    }
    case 'modifiedSchiff':
      return { medianStart: legMid, direction: sub(center, legMid), center, guides: [[p0, p1], handle] };
    case 'inside':
      return { medianStart: center, direction: sub(p2, legMid), center, guides: [[p0, p1], [legMid, p2], handle] };
  }
}

interface ForkLevel extends LineStyle {
  coeff: number;
}

/** Pitchfork levels are saved as [coeff, color, visible, linestyle, linewidth]. */
function forkLevels(p: Props): ForkLevel[] {
  const out: ForkLevel[] = [];
  for (let i = 0; `level${i}` in p; i++) {
    const l = p[`level${i}`];
    if (!Array.isArray(l) || l[2] !== true || typeof l[0] !== 'number') continue;
    out.push({ coeff: l[0], color: typeof l[1] === 'string' ? l[1] : '#2962FF', style: num(l[3], 0), width: num(l[4], 1) });
  }
  return out.sort((a, b) => a.coeff - b.coeff);
}

const medianStyle = (p: Props): LineStyle & { visible: boolean } => {
  const m = pobj(p, 'median');
  return { color: pstr(m, 'color', '#F23645'), width: pnum(m, 'linewidth', 1), style: pnum(m, 'linestyle', 0), visible: m.visible !== false };
};

/** Far enough along a direction to leave any pane, for fill polygons. */
const far = (from: Pt, dir: Pt, dc: DrawContext): Pt => {
  const len = Math.hypot(dir.x, dir.y) || 1;
  return add(from, scale(dir, ((dc.width + dc.height) * 4) / len));
};

/** How a fork-shaped tool lays out its lines: each level's line, and the band's edge used for fills (both by signed level). */
interface Fork {
  line(coeff: number): [Pt, Pt];
  band(coeff: number): [Pt, Pt];
  /** Median line and construction lines, drawn first. */
  drawMedian(style: LineStyle): void;
}

/**
 * Median first, then outward level by level on both sides: the band between the previous level and
 * this one (in this level's colour), then this level's line. TradingView paints in that order, so
 * each band tints the line inside it.
 */
function drawFork(dc: DrawContext, p: Props, fork: Fork): void {
  const median = medianStyle(p);
  if (median.visible) fork.drawMedian(median);
  let inner = 0;
  for (const l of forkLevels(p)) {
    for (const sign of [1, -1]) {
      if (p.fillBackground === true) {
        const [a, b] = fork.band(inner * sign);
        const [c, d] = fork.band(l.coeff * sign);
        fillPolygon(dc.ctx, [a, b, d, c], fillColor(l.color, p.transparency));
      }
      stroke(dc.ctx, l, ...fork.line(l.coeff * sign));
    }
    inner = l.coeff;
  }
}

export function pitchforkDrawer(defaultStyle: PitchforkStyle) {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const [p0, p1, p2] = points.slice(0, 3).map((pt) => dc.pt(pt)) as [Pt, Pt, Pt];
    const g = pitchforkGeometry(PITCHFORK_STYLES[pnum(p, 'style', -1)] ?? defaultStyle, p0, p1, p2);
    const half = sub(p1, g.center);
    const at = (coeff: number) => add(g.center, scale(half, coeff));
    const back = p.extendLines === true;
    drawFork(dc, p, {
      line: (coeff) => extendToPane(at(coeff), add(at(coeff), g.direction), back, true, dc),
      band: (coeff) => [back ? far(at(coeff), scale(g.direction, -1), dc) : at(coeff), far(at(coeff), g.direction, dc)],
      drawMedian: (median) => {
        stroke(dc.ctx, median, ...extendToPane(g.medianStart, add(g.medianStart, g.direction), back, true, dc));
        for (const [a, b] of g.guides) stroke(dc.ctx, median, a, b);
      },
    });
  };
}

/** Pitchfan: lines from point 1 through the median point and the level points along the handle, filled between. */
export function drawPitchfan(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const [p0, p1, p2] = points.slice(0, 3).map((pt) => dc.pt(pt)) as [Pt, Pt, Pt];
  const center = mid(p1, p2);
  const through = (coeff: number) => add(center, scale(sub(p1, center), coeff));
  const line = (coeff: number) => extendToPane(p0, through(coeff), false, true, dc);
  drawFork(dc, p, {
    line,
    band: (coeff) => [p0, far(p0, sub(through(coeff), p0), dc)],
    drawMedian: (median) => {
      stroke(dc.ctx, median, ...line(0));
      stroke(dc.ctx, median, p1, p2);
    },
  });
}

export const CHANNEL_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolParallelChannel: kind(3, drawParallelChannel),
  LineToolRegressionTrend: kind(2, drawRegressionTrend),
  LineToolFlatBottom: kind(3, twoLineChannel('flat')),
  LineToolDisjointAngle: kind(3, twoLineChannel('disjoint')),
  LineToolPitchfork: kind(3, pitchforkDrawer('original')),
  LineToolSchiffPitchfork: kind(3, pitchforkDrawer('modifiedSchiff')),
  LineToolSchiffPitchfork2: kind(3, pitchforkDrawer('schiff')),
  LineToolInsidePitchfork: kind(3, pitchforkDrawer('inside')),
  LineToolPitchfan: kind(3, drawPitchfan),
};
