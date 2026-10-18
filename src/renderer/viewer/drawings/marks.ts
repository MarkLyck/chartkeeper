import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillPolygon, FONT_FAMILY, pnum, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';
import { fillBlockText, measureBlock, type FontSpec } from './text';

const ARROW_LENGTH = 22;
/** Arrow mark pointing up with its tip at (0, 0): a 12 px head 21 px wide on an 11 px wide shaft. */
const ARROW_MARK: Pt[] = [
  { x: 0, y: 0 },
  { x: 10.5, y: 11.5 },
  { x: 5.5, y: 11.5 },
  { x: 5.5, y: ARROW_LENGTH },
  { x: -5.5, y: ARROW_LENGTH },
  { x: -5.5, y: 11.5 },
  { x: -10.5, y: 11.5 },
];

type Direction = 'up' | 'down' | 'left' | 'right';
const ROTATION: Record<Direction, number> = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

/** Arrow marks: a block arrow whose tip touches the point, with the label beyond its tail. */
export function arrowMarkDrawer(direction: Direction) {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const tip = dc.pt(points[0]!);
    const ctx = dc.ctx;
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(ROTATION[direction]);
    fillPolygon(ctx, ARROW_MARK, pstr(p, 'arrowColor', pstr(p, 'color', '#089981')));
    ctx.restore();
    const text = p.showLabel === false ? '' : pstr(p, 'text', '');
    if (!text) return;
    const font: FontSpec = { size: pnum(p, 'fontsize', 14), bold: p.bold === true, italic: p.italic === true };
    const b = measureBlock(ctx, text, font, { padX: 0, padY: 0 });
    const gap = ARROW_LENGTH + 2.5;
    const side = ARROW_LENGTH + 6;
    const box: Record<Direction, Pt> = {
      up: { x: tip.x - b.width / 2, y: tip.y + gap },
      down: { x: tip.x - b.width / 2, y: tip.y - gap - b.height },
      left: { x: tip.x + side, y: tip.y - b.height / 2 },
      right: { x: tip.x - side - b.width, y: tip.y - b.height / 2 },
    };
    fillBlockText(ctx, b, box[direction].x, box[direction].y, font, pstr(p, 'color', '#089981'), 'center');
  };
}

/**
 * Arrow marker: a filled arrow from point 1 to point 2 that starts as a sharp tail
 * and widens to its head; the head takes the last quarter of the length.
 */
export function drawArrowMarker(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return;
  const ctx = dc.ctx;
  const base = len * 0.75;
  const shaft = len * 0.08;
  const barb = len * 0.155;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  fillPolygon(
    ctx,
    [
      { x: 0, y: -1 },
      { x: base, y: -shaft },
      { x: base - 2, y: -barb },
      { x: len, y: 0 },
      { x: base - 2, y: barb },
      { x: base, y: shaft },
      { x: 0, y: 1 },
    ],
    pstr(p, 'backgroundColor', '#1E53E5'),
  );
  ctx.restore();
  const text = pstr(p, 'text', '');
  if (!text) return;
  const font: FontSpec = { size: pnum(p, 'fontsize', 16), bold: p.bold === true, italic: p.italic === true };
  const block = measureBlock(ctx, text, font, { padX: 0, padY: 0 });
  const left = b.x >= a.x ? a.x - 15 - block.width : a.x + 15;
  fillBlockText(ctx, block, left, a.y - block.height / 2, font, pstr(p, 'textColor', pstr(p, 'backgroundColor', '#1E53E5')));
}

/** Flag: a grey pole standing on the point with a small notched pennant at its top. */
export function drawFlag(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const ctx = dc.ctx;
  const x = Math.round(a.x) + 0.5;
  const top = a.y - 19.5;
  setStroke(ctx, '#808080', 1);
  strokeLine(ctx, { x, y: a.y }, { x, y: top });
  fillPolygon(
    ctx,
    [
      { x: x + 1.5, y: top },
      { x: x + 18, y: top },
      { x: x + 15.5, y: top + 5 },
      { x: x + 18, y: top + 10 },
      { x: x + 1.5, y: top + 10 },
    ],
    pstr(p, 'flagColor', '#2962FF'),
  );
}

const EMOJI_FONT = `'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', ${FONT_FAMILY}`;

/** Stickers are pictures; known ones are drawn as a glyph, optionally on a disc, in the picture's main colours. */
export const STICKERS: Readonly<Record<string, { glyph: string; color: string; disc?: string }>> = {
  bitcoin: { glyph: '₿', color: '#FBC516', disc: '#2962FF' },
};

/**
 * Draws a glyph centred on the point, `drop` pixels lower to centre its ink.
 * TradingView stores the rotation handle's angle with up as pi/2, so pi/2 means upright.
 */
function drawGlyph(dc: DrawContext, p: Props, points: DrawingPoint[], glyph: string, font: string, color: string, drop = 0): void {
  const at = dc.pt(points[0]!);
  const ctx = dc.ctx;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(Math.PI / 2 - pnum(p, 'angle', Math.PI / 2));
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 0, drop);
  ctx.restore();
}

/** Font Awesome 4.7, which ../iconFont.ts loads; TradingView stores icons as its code points. */
export const ICON_FONT_FAMILY = 'ChartKeeper Font Awesome';

/** `icon` is a Font Awesome 4.7 code point, the font TradingView draws icons with. */
export function drawIcon(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const size = pnum(p, 'size', 40);
  drawGlyph(dc, p, points, String.fromCodePoint(pnum(p, 'icon', 0xf118)), `${size}px '${ICON_FONT_FAMILY}'`, pstr(p, 'color', '#2962FF'));
}

export function drawEmoji(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const size = pnum(p, 'size', 40);
  drawGlyph(dc, p, points, pstr(p, 'emoji', '\u{1f642}'), `${size}px ${EMOJI_FONT}`, '#000000', size * 0.075);
}

/** Unknown stickers are drawn as their name. */
export function drawSticker(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const name = pstr(p, 'sticker', '');
  const size = pnum(p, 'size', 110);
  const sticker = STICKERS[name];
  if (!sticker) {
    drawGlyph(dc, p, points, name, `bold ${Math.max(12, size / 6)}px ${FONT_FAMILY}`, dc.dark ? '#DBDBDB' : '#131722');
    return;
  }
  if (sticker.disc) {
    const at = dc.pt(points[0]!);
    dc.ctx.fillStyle = sticker.disc;
    dc.ctx.beginPath();
    dc.ctx.arc(at.x, at.y, size * 0.33, 0, Math.PI * 2);
    dc.ctx.fill();
  }
  drawGlyph(dc, p, points, sticker.glyph, `bold ${size * 0.75}px ${FONT_FAMILY}`, sticker.color, -size * 0.05);
}

const approximate = { code: 'approximate-symbol' } as const;

export const MARK_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolArrowMarkUp: kind(1, arrowMarkDrawer('up')),
  LineToolArrowMarkDown: kind(1, arrowMarkDrawer('down')),
  LineToolArrowMarkLeft: kind(1, arrowMarkDrawer('left')),
  LineToolArrowMarkRight: kind(1, arrowMarkDrawer('right')),
  LineToolArrowMarker: kind(2, drawArrowMarker),
  LineToolFlagMark: kind(1, drawFlag),
  LineToolIcon: kind(1, drawIcon),
  LineToolEmoji: kind(1, drawEmoji, undefined, approximate),
  LineToolSticker: kind(1, drawSticker, undefined, approximate),
};
