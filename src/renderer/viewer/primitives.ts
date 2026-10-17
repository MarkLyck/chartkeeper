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
import type { Bar } from '../../core/model';
import { FONT_FAMILY, type DrawContext } from './drawings/canvas';
import { DRAWING_KINDS, type AxisLabel } from './drawings/registry';
import { dashPattern, luminance } from './colors';
import { visiblePeriods, type HighLowPivots, type PivotPeriod, type PivotsPlan, type StandardPivots } from './pivots';
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
  bars: readonly Bar[];
  dark: boolean;
  background: string;
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
    const x = (logical: number) => scale.a + scale.b * logical;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const dc: DrawContext = {
        ctx: context,
        width: mediaSize.width,
        height: mediaSize.height,
        barSpacing: scale.b,
        logical: (p) => timeIndex.logical(p),
        logicalOfTime: (t) => timeIndex.indexOf(t),
        pt: (p) => ({ x: x(timeIndex.logical(p)), y: y(p.price) }),
        x,
        y,
        price: (yy) => env.series.coordinateToPrice(yy) ?? NaN,
        bars: this.denv.bars,
        formatPrice: this.denv.formatPrice,
        priceStep: this.denv.priceStep,
        dark: this.denv.dark,
        background: this.denv.background,
      };
      for (const d of this.drawings) {
        const kind = DRAWING_KINDS[d.type];
        if (!kind) continue;
        context.save();
        kind.draw(dc, d.props, d.points, d);
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

/** Wide enough for every level name; TradingView sizes all label cells by the widest. */
const PIVOT_LABEL_TEXTS = ['P', 'S1', 'R1', 'S2', 'R2', 'S3', 'R3', 'S4', 'R4', 'S5', 'R5', '/'];

export interface PivotsEnv {
  formatPrice(price: number): string;
  lastBar: number;
}

/** Pivot Points Standard level lines with their labels and price axis labels, or Pivot Points High Low price callouts. */
export class PivotsPrimitive extends BasePrimitive {
  private axisViews: ISeriesPrimitiveAxisView[] = [];

  constructor(
    private readonly plan: PivotsPlan,
    private readonly penv: PivotsEnv,
  ) {
    super('normal');
  }

  private lastVisibleBar(): number | null {
    const range = this.env?.chart.timeScale().getVisibleLogicalRange();
    return range ? Math.min(Math.floor(range.to), this.penv.lastBar) : null;
  }

  updateAllViews(): void {
    if (this.plan.kind !== 'standard' || !this.plan.axisLabels) return;
    const last = this.lastVisibleBar();
    const current = last === null ? null : visiblePeriods(this.plan, last).current;
    this.axisViews = (current?.levels ?? []).map((level) => ({
      coordinate: () => this.env?.series.priceToCoordinate(level.price) ?? -1000,
      text: () => this.penv.formatPrice(level.price),
      textColor: () => textOn(level.color),
      backColor: () => level.color,
    }));
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  /** TradingView fits the main scale to the levels of every period in view. */
  autoscaleInfo(from: Logical, to: Logical): AutoscaleInfo | null {
    if (this.plan.kind !== 'standard') return null;
    const prices = this.plan.periods.filter((p) => p.end >= from && p.start <= to).flatMap((p) => p.levels.map((l) => l.price));
    return prices.length ? { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } } : null;
  }

  protected draw(target: DrawTarget): void {
    const env = this.env;
    const scale = env && logicalScale(env.chart);
    const last = this.lastVisibleBar();
    if (!env || !scale || last === null) return;
    const y = (price: number) => env.series.priceToCoordinate(price) ?? NaN;
    const x = (i: number) => scale.a + scale.b * i;
    const plan = this.plan;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      if (plan.kind === 'standard') drawStandardPivots(ctx, plan, visiblePeriods(plan, last).drawn, x, y);
      else drawHighLowPivots(ctx, plan, x, y, mediaSize.width, this.penv.formatPrice);
    });
  }
}

function drawStandardPivots(ctx: CanvasRenderingContext2D, plan: StandardPivots, periods: PivotPeriod[], x: (i: number) => number, y: (p: number) => number): void {
  ctx.font = `${plan.fontSize}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  const cell = Math.round(Math.max(...PIVOT_LABEL_TEXTS.map((t) => ctx.measureText(t).width)) + 4);
  const cellHeight = plan.fontSize + 8;
  for (const period of periods) {
    const x1 = Math.round(x(period.start));
    const x2 = Math.round(x(period.end));
    for (const line of period.lines) {
      const ly = Math.round(y(line.price)) + (line.width % 2 ? 0.5 : 0);
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.width;
      ctx.beginPath();
      ctx.moveTo(x1, ly);
      ctx.lineTo(x2, ly);
      ctx.stroke();
      if (!plan.showLabels) continue;
      // Labels end where the line starts; merged levels ("S1/R1") continue to the right, one cell per name.
      const ty = Math.round(y(line.price) - cellHeight / 2) + Math.round(cellHeight / 2) + 0.5;
      ctx.fillStyle = line.color;
      line.label.split('/').forEach((name, k) => {
        if (k > 0) ctx.fillText('/', Math.round(x1 - cell / 2 + (k - 1) * cell) + 0.5, ty);
        ctx.fillText(name, Math.round(x1 - cell + k * cell) + 0.5, ty);
      });
    }
  }
}

const CALLOUT = { gap: 3, pointer: 4, halfPointer: 5, padX: 4, padY: 1 };

/** A price box pointing at the pivot bar's high (box above) or low (box below), for pivots on bars in view. */
function drawHighLowPivots(ctx: CanvasRenderingContext2D, plan: HighLowPivots, x: (i: number) => number, y: (p: number) => number, width: number, formatPrice: (p: number) => string): void {
  ctx.font = `${plan.fontSize}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineWidth = 1;
  const boxHeight = plan.fontSize + 2 * CALLOUT.padY;
  for (const p of plan.pivots) {
    const cx = Math.round(x(p.index));
    if (cx < 0 || cx > width) continue;
    const text = formatPrice(p.price);
    const half = Math.round(ctx.measureText(text).width / 2 + CALLOUT.padX);
    const dir = p.high ? -1 : 1;
    const tip = Math.round(y(p.price)) + dir * CALLOUT.gap;
    const base = tip + dir * CALLOUT.pointer;
    const far = base + dir * boxHeight;
    ctx.beginPath();
    ctx.moveTo(cx, tip);
    ctx.lineTo(cx + CALLOUT.halfPointer, base);
    ctx.lineTo(cx + half, base);
    ctx.lineTo(cx + half, far);
    ctx.lineTo(cx - half, far);
    ctx.lineTo(cx - half, base);
    ctx.lineTo(cx - CALLOUT.halfPointer, base);
    ctx.closePath();
    ctx.fillStyle = plan.backColor;
    ctx.fill();
    ctx.strokeStyle = plan.borderColor;
    ctx.stroke();
    ctx.fillStyle = plan.textColor;
    ctx.fillText(text, cx, (base + far) / 2);
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
