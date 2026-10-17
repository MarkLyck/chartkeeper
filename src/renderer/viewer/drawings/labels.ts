import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor } from '../colors';
import { drawBubble, drawText, font, pnum, pstr, setStroke, strokeLine, type DrawContext } from './canvas';
import { kind, type DrawingKind } from './kind';

export function bubbleDrawer(kind: 'balloon' | 'comment' | 'priceLabel') {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const pt = points[0]!;
    const text = kind === 'priceLabel' ? dc.formatPrice(pt.price) : pstr(p, 'text', '');
    if (!text) return;
    drawBubble(dc.ctx, text, dc.pt(pt), {
      font: font(p, 'fontsize', kind === 'priceLabel' ? 11 : 14),
      color: pstr(p, 'color', pstr(p, 'textColor', '#ffffff')),
      background: fillColor(pstr(p, 'backgroundColor', kind === 'priceLabel' ? '#2962FF' : 'rgba(255, 254, 206, 0.7)'), p.transparency),
      border: pstr(p, 'borderColor', '') || null,
    });
  };
}

/** Price note: a line from the priced point to a label showing that price. */
export function drawPriceNote(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = points[1] ? dc.pt(points[1]) : { x: a.x + 40, y: a.y };
  const color = pstr(p, 'lineColor', pstr(p, 'linecolor', '#2962FF'));
  setStroke(dc.ctx, color, pnum(p, 'lineWidth', pnum(p, 'linewidth', 1)));
  strokeLine(dc.ctx, a, b);
  drawText(dc.ctx, dc.formatPrice(points[0]!.price), b.x, b.y, {
    font: font(p, 'priceLabelFontSize', 12),
    color: pstr(p, 'priceLabelTextColor', '#ffffff'),
    background: pstr(p, 'priceLabelBackgroundColor', color),
    border: pstr(p, 'priceLabelBorderColor', '') || null,
    padding: 4,
    baseline: 'middle',
    align: b.x >= a.x ? 'left' : 'right',
  });
}

export const LABEL_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolBalloon: kind(1, bubbleDrawer('balloon')),
  LineToolComment: kind(1, bubbleDrawer('comment')),
  LineToolPriceLabel: kind(1, bubbleDrawer('priceLabel')),
  LineToolPriceNote: kind(1, drawPriceNote),
};
