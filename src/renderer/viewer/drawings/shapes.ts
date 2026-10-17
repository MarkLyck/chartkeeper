import type { DrawingPoint } from '../../../core/layout';
import { fillColor } from '../colors';
import { drawText, fillPolygon, font, pnum, pobj, pstr, setStroke, strokeLine, type DrawContext } from './canvas';
import type { Props } from '../../../core/props';
import { kind, type DrawingKind } from './kind';

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

export const SHAPE_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolRectangle: kind(2, drawRectangle),
  LineToolEllipse: kind(2, drawEllipse),
  LineToolCircle: kind(2, drawCircle),
  LineToolTriangle: kind(3, drawTriangle),
};
