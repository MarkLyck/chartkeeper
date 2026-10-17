import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type SeriesDefinition,
  type SeriesOptionsCommon,
  type SeriesType,
  type TimeChartOptions,
  TickMarkType,
  type Time,
} from 'lightweight-charts';
import type { DrawingPoint } from '../../core/layout';
import { isDark, lwcLineStyle, withTransparency } from './colors';
import type { ChartPlan, PlannedStudy } from './plan';
import { DrawingsPrimitive, PivotsPrimitive, StudyBackdropPrimitive } from './primitives';
import { lineWidth, type PriceFormatSpec, type SeriesKind, type SeriesSpec, type StyleSeriesSpec } from './series';
import { StyleSeriesView } from './styles/view';
import { PriceLinePrimitive } from './styles/priceLine';
import { priceAxisTexts, tvPriceAxisWidth } from './axis';
import { legendInputs, opaque, studyScaleMargins, volumeText } from './studies';
import { LOCALE } from '../../shared/locale';
import { intervalLabel, STRINGS } from './strings';
import { isIntraday, timeZoneOffset } from './time';
import { num, obj, str, type Props } from '../../core/props';


/**
 * TradingView's dotted grid is a one-pixel dot every four pixels in the full grid colour. lightweight-charts
 * starts its grid lines half a pixel off the pixel grid, so its dotted styles smear into faint two-pixel dots;
 * its dashed style lands one full-colour pixel every four pixels, with faint neighbours.
 */
const gridStyle = (tvStyle: unknown) => lwcLineStyle(tvStyle === 1 ? 2 : tvStyle);

export interface ChartTheme {
  background: string;
  textColor: string;
  dark: boolean;
  /** CSS for the panel TradingView paints behind each legend row, hiding drawings under it; null when switched off. */
  legendBackground: string | null;
  options: DeepPartial<TimeChartOptions>;
}

/** Chart colours and scale settings from the layout's chartProperties. */
export function chartTheme(chartProperties: Props): ChartTheme {
  const pane = obj(chartProperties.paneProperties);
  const scales = obj(chartProperties.scalesProperties);
  const background = str(pane.background, '#ffffff');
  const gradient = pane.backgroundType === 'gradient';
  const textColor = str(scales.textColor, '#131722');
  const lineColor = str(scales.lineColor, 'rgba(42, 46, 57, 0)');
  const vert = obj(pane.vertGridProperties);
  const horz = obj(pane.horzGridProperties);
  const cross = obj(pane.crossHairProperties);
  const crossLine = {
    color: withTransparency(str(cross.color, '#9598A1'), cross.transparency),
    style: lwcLineStyle(num(cross.style, 2)),
    width: lineWidth(cross.width, 1),
    labelBackgroundColor: '#131722',
  };
  const legend = obj(pane.legendProperties);
  return {
    background,
    textColor,
    dark: isDark(background),
    legendBackground: legend.showBackground === false ? null : `background:${withTransparency(background, num(legend.backgroundTransparency, 50))};border-radius:4px;padding:0 4px;margin-left:-4px;width:fit-content;`,
    options: {
      layout: {
        background: gradient
          ? { type: ColorType.VerticalGradient, topColor: str(pane.backgroundGradientStartColor, background), bottomColor: str(pane.backgroundGradientEndColor, background) }
          : { type: ColorType.Solid, color: background },
        textColor,
        fontSize: num(scales.fontSize, 12),
        panes: { separatorColor: str(pane.separatorColor, '#E0E3EB'), separatorHoverColor: 'rgba(178, 181, 189, 0.2)', enableResize: true },
      },
      grid: {
        vertLines: { color: str(vert.color, 'rgba(42, 46, 57, 0.06)'), visible: vert.visible !== false, style: gridStyle(vert.style) },
        horzLines: { color: str(horz.color, 'rgba(42, 46, 57, 0.06)'), visible: horz.visible !== false, style: gridStyle(horz.style) },
      },
      crosshair: { mode: CrosshairMode.Normal, vertLine: crossLine, horzLine: crossLine },
      rightPriceScale: {
        borderColor: lineColor,
        scaleMargins: { top: num(pane.topMargin, 10) / 100, bottom: num(pane.bottomMargin, 8) / 100 },
      },
      timeScale: { borderColor: lineColor, tickMarkFormatter: monthTick },
    },
  };
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
/** TradingView names months "Sep" on the time axis, where the viewer's en-GB dates would say "Sept". */
const monthTick = (time: Time, type: TickMarkType): string | null => (type === TickMarkType.Month && typeof time === 'number' ? MONTH.format(time * 1000) : null);

const SERIES_DEFINITIONS = {
  Candlestick: CandlestickSeries,
  Bar: BarSeries,
  Line: LineSeries,
  Area: AreaSeries,
  Baseline: BaselineSeries,
  Histogram: HistogramSeries,
} satisfies { [K in SeriesKind]: SeriesDefinition<K> };

function addSeries(chart: IChartApi, spec: SeriesSpec | StyleSeriesSpec, pane: number, extra: DeepPartial<SeriesOptionsCommon>): ISeriesApi<SeriesType> {
  if (spec.kind === 'Custom') {
    const s = chart.addCustomSeries(new StyleSeriesView(spec.style), { ...spec.options, ...extra }, pane);
    s.setData(spec.data);
    return s;
  }
  // lightweight-charts' generics can't follow spec.kind across the union, so the definition is widened once here.
  const s = chart.addSeries(SERIES_DEFINITIONS[spec.kind] as SeriesDefinition<SeriesType>, { ...spec.options, ...extra }, pane);
  s.setData(spec.data);
  return s;
}

function formatValue(v: number | null | undefined, format: PriceFormatSpec): string {
  if (v === null || v === undefined) return '∅';
  if (format.type === 'volume') {
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
    return v.toFixed(0);
  }
  if (format.type === 'percent') return `${v.toFixed(2)}%`;
  // 346.085 is stored as 346.08499..., so shift the decimal point in text to round half up like TradingView.
  const p = format.precision;
  return String(v).includes('e') ? v.toFixed(p) : (Math.round(Number(`${v}e${p}`)) / 10 ** p).toFixed(p);
}


/** Time axis label of a drawing, like TradingView's "Mon 14 Sep '26": the date of the bar the point sits on. */
function timeFormatter(plan: ChartPlan): (p: DrawingPoint) => string {
  const intraday = isIntraday(plan.timeIndex.interval);
  const fmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  return (p) => {
    const t = plan.timeIndex.times[plan.timeIndex.logical(p)] ?? p.time;
    const d = new Date((t + (intraday ? timeZoneOffset(t, plan.chart.timezone) : 0)) * 1000);
    const parts = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    const text = `${parts.weekday} ${parts.day} ${parts.month} '${String(d.getUTCFullYear()).slice(2)}`;
    return intraday ? `${text} ${parts.hour}:${parts.minute}` : text;
  };
}

interface Legend {
  el: HTMLElement;
  update(index: number): void;
}

function legendBox(theme: ChartTheme): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ck-legend';
  el.style.cssText = `position:absolute;left:8px;top:6px;z-index:3;pointer-events:none;font:13px -apple-system,BlinkMacSystemFont,'Trebuchet MS',Roboto,Ubuntu,sans-serif;color:${theme.textColor};line-height:20px;white-space:nowrap;`;
  return el;
}

function span(text: string, color?: string, bold = false): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = text;
  if (color) s.style.color = color;
  if (bold) s.style.fontWeight = '600';
  s.style.marginRight = '6px';
  return s;
}

/** "+1.46 (+0.43%)", with TradingView's minus sign for falls. */
function changeText(close: number, prevClose: number, format: PriceFormatSpec): string {
  const diff = close - prevClose;
  const sign = diff < 0 ? '−' : '+';
  return `${sign}${formatValue(Math.abs(diff), format)} (${sign}${Math.abs((diff / prevClose) * 100).toFixed(2)}%)`;
}

/** "AAPL · 1D · NASDAQ · Line Break [3]", then the bar's values as TradingView's legend lists them for the chart style. */
function mainLegend(plan: ChartPlan, theme: ChartTheme): Legend {
  const main = plan.main!;
  const el = legendBox(theme);
  el.style.left = '10px';
  el.style.top = '4px';
  el.style.lineHeight = '24px';
  const exchange = plan.chart.symbol.includes(':') ? plan.chart.symbol.split(':')[0]! : '';
  const title = span([plan.chart.shortName, intervalLabel(plan.chart.interval), exchange, main.legend.styleName].filter(Boolean).join(' · '));
  title.style.fontSize = '16px';
  title.style.marginRight = '12px';
  const values = document.createElement('span');
  const row = document.createElement('div');
  row.style.cssText = theme.legendBackground ?? '';
  row.append(title, values);
  el.append(row);
  const fmt = plan.priceFormat;
  const pair = (label: string, value: string, color: string) => {
    const name = span(label);
    name.style.marginRight = '0';
    return [name, span(value, color)];
  };
  return {
    el,
    update(i) {
      const b = main.ohlc[i];
      if (!b) return;
      const prev = main.ohlc[i - 1];
      const change = main.legend.change;
      values.replaceChildren(
        ...main.legend.fields.flatMap((f) => pair(f.label, formatValue(f.value(b), fmt), f.color(i))),
        ...(prev && change ? [span(changeText(b.close, prev.close, fmt), change(i))] : []),
      );
    },
  };
}

/** TradingView's legend writes negatives with a minus sign and volume like its price axis. */
const legendNumber = (v: number | null | undefined, format: PriceFormatSpec) =>
  format.type === 'volume' && typeof v === 'number' ? volumeText(v) : formatValue(v, format).replace(/^-/, '\u2212');

/** One row per indicator: its name, its inputs in a lighter colour, then each plot's value in the plot's colour at that bar. */
function studyLegend(studies: PlannedStudy[], theme: ChartTheme, top: number): Legend {
  const el = legendBox(theme);
  el.style.top = `${top}px`;
  el.style.lineHeight = '24px';
  el.style.left = '9px';
  const rows = studies.map((s) => {
    const row = document.createElement('div');
    row.style.cssText = theme.legendBackground ?? '';
    const values = document.createElement('span');
    values.style.marginLeft = '3px';
    const title = span(s.study.shortName);
    title.style.marginRight = '3px';
    const inputs = legendInputs(s.study);
    const args = span(inputs.join(' '), withTransparency(theme.textColor, 35));
    args.style.wordSpacing = '1.25px';
    row.append(title, ...(inputs.length ? [args] : []), values);
    el.append(row);
    return { s, values, plots: s.render.series.filter((p) => p.inLegend) };
  });
  return {
    el,
    update(i) {
      for (const { s, values, plots } of rows) {
        values.replaceChildren(...plots.map((p) => span(legendNumber(p.values[i], s.priceFormat), opaque(p.barColors?.[i] ?? p.color))));
      }
    },
  };
}

export interface RenderedChart {
  destroy(): void;
}

export function renderChart(cell: HTMLElement, plan: ChartPlan, view: { visibleRange?: { from: number; to: number }; priceRange?: { from: number; to: number } }): RenderedChart {
  const { visibleRange, priceRange } = view;
  const theme = chartTheme(plan.chart.chartProperties);
  cell.style.position = 'relative';
  cell.style.background = theme.background;

  if (!plan.main) {
    const box = legendBox(theme);
    box.append(span(`${plan.chart.shortName} · ${intervalLabel(plan.chart.interval)}`, undefined, true));
    const msg = document.createElement('div');
    msg.textContent = STRINGS.noPriceDataBanner;
    msg.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;opacity:0.75;';
    cell.append(box, msg);
    return { destroy: () => cell.replaceChildren() };
  }

  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;inset:0;';
  cell.append(holder);
  const intraday = isIntraday(plan.timeIndex.interval);
  const chart = createChart(holder, {
    ...theme.options,
    autoSize: true,
    localization: { locale: LOCALE },
    timeScale: { ...theme.options.timeScale, timeVisible: intraday, secondsVisible: plan.timeIndex.interval.unit === 'S' },
  });

  const drawingsEnv = {
    timeIndex: plan.timeIndex,
    bars: plan.bars,
    dark: theme.dark,
    background: theme.background,
    drawingStudies: plan.drawingStudies,
    timeZone: plan.chart.timezone,
    formatPrice: (p: number) => formatValue(p, plan.priceFormat),
    formatTime: timeFormatter(plan),
    priceStep: plan.priceFormat.type === 'price' ? plan.priceFormat.minMove : 0.01,
  };

  const paneMargins = { top: 0.1, bottom: 0.08, ...theme.options.rightPriceScale?.scaleMargins };
  const legends: { pane: number; legend: Legend }[] = [];
  let mainSeries: ISeriesApi<SeriesType> | null = null;
  plan.panes.forEach((pane, index) => {
    let host: ISeriesApi<SeriesType> | null = null;
    if (pane.main) {
      host = addSeries(chart, plan.main!.spec, index, { priceScaleId: 'right' });
      if (plan.main!.priceLine) host.attachPrimitive(new PriceLinePrimitive(plan.main!.priceLine));
      mainSeries = host;
      legends.push({ pane: index, legend: mainLegend(plan, theme) });
    }
    for (const ps of pane.studies) {
      let first: ISeriesApi<SeriesType> | null = null;
      for (const plot of ps.render.series) {
        const priceFormat = ps.priceFormat.type === 'volume' ? { type: 'custom' as const, formatter: volumeText, minMove: 1 } : ps.priceFormat;
        const s = addSeries(chart, plot.spec, index, { priceScaleId: ps.priceScaleId, priceFormat });
        first ??= s;
      }
      const overlay = ps.priceScaleId !== 'right';
      // A pane's own scale follows its first indicator, like TradingView's scale follows its main source.
      if (first && (overlay || (!pane.main && ps === pane.studies[0]))) {
        first.priceScale().applyOptions({ scaleMargins: studyScaleMargins(ps.study, overlay, paneMargins) });
      }
      const target = first ?? host;
      if (!target) continue;
      if (ps.render.fills.length || ps.render.bands.length) target.attachPrimitive(new StudyBackdropPrimitive(ps.render.fills, ps.render.bands));
      if (ps.pivots) target.attachPrimitive(new PivotsPrimitive(ps.pivots, { formatPrice: drawingsEnv.formatPrice, lastBar: plan.bars.length - 1 }));
      host ??= first;
    }
    if (pane.studies.length) legends.push({ pane: index, legend: studyLegend(pane.studies, theme, pane.main ? 28 : 4) });
    if (host && pane.drawings.length) {
      // Only the main series has a TradingView z-order to sort drawings against; in indicator panes drawings stay on top.
      const drawings = new DrawingsPrimitive(pane.drawings, { ...drawingsEnv, seriesZorder: pane.main ? plan.chart.seriesZorder : -Infinity });
      host.attachPrimitive(drawings);
      chart.panes()[index]?.attachPrimitive(drawings.belowSeries());
    }
  });

  const total = plan.panes.reduce((sum, p) => sum + p.stretchFactor, 0);
  chart.panes().forEach((p, i) => p.setStretchFactor((plan.panes[i]?.stretchFactor ?? 1000) / total));

  // Panes below the first get their DOM on the chart's first paint.
  let frame = 0;
  const placeLegends = (tries: number) => {
    const waiting = legends.filter(({ pane, legend }) => {
      if (legend.el.isConnected) return false;
      const td = chart.panes()[pane]?.getHTMLElement()?.children[1];
      if (td instanceof HTMLElement) td.append(legend.el);
      return !legend.el.isConnected;
    });
    if (waiting.length && tries > 0) frame = requestAnimationFrame(() => placeLegends(tries - 1));
  };
  placeLegends(60);
  const last = plan.bars.length - 1;
  const updateLegends = (i: number) => legends.forEach(({ legend }) => legend.update(Math.max(0, Math.min(last, i))));
  updateLegends(last);
  chart.subscribeCrosshairMove((param) => updateLegends(param.logical ?? last));

  const saved = plan.chart.timeScale;
  const applyRange = () => {
    if (visibleRange) {
      chart.timeScale().setVisibleLogicalRange({ from: plan.timeIndex.indexOf(visibleRange.from), to: plan.timeIndex.indexOf(visibleRange.to) });
    } else if (saved) {
      // TradingView reopens a layout at its saved bar spacing, with the last bar `rightOffset` bars from the right edge.
      // lightweight-charts places every bar 1 px further left than TradingView (its index-to-x subtracts 1), so offset by 1 px less.
      const rightOffset = saved.rightOffset - 1 / saved.barSpacing;
      chart.timeScale().applyOptions({ barSpacing: saved.barSpacing, rightOffset });
      chart.timeScale().scrollToPosition(rightOffset, false);
    } else {
      chart.timeScale().setVisibleLogicalRange({ from: last - 150, to: last + 10 });
    }
    if (priceRange && mainSeries) {
      // An explicit range spans the whole pane, so the autoscale margins must not shrink it.
      mainSeries.priceScale().applyOptions({ autoScale: false, scaleMargins: { top: 0, bottom: 0 } });
      mainSeries.priceScale().setVisibleRange(priceRange);
    }
  };
  applyRange();
  const onSize = () => {
    applyRange();
    chart.timeScale().unsubscribeSizeChange(onSize);
  };
  chart.timeScale().subscribeSizeChange(onSize);

  // lightweight-charts pads its price axis more than TradingView does. Widening the chart by the difference
  // and letting the cell clip it puts the plot area and the axis where TradingView has them.
  let axisFrame = 0;
  const matchAxisWidth = (tries: number) => {
    const ctx = document.createElement('canvas').getContext('2d');
    const lwcWidth = chart.priceScale('right').width();
    if (!ctx || lwcWidth === 0) {
      if (tries > 0) axisFrame = requestAnimationFrame(() => matchAxisWidth(tries - 1));
      return;
    }
    const { fontSize, fontFamily } = chart.options().layout;
    ctx.font = `${fontSize}px ${fontFamily}`;
    const width = tvPriceAxisWidth(priceAxisTexts(chart), (t) => ctx.measureText(t).width);
    holder.style.right = `${Math.min(0, width - lwcWidth)}px`;
    if (width > lwcWidth) chart.applyOptions({ rightPriceScale: { minimumWidth: width } });
  };
  axisFrame = requestAnimationFrame(() => matchAxisWidth(60));

  return {
    destroy() {
      cancelAnimationFrame(axisFrame);
      cancelAnimationFrame(frame);
      chart.remove();
      cell.replaceChildren();
    },
  };
}
