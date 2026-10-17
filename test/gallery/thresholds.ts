/**
 * Lowest acceptable scores for `npm run gallery:compare`, one table per family.
 *
 * Scores are colour- and tolerance-aware F1 overlaps (0..1) between the pixels
 * TradingView drew and the pixels the viewer drew (see test/gallery/pixels.ts).
 * Each value is the worst score measured on the committed gallery on macOS and
 * on Linux (Playwright's Ubuntu image, like CI), less 0.02, rounded down, so
 * a regression fails the run. Fonts differ between the two, which moves
 * text-heavy drawings by up to 0.05. A `reason` says why a tool scores lower.
 */

export interface Threshold {
  min: number;
  reason?: string;
}

/** Per TradingView drawing type; every drawing of that type in every scene must reach it. */
export const DRAWING_THRESHOLDS: Readonly<Record<string, Threshold>> = {
  LineTool5PointsPattern: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolABCD: { min: 0.97 }, // measured macOS 0.998, Linux 1.000
  LineToolAnchoredVWAP: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolArc: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolArrow: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolArrowMarkDown: { min: 0.96 }, // measured macOS 0.987, Linux 0.989
  LineToolArrowMarkLeft: { min: 0.96 }, // measured macOS 0.990, Linux 0.987
  LineToolArrowMarkRight: { min: 0.95 }, // measured macOS 0.975, Linux 0.979
  LineToolArrowMarkUp: { min: 0.94 }, // measured macOS 0.963, Linux 0.961
  LineToolArrowMarker: { min: 0.97 }, // measured macOS 0.998, Linux 1.000
  LineToolBalloon: { min: 0.96 }, // measured macOS 0.987, Linux 0.993
  LineToolBarsPattern: { min: 0.97 }, // measured macOS 0.993, Linux 0.996
  LineToolBezierCubic: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolBezierQuadro: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolBrush: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolCallout: { min: 0.97 }, // measured macOS 0.995, Linux 0.995
  LineToolCircle: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolCircleLines: { min: 0.96 }, // measured macOS 0.981, Linux 0.981
  LineToolComment: { min: 0.94 }, // measured macOS 0.965, Linux 0.977
  LineToolCrossLine: { min: 0.87, reason: "As for the horizontal line: the price- and time-axis label boxes differ slightly." }, // measured macOS 0.916, Linux 0.900
  LineToolCypherPattern: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolDateAndPriceRange: { min: 0.96 }, // measured macOS 1.000, Linux 0.990
  LineToolDateRange: { min: 0.97 }, // measured macOS 0.998, Linux 0.994
  LineToolDisjointAngle: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolElliottCorrection: { min: 0.97 }, // measured macOS 0.999, Linux 0.999
  LineToolElliottDoubleCombo: { min: 0.97 }, // measured macOS 0.999, Linux 0.999
  LineToolElliottImpulse: { min: 0.96 }, // measured macOS 0.984, Linux 0.988
  LineToolElliottTriangle: { min: 0.97 }, // measured macOS 0.997, Linux 0.999
  LineToolElliottTripleCombo: { min: 0.97 }, // measured macOS 0.999, Linux 0.999
  LineToolEllipse: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolEmoji: { min: 0.72, reason: "Drawn with the system emoji font; TradingView draws its own emoji artwork, so the glyph shapes and colours differ." }, // measured macOS 0.744, Linux 0.767
  LineToolExtended: { min: 0.96 }, // measured macOS 0.982, Linux 0.982
  LineToolFibChannel: { min: 0.97 }, // measured macOS 1.000, Linux 0.997
  LineToolFibCircles: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolFibRetracement: { min: 0.97 }, // measured macOS 1.000, Linux 0.999
  LineToolFibSpeedResistanceArcs: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolFibSpeedResistanceFan: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolFibSpiral: { min: 0.97 }, // measured macOS 0.996, Linux 0.996
  LineToolFibTimeZone: { min: 0.96 }, // measured macOS 0.994, Linux 0.990
  LineToolFixedRangeVolumeProfile: { min: 0.96 }, // measured macOS 0.987, Linux 0.987
  LineToolFlagMark: { min: 0.94 }, // measured macOS 0.963, Linux 0.963
  LineToolFlatBottom: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolGannFan: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolGannFixed: { min: 0.97 }, // measured macOS 0.999, Linux 0.999
  LineToolGannSquare: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolGhostFeed: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolHeadAndShoulders: { min: 0.97 }, // measured macOS 0.999, Linux 1.000
  LineToolHighlighter: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolHorzLine: { min: 0.88, reason: "The line matches; the rest is the price-axis label, whose box and font lightweight-charts draws slightly differently from TradingView's." }, // measured macOS 0.901, Linux 0.906
  LineToolHorzRay: { min: 0.89, reason: "As for the horizontal line: the price-axis label box differs slightly." }, // measured macOS 0.917, Linux 0.923
  LineToolIcon: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolInfoLine: { min: 0.92 }, // measured macOS 0.949, Linux 0.959
  LineToolInsidePitchfork: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolNote: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolNoteAbsolute: { min: 0.97 }, // measured macOS 0.994, Linux 0.994
  LineToolParallelChannel: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolPath: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolPitchfan: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolPitchfork: { min: 0.97 }, // measured macOS 0.999, Linux 0.999
  LineToolPolyline: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolPrediction: { min: 0.88 }, // measured macOS 0.951, Linux 0.910
  LineToolPriceLabel: { min: 0.90 }, // measured macOS 0.961, Linux 0.927
  LineToolPriceNote: { min: 0.96 }, // measured macOS 0.984, Linux 0.983
  LineToolPriceRange: { min: 0.96 }, // measured macOS 0.999, Linux 0.986
  LineToolProjection: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolRay: { min: 0.97 }, // measured macOS 0.991, Linux 0.991
  LineToolRectangle: { min: 0.97 }, // measured macOS 0.996, Linux 0.996
  LineToolRegressionTrend: { min: 0.97 }, // measured macOS 1.000, Linux 0.999
  LineToolRiskRewardLong: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolRiskRewardShort: { min: 0.97 }, // measured macOS 0.999, Linux 0.997
  LineToolRotatedRectangle: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolSchiffPitchfork: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolSchiffPitchfork2: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolSignpost: { min: 0.96 }, // measured macOS 0.982, Linux 0.997
  LineToolSineLine: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolSticker: { min: 0.64, reason: "TradingView's stickers are pictures it serves; the viewer draws a stand-in (the bitcoin sticker as a yellow bitcoin sign on a blue disc, without the leaf)." }, // measured macOS 0.665, Linux 0.744
  LineToolTable: { min: 0.97 }, // measured macOS 0.999, Linux 0.995
  LineToolText: { min: 0.91 }, // measured macOS 0.986, Linux 0.937
  LineToolTextAbsolute: { min: 0.97 }, // measured macOS 1.000, Linux 0.991
  LineToolTextNote: { min: 0.94 }, // measured macOS 0.985, Linux 0.962
  LineToolTimeCycles: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolTrendAngle: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolTrendBasedFibExtension: { min: 0.97 }, // measured macOS 1.000, Linux 0.997
  LineToolTrendBasedFibTime: { min: 0.97 }, // measured macOS 0.999, Linux 0.999
  LineToolTrendLine: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolTriangle: { min: 0.98 }, // measured macOS 1.000, Linux 1.000
  LineToolTrianglePattern: { min: 0.97 }, // measured macOS 1.000, Linux 1.000
  LineToolVertLine: { min: 0.92 }, // measured macOS 0.975, Linux 0.949
};

/** Per chart style id, scored on the main pane of the drawing-free render. */
export const STYLE_THRESHOLDS: Readonly<Record<number, Threshold>> = {
  0: { min: 0.92 }, // Bars: macOS 0.944, Linux 0.946
  1: { min: 0.89 }, // Candles: macOS 0.919, Linux 0.923
  2: { min: 0.94 }, // Line: macOS 0.968, Linux 0.970
  3: { min: 0.96 }, // Area: macOS 0.987, Linux 0.988
  4: { min: 0.92 }, // Renko: macOS 0.942, Linux 0.943
  5: { min: 0.90 }, // Kagi: macOS 0.920, Linux 0.921
  6: { min: 0.90 }, // Point & Figure: macOS 0.929, Linux 0.933
  7: { min: 0.92 }, // Line Break: macOS 0.942, Linux 0.941
  8: { min: 0.95 }, // Heikin Ashi: macOS 0.975, Linux 0.975
  9: { min: 0.94 }, // Hollow candles: macOS 0.961, Linux 0.962
  10: { min: 0.95 }, // Baseline: macOS 0.973, Linux 0.974
  11: { min: 0.88 }, // Range: macOS 0.906, Linux 0.909
  12: { min: 0.96 }, // High-Low: macOS 0.984, Linux 0.985
  13: { min: 0.97 }, // Columns: macOS 0.998, Linux 0.998
  14: { min: 0.94 }, // Line with markers: macOS 0.968, Linux 0.970
  15: { min: 0.93 }, // Step line: macOS 0.957, Linux 0.958
  16: { min: 0.95 }, // HLC area: macOS 0.979, Linux 0.980
  21: { min: 0.92 }, // HLC bars: macOS 0.945, Linux 0.946
};

/** Per indicator (metaInfo id before "@"), scored on the pane that shows it. */
export const INDICATOR_THRESHOLDS: Readonly<Record<string, Threshold>> = {
  CCI: { min: 0.94 }, // measured macOS 0.964, Linux 0.962
  CMF: { min: 0.97 }, // measured macOS 0.994, Linux 0.994
  MASimple: { min: 0.89 }, // measured macOS 0.914, Linux 0.915
  PivotPointsHighLow: { min: 0.94 }, // measured macOS 0.965, Linux 0.964
  PivotPointsStandard: { min: 0.94 }, // measured macOS 0.965, Linux 0.964
  ROC: { min: 0.97 }, // measured macOS 0.995, Linux 0.995
  RSI: { min: 0.97 }, // measured macOS 0.997, Linux 0.996
  StochasticRSI: { min: 0.97 }, // measured macOS 1.000, Linux 0.999
  Volume: { min: 0.97 }, // measured macOS 0.992, Linux 0.991
};
