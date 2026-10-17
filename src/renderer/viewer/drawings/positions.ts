import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor } from '../colors';
import { drawText, font, pnum, pstr, setStroke, strokeLine, type DrawContext } from './canvas';
import { kind, type DrawingKind } from './kind';

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

export const POSITION_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolRiskRewardLong: kind(1, riskRewardDrawer('long')),
  LineToolRiskRewardShort: kind(1, riskRewardDrawer('short')),
};
