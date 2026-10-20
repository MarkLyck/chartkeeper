import { PriceScaleMode, type DeepPartial, type IPriceScaleApi, type PriceScaleOptions } from 'lightweight-charts';
import type { PriceScaleMode as TvScaleMode, PriceScaleState } from '../../core/layout';

const LWC_MODES: Readonly<Record<TvScaleMode, PriceScaleMode>> = {
  normal: PriceScaleMode.Normal,
  log: PriceScaleMode.Logarithmic,
  percentage: PriceScaleMode.Percentage,
  'indexed-to-100': PriceScaleMode.IndexedTo100,
};

/** lightweight-charts options for a saved TradingView price scale. Autoscale is set either way, so applying them again undoes a drag on the price axis. */
export function priceScaleOptions(scale: PriceScaleState): DeepPartial<PriceScaleOptions> {
  return { mode: LWC_MODES[scale.mode], invertScale: scale.inverted, autoScale: !scale.manualRange };
}

/** TradingView's and lightweight-charts' log transform for price ranges of 1 and more: log10(price + 0.0001) + 4. */
export function toLogUnits(price: number): number {
  const m = Math.abs(price);
  if (m < 1e-15) return 0;
  const v = Math.log10(m + 0.0001) + 4;
  return price < 0 ? -v : v;
}

/**
 * A price range in the units lightweight-charts' `setVisibleRange` takes, which (unlike `getVisibleRange`)
 * are the scale's internal units: log units on a log scale. Null on percentage and indexed scales, whose
 * units depend on the first visible bar.
 */
export function priceRangeInScaleUnits(mode: TvScaleMode, range: { from: number; to: number }): { from: number; to: number } | null {
  if (mode === 'log') return range.from > 0 && range.to > 0 ? { from: toLogUnits(range.from), to: toLogUnits(range.to) } : null;
  return mode === 'normal' ? range : null;
}

/** Applies a saved scale; a manual (non-autoscale) range is kept in TradingView's units, which are lightweight-charts' internal ones. */
export function applyPriceScale(api: IPriceScaleApi, scale: PriceScaleState): void {
  api.applyOptions(priceScaleOptions(scale));
  if (scale.manualRange) api.setVisibleRange({ from: scale.manualRange.min, to: scale.manualRange.max });
}
