import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

/** One bar of a main series drawn by the viewer itself. Styles that need more per bar extend it. */
export interface StyleBar extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** What a style painter gets: the visible bars with their x positions, in bitmap pixels. */
export interface PaintFrame<B extends StyleBar> {
  ctx: CanvasRenderingContext2D;
  /** Bars around the visible range, oldest first; `x` is the bar's centre in bitmap pixels. */
  bars: readonly { x: number; bar: B }[];
  /** Index in the series' data of `bars[0]`. */
  first: number;
  barSpacing: number;
  /** Price to bitmap y. */
  y: (price: number) => number;
  hpr: number;
  vpr: number;
  width: number;
  height: number;
}

export type Painter<B extends StyleBar> = (frame: PaintFrame<B>) => void;

export interface StyleView<B extends StyleBar> {
  painter: Painter<B>;
  /** The prices that scale the pane; the last one is the bar's value for the last-price label and line. */
  prices: (bar: B) => number[];
}

/** A lightweight-charts custom series that hands the bars to a style painter. */
export class StyleSeriesView<B extends StyleBar> implements ICustomSeriesPaneView<Time, B, CustomSeriesOptions> {
  private data: PaneRendererCustomData<Time, B> | null = null;

  constructor(private readonly style: StyleView<B>) {}

  renderer(): ICustomSeriesPaneRenderer {
    return { draw: (target, priceToCoordinate) => this.draw(target, priceToCoordinate) };
  }

  update(data: PaneRendererCustomData<Time, B>): void {
    this.data = data;
  }

  priceValueBuilder(bar: B): CustomSeriesPricePlotValues {
    return this.style.prices(bar);
  }

  isWhitespace(bar: B | { time: Time }): bar is { time: Time } {
    return (bar as Partial<B>).close === undefined;
  }

  defaultOptions(): CustomSeriesOptions {
    return { ...customSeriesDefaultOptions, color: '#2962FF' };
  }

  private draw(target: CanvasRenderingTarget2D, priceToCoordinate: PriceToCoordinateConverter): void {
    const data = this.data;
    if (!data || !data.visibleRange || data.bars.length === 0) return;
    // One bar beyond each edge so lines and fills run to the pane's sides.
    const first = Math.max(0, data.visibleRange.from - 1);
    const last = Math.min(data.bars.length, data.visibleRange.to + 1);
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hpr, verticalPixelRatio: vpr, bitmapSize }) => {
      context.save();
      this.style.painter({
        ctx: context,
        bars: data.bars.slice(first, last).map((b) => ({ x: b.x * hpr, bar: b.originalData })),
        first,
        barSpacing: data.barSpacing * hpr,
        y: (price) => (priceToCoordinate(price) ?? NaN) * vpr,
        hpr,
        vpr,
        width: bitmapSize.width,
        height: bitmapSize.height,
      });
      context.restore();
    });
  }
}
