/**
 * What a signed-out tradingview.com chart offers, as probed on 2026-10-17
 * (web build 2026-10-16T17:55:37). The gallery scenes draw from these lists
 * and the coverage check proves every entry is either captured or excused.
 */

/**
 * Every drawing tool in the bundle's `supportedLineTools`, with the number of
 * points TradingView's own `pointsCount()` reports. `'n'` means any number
 * (freehand tools, ghost feed).
 */
export const LINE_TOOLS = {
  LineToolBrush: { ui: 'brush', points: 'n' },
  LineToolHighlighter: { ui: 'highlighter', points: 'n' },
  LineToolText: { ui: 'text', points: 1 },
  LineToolTextAbsolute: { ui: 'anchored_text', points: 1 },
  LineToolNote: { ui: 'note', points: 1 },
  LineToolTextNote: { ui: 'text_note', points: 2 },
  LineToolNoteAbsolute: { ui: 'anchored_note', points: 1 },
  LineToolSignpost: { ui: 'signpost', points: 1 },
  LineToolCallout: { ui: 'callout', points: 2 },
  LineToolBalloon: { ui: 'balloon', points: 1 },
  LineToolComment: { ui: 'comment', points: 1 },
  LineToolArrowMarkUp: { ui: 'arrow_up', points: 1 },
  LineToolArrowMarkDown: { ui: 'arrow_down', points: 1 },
  LineToolArrowMarkLeft: { ui: 'arrow_left', points: 1 },
  LineToolArrowMarkRight: { ui: 'arrow_right', points: 1 },
  LineToolPriceLabel: { ui: 'price_label', points: 1 },
  LineToolPriceNote: { ui: 'price_note', points: 2 },
  LineToolArrowMarker: { ui: 'arrow_marker', points: 2 },
  LineToolFlagMark: { ui: 'flag', points: 1 },
  LineToolImage: { ui: 'image', points: 2 },
  LineToolTable: { ui: 'table', points: 1 },
  LineToolVertLine: { ui: 'vertical_line', points: 1 },
  LineToolHorzLine: { ui: 'horizontal_line', points: 1 },
  LineToolCrossLine: { ui: 'cross_line', points: 1 },
  LineToolHorzRay: { ui: 'horizontal_ray', points: 1 },
  LineToolTrendLine: { ui: 'trend_line', points: 2 },
  LineToolInfoLine: { ui: 'info_line', points: 2 },
  LineToolTrendAngle: { ui: 'trend_angle', points: 2 },
  LineToolArrow: { ui: 'arrow', points: 2 },
  LineToolRay: { ui: 'ray', points: 2 },
  LineToolExtended: { ui: 'extended', points: 2 },
  LineToolParallelChannel: { ui: 'parallel_channel', points: 3 },
  LineToolDisjointAngle: { ui: 'disjoint_angle', points: 3 },
  LineToolFlatBottom: { ui: 'flat_bottom', points: 3 },
  LineToolAnchoredVWAP: { ui: 'anchored_vwap', points: 1 },
  LineToolPitchfork: { ui: 'pitchfork', points: 3 },
  LineToolSchiffPitchfork: { ui: 'schiff_pitchfork_modified', points: 3 },
  LineToolSchiffPitchfork2: { ui: 'schiff_pitchfork', points: 3 },
  LineToolInsidePitchfork: { ui: 'inside_pitchfork', points: 3 },
  LineToolPitchfan: { ui: 'pitchfan', points: 3 },
  LineToolGannSquare: { ui: 'gannbox', points: 2 },
  LineToolGannComplex: { ui: 'gannbox_square', points: 2 },
  LineToolGannFixed: { ui: 'gannbox_fixed', points: 2 },
  LineToolGannFan: { ui: 'gannbox_fan', points: 2 },
  LineToolFibRetracement: { ui: 'fib_retracement', points: 2 },
  LineToolTrendBasedFibExtension: { ui: 'fib_trend_ext', points: 3 },
  LineToolFibSpeedResistanceFan: { ui: 'fib_speed_resist_fan', points: 2 },
  LineToolFibTimeZone: { ui: 'fib_timezone', points: 2 },
  LineToolTrendBasedFibTime: { ui: 'fib_trend_time', points: 3 },
  LineToolFibCircles: { ui: 'fib_circles', points: 2 },
  LineToolFibSpiral: { ui: 'fib_spiral', points: 2 },
  LineToolFibSpeedResistanceArcs: { ui: 'fib_speed_resist_arcs', points: 2 },
  LineToolFibChannel: { ui: 'fib_channel', points: 3 },
  LineTool5PointsPattern: { ui: 'xabcd_pattern', points: 5 },
  LineToolCypherPattern: { ui: 'cypher_pattern', points: 5 },
  LineToolABCD: { ui: 'abcd_pattern', points: 4 },
  LineToolTrianglePattern: { ui: 'triangle_pattern', points: 4 },
  LineToolHeadAndShoulders: { ui: 'head_and_shoulders', points: 7 },
  LineToolElliottImpulse: { ui: 'elliott_impulse_wave', points: 6 },
  LineToolElliottTriangle: { ui: 'elliott_triangle_wave', points: 6 },
  LineToolElliottTripleCombo: { ui: 'elliott_triple_combo', points: 6 },
  LineToolElliottCorrection: { ui: 'elliott_correction', points: 4 },
  LineToolElliottDoubleCombo: { ui: 'elliott_double_combo', points: 4 },
  LineToolCircleLines: { ui: 'cyclic_lines', points: 2 },
  LineToolTimeCycles: { ui: 'time_cycles', points: 2 },
  LineToolSineLine: { ui: 'sine_line', points: 2 },
  LineToolRiskRewardLong: { ui: 'long_position', points: 2 },
  LineToolRiskRewardShort: { ui: 'short_position', points: 2 },
  LineToolPrediction: { ui: 'forecast', points: 2 },
  LineToolDateRange: { ui: 'date_range', points: 2 },
  LineToolPriceRange: { ui: 'price_range', points: 2 },
  LineToolDateAndPriceRange: { ui: 'date_and_price_range', points: 2 },
  LineToolBarsPattern: { ui: 'bars_pattern', points: 2 },
  LineToolGhostFeed: { ui: 'ghost_feed', points: 'n' },
  LineToolProjection: { ui: 'projection', points: 3 },
  LineToolRectangle: { ui: 'rectangle', points: 2 },
  LineToolRotatedRectangle: { ui: 'rotated_rectangle', points: 3 },
  LineToolCircle: { ui: 'circle', points: 2 },
  LineToolEllipse: { ui: 'ellipse', points: 3 },
  LineToolTriangle: { ui: 'triangle', points: 3 },
  LineToolPolyline: { ui: 'polyline', points: 'n' },
  LineToolPath: { ui: 'path', points: 'n' },
  LineToolBezierQuadro: { ui: 'curve', points: 3 },
  LineToolBezierCubic: { ui: 'double_curve', points: 4 },
  LineToolArc: { ui: 'arc', points: 3 },
  LineToolIcon: { ui: 'icon', points: 1 },
  LineToolEmoji: { ui: 'emoji', points: 1 },
  LineToolSticker: { ui: 'sticker', points: 1 },
  LineToolRegressionTrend: { ui: 'regression_trend', points: 2 },
  LineToolFixedRangeVolumeProfile: { ui: 'fixed_range_volume_profile', points: 2 },
} as const satisfies Record<string, { ui: string; points: number | 'n' }>;

export type LineToolType = keyof typeof LINE_TOOLS;
export const LINE_TOOL_TYPES = Object.keys(LINE_TOOLS) as LineToolType[];

/** Tools no signed-out chart can show, and why. */
export const NOT_CAPTURABLE: Partial<Record<LineToolType, string>> = {
  LineToolImage: 'Needs an image uploaded to TradingView, which requires an account. The loader drops it without one.',
};

/**
 * Tools TradingView accepts but saves under another type. The gallery keeps
 * them in a scene (the source layout has them) and the coverage table says
 * what TradingView turned them into.
 */
export const SAVED_AS: Partial<Record<LineToolType, LineToolType>> = {
  LineToolGannComplex: 'LineToolGannFixed',
};

/**
 * Source fields some tools need before TradingView's loader accepts them.
 * Without `version: 2` the fib time zone runs a v1 migration that reads
 * properties it no longer has. The study-backed tools build their study from
 * an inline `metaInfo` and throw on `metaInfo.fullId` without one. TradingView's
 * own save writes the same fields.
 */
export const SOURCE_FIELDS: Partial<Record<LineToolType, Record<string, unknown>>> = {
  LineToolFibTimeZone: { version: 2 },
  LineToolAnchoredVWAP: { metaInfo: { id: 'AnchoredVWAP@tv-basicstudies-280', fullId: 'AnchoredVWAP@tv-basicstudies-280', productId: 'tv-basicstudies' } },
  LineToolFixedRangeVolumeProfile: { metaInfo: { id: 'VbPFixed@tv-basicstudies-280', fullId: 'VbPFixed@tv-basicstudies-280', productId: 'tv-basicstudies' } },
};

/** Series `state.style` values. `computed` styles are built by TradingView's servers from the plain bars. */
export const CHART_STYLES = [
  { id: 0, name: 'Bars', computed: false },
  { id: 1, name: 'Candles', computed: false },
  { id: 2, name: 'Line', computed: false },
  { id: 3, name: 'Area', computed: false },
  { id: 4, name: 'Renko', computed: true },
  { id: 5, name: 'Kagi', computed: true },
  { id: 6, name: 'Point & Figure', computed: true },
  { id: 7, name: 'Line Break', computed: true },
  { id: 8, name: 'Heikin Ashi', computed: true },
  { id: 9, name: 'Hollow Candles', computed: false },
  { id: 10, name: 'Baseline', computed: false },
  { id: 11, name: 'Range', computed: true },
  { id: 12, name: 'High-Low', computed: false },
  { id: 13, name: 'Columns', computed: false },
  { id: 14, name: 'Line with Markers', computed: false },
  { id: 15, name: 'Step Line', computed: false },
  { id: 16, name: 'HLC Area', computed: false },
  { id: 17, name: 'Volume Footprint', computed: true, paid: true },
  { id: 18, name: 'Time Price Opportunity', computed: true, paid: true },
  { id: 19, name: 'Volume Candles', computed: true, paid: true },
  { id: 20, name: 'Session Volume Profile', computed: true, paid: true },
  { id: 21, name: 'HLC Bars', computed: false },
] as const;

export type ChartStyleId = (typeof CHART_STYLES)[number]['id'];
type PaidStyle = Extract<(typeof CHART_STYLES)[number], { paid: true }>['id'];
export type FreeChartStyleId = Exclude<ChartStyleId, PaidStyle>;

export const chartStyle = (id: number) => {
  const s = CHART_STYLES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown chart style ${id}`);
  return s;
};

export const PAID_STYLE_REASON = 'Needs a paid plan. On a signed-out chart setChartType() leaves the previous style in place.';

/** Indicators a signed-out chart computes through `createStudy(name)`. At most two per chart. */
export const SIGNED_OUT_STUDIES = [
  'Volume',
  'Moving Average',
  'Relative Strength Index',
  'Stochastic RSI',
  'Commodity Channel Index',
  'Rate Of Change',
  'Pivot Points Standard',
  'Pivot Points High Low',
  'Chaikin Money Flow',
] as const;

export type SignedOutStudy = (typeof SIGNED_OUT_STUDIES)[number];
export const MAX_STUDIES_SIGNED_OUT = 2;
