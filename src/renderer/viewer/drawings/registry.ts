import type { DrawingPoint } from '../../../core/layout';
import { pstr, type DrawContext, type Props } from './canvas';
import { drawFibExtension, drawFibRetracement } from './fib';
import { drawCrossLine, drawHorzLine, drawHorzRay, drawVertLine, polylineDrawer, segmentDrawer } from './lines';
import { arrowMarkDrawer, bubbleDrawer, drawArrowMarker, drawCallout, drawFlag, drawNote, drawPriceNote, drawTextTool } from './marks';
import { drawCircle, drawEllipse, drawParallelChannel, drawRectangle, drawTriangle, rangeDrawer, riskRewardDrawer } from './shapes';

export type AxisLabel = { axis: 'price'; price: number; color: string } | { axis: 'time'; point: DrawingPoint; color: string };

export interface DrawingKind {
  /** Points the tool needs; drawings with fewer are listed as not shown. */
  minPoints: number;
  draw(dc: DrawContext, props: Props, points: DrawingPoint[]): void;
  axisLabels?(props: Props, points: DrawingPoint[]): AxisLabel[];
}

const lineColor = (p: Props) => pstr(p, 'linecolor', '#2962FF');
const priceLabel = (p: Props, pts: DrawingPoint[]): AxisLabel[] => (p.showPrice === false ? [] : [{ axis: 'price', price: pts[0]!.price, color: lineColor(p) }]);
const timeLabel = (p: Props, pts: DrawingPoint[]): AxisLabel[] => (p.showTime === false ? [] : [{ axis: 'time', point: pts[0]!, color: lineColor(p) }]);

const kind = (minPoints: number, draw: DrawingKind['draw'], axisLabels?: DrawingKind['axisLabels']): DrawingKind => ({ minPoints, draw, ...(axisLabels ? { axisLabels } : {}) });

/** TradingView tool type -> renderer. Supporting a new tool is one entry here. */
export const DRAWING_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolTrendLine: kind(2, segmentDrawer({})),
  LineToolRay: kind(2, segmentDrawer({ extendRight: true })),
  LineToolExtended: kind(2, segmentDrawer({ extendLeft: true, extendRight: true })),
  LineToolInfoLine: kind(2, segmentDrawer({ info: true })),
  LineToolArrow: kind(2, segmentDrawer({ rightArrow: true })),
  LineToolHorzLine: kind(1, drawHorzLine, priceLabel),
  LineToolHorzRay: kind(1, drawHorzRay, priceLabel),
  LineToolVertLine: kind(1, drawVertLine, timeLabel),
  LineToolCrossLine: kind(1, drawCrossLine, (p, pts) => [...priceLabel(p, pts), ...timeLabel(p, pts)]),
  LineToolRectangle: kind(2, drawRectangle),
  LineToolEllipse: kind(2, drawEllipse),
  LineToolCircle: kind(2, drawCircle),
  LineToolTriangle: kind(3, drawTriangle),
  LineToolFibRetracement: kind(2, drawFibRetracement),
  LineToolTrendBasedFibExtension: kind(3, drawFibExtension),
  LineToolParallelChannel: kind(3, drawParallelChannel),
  LineToolText: kind(1, drawTextTool),
  LineToolTextAbsolute: kind(1, drawTextTool),
  LineToolNote: kind(1, drawNote),
  LineToolNoteAbsolute: kind(1, drawNote),
  LineToolCallout: kind(1, drawCallout),
  LineToolBalloon: kind(1, bubbleDrawer('balloon')),
  LineToolComment: kind(1, bubbleDrawer('comment')),
  LineToolPriceLabel: kind(1, bubbleDrawer('priceLabel')),
  LineToolPriceNote: kind(1, drawPriceNote),
  LineToolArrowMarkUp: kind(1, arrowMarkDrawer('up')),
  LineToolArrowMarkDown: kind(1, arrowMarkDrawer('down')),
  LineToolArrowMarkLeft: kind(1, arrowMarkDrawer('left')),
  LineToolArrowMarkRight: kind(1, arrowMarkDrawer('right')),
  LineToolArrowMarker: kind(2, drawArrowMarker),
  LineToolFlagMark: kind(1, drawFlag),
  LineToolPath: kind(2, polylineDrawer('path')),
  LineToolPolyline: kind(2, polylineDrawer('polyline')),
  LineToolBrush: kind(2, polylineDrawer('brush')),
  LineToolHighlighter: kind(2, polylineDrawer('highlighter')),
  LineToolPriceRange: kind(2, rangeDrawer('price')),
  LineToolDateRange: kind(2, rangeDrawer('date')),
  LineToolDateAndPriceRange: kind(2, rangeDrawer('both')),
  LineToolRiskRewardLong: kind(1, riskRewardDrawer('long')),
  LineToolRiskRewardShort: kind(1, riskRewardDrawer('short')),
};
