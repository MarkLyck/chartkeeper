import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import { num, type Props } from '../../../core/props';
import { dashPattern, parseColor, rgbaCss } from '../colors';
import { extendSegment, fillPolygon, FONT_FAMILY, pnum, pobj, pstr, type Box, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';

// TradingView's own drawing primitives, shared by the fib and Gann tools.

/** TradingView fills replace a colour's alpha with 1 - transparency/100. */
export function tvFill(color: string, transparency: unknown): string {
  const c = parseColor(color);
  const t = Math.min(100, Math.max(0, num(transparency, 0)));
  return c ? rgbaCss({ ...c, a: 1 - t / 100 }) : color;
}

/** A TradingView line segment: solid lines get round caps, horizontal and vertical ones snap to the pixel grid. */
export function tvLine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, width: number, style = 0, cap?: CanvasLineCap): void {
  const w = Math.max(1, Math.floor(width));
  const half = w % 2 ? 0.5 : 0;
  let [p, q] = [a, b];
  if (a.y === b.y) [p, q] = [{ x: a.x, y: Math.round(a.y) + half }, { x: b.x, y: Math.round(a.y) + half }];
  else if (a.x === b.x) [p, q] = [{ x: Math.round(a.x) + half, y: a.y }, { x: Math.round(a.x) + half, y: b.y }];
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.setLineDash(dashPattern(style, w));
  ctx.lineCap = cap ?? (style === 0 ? 'round' : 'butt');
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.stroke();
}

/** A full-height or full-width band as TradingView's rectangle renderer fills it at 1x: the right column is included. */
export function tvFillRect(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string): void {
  const left = Math.round(Math.min(x1, x2));
  const top = Math.round(Math.min(y1, y2));
  ctx.fillStyle = color;
  ctx.fillRect(left, top, Math.round(Math.max(x1, x2)) + 1 - left, Math.round(Math.max(y1, y2)) - top);
}

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

export interface LabelStyle {
  fontSize: number;
  color: string;
  /** Which side of the box the anchor sits on, as TradingView's text renderer aligns it. */
  h: HAlign;
  v: VAlign;
  offsetX?: number;
  offsetY?: number;
  bold?: boolean;
  italic?: boolean;
}

const labelFont = (s: LabelStyle) => `${s.bold ? 'bold ' : ''}${s.italic ? 'italic ' : ''}${s.fontSize}px ${FONT_FAMILY}`;

/** The box TradingView's text renderer puts around one line of text: fontSize/3 padding, even width, offsets ignored on centred axes. */
export function labelBox(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, s: LabelStyle): Box {
  ctx.font = labelFont(s);
  const pad = s.fontSize / 3;
  let w = Math.round(ctx.measureText(text).width + 2 * pad);
  if (w % 2) w += 1;
  const h = s.fontSize + 2 * pad;
  const left = s.h === 'left' ? x + (s.offsetX ?? 0) : s.h === 'right' ? x - w - (s.offsetX ?? 0) : x - w / 2;
  const top = s.v === 'top' ? y + (s.offsetY ?? 0) : s.v === 'bottom' ? y - h - (s.offsetY ?? 0) : y - h / 2;
  return { x: left, y: top, w, h };
}

export function drawLabelIn(ctx: CanvasRenderingContext2D, text: string, box: Box, s: LabelStyle): void {
  const pad = s.fontSize / 3;
  ctx.font = labelFont(s);
  ctx.fillStyle = s.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = s.h;
  const x = s.h === 'left' ? box.x + pad : s.h === 'right' ? box.x + box.w - pad : box.x + box.w / 2;
  ctx.fillText(text, Math.round(x), Math.round(box.y) + Math.round(pad + s.fontSize / 2 + 0.05 * s.fontSize));
}

export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, s: LabelStyle): Box {
  const box = labelBox(ctx, text, x, y, s);
  drawLabelIn(ctx, text, box, s);
  return box;
}

/** Runs `draw` with the boxes cut out of the canvas, the way TradingView keeps lines from crossing their labels. */
export function withoutBoxes(dc: DrawContext, boxes: Box[], draw: () => void): void {
  if (boxes.length === 0) return draw();
  const { ctx } = dc;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-dc.width, -dc.height, dc.width * 3, dc.height * 3);
  for (const b of boxes) ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip('evenodd');
  draw();
  ctx.restore();
}

/** Coefficient text: plain JS numbers, or percentages with 2 to 4 decimals. */
export function formatCoeff(coeff: number, asPercent = false): string {
  if (!asPercent) return String(coeff);
  const [int, frac = ''] = (coeff * 100).toFixed(4).split('.');
  return `${int}.${frac.replace(/0{1,2}$/, '').replace(/(\d\d)0$/, '$1')}%`;
}

// Levels.

export interface FibLevel {
  coeff: number;
  color: string;
  visible: boolean;
  text: string;
  /** Per-level line style and width, for tools that store them. */
  style?: number;
  width?: number;
}

export interface PricedLevel extends FibLevel {
  price: number;
}

type LevelField = 'coeff' | 'color' | 'visible' | 'linestyle' | 'linewidth' | 'text';

/** What each slot of a saved `levelN` array holds; TradingView packs level objects into arrays in this order per tool. */
export const LEVEL_LAYOUT = {
  retracement: ['coeff', 'color', 'visible', 'text'],
  extension: ['coeff', 'color', 'visible', 'linestyle', 'linewidth', 'text'],
  plain: ['coeff', 'color', 'visible'],
  styled: ['coeff', 'color', 'visible', 'linestyle', 'linewidth'],
} as const satisfies Record<string, readonly LevelField[]>;

export type LevelLayout = (typeof LEVEL_LAYOUT)[keyof typeof LEVEL_LAYOUT];

/** One saved level as an object, whether TradingView stored it as an array (newer) or an object (older). */
export function levelFields(raw: unknown, layout: readonly string[]): Props {
  if (Array.isArray(raw)) return Object.fromEntries(layout.map((field, i) => [field, raw[i]]));
  return typeof raw === 'object' && raw !== null ? (raw as Props) : {};
}

/** `level1..levelN` (or another prefix) in index order; TradingView fills and pairs levels in this order, not by coefficient. */
export function parseFibLevels(props: Props, layout: readonly LevelField[] = LEVEL_LAYOUT.retracement, prefix = 'level'): FibLevel[] {
  const out: FibLevel[] = [];
  for (let i = 1; `${prefix}${i}` in props; i++) {
    const f = levelFields(props[`${prefix}${i}`], layout);
    if (typeof f.coeff !== 'number') continue;
    const level: FibLevel = { coeff: f.coeff, color: pstr(f, 'color', '#808080'), visible: f.visible !== false, text: typeof f.text === 'string' ? f.text : '' };
    if (typeof f.linestyle === 'number') level.style = f.linestyle;
    if (typeof f.linewidth === 'number') level.width = f.linewidth;
    out.push(level);
  }
  return out;
}

/** Retracement: coefficient 0 sits at the second point's price and 1 at the first, unless `reverse` swaps them. */
export function fibRetracementLevels(props: Props, start: number, end: number, layout: LevelLayout = LEVEL_LAYOUT.retracement): PricedLevel[] {
  const reverse = props.reverse === true;
  return parseFibLevels(props, layout).map((l) => ({ ...l, price: reverse ? start + (end - start) * l.coeff : end - (end - start) * l.coeff }));
}

/** Trend-based extension: the move from point 1 to point 2, projected from point 3. */
export function fibExtensionLevels(props: Props, p1: number, p2: number, p3: number, layout: LevelLayout = LEVEL_LAYOUT.retracement): PricedLevel[] {
  const sign = props.reverse === true ? -1 : 1;
  return parseFibLevels(props, layout).map((l) => ({ ...l, price: p3 + sign * (p2 - p1) * l.coeff }));
}

/** Level label: "0.618 (283.35)", "61.80%", or " (283.35)" with prices only. */
export function fibLabelText(props: Props, coeff: number, price: string): string {
  let text = props.showCoeffs !== false ? formatCoeff(coeff, props.coeffsAsPercents === true) : '';
  if (props.showPrices !== false) text += ` (${price})`;
  return text;
}

// Retracement and extension: horizontal levels between two x positions.

interface HorizontalLevels {
  levels: PricedLevel[];
  x1: number;
  x2: number;
  extendLeft: boolean;
  extendRight: boolean;
}

/** Version 1 drawings extended their levels right; TradingView turns that on when it loads them. */
const extendsRight = (props: Props, drawing: ParsedDrawing) => props.extendLines === true || num(drawing.source.version, 1) < 2;

function horizontalLevels(props: Props, levels: PricedLevel[], x1: number, x2: number, drawing: ParsedDrawing): HorizontalLevels {
  return { levels: levels.filter((l) => l.visible), x1: Math.min(x1, x2), x2: Math.max(x1, x2), extendLeft: props.extendLinesLeft === true, extendRight: extendsRight(props, drawing) };
}

const span = (dc: DrawContext, h: HorizontalLevels): [number, number] => [h.extendLeft ? 0 : h.x1, h.extendRight ? dc.width : h.x2];

function fillAndStrokeLevels(dc: DrawContext, props: Props, h: HorizontalLevels, cutouts: Map<PricedLevel, Box[]>): void {
  const [left, right] = span(dc, h);
  if (props.fillBackground !== false) {
    for (let i = 1; i < h.levels.length; i++) {
      tvFillRect(dc.ctx, left, dc.y(h.levels[i - 1]!.price), right, dc.y(h.levels[i]!.price), tvFill(h.levels[i]!.color, pnum(props, 'transparency', 80)));
    }
  }
  const ls = pobj(props, 'levelsStyle');
  for (const l of h.levels) {
    const y = dc.y(l.price);
    withoutBoxes(dc, cutouts.get(l) ?? [], () => tvLine(dc.ctx, { x: left, y }, { x: right, y }, l.color, pnum(ls, 'linewidth', 2), pnum(ls, 'linestyle', 0)));
  }
}

/** Where TradingView anchors a level's label or text for an alignment: outside the line ends, or inside the pane edge when extended. */
function levelAnchor(dc: DrawContext, h: HorizontalLevels, align: string): { x: number; h: HAlign } {
  if (align === 'right') return h.extendRight ? { x: dc.width, h: 'right' } : { x: h.x2, h: 'left' };
  if (align === 'center') return { x: ((h.extendLeft ? 0 : h.x1) + (h.extendRight ? dc.width : h.x2)) / 2, h: 'center' };
  return h.extendLeft ? { x: 0, h: 'left' } : { x: h.x1, h: 'right' };
}

/** Saved "bottom" draws above the line and "top" below it, one font size away; TradingView's dialog names them the other way round. */
const levelLabelDy = (vAlign: string, fontSize: number) => (vAlign === 'bottom' ? -fontSize : vAlign === 'top' ? fontSize : 0);

interface PlacedText {
  text: string;
  box: Box;
  style: LabelStyle;
}

function placeLevelTexts(dc: DrawContext, props: Props, h: HorizontalLevels): Map<PricedLevel, PlacedText[]> {
  const fontSize = Math.ceil(pnum(props, 'labelFontSize', 12));
  const labelH = pstr(props, 'horzLabelsAlign', 'left');
  const labelV = pstr(props, 'vertLabelsAlign', 'middle');
  const textH = pstr(props, 'horzTextAlign', 'center');
  const textV = pstr(props, 'vertTextAlign', 'middle');
  const out = new Map<PricedLevel, PlacedText[]>();
  for (const l of h.levels) {
    const label = fibLabelText(props, l.coeff, dc.formatPrice(l.price));
    if (!label) continue;
    const text = props.showText !== false ? l.text : '';
    const y = dc.y(l.price);
    const place = (s: string, align: string, vAlign: string): PlacedText => {
      const a = levelAnchor(dc, h, align);
      const style: LabelStyle = { fontSize, color: l.color, h: a.h, v: 'middle', offsetX: 4 };
      return { text: s, box: labelBox(dc.ctx, s, a.x, y + levelLabelDy(vAlign, fontSize), style), style };
    };
    // Text sharing the label's alignment sits next to it as one group.
    const together = text && textH === labelH && textV === labelV;
    const placed = [place(together ? `${label} · ${text}` : label, labelH, labelV)];
    if (text && !together) placed.push(place(text, textH, textV));
    out.set(l, placed);
  }
  return out;
}

function lineCutouts(texts: Map<PricedLevel, PlacedText[]>, props: Props): Map<PricedLevel, Box[]> {
  const cut = new Map<PricedLevel, Box[]>();
  const labelMiddle = pstr(props, 'vertLabelsAlign', 'middle') === 'middle';
  const textMiddle = pstr(props, 'vertTextAlign', 'middle') === 'middle';
  for (const [l, placed] of texts) cut.set(l, placed.filter((_, i) => (i === 0 ? labelMiddle : textMiddle)).map((p) => p.box));
  return cut;
}

function drawLevelTexts(dc: DrawContext, texts: Map<PricedLevel, PlacedText[]>): void {
  for (const placed of texts.values()) for (const p of placed) drawLabelIn(dc.ctx, p.text, p.box, p.style);
}

function drawTrendline(dc: DrawContext, props: Props, a: Pt, b: Pt): void {
  const tl = pobj(props, 'trendline');
  if (tl.visible === false) return;
  tvLine(dc.ctx, a, b, pstr(tl, 'color', '#808080'), pnum(tl, 'linewidth', 2), pnum(tl, 'linestyle', 2));
}

export function drawFibRetracement(dc: DrawContext, props: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const [p0, p1] = points as [DrawingPoint, DrawingPoint];
  const a = dc.pt(p0);
  const b = dc.pt(p1);
  const h = horizontalLevels(props, fibRetracementLevels(props, p0.price, p1.price), a.x, b.x, drawing);
  if ((h.x1 > dc.width && !h.extendLeft) || (h.x2 < 0 && !h.extendRight)) return;
  const texts = placeLevelTexts(dc, props, h);
  fillAndStrokeLevels(dc, props, h, lineCutouts(texts, props));
  drawTrendline(dc, props, a, b);
  drawLevelTexts(dc, texts);
}

export function drawFibExtension(dc: DrawContext, props: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const [p0, p1, p2] = points as [DrawingPoint, DrawingPoint, DrawingPoint];
  const [a, b, c] = [dc.pt(p0), dc.pt(p1), dc.pt(p2)];
  const h = horizontalLevels(props, fibExtensionLevels(props, p0.price, p1.price, p2.price, LEVEL_LAYOUT.extension), b.x, c.x, drawing);
  const texts = placeLevelTexts(dc, props, h);
  drawTrendline(dc, props, a, b);
  fillAndStrokeLevels(dc, props, h, lineCutouts(texts, props));
  drawTrendline(dc, props, b, c);
  drawLevelTexts(dc, texts);
}

// Fib channel: levels parallel to line 1-2, offset by multiples of the vector from point 1 to point 3.

/** Endpoints of channel level `coeff`: line 1-2 moved by coeff times (point 3 - point 1). */
export function fibChannelLine(a: Pt, b: Pt, c: Pt, coeff: number): [Pt, Pt] {
  const dx = (c.x - a.x) * coeff;
  const dy = (c.y - a.y) * coeff;
  return [
    { x: a.x + dx, y: a.y + dy },
    { x: b.x + dx, y: b.y + dy },
  ];
}

export function drawFibChannel(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const [a, b, c] = points.map((p) => dc.pt(p)) as [Pt, Pt, Pt];
  const levels = parseFibLevels(props, LEVEL_LAYOUT.plain).filter((l) => l.visible);
  const vertical = a.x === b.x;
  const extend = (line: [Pt, Pt]) => (vertical ? line : extendSegment(...line, props.extendLeft === true, props.extendRight === true, dc));
  const ls = pobj(props, 'levelsStyle');
  const fontSize = Math.ceil(pnum(props, 'labelFontSize', 12));
  const hAlign = pstr(props, 'horzLabelsAlign', 'left');
  const vAlign = pstr(props, 'vertLabelsAlign', 'middle');
  const { ctx } = dc;
  levels.forEach((l, i) => {
    const line = fibChannelLine(a, b, c, l.coeff);
    const [start, end] = line;
    const anchor = hAlign === 'right' ? { x: end.x, y: end.y, h: 'left' as const } : hAlign === 'center' ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, h: 'center' as const } : { x: start.x, y: start.y, h: 'right' as const };
    const label = fibLabelText(props, l.coeff, dc.formatPrice(dc.price(start.y)));
    const style: LabelStyle = { fontSize, color: l.color, h: anchor.h, v: vAlign === 'top' ? 'top' : vAlign === 'bottom' ? 'bottom' : 'middle', offsetX: 4 };
    const box = label ? drawLabel(ctx, label, anchor.x, anchor.y, style) : null;
    const next = levels[i + 1];
    if (next && props.fillBackground !== false) {
      const [s1, e1] = extend(line);
      const [s2, e2] = extend(fibChannelLine(a, b, c, next.coeff));
      fillPolygon(ctx, [s1, e1, e2, s2], tvFill(l.color, pnum(props, 'transparency', 80)));
    }
    withoutBoxes(dc, box ? [box] : [], () => tvLine(ctx, ...extend(line), l.color, pnum(ls, 'linewidth', 2), pnum(ls, 'linestyle', 0)));
  });
}

// Speed resistance fan: rays from point 1 through a grid of price and time fractions of the box.

export function drawFibSpeedResistanceFan(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const [p0, p1] = points as [DrawingPoint, DrawingPoint];
  const a = dc.pt(p0);
  const b = dc.pt(p1);
  // Saved fans without the key were drawn reversed.
  const reverse = props.reverse !== false;
  const [base, other] = reverse ? [p0, p1] : [p1, p0];
  const baseBar = dc.logical(base);
  const bars = dc.logical(other) - baseBar;
  const hLevels = parseFibLevels(props, LEVEL_LAYOUT.plain, 'hlevel').filter((l) => l.visible);
  const vLevels = parseFibLevels(props, LEVEL_LAYOUT.plain, 'vlevel').filter((l) => l.visible);
  const ys = hLevels.map((l) => dc.y(base.price + l.coeff * (other.price - base.price)));
  const xs = vLevels.map((l) => dc.x(Math.round(baseBar + l.coeff * bars)));
  const [minX, maxX] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [minY, maxY] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const { ctx } = dc;
  const grid = pobj(props, 'grid');
  const width = pnum(props, 'linewidth', 2);
  const style = pnum(props, 'linestyle', 0);
  const label = (text: string, x: number, y: number, color: string, h: HAlign, v: VAlign) => drawLabel(ctx, text, x, y, { fontSize: 12, color, h, v, offsetX: 5, offsetY: 5 });
  const gridLine = (p: Pt, q: Pt) => grid.visible !== false && tvLine(ctx, p, q, pstr(grid, 'color', 'rgba(21, 56, 153, 0.8)'), pnum(grid, 'linewidth', 1), pnum(grid, 'linestyle', 0));

  hLevels.forEach((l, i) => {
    gridLine({ x: minX, y: ys[i]! }, { x: maxX, y: ys[i]! });
    if (props.showLeftLabels !== false) label(String(l.coeff), minX, ys[i]!, l.color, 'right', 'middle');
    if (props.showRightLabels !== false) label(String(l.coeff), maxX, ys[i]!, l.color, 'left', 'middle');
  });
  vLevels.forEach((l, i) => {
    gridLine({ x: xs[i]!, y: minY }, { x: xs[i]!, y: maxY });
    if (props.showTopLabels !== false) label(String(l.coeff), xs[i]!, minY, l.color, 'center', 'bottom');
    if (props.showBottomLabels !== false) label(String(l.coeff), xs[i]!, maxY, l.color, 'center', 'top');
  });

  const fan = (levels: typeof hLevels, targets: Pt[]) => {
    const rays = targets.map((t) => extendSegment(a, t, false, true, dc)[1]);
    levels.forEach((l, i) => {
      if (i > 0 && props.fillBackground !== false) fillPolygon(ctx, [a, rays[i - 1]!, rays[i]!], tvFill(l.color, pnum(props, 'transparency', 80)));
      tvLine(ctx, a, rays[i]!, l.color, width, style);
    });
  };
  fan(hLevels, ys.map((y) => ({ x: b.x, y })));
  fan(vLevels, xs.map((x) => ({ x, y: b.y })));
}

export const FIB_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolFibRetracement: kind(2, drawFibRetracement),
  LineToolTrendBasedFibExtension: kind(3, drawFibExtension),
  LineToolFibChannel: kind(3, drawFibChannel),
  LineToolFibSpeedResistanceFan: kind(2, drawFibSpeedResistanceFan),
};
