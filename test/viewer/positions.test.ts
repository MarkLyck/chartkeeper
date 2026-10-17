import { describe, expect, it } from 'vitest';
import type { ParsedDrawing } from '../../src/core/layout';
import type { Bar } from '../../src/core/model';
import { anchoredVwap, VOLUME_KINDS, vwapSettings } from '../../src/renderer/viewer/drawings/volume';

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
