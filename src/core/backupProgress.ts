import { DEFAULT_RATE } from './tv/http';

export type BackupStep = 'list' | 'layout' | 'userDrawings' | 'studyTemplates' | 'drawingTemplates' | 'themes' | 'scripts' | 'prices' | 'finish';

export interface BackupProgress {
  step: BackupStep;
  /** Layout name, for the 'layout' and 'prices' steps. */
  name?: string;
  /** How far the step is through its own list: layouts, templates, drawing tools, themes, scripts or charts. */
  part?: { done: number; total: number };
  /**
   * The whole backup, counted in requests to TradingView, because that is
   * what the time goes on: each request waits its turn 1.5 to 2.5 s. `total`
   * starts as an estimate and firms up as each list arrives; it is 0 until
   * the layout list is in.
   */
  done: number;
  total: number;
}

/**
 * Seconds the rest of the backup should take: at the pace measured so far
 * once there is enough of it to go on, else at the polite rate's average gap.
 * Null until the layout list is in.
 */
export function secondsLeft(p: BackupProgress, elapsedMs: number): number | null {
  if (p.total === 0) return null;
  const typical = (DEFAULT_RATE.minIntervalMs + DEFAULT_RATE.jitterMs / 2) / 1000;
  const perRequest = p.done >= 10 && elapsedMs >= 20_000 ? elapsedMs / 1000 / p.done : typical;
  return Math.max(0, p.total - p.done) * perRequest;
}
