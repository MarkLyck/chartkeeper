import type { UpDown } from './boxes';
import type { Painter, StyleBar, StyleView } from './view';

/** One Kagi bar: a vertical line from open to close that may change colour at `switchAt`. */
export interface KagiBar extends StyleBar {
  /** Yang (up colour) at the open. */
  startYang: boolean;
  /** Yang at the close; the horizontal line to the next bar has this colour. */
  endYang: boolean;
  /** Price where the line crosses the previous shoulder (going up) or waist (going down) and changes colour. */
  switchAt: number | null;
}

/**
 * Kagi colours: the line turns yang when it rises above the previous
 * shoulder (the top of the last rising line) and yin when it falls below the
 * previous waist (the bottom of the last falling line).
 */
export function kagiBars<T extends { open: number; close: number }>(bars: readonly T[]): (T & Omit<KagiBar, keyof StyleBar>)[] {
  let yang = bars.length > 0 && bars[0]!.close >= bars[0]!.open;
  return bars.map((bar, i) => {
    const rising = bar.close >= bar.open;
    const before = bars[i - 2];
    const startYang = yang;
    let switchAt: number | null = null;
    if (before) {
      if (rising && !yang && bar.close > before.close) switchAt = before.close;
      if (!rising && yang && bar.close < before.close) switchAt = before.close;
    }
    if (switchAt !== null) yang = rising;
    return { ...bar, startYang, endYang: yang, switchAt };
  });
}

/** Kagi (style 5): vertical lines joined by horizontal ones, three pixels wide, coloured yang or yin. */
export function kagiStyle(colors: UpDown): StyleView<KagiBar> {
  const painter: Painter<KagiBar> = (f) => {
    const { ctx } = f;
    const width = Math.max(1, Math.round(3 * f.hpr));
    const half = Math.floor(width / 2);
    const color = (yang: boolean) => (yang ? colors.up : colors.down);
    const vertical = (x: number, from: number, to: number, yang: boolean) => {
      const a = Math.round(f.y(from));
      const b = Math.round(f.y(to));
      ctx.fillStyle = color(yang);
      ctx.fillRect(x - half, Math.min(a, b) - half, width, Math.abs(b - a) + width);
    };
    f.bars.forEach(({ x: cx, bar }, i) => {
      const x = Math.round(cx);
      if (bar.switchAt === null) vertical(x, bar.open, bar.close, bar.startYang);
      else {
        vertical(x, bar.open, bar.switchAt, bar.startYang);
        vertical(x, bar.switchAt, bar.close, bar.endYang);
      }
      const next = f.bars[i + 1];
      if (!next) return;
      const y = Math.round(f.y(bar.close));
      ctx.fillStyle = color(bar.endYang);
      ctx.fillRect(x - half, y - half, Math.round(next.x) - x + width, width);
    });
  };
  return { painter, prices: (b) => [b.open, b.close] };
}
