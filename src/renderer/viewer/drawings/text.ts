import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor } from '../colors';
import { drawText, font, pnum, pstr, setStroke, strokeLine, type DrawContext } from './canvas';
import { kind, type DrawingKind } from './kind';

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

export const TEXT_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolText: kind(1, drawTextTool),
  LineToolTextAbsolute: kind(1, drawTextTool),
  LineToolNote: kind(1, drawNote),
  LineToolNoteAbsolute: kind(1, drawNote),
  LineToolCallout: kind(1, drawCallout),
};
