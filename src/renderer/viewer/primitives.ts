import type {
  AutoscaleInfo,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { DrawingPoint, ParsedDrawing } from '../../core/layout';
import type { DrawContext } from './drawings/canvas';
import { DRAWING_KINDS, type AxisLabel } from './drawings/registry';
import { dashPattern, luminance } from './colors';
import type { Band, Column, FillPlan } from './studies';
import type { TimeIndex } from './time';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

interface Attached {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  requestUpdate: () => void;
}

/** x = a + b * logical; lightweight-charts only converts whole bar indexes, drawings need any position. */
function logicalScale(chart: IChartApi): { a: number; b: number } | null {
  const ts = chart.timeScale();
  const x0 = ts.logicalToCoordinate(0 as Logical);
  const x1 = ts.logicalToCoordinate(1 as Logical);
  return x0 === null || x1 === null ? null : { a: x0, b: x1 - x0 };
}

abstract class BasePrimitive implements ISeriesPrimitive<Time> {
  protected env: Attached | null = null;
  private readonly views: IPrimitivePaneView[];

  constructor(zOrder: PrimitivePaneViewZOrder) {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.views = [{ zOrder: () => zOrder, renderer: () => renderer }];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.env = { chart: param.chart as IChartApi, series: param.series, requestUpdate: param.requestUpdate };
  }

  detached(): void {
    this.env = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  protected abstract draw(target: DrawTarget): void;
}

export interface DrawingsEnv {
  timeIndex: TimeIndex;
  formatPrice(price: number): string;
  formatTime(point: DrawingPoint): string;
  priceStep: number;
}

/** Axis labels keep white text like TradingView's, except on very light colours. */
const textOn = (bg: string) => (luminance(bg) > 180 ? '#131722' : '#ffffff');

/** All drawings of one pane, drawn above the price series, plus their price and time axis labels. */
export class DrawingsPrimitive extends BasePrimitive {
  private readonly priceViews: ISeriesPrimitiveAxisView[] = [];
  private readonly timeViews: ISeriesPrimitiveAxisView[] = [];

  constructor(
    private readonly drawings: readonly ParsedDrawing[],
    private readonly denv: DrawingsEnv,
  ) {
    super('top');
    for (const d of drawings) {
      for (const label of DRAWING_KINDS[d.type]?.axisLabels?.(d.props, d.points) ?? []) this.addAxisView(label);
    }
  }

  private addAxisView(label: AxisLabel): void {
    const base = { textColor: () => textOn(label.color), backColor: () => label.color };
    if (label.axis === 'price') {
      this.priceViews.push({ ...base, coordinate: () => this.env?.series.priceToCoordinate(label.price) ?? -1000, text: () => this.denv.formatPrice(label.price) });
    } else {
      this.timeViews.push({
        ...base,
        coordinate: () => {
          const s = this.env && logicalScale(this.env.chart);
          return s ? s.a + s.b * this.denv.timeIndex.logical(label.point) : -1000;
        },
        text: () => this.denv.formatTime(label.point),
      });
    }
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.priceViews;
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.timeViews;
  }

  protected draw(target: DrawTarget): void {
    const env = this.env;
    if (!env) return;
    const scale = logicalScale(env.chart);
    if (!scale) return;
    const { timeIndex } = this.denv;
    const y = (price: number) => env.series.priceToCoordinate(price) ?? NaN;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const dc: DrawContext = {
        ctx: context,
        width: mediaSize.width,
        height: mediaSize.height,
        barSpacing: scale.b,
        logical: (p) => timeIndex.logical(p),
        pt: (p) => ({ x: scale.a + scale.b * timeIndex.logical(p), y: y(p.price) }),
        y,
        formatPrice: this.denv.formatPrice,
        priceStep: this.denv.priceStep,
      };
      for (const d of this.drawings) {
        const kind = DRAWING_KINDS[d.type];
        if (!kind) continue;
        context.save();
        kind.draw(dc, d.props, d.points);
        context.restore();
      }
    });
  }
}

/** What an indicator draws behind its plots: band fills, fills between two plots, per-bar background colours and band lines. */
export class StudyBackdropPrimitive extends BasePrimitive {
  constructor(
    private readonly fills: readonly FillPlan[],
    private readonly bands: readonly Band[],
  ) {
    super('bottom');
  }

  /** TradingView keeps an indicator's bands (RSI 70/30) inside the visible price range. */
  autoscaleInfo(): AutoscaleInfo | null {
    if (this.bands.length === 0) return null;
    const prices = this.bands.map((b) => b.price);
    return { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } };
  }

  protected draw(target: DrawTarget): void {
    const env = this.env;
    if (!env) return;
    const scale = logicalScale(env.chart);
    const range = env.chart.timeScale().getVisibleLogicalRange();
    if (!scale || !range) return;
    const y = (price: number) => env.series.priceToCoordinate(price) ?? NaN;
    const x = (i: number) => scale.a + scale.b * i;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const fill of this.fills) {
        if (fill.kind === 'between-prices') {
          const top = y(fill.top);
          const bottom = y(fill.bottom);
          ctx.fillStyle = fill.color;
          ctx.fillRect(0, Math.min(top, bottom), mediaSize.width, Math.abs(bottom - top));
          continue;
        }
        const n = fill.kind === 'bar-background' ? fill.colors.length : fill.a.length;
        const from = Math.max(0, Math.floor(range.from) - 1);
        const to = Math.min(n - 1, Math.ceil(range.to) + 1);
        if (fill.kind === 'bar-background') {
          for (let i = from; i <= to; i++) {
            const c = fill.colors[i];
            if (!c) continue;
            ctx.fillStyle = c;
            ctx.fillRect(x(i) - scale.b / 2, 0, scale.b, mediaSize.height);
          }
          continue;
        }
        if ('gradient' in fill.paint) {
          const g = fill.paint.gradient;
          const grad = ctx.createLinearGradient(0, y(g.topValue), 0, y(g.bottomValue));
          grad.addColorStop(0, g.topColor);
          grad.addColorStop(1, g.bottomColor);
          ctx.fillStyle = grad;
        } else ctx.fillStyle = fill.paint.color;
        for (const run of runs(fill.a, fill.b, from, to)) {
          ctx.beginPath();
          run.forEach((i, k) => (k ? ctx.lineTo(x(i), y(fill.a[i]!)) : ctx.moveTo(x(i), y(fill.a[i]!))));
          for (let k = run.length - 1; k >= 0; k--) ctx.lineTo(x(run[k]!), y(fill.b[run[k]!]!));
          ctx.closePath();
          ctx.fill();
        }
      }
      for (const band of this.bands) {
        const by = Math.round(y(band.price)) + (band.lineWidth % 2 ? 0.5 : 0);
        ctx.strokeStyle = band.color;
        ctx.lineWidth = band.lineWidth;
        ctx.setLineDash(dashPattern(band.lineStyle, band.lineWidth));
        ctx.beginPath();
        ctx.moveTo(0, by);
        ctx.lineTo(mediaSize.width, by);
        ctx.stroke();
      }
    });
  }
}

/** Index runs where both columns have values. */
function runs(a: Column, b: Column, from: number, to: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  for (let i = from; i <= to; i++) {
    if (a[i] != null && b[i] != null) cur.push(i);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}
