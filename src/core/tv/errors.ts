/**
 * Failures the user can act on. `message` is plain language for Thomas;
 * `detail` is for the log file and bug reports.
 */
export type TvErrorKind =
  | 'not-signed-in'
  | 'rate-limited'
  | 'format-changed'
  | 'limit-reached'
  | 'too-large'
  | 'not-found'
  | 'network'
  | 'server';

export class TvError extends Error {
  constructor(
    readonly kind: TvErrorKind,
    message: string,
    readonly detail = '',
    /** Values the window fills into its own wording, such as the plan and its layout limit. */
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = 'TvError';
  }
}

export const formatChanged = (what: string, detail: string) =>
  new TvError(
    'format-changed',
    `TradingView answered in a way ChartKeeper does not recognise (${what}). TradingView has probably changed something. Nothing was saved. Please check for a ChartKeeper update.`,
    detail,
  );
