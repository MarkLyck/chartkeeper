import { describe, expect, it } from 'vitest';
import {
  fibChannelLine,
  fibExtensionLevels,
  fibLabelText,
  fibRetracementLevels,
  formatCoeff,
  LEVEL_LAYOUT,
  parseFibLevels,
  tvDash,
  tvFill,
} from '../../src/renderer/viewer/drawings/fib';

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

  it('uses TradingView dash patterns', () => {
    expect(tvDash(0, 2)).toEqual([]);
    expect(tvDash(1, 2)).toEqual([2, 6]);
    expect(tvDash(2, 2)).toEqual([10, 12]);
    expect(tvDash(3, 1)).toEqual([6, 6]);
  });
});
