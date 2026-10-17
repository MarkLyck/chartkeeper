import type { IChartApi } from 'lightweight-charts';

/**
 * TradingView sizes its price axis for the widest of its labels: the last
 * values and the prices just past the top and bottom of each pane. Its
 * paddings add up to 17 px; the captures measure 2 px more than our canvas
 * measures their text, so 19 matches them. The width is always even.
 */
export function tvPriceAxisWidth(texts: readonly string[], measure: (text: string) => number): number {
  const widest = Math.max(0, ...texts.map(measure));
  const px = Math.ceil(19 + (widest || 34));
  return px + (px % 2);
}

/** The price TradingView measures just past a pane edge: 0.111 beyond it, scaled down for prices below 1. */
export function edgeMargin(top: number, bottom: number): number {
  const digits = Math.max(0, -Math.log10(Math.max(Math.abs(top), Math.abs(bottom))));
  return 0.11111111111111 / 10 ** Math.floor(digits);
}

/** The labels TradingView sizes its right price axis for, from what lightweight-charts currently shows. */
export function priceAxisTexts(chart: IChartApi): string[] {
  return chart.panes().flatMap((pane) => {
    const series = pane.getSeries().filter((s) => s.options().priceScaleId === 'right' && s.options().visible);
    const first = series[0];
    if (!first) return [];
    const texts = series.flatMap((s) => {
      const last = s.lastValueData(true);
      return last && !last.noData && s.options().lastValueVisible ? [s.priceFormatter().format(last.price)] : [];
    });
    const h = pane.getHeight();
    const top = first.coordinateToPrice(1);
    const bottom = first.coordinateToPrice(h - 2);
    if (top === null || bottom === null || top === bottom) return texts;
    const margin = edgeMargin(top, bottom);
    const fmt = first.priceFormatter();
    return [...texts, fmt.format(Math.min(top, bottom) - margin), fmt.format(Math.max(top, bottom) + margin)];
  });
}
