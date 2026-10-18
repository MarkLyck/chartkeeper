import { describe, expect, it } from 'vitest';
import {
  fibChannelLine,
  fibExtensionLevels,
  fibLabelText,
  fibRetracementLevels,
  formatCoeff,
  LEVEL_LAYOUT,
  logLevels,
  parseFibLevels,
  tvFill,
} from '../../src/renderer/viewer/drawings/fib';
import { fibCircleRadii, fibSpiralPoints, fibSpiralRadius, fibTimeBars, timeZoneLevels } from '../../src/renderer/viewer/drawings/fibTime';
import { gannArcRadius, gannBoxLevels, gannFanTarget, gannFixedCorner } from '../../src/renderer/viewer/drawings/gann';

// Level sets as TradingView saved them in the gallery's drawings-fibs scene.
const retracementProps = {
  level1: [0, '#808080', true, ''],
  level2: [0.618, '#089981', true, ''],
  level3: [1, '#808080', true, ''],
  level4: [1.272, '#FF9800', false, ''],
};
const extensionProps = {
  level1: [0, '#808080', true, null, null, ''],
  level2: [0.618, '#089981', true, null, null, 'golden'],
  level3: [1, '#808080', true, null, null, ''],
};

describe('fib retracement', () => {
  it('spaces levels in log prices only for "levels based on log scale" on a log scale, at the prices TradingView labels (log-scale-tools scene)', () => {
    const props = { ...retracementProps, level5: [0.236, '#000', true, ''], level6: [0.5, '#000', true, ''], level7: [0.786, '#000', true, ''], fibLevelsBasedOnLogScale: true };
    const price = (log: boolean, coeff: number) => fibRetracementLevels(props, 330, 1117, LEVEL_LAYOUT.retracement, logLevels(props, log)).find((l) => l.coeff === coeff)!.price.toFixed(2);
    expect([0.236, 0.5, 0.618, 0.786].map((c) => price(true, c))).toEqual(['837.69', '607.13', '525.77', '428.39']);
    expect(price(false, 0.5)).toBe('723.50');
    expect(logLevels({ fibLevelsBasedOnLogScale: false }, true)).toBe(false);
  });

  it('puts 0.618 where TradingView labels it (319.44 for the drawings-fibs retracement)', () => {
    const levels = fibRetracementLevels(retracementProps, 309.5573, 335.4226);
    expect(levels.find((l) => l.coeff === 0.618)!.price.toFixed(2)).toBe('319.44');
    expect(levels.find((l) => l.coeff === 0)!.price).toBeCloseTo(335.4226);
    expect(levels.find((l) => l.coeff === 1)!.price).toBeCloseTo(309.5573);
  });

  it('keeps level index order and hidden levels', () => {
    expect(fibRetracementLevels(retracementProps, 0, 100).map((l) => [l.coeff, l.visible])).toEqual([
      [0, true],
      [0.618, true],
      [1, true],
      [1.272, false],
    ]);
  });
});

describe('trend-based fib extension', () => {
  it('projects the first move from the third point', () => {
    const levels = fibExtensionLevels(extensionProps, 311.7127, 339.7334, 320.3345, LEVEL_LAYOUT.extension);
    expect(levels.map((l) => l.price.toFixed(2))).toEqual(['320.33', '337.65', '348.36']);
  });

  it('reads the level text from the sixth slot of the saved array', () => {
    expect(parseFibLevels(extensionProps, LEVEL_LAYOUT.extension).map((l) => l.text)).toEqual(['', 'golden', '']);
  });

  it('runs the other way when reversed', () => {
    const levels = fibExtensionLevels({ ...extensionProps, reverse: true }, 100, 150, 120, LEVEL_LAYOUT.extension);
    expect(levels.map((l) => l.price)).toEqual([120, 120 - 50 * 0.618, 70]);
  });
});

describe('fib level labels', () => {
  it('shows coefficient and price the way TradingView does', () => {
    expect(fibLabelText({}, 0.618, '283.35')).toBe('0.618 (283.35)');
    expect(fibLabelText({ showPrices: false }, 1, '283.35')).toBe('1');
    expect(fibLabelText({ showCoeffs: false }, 1, '283.35')).toBe(' (283.35)');
    expect(fibLabelText({ showCoeffs: false, showPrices: false }, 1, '283.35')).toBe('');
  });

  it('writes percentages with two to four decimals', () => {
    expect(formatCoeff(0.618, true)).toBe('61.80%');
    expect(formatCoeff(0, true)).toBe('0.00%');
    expect(formatCoeff(4.236, true)).toBe('423.60%');
    expect(formatCoeff(0.12345, true)).toBe('12.345%');
    expect(formatCoeff(0.236)).toBe('0.236');
  });
});

describe('fib channel', () => {
  it('moves line 1-2 by multiples of the vector from point 1 to point 3', () => {
    const a = { x: 0, y: 100 };
    const b = { x: 200, y: 50 };
    const c = { x: 10, y: 60 };
    expect(fibChannelLine(a, b, c, 0)).toEqual([a, b]);
    expect(fibChannelLine(a, b, c, 1)).toEqual([
      { x: 10, y: 60 },
      { x: 210, y: 10 },
    ]);
    expect(fibChannelLine(a, b, c, 0.5)).toEqual([
      { x: 5, y: 80 },
      { x: 205, y: 30 },
    ]);
  });
});

describe('TradingView drawing primitives', () => {
  it('replaces the colour alpha with the fill transparency', () => {
    expect(tvFill('#2962FF', 85)).toBe('rgba(41, 98, 255, 0.15)');
    expect(tvFill('rgba(21, 56, 153, 0.8)', 80)).toBe('rgba(21, 56, 153, 0.2)');
  });
});

describe('fib time tools', () => {
  const zoneLevels = [0, 1, 2, 3, 5, 8, 13, 21].map((coeff) => ({ coeff }));

  it('puts fib time zones at whole-bar Fibonacci multiples of the point distance', () => {
    expect(fibTimeBars(zoneLevels, 100, 6)).toEqual([100, 106, 112, 118, 130, 148, 178, 226]);
    expect(fibTimeBars([{ coeff: 0.382 }, { coeff: 1.618 }], 50, 10)).toEqual([54, 66]);
  });

  it('copies version 1 time zone colours, width and style into the levels', () => {
    const props = { level1: [0, '#808080', true, 0, 2], level2: [1, '#2962FF', true, 0, 2], baselinecolor: '#111111', linecolor: '#222222', linewidth: 1, linestyle: 1 };
    expect(timeZoneLevels(props, 1).map((l) => [l.color, l.width, l.style])).toEqual([
      ['#111111', 1, 1],
      ['#222222', 1, 1],
    ]);
    expect(timeZoneLevels(props, 2).map((l) => [l.color, l.width, l.style])).toEqual([
      ['#808080', 2, 0],
      ['#2962FF', 2, 0],
    ]);
  });

  it('inscribes fib circle 1 in the box of the two points', () => {
    expect(fibCircleRadii({ x: 0, y: 0 }, { x: 40, y: 20 }, 1)).toEqual({ rx: 20, ry: 10 });
    expect(fibCircleRadii({ x: 0, y: 0 }, { x: 40, y: 20 }, 2.618)).toEqual({ rx: 52.36, ry: 26.18 });
  });

  it('grows the fib spiral by Fibonacci numbers and passes through point 2 after one turn', () => {
    expect([0, 1, 2, 3, 4, 5].map(fibSpiralRadius)).toEqual([0, 1, 2, 3, 5, 8]);
    const a = { x: 100, y: 100 };
    const b = { x: 130, y: 60 };
    const through = fibSpiralPoints(a, b, false)[201]!;
    expect(through.x).toBeCloseTo(b.x);
    expect(through.y).toBeCloseTo(b.y);
  });
});

describe('Gann tools', () => {
  const p1 = { bar: 10, price: 309.5573 };
  const p2 = { bar: 107, price: 335.4226 };

  it('grids the Gann box from point 1, snapping time levels to whole bars', () => {
    const at = gannBoxLevels({}, p1, p2);
    expect(at.price(0)).toBe(309.5573);
    expect(at.price(0.5).toFixed(2)).toBe('322.49');
    expect([0, 0.25, 0.382, 0.5, 1].map(at.bar)).toEqual([10, 34, 47, 59, 107]);
  });

  it('starts the Gann box grid at point 2 when reversed', () => {
    const at = gannBoxLevels({ reverse: true }, p1, p2);
    expect(at.price(0)).toBe(335.4226);
    expect(at.bar(0.25)).toBe(83);
  });

  it('makes Gann square fixed five point-distances wide toward point 2', () => {
    expect(gannFixedCorner({ x: 100, y: 200 }, { x: 103, y: 196 })).toEqual({ x: 125, y: 175 });
    expect(gannFixedCorner({ x: 100, y: 200 }, { x: 100, y: 210 })).toEqual({ x: 150, y: 250 });
  });

  it('sizes Gann arcs by their grid point', () => {
    expect(gannArcRadius(-250, 1, 0)).toBe(50);
    expect(gannArcRadius(250, 3, 4)).toBe(250);
  });

  it('aims Gann fan rays at the box edges by ratio', () => {
    const a = { x: 0, y: 100 };
    const b = { x: 80, y: 20 };
    expect(gannFanTarget(a, b, 1, 1)).toEqual(b);
    expect(gannFanTarget(a, b, 1, 8)).toEqual({ x: 10, y: 20 });
    expect(gannFanTarget(a, b, 8, 1)).toEqual({ x: 80, y: 90 });
  });
});
