import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import type { Bar, StudyValues } from '../../../core/model';
import type { Props } from '../../../core/props';
import type { NotShownReason } from '../strings';
import { pstr, type DrawContext } from './canvas';

/** What axis labels may need beyond the drawing's own state. */
export interface AxisEnv {
  bars: readonly Bar[];
  priceStep: number;
  drawingStudies: Readonly<Record<string, StudyValues>>;
}

export type AxisLabel = { axis: 'price'; price: number; color: string } | { axis: 'time'; point: DrawingPoint; color: string };

export interface DrawingKind {
  /** Points the tool needs; drawings with fewer are listed as not shown. */
  minPoints: number;
  /** `drawing` carries what is not in the style properties: `source.positionPercents`, `source.version`, ... */
  draw(dc: DrawContext, props: Props, points: DrawingPoint[], drawing: ParsedDrawing): void;
  axisLabels?(props: Props, points: DrawingPoint[], env: AxisEnv, drawing: ParsedDrawing): AxisLabel[];
  /** Set when the viewer draws the tool but can't match TradingView exactly; listed as partly shown with this reason. */
  caveat?: NotShownReason;
  /** TradingView draws the tool above the series whatever its saved z-order (study-backed tools such as the volume profile). */
  aboveSeries?: boolean;
}

export const kind = (minPoints: number, draw: DrawingKind['draw'], axisLabels?: DrawingKind['axisLabels'], caveat?: NotShownReason): DrawingKind => ({
  minPoints,
  draw,
  ...(axisLabels ? { axisLabels } : {}),
  ...(caveat ? { caveat } : {}),
});

const lineColor = (p: Props) => pstr(p, 'linecolor', '#2962FF');
export const priceLabel = (p: Props, pts: DrawingPoint[]): AxisLabel[] => (p.showPrice === false ? [] : [{ axis: 'price', price: pts[0]!.price, color: lineColor(p) }]);
export const timeLabel = (p: Props, pts: DrawingPoint[]): AxisLabel[] => (p.showTime === false ? [] : [{ axis: 'time', point: pts[0]!, color: lineColor(p) }]);
