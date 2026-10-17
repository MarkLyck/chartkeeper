/** Readers for TradingView's open-ended property bags (drawing and series styles, study metadata). */
export type Props = Record<string, unknown>;

export const isObj = (v: unknown): v is Props => typeof v === 'object' && v !== null && !Array.isArray(v);

export const obj = (v: unknown): Props => (isObj(v) ? v : {});

/** A non-empty string, else `fallback`. */
export const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? v : fallback);

/** Any string, '' included, else `fallback`. */
export const anyStr = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

export const num = <F extends number | null>(v: unknown, fallback: F): number | F => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
