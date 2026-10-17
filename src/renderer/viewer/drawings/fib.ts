import type { DrawingPoint } from '../../../core/layout';
import { fillColor } from '../colors';
import { FONT_FAMILY, pnum, pobj, pstr, setStroke, strokeLine, drawText, type DrawContext } from './canvas';
import type { Props } from '../../../core/props';

export interface FibLevel {
  coeff: number;
  color: string;
  visible: boolean;
  text: string;
}

export interface PricedLevel extends FibLevel {
  price: number;
}

/** TradingView stores levels as `level1..levelN`, either `[coeff, color, visible, text]` (newer) or `{coeff, color, visible, text}`. */
export function parseFibLevels(props: Props): FibLevel[] {
  const out: FibLevel[] = [];
  for (let i = 1; `level${i}` in props; i++) {
    const raw = props[`level${i}`];
    if (Array.isArray(raw)) {
      const [coeff, color, visible, text] = raw;
      if (typeof coeff === 'number') out.push({ coeff, color: typeof color === 'string' ? color : '#808080', visible: visible !== false, text: typeof text === 'string' ? text : '' });
    } else if (typeof raw === 'object' && raw !== null) {
      const o = raw as Props;
      if (typeof o.coeff === 'number') out.push({ coeff: o.coeff, color: pstr(o, 'color', '#808080'), visible: o.visible !== false, text: pstr(o, 'text', '') });
    }
  }
  return out;
}

/** Retracement: coefficient 0 sits at the second point's price and 1 at the first, unless `reverse` swaps them. */
export function fibRetracementLevels(props: Props, start: number, end: number): PricedLevel[] {
  const reverse = props.reverse === true;
  return parseFibLevels(props).map((l) => ({ ...l, price: reverse ? start + (end - start) * l.coeff : end - (end - start) * l.coeff }));
}

/** Trend-based extension: the move from point 1 to point 2, projected from point 3. */
export function fibExtensionLevels(props: Props, p1: number, p2: number, p3: number): PricedLevel[] {
  const sign = props.reverse === true ? -1 : 1;
  return parseFibLevels(props).map((l) => ({ ...l, price: p3 + sign * (p2 - p1) * l.coeff }));
}

const formatCoeff = (c: number, asPercent: boolean) => (asPercent ? `${+(c * 100).toFixed(1)}%` : String(+c.toFixed(3)));

function levelLabel(props: Props, l: PricedLevel, dc: DrawContext): string {
  const parts: string[] = [];
  if (props.showCoeffs !== false) parts.push(formatCoeff(l.coeff, props.coeffsAsPercents === true));
  if (props.showPrices !== false) parts.push(parts.length ? `(${dc.formatPrice(l.price)})` : dc.formatPrice(l.price));
  if (props.showText !== false && l.text) parts.push(l.text);
  return parts.join(' ');
}

function drawLevels(dc: DrawContext, props: Props, levels: PricedLevel[], x1: number, x2: number): void {
  const { ctx } = dc;
  const visible = levels.filter((l) => l.visible).sort((a, b) => a.coeff - b.coeff);
  let left = Math.min(x1, x2);
  let right = Math.max(x1, x2);
  if (props.extendLinesLeft === true) left = -1;
  if (props.extendLines === true) right = dc.width + 1;

  if (props.fillBackground !== false) {
    for (let i = 1; i < visible.length; i++) {
      const a = dc.y(visible[i - 1]!.price);
      const b = dc.y(visible[i]!.price);
      ctx.fillStyle = fillColor(visible[i]!.color, pnum(props, 'transparency', 80));
      ctx.fillRect(left, Math.min(a, b), right - left, Math.abs(b - a));
    }
  }

  const ls = pobj(props, 'levelsStyle');
  const width = pnum(ls, 'linewidth', pnum(props, 'linewidth', 1));
  const fontSize = pnum(props, 'labelFontSize', 12);
  const hAlign = pstr(props, 'horzLabelsAlign', 'left');
  const vAlign = pstr(props, 'vertLabelsAlign', 'middle');
  for (const l of visible) {
    const y = Math.round(dc.y(l.price)) + (width % 2 ? 0.5 : 0);
    setStroke(ctx, l.color, width, pnum(ls, 'linestyle', 0));
    strokeLine(ctx, { x: left, y }, { x: right, y });
    const label = levelLabel(props, l, dc);
    if (!label) continue;
    const pos =
      hAlign === 'right'
        ? props.extendLines === true
          ? { x: dc.width - 4, align: 'right' as const }
          : { x: right + 4, align: 'left' as const }
        : hAlign === 'center'
          ? { x: (left + right) / 2, align: 'center' as const }
          : props.extendLinesLeft === true
            ? { x: 4, align: 'left' as const }
            : { x: left - 4, align: 'right' as const };
    drawText(ctx, label, pos.x, vAlign === 'top' ? y - 2 : vAlign === 'bottom' ? y + 2 : y, {
      font: `${fontSize}px ${FONT_FAMILY}`,
      color: l.color,
      align: pos.align,
      baseline: vAlign === 'top' ? 'bottom' : vAlign === 'bottom' ? 'top' : 'middle',
    });
  }
}

function drawTrendline(dc: DrawContext, props: Props, pts: { x: number; y: number }[]): void {
  const tl = pobj(props, 'trendline');
  if (tl.visible === false || pts.length < 2) return;
  setStroke(dc.ctx, pstr(tl, 'color', '#808080'), pnum(tl, 'linewidth', 1), pnum(tl, 'linestyle', 2));
  dc.ctx.beginPath();
  dc.ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) dc.ctx.lineTo(p.x, p.y);
  dc.ctx.stroke();
}

export function drawFibRetracement(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const [p0, p1] = points as [DrawingPoint, DrawingPoint];
  const a = dc.pt(p0);
  const b = dc.pt(p1);
  drawLevels(dc, props, fibRetracementLevels(props, p0.price, p1.price), a.x, b.x);
  drawTrendline(dc, props, [a, b]);
}

export function drawFibExtension(dc: DrawContext, props: Props, points: DrawingPoint[]): void {
  const [p0, p1, p2] = points as [DrawingPoint, DrawingPoint, DrawingPoint];
  const pts = [dc.pt(p0), dc.pt(p1), dc.pt(p2)];
  drawLevels(dc, props, fibExtensionLevels(props, p0.price, p1.price, p2.price), pts[2]!.x, Math.max(pts[1]!.x, pts[2]!.x));
  drawTrendline(dc, props, pts);
}
