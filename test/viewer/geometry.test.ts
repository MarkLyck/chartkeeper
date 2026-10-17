import { describe, expect, it } from 'vitest';
import type { Bar } from '../../src/core/model';
import { arrangementGrid } from '../../src/renderer/viewer/arrangement';
import { dashPattern, fillColor, lwcLineStyle, withTransparency } from '../../src/renderer/viewer/colors';
import { fibExtensionLevels, fibRetracementLevels, parseFibLevels } from '../../src/renderer/viewer/drawings/fib';
import { heikinAshi } from '../../src/renderer/viewer/series';
import { intervalLabel } from '../../src/renderer/viewer/strings';
import { TimeIndex } from '../../src/renderer/viewer/time';

describe('colours', () => {
  it('turns TradingView transparency (0-100) into alpha', () => {
    expect(withTransparency('#F23645', 80)).toBe('rgba(242, 54, 69, 0.2)');
    expect(withTransparency('#26a69a', 0)).toBe('rgba(38, 166, 154, 1)');
    expect(withTransparency('rgba(76,175,80,0.5)', 50)).toBe('rgba(76, 175, 80, 0.25)');
    expect(withTransparency('#abc', 100)).toBe('rgba(170, 187, 204, 0)');
  });

  it('keeps the alpha of drawing backgrounds that already carry one', () => {
    expect(fillColor('rgba(156,39,176,0.2)', 50)).toBe('rgba(156, 39, 176, 0.2)');
    expect(fillColor('#9c27b0', 50)).toBe('rgba(156, 39, 176, 0.5)');
  });

  it('maps TradingView line styles to lightweight-charts and canvas dashes', () => {
    expect([0, 1, 2, 3, 4].map(lwcLineStyle)).toEqual([0, 1, 2, 3, 4]);
    expect(lwcLineStyle(7)).toBe(0);
    expect(lwcLineStyle(undefined)).toBe(0);
    expect(dashPattern(0, 2)).toEqual([]);
    expect(dashPattern(2, 2)).toEqual([10, 12]);
    expect(dashPattern(1, 1)).toEqual([1, 3]);
    expect(dashPattern(3, 1)).toEqual([6, 6]);
  });
});

describe('fib levels', () => {
  const props = {
    level1: [0, '#808080', true, ''],
    level2: [0.236, '#F23645', true, ''],
    level3: [0.5, '#4caf50', true, ''],
    level4: [1, '#808080', true, ''],
    level5: [1.618, '#2962FF', false, ''],
  };

  it('puts 0 at the second point and 1 at the first point', () => {
    const levels = fibRetracementLevels(props, 250, 340);
    expect(levels.map((l) => [l.coeff, +l.price.toFixed(2), l.visible])).toEqual([
      [0, 340, true],
      [0.236, 318.76, true],
      [0.5, 295, true],
      [1, 250, true],
      [1.618, 194.38, false],
    ]);
  });

  it('swaps the direction when reversed', () => {
    const levels = fibRetracementLevels({ ...props, reverse: true }, 250, 340);
    expect(levels.map((l) => +l.price.toFixed(2))).toEqual([250, 271.24, 295, 340, 395.62]);
  });

  it('reads the older object level format', () => {
    expect(parseFibLevels({ level1: { coeff: 0.382, color: '#FF9800', visible: false } })).toEqual([{ coeff: 0.382, color: '#FF9800', visible: false, text: '' }]);
  });

  it('projects a trend-based extension from the third point', () => {
    const levels = fibExtensionLevels({ level1: [1, '#000', true], level2: [1.618, '#000', true] }, 100, 150, 120);
    expect(levels.map((l) => +l.price.toFixed(2))).toEqual([170, 200.9]);
  });
});

describe('Heikin Ashi', () => {
  it('averages each bar with the previous Heikin Ashi bar', () => {
    const bars: Bar[] = [
      [1, 10, 14, 8, 12, 0],
      [2, 12, 16, 11, 15, 0],
    ];
    const [a, b] = heikinAshi(bars);
    expect(a).toEqual({ open: 11, close: 11, high: 14, low: 8 });
    expect(b).toEqual({ open: 11, close: 13.5, high: 16, low: 11 });
  });
});

describe('arrangement', () => {
  it('maps TradingView layout codes to grids', () => {
    expect(arrangementGrid('s', 1)).toMatchObject({ columns: 1, rows: 1 });
    expect(arrangementGrid('2h', 2)).toMatchObject({ columns: 2, rows: 1 });
    expect(arrangementGrid('2v', 2)).toMatchObject({ columns: 1, rows: 2 });
    expect(arrangementGrid('3s', 3).cells[0]).toEqual({ col: 0, row: 0, colSpan: 1, rowSpan: 2 });
    expect(arrangementGrid('2-1', 3).cells[2]).toEqual({ col: 0, row: 1, colSpan: 2, rowSpan: 1 });
    expect(arrangementGrid('4', 4)).toMatchObject({ columns: 2, rows: 2 });
  });

  it('falls back to an even grid for unknown codes or a chart count that does not fit', () => {
    expect(arrangementGrid('10c5', 5)).toMatchObject({ columns: 3, rows: 2 });
    expect(arrangementGrid('2h', 3)).toMatchObject({ columns: 2, rows: 2 });
    expect(arrangementGrid('s', 3).cells).toHaveLength(3);
  });
});

describe('time index', () => {
  const DAY = 86400;
  // Daily bars open at 13:30 UTC, Monday 2026-09-07 to Friday 2026-09-18.
  const mon = Date.UTC(2026, 8, 7, 13, 30) / 1000;
  const times = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((d) => mon + d * DAY);
  const index = new TimeIndex(times, 'D');

  it('places a point on the last bar that opened at or before it', () => {
    expect(index.indexOf(mon)).toBe(0);
    expect(index.indexOf(Date.UTC(2026, 8, 15) / 1000)).toBe(5); // Tue 00:00 is still Monday's bar
    expect(index.indexOf(Date.UTC(2026, 8, 13) / 1000)).toBe(4); // Sunday -> Friday
  });

  it('counts trading days for points after the last bar and adds the bar offset', () => {
    const lastFriday = times[9]!;
    expect(index.indexOf(lastFriday + 3 * DAY)).toBe(10); // next Monday
    expect(index.indexOf(lastFriday + 7 * DAY)).toBe(14); // next Friday
    expect(index.logical({ time: lastFriday, offset: 3 })).toBe(12);
  });

  it('counts back before the first bar', () => {
    expect(index.indexOf(mon - 3 * DAY)).toBe(-1); // the Friday before
  });

  it('uses plain intervals for intraday charts', () => {
    const hourly = new TimeIndex([0, 3600, 7200], '60');
    expect(hourly.indexOf(5000)).toBe(1);
    expect(hourly.indexOf(7200 + 5 * 3600)).toBe(7);
  });

  it('counts only session bars past the last intraday bar, rounding up to the next bar', () => {
    // Hourly bars 13:30-19:30 UTC on Thursday 17 and Friday 18 September 2026.
    const thu = Date.UTC(2026, 8, 17) / 1000;
    const slots = [13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5].map((h) => h * 3600);
    const times = [thu, thu + DAY].flatMap((d) => slots.map((s) => d + s));
    const index = new TimeIndex(times, '60');
    const last = times.length - 1;
    const monday = thu + 4 * DAY;
    expect(index.indexOf(monday + 10.5 * 3600)).toBe(last + 1); // before Monday's open: Monday's first bar
    expect(index.indexOf(monday + 14.5 * 3600)).toBe(last + 2);
    expect(index.indexOf(monday + 15 * 3600)).toBe(last + 3); // between bars: the next one
  });

  it('labels intervals like the chart header', () => {
    expect(['D', '1D', '60', '240', '15', '1W', '3M', '30S'].map(intervalLabel)).toEqual(['1D', '1D', '1h', '4h', '15m', '1W', '3M', '30s']);
  });
});
