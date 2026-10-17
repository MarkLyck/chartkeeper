import { drawingsForChart, type ParsedChart, type ParsedDrawing, type ParsedLayout, type ParsedPane, type ParsedStudy } from '../../core/layout';
import { sameTicker } from '../../core/tv/content';
import type { Bar, ChartData, StudyValues } from '../../core/model';
import { obj } from '../../core/props';
import { DRAWING_KINDS } from './drawings/registry';
import { guessPriceFormat, mainSeriesSpec, type MainSeriesSpec, type PriceFormatSpec } from './series';
import { drawingName, reasonText, STRINGS, type NotShownReason } from './strings';
import { planPivots, type PivotsPlan } from './pivots';
import { hasPineGraphics, planStudyRender, studyPriceFormat, type StudyRender } from './studies';
import { isIntraday, parseInterval, TimeIndex, timeZoneOffset } from './time';

export interface NotShownItem {
  chartId: string;
  kind: 'drawing' | 'indicator' | 'chart';
  /** Drawing id, indicator id or chart id. */
  id: string;
  name: string;
  /** True when the item itself is drawn and only part of it is missing. */
  partial: boolean;
  reason: NotShownReason;
  /** Plain-language reason. */
  message: string;
}

export interface PlannedStudy {
  study: ParsedStudy;
  render: StudyRender;
  /** Pivot points levels or labels, drawn from the study's non-series output. */
  pivots: PivotsPlan | null;
  priceFormat: PriceFormatSpec;
  /** Price scale for the study's series: "right" shares the pane's scale, anything else is a separate overlay scale. */
  priceScaleId: string;
}

export interface PlannedPane {
  source: ParsedPane | null;
  main: boolean;
  stretchFactor: number;
  studies: PlannedStudy[];
  drawings: ParsedDrawing[];
}

export interface ChartPlan {
  chart: ParsedChart;
  /** Null when the snapshot has no price data for this chart. */
  main: MainSeriesSpec | null;
  bars: Bar[];
  /** Bar times as shown on the time axis (shifted into the chart's time zone for intraday charts). */
  times: number[];
  timeIndex: TimeIndex;
  priceFormat: PriceFormatSpec;
  /** TradingView's own values for study-backed drawings, by drawing id. */
  drawingStudies: Readonly<Record<string, StudyValues>>;
  /** Panes that will be drawn, top to bottom. */
  panes: PlannedPane[];
  rendered: { drawings: string[]; studies: string[] };
  notShown: NotShownItem[];
}

function sortedBars(data: ChartData | null): Bar[] {
  if (!data) return [];
  const byTime = new Map<number, Bar>();
  for (const b of data.bars) byTime.set(b[0], b);
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}

const studyName = (s: ParsedStudy) => s.shortName || s.name || s.metaInfoId;

/**
 * Decides what the viewer draws for one chart and lists everything else with
 * a reason. Every drawing and indicator of the chart ends up in exactly one
 * of `rendered` or `notShown` (partial items can also appear in `notShown`).
 */
export function planChart(layout: ParsedLayout, chart: ParsedChart, data: ChartData | null): ChartPlan {
  const notShown: NotShownItem[] = [];
  const add = (kind: NotShownItem['kind'], id: string, name: string, reason: NotShownReason, partial = false) =>
    notShown.push({ chartId: chart.chartId, kind, id, name, partial, reason, message: reasonText(reason) });

  const bars = sortedBars(data);
  const hasPrices = bars.length > 0;
  const barTimes = bars.map((b) => b[0]);
  const intraday = isIntraday(parseInterval(chart.interval));
  const times = intraday ? barTimes.map((t) => t + timeZoneOffset(t, chart.timezone)) : barTimes;
  const timeIndex = new TimeIndex(barTimes, chart.interval);
  const main = hasPrices ? mainSeriesSpec(chart, bars, times, data?.computedStyle) : null;
  const priceFormat: PriceFormatSpec = { type: 'price', ...guessPriceFormat(bars, chart.style === data?.computedStyle ? data.computedStyle : undefined) };
  if (main?.fallbackFrom != null) add('chart', chart.chartId, chart.symbol, { code: 'chart-style', style: main.fallbackFrom }, true);

  const mainSource = chart.panes.find((p) => p.containsMainSeries) ?? chart.panes[0] ?? null;
  const planned = new Map<ParsedPane | null, PlannedPane>();
  const paneFor = (source: ParsedPane | null): PlannedPane => {
    let p = planned.get(source);
    if (!p) {
      p = { source, main: source === mainSource, stretchFactor: source?.stretchFactor ?? 1000, studies: [], drawings: [] };
      planned.set(source, p);
    }
    return p;
  };
  if (hasPrices) paneFor(mainSource);

  const renderedStudies: string[] = [];
  for (const pane of chart.panes) {
    for (const study of pane.studies) {
      const name = studyName(study);
      if (!hasPrices) {
        add('indicator', study.id, name, { code: 'no-price-data' });
        continue;
      }
      if (!study.visible) {
        add('indicator', study.id, name, { code: 'hidden' });
        continue;
      }
      const values = data?.studies[study.id];
      if (!values) {
        add('indicator', study.id, name, { code: 'no-study-values' });
        continue;
      }
      if (values.status === 'error') {
        add('indicator', study.id, name, { code: 'study-error', error: values.error });
        continue;
      }
      const render = planStudyRender(study, values.rows, barTimes, times);
      const pivots = planPivots(study, values.graphics, bars, obj(chart.chartProperties.scalesProperties));
      const isMainPane = pane === mainSource;
      const hostable = render.series.length > 0 || (isMainPane && render.fills.length > 0) || (isMainPane && pivots !== null);
      if (!hostable) {
        add('indicator', study.id, name, render.unsupported.length ? { code: 'unsupported-plots', count: render.unsupported.length } : { code: 'nothing-to-draw' });
        continue;
      }
      paneFor(pane).studies.push({
        study,
        render,
        pivots,
        priceFormat: studyPriceFormat(study, priceFormat),
        priceScaleId: isMainPane && !study.isPriceStudy ? `overlay-${study.id}` : 'right',
      });
      renderedStudies.push(study.id);
      if (render.unsupported.length) add('indicator', study.id, name, { code: 'unsupported-plots', count: render.unsupported.length }, true);
      if (!pivots && hasPineGraphics(values.graphics)) add('indicator', study.id, name, { code: 'pine-graphics' }, true);
    }
  }

  const panes = chart.panes.map((p) => planned.get(p)).filter((p): p is PlannedPane => p !== undefined);
  if (hasPrices && !panes.some((p) => p.main)) panes.unshift(paneFor(null));

  const renderedDrawings: string[] = [];
  for (const d of drawingsForChart(layout, chart)) {
    const name = drawingName(d.type);
    const kind = DRAWING_KINDS[d.type];
    const source = chart.panes.find((p) => p.drawings.includes(d)) ?? mainSource;
    const target = panes.find((p) => p.source === source);
    let reason: NotShownReason | null = null;
    if (!hasPrices) reason = { code: 'no-price-data' };
    else if (d.symbol && chart.symbol && !sameTicker(d.symbol, chart.symbol)) reason = { code: 'other-symbol', symbol: d.symbol };
    else if (!d.visible) reason = { code: 'hidden' };
    else if (!kind) reason = { code: 'unknown-drawing' };
    else if (d.points.length < kind.minPoints) reason = { code: 'too-few-points' };
    else if (!target) reason = { code: 'pane-not-shown' };
    if (reason) {
      add('drawing', d.id, name, reason);
      continue;
    }
    target!.drawings.push(d);
    renderedDrawings.push(d.id);
    // A backup that holds TradingView's own values for the drawing needs no "computed locally" note.
    const storedValues = kind!.caveat?.code === 'computed-locally' && data?.drawingStudies?.[d.id] !== undefined;
    if (kind!.caveat && !storedValues) add('drawing', d.id, name, kind!.caveat, true);
  }
  for (const p of panes) p.drawings.sort((a, b) => a.zorder - b.zorder);

  return { chart, main, bars, times, timeIndex, priceFormat, drawingStudies: data?.drawingStudies ?? {}, panes, rendered: { drawings: renderedDrawings, studies: renderedStudies }, notShown };
}

export interface LayoutPlan {
  charts: ChartPlan[];
  notShown: NotShownItem[];
}

/** Plans every chart, plus layout-wide items: unreadable drawings and shared drawings for symbols no chart shows. */
export function planLayout(layout: ParsedLayout, data: Record<string, ChartData | null>): LayoutPlan {
  const charts = layout.charts.map((c) => planChart(layout, c, data[c.chartId] ?? null));
  const firstId = layout.charts[0]?.chartId ?? '';
  const extra: NotShownItem[] = [];
  for (const problem of layout.problems) {
    const reason: NotShownReason = { code: 'unreadable', detail: problem };
    extra.push({ chartId: firstId, kind: 'drawing', id: '', name: STRINGS.drawing, partial: false, reason, message: reasonText(reason) });
  }
  for (const d of layout.sharedDrawings) {
    if (layout.charts.some((c) => drawingsForChart(layout, c).includes(d))) continue;
    const reason: NotShownReason = { code: 'symbol-not-in-layout', symbol: d.symbol ?? '?' };
    extra.push({ chartId: firstId, kind: 'drawing', id: d.id, name: drawingName(d.type), partial: false, reason, message: reasonText(reason) });
  }
  return { charts, notShown: [...charts.flatMap((c) => c.notShown), ...extra] };
}
