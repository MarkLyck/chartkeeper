import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor } from '../colors';
import { arrowHead, drawText, font, pnum, pstr, setStroke, strokeLine, type DrawContext } from './canvas';
import { kind, type DrawingKind } from './kind';

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

export const MEASURE_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolPriceRange: kind(2, rangeDrawer('price')),
  LineToolDateRange: kind(2, rangeDrawer('date')),
  LineToolDateAndPriceRange: kind(2, rangeDrawer('both')),
};
