/** Restore rules shared by the window and the restore itself. No Node imports: the window bundles this file. */
import type { LayoutCounts } from './layout';

/** The name a restore as a new layout gets, so it sits next to the original without clashing. */
export const restoredName = (name: string, at: Date): string => `${name} (restored ${at.toISOString().slice(0, 10)})`;

export interface Tally {
  count: number;
  ok: boolean;
}

export interface ShownRow {
  expected: number;
  saved: Tally;
  /** What TradingView itself shows when the layout is opened, or 'unchecked' when that could not be counted. */
  shown: Tally | 'unchecked';
}

/**
 * The restore counts as verified only when the read-back matches the backup
 * and TradingView itself shows every drawing and indicator. The read-back
 * alone only proves what was stored.
 */
export interface RestoreCheck {
  verdict: 'verified' | 'mismatch' | 'shown-unchecked';
  charts: { expected: number; saved: Tally };
  drawings: ShownRow;
  indicators: ShownRow;
  missingDrawings: string[];
  extraDrawings: string[];
}

export type PageCount = { drawings: number; studies: number };

export function checkRestore(expected: LayoutCounts, actual: LayoutCounts, shown: PageCount | null): RestoreCheck {
  const have = new Set(actual.drawingIds);
  const want = new Set(expected.drawingIds);
  const missingDrawings = expected.drawingIds.filter((id) => !have.has(id));
  const extraDrawings = actual.drawingIds.filter((id) => !want.has(id));
  const charts = { expected: expected.charts, saved: { count: actual.charts, ok: actual.charts === expected.charts } };
  const drawings: ShownRow = {
    expected: expected.drawings,
    saved: { count: actual.drawings, ok: missingDrawings.length === 0 && extraDrawings.length === 0 },
    shown: shown ? { count: shown.drawings, ok: shown.drawings === expected.drawings } : 'unchecked',
  };
  // TradingView may add indicators of its own when it opens a layout, never fewer.
  const indicators: ShownRow = {
    expected: expected.studies,
    saved: { count: actual.studies, ok: actual.studies === expected.studies },
    shown: shown ? { count: shown.studies, ok: shown.studies >= expected.studies } : 'unchecked',
  };
  const tallies = [charts.saved, drawings.saved, indicators.saved, drawings.shown, indicators.shown];
  const verdict = tallies.some((t) => t !== 'unchecked' && !t.ok) ? 'mismatch' : shown ? 'verified' : 'shown-unchecked';
  return { verdict, charts, drawings, indicators, missingDrawings, extraDrawings };
}
