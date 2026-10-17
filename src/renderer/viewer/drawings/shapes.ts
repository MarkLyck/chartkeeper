import type { DrawingPoint } from '../../../core/layout';
import { fillColor } from '../colors';
import { arrowHead, drawText, extendSegment, fillPolygon, font, pnum, pobj, pstr, setStroke, strokeLine, type DrawContext, type Props, type Pt } from './canvas';

const background = (p: Props, fallback: string) => fillColor(pstr(p, 'backgroundColor', fallback), p.transparency);
const fills = (p: Props) => p.fillBackground !== false;

function shapeText(dc: DrawContext, p: Props, box: { x: number; y: number; w: number; h: number }): void {
  const text = pstr(p, 'text', '');
  if (!text) return;
  const h = pstr(p, 'horzLabelsAlign', 'center');
  const v = pstr(p, 'vertLabelsAlign', 'middle');
  const x = h === 'left' ? box.x + 4 : h === 'right' ? box.x + box.w - 4 : box.x + box.w / 2;
  const y = v === 'top' ? box.y + 4 : v === 'bottom' ? box.y + box.h - 4 : box.y + box.h / 2;
  drawText(dc.ctx, text, x, y, {
    font: font(p, 'fontSize', 14),
    color: pstr(p, 'textColor', pstr(p, 'color', '#2962FF')),
    align: h === 'left' ? 'left' : h === 'right' ? 'right' : 'center',
    baseline: v === 'top' ? 'top' : v === 'bottom' ? 'bottom' : 'middle',
  });
}

export function drawRectangle(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const left = p.extendLeft === true ? -1 : Math.min(a.x, b.x);
  const right = p.extendRight === true ? dc.width + 1 : Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const box = { x: left, y: top, w: right - left, h: Math.abs(b.y - a.y) };
  const ctx = dc.ctx;
  if (fills(p)) {
    ctx.fillStyle = background(p, 'rgba(41, 98, 255, 0.2)');
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  const middle = pobj(p, 'middleLine');
  if (middle.showLine === true) {
    setStroke(ctx, pstr(middle, 'lineColor', pstr(p, 'color', '#2962FF')), pnum(middle, 'lineWidth', 1), pnum(middle, 'lineStyle', 2));
    strokeLine(ctx, { x: box.x, y: box.y + box.h / 2 }, { x: box.x + box.w, y: box.y + box.h / 2 });
  }
  setStroke(ctx, pstr(p, 'color', '#2962FF'), pnum(p, 'linewidth', 1), p.linestyle);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  shapeText(dc, p, box);
}

/**
 * Ellipse: points 1 and 2 are the ends of one axis; point 3 sets the other
 * radius by its distance from that axis.
 */
export function drawEllipse(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const c = points[2] ? dc.pt(points[2]) : null;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  let ry: number;
  if (c && rx > 0) {
    const len = rx * 2;
    ry = Math.abs((b.x - a.x) * (a.y - c.y) - (a.x - c.x) * (b.y - a.y)) / len;
  } else ry = Math.abs(b.y - a.y) / 2;
  const ctx = dc.ctx;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), angle, 0, Math.PI * 2);
  if (fills(p)) {
    ctx.fillStyle = background(p, 'rgba(242, 54, 69, 0.2)');
    ctx.fill();
  }
  setStroke(ctx, pstr(p, 'color', '#F23645'), pnum(p, 'linewidth', 1), p.linestyle);
  ctx.stroke();
  shapeText(dc, p, { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 });
}

export function drawCircle(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const c = dc.pt(points[0]!);
  const e = dc.pt(points[1]!);
  const r = Math.hypot(e.x - c.x, e.y - c.y);
  const ctx = dc.ctx;
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.max(r, 0.5), 0, Math.PI * 2);
  if (fills(p)) {
    ctx.fillStyle = background(p, 'rgba(255, 152, 0, 0.2)');
    ctx.fill();
  }
  setStroke(ctx, pstr(p, 'color', '#FF9800'), pnum(p, 'linewidth', 1), p.linestyle);
  ctx.stroke();
  shapeText(dc, p, { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2 });
}

export function drawTriangle(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const pts = points.slice(0, 3).map((pt) => dc.pt(pt));
  if (fills(p)) fillPolygon(dc.ctx, pts, background(p, 'rgba(8, 153, 129, 0.2)'));
  setStroke(dc.ctx, pstr(p, 'color', '#089981'), pnum(p, 'linewidth', 1), p.linestyle);
  dc.ctx.beginPath();
  pts.forEach((pt, i) => (i ? dc.ctx.lineTo(pt.x, pt.y) : dc.ctx.moveTo(pt.x, pt.y)));
  dc.ctx.closePath();
  dc.ctx.stroke();
}

interface ChannelLevel {
  coeff: number;
  color: string;
  width: number;
  style: number;
}

/** Parallel channel: line 1-2, a parallel copy through point 3, and the levels between them (0 = line 1-2, 1 = the copy). */
export function drawParallelChannel(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const c = dc.pt(points[2]!);
  const slope = b.x !== a.x ? (b.y - a.y) / (b.x - a.x) : 0;
  const dy = c.y - (a.y + slope * (c.x - a.x));
  const at = (coeff: number): [Pt, Pt] => [
    { x: a.x, y: a.y + dy * coeff },
    { x: b.x, y: b.y + dy * coeff },
  ];
  const left = p.extendLeft === true;
  const right = p.extendRight === true;
  const ctx = dc.ctx;

  if (p.fillBackground !== false) {
    const [l0a, l0b] = extendSegment(...at(0), left, right, dc);
    const [l1a, l1b] = extendSegment(...at(1), left, right, dc);
    fillPolygon(ctx, [l0a, l0b, l1b, l1a], fillColor(pstr(p, 'backgroundColor', 'rgba(41, 98, 255, 0.2)'), p.transparency));
  }

  const levels: ChannelLevel[] = [];
  for (let i = 1; `level${i}` in p; i++) {
    const l = pobj(p, `level${i}`);
    if (l.visible === false || typeof l.coeff !== 'number') continue;
    levels.push({ coeff: l.coeff, color: pstr(l, 'color', '#2962FF'), width: pnum(l, 'lineWidth', 1), style: pnum(l, 'lineStyle', 0) });
  }
  if (levels.length === 0) {
    const color = pstr(p, 'linecolor', '#2962FF');
    const width = pnum(p, 'linewidth', 1);
    levels.push({ coeff: 0, color, width, style: pnum(p, 'linestyle', 0) }, { coeff: 1, color, width, style: pnum(p, 'linestyle', 0) });
    if (p.showMidline !== false) levels.push({ coeff: 0.5, color: pstr(p, 'midlinecolor', color), width: pnum(p, 'midlinewidth', 1), style: pnum(p, 'midlinestyle', 2) });
  }
  for (const l of levels) {
    setStroke(ctx, l.color, l.width, l.style);
    strokeLine(ctx, ...extendSegment(...at(l.coeff), left, right, dc));
  }
}

function rangeLabel(dc: DrawContext, p: Props, text: string, x: number, y: number, below: boolean): void {
  drawText(dc.ctx, text, x, below ? y + 6 : y - 6, {
    font: font(p, 'fontsize', 12),
    color: pstr(p, 'textcolor', '#ffffff'),
    align: 'center',
    baseline: below ? 'top' : 'bottom',
    background: p.fillLabelBackground === false ? null : fillColor(pstr(p, 'labelBackgroundColor', pstr(p, 'linecolor', '#2962FF')), p.labelBackgroundTransparency),
    padding: 5,
  });
}

/** Price range, date range and date-and-price range: a shaded box between the two points with the measured distance. */
export function rangeDrawer(kind: 'price' | 'date' | 'both') {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const [p0, p1] = points as [DrawingPoint, DrawingPoint];
    const a = dc.pt(p0);
    const b = dc.pt(p1);
    const ctx = dc.ctx;
    const color = pstr(p, 'linecolor', '#2962FF');
    const width = pnum(p, 'linewidth', 1);
    if (p.fillBackground !== false) {
      ctx.fillStyle = fillColor(pstr(p, 'backgroundColor', 'rgba(41, 98, 255, 0.2)'), p.backgroundTransparency ?? p.transparency);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    setStroke(ctx, color, width);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const parts: string[] = [];
    if (kind !== 'date') {
      strokeLine(ctx, { x: midX, y: a.y }, { x: midX, y: b.y });
      arrowHead(ctx, { x: midX, y: a.y }, { x: midX, y: b.y }, width);
      const diff = p1.price - p0.price;
      parts.push(`${dc.formatPrice(diff)} (${p0.price ? ((diff / Math.abs(p0.price)) * 100).toFixed(2) : '0'}%)`);
    }
    if (kind !== 'price') {
      strokeLine(ctx, { x: a.x, y: midY }, { x: b.x, y: midY });
      arrowHead(ctx, { x: a.x, y: midY }, { x: b.x, y: midY }, width);
      parts.push(`${Math.round(dc.logical(p1) - dc.logical(p0))} bars`);
    }
    const below = kind === 'date' ? true : b.y > a.y;
    rangeLabel(dc, p, parts.join('\n'), midX, below ? Math.max(a.y, b.y) : Math.min(a.y, b.y), below);
  };
}

/**
 * Long/short position. Stop and target are stored as distances in ticks
 * (`stopLevel`, `profitLevel`), unless the layout also stores the prices.
 */
export function riskRewardDrawer(side: 'long' | 'short') {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const entry = points[0]!;
    const sign = side === 'long' ? 1 : -1;
    const step = dc.priceStep;
    const target = pnum(p, 'targetPrice', entry.price + sign * pnum(p, 'profitLevel', 0) * step);
    const stop = pnum(p, 'stopPrice', entry.price - sign * pnum(p, 'stopLevel', 0) * step);
    const a = dc.pt(entry);
    const endX = points[1] ? dc.pt(points[1]).x : a.x + dc.barSpacing * 20;
    const left = Math.min(a.x, endX);
    const w = Math.abs(endX - a.x);
    const ctx = dc.ctx;
    const yEntry = dc.y(entry.price);
    const yTarget = dc.y(target);
    const yStop = dc.y(stop);
    ctx.fillStyle = fillColor(pstr(p, 'profitBackground', 'rgba(8, 153, 129, 0.2)'), p.profitBackgroundTransparency);
    ctx.fillRect(left, Math.min(yEntry, yTarget), w, Math.abs(yTarget - yEntry));
    ctx.fillStyle = fillColor(pstr(p, 'stopBackground', 'rgba(242, 54, 69, 0.2)'), p.stopBackgroundTransparency);
    ctx.fillRect(left, Math.min(yEntry, yStop), w, Math.abs(yStop - yEntry));
    setStroke(ctx, pstr(p, 'linecolor', '#787B86'), pnum(p, 'linewidth', 1));
    strokeLine(ctx, { x: left, y: yEntry }, { x: left + w, y: yEntry });
    const reward = Math.abs(target - entry.price);
    const risk = Math.abs(entry.price - stop);
    const label = (text: string, y: number, bg: string, above: boolean) =>
      drawText(ctx, text, left + w / 2, above ? y - 4 : y + 4, { font: font(p, 'fontsize', 12), color: pstr(p, 'textcolor', '#ffffff'), align: 'center', baseline: above ? 'bottom' : 'top', background: bg, padding: 4 });
    label(dc.formatPrice(target), yTarget, '#089981', yTarget < yEntry);
    label(dc.formatPrice(stop), yStop, '#F23645', yStop < yEntry);
    if (risk > 0) drawText(ctx, (reward / risk).toFixed(2), left + w / 2, yEntry, { font: font(p, 'fontsize', 12), color: '#ffffff', align: 'center', baseline: 'middle', background: pstr(p, 'linecolor', '#787B86'), padding: 3 });
  };
}
