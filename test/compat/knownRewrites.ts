/**
 * Values TradingView's own loader changes when it opens a layout, observed
 * with test/compat/restore-roundtrip.test.ts. Opening the original layout on
 * TradingView changes them the same way, so ChartKeeper does not cause them,
 * but users lose these settings either way.
 *
 * Each entry must match one difference exactly (layout, feature, path, both
 * values). Anything else TradingView changes fails the test. An entry
 * marked `always` that did not happen is reported as stale and fails it too.
 */
export interface KnownRewrite {
  layout: string;
  feature: string;
  path: string;
  expected: unknown;
  actual: unknown;
  why: string;
  /** False for rewrites that depend on timing, e.g. on whether symbol data arrived before the layout was read back. */
  always: boolean;
}

const RSI_PERIOD =
  'TradingView upgrades the built-in RSI@tv-basicstudies-280 to the Pine RSI and copies inputs by name: "length" lands in in_4 ("Length" of the smoothing average), not in_0 ("RSI Length"). The RSI period resets to 14. Layouts that already store the Pine RSI are not affected.';
const METRIC = 'TradingView fills the price series metric with its default "price" once the symbol data arrives, when the stored value is null. The chart looks the same.';

export const KNOWN_TRADINGVIEW_REWRITES: KnownRewrite[] = [
  { layout: 'AdvAll01', feature: 'RSI@tv-basicstudies-280 YuxZ0W', path: 'inputs.in_0', expected: 21, actual: 14, why: RSI_PERIOD, always: true },
  { layout: 'AdvAll01', feature: 'chart 1 (NASDAQ:AAPL, D)', path: 'series.metricId', expected: null, actual: 'price', why: METRIC, always: false },
  { layout: 'AdvTwo02', feature: 'chart 1 (NASDAQ:AAPL, D)', path: 'series.metricId', expected: null, actual: 'price', why: METRIC, always: false },
];
