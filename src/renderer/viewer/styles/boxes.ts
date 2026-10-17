import type { PaintFrame, Painter, StyleBar, StyleView } from './view';

export interface UpDown {
  up: string;
  down: string;
}

/** TradingView's candle body width in bitmap pixels for a bar spacing in CSS pixels. */
export function candleWidth(barSpacing: number, pixelRatio: number): number {
  let w: number;
  if (barSpacing >= 2.5 && barSpacing <= 4) w = Math.floor(3 * pixelRatio);
  else {
    const shrink = 1 - (0.2 * Math.atan(Math.max(4, barSpacing) - 4)) / (0.5 * Math.PI);
    w = Math.max(Math.floor(pixelRatio), Math.min(Math.floor(barSpacing * shrink * pixelRatio), Math.floor(barSpacing * pixelRatio)));
  }
  return w >= 2 && Math.floor(pixelRatio) % 2 !== w % 2 ? w - 1 : w;
}

const isUp = (b: StyleBar) => b.close >= b.open;

function fillRect(f: PaintFrame<StyleBar>, left: number, right: number, top: number, bottom: number, color: string) {
  const t = Math.round(Math.min(top, bottom));
  const b = Math.round(Math.max(top, bottom));
  f.ctx.fillStyle = color;
  f.ctx.fillRect(left, t, Math.max(1, right - left), Math.max(1, b - t));
}

export interface BrickLook {
  body: UpDown;
  border: UpDown;
  /** Renko wicks; null for Line Break, which has none. */
  wick: UpDown | null;
}

/** Renko and Line Break (styles 4 and 7): boxes from open to close that fill their whole bar slot, so neighbours touch. */
export function brickStyle(look: BrickLook): StyleView<StyleBar> {
  const painter: Painter<StyleBar> = (f) => {
    const half = f.barSpacing / 2;
    const line = Math.max(1, Math.floor(f.hpr));
    for (const { x, bar } of f.bars) {
      const up = isUp(bar);
      const left = Math.round(x - half);
      const right = Math.round(x + half);
      if (look.wick) {
        const wx = Math.round(x) - Math.floor(line / 2);
        const color = up ? look.wick.up : look.wick.down;
        const top = f.y(Math.max(bar.open, bar.close));
        const bottom = f.y(Math.min(bar.open, bar.close));
        if (bar.high > Math.max(bar.open, bar.close)) fillRect(f, wx, wx + line, f.y(bar.high), top, color);
        if (bar.low < Math.min(bar.open, bar.close)) fillRect(f, wx, wx + line, bottom, f.y(bar.low), color);
      }
      const top = Math.round(f.y(Math.max(bar.open, bar.close)));
      const bottom = Math.round(f.y(Math.min(bar.open, bar.close)));
      const border = up ? look.border.up : look.border.down;
      const body = up ? look.body.up : look.body.down;
      fillRect(f, left, right, top, bottom, border);
      if (body !== border && right - left > 2 * line && bottom - top > 2 * line) fillRect(f, left + line, right - line, top + line, bottom - line, body);
    }
  };
  return { painter, prices: (b) => [b.high, b.low, b.close] };
}

export interface HighLowLook {
  body: string | null;
  border: string | null;
  /** Colour of the high and low labels; null hides them. */
  label: string | null;
  formatPrice: (price: number) => string;
  font: string;
}

/** High-Low (style 12): a box from each bar's low to its high, with the two prices above and below when they fit. */
export function highLowStyle(look: HighLowLook): StyleView<StyleBar> {
  const painter: Painter<StyleBar> = (f) => {
    const { ctx } = f;
    const width = candleWidth(f.barSpacing / f.hpr, f.hpr);
    const line = Math.max(1, Math.floor(f.hpr));
    for (const { x, bar } of f.bars) {
      const left = Math.round(x) - Math.floor(width / 2);
      const top = Math.round(f.y(bar.high));
      const bottom = Math.round(f.y(bar.low));
      if (look.border) fillRect(f, left, left + width, top, bottom + line, look.border);
      if (look.body && (!look.border || width > 2 * line)) {
        const inset = look.border ? line : 0;
        fillRect(f, left + inset, left + width - inset, top + inset, bottom + line - inset, look.body);
      }
    }
    if (!look.label) return;
    const spacing = f.barSpacing / f.hpr;
    if (spacing <= 5) return;
    const widest = f.bars.reduce((w, { bar }) => [look.formatPrice(bar.high), look.formatPrice(bar.low)].reduce((a, t) => (t.length > a.length ? t : a), w), '').replace(/\d/g, '0');
    ctx.font = `10px ${look.font}`;
    const size = Math.floor((10 * (Math.floor(spacing) - 2)) / Math.max(1, ctx.measureText(widest).width));
    if (size < 8) return;
    ctx.font = `${Math.min(size, 12) * f.vpr}px ${look.font}`;
    ctx.fillStyle = look.label;
    ctx.textAlign = 'center';
    const pad = 0.4 * Math.min(size, 12) * f.vpr;
    for (const { x, bar } of f.bars) {
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(look.formatPrice(bar.high), Math.round(x), Math.round(f.y(bar.high)) - pad);
      ctx.textBaseline = 'top';
      ctx.fillText(look.formatPrice(bar.low), Math.round(x), Math.round(f.y(bar.low)) + pad);
    }
  };
  return { painter, prices: (b) => [b.high, b.low, b.close] };
}
