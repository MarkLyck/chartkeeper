import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';

/**
 * TradingView's last-price line: one-pixel dots three pixels apart, in the
 * line's colour or the last bar's. lightweight-charts' dotted style leaves one
 * pixel between dots, so the viewer draws the line itself.
 */
export class PriceLinePrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;

  constructor(private readonly look: { color: string; width: number }) {}

  attached({ series }: SeriesAttachedParameter<Time>): void {
    this.series = series;
  }

  detached(): void {
    this.series = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => {
        const last = this.series?.lastValueData(true);
        if (!this.series || !last || last.noData) return;
        const y = this.series.priceToCoordinate(last.price);
        if (y === null) return;
        target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
          const width = Math.max(1, Math.floor(this.look.width * vpr));
          const top = Math.round(y * vpr) - Math.floor(width / 2);
          const dot = Math.max(1, Math.floor(this.look.width * hpr));
          ctx.fillStyle = this.look.color || last.color;
          for (let x = 0; x < bitmapSize.width; x += 4 * dot) ctx.fillRect(x, top, dot, width);
        });
      },
    };
    return [{ renderer: () => renderer }];
  }
}
