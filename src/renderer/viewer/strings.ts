import type { Lang } from '../../shared/api';

export type NotShownReason =
  | { code: 'hidden' }
  | { code: 'unknown-drawing' }
  | { code: 'too-few-points' }
  | { code: 'other-symbol'; symbol: string }
  | { code: 'symbol-not-in-layout'; symbol: string }
  | { code: 'unreadable'; detail: string }
  | { code: 'no-price-data' }
  | { code: 'study-error'; error: string }
  | { code: 'no-study-values' }
  | { code: 'nothing-to-draw' }
  | { code: 'pane-not-shown' }
  | { code: 'pine-graphics' }
  | { code: 'unsupported-plots'; count: number }
  | { code: 'chart-style'; style: number };

interface Strings {
  notShown: string;
  noPriceDataBanner: string;
  drawing: string;
  indicator: string;
  chart: string;
  reason: { [K in NotShownReason['code']]: (r: Extract<NotShownReason, { code: K }>) => string };
}

const STYLE_NAMES: Record<number, string> = {
  4: 'Renko',
  5: 'Kagi',
  6: 'Point & Figure',
  7: 'Line Break',
  11: 'Range',
  12: 'High-Low',
  16: 'HLC Area',
  17: 'Volume Candles',
  19: 'Volume Footprint',
  20: 'TPO',
  21: 'HLC Bars',
};
export const chartStyleName = (style: number): string => STYLE_NAMES[style] ?? `#${style}`;

export const STRINGS: Record<Lang, Strings> = {
  en: {
    notShown: 'Not shown',
    noPriceDataBanner: 'No price data was saved for this chart, so it cannot be drawn.',
    drawing: 'Drawing',
    indicator: 'Indicator',
    chart: 'Chart',
    reason: {
      hidden: () => 'Hidden in TradingView',
      'unknown-drawing': () => 'This kind of drawing cannot be shown offline yet',
      'too-few-points': () => 'The drawing is missing some of its points',
      'other-symbol': (r) => `Drawn on ${r.symbol}; this chart now shows another symbol`,
      'symbol-not-in-layout': (r) => `Belongs to ${r.symbol}, which no chart in this layout shows`,
      unreadable: (r) => `Could not be read: ${r.detail}`,
      'no-price-data': () => 'No price data was saved for this chart',
      'study-error': (r) => `Could not be calculated: ${r.error}`,
      'no-study-values': () => 'No values were saved for this indicator',
      'nothing-to-draw': () => 'This indicator has nothing the viewer can draw',
      'pane-not-shown': () => 'The indicator panel it sits in is not shown',
      'pine-graphics': () => 'Labels, lines, boxes and tables drawn by the script are not shown',
      'unsupported-plots': (r) => (r.count === 1 ? '1 part (shapes or bar colours) is not drawn' : `${r.count} parts (shapes or bar colours) are not drawn`),
      'chart-style': (r) => `The ${chartStyleName(r.style)} chart type is shown as candles`,
    },
  },
  da: {
    notShown: 'Vises ikke',
    noPriceDataBanner: 'Der blev ikke gemt kursdata for denne graf, så den kan ikke tegnes.',
    drawing: 'Tegning',
    indicator: 'Indikator',
    chart: 'Graf',
    reason: {
      hidden: () => 'Skjult i TradingView',
      'unknown-drawing': () => 'Denne slags tegning kan ikke vises offline endnu',
      'too-few-points': () => 'Tegningen mangler nogle af sine punkter',
      'other-symbol': (r) => `Tegnet på ${r.symbol}; grafen viser nu et andet symbol`,
      'symbol-not-in-layout': (r) => `Hører til ${r.symbol}, som ingen graf i dette layout viser`,
      unreadable: (r) => `Kunne ikke læses: ${r.detail}`,
      'no-price-data': () => 'Der blev ikke gemt kursdata for denne graf',
      'study-error': (r) => `Kunne ikke beregnes: ${r.error}`,
      'no-study-values': () => 'Der blev ikke gemt værdier for denne indikator',
      'nothing-to-draw': () => 'Indikatoren indeholder intet, som kan tegnes',
      'pane-not-shown': () => 'Det indikatorpanel, den ligger i, vises ikke',
      'pine-graphics': () => 'Etiketter, linjer, bokse og tabeller fra scriptet vises ikke',
      'unsupported-plots': (r) => (r.count === 1 ? '1 del (figurer eller søjlefarver) tegnes ikke' : `${r.count} dele (figurer eller søjlefarver) tegnes ikke`),
      'chart-style': (r) => `Graftypen ${chartStyleName(r.style)} vises som lys`,
    },
  },
};

export function reasonText(lang: Lang, reason: NotShownReason): string {
  const fn = STRINGS[lang].reason[reason.code] as (r: NotShownReason) => string;
  return fn(reason);
}

const DRAWING_NAMES: Record<string, [en: string, da: string]> = {
  LineToolTrendLine: ['Trend line', 'Trendlinje'],
  LineToolRay: ['Ray', 'Stråle'],
  LineToolExtended: ['Extended line', 'Forlænget linje'],
  LineToolInfoLine: ['Info line', 'Infolinje'],
  LineToolArrow: ['Arrow', 'Pil'],
  LineToolHorzLine: ['Horizontal line', 'Vandret linje'],
  LineToolHorzRay: ['Horizontal ray', 'Vandret stråle'],
  LineToolVertLine: ['Vertical line', 'Lodret linje'],
  LineToolCrossLine: ['Cross line', 'Krydslinje'],
  LineToolRectangle: ['Rectangle', 'Rektangel'],
  LineToolEllipse: ['Ellipse', 'Ellipse'],
  LineToolCircle: ['Circle', 'Cirkel'],
  LineToolTriangle: ['Triangle', 'Trekant'],
  LineToolFibRetracement: ['Fib retracement', 'Fibonacci-retracement'],
  LineToolTrendBasedFibExtension: ['Trend-based fib extension', 'Trendbaseret Fibonacci-forlængelse'],
  LineToolParallelChannel: ['Parallel channel', 'Parallel kanal'],
  LineToolText: ['Text', 'Tekst'],
  LineToolTextAbsolute: ['Anchored text', 'Fastgjort tekst'],
  LineToolNote: ['Note', 'Note'],
  LineToolNoteAbsolute: ['Anchored note', 'Fastgjort note'],
  LineToolCallout: ['Callout', 'Taleboble med pil'],
  LineToolBalloon: ['Balloon', 'Taleboble'],
  LineToolComment: ['Comment', 'Kommentar'],
  LineToolPriceLabel: ['Price label', 'Prisetiket'],
  LineToolPriceNote: ['Price note', 'Prisnote'],
  LineToolArrowMarkUp: ['Arrow mark up', 'Pil op'],
  LineToolArrowMarkDown: ['Arrow mark down', 'Pil ned'],
  LineToolArrowMarkLeft: ['Arrow mark left', 'Pil til venstre'],
  LineToolArrowMarkRight: ['Arrow mark right', 'Pil til højre'],
  LineToolArrowMarker: ['Arrow marker', 'Pilemarkør'],
  LineToolFlagMark: ['Flag mark', 'Flag'],
  LineToolPath: ['Path', 'Sti'],
  LineToolPolyline: ['Polyline', 'Polylinje'],
  LineToolBrush: ['Brush', 'Pensel'],
  LineToolHighlighter: ['Highlighter', 'Overstregning'],
  LineToolPriceRange: ['Price range', 'Prisinterval'],
  LineToolDateRange: ['Date range', 'Datointerval'],
  LineToolDateAndPriceRange: ['Date and price range', 'Dato- og prisinterval'],
  LineToolRiskRewardLong: ['Long position', 'Lang position'],
  LineToolRiskRewardShort: ['Short position', 'Kort position'],
};

/** "LineToolGannFan" -> "Gann Fan" for tool types we have no name for. */
const humanize = (type: string): string =>
  type
    .replace(/^LineTool/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim() || type;

export function drawingName(type: string, lang: Lang): string {
  const names = DRAWING_NAMES[type];
  if (!names) return humanize(type);
  return lang === 'da' ? names[1] : names[0];
}

const INTERVAL_UNITS: Record<string, string> = { S: 's', D: 'D', W: 'W', M: 'M' };

/** TradingView interval codes as the chart header shows them: "D" -> "1D", "60" -> "1h", "15" -> "15m". */
export function intervalLabel(interval: string): string {
  const m = /^(\d*)([SDWM]?)$/.exec(interval);
  if (!m) return interval;
  const n = m[1] ? Number(m[1]) : 1;
  const unit = m[2] ?? '';
  if (unit) return `${n}${INTERVAL_UNITS[unit]}`;
  if (n % 60 === 0) return `${n / 60}h`;
  return `${n}m`;
}
