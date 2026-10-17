import type { UpDown } from './boxes';
import type { Painter, StyleBar, StyleView } from './view';

const EPS = 1e-6;

/** Largest step that divides every value, for values that are whole multiples of one step (up to float noise). */
function commonStep(values: readonly number[]): number {
  const gcd = (a: number, b: number): number => (b < EPS * Math.max(1, a) ? a : gcd(b, a % b));
  return values.filter((v) => v > EPS).reduce((g, v) => (g === 0 ? v : gcd(Math.max(g, v), Math.min(g, v))), 0);
}

/**
 * Box size of Point & Figure bars. TradingView sizes ATR and percentage boxes
 * on its servers and only says "ATR" in the layout, but every column spans a
 * whole number of boxes, so the box is the largest step that divides them all.
 */
export function pnfBoxSize(bars: readonly { high: number; low: number }[], inputs: { style?: unknown; boxSize?: unknown }): number {
  if (inputs.style === 'Traditional' && typeof inputs.boxSize === 'number' && inputs.boxSize > 0) return inputs.boxSize;
  const step = commonStep(bars.map((b) => Math.round((b.high - b.low) * 1e6) / 1e6));
  return step > 0 ? step : typeof inputs.boxSize === 'number' ? inputs.boxSize : 1;
}

/** The box prices of one column: every box level from its low to its high. */
export function pnfBoxes(bar: { high: number; low: number }, boxSize: number): number[] {
  const n = Math.round((bar.high - bar.low) / boxSize);
  return Array.from({ length: n + 1 }, (_, k) => bar.low + k * boxSize);
}

/** Point & Figure (style 6): a column of X boxes for each rise and O boxes for each fall. */
export function pnfStyle(colors: UpDown, boxSize: number): StyleView<StyleBar> {
  const painter: Painter<StyleBar> = (f) => {
    const { ctx } = f;
    const boxHeight = Math.abs(f.y(0) - f.y(boxSize));
    ctx.lineWidth = 1.5 * f.hpr;
    for (const { x, bar } of f.bars) {
      const up = bar.close >= bar.open;
      ctx.beginPath();
      for (const level of pnfBoxes(bar, boxSize)) {
        const y = f.y(level);
        if (up) {
          const w = f.barSpacing / 2;
          ctx.moveTo(x - w, y - boxHeight / 2);
          ctx.lineTo(x + w, y + boxHeight / 2);
          ctx.moveTo(x + w, y - boxHeight / 2);
          ctx.lineTo(x - w, y + boxHeight / 2);
        } else {
          const rx = f.barSpacing * 0.43;
          ctx.moveTo(x + rx, y);
          ctx.ellipse(x, y, rx, boxHeight / 2, 0, 0, 2 * Math.PI);
        }
      }
      ctx.strokeStyle = up ? colors.up : colors.down;
      ctx.stroke();
    }
  };
  return { painter, prices: (b) => [b.high, b.low, b.close] };
}
