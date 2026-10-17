import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import { isObj, num, type Props } from '../../../core/props';
import { fillColor } from '../colors';
import { FONT_FAMILY, pnum, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';

export interface FontSpec {
  size: number;
  bold?: boolean;
  italic?: boolean;
}

export const fontCss = (f: FontSpec): string => `${f.bold ? 'bold ' : ''}${f.italic ? 'italic ' : ''}${f.size}px ${FONT_FAMILY}`;

/** Lines of text in a box sized the way TradingView's text renderer sizes it. */
export interface TextBlock {
  lines: string[];
  size: number;
  padX: number;
  padY: number;
  width: number;
  height: number;
}

export interface TextBlockOptions {
  size: number;
  padX: number;
  padY: number;
  /** Wrap at this many pixels; TradingView then makes the box exactly this wide. */
  wrapWidth?: number | null;
}

function wrapLine(measure: (s: string) => number, line: string, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of line.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && measure(next) > width) {
      out.push(cur);
      cur = word;
    } else cur = next;
  }
  out.push(cur);
  return out;
}

/** Width: widest line plus padding, rounded up to an even number. Height: one `size`-high row per line plus padding. */
export function textBlock(measure: (s: string) => number, text: string, o: TextBlockOptions): TextBlock {
  const raw = text.split('\n');
  const lines = o.wrapWidth ? raw.flatMap((l) => wrapLine(measure, l, o.wrapWidth!)) : raw;
  const inner = o.wrapWidth ?? Math.max(0, ...lines.map(measure));
  const w = Math.round(inner + 2 * o.padX);
  return { lines, size: o.size, padX: o.padX, padY: o.padY, width: w % 2 ? w + 1 : w, height: lines.length * o.size + 2 * o.padY };
}

export function measureBlock(ctx: CanvasRenderingContext2D, text: string, font: FontSpec, o: Omit<TextBlockOptions, 'size'>): TextBlock {
  ctx.font = fontCss(font);
  return textBlock((s) => ctx.measureText(s).width, text, { ...o, size: font.size });
}

/** Writes the lines of `b` into its box at (left, top); TradingView centres each row a little below its middle. */
export function fillBlockText(ctx: CanvasRenderingContext2D, b: TextBlock, left: number, top: number, font: FontSpec, color: string, align: 'left' | 'center' = 'left'): void {
  ctx.font = fontCss(font);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const x = align === 'center' ? left + b.width / 2 : left + b.padX;
  b.lines.forEach((line, i) => ctx.fillText(line, x, top + b.padY + b.size * (i + 0.55)));
}

/** A notch in the top or bottom edge of a bubble, running out to `tip`; `from` and `to` are x positions on that edge. */
export interface Tail {
  side: 'top' | 'bottom';
  from: number;
  to: number;
  tip: Pt;
}

/** Outline of a rounded box (corner radii top-left, top-right, bottom-right, bottom-left) with an optional tail, traced as one path. */
export function bubblePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radii: [number, number, number, number], tail: Tail | null = null): void {
  const [tl, tr, br, bl] = radii;
  const lo = tail ? Math.min(tail.from, tail.to) : 0;
  const hi = tail ? Math.max(tail.from, tail.to) : 0;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  if (tail?.side === 'top') {
    ctx.lineTo(lo, y);
    ctx.lineTo(tail.tip.x, tail.tip.y);
    ctx.lineTo(hi, y);
  }
  ctx.arcTo(x + w, y, x + w, y + h, tr);
  ctx.arcTo(x + w, y + h, x, y + h, br);
  if (tail?.side === 'bottom') {
    ctx.lineTo(hi, y + h);
    ctx.lineTo(tail.tip.x, tail.tip.y);
    ctx.lineTo(lo, y + h);
  }
  ctx.arcTo(x, y + h, x, y, bl);
  ctx.arcTo(x, y, x + w, y, tl);
  ctx.closePath();
}

/** Pixel position of an anchored tool: TradingView stores it as fractions of the pane, the centre when missing. */
export function fixedPoint(source: Record<string, unknown>, width: number, height: number): Pt {
  const raw = Array.isArray(source.positionPercents) ? source.positionPercents[0] : source.positionPercents;
  const pp = isObj(raw) ? raw : {};
  return { x: num(pp.x, 0.5) * width, y: num(pp.y, 0.5) * height };
}

/** Where a one-point tool sits: its anchored pane position, else its first point. */
export function anchorOf(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): Pt {
  if (p.anchored === true || points.length === 0) return fixedPoint(drawing.source, dc.width, dc.height);
  return dc.pt(points[0]!);
}

/** Text and anchored text: the anchor is the top-left corner of the box, padded by a sixth of the font size. */
export function drawTextTool(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const text = pstr(p, 'text', '');
  if (!text) return;
  const at = anchorOf(dc, p, points, drawing);
  const font: FontSpec = { size: pnum(p, 'fontsize', 14), bold: p.bold === true, italic: p.italic === true };
  const ctx = dc.ctx;
  const b = measureBlock(ctx, text, font, { padX: font.size / 6, padY: font.size / 6, wrapWidth: p.wordWrap === true ? pnum(p, 'wordWrapWidth', 200) : null });
  ctx.setLineDash([]);
  if (p.fillBackground === true) {
    ctx.fillStyle = fillColor(pstr(p, 'backgroundColor', 'rgba(41, 98, 255, 0.25)'), p.backgroundTransparency);
    ctx.fillRect(at.x, at.y, b.width, b.height);
  }
  if (p.drawBorder === true) {
    const bw = Math.max(font.size / 12, 1);
    ctx.strokeStyle = pstr(p, 'borderColor', '#707070');
    ctx.lineWidth = bw;
    ctx.strokeRect(at.x - bw / 2, at.y - bw / 2, b.width + bw, b.height + bw);
  }
  fillBlockText(ctx, b, at.x, at.y, font, pstr(p, 'color', '#2962FF'));
}

/** The map pin TradingView shows for a collapsed note: a disc above the tip with a see-through hole. */
export function drawPin(ctx: CanvasRenderingContext2D, tip: Pt, color: string): void {
  const r = 12.25;
  const cy = tip.y - 17.5;
  const spread = Math.acos(r / (tip.y - cy));
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.arc(tip.x, cy, r, Math.PI / 2 + spread, Math.PI / 2 - spread);
  ctx.closePath();
  ctx.moveTo(tip.x + 5, cy);
  ctx.arc(tip.x, cy, 5, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
}

/** Notes: TradingView keeps the text in a tooltip and draws only the pin, its tip on the point. */
export function drawNote(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  drawPin(dc.ctx, anchorOf(dc, p, points, drawing), pstr(p, 'markerColor', '#2962FF'));
}

/**
 * Top-left of a w x h label that starts at `b` and continues the line from `a`:
 * beside `b` and vertically centred when the line is mostly horizontal, else
 * above or below `b` and horizontally centred.
 */
export function boxBeyond(a: Pt, b: Pt, w: number, h: number): { left: number; top: number } {
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) return { left: b.x >= a.x ? b.x : b.x - w, top: b.y - h / 2 };
  return { left: b.x - w / 2, top: b.y >= a.y ? b.y : b.y - h };
}

/** Text note: a dot on point 1, a line to point 2, and a rounded label that starts at point 2 and runs away from point 1. */
export function drawTextNote(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const ctx = dc.ctx;
  const line = pstr(p, 'lineColor', '#2962FF');
  setStroke(ctx, line, 1);
  strokeLine(ctx, a, b);
  ctx.fillStyle = line;
  ctx.beginPath();
  ctx.arc(a.x, a.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  const text = pstr(p, 'text', '');
  if (!text) return;
  const font: FontSpec = { size: pnum(p, 'fontSize', 14), bold: p.bold === true, italic: p.italic === true };
  const block = measureBlock(ctx, text, font, { padX: 8, padY: 6 });
  const { left, top } = boxBeyond(a, b, block.width, block.height);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
  ctx.shadowOffsetY = 2;
  ctx.shadowBlur = 2;
  ctx.beginPath();
  ctx.roundRect(left, top, block.width, block.height, 4);
  ctx.fillStyle = p.drawBackground === false ? 'rgba(0, 0, 0, 0)' : fillColor(pstr(p, 'backgroundColor', '#2962FF'), p.backgroundTransparency);
  ctx.fill();
  ctx.restore();
  if (p.drawBorder === true) {
    ctx.strokeStyle = pstr(p, 'borderColor', '#2962FF');
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  fillBlockText(ctx, block, left, top, font, pstr(p, 'textColor', '#ffffff'));
}

/** Callout: a rounded box centred over point 1 at the height of point 2, with a tapering tail from the box to point 1. */
export function drawCallout(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const tip = dc.pt(points[0]!);
  const at = dc.pt(points[1]!);
  const ctx = dc.ctx;
  const font: FontSpec = { size: pnum(p, 'fontsize', 14), bold: p.bold === true, italic: p.italic === true };
  const block = measureBlock(ctx, pstr(p, 'text', ''), font, { padX: 10, padY: 10, wrapWidth: p.wordWrap === true ? pnum(p, 'wordWrapWidth', 200) : null });
  const left = tip.x - block.width / 2;
  const top = at.y - block.height / 2;
  const half = Math.min(7, block.width / 2 - 8);
  const side = tip.y > top + block.height ? 'bottom' : tip.y < top ? 'top' : null;
  ctx.setLineDash([]);
  bubblePath(ctx, left, top, block.width, block.height, [8, 8, 8, 8], side && { side, from: tip.x - half, to: tip.x + half, tip });
  const bg = fillColor(pstr(p, 'backgroundColor', 'rgba(0, 151, 167, 0.7)'), p.transparency);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = pstr(p, 'bordercolor', bg);
  ctx.lineWidth = pnum(p, 'linewidth', 1);
  ctx.lineJoin = 'round';
  ctx.stroke();
  fillBlockText(ctx, block, left, top, font, pstr(p, 'color', '#ffffff'));
}

export const TEXT_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolText: kind(1, drawTextTool),
  LineToolTextAbsolute: kind(0, drawTextTool),
  LineToolNote: kind(1, drawNote),
  LineToolNoteAbsolute: kind(0, drawNote),
  LineToolTextNote: kind(2, drawTextNote),
  LineToolCallout: kind(2, drawCallout),
};
