import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ParsedChart } from '../../src/core/layout';
import type { Bar, ChartData } from '../../src/core/model';
import { SnapshotReader } from '../../src/core/snapshot';
import { openLayout } from '../../src/core/snapshotView';
import { edgeMargin, tvPriceAxisWidth } from '../../src/renderer/viewer/axis';
import { planChart } from '../../src/renderer/viewer/plan';
import { guessPriceFormat, heikinAshi, mainSeriesSpec, type MainSeriesSpec } from '../../src/renderer/viewer/series';
import { candleWidth } from '../../src/renderer/viewer/styles/boxes';
import { kagiBars } from '../../src/renderer/viewer/styles/kagi';
import { baselineY, stepPoints } from '../../src/renderer/viewer/styles/lines';
import { pnfBoxes, pnfBoxSize } from '../../src/renderer/viewer/styles/pnf';

/** A gallery scene: TradingView's own layout and the bars it drew, computed bars included. */
async function scene(name: string) {
  const { layout, data } = await openLayout(await SnapshotReader.open(path.join(__dirname, '../fixtures/gallery', name)), name);
  const chart = layout.charts[0]!;
  const chartData = data[chart.chartId] as ChartData;
  const bars = chartData.bars;
  return { layout, chart, data: chartData, bars, spec: (computed: 'stored' | 'none' = 'stored') => mainSeriesSpec(chart, bars, bars.map((b) => b[0]), computed === 'stored' ? chartData.computedStyle : undefined) };
}

const legendText = (main: MainSeriesSpec, i: number) => main.legend.fields.map((f) => `${f.label}${f.value(main.ohlc[i]!)}`).join(' ');
const ohlcBar = (open: number, close: number) => ({ open, close, high: Math.max(open, close), low: Math.min(open, close) });

describe('computed chart styles', () => {
  it('draws the bars TradingView computed for each computed style with that style, not as candles', async () => {
    for (const [name, style] of [
      ['style-renko', 4],
      ['style-kagi', 5],
      ['style-point-figure', 6],
      ['style-line-break', 7],
    ] as const) {
      const s = await scene(name);
      expect(s.data.computedStyle).toBe(style);
      const main = s.spec();
      expect(main.fallbackFrom, name).toBeNull();
      expect(main.spec.kind, name).toBe('Custom');
    }
  });

  it('falls back to candles and lists the chart type when an older backup has no computed bars', async () => {
    const s = await scene('style-renko');
    const main = s.spec('none');
    expect(main.fallbackFrom).toBe(4);
    expect(main.spec.kind).toBe('Candlestick');
    const plan = planChart(s.layout, s.chart, { ...s.data, computedStyle: undefined });
    expect(plan.notShown.find((n) => n.kind === 'chart')?.reason).toEqual({ code: 'chart-style', style: 4 });
    expect(planChart(s.layout, s.chart, s.data).notShown.some((n) => n.kind === 'chart')).toBe(false);
  });

  it('draws stored Heikin Ashi bars as they are, and computes them only when the backup has plain bars', async () => {
    const s = await scene('style-heikin-ashi');
    const stored = s.spec();
    expect(stored.ohlc.at(-1)).toEqual({ open: s.bars.at(-1)![1], high: s.bars.at(-1)![2], low: s.bars.at(-1)![3], close: s.bars.at(-1)![4] });
    const local = s.spec('none');
    expect(local.fallbackFrom).toBeNull();
    expect(local.ohlc).toEqual(heikinAshi(s.bars));
  });

  it("names computed styles in the legend as TradingView does, with the box size it computed", async () => {
    expect((await scene('style-renko')).spec().legend.styleName).toBe('Renko [ATR(14), 8]');
    expect((await scene('style-point-figure')).spec().legend.styleName).toBe('PnF [ATR(14), 8, 3]');
    expect((await scene('style-line-break')).spec().legend.styleName).toBe('Line Break [3]');
    expect((await scene('style-heikin-ashi')).spec().legend.styleName).toBe('');
  });

  it('shows two decimals for Heikin Ashi averages and float noise in Range bars', async () => {
    const ha = await scene('style-heikin-ashi');
    expect(guessPriceFormat(ha.bars, 8).precision).toBe(2);
    const range = await scene('style-range');
    expect(guessPriceFormat(range.bars, 11).precision).toBe(2);
  });
});

describe('legend values per style', () => {
  it('lists what TradingView lists: OHLC for candles, the close for lines, high and low for High-Low', async () => {
    const candles = (await scene('style-candles')).spec();
    expect(legendText(candles, candles.ohlc.length - 1)).toBe('O346.085 H347.82 L340.46 C343.46');
    const line = (await scene('style-line')).spec();
    expect(legendText(line, line.ohlc.length - 1)).toBe('343.46');
    const hilo = (await scene('style-high-low')).spec();
    expect(legendText(hilo, hilo.ohlc.length - 1)).toBe('H347.82 L340.46');
    expect(hilo.legend.change).toBeNull();
    const hlc = (await scene('style-hlc-area')).spec();
    expect(hlc.legend.fields.map((f) => f.color(0))).toEqual(['#00bcd4', '#e91e63', '#2962FF']);
  });

  it('colours HLC bars with their one colour, not the bar style', async () => {
    const main = (await scene('style-hlc-bars')).spec();
    expect(main.spec.kind).toBe('Bar');
    if (main.spec.kind !== 'Bar') return;
    expect([main.spec.options.upColor, main.spec.options.downColor, main.spec.options.openVisible]).toEqual(['#2962FF', '#2962FF', false]);
  });
});

describe('Kagi', () => {
  it('turns yang above the previous shoulder and yin below the previous waist', () => {
    // Up to 10, down to 6, up to 12 (above the 10 shoulder), down to 8, down move below the 6 waist.
    const bars = kagiBars([ohlcBar(5, 10), ohlcBar(10, 6), ohlcBar(6, 12), ohlcBar(12, 8), ohlcBar(8, 14), ohlcBar(14, 7)]);
    expect(bars.map((b) => [b.startYang, b.endYang, b.switchAt])).toEqual([
      [true, true, null],
      [true, true, null],
      [true, true, null],
      [true, true, null],
      [true, true, null],
      [true, false, 8],
    ]);
  });

  it('turns back to yang only when a rise passes the previous shoulder', () => {
    const bars = kagiBars([ohlcBar(10, 5), ohlcBar(5, 8), ohlcBar(8, 4), ohlcBar(4, 9)]);
    expect(bars.map((b) => [b.endYang, b.switchAt])).toEqual([
      [false, null],
      [false, null],
      [false, null],
      [true, 8],
    ]);
  });
});

describe('Point & Figure', () => {
  it('reads the ATR box size from the columns TradingView computed', async () => {
    const s = await scene('style-point-figure');
    const bars = s.bars.map(([, open, high, low, close]) => ({ open, high, low, close }));
    expect(pnfBoxSize(bars, { style: 'ATR', boxSize: 1 })).toBe(8);
    expect(pnfBoxSize(bars, { style: 'Traditional', boxSize: 2 })).toBe(2);
  });

  it('draws one box per box level of a column, both ends included', () => {
    expect(pnfBoxes({ high: 168, low: 152 }, 8)).toEqual([152, 160, 168]);
    expect(pnfBoxes({ high: 176, low: 0 }, 8)).toHaveLength(23);
  });
});

describe('line geometry', () => {
  it('steps halfway between bars, holding each close across its bar', () => {
    expect(stepPoints([{ x: 10, y: 5 }, { x: 20, y: 7 }], 10)).toEqual([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 7 },
      { x: 25, y: 7 },
    ]);
  });

  it('puts the baseline at its share of the pane height, counted from the bottom', () => {
    expect(baselineY(572, 50)).toBe(286);
    expect(baselineY(572, 25)).toBe(429);
  });

  it("sizes High-Low boxes like TradingView's candles", () => {
    expect(candleWidth(7.076, 1)).toBe(5);
    expect(candleWidth(3, 1)).toBe(3);
  });
});

describe('price axis width', () => {
  it("matches TradingView's axis: even, the widest label plus TradingView's paddings", () => {
    // 40.8 px is "360.49" in the viewer's font; TradingView's axis for it is 60 px wide.
    expect(tvPriceAxisWidth(['343.46', '360.49'], (t) => (t === '360.49' ? 40.8 : 39))).toBe(60);
    expect(tvPriceAxisWidth([], () => 0)).toBe(54);
  });

  it('measures the price 0.111 past the pane edges, finer for prices below 1', () => {
    expect(edgeMargin(358, 257)).toBeCloseTo(0.1111);
    expect(edgeMargin(0.05, 0.02)).toBeCloseTo(0.01111, 5);
  });
});

it('keeps plain daily bars unchanged for the plain styles', async () => {
  const s = await scene('style-bars');
  const last: Bar = s.bars.at(-1)!;
  expect(s.spec().ohlc.at(-1)).toEqual({ open: last[1], high: last[2], low: last[3], close: last[4] });
  expect(s.spec().spec.kind).toBe('Bar');
  expect((s.chart as ParsedChart).style).toBe(0);
});
