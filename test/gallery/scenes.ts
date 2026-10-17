/**
 * Gallery scenes: layouts that scripts/capture-gallery.ts loads into a real
 * signed-out TradingView chart, screenshots, and saves as ChartKeeper
 * snapshots under test/fixtures/gallery/<name>/.
 *
 * Drawings are placed relative to the bars the chart shows, so a scene keeps
 * its shape whatever the latest prices are: `bar` counts bars from the right
 * edge (0 = last bar, negative = future), `price` is a fraction of the price
 * range of the visible bars (0 = lowest low, 1 = highest high) or a field of
 * that bar. A `swing` anchor picks the highest high or lowest low in a bar range.
 */
import { CHART_STYLES, LINE_TOOLS, type FreeChartStyleId, type LineToolType, type SignedOutStudy } from './catalog';

export type Props = Record<string, unknown>;
export type PriceRef = number | 'open' | 'high' | 'low' | 'close';
export type Anchor = readonly [bar: number, price: PriceRef] | { readonly swing: 'high' | 'low'; readonly from: number; readonly to: number };

export interface DrawingSpec {
  readonly type: LineToolType;
  readonly at: readonly Anchor[];
  readonly props?: Props;
}

export interface StudySpec {
  readonly name: SignedOutStudy;
  readonly inputs?: Props;
  readonly overrides?: Props;
}

export interface ChartSpec {
  readonly symbol: string;
  readonly interval: string;
  readonly style: FreeChartStyleId;
  /** Bars between the left edge and the last bar. */
  readonly visibleBars: number;
  /** Empty bars right of the last bar. */
  readonly rightMarginBars: number;
  /** Deep-merged into the main series state (e.g. candleStyle colors). */
  readonly series?: Props;
  /** Deep-merged into the chart's chartProperties. */
  readonly chartProperties?: Props;
  readonly studies: readonly StudySpec[];
  readonly drawings: readonly DrawingSpec[];
}

export interface Scene {
  readonly name: string;
  readonly description: string;
  readonly theme: 'light' | 'dark';
  /** TradingView's multi-chart code; one chart per entry in `charts`. */
  readonly arrangement: 's' | '2h';
  readonly charts: readonly [ChartSpec] | readonly [ChartSpec, ChartSpec];
}

const chart = (c: Pick<ChartSpec, 'symbol'> & Partial<ChartSpec>): ChartSpec => ({
  interval: 'D',
  style: 1,
  visibleBars: 150,
  rightMarginBars: 12,
  studies: [],
  drawings: [],
  ...c,
});

const scene = (s: Omit<Scene, 'theme' | 'arrangement'> & Partial<Pick<Scene, 'theme' | 'arrangement'>>): Scene => ({ theme: 'light', arrangement: 's', ...s });

const d = (type: LineToolType, at: readonly Anchor[], props: Props = {}): DrawingSpec => ({ type, at, props });

// Unit-square point patterns (x: 0 left .. 1 right, y: 0 bottom .. 1 top) used by `tile`.
type Unit = readonly (readonly [number, number])[];
const ZIGZAG: Record<number, Unit> = {
  1: [[0.5, 0.5]],
  2: [[0.08, 0.2], [0.92, 0.8]],
  3: [[0.05, 0.25], [0.5, 0.9], [0.92, 0.45]],
  4: [[0.02, 0.15], [0.33, 0.9], [0.66, 0.4], [0.98, 0.95]],
  5: [[0.02, 0.1], [0.25, 0.9], [0.5, 0.35], [0.75, 0.75], [0.98, 0.2]],
  6: [[0.02, 0.05], [0.2, 0.45], [0.35, 0.25], [0.6, 0.85], [0.75, 0.6], [0.98, 0.98]],
  7: [[0.02, 0.15], [0.16, 0.6], [0.32, 0.3], [0.5, 0.92], [0.68, 0.3], [0.84, 0.6], [0.98, 0.15]],
  8: [[0.02, 0.4], [0.15, 0.7], [0.3, 0.55], [0.45, 0.9], [0.6, 0.3], [0.72, 0.5], [0.86, 0.15], [0.98, 0.6]],
};
const UNIT_OVERRIDES: Partial<Record<LineToolType, Unit>> = {
  LineToolParallelChannel: [[0.05, 0.15], [0.95, 0.55], [0.05, 0.45]],
  LineToolFibChannel: [[0.05, 0.1], [0.95, 0.45], [0.05, 0.35]],
  LineToolFlatBottom: [[0.05, 0.6], [0.95, 0.95], [0.05, 0.15]],
  LineToolDisjointAngle: [[0.05, 0.55], [0.95, 0.95], [0.05, 0.35]],
  LineToolPitchfork: [[0.02, 0.3], [0.45, 0.95], [0.6, 0.2]],
  LineToolSchiffPitchfork: [[0.02, 0.3], [0.45, 0.95], [0.6, 0.2]],
  LineToolSchiffPitchfork2: [[0.02, 0.3], [0.45, 0.95], [0.6, 0.2]],
  LineToolInsidePitchfork: [[0.02, 0.3], [0.45, 0.95], [0.6, 0.2]],
  LineToolPitchfan: [[0.02, 0.3], [0.45, 0.95], [0.6, 0.2]],
  LineToolElliottCorrection: [[0.02, 0.95], [0.33, 0.35], [0.66, 0.7], [0.98, 0.05]],
  LineToolElliottDoubleCombo: [[0.02, 0.95], [0.33, 0.35], [0.66, 0.7], [0.98, 0.05]],
  LineToolElliottTriangle: [[0.02, 0.02], [0.2, 0.98], [0.4, 0.15], [0.6, 0.8], [0.8, 0.3], [0.98, 0.6]],
  LineToolTrianglePattern: [[0.02, 0.95], [0.3, 0.1], [0.6, 0.8], [0.95, 0.3]],
  LineToolRotatedRectangle: [[0.05, 0.3], [0.7, 0.85], [0.3, 0.05]],
  LineToolEllipse: [[0.05, 0.5], [0.95, 0.5], [0.5, 0.95]],
  LineToolCircle: [[0.5, 0.5], [0.8, 0.85]],
  LineToolFibCircles: [[0.5, 0.5], [0.65, 0.8]],
  LineToolFibSpeedResistanceArcs: [[0.1, 0.1], [0.4, 0.6]],
  LineToolFibSpiral: [[0.5, 0.5], [0.65, 0.75]],
  LineToolArc: [[0.05, 0.2], [0.95, 0.2], [0.5, 0.9]],
  LineToolBezierQuadro: [[0.05, 0.2], [0.95, 0.3], [0.5, 1.1]],
  LineToolBezierCubic: [[0.05, 0.5], [0.95, 0.5], [0.3, 1.1], [0.7, -0.1]],
  LineToolTriangle: [[0.05, 0.1], [0.5, 0.95], [0.95, 0.25]],
  LineToolTextNote: [[0.3, 0.3], [0.7, 0.75]],
  LineToolCallout: [[0.25, 0.25], [0.6, 0.8]],
  LineToolPriceNote: [[0.4, 0.4], [0.8, 0.8]],
  LineToolArrowMarker: [[0.2, 0.2], [0.8, 0.8]],
  LineToolGhostFeed: [[0.02, 0.5], [0.35, 0.85], [0.7, 0.3], [0.98, 0.7]],
  LineToolTimeCycles: [[0.1, 0.5], [0.35, 0.5]],
  LineToolCircleLines: [[0.1, 0.5], [0.22, 0.5]],
  LineToolSineLine: [[0.1, 0.2], [0.3, 0.8]],
  LineToolRiskRewardLong: [[0.1, 0.45], [0.9, 0.45]],
  LineToolRiskRewardShort: [[0.1, 0.55], [0.9, 0.55]],
  LineToolPrediction: [[0.1, 0.3], [0.85, 0.85]],
  LineToolProjection: [[0.05, 0.2], [0.5, 0.9], [0.9, 0.45]],
  LineToolBarsPattern: [[0.05, 0.5], [0.4, 0.5]],
  LineToolFibTimeZone: [[0.05, 0.5], [0.15, 0.5]],
};

interface Box {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

/** Splits the visible bars and price range into a grid, row by row from the top left, with a margin around each cell. */
function grid(cols: number, rows: number, visibleBars: number, margin = 0.08): Box[] {
  const out: Box[] = [];
  const w = visibleBars / cols;
  const h = 1 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = visibleBars - c * w;
      out.push({ left: left - w * margin, right: left - w * (1 - margin), top: 1 - r * h - h * margin, bottom: 1 - (r + 1) * h + h * margin });
    }
  }
  return out;
}

const place = (box: Box, unit: Unit): Anchor[] =>
  unit.map(([u, v]) => [Math.round(box.left - u * (box.left - box.right)), +(box.bottom + v * (box.top - box.bottom)).toFixed(4)] as const);

function unitFor(type: LineToolType, count?: number): Unit {
  const known = UNIT_OVERRIDES[type];
  if (known) return known;
  const n = LINE_TOOLS[type].points;
  const unit = ZIGZAG[n === 'n' ? (count ?? 8) : n];
  if (!unit) throw new Error(`No point pattern for ${type}`);
  return unit;
}

interface TileItem {
  readonly type: LineToolType;
  readonly props?: Props;
  /** For tools that take any number of points. */
  readonly count?: number;
}

/** One drawing per grid cell, so the drawings of a family scene do not cover each other. */
function tile(items: readonly TileItem[], cols: number, rows: number, visibleBars = 150): DrawingSpec[] {
  const boxes = grid(cols, rows, visibleBars);
  if (items.length > boxes.length) throw new Error(`${items.length} drawings do not fit a ${cols}x${rows} grid`);
  return items.map((it, i) => d(it.type, place(boxes[i]!, unitFor(it.type, it.count)), it.props));
}

const C = {
  blue: '#2962FF',
  red: '#F23645',
  green: '#089981',
  orange: '#FF9800',
  purple: '#9C27B0',
  teal: '#00BCD4',
  pink: '#E91E63',
  olive: '#808000',
  brown: '#795548',
  navy: '#1A237E',
  gold: '#C9A100',
  gray: '#607D8B',
};

const line = (color: string, width = 2, extra: Props = {}): Props => ({ linecolor: color, linewidth: width, ...extra });
const text = (t: string, color: string, extra: Props = {}): Props => ({ text: t, color, fontsize: 14, ...extra });
// Positions are in price ticks (0.01 for US stocks).
const position = (stop: number, profit: number, extra: Props = {}): Props => ({ stopLevel: stop, profitLevel: profit, ...extra });

const DRAWING_FAMILIES: { name: string; description: string; symbol: string; cols: number; rows: number; items: TileItem[] }[] = [
  {
    name: 'lines',
    description: 'Straight line tools: trend line, ray, info line, extended line, trend angle, arrow, horizontal line and ray, vertical line, cross line.',
    symbol: 'NASDAQ:AAPL',
    cols: 4,
    rows: 3,
    items: [
      { type: 'LineToolTrendLine', props: line(C.blue, 2, { text: 'Trend', showLabel: true }) },
      { type: 'LineToolRay', props: line(C.red, 2) },
      { type: 'LineToolInfoLine', props: line(C.purple, 1) },
      { type: 'LineToolExtended', props: line(C.orange, 1, { linestyle: 2 }) },
      { type: 'LineToolTrendAngle', props: line(C.green, 2) },
      { type: 'LineToolArrow', props: line(C.pink, 3) },
      { type: 'LineToolHorzLine', props: line(C.teal, 2, { text: 'Horizontal line', showLabel: true }) },
      { type: 'LineToolHorzRay', props: line(C.brown, 2, { linestyle: 1 }) },
      { type: 'LineToolVertLine', props: line(C.navy, 2, { text: 'Vertical', showLabel: true }) },
      { type: 'LineToolCrossLine', props: line(C.gold, 1) },
    ],
  },
  {
    name: 'channels',
    description: 'Channels and pitchforks: parallel channel, regression trend, flat top/bottom, disjoint channel, pitchfork, Schiff and modified Schiff, inside pitchfork, pitchfan.',
    symbol: 'NASDAQ:AAPL',
    cols: 3,
    rows: 3,
    items: [
      { type: 'LineToolParallelChannel', props: { backgroundColor: 'rgba(41, 98, 255, 0.15)', labelText: 'Channel', labelVisible: true } },
      { type: 'LineToolRegressionTrend', props: { linewidth: 2 } },
      { type: 'LineToolFlatBottom', props: line(C.orange, 2, { backgroundColor: 'rgba(255, 152, 0, 0.15)' }) },
      { type: 'LineToolDisjointAngle', props: line(C.green, 2, { backgroundColor: 'rgba(8, 153, 129, 0.15)' }) },
      { type: 'LineToolPitchfork', props: { fillBackground: true, transparency: 85 } },
      { type: 'LineToolSchiffPitchfork', props: { fillBackground: true, transparency: 85 } },
      { type: 'LineToolSchiffPitchfork2', props: { fillBackground: false } },
      { type: 'LineToolInsidePitchfork', props: { fillBackground: true, transparency: 80 } },
      { type: 'LineToolPitchfan', props: { fillBackground: true, transparency: 80 } },
    ],
  },
  {
    name: 'fibs',
    description: 'Fibonacci price tools: retracement, trend-based extension, channel, speed resistance fan.',
    symbol: 'NASDAQ:AAPL',
    cols: 2,
    rows: 2,
    items: [
      { type: 'LineToolFibRetracement', props: { showPrices: true, fillBackground: true, transparency: 85 } },
      { type: 'LineToolTrendBasedFibExtension', props: { showPrices: false, fillBackground: true, transparency: 80 } },
      { type: 'LineToolFibChannel', props: { fillBackground: true, transparency: 85 } },
      { type: 'LineToolFibSpeedResistanceFan', props: { fillBackground: true, transparency: 85 } },
    ],
  },
  {
    name: 'fibs-time',
    description: 'Fibonacci time and circle tools: trend-based fib time, fib circles, fib spiral, speed resistance arcs, fib time zone.',
    symbol: 'NASDAQ:MSFT',
    cols: 3,
    rows: 2,
    items: [
      { type: 'LineToolTrendBasedFibTime', props: { fillBackground: true, transparency: 85 } },
      { type: 'LineToolFibCircles', props: { fillBackground: true, transparency: 85 } },
      { type: 'LineToolFibSpiral', props: line(C.purple, 2) },
      { type: 'LineToolFibSpeedResistanceArcs', props: { fillBackground: true, transparency: 85 } },
      { type: 'LineToolFibTimeZone', props: {} },
    ],
  },
  {
    name: 'gann',
    description: 'Gann tools: Gann box, Gann square (saved by TradingView as Gann square fixed), Gann square fixed, Gann fan.',
    symbol: 'NASDAQ:AAPL',
    cols: 2,
    rows: 2,
    items: [
      { type: 'LineToolGannSquare', props: { color: C.blue, fillHorzBackground: true, fillVertBackground: true } },
      { type: 'LineToolGannComplex', props: { reverse: false } },
      { type: 'LineToolGannFixed', props: { reverse: true } },
      { type: 'LineToolGannFan', props: { fillBackground: true, transparency: 85, showLabels: true } },
    ],
  },
  {
    name: 'patterns',
    description: 'Chart patterns: XABCD, cypher, ABCD, triangle pattern, head and shoulders.',
    symbol: 'NASDAQ:NVDA',
    cols: 3,
    rows: 2,
    items: [
      { type: 'LineTool5PointsPattern', props: { color: C.blue, backgroundColor: C.blue, fillBackground: true, transparency: 85 } },
      { type: 'LineToolCypherPattern', props: { color: C.purple, backgroundColor: C.purple, fillBackground: true, transparency: 85 } },
      { type: 'LineToolABCD', props: { color: C.green, linewidth: 2 } },
      { type: 'LineToolTrianglePattern', props: { color: C.orange, backgroundColor: C.orange, fillBackground: true, transparency: 85 } },
      { type: 'LineToolHeadAndShoulders', props: { color: C.red, backgroundColor: C.red, fillBackground: true, transparency: 85 } },
    ],
  },
  {
    name: 'elliott',
    description: 'Elliott waves: impulse, triangle, triple combo, correction, double combo.',
    symbol: 'NASDAQ:NVDA',
    cols: 3,
    rows: 2,
    items: [
      { type: 'LineToolElliottImpulse', props: { color: C.blue, linewidth: 2 } },
      { type: 'LineToolElliottTriangle', props: { color: C.orange, linewidth: 2 } },
      { type: 'LineToolElliottTripleCombo', props: { color: C.green, linewidth: 2 } },
      { type: 'LineToolElliottCorrection', props: { color: C.red, linewidth: 2 } },
      { type: 'LineToolElliottDoubleCombo', props: { color: C.purple, linewidth: 2 } },
    ],
  },
  {
    name: 'shapes',
    description: 'Geometric shapes: rectangle, rotated rectangle, circle, ellipse, triangle, arc, curve, double curve.',
    symbol: 'NASDAQ:AAPL',
    cols: 4,
    rows: 2,
    items: [
      { type: 'LineToolRectangle', props: { color: C.blue, backgroundColor: 'rgba(41, 98, 255, 0.2)', fillBackground: true, linewidth: 2, text: 'Zone', showLabel: true } },
      { type: 'LineToolRotatedRectangle', props: { color: C.purple, backgroundColor: 'rgba(156, 39, 176, 0.2)', fillBackground: true } },
      { type: 'LineToolCircle', props: { color: C.green, backgroundColor: 'rgba(8, 153, 129, 0.2)', fillBackground: true, linewidth: 2 } },
      { type: 'LineToolEllipse', props: { color: C.orange, backgroundColor: 'rgba(255, 152, 0, 0.2)', fillBackground: true, linewidth: 2 } },
      { type: 'LineToolTriangle', props: { color: C.red, backgroundColor: 'rgba(242, 54, 69, 0.2)', fillBackground: true, linewidth: 2 } },
      { type: 'LineToolArc', props: { color: C.teal, backgroundColor: 'rgba(0, 188, 212, 0.2)', fillBackground: true, linewidth: 2 } },
      { type: 'LineToolBezierQuadro', props: line(C.pink, 3) },
      { type: 'LineToolBezierCubic', props: line(C.navy, 3) },
    ],
  },
  {
    name: 'freehand',
    description: 'Freehand and multi-point tools: brush, highlighter, polyline, path.',
    symbol: 'NASDAQ:AAPL',
    cols: 2,
    rows: 2,
    items: [
      { type: 'LineToolBrush', props: line(C.blue, 3), count: 8 },
      { type: 'LineToolHighlighter', props: { linecolor: 'rgba(255, 235, 59, 0.6)', width: 20 }, count: 8 },
      { type: 'LineToolPolyline', props: { linecolor: C.green, linewidth: 2, backgroundColor: 'rgba(8, 153, 129, 0.2)', fillBackground: true }, count: 5 },
      { type: 'LineToolPath', props: { lineColor: C.red, lineWidth: 2, rightEnd: 1 }, count: 6 },
    ],
  },
  {
    name: 'text',
    description: 'Text and notes: text, anchored text, note, anchored note, text note, callout.',
    symbol: 'NASDAQ:AAPL',
    cols: 3,
    rows: 2,
    items: [
      { type: 'LineToolText', props: text('Plain text', C.blue, { fontsize: 18, bold: true }) },
      { type: 'LineToolTextAbsolute', props: text('Anchored text', C.purple) },
      { type: 'LineToolNote', props: { text: 'A note', markerColor: C.orange, textColor: '#131722' } },
      { type: 'LineToolNoteAbsolute', props: { text: 'Anchored note', markerColor: C.green } },
      { type: 'LineToolTextNote', props: { text: 'Text note', lineColor: C.red, textColor: '#ffffff', backgroundColor: C.red } },
      { type: 'LineToolCallout', props: text('Callout', '#ffffff', { backgroundColor: C.teal, bordercolor: C.teal }) },
    ],
  },
  {
    name: 'labels',
    description: 'Labels: balloon, comment, price label, price note, signpost, table.',
    symbol: 'NASDAQ:AAPL',
    cols: 3,
    rows: 2,
    items: [
      { type: 'LineToolBalloon', props: { text: 'Balloon', color: '#ffffff', backgroundColor: C.blue, borderColor: C.blue } },
      { type: 'LineToolComment', props: { text: 'Comment', color: '#ffffff', backgroundColor: C.green, borderColor: C.green } },
      { type: 'LineToolPriceLabel', props: { color: '#ffffff', backgroundColor: C.orange, borderColor: C.orange } },
      { type: 'LineToolPriceNote', props: { lineColor: C.purple, textColor: C.purple, text: 'Price note' } },
      { type: 'LineToolSignpost', props: { text: 'Signpost', plateColor: C.red } },
      { type: 'LineToolTable', props: { backgroundColor: '#ffffff', borderColor: C.gray, textColor: '#131722' } },
    ],
  },
  {
    name: 'marks',
    description: 'Arrows, marks and icons: arrow up/down/left/right, arrow marker, flag, icon, emoji, sticker.',
    symbol: 'NASDAQ:AAPL',
    cols: 3,
    rows: 3,
    items: [
      { type: 'LineToolArrowMarkUp', props: { arrowColor: C.green, color: C.green, text: 'Up', showLabel: true } },
      { type: 'LineToolArrowMarkDown', props: { arrowColor: C.red, color: C.red, text: 'Down', showLabel: true } },
      { type: 'LineToolArrowMarkLeft', props: { arrowColor: C.blue, color: C.blue, text: 'Left', showLabel: true } },
      { type: 'LineToolArrowMarkRight', props: { arrowColor: C.orange, color: C.orange, text: 'Right', showLabel: true } },
      { type: 'LineToolArrowMarker', props: { backgroundColor: C.purple, textColor: C.purple, text: 'Marker' } },
      { type: 'LineToolFlagMark', props: { flagColor: C.red } },
      { type: 'LineToolIcon', props: { color: C.blue, size: 40 } },
      { type: 'LineToolEmoji', props: { emoji: '🚀', size: 40 } },
      { type: 'LineToolSticker', props: { size: 110 } },
    ],
  },
  {
    name: 'positions',
    description: 'Positions, forecasting and volume tools: long position, short position, forecast, projection, anchored VWAP, fixed range volume profile.',
    symbol: 'NASDAQ:AAPL',
    cols: 3,
    rows: 2,
    items: [
      { type: 'LineToolRiskRewardLong', props: position(600, 1200) },
      { type: 'LineToolRiskRewardShort', props: position(500, 900) },
      { type: 'LineToolPrediction', props: { linecolor: C.blue, linewidth: 2 } },
      { type: 'LineToolProjection', props: { color1: 'rgba(41, 98, 255, 0.2)', color2: 'rgba(156, 39, 176, 0.2)', fillBackground: true } },
      { type: 'LineToolAnchoredVWAP', props: {} },
      { type: 'LineToolFixedRangeVolumeProfile', props: {} },
    ],
  },
  {
    name: 'measures',
    description: 'Measuring tools: date range, price range, date and price range, bars pattern, ghost feed.',
    symbol: 'NASDAQ:AAPL',
    cols: 3,
    rows: 2,
    items: [
      { type: 'LineToolDateRange', props: { linecolor: C.blue, backgroundColor: 'rgba(41, 98, 255, 0.2)' } },
      { type: 'LineToolPriceRange', props: { linecolor: C.green, backgroundColor: 'rgba(8, 153, 129, 0.2)' } },
      { type: 'LineToolDateAndPriceRange', props: { linecolor: C.purple, backgroundColor: 'rgba(156, 39, 176, 0.2)' } },
      { type: 'LineToolBarsPattern', props: { color: C.orange, mode: 0 } },
      { type: 'LineToolGhostFeed', props: { transparency: 30 }, count: 4 },
    ],
  },
  {
    name: 'cycles',
    description: 'Cycle tools: cyclic lines, time cycles, sine line.',
    symbol: 'NASDAQ:AAPL',
    cols: 1,
    rows: 3,
    items: [
      { type: 'LineToolCircleLines', props: line(C.blue, 2) },
      { type: 'LineToolTimeCycles', props: line(C.purple, 2, { backgroundColor: 'rgba(156, 39, 176, 0.15)', fillBackground: true }) },
      { type: 'LineToolSineLine', props: line(C.green, 2) },
    ],
  },
];

const drawingScenes: Scene[] = DRAWING_FAMILIES.map((f) =>
  scene({
    name: `drawings-${f.name}`,
    description: f.description,
    charts: [chart({ symbol: f.symbol, drawings: tile(f.items, f.cols, f.rows) })],
  }),
);

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const styleScenes: Scene[] = CHART_STYLES.filter((s) => !('paid' in s)).map((s) =>
  scene({
    name: `style-${slug(s.name)}`,
    description: `${s.name} chart (style ${s.id})${s.computed ? ', bars computed by TradingView' : ''}, with a trend line and a horizontal line.`,
    charts: [
      chart({
        symbol: 'NASDAQ:AAPL',
        style: s.id as FreeChartStyleId,
        visibleBars: 120,
        drawings: [
          d('LineToolTrendLine', [{ swing: 'low', from: 110, to: 70 }, { swing: 'low', from: 40, to: 5 }], line(C.blue, 2, { extendRight: true })),
          d('LineToolHorzLine', [[60, 'high']], line(C.orange, 2, { linestyle: 2 })),
        ],
      }),
    ],
  }),
);

const STUDY_PAIRS: [StudySpec, StudySpec, string][] = [
  [{ name: 'Volume' }, { name: 'Moving Average', inputs: { length: 20 } }, 'AMEX:SPY'],
  [{ name: 'Relative Strength Index' }, { name: 'Stochastic RSI' }, 'NASDAQ:MSFT'],
  [{ name: 'Commodity Channel Index' }, { name: 'Rate Of Change' }, 'NASDAQ:NVDA'],
  [{ name: 'Pivot Points Standard' }, { name: 'Pivot Points High Low' }, 'NYSE:JPM'],
  [{ name: 'Chaikin Money Flow' }, { name: 'Moving Average', inputs: { length: 50 } }, 'NASDAQ:AMZN'],
];

const indicatorScenes: Scene[] = STUDY_PAIRS.map(([a, b, symbol], i) =>
  scene({
    name: `indicators-${i + 1}`,
    description: `${a.name} and ${b.name} on ${symbol}.`,
    charts: [chart({ symbol, studies: [a, b] })],
  }),
);

const advanced = scene({
  name: 'advanced',
  description: 'Dense trader chart: custom candle and background colors, Moving Average 50 and RSI, 21 drawings anchored to real swings (trend lines, fib retracement and extension, channel, pitchfork, zones, positions, notes, arrows, levels).',
  charts: [
    chart({
      symbol: 'NASDAQ:AAPL',
      visibleBars: 170,
      rightMarginBars: 25,
      series: {
        candleStyle: { upColor: '#0EA5E9', downColor: '#F97316', borderUpColor: '#0369A1', borderDownColor: '#C2410C', wickUpColor: '#0369A1', wickDownColor: '#C2410C' },
      },
      chartProperties: {
        paneProperties: { background: '#FBFAF5', backgroundType: 'solid', vertGridProperties: { color: 'rgba(120, 113, 108, 0.12)' }, horzGridProperties: { color: 'rgba(120, 113, 108, 0.12)' } },
        scalesProperties: { textColor: '#44403C' },
      },
      studies: [
        { name: 'Moving Average', inputs: { length: 50 }, overrides: { 'Plot.color': '#7C3AED', 'Plot.linewidth': 2 } },
        { name: 'Relative Strength Index' },
      ],
      drawings: [
        d('LineToolTrendLine', [{ swing: 'low', from: 165, to: 120 }, { swing: 'low', from: 70, to: 30 }], line(C.blue, 2, { extendRight: true })),
        d('LineToolTrendLine', [{ swing: 'high', from: 165, to: 110 }, { swing: 'high', from: 60, to: 15 }], line(C.red, 2, { linestyle: 2 })),
        d('LineToolFibRetracement', [{ swing: 'low', from: 165, to: 100 }, { swing: 'high', from: 100, to: 40 }], { showPrices: true, fillBackground: true, transparency: 90 }),
        d('LineToolTrendBasedFibExtension', [{ swing: 'low', from: 60, to: 35 }, { swing: 'high', from: 35, to: 15 }, { swing: 'low', from: 15, to: 0 }], { fillBackground: false, showPrices: false }),
        d('LineToolParallelChannel', [[150, 0.08], [95, 0.45], [150, 0.3]], { backgroundColor: 'rgba(14, 165, 233, 0.12)', labelVisible: true, labelText: 'Up channel' }),
        d('LineToolPitchfork', [{ swing: 'low', from: 120, to: 95 }, { swing: 'high', from: 95, to: 70 }, { swing: 'low', from: 70, to: 50 }], { fillBackground: true, transparency: 90 }),
        d('LineToolRectangle', [[140, 0.04], [-20, 0.12]], { color: C.green, backgroundColor: 'rgba(8, 153, 129, 0.15)', fillBackground: true, linewidth: 1, text: 'Demand zone', showLabel: true }),
        d('LineToolRectangle', [[90, 0.9], [-20, 0.98]], { color: C.red, backgroundColor: 'rgba(242, 54, 69, 0.12)', fillBackground: true, linewidth: 1, text: 'Supply zone', showLabel: true }),
        d('LineToolRiskRewardLong', [[8, 'close'], [-18, 'close']], position(700, 1500)),
        d('LineToolRiskRewardShort', [[45, 'high'], [30, 'high']], position(500, 800, { compact: true })),
        d('LineToolTextNote', [[110, 0.7], [125, 0.85]], { text: 'Watch the retest', lineColor: C.purple, textColor: '#ffffff', backgroundColor: C.purple }),
        d('LineToolCallout', [{ swing: 'high', from: 100, to: 40 }, [60, 1.02]], text('Earnings high', '#ffffff', { backgroundColor: C.orange, bordercolor: C.orange })),
        d('LineToolText', [[155, 0.96]], text('AAPL swing plan', '#1C1917', { fontsize: 20, bold: true })),
        d('LineToolPriceLabel', [[0, 'close']], { color: '#ffffff', backgroundColor: C.navy, borderColor: C.navy }),
        d('LineToolArrowMarkUp', [{ swing: 'low', from: 70, to: 30 }], { arrowColor: C.green, color: C.green, text: 'Higher low', showLabel: true }),
        d('LineToolArrowMarkDown', [{ swing: 'high', from: 165, to: 110 }], { arrowColor: C.red, color: C.red, text: 'Top', showLabel: true }),
        d('LineToolArrow', [[30, 0.2], [12, 0.38]], line(C.pink, 2)),
        d('LineToolHorzLine', [{ swing: 'high', from: 100, to: 40 }], line(C.gold, 2, { linestyle: 1, text: 'Resistance', showLabel: true })),
        d('LineToolHorzRay', [{ swing: 'low', from: 50, to: 20 }], line(C.teal, 2)),
        d('LineToolPriceNote', [[20, 'close'], [10, 0.55]], { lineColor: C.brown, textColor: C.brown, text: 'Entry' }),
        d('LineToolVertLine', [[75, 0.5]], line(C.gray, 1, { linestyle: 2, text: 'FOMC', showLabel: true })),
      ],
    }),
  ],
});

const advancedDark = scene({
  name: 'advanced-dark',
  description: 'Dark theme on hourly bars: Volume and Commodity Channel Index, 20 drawings using tools the light scene does not (Elliott, ABCD, regression, fib channel, ranges, forecast, highlighter, emoji, ...).',
  theme: 'dark',
  charts: [
    chart({
      symbol: 'NASDAQ:TSLA',
      interval: '60',
      visibleBars: 160,
      rightMarginBars: 20,
      studies: [{ name: 'Volume' }, { name: 'Commodity Channel Index' }],
      drawings: [
        d('LineToolElliottImpulse', [{ swing: 'low', from: 155, to: 135 }, [122, 0.45], [112, 0.3], [90, 0.8], [78, 0.62], [60, 0.95]], { color: '#4DD0E1', linewidth: 2 }),
        d('LineToolABCD', [[55, 0.85], [45, 0.55], [35, 0.75], [22, 0.35]], { color: '#FFB74D', linewidth: 2 }),
        d('LineToolRegressionTrend', [[150, 0.5], [100, 0.5]], {}),
        d('LineToolFibChannel', [[100, 0.15], [40, 0.4], [100, 0.3]], { fillBackground: true, transparency: 90 }),
        d('LineToolInfoLine', [{ swing: 'low', from: 60, to: 30 }, { swing: 'high', from: 30, to: 0 }], line('#81C784', 2)),
        d('LineToolRay', [{ swing: 'high', from: 160, to: 120 }, { swing: 'high', from: 110, to: 70 }], line('#E57373', 2)),
        d('LineToolExtended', [[140, 0.1], [20, 0.3]], line('#BA68C8', 1, { linestyle: 2 })),
        d('LineToolCrossLine', [[10, 'close']], line('#90A4AE', 1)),
        d('LineToolFlagMark', [{ swing: 'high', from: 160, to: 0 }], { flagColor: '#FF5252' }),
        d('LineToolFlagMark', [{ swing: 'low', from: 160, to: 0 }], { flagColor: '#69F0AE' }),
        d('LineToolBalloon', [[130, 0.95]], { text: 'Gap fill?', color: '#ffffff', backgroundColor: '#5C6BC0', borderColor: '#5C6BC0' }),
        d('LineToolSignpost', [[85, 0.5]], { text: 'CPI', plateColor: '#26A69A' }),
        d('LineToolPriceRange', [[70, 'low'], [62, 'high']], { linecolor: '#4FC3F7', backgroundColor: 'rgba(79, 195, 247, 0.2)' }),
        d('LineToolDateRange', [[48, 0.08], [26, 0.18]], { linecolor: '#FFD54F', backgroundColor: 'rgba(255, 213, 79, 0.2)' }),
        d('LineToolEllipse', [[118, 0.55], [100, 0.55], [109, 0.75]], { color: '#F06292', backgroundColor: 'rgba(240, 98, 146, 0.15)', fillBackground: true }),
        d('LineToolTriangle', [[30, 0.6], [20, 0.9], [8, 0.65]], { color: '#AED581', backgroundColor: 'rgba(174, 213, 129, 0.2)', fillBackground: true }),
        d('LineToolHighlighter', [[150, 0.02], [130, 0.06], [110, 0.03], [95, 0.08]], { linecolor: 'rgba(255, 235, 59, 0.5)', width: 14 }),
        d('LineToolEmoji', [[5, 0.98]], { emoji: '⚡', size: 36 }),
        d('LineToolNoteAbsolute', [[140, 0.8]], { text: 'Hourly view', markerColor: '#FFB74D' }),
        d('LineToolPrediction', [[2, 'close'], [-15, 0.9]], { linecolor: '#4DD0E1', linewidth: 2 }),
      ],
    }),
  ],
});

const multichart = scene({
  name: 'multichart',
  description: 'Two charts side by side (layout "2h"): AAPL daily candles with RSI and two drawings, MSFT weekly line with a Moving Average and two drawings.',
  arrangement: '2h',
  charts: [
    chart({
      symbol: 'NASDAQ:AAPL',
      visibleBars: 90,
      studies: [{ name: 'Relative Strength Index' }],
      drawings: [
        d('LineToolTrendLine', [{ swing: 'low', from: 85, to: 50 }, { swing: 'low', from: 30, to: 2 }], line(C.blue, 2)),
        d('LineToolRectangle', [[60, 0.75], [20, 0.95]], { color: C.orange, backgroundColor: 'rgba(255, 152, 0, 0.2)', fillBackground: true }),
      ],
    }),
    chart({
      symbol: 'NASDAQ:MSFT',
      interval: 'W',
      style: 2,
      visibleBars: 80,
      studies: [{ name: 'Moving Average', inputs: { length: 20 } }],
      drawings: [
        d('LineToolFibRetracement', [{ swing: 'low', from: 78, to: 40 }, { swing: 'high', from: 40, to: 0 }], { fillBackground: true, transparency: 90 }),
        d('LineToolText', [[70, 0.95]], text('Weekly', C.purple, { fontsize: 16, bold: true })),
      ],
    }),
  ],
});

export const SCENES: readonly Scene[] = [advanced, advancedDark, ...drawingScenes, ...styleScenes, ...indicatorScenes, multichart];
