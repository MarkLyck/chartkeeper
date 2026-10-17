import type { LineWidth, SeriesDataItemTypeMap, SeriesPartialOptionsMap, Time, UTCTimestamp } from 'lightweight-charts';
import type { ParsedChart } from '../../core/layout';
import type { Bar } from '../../core/model';
import { fillColor, lwcLineStyle } from './colors';

export type SeriesKind = 'Candlestick' | 'Bar' | 'Line' | 'Area' | 'Baseline' | 'Histogram';

/** One lightweight-charts series, described as plain data so it can be built and tested without a DOM. */
export type SeriesSpec<K extends SeriesKind = SeriesKind> = {
  [P in K]: { kind: P; options: SeriesPartialOptionsMap[P]; data: SeriesDataItemTypeMap<Time>[P][] };
}[K];

export type PriceFormatSpec = { type: 'price'; precision: number; minMove: number } | { type: 'volume' } | { type: 'percent' };

export interface MainSeriesSpec {
  spec: SeriesSpec;
  /** Set when the layout's chart type has no offline equivalent and candles are drawn instead. */
  fallbackFrom: number | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export const ts = (t: number) => t as UTCTimestamp;
export const lineWidth = (v: unknown, fallback = 1): LineWidth => Math.min(4, Math.max(1, Math.round(num(v, fallback)))) as LineWidth;

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

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

const PRICE_SOURCES: Record<string, (b: Bar) => number> = {
  open: (b) => b[1],
  high: (b) => b[2],
  low: (b) => b[3],
  close: (b) => b[4],
  hl2: (b) => (b[2] + b[3]) / 2,
  hlc3: (b) => (b[2] + b[3] + b[4]) / 3,
  ohlc4: (b) => (b[1] + b[2] + b[3] + b[4]) / 4,
  hlcc4: (b) => (b[2] + b[3] + 2 * b[4]) / 4,
};
const priceSource = (style: Obj) => PRICE_SOURCES[str(style.priceSource, 'close')] ?? PRICE_SOURCES.close!;

const decimals = (n: number): number => {
  const s = String(n);
  if (s.includes('e')) return 8;
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
};

/**
 * TradingView keeps the symbol's price step on its servers, not in the layout.
 * Closing prices are rounded to that step far more often than intraday
 * prices, so the precision that covers 90% of closes is a good stand-in.
 */
export function guessPriceFormat(bars: readonly Bar[]): { precision: number; minMove: number } {
  if (bars.length === 0) return { precision: 2, minMove: 0.01 };
  const counts = bars.map((b) => Math.min(8, decimals(b[4]))).sort((a, b) => a - b);
  const precision = Math.max(2, counts[Math.floor((counts.length - 1) * 0.9)] ?? 2);
  return { precision, minMove: Number((10 ** -precision).toFixed(precision)) };
}

function candleOptions(style: Obj): SeriesPartialOptionsMap['Candlestick'] {
  const up = str(style.upColor, '#089981');
  const down = str(style.downColor, '#F23645');
  const drawBody = style.drawBody !== false;
  return {
    upColor: drawBody ? up : 'rgba(0,0,0,0)',
    downColor: drawBody ? down : 'rgba(0,0,0,0)',
    borderVisible: style.drawBorder !== false,
    borderUpColor: str(style.borderUpColor, up),
    borderDownColor: str(style.borderDownColor, down),
    wickVisible: style.drawWick !== false,
    wickUpColor: str(style.wickUpColor, up),
    wickDownColor: str(style.wickDownColor, down),
  };
}

const CANDLE_STYLE_KEY: Record<number, string> = { 1: 'candleStyle', 8: 'haStyle', 9: 'hollowCandleStyle' };
const DRAWN_STYLES = new Set([0, 1, 2, 3, 8, 9, 10, 13, 14, 15, 21]);

export function mainSeriesSpec(chart: ParsedChart, bars: readonly Bar[], times: readonly number[]): MainSeriesSpec {
  const st = chart.seriesState;
  const fallbackFrom = DRAWN_STYLES.has(chart.style) ? null : chart.style;
  const style = fallbackFrom === null ? chart.style : 1;
  const priceFormat: PriceFormatSpec = { type: 'price', ...guessPriceFormat(bars) };
  const common = {
    priceFormat,
    priceLineVisible: st.showPriceLine !== false,
    priceLineColor: str(st.priceLineColor, ''),
    priceLineWidth: lineWidth(st.priceLineWidth, 1),
    priceLineStyle: lwcLineStyle(1),
    lastValueVisible: true,
  };
  const t = (i: number) => ts(times[i]!);
  const up = (i: number, onPrevClose: boolean) => {
    const b = bars[i]!;
    const prev = bars[i - 1];
    return onPrevClose && prev ? b[4] >= prev[4] : b[4] >= b[1];
  };

  if (style === 0 || style === 21) {
    const s = obj(style === 21 ? { ...obj(st.barStyle), ...obj(st.hlcBarsStyle) } : st.barStyle);
    const upColor = str(s.upColor, '#089981');
    const downColor = str(s.downColor, '#F23645');
    const onPrev = s.barColorsOnPrevClose === true;
    return {
      fallbackFrom,
      spec: {
        kind: 'Bar',
        options: { ...common, upColor, downColor, thinBars: s.thinBars !== false, openVisible: style !== 21 && s.dontDrawOpen !== true },
        data: bars.map(([, open, high, low, close], i) => ({ time: t(i), open, high, low, close, ...(onPrev ? { color: up(i, true) ? upColor : downColor } : {}) })),
      },
    };
  }

  if (style === 2 || style === 14 || style === 15) {
    const s = obj(style === 2 ? st.lineStyle : style === 14 ? st.lineWithMarkersStyle : st.steplineStyle);
    const src = priceSource(s);
    return {
      fallbackFrom,
      spec: {
        kind: 'Line',
        options: {
          ...common,
          color: str(s.color, '#2962FF'),
          lineWidth: lineWidth(s.linewidth, 2),
          lineStyle: lwcLineStyle(s.linestyle),
          lineType: style === 15 ? 1 : 0,
          pointMarkersVisible: style === 14,
        },
        data: bars.map((b, i) => ({ time: t(i), value: src(b) })),
      },
    };
  }

  if (style === 3) {
    const s = obj(st.areaStyle);
    const src = priceSource(s);
    return {
      fallbackFrom,
      spec: {
        kind: 'Area',
        options: {
          ...common,
          lineColor: str(s.linecolor, '#2962FF'),
          lineWidth: lineWidth(s.linewidth, 2),
          lineStyle: lwcLineStyle(s.linestyle),
          topColor: fillColor(str(s.color1, 'rgba(41, 98, 255, 0.28)'), s.transparency),
          bottomColor: fillColor(str(s.color2, '#2962FF'), s.transparency),
        },
        data: bars.map((b, i) => ({ time: t(i), value: src(b) })),
      },
    };
  }

  if (style === 10) {
    const s = obj(st.baselineStyle);
    const src = priceSource(s);
    const values = bars.map(src);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pct = num(s.baseLevelPercentage, 50);
    const tr = s.transparency;
    return {
      fallbackFrom,
      spec: {
        kind: 'Baseline',
        options: {
          ...common,
          baseValue: { type: 'price', price: hi - ((hi - lo) * pct) / 100 },
          topLineColor: str(s.topLineColor, '#089981'),
          bottomLineColor: str(s.bottomLineColor, '#F23645'),
          topFillColor1: fillColor(str(s.topFillColor1, 'rgba(8, 153, 129, 0.28)'), tr),
          topFillColor2: fillColor(str(s.topFillColor2, 'rgba(8, 153, 129, 0.05)'), tr),
          bottomFillColor1: fillColor(str(s.bottomFillColor1, 'rgba(242, 54, 69, 0.05)'), tr),
          bottomFillColor2: fillColor(str(s.bottomFillColor2, 'rgba(242, 54, 69, 0.28)'), tr),
          lineWidth: lineWidth(s.linewidth, 2),
        },
        data: values.map((value, i) => ({ time: t(i), value })),
      },
    };
  }

  if (style === 13) {
    const s = obj(st.columnStyle);
    const src = priceSource(s);
    const upColor = str(s.upColor, 'rgba(8, 153, 129, 0.5)');
    const downColor = str(s.downColor, 'rgba(242, 54, 69, 0.5)');
    const onPrev = s.barColorsOnPrevClose !== false;
    return {
      fallbackFrom,
      spec: {
        kind: 'Histogram',
        options: { ...common, base: 0 },
        data: bars.map((b, i) => ({ time: t(i), value: src(b), color: up(i, onPrev) ? upColor : downColor })),
      },
    };
  }

  const s = obj(st[CANDLE_STYLE_KEY[style] ?? 'candleStyle']);
  const options = { ...common, ...candleOptions(s) };
  if (style === 8) {
    const ha = heikinAshi(bars);
    return { fallbackFrom, spec: { kind: 'Candlestick', options, data: ha.map((h, i) => ({ time: t(i), ...h })) } };
  }
  if (style === 9) {
    const upColor = str(s.upColor, '#089981');
    const downColor = str(s.downColor, '#F23645');
    return {
      fallbackFrom,
      spec: {
        kind: 'Candlestick',
        options,
        data: bars.map(([, open, high, low, close], i) => {
          const color = up(i, true) ? upColor : downColor;
          return { time: t(i), open, high, low, close, color: close > open ? 'rgba(0,0,0,0)' : color, borderColor: color, wickColor: color };
        }),
      },
    };
  }
  const onPrev = s.barColorsOnPrevClose === true;
  return {
    fallbackFrom,
    spec: {
      kind: 'Candlestick',
      options,
      data: bars.map(([, open, high, low, close], i) => {
        if (!onPrev) return { time: t(i), open, high, low, close };
        const isUp = up(i, true);
        return {
          time: t(i),
          open,
          high,
          low,
          close,
          color: str(isUp ? s.upColor : s.downColor, isUp ? '#089981' : '#F23645'),
          borderColor: str(isUp ? s.borderUpColor : s.borderDownColor, isUp ? '#089981' : '#F23645'),
          wickColor: str(isUp ? s.wickUpColor : s.wickDownColor, isUp ? '#089981' : '#F23645'),
        };
      }),
    },
  };
}
