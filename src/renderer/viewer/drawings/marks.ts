import type { DrawingPoint } from '../../../core/layout';
import { drawText, fillPolygon, font, pstr, setStroke, strokeLine, type DrawContext } from './canvas';
import type { Props } from '../../../core/props';
import { kind, type DrawingKind } from './kind';

/** Arrow marks: a block arrow whose tip touches the point, with optional text behind it. */
export function arrowMarkDrawer(direction: 'up' | 'down' | 'left' | 'right') {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const tip = dc.pt(points[0]!);
    const head = 10;
    const half = 9;
    const shaft = 4;
    const len = 20;
    const rot = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[direction];
    const ctx = dc.ctx;
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(rot);
    fillPolygon(
      ctx,
      [
        { x: 0, y: 0 },
        { x: half, y: head },
        { x: shaft, y: head },
        { x: shaft, y: len },
        { x: -shaft, y: len },
        { x: -shaft, y: head },
        { x: -half, y: head },
      ],
      pstr(p, 'arrowColor', pstr(p, 'color', '#089981')),
    );
    ctx.restore();
    const text = p.showLabel === false ? '' : pstr(p, 'text', '');
    if (!text) return;
    const gap = len + 4;
    const pos = {
      up: { x: tip.x, y: tip.y + gap, align: 'center' as const, baseline: 'top' as const },
      down: { x: tip.x, y: tip.y - gap, align: 'center' as const, baseline: 'bottom' as const },
      left: { x: tip.x + gap, y: tip.y, align: 'left' as const, baseline: 'middle' as const },
      right: { x: tip.x - gap, y: tip.y, align: 'right' as const, baseline: 'middle' as const },
    }[direction];
    drawText(ctx, text, pos.x, pos.y, { font: font(p, 'fontsize', 14), color: pstr(p, 'color', '#089981'), align: pos.align, baseline: pos.baseline });
  };
}

/** Arrow marker: a filled arrow from point 1 to point 2. */
export function drawArrowMarker(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return;
  const ctx = dc.ctx;
  const head = Math.min(len * 0.5, 24);
  const half = Math.max(6, Math.min(14, len * 0.2));
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  fillPolygon(
    ctx,
    [
      { x: 0, y: 0 },
      { x: -head, y: half },
      { x: -head, y: half / 2.5 },
      { x: -len, y: half / 4 },
      { x: -len, y: -half / 4 },
      { x: -head, y: -half / 2.5 },
      { x: -head, y: -half },
    ],
    pstr(p, 'backgroundColor', '#1E53E5'),
  );
  ctx.restore();
  const text = pstr(p, 'text', '');
  if (text) drawText(ctx, text, a.x, a.y + 6, { font: font(p, 'fontsize', 14), color: pstr(p, 'textColor', pstr(p, 'backgroundColor', '#1E53E5')), align: 'center', baseline: 'top' });
}

export function drawFlag(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const ctx = dc.ctx;
  const color = pstr(p, 'flagColor', pstr(p, 'color', '#2962FF'));
  setStroke(ctx, color, 2);
  strokeLine(ctx, a, { x: a.x, y: a.y - 26 });
  fillPolygon(
    ctx,
    [
      { x: a.x, y: a.y - 26 },
      { x: a.x + 18, y: a.y - 26 },
      { x: a.x + 13, y: a.y - 20.5 },
      { x: a.x + 18, y: a.y - 15 },
      { x: a.x, y: a.y - 15 },
    ],
    color,
  );
}

export const MARK_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolArrowMarkUp: kind(1, arrowMarkDrawer('up')),
  LineToolArrowMarkDown: kind(1, arrowMarkDrawer('down')),
  LineToolArrowMarkLeft: kind(1, arrowMarkDrawer('left')),
  LineToolArrowMarkRight: kind(1, arrowMarkDrawer('right')),
  LineToolArrowMarker: kind(2, drawArrowMarker),
  LineToolFlagMark: kind(1, drawFlag),
};
