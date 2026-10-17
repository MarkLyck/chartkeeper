const DAY = 86400;

export type IntervalUnit = 'S' | 'm' | 'D' | 'W' | 'M';
export interface Interval {
  unit: IntervalUnit;
  n: number;
}

/** TradingView interval codes: "1", "60", "240" minutes; "15S"; "D", "2D"; "W"; "M", "3M". */
export function parseInterval(code: string): Interval {
  const m = /^(\d*)([SDWM]?)$/.exec(code.trim());
  if (!m) return { unit: 'D', n: 1 };
  const n = Math.max(1, m[1] ? Number(m[1]) : 1);
  const unit = m[2] ? (m[2] as IntervalUnit) : 'm';
  return { unit, n };
}

export const isIntraday = (i: Interval): boolean => i.unit === 'S' || i.unit === 'm';

const utcDay = (t: number) => Math.floor(t / DAY);
const isWeekend = (day: number) => {
  const dow = (day + 4) % 7; // 1970-01-01 was a Thursday
  return dow === 0 || dow === 6;
};

/**
 * Maps drawing points (a time plus a bar offset) to bar positions on the
 * chart's time scale, including positions before the first bar and after the
 * last one, where there are no bars to look up.
 */
export class TimeIndex {
  readonly interval: Interval;
  private readonly tradesWeekends: boolean;

  constructor(
    readonly times: readonly number[],
    interval: string,
  ) {
    this.interval = parseInterval(interval);
    this.tradesWeekends = times.some((t) => isWeekend(utcDay(t)));
  }

  /** Whole bars from time `a` to a later time `b`, as the time scale would count them. */
  barsBetween(a: number, b: number): number {
    const { unit, n } = this.interval;
    if (b <= a) return 0;
    switch (unit) {
      case 'S':
        return Math.round((b - a) / n);
      case 'm':
        return Math.round((b - a) / (60 * n));
      case 'D': {
        if (this.tradesWeekends) return Math.round((utcDay(b) - utcDay(a)) / n);
        let count = 0;
        for (let d = utcDay(a) + 1; d <= utcDay(b); d++) if (!isWeekend(d)) count++;
        return Math.round(count / n);
      }
      case 'W':
        return Math.round((b - a) / (7 * DAY * n));
      case 'M': {
        const da = new Date(a * 1000);
        const db = new Date(b * 1000);
        return Math.round(((db.getUTCFullYear() - da.getUTCFullYear()) * 12 + db.getUTCMonth() - da.getUTCMonth()) / n);
      }
    }
  }

  /**
   * Bar index for a time: the last bar that opened at or before it, which is
   * how TradingView places a point that falls on a weekend, a holiday or
   * between two bars' opening times.
   */
  indexOf(time: number): number {
    const times = this.times;
    const n = times.length;
    if (n === 0) return 0;
    const first = times[0]!;
    const last = times[n - 1]!;
    if (time > last) return n - 1 + this.barsBetween(last, time);
    if (time < first) return -Math.max(1, this.barsBetween(time, first));
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid]! <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  logical(point: { time: number; offset: number }): number {
    return this.indexOf(point.time) + point.offset;
  }
}

const tzFormatters = new Map<string, Intl.DateTimeFormat>();

/** Seconds to add to a UTC timestamp to get the wall-clock time in `timeZone`. */
export function timeZoneOffset(time: number, timeZone: string): number {
  if (timeZone === 'Etc/UTC' || timeZone === 'UTC' || timeZone === 'exchange') return 0;
  let fmt = tzFormatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch {
      return 0;
    }
    tzFormatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(time * 1000)).map((p) => [p.type, Number(p.value)]));
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) / 1000;
  return wall - time;
}
