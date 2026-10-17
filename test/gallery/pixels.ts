/**
 * Pixel measures for comparing the viewer with TradingView's own captures.
 * Pure functions on RGBA buffers, so they run in the browser page of
 * scripts/gallery-compare.ts and in unit tests alike.
 */

export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 1 where a pixel belongs to the thing being measured. */
export type Mask = Uint8Array;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rgb = [number, number, number];

const inside = (x: number, y: number, r: Rect) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

function maskWhere(w: number, h: number, ignore: readonly Rect[], clip: Rect | null, test: (i: number) => boolean): Mask {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (clip && !inside(x, y, clip)) continue;
      if (ignore.some((r) => inside(x, y, r))) continue;
      const i = y * w + x;
      if (test(i * 4)) out[i] = 1;
    }
  }
  return out;
}

/** Pixels whose colour differs between `a` and `b` (same size) by more than `threshold` in some channel. */
export function diffMask(a: Img, b: Img, threshold: number, ignore: readonly Rect[] = [], clip: Rect | null = null): Mask {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`diffMask: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const pa = a.data;
  const pb = b.data;
  return maskWhere(a.width, a.height, ignore, clip, (i) => Math.abs(pa[i]! - pb[i]!) > threshold || Math.abs(pa[i + 1]! - pb[i + 1]!) > threshold || Math.abs(pa[i + 2]! - pb[i + 2]!) > threshold);
}

/** Pixels that differ from a plain background colour: candles, lines, text. */
export function foregroundMask(img: Img, background: Rgb, threshold: number, ignore: readonly Rect[] = [], clip: Rect | null = null): Mask {
  const p = img.data;
  return maskWhere(img.width, img.height, ignore, clip, (i) => Math.abs(p[i]! - background[0]) > threshold || Math.abs(p[i + 1]! - background[1]) > threshold || Math.abs(p[i + 2]! - background[2]) > threshold);
}

/** Grows a mask by `r` pixels in every direction (a square neighbourhood). */
export function dilate(mask: Mask, w: number, h: number, r: number): Mask {
  if (r <= 0) return mask.slice();
  // Separable: any set pixel within r along the row, then along the column, using running prefix sums.
  const pass = (src: Mask, len: number, lines: number, at: (line: number, k: number) => number): Mask => {
    const out = new Uint8Array(w * h);
    const prefix = new Int32Array(len + 1);
    for (let line = 0; line < lines; line++) {
      for (let k = 0; k < len; k++) prefix[k + 1] = prefix[k]! + src[at(line, k)]!;
      for (let k = 0; k < len; k++) if (prefix[Math.min(len, k + r + 1)]! - prefix[Math.max(0, k - r)]! > 0) out[at(line, k)] = 1;
    }
    return out;
  };
  const rows = pass(mask, w, h, (y, x) => y * w + x);
  return pass(rows, h, w, (x, y) => y * w + x);
}

export const count = (m: Mask): number => {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i]!;
  return n;
};

export interface Overlap {
  /** Share of the viewer's pixels within `tolerance` px of TradingView's. */
  precision: number;
  /** Share of TradingView's pixels within `tolerance` px of the viewer's. */
  recall: number;
  /** Harmonic mean of precision and recall; 1 when both masks agree within the tolerance. */
  f1: number;
  tvPixels: number;
  viewerPixels: number;
}

/**
 * Tolerance-aware overlap of TradingView's mask `tv` and the viewer's mask
 * `viewer`. A pixel of one side counts as matched when the other side has a
 * mask pixel within `tolerance` px whose colour is within `maxColor` (RGB
 * distance) of it. Two empty masks agree.
 */
export function overlap(tvImg: Img, tv: Mask, viewerImg: Img, viewer: Mask, tolerance: number, maxColor: number): Overlap {
  const { width: w, height: h } = tvImg;
  const tvPixels = count(tv);
  const viewerPixels = count(viewer);
  if (tvPixels === 0 && viewerPixels === 0) return { precision: 1, recall: 1, f1: 1, tvPixels, viewerPixels };
  const max2 = maxColor * maxColor;
  const matched = (from: Img, fromMask: Mask, to: Img, toMask: Mask): number => {
    const a = from.data;
    const b = to.data;
    let hits = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!fromMask[i]) continue;
        const r = a[i * 4]!;
        const g = a[i * 4 + 1]!;
        const bl = a[i * 4 + 2]!;
        search: for (let yy = Math.max(0, y - tolerance); yy <= Math.min(h - 1, y + tolerance); yy++) {
          for (let xx = Math.max(0, x - tolerance); xx <= Math.min(w - 1, x + tolerance); xx++) {
            const j = yy * w + xx;
            if (!toMask[j]) continue;
            const dr = b[j * 4]! - r;
            const dg = b[j * 4 + 1]! - g;
            const db = b[j * 4 + 2]! - bl;
            if (dr * dr + dg * dg + db * db <= max2) {
              hits++;
              break search;
            }
          }
        }
      }
    }
    return hits;
  };
  const precision = viewerPixels ? matched(viewerImg, viewer, tvImg, tv) / viewerPixels : 0;
  const recall = tvPixels ? matched(tvImg, tv, viewerImg, viewer) / tvPixels : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, tvPixels, viewerPixels };
}

export interface Shape {
  pixels: number;
  bbox: Rect | null;
  centroid: { x: number; y: number } | null;
}

export function shape(m: Mask, w: number, h: number): Shape {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      n++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (!n) return { pixels: 0, bbox: null, centroid: null };
  return { pixels: n, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, centroid: { x: sx / n, y: sy / n } };
}

/** Largest distance between matching edges of two boxes. */
export function bboxDistance(a: Rect | null, b: Rect | null): number | null {
  if (!a || !b) return null;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - (b.x + b.w)), Math.abs(a.y + a.h - (b.y + b.h)));
}

/**
 * The most common colour under a mask, from a 32-level-per-channel histogram,
 * averaged within the winning bin. Null for an empty mask.
 */
export function dominantColor(img: Img, m: Mask): Rgb | null {
  const bins = new Map<number, [number, number, number, number]>();
  const p = img.data;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const r = p[i * 4]!;
    const g = p[i * 4 + 1]!;
    const b = p[i * 4 + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = bins.get(key);
    if (bin) {
      bin[0]++;
      bin[1] += r;
      bin[2] += g;
      bin[3] += b;
    } else bins.set(key, [1, r, g, b]);
  }
  let best: [number, number, number, number] | null = null;
  for (const bin of bins.values()) if (!best || bin[0] > best[0]) best = bin;
  return best ? [best[1] / best[0], best[2] / best[0], best[3] / best[0]] : null;
}

export const colorDistance = (a: Rgb | null, b: Rgb | null): number | null => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : null);

/**
 * A greyed copy of `base` with TradingView-only pixels in red, viewer-only
 * pixels in blue and pixels both drew in dark violet.
 */
export function overlayImage(base: Img, tv: Mask, viewer: Mask): Img {
  const out = new Uint8ClampedArray(base.width * base.height * 4);
  const p = base.data;
  for (let i = 0; i < base.width * base.height; i++) {
    const grey = 215 + ((p[i * 4]! + p[i * 4 + 1]! + p[i * 4 + 2]!) / 3) * 0.15;
    const t = tv[i];
    const v = viewer[i];
    const [r, g, b] = t && v ? [90, 30, 130] : t ? [230, 40, 40] : v ? [30, 100, 240] : [grey, grey, grey];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return { width: base.width, height: base.height, data: out };
}

export function parseColor(css: string): Rgb {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(css.trim());
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(css);
  if (rgb) {
    const [r, g, b] = rgb[1]!.split(',').map((s) => Number(s.trim()));
    return [r ?? 0, g ?? 0, b ?? 0];
  }
  return [255, 255, 255];
}

const isEventsPurple = (r: number, g: number, b: number) => b > 150 && b - g > 70 && r > 80 && r < 200 && g < 130;

/**
 * TradingView's chart-events button: a purple 25x21 px icon centred on the
 * last bar at the bottom of the main pane. Returns the densest purple
 * `size`-wide window inside `strip`, grown by a few pixels, or null.
 */
export function findEventsButton(img: Img, strip: Rect, size = 30): Rect | null {
  const cols = new Int32Array(img.width);
  const y0 = Math.max(0, strip.y);
  const y1 = Math.min(img.height, strip.y + strip.h);
  for (let y = y0; y < y1; y++) {
    for (let x = Math.max(0, strip.x); x < Math.min(img.width, strip.x + strip.w); x++) {
      const i = (y * img.width + x) * 4;
      if (isEventsPurple(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!)) cols[x]!++;
    }
  }
  let best = 0;
  let bestX = -1;
  let run = 0;
  for (let x = 0; x < img.width; x++) {
    run += cols[x]! - (x >= size ? cols[x - size]! : 0);
    if (run > best) {
      best = run;
      bestX = x - size + 1;
    }
  }
  return best >= 20 ? { x: bestX - 3, y: y1 - 50, w: size + 6, h: 50 } : null;
}

/**
 * TradingView highlights one legend button (about 20x18 px at y 7-24, right
 * of the title) in some captures with a drawing shown, but not in the
 * drawing-free capture. Finds a window of changed pixels in those rows that
 * has no changes directly above or below it (a drawing crossing the legend
 * row would continue vertically). `changed` is a diff mask of the two images.
 */
export function findLegendHighlight(changed: Mask, w: number, top = 6, bottom = 25, size = 22): Rect | null {
  const inRows = new Int32Array(w);
  const outside = new Int32Array(w);
  for (let y = 0; y <= bottom + 6; y++) {
    for (let x = 0; x < w; x++) {
      if (!changed[y * w + x]) continue;
      if (y >= top && y <= bottom) inRows[x]!++;
      else outside[x]!++;
    }
  }
  for (let x0 = 0; x0 + size <= w; x0++) {
    let n = 0;
    let out = 0;
    for (let x = x0; x < x0 + size; x++) {
      n += inRows[x]!;
      out += outside[x]!;
    }
    if (n >= 120 && out === 0 && inRows[x0] === 0 && inRows[x0 + size - 1] === 0) return { x: x0, y: top, w: size, h: bottom - top + 1 };
  }
  return null;
}
