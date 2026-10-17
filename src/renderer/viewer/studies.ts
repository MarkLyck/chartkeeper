import type { LineStyle, LineWidth } from 'lightweight-charts';
import type { ParsedStudy, PlotDef } from '../../core/layout';
import { fillColor, lwcLineStyle, parseColor, rgbaCss, withTransparency } from './colors';
import { lineWidth, ts, type PriceFormatSpec, type SeriesSpec } from './series';
import { num, obj, str, type Props } from '../../core/props';


export type Column = (number | null)[];

/** TradingView sends "no value" as null, NaN or a 1e100-sized sentinel. */
const value = (v: unknown): number | null => {
  const n = num(v, null);
  return n === null || Math.abs(n) >= 1e99 ? null : n;
};

/**
 * Turns stored rows `[time, plot0, plot1, ...]` into one column per plot,
 * aligned with the chart's bars. Rows for times without a bar are dropped so
 * every series shares the bars' time scale positions.
 */
export function alignRows(rows: readonly (number | null)[][], plotCount: number, barTimes: readonly number[]): Column[] {
  const byTime = new Map<number, readonly (number | null)[]>();
  for (const row of rows) if (typeof row[0] === 'number') byTime.set(row[0], row);
  return Array.from({ length: plotCount }, (_, p) => barTimes.map((t) => value(byTime.get(t)?.[p + 1])));
}

export interface Band {
  price: number;
  color: string;
  lineStyle: LineStyle;
  lineWidth: LineWidth;
}

export type Paint = { color: string } | { gradient: { topColor: string; bottomColor: string; topValue: number; bottomValue: number } };

export type FillPlan =
  | { kind: 'between-prices'; top: number; bottom: number; color: string }
  | { kind: 'between-plots'; a: Column; b: Column; paint: Paint }
  | { kind: 'bar-background'; colors: (string | null)[] };

export interface PlotSeries {
  plotId: string;
  title: string;
  /** Main colour, for the legend. */
  color: string;
  /** Per-bar colours from the plot's colorer, when it has one. */
  barColors: (string | null)[] | null;
  /** Whether TradingView shows the plot's value in the indicator's legend. */
  inLegend: boolean;
  spec: SeriesSpec<'Line' | 'Histogram' | 'Area'>;
  values: Column;
}

export interface StudyRender {
  series: PlotSeries[];
  bands: Band[];
  fills: FillPlan[];
  /** Visible plots of kinds the viewer cannot draw (Pine shapes, bar colours, candles). */
  unsupported: string[];
}

/** Plot kinds that draw nothing on the chart. */
const INVISIBLE_KINDS = new Set(['alertcondition', 'data', 'dataoffset']);
/** Plot kinds that only modify another plot, counted with the plot they belong to. */
const PART_KINDS = new Set(['colorer', 'ohlc_high', 'ohlc_low', 'ohlc_close', 'ohlc_colorer', 'wick_colorer', 'border_colorer', 'up_colorer', 'down_colorer', 'text_colorer']);

/** TradingView `display` bit masks of plots and inputs: 1 chart pane, 4 price scale, 8 legend ("status line"). Missing means everything. */
const DISPLAY = { pane: 1, priceScale: 4, legend: 8 } as const;
const displays = (display: unknown, bit: number) => display === undefined || (Number(display) & bit) !== 0;

export const shownOnPane = (style: Props): boolean => style.visible !== false && displays(style.display, DISPLAY.pane);

/** The colour without its transparency, as TradingView paints legend values and price axis labels. */
export function opaque(color: string): string {
  const c = parseColor(color);
  return c ? rgbaCss({ ...c, a: 1 }) : color;
}

const HIDDEN_INPUT = /^(__|pine)/;

/** Inputs TradingView leaves out of one indicator's legend: Volume shows its MA length only while the MA is drawn. */
function skippedLegendInputs(study: ParsedStudy): string[] {
  const ma = obj(study.styles.vol_ma);
  return study.metaInfoId.startsWith('Volume@') && (ma.visible === false || ma.display === 0) ? ['length'] : [];
}

const shortInput = (v: unknown): v is number | string => typeof v === 'number' || (typeof v === 'string' && v !== '' && v.length < 24);

/** "14 close": the input values TradingView shows after an indicator's name, in the order of its inputs. */
export function legendInputs(study: ParsedStudy): string[] {
  const metaInputs = Array.isArray(study.metaInfo?.inputs) ? study.metaInfo.inputs.map(obj) : null;
  if (!metaInputs) return Object.entries(study.inputs).filter(([k, v]) => !HIDDEN_INPUT.test(k) && shortInput(v)).map(([, v]) => String(v));
  const skipped = skippedLegendInputs(study);
  const out: string[] = [];
  for (const input of metaInputs) {
    const id = str(input.id, '');
    const v = study.inputs[id];
    if (HIDDEN_INPUT.test(id) || input.isHidden === true || !displays(input.display, DISPLAY.legend) || skipped.includes(id) || !shortInput(v)) continue;
    out.push(str(obj(input.optionsTitles)[String(v)], String(v)));
  }
  return out;
}

function paletteColor(study: ParsedStudy, paletteId: string, raw: number | null, transparency: unknown): string | null {
  if (raw === null) return null;
  const metaPalette = obj(obj(study.metaInfo?.palettes)[paletteId]);
  const valToIndex = obj(metaPalette.valToIndex);
  const index = num(valToIndex[String(raw)], null) ?? raw;
  const entry = obj(obj(obj(obj(study.state.palettes)[paletteId]).colors)[String(index)]);
  return typeof entry.color === 'string' ? withTransparency(entry.color, transparency) : null;
}

export function studyPriceFormat(study: ParsedStudy, main: PriceFormatSpec): PriceFormatSpec {
  const format = obj(study.metaInfo?.format);
  if (format.type === 'volume') return { type: 'volume' };
  if (format.type === 'percent') return { type: 'percent' };
  const precision = num(format.precision, null);
  if (format.type === 'price' && precision !== null) return { type: 'price', precision, minMove: Number((10 ** -precision).toFixed(precision)) };
  return main;
}

function plotSeries(study: ParsedStudy, plot: PlotDef, values: Column, colors: (string | null)[] | undefined, times: readonly number[]): PlotSeries {
  const style = obj(study.styles[plot.id]);
  const color = withTransparency(str(style.color, '#2962FF'), style.transparency);
  const pointColor = (i: number) => colors?.[i] ?? undefined;
  const common = {
    priceLineVisible: style.trackPrice === true,
    priceLineColor: color,
    lastValueVisible: study.state.showLabelsOnPriceScale !== false && displays(style.display, DISPLAY.priceScale),
  };
  const legend = { barColors: colors ?? null, inLegend: displays(style.display, DISPLAY.legend) };
  const title = str(style.title, plot.id);
  const plottype = typeof style.plottype === 'number' ? style.plottype : 0;
  const t = (i: number) => ts(times[i]!);

  if (plottype === 1 || plottype === 5) {
    const base = num(obj(obj(study.metaInfo?.styles)[plot.id]).histogramBase, 0);
    return {
      plotId: plot.id,
      title,
      color,
      ...legend,
      values,
      spec: {
        kind: 'Histogram',
        options: { ...common, color, base },
        data: values.map((v, i) => {
          const c = pointColor(i);
          return v === null ? { time: t(i) } : { time: t(i), value: v, ...(c ? { color: c } : {}) };
        }),
      },
    };
  }

  if (plottype === 4 || plottype === 8) {
    return {
      plotId: plot.id,
      title,
      color,
      ...legend,
      values,
      spec: {
        kind: 'Area',
        options: { ...common, lineColor: color, topColor: color, bottomColor: color, lineWidth: lineWidth(style.linewidth), lineStyle: lwcLineStyle(style.linestyle) },
        data: values.map((v, i) => (v === null ? { time: t(i) } : { time: t(i), value: v })),
      },
    };
  }

  const markers = plottype === 3 || plottype === 6;
  const steps = plottype === 9 || plottype === 10 || plottype === 11;
  // A plain line bridges missing values; "with breaks" styles and markers leave gaps.
  const bridges = plottype === 0 || plottype === 9;
  const data = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) {
      if (!bridges) data.push({ time: t(i) });
      continue;
    }
    const c = pointColor(i);
    data.push({ time: t(i), value: v, ...(c ? { color: c } : {}) });
  }
  return {
    plotId: plot.id,
    title,
    color,
    ...legend,
    values,
    spec: {
      kind: 'Line',
      options: {
        ...common,
        color,
        lineWidth: lineWidth(style.linewidth),
        lineStyle: lwcLineStyle(style.linestyle),
        lineType: steps ? 1 : 0,
        lineVisible: !markers,
        pointMarkersVisible: markers,
        ...(markers ? { pointMarkersRadius: lineWidth(style.linewidth) + 1 } : {}),
        crosshairMarkerVisible: !markers,
      },
      data,
    },
  };
}

function bands(study: ParsedStudy): Band[] {
  const raw = Array.isArray(study.state.bands) ? study.state.bands : [];
  return raw
    .map(obj)
    .filter((b) => b.visible !== false && num(b.value, null) !== null)
    .map((b) => ({ price: num(b.value, null)!, color: str(b.color, '#787B86'), lineStyle: lwcLineStyle(b.linestyle), lineWidth: lineWidth(b.linewidth) }));
}

function bandValueById(study: ParsedStudy, id: string): number | null {
  const metaBands = Array.isArray(study.metaInfo?.bands) ? study.metaInfo.bands.map(obj) : [];
  const i = metaBands.findIndex((b) => b.id === id);
  const stateBands = Array.isArray(study.state.bands) ? study.state.bands.map(obj) : [];
  return i < 0 ? null : num(stateBands[i]?.value, null);
}

function fills(study: ParsedStudy, columnsById: Map<string, Column>, linePlots: PlotSeries[]): FillPlan[] {
  const out: FillPlan[] = [];
  const st = study.state;

  const bg = obj(st.bandsBackground);
  const stateBands = Array.isArray(st.bands) ? st.bands.map(obj) : [];
  const b0 = num(stateBands[0]?.value, null);
  const b1 = num(stateBands[1]?.value, null);
  if (bg.fillBackground === true && b0 !== null && b1 !== null) {
    out.push({ kind: 'between-prices', top: Math.max(b0, b1), bottom: Math.min(b0, b1), color: fillColor(str(bg.backgroundColor, '#9915ff'), bg.transparency) });
  }

  const area = obj(st.areaBackground);
  if (area.fillBackground === true && linePlots.length >= 2) {
    const cols = linePlots.map((p) => p.values);
    const len = cols[0]!.length;
    const hi: Column = [];
    const lo: Column = [];
    for (let i = 0; i < len; i++) {
      const vs = cols.map((c) => c[i]).filter((v): v is number => typeof v === 'number');
      hi.push(vs.length ? Math.max(...vs) : null);
      lo.push(vs.length ? Math.min(...vs) : null);
    }
    out.push({ kind: 'between-plots', a: hi, b: lo, paint: { color: fillColor(str(area.backgroundColor, '#2196F3'), area.transparency) } });
  }

  const areas = Array.isArray(study.metaInfo?.filledAreas) ? study.metaInfo.filledAreas.map(obj) : [];
  const styles = obj(st.filledAreasStyle);
  for (const fa of areas) {
    const id = str(fa.id, '');
    const style = obj(styles[id]);
    if (fa.isHidden === true || style.visible === false) continue;
    const paint: Paint =
      style.fillType === 'gradient'
        ? {
            gradient: {
              topColor: str(style.topColor, 'rgba(0,0,0,0)'),
              bottomColor: str(style.bottomColor, 'rgba(0,0,0,0)'),
              topValue: num(style.topValue, 0),
              bottomValue: num(style.bottomValue, 0),
            },
          }
        : { color: withTransparency(str(style.color, '#2962FF'), style.transparency) };
    const a = str(fa.objAId, '');
    const b = str(fa.objBId, '');
    if (fa.type === 'hline_hline') {
      const va = bandValueById(study, a);
      const vb = bandValueById(study, b);
      if (va !== null && vb !== null && 'color' in paint) out.push({ kind: 'between-prices', top: Math.max(va, vb), bottom: Math.min(va, vb), color: paint.color });
    } else {
      const ca = columnsById.get(a);
      const cb = columnsById.get(b);
      if (ca && cb) out.push({ kind: 'between-plots', a: ca, b: cb, paint });
    }
  }
  return out;
}

/** Everything one indicator draws, from its stored values. `times` are the display times of the bars. */
export function planStudyRender(study: ParsedStudy, rows: readonly (number | null)[][], barTimes: readonly number[], times: readonly number[]): StudyRender {
  const columns = alignRows(rows, study.plots.length, barTimes);
  const columnsById = new Map(study.plots.map((p, i) => [p.id, columns[i]!]));
  const colorsByTarget = new Map<string, (string | null)[]>();
  const backgrounds: FillPlan[] = [];
  const unsupported: string[] = [];
  const metaPlots = Array.isArray(study.metaInfo?.plots) ? study.metaInfo.plots.map(obj) : [];

  study.plots.forEach((plot, i) => {
    const col = columns[i]!;
    const palette = metaPlots.find((m) => m.id === plot.id)?.palette;
    if (plot.type === 'colorer' && plot.target && typeof palette === 'string') {
      const transparency = obj(study.styles[plot.target]).transparency;
      colorsByTarget.set(plot.target, col.map((v) => paletteColor(study, palette, v, transparency)));
    } else if (plot.type === 'bg_colorer' && typeof palette === 'string') {
      const style = obj(study.styles[plot.id]);
      if (shownOnPane(style)) backgrounds.push({ kind: 'bar-background', colors: col.map((v) => paletteColor(study, palette, v, style.transparency)) });
    }
  });

  const series: PlotSeries[] = [];
  for (const plot of study.plots) {
    const style = obj(study.styles[plot.id]);
    if (INVISIBLE_KINDS.has(plot.type) || PART_KINDS.has(plot.type) || plot.type === 'bg_colorer') continue;
    if (!shownOnPane(style)) continue;
    if (plot.type === 'line') {
      series.push(plotSeries(study, plot, columnsById.get(plot.id)!, colorsByTarget.get(plot.id), times));
    } else {
      unsupported.push(plot.id);
    }
  }

  const linePlots = series.filter((s) => s.spec.kind === 'Line');
  return { series, bands: bands(study), fills: [...backgrounds, ...fills(study, columnsById, linePlots)], unsupported };
}

/** True when a Pine script's stored drawing commands (labels, lines, boxes, tables) are non-empty. */
export function hasPineGraphics(graphics: unknown): boolean {
  if (graphics === null || graphics === undefined) return false;
  if (typeof graphics !== 'object') return Boolean(graphics);
  const g = graphics as Props;
  if ('d' in g) {
    if (typeof g.d !== 'string' || g.d.trim() === '' || g.d.trim() === '{}') return false;
    try {
      return hasPineGraphics(JSON.parse(g.d));
    } catch {
      return true;
    }
  }
  return Object.values(g).some((v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'object' && v !== null ? Object.keys(v).length > 0 : Boolean(v)));
}
