import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import { num, type Props } from '../../../core/props';
import { fillColor } from '../colors';
import { pnum, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';
import { anchorOf, boxBeyond, bubblePath, fillBlockText, fontCss, measureBlock, type FontSpec, type Tail, type TextBlock } from './text';

/** Fills and outlines a bubble, then writes its text. */
function drawBubble(ctx: CanvasRenderingContext2D, block: TextBlock, left: number, top: number, radii: [number, number, number, number], tail: Tail | null, font: FontSpec, colors: { fill: string; border: string; text: string }, borderWidth = 1): void {
  ctx.setLineDash([]);
  bubblePath(ctx, left, top, block.width, block.height, radii, tail);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = borderWidth;
  ctx.stroke();
  fillBlockText(ctx, block, left, top, font, colors.text);
}

/** Balloon: a rounded box above and right of the point with a tail down to it. */
export function drawBalloon(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const text = pstr(p, 'text', '');
  if (!text) return;
  const tip = dc.pt(points[0]!);
  const font: FontSpec = { size: pnum(p, 'fontsize', 14) };
  const block = measureBlock(dc.ctx, text, font, { padX: 17, padY: 12 });
  const top = tip.y - 10 - block.height;
  const fill = fillColor(pstr(p, 'backgroundColor', '#2962FF'), p.transparency);
  drawBubble(dc.ctx, block, tip.x - 40, top, [15, 15, 15, 15], { side: 'bottom', from: tip.x - 12, to: tip.x - 1, tip }, font, {
    fill,
    border: pstr(p, 'borderColor', fill),
    text: pstr(p, 'color', '#ffffff'),
  }, 2);
}

/** Comment: a speech bubble whose square bottom-left corner sits on the point. */
export function drawComment(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const text = pstr(p, 'text', '');
  if (!text) return;
  const at = dc.pt(points[0]!);
  const font: FontSpec = { size: pnum(p, 'fontsize', 16) };
  const block = measureBlock(dc.ctx, text, font, { padX: 15, padY: 13.5 });
  const fill = fillColor(pstr(p, 'backgroundColor', '#2962FF'), p.transparency);
  drawBubble(dc.ctx, block, at.x, at.y - block.height, [20, 20, 20, 2], null, font, { fill, border: pstr(p, 'borderColor', fill), text: pstr(p, 'color', '#ffffff') });
}

/** Price label: the point's price in a box up and to the right, joined to the point by a short slanted tail. */
export function drawPriceLabel(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const pt = points[0]!;
  const tip = dc.pt(pt);
  const font: FontSpec = { size: pnum(p, 'fontsize', 14), bold: pstr(p, 'fontWeight', '') === 'bold' };
  const block = measureBlock(dc.ctx, dc.formatPrice(pt.price), font, { padX: 11.5, padY: 6 });
  const left = tip.x + 8;
  const bottom = tip.y - 14;
  const fill = fillColor(pstr(p, 'backgroundColor', '#2962FF'), p.transparency);
  drawBubble(dc.ctx, block, left, bottom - block.height, [4, 4, 4, 4], { side: 'bottom', from: left + 4, to: left + 13, tip }, font, {
    fill,
    border: pstr(p, 'borderColor', fill),
    text: pstr(p, 'color', '#ffffff'),
  });
}

/**
 * Text riding on a line, kept upright and centred on it (or at an end for
 * horzLabelsAlign left/right). vertLabelsAlign names the side of the text that
 * touches the line: "bottom" puts the text above the line, "top" below it.
 */
function noteAlongLine(ctx: CanvasRenderingContext2D, text: string, a: Pt, b: Pt, p: Props, color: string): void {
  if (!text) return;
  const font: FontSpec = { size: pnum(p, 'fontSize', 14), bold: p.bold === true, italic: p.italic === true };
  const [from, to] = a.x <= b.x ? [a, b] : [b, a];
  const align = pstr(p, 'horzLabelsAlign', 'center');
  const vAlign = pstr(p, 'vertLabelsAlign', 'bottom');
  const anchor = align === 'left' ? from : align === 'right' ? to : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const gap = font.size / 2 + 4;
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(Math.atan2(to.y - from.y, to.x - from.x));
  ctx.font = fontCss(font);
  ctx.fillStyle = color;
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, vAlign === 'bottom' ? -gap : vAlign === 'top' ? gap : 0);
  ctx.restore();
}

/** Price note: a dot on point 1, a line to point 2 with the note's text along it, and point 1's price in a label at point 2. */
export function drawPriceNote(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const ctx = dc.ctx;
  const color = pstr(p, 'lineColor', '#2962FF');
  setStroke(ctx, color, 1);
  strokeLine(ctx, a, b);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(a.x, a.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  noteAlongLine(ctx, pstr(p, 'text', ''), a, b, p, pstr(p, 'textColor', color));
  const font: FontSpec = { size: pnum(p, 'priceLabelFontSize', 12), bold: p.priceLabelBold === true, italic: p.priceLabelItalic === true };
  const block = measureBlock(ctx, dc.formatPrice(points[0]!.price), font, { padX: 9, padY: 6 });
  const { left, top } = boxBeyond(a, b, block.width, block.height);
  const fill = pstr(p, 'priceLabelBackgroundColor', '#2962FF');
  drawBubble(ctx, block, left, top, [4, 4, 4, 4], null, font, {
    fill,
    border: pstr(p, 'priceLabelBorderColor', fill),
    text: pstr(p, 'priceLabelTextColor', '#ffffff'),
  });
}

/** The bar a point falls on, if the chart has it. */
function barAt(dc: DrawContext, point: DrawingPoint) {
  const i = Math.round(dc.logical(point));
  return dc.bars[i] ?? null;
}

/**
 * Signpost: a plate on a pole that stands on the bar's high (or hangs from its
 * low when the point is below the bar). `position` is how far up the free space
 * the plate sits, in percent.
 */
export function drawSignpost(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const pt = points[0]!;
  const at = dc.pt(pt);
  const bar = barAt(dc, pt);
  const below = bar !== null && pt.price < bar[3];
  const foot = bar ? dc.y(below ? bar[3] : bar[2]) : at.y;
  const share = 1 - pnum(p, 'position', 50) / 100;
  const emoji = p.showImage === true ? pstr(p, 'emoji', '') : '';
  const text = [emoji, pstr(p, 'text', '')].filter(Boolean).join(' ');
  const font: FontSpec = { size: pnum(p, 'fontSize', 12), bold: p.bold === true, italic: p.italic === true };
  const ctx = dc.ctx;
  const block = measureBlock(ctx, text, font, { padX: 10, padY: 7 });
  const top = below ? foot + (dc.height - foot) * (1 - share) : foot * share;
  const poleFrom = below ? foot + 4 : top + block.height;
  const poleTo = below ? top : foot - 4;
  if (poleTo > poleFrom) {
    setStroke(ctx, '#808080', 1);
    strokeLine(ctx, { x: Math.round(at.x) + 0.5, y: poleFrom }, { x: Math.round(at.x) + 0.5, y: poleTo });
  }
  drawBubble(ctx, block, at.x - block.width / 2, top, [5, 5, 5, 5], null, font, {
    fill: dc.background,
    border: dc.dark ? '#2E2E2E' : '#EBEBEB',
    text: dc.dark ? '#DBDBDB' : '#0F0F0F',
  });
}

export interface TableGrid {
  /** Left edge of every column plus the right edge of the last, from the table's left. */
  xs: number[];
  /** Top edge of every row plus the bottom edge of the last, from the table's top. */
  ys: number[];
}

const TABLE_PAD_X = 10;
const TABLE_PAD_Y = 9;

/** Column and row edges: the stored sizes, widened to fit each cell's text with TradingView's padding. */
export function tableGrid(cells: readonly (readonly string[])[], columnWidths: readonly number[], rowHeights: readonly number[], fontSize: number, measure: (s: string) => number): TableGrid {
  const cols = Math.max(columnWidths.length, ...cells.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(columnWidths[c] ?? 0, ...cells.map((r) => measure(r[c] ?? '') + 2 * TABLE_PAD_X)));
  const heights = Array.from({ length: Math.max(rowHeights.length, cells.length) }, (_, r) => Math.max(rowHeights[r] ?? 0, fontSize + 2 * TABLE_PAD_Y));
  const edges = (sizes: number[]) => sizes.reduce((acc, s) => [...acc, acc[acc.length - 1]! + s], [0]);
  return { xs: edges(widths), ys: edges(heights) };
}

const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.map((n) => num(n, 0)) : []);
const tableCells = (v: unknown): string[][] => (Array.isArray(v) ? v.map((row) => (Array.isArray(row) ? row.map((c) => (typeof c === 'string' ? c : c == null ? '' : String(c))) : [])) : []);

/** Table: a grid of text cells whose top-left corner is the point (or its anchored pane position). */
export function drawTable(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  const at = anchorOf(dc, p, points, drawing);
  const cells = tableCells(p.cells);
  const font: FontSpec = { size: pnum(p, 'fontSize', 14) };
  const ctx = dc.ctx;
  ctx.font = fontCss(font);
  const grid = tableGrid(cells, numbers(p.columnWidths), numbers(p.rowHeights), font.size, (s) => ctx.measureText(s).width);
  const x0 = Math.round(at.x);
  const y0 = Math.round(at.y);
  const w = grid.xs[grid.xs.length - 1]!;
  const h = grid.ys[grid.ys.length - 1]!;
  ctx.setLineDash([]);
  ctx.fillStyle = pstr(p, 'backgroundColor', '#ffffff');
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = pstr(p, 'borderColor', '#607D8B');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of grid.xs) {
    ctx.moveTo(x0 + x + 0.5, y0);
    ctx.lineTo(x0 + x + 0.5, y0 + h + 1);
  }
  for (const y of grid.ys) {
    ctx.moveTo(x0, y0 + y + 0.5);
    ctx.lineTo(x0 + w + 1, y0 + y + 0.5);
  }
  ctx.stroke();
  const align = pstr(p, 'horzAlign', 'left');
  ctx.fillStyle = pstr(p, 'textColor', '#131722');
  ctx.textBaseline = 'middle';
  ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
  cells.forEach((row, r) =>
    row.forEach((text, c) => {
      const left = x0 + grid.xs[c]!;
      const right = x0 + grid.xs[c + 1]!;
      const x = align === 'center' ? (left + right) / 2 : align === 'right' ? right - TABLE_PAD_X : left + TABLE_PAD_X;
      ctx.fillText(text, x, y0 + (grid.ys[r]! + grid.ys[r + 1]!) / 2 + font.size * 0.05);
    }),
  );
}

export const LABEL_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolBalloon: kind(1, drawBalloon),
  LineToolComment: kind(1, drawComment),
  LineToolPriceLabel: kind(1, drawPriceLabel),
  LineToolPriceNote: kind(2, drawPriceNote),
  LineToolSignpost: kind(1, drawSignpost),
  LineToolTable: kind(0, drawTable),
};

