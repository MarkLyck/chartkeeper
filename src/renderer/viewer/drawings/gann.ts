import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import { num, obj, type Props } from '../../../core/props';
import { extendSegment, fillPolygon, pnum, pobj, pstr, type DrawContext, type Pt } from './canvas';
import { drawLabel, LEVEL_LAYOUT, levelFields, parseFibLevels, tvFill, tvFillRect, tvLine, type HAlign, type VAlign } from './fib';
import { kind, type DrawingKind } from './kind';

// Gann box: price levels across and time levels down a box spanned by the two points.

/** Gann box levels: price fractions of the price move and whole-bar fractions of the bar span, from point 1 (point 2 when reversed). */
export function gannBoxLevels(props: Props, p1: { bar: number; price: number }, p2: { bar: number; price: number }) {
  const [base, other] = props.reverse === true ? [p2, p1] : [p1, p2];
  const price = (coeff: number) => base.price + coeff * (other.price - base.price);
  const bar = (coeff: number) => Math.round(base.bar + coeff * (other.bar - base.bar));
  return { price, bar };
}

export function drawGannSquare(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const [p0, p1] = points as [DrawingPoint, DrawingPoint];
  const a = dc.pt(p0);
  const b = dc.pt(p1);
  const at = gannBoxLevels(props, { bar: dc.logical(p0), price: p0.price }, { bar: dc.logical(p1), price: p1.price });
  const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [top, bottom] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const hAll = parseFibLevels(props, LEVEL_LAYOUT.plain, 'hlevel');
  const vAll = parseFibLevels(props, LEVEL_LAYOUT.plain, 'vlevel');
  const width = pnum(props, 'linewidth', 2);
  const style = pnum(props, 'linestyle', 0);
  const { ctx } = dc;
  const label = (text: string, x: number, y: number, color: string, h: HAlign, v: VAlign, offset: number) => drawLabel(ctx, text, x, y, { fontSize: 12, color, h, v, offsetX: offset, offsetY: offset });

  const hLevels = hAll.filter((l) => l.visible).map((l) => ({ ...l, y: dc.y(at.price(l.coeff)) }));
  hLevels.forEach((l, i) => {
    if (i > 0 && props.fillHorzBackground !== false) tvFillRect(ctx, left, hLevels[i - 1]!.y, right, l.y, tvFill(l.color, pnum(props, 'horzTransparency', 80)));
    tvLine(ctx, { x: left, y: l.y }, { x: right, y: l.y }, l.color, width, style);
    if (props.showLeftLabels !== false) label(String(l.coeff), left, l.y, l.color, 'right', 'middle', 5);
    if (props.showRightLabels !== false) label(String(l.coeff), right, l.y, l.color, 'left', 'middle', 5);
  });
  const vLevels = vAll.filter((l) => l.visible).map((l) => ({ ...l, x: dc.x(at.bar(l.coeff)) }));
  vLevels.forEach((l, i) => {
    if (i > 0 && props.fillVertBackground !== false) tvFillRect(ctx, vLevels[i - 1]!.x, top, l.x, bottom, tvFill(l.color, pnum(props, 'vertTransparency', 80)));
    tvLine(ctx, { x: l.x, y: top }, { x: l.x, y: bottom }, l.color, width, style);
    if (props.showTopLabels !== false) label(String(l.coeff), l.x, top, l.color, 'center', 'bottom', 3);
    if (props.showBottomLabels !== false) label(String(l.coeff), l.x, bottom, l.color, 'center', 'top', 5);
  });

  const fans = pobj(props, 'fans');
  if (fans.visible !== true) return;
  const color = pstr(fans, 'color', '#9C9C9C');
  const line = (p: Pt, q: Pt) => tvLine(ctx, p, q, color, width, style);
  // TradingView crosses the sets here: the time fans use the price coefficients and the reverse, hidden levels included.
  for (const l of hAll) {
    const x = dc.x(at.bar(l.coeff));
    for (const [from, to] of [[bottom, top], [top, bottom]] as const) for (const edge of [left, right]) line({ x: edge, y: from }, { x, y: to });
  }
  for (const l of vAll) {
    const y = dc.y(at.price(l.coeff));
    for (const from of [bottom, top]) {
      line({ x: left, y: from }, { x: right, y });
      line({ x: right, y: from }, { x: left, y });
    }
  }
}

// Gann square (fixed and complex): a grid of fifths, fan lines and quarter arcs from one corner.

interface GannItem {
  x: number;
  y: number;
  color: string;
  visible: boolean;
  width: number;
}

/** Gann square grid lines are saved as `[width, color, visible]`, one per fifth. */
const GANN_LEVEL_LAYOUT = ['width', 'color', 'visible'];

const gannItems = (raw: unknown): GannItem[] =>
  (Array.isArray(raw) ? raw : []).map((o) => {
    const p = obj(o);
    return { x: num(p.x, 1), y: num(p.y, 1), color: pstr(p, 'color', '#808080'), visible: p.visible !== false, width: num(p.width, 2) };
  });

/** Gann square fixed: the square from point 1 toward point 2 whose side is five times their pixel distance. */
export function gannFixedCorner(a: Pt, b: Pt): Pt {
  const side = 5 * Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + side * (Math.sign(b.x - a.x) || 1), y: a.y + side * (Math.sign(b.y - a.y) || 1) };
}

/** Arc radius in x pixels for a Gann arc through grid point (x, y) of a square `dx` wide. */
export const gannArcRadius = (dx: number, x: number, y: number): number => (Math.abs(dx) / 5) * Math.hypot(x, y);

function drawGannGrid(dc: DrawContext, props: Props, start: Pt, end: Pt): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const { ctx } = dc;
  const levels = (Array.isArray(props.levels) ? props.levels : []).map((raw) => levelFields(raw, GANN_LEVEL_LAYOUT));
  levels.forEach((l, i) => {
    if (l.visible === false) return;
    const f = i / 5;
    const color = pstr(l, 'color', '#808080');
    tvLine(ctx, { x: start.x + f * dx, y: start.y }, { x: start.x + f * dx, y: end.y }, color, num(l.width, 2));
    tvLine(ctx, { x: start.x, y: start.y + f * dy }, { x: end.x, y: start.y + f * dy }, color, num(l.width, 2));
  });
  for (const f of gannItems(props.fanlines)) {
    if (!f.visible) continue;
    const tip = f.x > f.y ? { x: end.x, y: start.y + (f.y / f.x) * dy } : { x: start.x + (f.x / f.y) * dx, y: end.y };
    tvLine(ctx, start, tip, f.color, f.width);
  }
  if (dx === 0 || dy === 0) return;
  const n = dy / dx;
  const bg = pobj(props, 'arcsBackground');
  let inner = 0;
  for (const arc of gannItems(props.arcs)) {
    if (!arc.visible) continue;
    const r = gannArcRadius(dx, arc.x, arc.y);
    // Squares left of the corner use the opposite quarter of the (y-scaled) circle.
    const s = dx > 0 ? 1 : -1;
    const [from, to] = s > 0 ? [0, Math.PI / 2] : [Math.PI, Math.PI * 1.5];
    ctx.save();
    ctx.translate(start.x, start.y);
    ctx.scale(1, n);
    if (r > Math.abs(dx)) {
      ctx.beginPath();
      ctx.rect(0, 0, dx, dx);
      ctx.clip();
    }
    if (bg.fillBackground !== false) {
      ctx.beginPath();
      ctx.moveTo(s * inner, 0);
      ctx.lineTo(s * r, 0);
      ctx.arc(0, 0, r, from, to);
      ctx.lineTo(0, s * inner);
      if (inner > 0) ctx.arc(0, 0, inner, to, from, true);
      ctx.fillStyle = tvFill(arc.color, pnum(bg, 'transparency', 80));
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r, from, to);
    ctx.scale(1, 1 / n);
    ctx.strokeStyle = arc.color;
    ctx.lineWidth = arc.width;
    ctx.lineCap = 'butt';
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
    inner = r;
  }
}

export function drawGannFixed(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  if (a.x === b.x && a.y === b.y) return;
  drawGannGrid(dc, props, a, gannFixedCorner(a, b));
}

/** Gann square: the two points are opposite corners; version 1 squares load as Gann square fixed. */
export function drawGannComplex(dc: DrawContext, props: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  if (num(drawing.source.version, 1) < 2) return drawGannFixed(dc, props, points);
  const reverse = props.reverse === true;
  const [p0, p1] = (reverse ? [points[1], points[0]] : [points[0], points[1]]) as [DrawingPoint, DrawingPoint];
  const start = dc.pt(p0);
  const end = dc.pt(p1);
  drawGannGrid(dc, props, start, end);
  if (props.showLabels === false) return;
  const levels = Array.isArray(props.levels) ? props.levels : [];
  const color = pstr(levelFields(levels[5], GANN_LEVEL_LAYOUT), 'color', '#808080');
  const ls = pobj(props, 'labelsStyle');
  const style = { fontSize: pnum(ls, 'fontSize', 12), color, bold: ls.bold === true, italic: ls.italic === true };
  const rise = p1.price - p0.price;
  const bars = dc.logical(p1) - dc.logical(p0);
  const ahead: HAlign = bars > 0 ? 'left' : 'right';
  const behind: HAlign = bars > 0 ? 'right' : 'left';
  const above = (v: VAlign) => (rise > 0 ? v : v === 'bottom' ? 'top' : 'bottom');
  const offsetY = (v: VAlign) => (v === 'bottom' ? 8 : 10);
  const put = (text: string, at: Pt, h: HAlign, v: VAlign) => drawLabel(dc.ctx, text, at.x, at.y, { ...style, h, v, offsetX: 10, offsetY: offsetY(v) });
  put(dc.formatPrice(rise), { x: start.x, y: end.y }, behind, above('bottom'));
  put(String(bars), { x: end.x, y: start.y }, ahead, above('top'));
  if (bars !== 0) put(Math.abs(rise / bars).toFixed(7), end, ahead, above('bottom'));
}

// Gann fan: rays from point 1 at fixed price/time ratios of the box to point 2.

const GANN_FAN_RATIOS = [
  [1, 8],
  [1, 4],
  [1, 3],
  [1, 2],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [8, 1],
] as const;

/** Where a Gann fan ray of ratio c1/c2 leaves the box from point 1 to point 2. */
export function gannFanTarget(a: Pt, b: Pt, c1: number, c2: number): Pt {
  const k = c1 / c2;
  return c1 > c2 ? { x: b.x, y: a.y + (b.y - a.y) / k } : { x: a.x + (b.x - a.x) * k, y: b.y };
}

export function drawGannFan(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const { ctx } = dc;
  const levels = GANN_FAN_RATIOS.flatMap(([c1, c2], i) => {
    const f = levelFields(props[`level${i + 1}`], LEVEL_LAYOUT.styled);
    if (f.visible === false || !(`level${i + 1}` in props)) return [];
    const target = gannFanTarget(a, b, c1, c2);
    return [{ index: i, text: `${c1}/${c2}`, color: pstr(f, 'color', '#808080'), style: num(f.linestyle, 0), width: num(f.linewidth, 2), target, far: extendSegment(a, target, false, true, dc)[1] }];
  });
  // The 1/2 ray fills nothing; flatter ones fill toward the next ray, steeper toward the previous.
  levels.forEach((l, i) => {
    const pair = l.index < 4 ? levels[i + 1] : l.index > 4 ? levels[i - 1] : undefined;
    if (pair && props.fillBackground !== false) fillPolygon(ctx, [a, l.far, pair.far], tvFill(l.color, pnum(props, 'transparency', 80)));
    tvLine(ctx, a, l.far, l.color, l.width, l.style);
    if (props.showLabels !== false) drawLabel(ctx, l.text, l.target.x, l.target.y, { fontSize: 12, color: l.color, h: 'left', v: 'middle', offsetX: 0 });
  });
}

export const GANN_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolGannSquare: kind(2, drawGannSquare),
  LineToolGannFixed: kind(2, drawGannFixed),
  LineToolGannComplex: kind(2, drawGannComplex),
  LineToolGannFan: kind(2, drawGannFan),
};
