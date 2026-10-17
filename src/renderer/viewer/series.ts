import type { CustomSeriesOptions, LineWidth, SeriesDataItemTypeMap, SeriesPartialOptions, SeriesPartialOptionsMap, Time, UTCTimestamp } from 'lightweight-charts';
import type { ParsedChart } from '../../core/layout';
import type { Bar } from '../../core/model';
import { fillColor, lwcLineStyle } from './colors';
import { num, obj, str, type Props } from '../../core/props';
import { brickStyle, highLowStyle } from './styles/boxes';
import { kagiBars, kagiStyle } from './styles/kagi';
import { baselineStyle, hlcAreaStyle, lineStyle, type LineColor, type LineLook } from './styles/lines';
import { pnfBoxSize, pnfStyle } from './styles/pnf';
import type { StyleBar, StyleView } from './styles/view';

export type SeriesKind = 'Candlestick' | 'Bar' | 'Line' | 'Area' | 'Baseline' | 'Histogram';

/** One lightweight-charts series, described as plain data so it can be built and tested without a DOM. */
export type SeriesSpec<K extends SeriesKind = SeriesKind> = {
  [P in K]: { kind: P; options: SeriesPartialOptionsMap[P]; data: SeriesDataItemTypeMap<Time>[P][] };
}[K];

/** A main series lightweight-charts cannot draw the way TradingView does, drawn by one of the viewer's style painters. */
export interface StyleSeriesSpec {
  kind: 'Custom';
  options: SeriesPartialOptions<CustomSeriesOptions>;
  data: StyleBar[];
  style: StyleView<StyleBar>;
}

export type PriceFormatSpec = { type: 'price'; precision: number; minMove: number } | { type: 'volume' } | { type: 'percent' };

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LegendField {
  /** "O", "H", "L", "C", or "" for the single value of line styles. */
  label: string;
  value: (bar: Ohlc) => number;
  color: (index: number) => string;
}

/** What the main legend shows after the symbol, as TradingView's legend does for the chart style. */
export interface MainLegend {
  /** Computed styles name themselves after the symbol: "Line Break [3]". */
  styleName: string;
  fields: LegendField[];
  /** Colour of the change from the previous close; null when the style's legend has no change. */
  change: ((index: number) => string) | null;
}

export interface MainSeriesSpec {
  spec: SeriesSpec | StyleSeriesSpec;
  /** The values drawn for each bar (Heikin Ashi bars when the viewer computes them), for the legend. */
  ohlc: Ohlc[];
  legend: MainLegend;
  /** Set when the layout's chart type has no offline equivalent and candles are drawn instead. */
  fallbackFrom: number | null;
}

export const ts = (t: number) => t as UTCTimestamp;
export const lineWidth = (v: unknown, fallback = 1): LineWidth => Math.min(4, Math.max(1, Math.round(num(v, fallback)))) as LineWidth;

export function heikinAshi(bars: readonly Bar[]): Ohlc[] {
  const out: Ohlc[] = [];
  for (const [, o, h, l, c] of bars) {
    const prev = out[out.length - 1];
    const close = (o + h + l + c) / 4;
    const open = prev ? (prev.open + prev.close) / 2 : (o + c) / 2;
    out.push({ open, close, high: Math.max(h, open, close), low: Math.min(l, open, close) });
  }
  return out;
}

const PRICE_SOURCES: Record<string, (b: Ohlc) => number> = {
  open: (b) => b.open,
  high: (b) => b.high,
  low: (b) => b.low,
  close: (b) => b.close,
  hl2: (b) => (b.high + b.low) / 2,
  hlc3: (b) => (b.high + b.low + b.close) / 3,
  ohlc4: (b) => (b.open + b.high + b.low + b.close) / 4,
  hlcc4: (b) => (b.high + b.low + 2 * b.close) / 4,
};
const priceSource = (style: Props) => PRICE_SOURCES[str(style.priceSource, 'close')] ?? PRICE_SOURCES.close!;

/** Decimals of a price, ignoring float noise such as 342.66999999999996. */
const decimals = (n: number): number => {
  const s = String(Number(n.toFixed(8)));
  if (s.includes('e')) return 8;
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
};

/**
 * TradingView keeps the symbol's price step on its servers, not in the layout.
 * Closing prices are rounded to that step far more often than intraday
 * prices, so the precision that covers 90% of closes is a good stand-in.
 * Heikin Ashi bars TradingView computed average their prices; only their
 * highs and lows are often real prices, so the median of those counts.
 */
export function guessPriceFormat(bars: readonly Bar[], computedStyle?: number): { precision: number; minMove: number } {
  if (bars.length === 0) return { precision: 2, minMove: 0.01 };
  const ha = computedStyle === 8;
  const prices = ha ? bars.flatMap((b) => [b[2], b[3]]) : bars.map((b) => b[4]);
  const counts = prices.map((p) => Math.min(8, decimals(p))).sort((a, b) => a - b);
  const precision = Math.max(2, counts[Math.floor((counts.length - 1) * (ha ? 0.5 : 0.9))] ?? 2);
  return { precision, minMove: Number((10 ** -precision).toFixed(precision)) };
}

/** Styles TradingView draws from bars its servers compute (Renko, Kagi, Point & Figure, Line Break, Heikin Ashi, Range). */
const COMPUTED_STYLES = new Set([4, 5, 6, 7, 8, 11]);
const UP = '#089981';
const DOWN = '#F23645';

interface Ctx {
  st: Props;
  ohlc: Ohlc[];
  t: (i: number) => Time;
  common: SeriesPartialOptions<CustomSeriesOptions>;
  /** Whether bar i closed up, against its open or, with `onPrevClose`, the previous close. */
  up: (i: number, onPrevClose: boolean) => boolean;
  changeColors: { up: string; down: string };
}

type Built = Omit<MainSeriesSpec, 'fallbackFrom' | 'ohlc'>;

const OHLC: { label: string; value: (b: Ohlc) => number }[] = [
  { label: 'O', value: (b) => b.open },
  { label: 'H', value: (b) => b.high },
  { label: 'L', value: (b) => b.low },
  { label: 'C', value: (b) => b.close },
];
const fieldsOf = (labels: string, color: (i: number) => string): LegendField[] => OHLC.filter((f) => labels.includes(f.label)).map((f) => ({ ...f, color }));
const legendOf = (labels: string, color: (i: number) => string, styleName = ''): MainLegend => ({ styleName, fields: fieldsOf(labels, color), change: color });
const closeLegend = (color: (i: number) => string): MainLegend => ({ styleName: '', fields: [{ label: '', value: (b) => b.close, color }], change: color });

const upDown = (s: Props, up = 'upColor', down = 'downColor') => ({ up: str(s[up], UP), down: str(s[down], DOWN) });

function styleSpec(c: Ctx, style: StyleView<StyleBar>, data: StyleBar[], color: string): StyleSeriesSpec {
  return { kind: 'Custom', options: { ...c.common, color }, data, style };
}

const styleBars = (c: Ctx, color?: (i: number) => string): StyleBar[] => c.ohlc.map((b, i) => ({ time: c.t(i), ...b, ...(color ? { color: color(i) } : {}) }));

function lineLook(s: Props): LineLook {
  const color: LineColor =
    s.colorType === 'gradient' ? { top: str(s.gradientStartColor, '#D500F9'), bottom: str(s.gradientEndColor, '#00BCE5') } : str(s.color, '#2962FF');
  return { color, width: num(s.linewidth, 2), style: num(s.linestyle, 0) };
}
const solid = (color: LineColor) => (typeof color === 'string' ? color : color.top);

function bars(c: Ctx, s: Props, openVisible: boolean, colors: { up: string; down: string }): Built {
  const onPrev = s.barColorsOnPrevClose === true;
  const color = (i: number) => (c.up(i, onPrev) ? colors.up : colors.down);
  return {
    spec: {
      kind: 'Bar',
      options: { ...c.common, upColor: colors.up, downColor: colors.down, thinBars: s.thinBars !== false, openVisible: openVisible && s.dontDrawOpen !== true },
      data: c.ohlc.map((b, i) => ({ time: c.t(i), ...b, ...(onPrev ? { color: color(i) } : {}) })),
    },
    legend: legendOf(openVisible ? 'OHLC' : 'HLC', color),
  };
}

function candles(c: Ctx, s: Props, hollow: boolean): Built {
  const up = str(s.upColor, UP);
  const down = str(s.downColor, DOWN);
  const drawBody = s.drawBody !== false;
  const onPrev = hollow || s.barColorsOnPrevClose === true;
  const isUp = (i: number) => c.up(i, onPrev);
  const pick = (i: number, upKey: string, downKey: string) => str(isUp(i) ? s[upKey] : s[downKey], isUp(i) ? up : down);
  return {
    spec: {
      kind: 'Candlestick',
      options: {
        ...c.common,
        upColor: drawBody ? up : 'rgba(0,0,0,0)',
        downColor: drawBody ? down : 'rgba(0,0,0,0)',
        borderVisible: s.drawBorder !== false,
        borderUpColor: str(s.borderUpColor, up),
        borderDownColor: str(s.borderDownColor, down),
        wickVisible: s.drawWick !== false,
        wickUpColor: str(s.wickUpColor, up),
        wickDownColor: str(s.wickDownColor, down),
      },
      data: c.ohlc.map((b, i) => {
        if (!onPrev) return { time: c.t(i), ...b };
        // Hollow candles colour by the previous close and leave rising bodies empty.
        const body = hollow && b.close > b.open ? 'rgba(0,0,0,0)' : pick(i, 'upColor', 'downColor');
        return { time: c.t(i), ...b, color: body, borderColor: pick(i, 'borderUpColor', 'borderDownColor'), wickColor: pick(i, 'wickUpColor', 'wickDownColor') };
      }),
    },
    legend: legendOf('OHLC', (i) => (isUp(i) ? up : down)),
  };
}

/** How each chart style is drawn, by TradingView style id. */
const STYLES: Record<number, (c: Ctx) => Built> = {
  0: (c) => bars(c, obj(c.st.barStyle), true, upDown(obj(c.st.barStyle))),
  1: (c) => candles(c, obj(c.st.candleStyle), false),
  2: (c) => lineFamily(c, obj(c.st.lineStyle), 'line'),
  3: (c) => {
    const s = obj(c.st.areaStyle);
    const lineColor = str(s.linecolor, '#2962FF');
    const src = priceSource(s);
    return {
      spec: {
        kind: 'Area',
        options: {
          ...c.common,
          lineColor,
          lineWidth: lineWidth(s.linewidth, 2),
          lineStyle: lwcLineStyle(s.linestyle),
          topColor: fillColor(str(s.color1, 'rgba(41, 98, 255, 0.28)'), s.transparency),
          bottomColor: fillColor(str(s.color2, '#2962FF'), s.transparency),
        },
        data: c.ohlc.map((b, i) => ({ time: c.t(i), value: src(b) })),
      },
      legend: closeLegend(() => lineColor),
    };
  },
  4: (c) => {
    const s = obj(c.st.renkoStyle);
    const inputs = obj(s.inputs);
    const body = upDown(s);
    const color = (i: number) => (c.up(i, false) ? body.up : body.down);
    const brick = Math.min(...c.ohlc.map((b) => Math.abs(b.close - b.open)).filter((d) => d > 0));
    const view = brickStyle({ body, border: upDown(s, 'borderUpColor', 'borderDownColor'), wick: inputs.wicks === false ? null : upDown(s, 'wickUpColor', 'wickDownColor') });
    return { spec: styleSpec(c, view, styleBars(c, color), body.up), legend: legendOf('OHLC', color, `Renko [${boxLabel(inputs, brick)}]`) };
  },
  5: (c) => {
    const s = obj(c.st.kagiStyle);
    const colors = upDown(s);
    const data = kagiBars(styleBars(c));
    const color = (i: number) => (data[i]!.endYang ? colors.up : colors.down);
    return {
      spec: { kind: 'Custom', options: { ...c.common, color: colors.up }, data: data.map((b, i) => ({ ...b, color: color(i) })), style: kagiStyle(colors) as StyleView<StyleBar> },
      legend: legendOf('OHLC', color, 'Kagi'),
    };
  },
  6: (c) => {
    const s = obj(c.st.pnfStyle);
    const inputs = obj(s.inputs);
    const colors = upDown(s);
    const color = (i: number) => (c.up(i, false) ? colors.up : colors.down);
    const box = pnfBoxSize(c.ohlc, inputs);
    return {
      spec: styleSpec(c, pnfStyle(colors, box), styleBars(c, color), colors.up),
      legend: legendOf('OHLC', color, `PnF [${boxLabel(inputs, box)}, ${num(inputs.reversalAmount, 3)}]`),
    };
  },
  7: (c) => {
    const s = obj(c.st.pbStyle);
    const body = upDown(s);
    const color = (i: number) => (c.up(i, false) ? body.up : body.down);
    const view = brickStyle({ body, border: upDown(s, 'borderUpColor', 'borderDownColor'), wick: null });
    return { spec: styleSpec(c, view, styleBars(c, color), body.up), legend: legendOf('OHLC', color, `Line Break [${num(obj(s.inputs).lb, 3)}]`) };
  },
  8: (c) => candles(c, obj(c.st.haStyle), false),
  9: (c) => candles(c, obj(c.st.hollowCandleStyle), true),
  10: (c) => {
    const s = obj(c.st.baselineStyle);
    const src = priceSource(s);
    const side = (k: 'top' | 'bottom', fill1: string, fill2: string) => ({
      color: str(s[`${k}LineColor`], k === 'top' ? UP : DOWN),
      width: num(s[`${k}LineWidth`], num(s.linewidth, 2)),
      style: num(s[`${k}LineStyle`], 0),
      fill1: fillColor(str(s[`${k}FillColor1`], fill1), s.transparency),
      fill2: fillColor(str(s[`${k}FillColor2`], fill2), s.transparency),
    });
    const look = {
      levelPercent: num(s.baseLevelPercentage, 50),
      baseColor: str(s.baselineColor, '#8C8C8C'),
      top: side('top', 'rgba(8, 153, 129, 0.28)', 'rgba(8, 153, 129, 0.05)'),
      bottom: side('bottom', 'rgba(242, 54, 69, 0.05)', 'rgba(242, 54, 69, 0.28)'),
    };
    const values = c.ohlc.map(src);
    // The base level depends on the prices on screen; the legend compares with the level over all bars.
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const base = lo + ((hi - lo) * look.levelPercent) / 100;
    const color = (i: number) => (values[i]! >= base ? look.top.color : look.bottom.color);
    const data = c.ohlc.map((b, i) => ({ time: c.t(i), open: values[i]!, high: values[i]!, low: values[i]!, close: values[i]!, color: color(i) }));
    return { spec: styleSpec(c, baselineStyle(look), data, look.top.color), legend: closeLegend(color) };
  },
  11: (c) => {
    const s = obj(c.st.rangeStyle);
    const candle = { upColor: s.candlesUpColor, downColor: s.candlesDownColor, borderUpColor: s.candlesBorderUpColor, borderDownColor: s.candlesBorderDownColor, wickUpColor: s.candlesWickUpColor, wickDownColor: s.candlesWickDownColor };
    const built = s.barStyle === 0 ? bars(c, s, true, upDown(s)) : candles(c, candle, false);
    return { ...built, legend: { ...built.legend, styleName: 'Range' } };
  },
  12: (c) => {
    const s = obj(c.st.hiloStyle);
    const color = str(s.color, '#2962FF');
    const view = highLowStyle({
      body: s.drawBody === false ? null : color,
      border: s.showBorders === false ? null : str(s.borderColor, color),
      label: s.showLabels === false ? null : str(s.labelColor, color),
      formatPrice: (p) => p.toFixed(2),
      font: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
    });
    return { spec: styleSpec(c, view, styleBars(c), color), legend: { styleName: '', fields: fieldsOf('HL', () => color), change: null } };
  },
  13: (c) => {
    const s = obj(c.st.columnStyle);
    const src = priceSource(s);
    const upColor = str(s.upColor, 'rgba(8, 153, 129, 0.5)');
    const downColor = str(s.downColor, 'rgba(242, 54, 69, 0.5)');
    const onPrev = s.barColorsOnPrevClose !== false;
    const color = (i: number) => (c.up(i, onPrev) ? upColor : downColor);
    return {
      spec: { kind: 'Histogram', options: { ...c.common, base: 0 }, data: c.ohlc.map((b, i) => ({ time: c.t(i), value: src(b), color: color(i) })) },
      legend: closeLegend(color),
    };
  },
  14: (c) => lineFamily(c, obj(c.st.lineWithMarkersStyle), 'markers'),
  15: (c) => lineFamily(c, obj(c.st.steplineStyle), 'step'),
  16: (c) => {
    const s = obj(c.st.hlcAreaStyle);
    const line = (k: string, fallback: string) => ({ color: str(s[`${k}LineColor`], fallback), width: num(s[`${k}LineWidth`], 2), style: num(s[`${k}LineStyle`], 0) });
    const high = line('high', '#00bcd4');
    const low = line('low', '#e91e63');
    const close = line('close', '#2962FF');
    const view = hlcAreaStyle({
      high: { ...high, visible: s.highLineVisible !== false },
      low: { ...low, visible: s.lowLineVisible !== false },
      close,
      highFill: str(s.highCloseFillColor, 'rgba(0, 188, 212, 0.25)'),
      lowFill: str(s.closeLowFillColor, 'rgba(233, 30, 99, 0.25)'),
    });
    const fields: LegendField[] = [
      { label: 'H', value: (b) => b.high, color: () => high.color },
      { label: 'L', value: (b) => b.low, color: () => low.color },
      { label: 'C', value: (b) => b.close, color: () => close.color },
    ];
    return {
      spec: styleSpec(c, view, styleBars(c), close.color),
      legend: { styleName: '', fields, change: (i) => (c.up(i, true) ? c.changeColors.up : c.changeColors.down) },
    };
  },
  21: (c) => {
    const color = str(obj(c.st.hlcBarsStyle).color, '#2962FF');
    return bars(c, obj(c.st.hlcBarsStyle), false, { up: color, down: color });
  },
};

function lineFamily(c: Ctx, s: Props, shape: 'line' | 'markers' | 'step'): Built {
  const look = lineLook(s);
  const src = priceSource(s);
  const color = solid(look.color);
  const data = c.ohlc.map((b, i) => {
    const v = src(b);
    return { time: c.t(i), open: v, high: v, low: v, close: v };
  });
  return { spec: styleSpec(c, lineStyle(look, shape), data, color), legend: closeLegend(() => color) };
}

/** "ATR(14), 8" for ATR boxes (the size TradingView computed, read from the bars), else the box size. */
function boxLabel(inputs: Props, box: number): string {
  const size = Number(box.toFixed(8));
  return inputs.style === 'ATR' ? `ATR(${num(inputs.atrLength, 14)}), ${size}` : String(size);
}

/**
 * Decides how the main series is drawn. Computed styles draw the bars
 * TradingView computed for them (`computedStyle`); without those bars, Heikin
 * Ashi is computed here and the other computed styles fall back to candles.
 */
export function mainSeriesSpec(chart: ParsedChart, bars: readonly Bar[], times: readonly number[], computedStyle?: number): MainSeriesSpec {
  const st = chart.seriesState;
  const computed = computedStyle === chart.style;
  const fallback = !STYLES[chart.style] || (COMPUTED_STYLES.has(chart.style) && !computed && chart.style !== 8);
  const style = fallback ? 1 : chart.style;
  const ohlc = style === 8 && !computed ? heikinAshi(bars) : bars.map(([, open, high, low, close]) => ({ open, high, low, close }));
  const legendProps = obj(obj(obj(chart.chartProperties).paneProperties).legendProperties);
  const c: Ctx = {
    st,
    ohlc,
    t: (i) => ts(times[i]!),
    common: {
      priceFormat: { type: 'price', ...guessPriceFormat(bars, computed ? computedStyle : undefined) },
      priceLineVisible: st.showPriceLine !== false,
      priceLineColor: str(st.priceLineColor, ''),
      priceLineWidth: lineWidth(st.priceLineWidth, 1),
      priceLineStyle: lwcLineStyle(1),
      lastValueVisible: true,
    },
    up: (i, onPrevClose) => {
      const prev = ohlc[i - 1];
      return onPrevClose && prev ? ohlc[i]!.close >= prev.close : ohlc[i]!.close >= ohlc[i]!.open;
    },
    changeColors: { up: str(legendProps.barChangeUpColor, UP), down: str(legendProps.barChangeDownColor, DOWN) },
  };
  return { ...STYLES[style]!(c), ohlc, fallbackFrom: fallback ? chart.style : null };
}
