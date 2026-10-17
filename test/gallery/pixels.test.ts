import { describe, expect, it } from 'vitest';
import { count, diffMask, dilate, dominantColor, findEventsButton, foregroundMask, overlap, parseColor, shape, type Img } from './pixels';

function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number] = () => [255, 255, 255]): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

const maskOf = (w: number, h: number, on: (x: number, y: number) => boolean) => {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) m[y * w + x] = 1;
  return m;
};

describe('pixel measures', () => {
  it('parses six-digit hex before three-digit hex, and rgba()', () => {
    expect(parseColor('#FBFAF5')).toEqual([251, 250, 245]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgba(42, 46, 57, 0.06)')).toEqual([42, 46, 57]);
  });

  it('marks pixels that differ beyond the threshold, outside ignored rects', () => {
    const a = image(10, 10);
    const b = image(10, 10, (x, y) => (x === 2 && y === 3 ? [0, 0, 0] : x === 8 ? [250, 255, 255] : [255, 255, 255]));
    const m = diffMask(a, b, 6);
    expect(count(m)).toBe(1);
    expect(m[3 * 10 + 2]).toBe(1);
    expect(count(diffMask(a, b, 6, [{ x: 0, y: 0, w: 5, h: 5 }]))).toBe(0);
  });

  it('dilates by a square neighbourhood clipped to the image', () => {
    const m = maskOf(9, 9, (x, y) => x === 4 && y === 4);
    expect(count(dilate(m, 9, 9, 2))).toBe(25);
    expect(count(dilate(maskOf(9, 9, (x, y) => x === 0 && y === 0), 9, 9, 2))).toBe(9);
  });

  it('scores a shifted same-colour copy within tolerance as a match, a far or differently coloured copy as a miss', () => {
    const w = 60;
    const h = 20;
    const tv = maskOf(w, h, (x, y) => y === 10 && x >= 10 && x < 50);
    const near = maskOf(w, h, (x, y) => y === 12 && x >= 11 && x < 51);
    const far = maskOf(w, h, (x, y) => y === 2 && x >= 10 && x < 50);
    const blue = image(w, h, () => [0, 0, 255]);
    const red = image(w, h, () => [255, 0, 0]);
    expect(overlap(blue, tv, blue, near, 3, 90).f1).toBeCloseTo(1);
    expect(overlap(blue, tv, blue, far, 3, 90).f1).toBe(0);
    expect(overlap(blue, tv, red, near, 3, 90).f1).toBe(0);
    const half = maskOf(w, h, (x, y) => y === 10 && x >= 10 && x < 30);
    const s = overlap(blue, tv, blue, half, 0, 90);
    expect([s.precision, s.recall]).toEqual([1, 0.5]);
    expect(overlap(blue, new Uint8Array(w * h), blue, new Uint8Array(w * h), 3, 90).f1).toBe(1);
  });

  it('finds the bounding box, centroid and dominant colour of a mask', () => {
    const img = image(20, 20, (x) => (x < 5 ? [200, 0, 0] : [0, 0, 200]));
    const m = maskOf(20, 20, (x, y) => y >= 2 && y < 6 && x >= 2 && x < 10);
    expect(shape(m, 20, 20)).toEqual({ pixels: 32, bbox: { x: 2, y: 2, w: 8, h: 4 }, centroid: { x: 5.5, y: 3.5 } });
    expect(dominantColor(img, m)).toEqual([0, 0, 200]);
    expect(count(foregroundMask(img, [0, 0, 200], 40))).toBe(100);
  });

  it('locates the purple chart-events button inside the strip only', () => {
    const img = image(200, 60, (x, y) => ((x >= 150 && x < 175 && y >= 30 && y < 50) || (x < 20 && y < 10) ? [126, 87, 230] : [255, 255, 255]));
    const r = findEventsButton(img, { x: 0, y: 20, w: 200, h: 40 })!;
    expect(r.x).toBeLessThanOrEqual(150);
    expect(r.x + r.w).toBeGreaterThanOrEqual(175);
    expect(findEventsButton(image(200, 60), { x: 0, y: 20, w: 200, h: 40 })).toBeNull();
  });
});
