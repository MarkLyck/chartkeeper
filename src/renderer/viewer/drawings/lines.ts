import type { DrawingPoint } from '../../../core/layout';
import { arrowHead, drawText, extendSegment, font, pnum, pstr, setStroke, strokeLine, textAlongLine, type DrawContext } from './canvas';
import type { Props } from '../../../core/props';
import { kind, priceLabel, timeLabel, type DrawingKind } from './kind';

const lineColor = (p: Props) => pstr(p, 'linecolor', '#2962FF');

const lineWidth = (p: Props) => pnum(p, 'linewidth', 1);

/** Trend line family: a segment, optionally extended, with arrow ends and text. */
export function segmentDrawer(defaults: { extendLeft?: boolean; extendRight?: boolean; rightArrow?: boolean; info?: boolean }) {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const [p0, p1] = points as [DrawingPoint, DrawingPoint];
    const a = dc.pt(p0);
    const b = dc.pt(p1);
    const width = lineWidth(p);
    const color = lineColor(p);
    const left = typeof p.extendLeft === 'boolean' ? p.extendLeft : (defaults.extendLeft ?? false);
    const right = typeof p.extendRight === 'boolean' ? p.extendRight : (defaults.extendRight ?? false);
    const [ea, eb] = extendSegment(a, b, left, right, dc);
    setStroke(dc.ctx, color, width, p.linestyle);
    strokeLine(dc.ctx, ea, eb);
    if (pnum(p, 'leftEnd', 0) === 1) arrowHead(dc.ctx, b, a, width);
    if (pnum(p, 'rightEnd', defaults.rightArrow ? 1 : 0) === 1) arrowHead(dc.ctx, a, b, width);
    textAlongLine(dc.ctx, pstr(p, 'text', ''), a, b, p, pstr(p, 'textcolor', color));
    if (defaults.info) {
      const diff = p1.price - p0.price;
      const pct = p0.price !== 0 ? (diff / Math.abs(p0.price)) * 100 : 0;
      const bars = Math.round(dc.logical(p1) - dc.logical(p0));
      drawText(dc.ctx, `${dc.formatPrice(diff)} (${pct.toFixed(2)}%)\n${bars} bars`, b.x + 8, b.y, {
        font: font(p, 'fontsize', 12),
        color: pstr(p, 'textcolor', '#ffffff'),
        baseline: 'middle',
        background: color,
        padding: 4,
      });
    }
  };
}

function lineLabel(dc: DrawContext, p: Props, text: string, x1: number, x2: number, y: number): void {
  if (!text) return;
  const h = pstr(p, 'horzLabelsAlign', 'center');
  const v = pstr(p, 'vertLabelsAlign', 'middle');
  const x = h === 'left' ? x1 + 4 : h === 'right' ? x2 - 4 : (x1 + x2) / 2;
  drawText(dc.ctx, text, x, v === 'top' ? y - 3 : v === 'bottom' ? y + 3 : y, {
    font: font(p, 'fontsize', 12),
    color: pstr(p, 'textcolor', lineColor(p)),
    align: h === 'left' ? 'left' : h === 'right' ? 'right' : 'center',
    baseline: v === 'top' ? 'bottom' : v === 'bottom' ? 'top' : 'middle',
    background: v === 'middle' ? 'rgba(255,255,255,0.8)' : null,
  });
}

const crisp = (v: number, width: number) => Math.round(v) + (width % 2 ? 0.5 : 0);

export function drawHorzLine(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const y = crisp(dc.y(points[0]!.price), lineWidth(p));
  setStroke(dc.ctx, lineColor(p), lineWidth(p), p.linestyle);
  strokeLine(dc.ctx, { x: 0, y }, { x: dc.width, y });
  lineLabel(dc, p, pstr(p, 'text', ''), 0, dc.width, y);
}

export function drawHorzRay(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const y = crisp(a.y, lineWidth(p));
  setStroke(dc.ctx, lineColor(p), lineWidth(p), p.linestyle);
  strokeLine(dc.ctx, { x: a.x, y }, { x: dc.width, y });
  lineLabel(dc, p, pstr(p, 'text', ''), a.x, dc.width, y);
}

export function drawVertLine(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const x = crisp(dc.pt(points[0]!).x, lineWidth(p));
  setStroke(dc.ctx, lineColor(p), lineWidth(p), p.linestyle);
  strokeLine(dc.ctx, { x, y: 0 }, { x, y: dc.height });
  const text = pstr(p, 'text', '');
  if (!text) return;
  const ctx = dc.ctx;
  ctx.save();
  ctx.translate(x, 8);
  if (p.textOrientation === 'vertical') ctx.rotate(Math.PI / 2);
  drawText(ctx, text, 4, 0, { font: font(p, 'fontsize', 14), color: pstr(p, 'textcolor', lineColor(p)), baseline: 'top' });
  ctx.restore();
}

export function drawCrossLine(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const w = lineWidth(p);
  setStroke(dc.ctx, lineColor(p), w, p.linestyle);
  strokeLine(dc.ctx, { x: 0, y: crisp(a.y, w) }, { x: dc.width, y: crisp(a.y, w) });
  strokeLine(dc.ctx, { x: crisp(a.x, w), y: 0 }, { x: crisp(a.x, w), y: dc.height });
}

export const LINE_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolTrendLine: kind(2, segmentDrawer({})),
  LineToolRay: kind(2, segmentDrawer({ extendRight: true })),
  LineToolExtended: kind(2, segmentDrawer({ extendLeft: true, extendRight: true })),
  LineToolInfoLine: kind(2, segmentDrawer({ info: true })),
  LineToolArrow: kind(2, segmentDrawer({ rightArrow: true })),
  LineToolHorzLine: kind(1, drawHorzLine, priceLabel),
  LineToolHorzRay: kind(1, drawHorzRay, priceLabel),
  LineToolVertLine: kind(1, drawVertLine, timeLabel),
  LineToolCrossLine: kind(1, drawCrossLine, (p, pts) => [...priceLabel(p, pts), ...timeLabel(p, pts)]),
};
