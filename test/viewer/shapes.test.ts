import { describe, expect, it } from 'vitest';
import type { Pt } from '../../src/renderer/viewer/drawings/canvas';
import { arrowWings, smoothBrush } from '../../src/renderer/viewer/drawings/freehand';
import { arcPoints, curveControls, doubleCurveControls, ellipseAxes, extendQuad, rectangleTextLayout, rotatedRectCorners } from '../../src/renderer/viewer/drawings/shapes';

const round = (pts: Pt[]) => pts.map((p) => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3) }));
const quadAt = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => ({
  x: (1 - t) ** 2 * p0.x + 2 * t * (1 - t) * c.x + t * t * p1.x,
  y: (1 - t) ** 2 * p0.y + 2 * t * (1 - t) * c.y + t * t * p1.y,
});

describe('rotated rectangle', () => {
  it('centres the rectangle on side a-b with c setting the half-width, whichever side c is on', () => {
    const above = rotatedRectCorners({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 30 });
    const below = rotatedRectCorners({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -30 });
    expect(round(above)).toEqual([
      { x: 0, y: -30 },
      { x: 100, y: -30 },
      { x: 100, y: 30 },
      { x: 0, y: 30 },
    ]);
    expect(round(below)).toEqual(round(above));
  });

  it('turns with a tilted side', () => {
    expect(round(rotatedRectCorners({ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 15 + 8, y: 20 - 6 }))).toEqual([
      { x: 8, y: -6 },
      { x: 38, y: 34 },
      { x: 22, y: 46 },
      { x: -8, y: 6 },
    ]);
  });
});

describe('arc', () => {
  const a = { x: 0, y: 100 };
  const b = { x: 200, y: 100 };

  it('runs from a to b and peaks at the chord midpoint, as far out as c, on the side of c', () => {
    for (const c of [{ x: 100, y: 40 }, { x: 30, y: 160 }]) {
      const pts = arcPoints(a, b, c, 64);
      expect(round([pts[0]!, pts[32]!, pts[64]!])).toEqual([a, { x: 100, y: c.y }, b]);
      for (const p of pts) expect(Math.abs(p.y - 100)).toBeLessThanOrEqual(Math.abs(c.y - 100) + 1e-9);
    }
  });

  it('is a stretched 60 degree circle slice, flatter than an ellipse at its ends', () => {
    const pts = arcPoints(a, b, { x: 100, y: 40 }, 4);
    expect(+pts[1]!.x.toFixed(3)).toBe(+(200 * (0.5 + Math.cos((-2 * Math.PI) / 3 + Math.PI / 12))).toFixed(3));
  });

  it('collapses to the chord when c lies on it', () => {
    expect(arcPoints(a, b, { x: 50, y: 100.5 })).toEqual([a, b]);
  });
});

describe('curves', () => {
  it('passes the curve through its middle point with a tangent parallel to start-end', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 20 };
    const middle = { x: 50, y: -40 };
    const [c1, c2] = curveControls(start, end, middle);
    expect([c1, c2]).toEqual([
      { x: 25, y: -45 },
      { x: 75, y: -35 },
    ]);
    expect(quadAt(start, c1, middle, 1)).toEqual(middle);
    expect((c2.y - c1.y) / (c2.x - c1.x)).toBeCloseTo((end.y - start.y) / (end.x - start.x));
  });

  it('joins the double curve smoothly at both inner points', () => {
    const [c1, c2, c3, c4] = doubleCurveControls({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 100, y: -50 }, { x: 200, y: 50 });
    expect([c1, c2, c3, c4]).toEqual([
      { x: 50, y: -62.5 },
      { x: 150, y: -37.5 },
      { x: 150, y: 37.5 },
      { x: 250, y: 62.5 },
    ]);
  });

  it('extends a piece past its end along the same parabola until it leaves the pane', () => {
    const p0 = { x: 0, y: 0 };
    const c = { x: 50, y: -50 };
    const p1 = { x: 100, y: 0 };
    const pane = { width: 300, height: 200 };
    const line = extendQuad(p0, c, p1, pane);
    expect(line[0]).toEqual(p1);
    const last = line[line.length - 1]!;
    expect(last.y).toBeGreaterThan(pane.height + pane.width + pane.height);
    const t = 1 + (line.length - 1) * (3 / (Math.hypot(50, 50) * 2));
    expect(last.x).toBeCloseTo(quadAt(p0, c, p1, t).x, 6);
  });
});

describe('brush smoothing', () => {
  it('keeps a straight stroke straight and ends at the last drawn point', () => {
    const pts = smoothBrush(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 120, y: 0 },
      ],
      5,
    );
    for (const p of pts) expect(p.y).toBe(0);
    expect(pts[pts.length - 1]).toEqual({ x: 120, y: 0 });
  });

  it('adds TradingView in-between points and rounds the corners', () => {
    const pts = smoothBrush(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      5,
    );
    expect(pts).toHaveLength(12);
    expect(pts[0]).toEqual({ x: 12, y: 0 });
    const corner = pts[5]!;
    expect(corner.x).toBeLessThan(100);
    expect(corner.y).toBeGreaterThan(0);
  });

  it('leaves short strokes with no in-between points', () => {
    expect(smoothBrush([{ x: 0, y: 0 }, { x: 4, y: 0 }], 5)).toEqual([
      { x: 1.6, y: 0 },
      { x: 2.4, y: 0 },
      { x: 4, y: 0 },
    ]);
  });
});

describe('line-end arrows', () => {
  it('draws 45 degree wings five line widths back from the tip', () => {
    expect(arrowWings({ x: 0, y: 0 }, { x: 100, y: 0 }, 2)).toEqual([
      { x: 90, y: 10 },
      { x: 90, y: -10 },
    ]);
    expect(arrowWings({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 2)).toBeNull();
  });
});

describe('rectangle text', () => {
  const box = { x: 100, y: 50, w: 200, h: 80 };

  it('centres middle text inside, padded by a third of the font size', () => {
    expect(rectangleTextLayout({ fontSize: 15 }, box)).toEqual({ x: 200, y: 90, align: 'center', baseline: 'middle', wrap: 190 });
    expect(rectangleTextLayout({ fontSize: 15, horzLabelsAlign: 'left' }, box).x).toBe(105);
    expect(rectangleTextLayout({ fontSize: 15, horzLabelsAlign: 'right' }, box).x).toBe(295);
  });

  it('hangs "top" text below the box and stands "bottom" text above it, flush with the side', () => {
    expect(rectangleTextLayout({ fontSize: 15, vertLabelsAlign: 'top', horzLabelsAlign: 'left' }, box)).toEqual({ x: 100, y: 135, align: 'left', baseline: 'top', wrap: null });
    expect(rectangleTextLayout({ fontSize: 15, vertLabelsAlign: 'bottom' }, box)).toMatchObject({ y: 45, baseline: 'bottom' });
  });
});

describe('ellipse', () => {
  it('reads a two-point (version 1) ellipse as the corners of its bounding box', () => {
    expect(ellipseAxes([{ x: 0, y: 0 }, { x: 100, y: 60 }])).toEqual([
      { x: 0, y: 30 },
      { x: 100, y: 30 },
      { x: 0, y: 0 },
    ]);
  });
});
