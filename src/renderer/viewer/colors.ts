import type { LineStyle } from 'lightweight-charts';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(color: string): Rgba | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(c)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((ch) => ch + ch).join('') : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    const byte = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(c)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
  }
  if (c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
export const rgbaCss = ({ r, g, b, a }: Rgba): string => `rgba(${r}, ${g}, ${b}, ${round(a)})`;

/** TradingView transparency is 0 (opaque) to 100 (invisible) and fades whatever alpha the colour already has. */
export function withTransparency(color: string, transparency: unknown): string {
  const t = typeof transparency === 'number' && Number.isFinite(transparency) ? Math.min(100, Math.max(0, transparency)) : 0;
  const parsed = parseColor(color);
  if (!parsed) return color;
  return rgbaCss({ ...parsed, a: parsed.a * (1 - t / 100) });
}

/**
 * Drawing backgrounds: newer TradingView drawings keep the alpha inside
 * backgroundColor and leave an old `transparency` value next to it, so the
 * transparency only applies to colours that are still fully opaque.
 */
export function fillColor(color: string, transparency: unknown): string {
  const parsed = parseColor(color);
  if (parsed && parsed.a < 1) return rgbaCss(parsed);
  return withTransparency(color, transparency);
}

/** Perceived brightness 0-255; unknown colours count as white. */
export function luminance(color: string): number {
  const c = parseColor(color);
  return c ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 255;
}

export const isDark = (color: string): boolean => luminance(color) < 128;

/** TradingView and lightweight-charts number their line styles the same way: 0 solid, 1 dotted, 2 dashed, 3 large dashed, 4 sparse dotted. */
export function lwcLineStyle(tvStyle: unknown): LineStyle {
  return (typeof tvStyle === 'number' && Number.isInteger(tvStyle) && tvStyle >= 0 && tvStyle <= 4 ? tvStyle : 0) as LineStyle;
}

/** Canvas dash pattern for a TradingView line style, measured from TradingView's own rendering. */
export function dashPattern(tvStyle: unknown, width: number): number[] {
  switch (lwcLineStyle(tvStyle)) {
    case 1:
      return [width, 2 * width];
    case 2:
      return [5 * width, 6 * width];
    case 3:
      return [8 * width, 6 * width];
    case 4:
      return [width, 4 * width];
    default:
      return [];
  }
}
