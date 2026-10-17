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
} from 'lightweight-charts';
import type { DrawingPoint, ParsedStudy } from '../../core/layout';
import { isDark, lwcLineStyle, withTransparency } from './colors';
import type { ChartPlan, PlannedStudy } from './plan';
import { DrawingsPrimitive, StudyBackdropPrimitive } from './primitives';
import { lineWidth, type PriceFormatSpec, type SeriesKind, type SeriesSpec } from './series';
import type { Lang } from '../../shared/api';
import { localeOf } from '../../shared/locale';
import { intervalLabel, STRINGS } from './strings';
import { isIntraday, timeZoneOffset } from './time';
import { num, obj, str, type Props } from '../../core/props';


/** TradingView's dotted grid is sparser than lightweight-charts' dotted style. */
const gridStyle = (tvStyle: unknown) => lwcLineStyle(tvStyle === 1 ? 4 : tvStyle);

export interface ChartTheme {
  background: string;
  textColor: string;
  dark: boolean;
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
  return {
    background,
    textColor,
    dark: isDark(background),
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
      timeScale: { borderColor: lineColor },
    },
  };
}

const SERIES_DEFINITIONS = {
  Candlestick: CandlestickSeries,
  Bar: BarSeries,
  Line: LineSeries,
  Area: AreaSeries,
  Baseline: BaselineSeries,
  Histogram: HistogramSeries,
} satisfies { [K in SeriesKind]: SeriesDefinition<K> };

function addSeries(chart: IChartApi, spec: SeriesSpec, pane: number, extra: DeepPartial<SeriesOptionsCommon>): ISeriesApi<SeriesType> {
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

const HIDDEN_INPUT = /^(__|pine)/;
/** "MA 50 close": the inputs TradingView shows after an indicator's name. */
function inputsSummary(study: ParsedStudy): string {
  return Object.entries(study.inputs)
    .filter(([k, v]) => !HIDDEN_INPUT.test(k) && (typeof v === 'number' || (typeof v === 'string' && v !== '' && v.length < 24)))
    .map(([, v]) => String(v))
    .join(' ');
}

/** Time axis label of a drawing, like TradingView's "Mon 14 Sep '26": the date of the bar the point sits on. */
function timeFormatter(lang: Lang, plan: ChartPlan): (p: DrawingPoint) => string {
  const intraday = isIntraday(plan.timeIndex.interval);
  const fmt = new Intl.DateTimeFormat(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
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

function mainLegend(plan: ChartPlan, theme: ChartTheme): Legend {
  const el = legendBox(theme);
  const title = document.createElement('div');
  const exchange = plan.chart.symbol.includes(':') ? plan.chart.symbol.split(':')[0]! : '';
  title.append(span([plan.chart.shortName, intervalLabel(plan.chart.interval), exchange].filter(Boolean).join(' · '), undefined, true));
  const ohlc = document.createElement('span');
  title.append(ohlc);
  el.append(title);
  const fmt = plan.priceFormat;
  const style = obj(plan.chart.seriesState.candleStyle);
  return {
    el,
    update(i) {
      const b = plan.bars[i];
      if (!b) return;
      const prev = plan.bars[i - 1];
      const up = b[4] >= (prev && style.barColorsOnPrevClose === true ? prev[4] : b[1]);
      const color = str(up ? style.upColor : style.downColor, up ? '#089981' : '#F23645');
      ohlc.replaceChildren(
        ...(['O', 'H', 'L', 'C'] as const).flatMap((k, j) => [span(k), span(formatValue(b[j + 1], fmt), color)]),
        ...(prev ? [span(`${b[4] - prev[4] >= 0 ? '+' : ''}${formatValue(b[4] - prev[4], fmt)} (${(((b[4] - prev[4]) / prev[4]) * 100).toFixed(2)}%)`, color)] : []),
      );
    },
  };
}

function studyLegend(studies: PlannedStudy[], theme: ChartTheme, top: number): Legend {
  const el = legendBox(theme);
  el.style.top = `${top}px`;
  const rows = studies.map((s) => {
    const row = document.createElement('div');
    const values = document.createElement('span');
    row.append(span(`${s.study.shortName} ${inputsSummary(s.study)}`.trim()), values);
    el.append(row);
    return { s, values };
  });
  return {
    el,
    update(i) {
      for (const { s, values } of rows) {
        values.replaceChildren(...s.render.series.map((p) => span(formatValue(p.values[i], s.priceFormat), p.color)));
      }
    },
  };
}

export interface RenderedChart {
  destroy(): void;
}

export function renderChart(cell: HTMLElement, plan: ChartPlan, lang: Lang, visibleRange: { from: number; to: number } | undefined): RenderedChart {
  const theme = chartTheme(plan.chart.chartProperties);
  cell.style.position = 'relative';
  cell.style.background = theme.background;

  if (!plan.main) {
    const box = legendBox(theme);
    box.append(span(`${plan.chart.shortName} · ${intervalLabel(plan.chart.interval)}`, undefined, true));
    const msg = document.createElement('div');
    msg.textContent = STRINGS[lang].noPriceDataBanner;
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
    localization: { locale: localeOf(lang) },
    timeScale: { ...theme.options.timeScale, timeVisible: intraday, secondsVisible: plan.timeIndex.interval.unit === 'S' },
  });

  const drawingsEnv = {
    timeIndex: plan.timeIndex,
    formatPrice: (p: number) => formatValue(p, plan.priceFormat),
    formatTime: timeFormatter(lang, plan),
    priceStep: plan.priceFormat.type === 'price' ? plan.priceFormat.minMove : 0.01,
  };

  const legends: { pane: number; legend: Legend }[] = [];
  plan.panes.forEach((pane, index) => {
    let host: ISeriesApi<SeriesType> | null = null;
    if (pane.main) {
      host = addSeries(chart, plan.main!.spec, index, { priceScaleId: 'right' });
      legends.push({ pane: index, legend: mainLegend(plan, theme) });
    }
    for (const ps of pane.studies) {
      let first: ISeriesApi<SeriesType> | null = null;
      for (const plot of ps.render.series) {
        const s = addSeries(chart, plot.spec, index, { priceScaleId: ps.priceScaleId, priceFormat: ps.priceFormat });
        first ??= s;
      }
      if (ps.priceScaleId !== 'right' && first) {
        const volume = ps.study.metaInfoId.startsWith('Volume@');
        first.priceScale().applyOptions({ scaleMargins: volume ? { top: 0.75, bottom: 0 } : { top: 0.1, bottom: 0.08 } });
      }
      const target = first ?? host;
      if (!target) continue;
      if (ps.render.fills.length || ps.render.bands.length) target.attachPrimitive(new StudyBackdropPrimitive(ps.render.fills, ps.render.bands));
      host ??= first;
    }
    if (pane.studies.length) legends.push({ pane: index, legend: studyLegend(pane.studies, theme, pane.main ? 26 : 6) });
    if (host && pane.drawings.length) host.attachPrimitive(new DrawingsPrimitive(pane.drawings, drawingsEnv));
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

  const applyRange = () => {
    const range = visibleRange ? { from: plan.timeIndex.indexOf(visibleRange.from), to: plan.timeIndex.indexOf(visibleRange.to) } : { from: last - 150, to: last + 10 };
    chart.timeScale().setVisibleLogicalRange(range);
  };
  applyRange();
  const onSize = () => {
    applyRange();
    chart.timeScale().unsubscribeSizeChange(onSize);
  };
  chart.timeScale().subscribeSizeChange(onSize);

  return {
    destroy() {
      cancelAnimationFrame(frame);
      chart.remove();
      cell.replaceChildren();
    },
  };
}
