import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Bar } from '../../src/core/model';
import { linearRegression, pitchforkGeometry, secondLine } from '../../src/renderer/viewer/drawings/channels';
import { extendToPane, formatSpan, lineStats, screenAngle } from '../../src/renderer/viewer/drawings/lines';

const INFO_LINE = {
  showPriceRange: true,
  showPercentPriceRange: true,
  showPipsPriceRange: true,
  showBarsRange: true,
  showDateTimeRange: true,
  showDistance: true,
  showAngle: true,
};

const at = (time: number, price: number) => ({ time, offset: 0, price });

describe('info line stats', () => {
  const formatPrice = (n: number) => n.toFixed(2);

  it('writes the price, bar, distance and angle rows TradingView shows on a daily chart', () => {
    const rows = lineStats(INFO_LINE, {
      from: at(1783690200, 322.4181),
      to: at(1786973400, 339.6616),
      bars: 26,
      a: { x: 0, y: 0 },
      b: { x: 150, y: -80 },
      priceStep: 0.01,
      formatPrice,
    });
    expect(rows).toEqual([
      { icon: 'price', text: '17.24 (5.35%), 1,724' },
      { icon: 'bars', text: '26 bars (38d), distance: 170 px' },
      { icon: 'angle', text: '28.07°' },
    ]);
  });

  it('spells an hourly span in days and hours', () => {
    const rows = lineStats(INFO_LINE, { from: at(1791477000, 368.04), to: at(1791826200, 379.68), bars: 15, a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, priceStep: 0.01, formatPrice });
    expect(rows.map((r) => r.text).slice(0, 2)).toEqual(['11.64 (3.16%), 1,164', '15 bars (4d 1h), distance: 1 px']);
  });

  it('shows nothing for a trend line whose stats are all switched off', () => {
    expect(lineStats({}, { from: at(0, 1), to: at(60, 2), bars: 1, a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, priceStep: 0.01, formatPrice })).toEqual([]);
  });

  it('formats spans and on-screen angles', () => {
    expect([formatSpan(3283200), formatSpan(349200), formatSpan(2700), formatSpan(0)]).toEqual(['38d', '4d 1h', '45m', '0m']);
    expect(screenAngle({ x: 0, y: 0 }, { x: 10, y: -10 })).toBeCloseTo(45);
    expect(screenAngle({ x: 0, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(-45);
  });
});

describe('extended lines', () => {
  const pane = { width: 100, height: 50 };

  it('stops at the pane edge on extended sides, so dashes start where the line enters', () => {
    expect(extendToPane({ x: 10, y: 10 }, { x: 20, y: 20 }, true, true, pane)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 50 },
    ]);
  });

  it('keeps the drawn points on sides that are not extended', () => {
    expect(extendToPane({ x: 10, y: 10 }, { x: 20, y: 20 }, false, true, pane)).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 50 },
    ]);
  });
});

describe('flat top/bottom and disjoint channel', () => {
  const [p0, p1, p2] = [at(100, 298.27), at(200, 309.76), at(100, 292.52)];

  it('levels the flat line at point 3', () => {
    expect(secondLine('flat', p0, p1, p2).map((p) => [p.time, p.price])).toEqual([
      [100, 292.52],
      [200, 292.52],
    ]);
  });

  it('mirrors the first line from point 3 under point 2', () => {
    const [q0, q1] = secondLine('disjoint', p0, p1, p2);
    expect([q0.time, q1.time]).toEqual([100, 200]);
    expect(q0.price).toBeCloseTo(304.01);
    expect(q1.price).toBe(292.52);
  });
});

describe('regression trend', () => {
  it('fits a least-squares line with the sample deviation and Pearson R', () => {
    const fit = linearRegression([2, 4, 3, 5])!;
    expect(fit.start).toBeCloseTo(2.3);
    expect(fit.end).toBeCloseTo(4.7);
    expect(fit.deviation).toBeCloseTo(Math.sqrt(0.6));
    expect(fit.pearson).toBeCloseTo(0.8);
  });

  it('reproduces the line and Pearson R TradingView computed for the gallery drawing', () => {
    const file = path.join(__dirname, '../fixtures/gallery/drawings-channels/layouts/drawings-channels/data/chart-1.json');
    const bars = (JSON.parse(readFileSync(file, 'utf8')) as { bars: Bar[] }).bars;
    const times = bars.map((b) => b[0]);
    const closes = bars.slice(times.indexOf(1780579800), times.indexOf(1785245400) + 1).map((b) => b[4]);
    const fit = linearRegression(closes)!;
    expect(fit.start).toBeCloseTo(286.0643100995731, 9);
    expect(fit.end).toBeCloseTo(330.30650071123773, 9);
    expect(fit.pearson).toBeCloseTo(0.7728688874585027, 12);
  });

  it('needs two bars', () => {
    expect(linearRegression([1])).toBeNull();
  });
});

describe('pitchfork variants', () => {
  const p0 = { x: 0, y: 100 };
  const p1 = { x: 100, y: 0 };
  const p2 = { x: 100, y: 100 };
  const handle = [p1, p2];

  it('runs the original median from point 1 through the middle of the handle', () => {
    expect(pitchforkGeometry('original', p0, p1, p2)).toEqual({ medianStart: p0, direction: { x: 100, y: -50 }, center: { x: 100, y: 50 }, guides: [handle] });
  });

  it('starts the Schiff median half way up leg 1-2, under point 1', () => {
    const g = pitchforkGeometry('schiff', p0, p1, p2);
    expect(g.medianStart).toEqual({ x: 0, y: 50 });
    expect(g.direction).toEqual({ x: 100, y: 0 });
    expect(g.guides).toEqual([[p0, p1], handle]);
  });

  it('starts the modified Schiff median at the middle of leg 1-2', () => {
    const g = pitchforkGeometry('modifiedSchiff', p0, p1, p2);
    expect(g.medianStart).toEqual({ x: 50, y: 50 });
    expect(g.direction).toEqual({ x: 50, y: 0 });
  });

  it('runs the inside pitchfork from the handle, parallel to leg-middle -> point 3', () => {
    const g = pitchforkGeometry('inside', p0, p1, p2);
    expect(g.medianStart).toEqual({ x: 100, y: 50 });
    expect(g.direction).toEqual({ x: 50, y: 50 });
    expect(g.guides).toEqual([[p0, p1], [{ x: 50, y: 50 }, p2], handle]);
  });
});
