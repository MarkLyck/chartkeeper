import { describe, expect, it } from 'vitest';
import type { ParsedDrawing } from '../../src/core/layout';
import type { Bar } from '../../src/core/model';
import { anchoredVwap, storedProfile, VOLUME_KINDS, volumeProfile, vwapSettings } from '../../src/renderer/viewer/drawings/volume';

const bar = (t: number, h: number, l: number, c: number, v: number): Bar => [t, c, h, l, c, v];

describe('anchored VWAP', () => {
  const bars = [bar(0, 6, 2, 4, 5), bar(1, 12, 8, 10, 1), bar(2, 22, 18, 20, 3)];
  const props = { inputs: { 'Bands Calculation Mode': 'Standard Deviation', calculate_stDev: true, bands_multiplier: 1, calculate_stDev_2: true, bands_multiplier_2: 2, calculate_stDev_3: false, bands_multiplier_3: 3 } };

  it('weights hlc3 by volume from the anchor bar on, with standard deviation bands', () => {
    const [vwap, up1, lo1, up2, lo2, up3] = anchoredVwap(bars, 1, vwapSettings(props));
    expect(vwap).toEqual([null, 10, 17.5]);
    const sd = Math.sqrt((100 * 1 + 400 * 3) / 4 - 17.5 ** 2);
    expect(up1![2]).toBeCloseTo(17.5 + sd, 10);
    expect(lo1![2]).toBeCloseTo(17.5 - sd, 10);
    expect(up2![2]).toBeCloseTo(17.5 + 2 * sd, 10);
    expect(lo2![1]).toBe(10);
    expect(up3).toEqual([null, null, null]);
  });

  it('spaces bands by a percentage of the VWAP in percentage mode', () => {
    const [vwap, up1, lo1] = anchoredVwap(bars, 2, vwapSettings({ inputs: { ...props.inputs, 'Bands Calculation Mode': 'Percentage' } }));
    expect(vwap![2]).toBe(20);
    expect(up1![2]).toBeCloseTo(20.2, 10);
    expect(lo1![2]).toBeCloseTo(19.8, 10);
  });

  const drawing = { id: 'av', type: 'LineToolAnchoredVWAP', points: [{ time: 1, offset: 0, price: 10 }], props: { ...props, styles: { VWAP: { color: '#1e88e5' } } } } as unknown as ParsedDrawing;
  const labels = (drawingStudies = {}) => VOLUME_KINDS.LineToolAnchoredVWAP!.axisLabels!(drawing.props, drawing.points, { bars, priceStep: 0.01, drawingStudies }, drawing);

  it('labels the latest VWAP on the price scale', () => {
    expect(labels()).toEqual([{ axis: 'price', price: 17.5, color: '#1e88e5' }]);
  });

  it("prefers TradingView's stored values over the local calculation", () => {
    const stored = { av: { status: 'ok', metaInfoId: 'AnchoredVWAP@tv-basicstudies-280', rows: [[1, 10, 11, 9, null, null, null, null], [2, 17.6, 20, 15, null, null, null, null]] } };
    expect(labels(stored)).toEqual([{ axis: 'price', price: 17.6, color: '#1e88e5' }]);
  });
});

describe('fixed range volume profile', () => {
  // An up bar spanning 0-4 spreads 10 per row; a flat down bar at 2 puts all 30 in the 2-3 row.
  const bars = [bar(0, 4, 0, 3, 40), [1, 2, 2, 2, 1, 30] as Bar, bar(2, 100, 90, 95, 1000)];
  const settings = { rows: 4, ticksPerRow: false, priceStep: 1, valueArea: 70 };

  it('spreads each bar over the rows its range covers and splits up from down volume', () => {
    const profile = volumeProfile(bars, 0, 1, settings)!;
    expect(profile.rows.map((r) => [r.low, r.high, r.up, r.down])).toEqual([
      [0, 1, 10, 0],
      [1, 2, 10, 0],
      [2, 3, 10, 30],
      [3, 4, 10, 0],
    ]);
    expect(profile.poc).toBe(2.5);
  });

  it('grows the value area from the POC one row at a time, upward on ties, while it stays within the share', () => {
    const inVa = (valueArea: number) => volumeProfile(bars, 0, 1, { ...settings, valueArea })!.rows.map((r) => r.inValueArea);
    expect(inVa(70)).toEqual([false, false, true, false]);
    expect(inVa(80)).toEqual([false, false, true, true]);
    expect(inVa(100)).toEqual([true, true, true, true]);
  });

  it('sizes rows in ticks in "Ticks Per Row" layout', () => {
    expect(volumeProfile(bars, 0, 1, { ...settings, rows: 3, ticksPerRow: true })!.rows.map((r) => [r.low, r.high])).toEqual([
      [0, 3],
      [3, 6],
    ]);
  });

  it("reads TradingView's stored histogram rows and POC", () => {
    const d = JSON.stringify({
      graphicsCmds: {
        create: {
          hhists: [
            { styleId: 'histBars2', data: [{ id: 1, firstBarTime: 0, lastBarTime: 1, rate: [5, 1], priceLow: 10, priceHigh: 11 }] },
            { styleId: 'histBarsVA', data: [{ id: 2, firstBarTime: 0, lastBarTime: 1, rate: [7, 9], priceLow: 9, priceHigh: 10 }] },
          ],
          horizlines: [{ styleId: 'pocLines', data: [{ id: 3, startIndex: 0, endIndex: 1, level: 9.5 }] }],
        },
      },
    });
    expect(storedProfile({ status: 'ok', metaInfoId: 'VbPFixed@tv-basicstudies-280', rows: [], graphics: { d, indexes: [100, 120] } })).toEqual({
      rows: [
        { low: 9, high: 10, up: 7, down: 9, inValueArea: true },
        { low: 10, high: 11, up: 5, down: 1, inValueArea: false },
      ],
      poc: 9.5,
    });
  });
});
