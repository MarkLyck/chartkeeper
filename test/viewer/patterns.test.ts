import { describe, expect, it } from 'vitest';
import { cyclePositions, sinePoints, timeCycleStarts } from '../../src/renderer/viewer/drawings/cycles';
import { elliottLabel } from '../../src/renderer/viewer/drawings/elliott';
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

describe('Elliott wave labels', () => {
  const impulse = (degree: number, i = 1) => elliottLabel('LineToolElliottImpulse', degree, i);
  const text = (degree: number, type = 'LineToolElliottImpulse', i = 1) => {
    const l = elliottLabel(type, degree, i)!;
    return l.circled ? `circled ${l.text}` : l.text;
  };

  it('labels each degree the way TradingView does', () => {
    const byDegree = Array.from({ length: 15 }, (_, degree) => text(degree));
    expect(byDegree).toEqual([
      'circled 1', // Supermillennium
      '(1)',
      '1',
      'circled I', // Grand supercycle
      '(I)',
      'I',
      'circled 1', // Primary
      '(1)', // Intermediate
      '1', // Minor
      'circled i', // Minute
      '(i)',
      'i', // Subminuette
      'circled 1', // Micro
      '(1)',
      '1', // Minuscule
    ]);
  });

  it('uses letters for corrective waves, lower case on alternate label sets', () => {
    expect(text(7, 'LineToolElliottCorrection', 3)).toBe('(C)');
    expect(text(10, 'LineToolElliottCorrection', 2)).toBe('(b)');
    expect(text(7, 'LineToolElliottTripleCombo', 5)).toBe('(Z)');
    expect(text(5, 'LineToolElliottTriangle', 4)).toBe('d');
    expect(text(7, 'LineToolElliottDoubleCombo', 2)).toBe('(X)');
  });

  it('sizes labels by label set and has nothing past the last wave', () => {
    expect(impulse(7)).toMatchObject({ font: 18, circle: 22, bold: false });
    expect(impulse(0)).toMatchObject({ font: 24, circle: 36, bold: true });
    expect(impulse(14)).toMatchObject({ font: 11, bold: true });
    expect(elliottLabel('LineToolElliottCorrection', 7, 4)).toBeNull();
  });
});

describe('cycles', () => {
  it('repeats cyclic lines every period from the first point to the visible edge', () => {
    expect(cyclePositions(10, 5, 0, 30)).toEqual([10, 15, 20, 25, 30]);
    expect(cyclePositions(10, -4, 0, 30)).toEqual([10, 6, 2]);
    expect(cyclePositions(10, 0, 0, 30)).toEqual([]);
  });

  it('starts time-cycle arcs every period on both sides of the points', () => {
    expect(timeCycleStarts(10, 5, 0, 30)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(timeCycleStarts(10, 5, 3, 12)).toEqual([0, 5, 10]);
  });

  it('runs the sine line through both points, half a period apart, from the left edge', () => {
    const a = { x: 130, y: 100 };
    const b = { x: 180, y: 20 };
    const pts = sinePoints(a, b, 400);
    const at = (x: number) => pts.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best)).y;
    expect(pts[0]).toEqual({ x: -70, y: 100 });
    expect(at(130)).toBeCloseTo(100, 0);
    expect(at(180)).toBeCloseTo(20, 0);
    expect(at(230)).toBeCloseTo(100, 0);
    expect(pts.at(-1)!.x).toBeGreaterThanOrEqual(400);
  });
});
