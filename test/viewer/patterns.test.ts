import { describe, expect, it } from 'vitest';
import { abcdLegs, cypherLegs, labelAbove, lineCrossSegment, trianglePatternShape, xabcdLegs } from '../../src/renderer/viewer/drawings/patterns';

const ratios = (legs: { ratio: number }[]) => legs.map((l) => l.ratio);

describe('pattern ratios', () => {
  // X A B C D from the drawings-patterns gallery scene; TradingView prints the commented numbers.
  const xabcd = [210.3062, 236.8838, 218.6117, 231.9005, 213.6284];

  it('prints AB/XA on X-B, BC/AB on A-C, CD/BC on B-D and AD/XA on X-D for XABCD', () => {
    expect(ratios(xabcdLegs(xabcd))).toEqual([0.687, 0.727, 1.375, 0.875]);
    expect(xabcdLegs(xabcd).map((l) => [l.from, l.to])).toEqual([
      [0, 2],
      [1, 3],
      [2, 4],
      [0, 4],
    ]);
  });

  it('measures C against XA and D against XC for the cypher', () => {
    expect(ratios(cypherLegs(xabcd))).toEqual([0.687, 0.812, 1.375, 0.846]);
  });

  it('prints BC/AB and CD/BC for ABCD', () => {
    expect(ratios(abcdLegs([211.9673, 236.8838, 220.2728, 238.5449]))).toEqual([0.667, 1.1]);
    expect(ratios(abcdLegs([382.151, 369.353, 377.885, 360.821]))).toEqual([0.667, 2]);
  });

  it('puts a point label above a point higher than the one before it', () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 10, y: 20 },
      { x: 20, y: 60 },
      { x: 30, y: 40 },
    ];
    expect(pts.map((_, i) => labelAbove(pts, i))).toEqual([false, true, false, true]);
  });
});

describe('pattern geometry', () => {
  it('closes the triangle pattern at the leftmost point and the apex', () => {
    const shape = trianglePatternShape([
      { x: 0, y: 0 },
      { x: 20, y: 95 },
      { x: 100, y: 25 },
      { x: 120, y: 70 },
    ]);
    expect(shape).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 200, y: 50 },
    ]);
  });

  it('cuts the triangle pattern at the rightmost point when the lines meet on the left', () => {
    const shape = trianglePatternShape([
      { x: 100, y: 40 },
      { x: 100, y: 60 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ]);
    expect(shape?.[0]).toEqual({ x: 200, y: 0 });
    expect(shape?.[1]).toEqual({ x: 200, y: 100 });
    expect(shape?.[2].x).toBeCloseTo(75);
    expect(shape?.[2].y).toBeCloseTo(50);
  });

  it('finds where the neckline crosses a shoulder leg, and nothing when it misses', () => {
    const t1 = { x: 100, y: 50 };
    const t2 = { x: 200, y: 50 };
    expect(lineCrossSegment(t1, t2, { x: 0, y: 100 }, { x: 50, y: 0 })).toEqual({ x: 25, y: 50 });
    expect(lineCrossSegment(t1, t2, { x: 0, y: 100 }, { x: 50, y: 60 })).toBeNull();
  });
});
