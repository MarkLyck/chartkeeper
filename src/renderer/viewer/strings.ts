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

export const STRINGS: Strings = {
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
};

export function reasonText(reason: NotShownReason): string {
  const fn = STRINGS.reason[reason.code] as (r: NotShownReason) => string;
  return fn(reason);
}

const DRAWING_NAMES: Record<string, string> = {
  LineToolTrendLine: 'Trend line',
  LineToolRay: 'Ray',
  LineToolExtended: 'Extended line',
  LineToolInfoLine: 'Info line',
  LineToolArrow: 'Arrow',
  LineToolHorzLine: 'Horizontal line',
  LineToolHorzRay: 'Horizontal ray',
  LineToolVertLine: 'Vertical line',
  LineToolCrossLine: 'Cross line',
  LineToolRectangle: 'Rectangle',
  LineToolEllipse: 'Ellipse',
  LineToolCircle: 'Circle',
  LineToolTriangle: 'Triangle',
  LineToolFibRetracement: 'Fib retracement',
  LineToolTrendBasedFibExtension: 'Trend-based fib extension',
  LineToolParallelChannel: 'Parallel channel',
  LineToolText: 'Text',
  LineToolTextAbsolute: 'Anchored text',
  LineToolNote: 'Note',
  LineToolNoteAbsolute: 'Anchored note',
  LineToolCallout: 'Callout',
  LineToolBalloon: 'Balloon',
  LineToolComment: 'Comment',
  LineToolPriceLabel: 'Price label',
  LineToolPriceNote: 'Price note',
  LineToolArrowMarkUp: 'Arrow mark up',
  LineToolArrowMarkDown: 'Arrow mark down',
  LineToolArrowMarkLeft: 'Arrow mark left',
  LineToolArrowMarkRight: 'Arrow mark right',
  LineToolArrowMarker: 'Arrow marker',
  LineToolFlagMark: 'Flag mark',
  LineToolPath: 'Path',
  LineToolPolyline: 'Polyline',
  LineToolBrush: 'Brush',
  LineToolHighlighter: 'Highlighter',
  LineToolPriceRange: 'Price range',
  LineToolDateRange: 'Date range',
  LineToolDateAndPriceRange: 'Date and price range',
  LineToolRiskRewardLong: 'Long position',
  LineToolRiskRewardShort: 'Short position',
};

/** "LineToolGannFan" -> "Gann Fan" for tool types we have no name for. */
const humanize = (type: string): string =>
  type
    .replace(/^LineTool/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim() || type;

export function drawingName(type: string): string {
  return DRAWING_NAMES[type] ?? humanize(type);
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
