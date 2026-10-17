import { describe, expect, it } from 'vitest';
import type { ParsedStudy, PlotDef } from '../../src/core/layout';
import { alignRows, hasPineGraphics, legendInputs, planStudyRender } from '../../src/renderer/viewer/studies';

function study(over: { plots: PlotDef[]; styles?: Record<string, Record<string, unknown>>; state?: Record<string, unknown>; meta?: Record<string, unknown> }): ParsedStudy {
  const state = { styles: over.styles ?? {}, ...over.state };
  return {
    id: 'st1',
    metaInfoId: 'Test@tv-basicstudies-1',
    name: 'Test',
    shortName: 'Test',
    isPine: false,
    isPriceStudy: false,
    visible: true,
    inputs: {},
    styles: over.styles ?? {},
    plots: over.plots,
    state,
    metaInfo: { plots: over.plots, ...over.meta },
  };
}

const times = [100, 200, 300, 400];

describe('alignRows', () => {
  it('aligns rows to bar times, dropping rows without a bar and treating sentinels as gaps', () => {
    const rows = [
      [50, 1, 1],
      [100, 10, null],
      [200, 1e100, 2],
      [400, 40, 4],
    ];
    expect(alignRows(rows, 2, times)).toEqual([
      [10, null, null, 40],
      [null, 2, null, 4],
    ]);
  });
});

describe('planStudyRender', () => {
  it('colours Volume bars from the palette, with the plot transparency applied', () => {
    const s = study({
      plots: [
        { id: 'vol', type: 'line' },
        { id: 'vol_color', type: 'colorer', target: 'vol' },
        { id: 'vol_ma', type: 'line' },
      ],
      meta: {
        plots: [
          { id: 'vol', type: 'line' },
          { id: 'vol_color', type: 'colorer', target: 'vol', palette: 'volumePalette' },
          { id: 'vol_ma', type: 'line' },
        ],
      },
      styles: {
        vol: { plottype: 5, color: '#2962ff', transparency: 50, display: 4294967295 },
        vol_ma: { plottype: 0, display: 0, visible: false },
      },
      state: { palettes: { volumePalette: { colors: { 0: { color: '#26a69a' }, 1: { color: '#ef5350' } } } } },
    });
    const r = planStudyRender(s, [[100, 1000, 0, 5], [200, 2000, 1, 6]], times, times);
    expect(r.series.map((p) => p.plotId)).toEqual(['vol']);
    expect(r.series[0]!.spec.kind).toBe('Histogram');
    expect(r.series[0]!.spec.data.slice(0, 3)).toEqual([
      { time: 100, value: 1000, color: 'rgba(38, 166, 154, 0.5)' },
      { time: 200, value: 2000, color: 'rgba(239, 83, 80, 0.5)' },
      { time: 300 },
    ]);
  });

  it('maps Pine colorer values through valToIndex', () => {
    const s = study({
      plots: [
        { id: 'plot_0', type: 'line' },
        { id: 'plot_1', type: 'colorer', target: 'plot_0' },
      ],
      meta: { plots: [{ id: 'plot_0', type: 'line' }, { id: 'plot_1', type: 'colorer', target: 'plot_0', palette: 'p' }], palettes: { p: { valToIndex: { 2: 1, 3: 0 } } } },
      styles: { plot_0: { color: '#000000' } },
      state: { palettes: { p: { colors: { 0: { color: '#00ff00' }, 1: { color: '#ff0000' } } } } },
    });
    const r = planStudyRender(s, [[100, 1, 3], [200, 2, 2]], times, times);
    expect(r.series[0]!.spec.data.slice(0, 2)).toEqual([
      { time: 100, value: 1, color: 'rgba(0, 255, 0, 1)' },
      { time: 200, value: 2, color: 'rgba(255, 0, 0, 1)' },
    ]);
  });

  it('bridges gaps in plain lines and keeps them in line-with-breaks plots', () => {
    const s = study({
      plots: [
        { id: 'a', type: 'line' },
        { id: 'b', type: 'line' },
      ],
      styles: { a: { plottype: 0 }, b: { plottype: 7 } },
    });
    const r = planStudyRender(s, [[100, 1, 1], [300, 3, 3]], times, times);
    expect(r.series[0]!.spec.data).toEqual([{ time: 100, value: 1 }, { time: 300, value: 3 }]);
    expect(r.series[1]!.spec.data).toEqual([{ time: 100, value: 1 }, { time: 200 }, { time: 300, value: 3 }, { time: 400 }]);
  });

  it('lists visible plots it cannot draw and skips hidden ones and alert conditions', () => {
    const s = study({
      plots: [
        { id: 'plot_0', type: 'line' },
        { id: 'plot_8', type: 'shapes' },
        { id: 'plot_9', type: 'shapes' },
        { id: 'plot_12', type: 'alertcondition' },
      ],
      styles: { plot_0: {}, plot_8: { display: 1 }, plot_9: { display: 0 } },
    });
    expect(planStudyRender(s, [], times, times).unsupported).toEqual(['plot_8']);
  });

  it('draws bands, the band background and fills between plots or bands', () => {
    const s = study({
      plots: [
        { id: 'plot_0', type: 'line' },
        { id: 'plot_1', type: 'line' },
      ],
      styles: { plot_0: {}, plot_1: { display: 0 } },
      meta: {
        bands: [{ id: 'hline_0' }, { id: 'hline_1' }],
        filledAreas: [
          { id: 'fill_0', type: 'hline_hline', objAId: 'hline_0', objBId: 'hline_1' },
          { id: 'fill_1', type: 'plot_plot', objAId: 'plot_0', objBId: 'plot_1' },
          { id: 'fill_2', type: 'plot_plot', objAId: 'plot_0', objBId: 'plot_1' },
        ],
      },
      state: {
        bands: [
          { color: '#c0c0c0', linestyle: 2, linewidth: 1, value: 70, visible: true },
          { color: '#c0c0c0', linestyle: 2, linewidth: 1, value: 30, visible: true },
        ],
        bandsBackground: { backgroundColor: '#9915ff', fillBackground: true, transparency: 90 },
        filledAreasStyle: { fill_0: { color: '#9915ff', transparency: 90 }, fill_1: { fillType: 'gradient', topColor: 'red', bottomColor: 'blue', topValue: 100, bottomValue: 70 }, fill_2: { visible: false } },
      },
    });
    const r = planStudyRender(s, [[100, 75, 70]], times, times);
    expect(r.series.map((p) => p.plotId)).toEqual(['plot_0']);
    expect(r.bands).toEqual([
      { price: 70, color: '#c0c0c0', lineStyle: 2, lineWidth: 1 },
      { price: 30, color: '#c0c0c0', lineStyle: 2, lineWidth: 1 },
    ]);
    expect(r.fills).toEqual([
      { kind: 'between-prices', top: 70, bottom: 30, color: 'rgba(153, 21, 255, 0.1)' },
      { kind: 'between-prices', top: 70, bottom: 30, color: 'rgba(153, 21, 255, 0.1)' },
      { kind: 'between-plots', a: [75, null, null, null], b: [70, null, null, null], paint: { gradient: { topColor: 'red', bottomColor: 'blue', topValue: 100, bottomValue: 70 } } },
    ]);
  });
});

describe('hasPineGraphics', () => {
  it('ignores the empty graphics TradingView sends for every study', () => {
    expect(hasPineGraphics({ d: '', indexes: [] })).toBe(false);
    expect(hasPineGraphics(undefined)).toBe(false);
    expect(hasPineGraphics({})).toBe(false);
  });

  it('detects labels, boxes and tables', () => {
    expect(hasPineGraphics({ d: JSON.stringify({ graphicsCmds: { create: { labels: [{ id: 1 }] } } }), indexes: [] })).toBe(true);
    expect(hasPineGraphics({ dwglabels: { 1: { t: 'x' } } })).toBe(true);
  });
});

describe('legendInputs', () => {
  const withInputs = (metaInfoId: string, inputs: Record<string, unknown>, metaInputs: Record<string, unknown>[], styles: Record<string, Record<string, unknown>> = {}): ParsedStudy => ({
    ...study({ plots: [], styles, meta: { inputs: metaInputs } }),
    metaInfoId,
    inputs,
  });

  it('lists inputs in the order of the indicator definition, as TradingView does ("Stoch RSI 3 3 14 14 close")', () => {
    const s = withInputs('StochasticRSI@tv-basicstudies-280', { D: 3, K: 3, 'RSI Length': 14, 'RSI Source': 'close', 'Stochastic Length': 14 }, [
      { id: 'K', display: 15 },
      { id: 'D', display: 15 },
      { id: 'RSI Length', display: 15 },
      { id: 'Stochastic Length', display: 15 },
      { id: 'RSI Source', display: 15 },
    ]);
    expect(legendInputs(s)).toEqual(['3', '3', '14', '14', 'close']);
  });

  it('skips inputs hidden from the legend and shows option titles ("Pivots Traditional Auto 15")', () => {
    const s = withInputs('PivotPointsStandard@tv-basicstudies-280', { kind: 'Traditional', lookBack: 15, pivTimeFrame: 'Auto', showHistoricalPivots: true }, [
      { id: 'kind', display: 15, optionsTitles: { DeMark: 'DM' } },
      { id: 'showHistoricalPivots', display: 0 },
      { id: 'pivTimeFrame', display: 15 },
      { id: 'lookBack', display: 15 },
    ]);
    expect(legendInputs(s)).toEqual(['Traditional', 'Auto', '15']);
    expect(legendInputs({ ...s, inputs: { ...s.inputs, kind: 'DeMark' } })[0]).toBe('DM');
  });

  it("shows Volume's MA length only while the MA is drawn", () => {
    const meta = [
      { id: 'length', display: 15 },
      { id: 'col_prev_close', display: 0 },
    ];
    const inputs = { col_prev_close: false, length: 20 };
    expect(legendInputs(withInputs('Volume@tv-basicstudies-280', inputs, meta, { vol_ma: { display: 0, visible: false } }))).toEqual([]);
    expect(legendInputs(withInputs('Volume@tv-basicstudies-280', inputs, meta, { vol_ma: { display: 15, visible: true } }))).toEqual(['20']);
  });
});
