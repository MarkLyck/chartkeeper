import type { DrawingPoint } from '../../../core/layout';
import { fillColor } from '../colors';
import { drawBubble, drawText, fillPolygon, font, pnum, pstr, setStroke, strokeLine, type DrawContext } from './canvas';
import type { Props } from '../../../core/props';

/** Plain text and anchored text: the point is the top-left corner of the text. */
export function drawTextTool(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const text = pstr(p, 'text', '');
  if (!text) return;
  drawText(dc.ctx, text, a.x, a.y, {
    font: font(p, 'fontsize', 14),
    color: pstr(p, 'color', '#2962FF'),
    background: p.fillBackground === true ? fillColor(pstr(p, 'backgroundColor', 'rgba(41, 98, 255, 0.25)'), p.backgroundTransparency) : null,
    border: p.drawBorder === true ? pstr(p, 'borderColor', '#707070') : null,
    padding: p.fillBackground === true || p.drawBorder === true ? 4 : 0,
    wrapWidth: p.wordWrap === true ? pnum(p, 'wordWrapWidth', 200) : null,
  });
}

/** Note pin; TradingView only shows its text on hover, the offline viewer shows it always. */
export function drawNote(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const ctx = dc.ctx;
  const marker = pstr(p, 'markerColor', '#2962FF');
  ctx.setLineDash([]);
  ctx.fillStyle = marker;
  ctx.beginPath();
  ctx.arc(a.x, a.y - 14, 7, Math.PI * 0.85, Math.PI * 2.15);
  ctx.lineTo(a.x, a.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(a.x, a.y - 14, 2.5, 0, Math.PI * 2);
  ctx.fill();
  const text = pstr(p, 'text', '');
  if (text)
    drawText(ctx, text, a.x + 10, a.y - 24, {
      font: font(p, 'fontSize', 14),
      color: pstr(p, 'textColor', '#ffffff'),
      background: fillColor(pstr(p, 'backgroundColor', marker), p.backgroundTransparency),
      border: pstr(p, 'borderColor', '') || null,
      padding: 6,
      baseline: 'bottom',
      wrapWidth: 260,
    });
}

/** Callout: a text box at point 2 with a pointer to point 1. */
export function drawCallout(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const anchor = dc.pt(points[0]!);
  const at = points[1] ? dc.pt(points[1]) : { x: anchor.x + 20, y: anchor.y - 40 };
  const bg = fillColor(pstr(p, 'backgroundColor', 'rgba(0, 151, 167, 0.7)'), p.transparency);
  setStroke(dc.ctx, pstr(p, 'bordercolor', bg), pnum(p, 'linewidth', 1));
  strokeLine(dc.ctx, anchor, at);
  drawText(dc.ctx, pstr(p, 'text', ''), at.x, at.y, {
    font: font(p, 'fontsize', 14),
    color: pstr(p, 'color', '#ffffff'),
    background: bg,
    border: pstr(p, 'bordercolor', '') || null,
    padding: 8,
    baseline: 'middle',
    wrapWidth: p.wordWrap === true ? pnum(p, 'wordWrapWidth', 200) : null,
  });
}

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
