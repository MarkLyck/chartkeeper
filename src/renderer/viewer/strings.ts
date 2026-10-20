import { LOCALE } from '../../shared/locale';

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
  | { code: 'chart-style'; style: number }
  | { code: 'computed-locally' }
  | { code: 'approximate-symbol' };

interface Strings {
  notShown: string;
  noPriceDataBanner: string;
  drawing: string;
  indicator: string;
  chart: string;
  /** One sentence for all of a chart's drawings that belong to other symbols. `list` names the symbols. */
  otherSymbols: (drawings: number, symbols: number, list: string) => string;
  moreSymbols: (n: number) => string;
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
  17: 'Volume Footprint',
  18: 'Time Price Opportunity',
  19: 'Volume Candles',
  20: 'Session Volume Profile',
  21: 'HLC Bars',
};
export const chartStyleName = (style: number): string => STYLE_NAMES[style] ?? `#${style}`;

export const STRINGS: Strings = {
  notShown: 'Not shown',
  noPriceDataBanner: 'No price data was saved for this chart, so it cannot be drawn.',
  drawing: 'Drawing',
  indicator: 'Indicator',
  chart: 'Chart',
  otherSymbols: (drawings, symbols, list) =>
    `${formatCount(drawings)} ${drawings === 1 ? 'drawing' : 'drawings'} on ${formatCount(symbols)} other ${symbols === 1 ? 'symbol' : 'symbols'} ${drawings === 1 ? 'is' : 'are'} saved in this backup. ` +
    `TradingView shows ${drawings === 1 ? 'it' : 'them'} when the chart is switched to that symbol: ${list}`,
  moreSymbols: (n) => `and ${formatCount(n)} more`,
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
    'computed-locally': () => 'TradingView calculates this on its servers; ChartKeeper draws its own calculation from the saved prices, which can differ slightly',
    'approximate-symbol': () => "Drawn with the closest symbol your computer has; TradingView's artwork can look different",
  },
};

export const formatCount = (n: number) => n.toLocaleString(LOCALE);

export function reasonText(reason: NotShownReason): string {
  const fn = STRINGS.reason[reason.code] as (r: NotShownReason) => string;
  return fn(reason);
}

const DRAWING_NAMES: Record<string, string> = {
  LineToolTrendLine: 'Trend line',
  LineToolRay: 'Ray',
  LineToolExtended: 'Extended line',
  LineToolInfoLine: 'Info line',
  LineToolTrendAngle: 'Trend angle',
  LineToolArrow: 'Arrow',
  LineToolHorzLine: 'Horizontal line',
  LineToolHorzRay: 'Horizontal ray',
  LineToolVertLine: 'Vertical line',
  LineToolCrossLine: 'Cross line',
  LineToolParallelChannel: 'Parallel channel',
  LineToolRegressionTrend: 'Regression trend',
  LineToolFlatBottom: 'Flat top/bottom',
  LineToolDisjointAngle: 'Disjoint channel',
  LineToolPitchfork: 'Pitchfork',
  LineToolSchiffPitchfork: 'Modified Schiff pitchfork',
  LineToolSchiffPitchfork2: 'Schiff pitchfork',
  LineToolInsidePitchfork: 'Inside pitchfork',
  LineToolPitchfan: 'Pitchfan',
  LineToolFibRetracement: 'Fib retracement',
  LineToolTrendBasedFibExtension: 'Trend-based fib extension',
  LineToolFibChannel: 'Fib channel',
  LineToolFibTimeZone: 'Fib time zone',
  LineToolFibSpeedResistanceFan: 'Fib speed resistance fan',
  LineToolTrendBasedFibTime: 'Trend-based fib time',
  LineToolFibCircles: 'Fib circles',
  LineToolFibSpiral: 'Fib spiral',
  LineToolFibSpeedResistanceArcs: 'Fib speed resistance arcs',
  LineToolGannSquare: 'Gann box',
  LineToolGannComplex: 'Gann square',
  LineToolGannFixed: 'Gann square fixed',
  LineToolGannFan: 'Gann fan',
  LineTool5PointsPattern: 'XABCD pattern',
  LineToolCypherPattern: 'Cypher pattern',
  LineToolABCD: 'ABCD pattern',
  LineToolTrianglePattern: 'Triangle pattern',
  LineToolHeadAndShoulders: 'Head and shoulders',
  LineToolElliottImpulse: 'Elliott impulse wave',
  LineToolElliottTriangle: 'Elliott triangle wave',
  LineToolElliottTripleCombo: 'Elliott triple combo wave',
  LineToolElliottCorrection: 'Elliott correction wave',
  LineToolElliottDoubleCombo: 'Elliott double combo wave',
  LineToolCircleLines: 'Cyclic lines',
  LineToolTimeCycles: 'Time cycles',
  LineToolSineLine: 'Sine line',
  LineToolRiskRewardLong: 'Long position',
  LineToolRiskRewardShort: 'Short position',
  LineToolPrediction: 'Forecast',
  LineToolBarsPattern: 'Bars pattern',
  LineToolGhostFeed: 'Ghost feed',
  LineToolProjection: 'Projection',
  LineToolAnchoredVWAP: 'Anchored VWAP',
  LineToolFixedRangeVolumeProfile: 'Fixed range volume profile',
  LineToolPriceRange: 'Price range',
  LineToolDateRange: 'Date range',
  LineToolDateAndPriceRange: 'Date and price range',
  LineToolBrush: 'Brush',
  LineToolHighlighter: 'Highlighter',
  LineToolRectangle: 'Rectangle',
  LineToolRotatedRectangle: 'Rotated rectangle',
  LineToolPath: 'Path',
  LineToolCircle: 'Circle',
  LineToolEllipse: 'Ellipse',
  LineToolPolyline: 'Polyline',
  LineToolTriangle: 'Triangle',
  LineToolArc: 'Arc',
  LineToolBezierQuadro: 'Curve',
  LineToolBezierCubic: 'Double curve',
  LineToolText: 'Text',
  LineToolTextAbsolute: 'Anchored text',
  LineToolNote: 'Note',
  LineToolNoteAbsolute: 'Anchored note',
  LineToolTextNote: 'Text note',
  LineToolCallout: 'Callout',
  LineToolBalloon: 'Balloon',
  LineToolSignpost: 'Signpost',
  LineToolComment: 'Comment',
  LineToolPriceLabel: 'Price label',
  LineToolPriceNote: 'Price note',
  LineToolTable: 'Table',
  LineToolArrowMarkUp: 'Arrow mark up',
  LineToolArrowMarkDown: 'Arrow mark down',
  LineToolArrowMarkLeft: 'Arrow mark left',
  LineToolArrowMarkRight: 'Arrow mark right',
  LineToolArrowMarker: 'Arrow marker',
  LineToolFlagMark: 'Flag mark',
  LineToolIcon: 'Icon',
  LineToolEmoji: 'Emoji',
  LineToolSticker: 'Sticker',
  LineToolImage: 'Image',
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
