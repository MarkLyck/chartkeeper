import { describe, expect, it } from 'vitest';
import type { TvContent } from '../../src/core/tv/content';
import type { ExpectedLayout } from '../compat/advancedAccount';
import { checkContent, subsetDifferences } from '../compat/features';
import { KNOWN_TRADINGVIEW_REWRITES } from '../compat/knownRewrites';
import { classify } from '../compat/report';

const line = { type: 'LineToolTrendLine', id: 'd1', state: { linecolor: '#123456', levels: { a: { color: '#abcdef' } } }, points: [{ time_t: 100, offset: 0, price: 1 }], zorder: -5 };
const rsi = { type: 'Study', id: 's1', metaInfo: 'Script$STD;RSI@tv-scripting-101[v.47.0]', state: { inputs: { in_0: 21 }, styles: { plot_0: { color: '#ff0000' } } } };
const series = { type: 'MainSeries', id: '_seriesId', state: { symbol: 'NASDAQ:AAPL', interval: 'D', style: 1 } };

const expected: ExpectedLayout = {
  uid: 'L1',
  name: 'L',
  arrangement: 's',
  settings: {},
  charts: [{ chartId: '1', timezone: 'Etc/UTC', chartProperties: {}, timeScale: {}, series: series.state, priceScale: {} }],
  drawings: [{ id: 'd1', type: line.type, storedIn: 'storage:1', chart: 0, pane: 0, source: line }],
  studies: [{ id: 's1', chart: 0, pane: 1, metaInfo: rsi.metaInfo, inputs: rsi.state.inputs, styles: rsi.state.styles }],
};
const content = (panes: unknown[][]): TvContent => ({ layout: 's', charts: [{ chartId: '1', timezone: 'Etc/UTC', chartProperties: {}, timeScale: {}, panes: panes.map((sources) => ({ sources, rightAxisesState: [{ state: {} }] })) }] }) as TvContent;
const failing = (c: TvContent) => classify({ stage: 'tradingview', layout: 'L1', checks: checkContent(expected, c, 'tradingview') }).filter((r) => r.verdict === 'FAIL').map((r) => [r.feature, r.unexplained.map((d) => d.path)]);

describe('compat feature check', () => {
  it('allows defaults TradingView adds but reports changed and missing values by path', () => {
    expect(subsetDifferences({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'x', extra: true }, more: 2 })).toEqual([]);
    expect(subsetDifferences({ a: 1, b: { c: 'x', d: 2 } }, { a: 1, b: { c: 'y' } })).toEqual([
      { path: 'b.c', expected: 'x', actual: 'y' },
      { path: 'b.d', expected: 2, actual: undefined },
    ]);
    expect(subsetDifferences({ p: [1, 2] }, { p: [1] })).toEqual([{ path: 'p', expected: [1, 2], actual: [1] }]);
  });

  it('passes a layout that kept everything, even with Pine versions bumped', () => {
    const bumped = { ...rsi, metaInfo: 'Script$STD;RSI@tv-scripting-101[v.48.0]' };
    expect(failing(content([[series, line], [bumped]]))).toEqual([]);
  });

  it('fails a drawing that lost a nested style, moved pane, or is missing', () => {
    const recolored = { ...line, state: { ...line.state, levels: { a: { color: '#000000' } } } };
    expect(failing(content([[series, recolored], [rsi]]))).toEqual([['LineToolTrendLine d1 (storage:1)', ['state.levels.a.color']]]);
    expect(failing(content([[series], [rsi, line]]))).toEqual([['LineToolTrendLine d1 (storage:1)', ['location']]]);
    expect(failing(content([[series], [rsi]]))).toEqual([['LineToolTrendLine d1 (storage:1)', ['']]]);
  });

  it('fails a layout where a drawing appears twice or an unknown one appears', () => {
    expect(failing(content([[series, line, line], [rsi]]))).toEqual([['layout "L"', ['unexpectedDrawings']]]);
  });

  it('fails an indicator whose input changed', () => {
    const changed = { ...rsi, state: { ...rsi.state, inputs: { in_0: 14 } } };
    expect(failing(content([[series, line], [changed]]))).toEqual([[`${rsi.metaInfo} s1`, ['inputs.in_0']]]);
  });

  it('accepts a known TradingView rewrite only with exactly the listed values, and only from TradingView', () => {
    const rewrite = KNOWN_TRADINGVIEW_REWRITES[0]!;
    const check = { layout: rewrite.layout, kind: 'study' as const, feature: rewrite.feature, differences: [{ path: rewrite.path, expected: rewrite.expected, actual: rewrite.actual }] };
    expect(classify({ stage: 'tradingview', layout: rewrite.layout, checks: [check] })[0]!.verdict).toBe('KNOWN');
    expect(classify({ stage: 'payload', layout: rewrite.layout, checks: [check] })[0]!.verdict).toBe('FAIL');
    const other = { ...check, differences: [{ ...check.differences[0]!, actual: 'something else' }] };
    expect(classify({ stage: 'tradingview', layout: rewrite.layout, checks: [other] })[0]!.verdict).toBe('FAIL');
  });
});
