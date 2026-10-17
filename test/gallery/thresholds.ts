/**
 * Lowest acceptable scores for `npm run gallery:compare`, one table per family.
 *
 * Scores are colour- and tolerance-aware F1 overlaps (0..1) between the pixels
 * TradingView drew and the pixels the viewer drew (see test/gallery/pixels.ts). Each value
 * sits just below the score measured on the committed gallery, so a regression
 * fails the run. A `reason` says why a tool can't score higher.
 */

export interface Threshold {
  min: number;
  reason?: string;
}

/** Per TradingView drawing type; every drawing of that type in every scene must reach it. */
export const DRAWING_THRESHOLDS: Readonly<Record<string, Threshold>> = {};

/** Per chart style id, scored on the main pane of the drawing-free render. */
export const STYLE_THRESHOLDS: Readonly<Record<number, Threshold>> = {};

/** Per indicator (metaInfo id before "@"), scored on the pane that shows it. */
export const INDICATOR_THRESHOLDS: Readonly<Record<string, Threshold>> = {};
