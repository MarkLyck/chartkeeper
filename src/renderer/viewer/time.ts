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
const sameInterval = (a: Interval, b: Interval) => a.unit === b.unit && a.n === b.n;
const intradaySeconds = (i: Interval) => (i.unit === 'm' ? 60 : 1) * i.n;

const utcDay = (t: number) => Math.floor(t / DAY);
const isWeekend = (day: number) => {
  const dow = (day + 4) % 7; // 1970-01-01 was a Thursday
  return dow === 0 || dow === 6;
};
const ymdDay = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) / 1000 / DAY;

export interface TimeIndexOptions {
  /** Exchange holidays after the last bar (YYYYMMDD). */
  holidays?: readonly string[];
}

/**
 * Maps drawing points (a time plus a bar offset) to bar positions on the
 * chart's time scale, including positions before the first bar and after the
 * last one, where there are no bars to look up.
 */
export class TimeIndex {
  readonly interval: Interval;
  private readonly tradesWeekends: boolean;
  /** Intraday: the times of day (UTC seconds) that bars opened at in the last ten days, i.e. the session's bar slots. Empty otherwise. */
  private readonly slots: number[];
  private readonly holidays: ReadonlySet<number>;
  /** Days that have bars: the trading days between the first and the last bar. */
  private readonly barDays: ReadonlySet<number>;

  constructor(
    readonly times: readonly number[],
    interval: string,
    options: TimeIndexOptions = {},
  ) {
    this.interval = parseInterval(interval);
    this.tradesWeekends = times.some((t) => isWeekend(utcDay(t)));
    this.holidays = new Set((options.holidays ?? []).map(ymdDay));
    this.barDays = new Set(times.map(utcDay));
    const last = times[times.length - 1] ?? 0;
    const recent = isIntraday(this.interval) ? times.filter((t) => t > last - 10 * DAY) : [];
    // One day of bars shows no session boundary; plain intervals are the better guess then.
    this.slots = new Set(recent.map(utcDay)).size > 1 ? [...new Set(recent.map((t) => t - utcDay(t) * DAY))].sort((a, b) => a - b) : [];
  }

  /** A day with bars, or, outside the bars, a weekday that is not a known holiday. */
  private isTradingDay(day: number): boolean {
    const n = this.times.length;
    if (n && day >= utcDay(this.times[0]!) && day <= utcDay(this.times[n - 1]!)) return this.barDays.has(day);
    return (this.tradesWeekends || !isWeekend(day)) && !this.holidays.has(day);
  }

  /** Bars from an intraday time before the first bar up to the first bar, counting the session's bar slots on weekdays. */
  private sessionBarsBefore(first: number, time: number): number {
    let count = 0;
    let onSlot = false;
    for (let d = utcDay(time); d <= utcDay(first); d++) {
      if (d !== utcDay(first) && !this.isTradingDay(d)) continue;
      for (const slot of this.slots) {
        const t = d * DAY + slot;
        if (t < time || t >= first) continue;
        if (t === time) onSlot = true;
        count++;
      }
    }
    // A time between two slots belongs to the earlier one, as inside the bars.
    return onSlot ? count : count + 1;
  }

  /**
   * Bars after the last bar up to a later intraday time, counting only the
   * session's bar slots on trading days, so nights, weekends and holidays hold no bars.
   * A time between two slots counts up to the next one, as TradingView does
   * for points beyond the last bar.
   */
  private sessionBarsAfter(last: number, time: number): number {
    let count = 0;
    for (let d = utcDay(last); d <= utcDay(time) + 7; d++) {
      if (d !== utcDay(last) && !this.isTradingDay(d)) continue;
      for (const slot of this.slots) {
        const t = d * DAY + slot;
        if (t <= last) continue;
        count++;
        if (t >= time) return count;
      }
    }
    return count;
  }

  /** Opening times of the `count` bars after the last one, numbered as `indexOf` numbers them: the k-th lands on the last bar's index + k. */
  futureTimes(count: number): number[] {
    const last = this.times[this.times.length - 1];
    if (last === undefined || count <= 0) return [];
    const { unit, n } = this.interval;
    const out: number[] = [];
    const tradingDay = (d: number) => this.tradesWeekends || !isWeekend(d);
    if (this.slots.length > 1) {
      for (let d = utcDay(last); out.length < count; d++) {
        if (d !== utcDay(last) && !this.isTradingDay(d)) continue;
        for (const slot of this.slots) if (d * DAY + slot > last && out.length < count) out.push(d * DAY + slot);
      }
      return out;
    }
    if (unit === 'D') {
      const timeOfDay = last - utcDay(last) * DAY;
      for (let d = utcDay(last) + 1, seen = 0; out.length < count; d++) {
        if (tradingDay(d) && ++seen % n === 0) out.push(d * DAY + timeOfDay);
      }
      return out;
    }
    if (unit === 'M') {
      const at = new Date(last * 1000);
      for (let k = 1; k <= count; k++) out.push(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + k * n, at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes()) / 1000);
      return out;
    }
    const step = unit === 'W' ? 7 * DAY * n : unit === 'm' ? 60 * n : n;
    for (let k = 1; k <= count; k++) out.push(last + k * step);
    return out;
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
    if (time > last) return n - 1 + (this.slots.length > 1 ? this.sessionBarsAfter(last, time) : this.barsBetween(last, time));
    if (time < first) return -(this.slots.length > 1 ? this.sessionBarsBefore(first, time) : Math.max(1, this.barsBetween(time, first)));
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid]! <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Bar position of a drawing point. Its offset counts bars of the interval
   * the point was placed on, so a point drawn on the daily chart as "last bar
   * + 5" is five trading days later on a 5-minute chart too.
   */
  logical(point: { time: number; offset: number; interval?: string | null }): number {
    const own = point.interval ? parseInterval(point.interval) : null;
    if (!point.offset || !own || sameInterval(own, this.interval)) return this.indexOf(point.time) + point.offset;
    return this.indexOf(this.stepBars(point.time, point.offset, own));
  }

  /**
   * The time `count` bars of `interval` after (or before, when negative)
   * `time`, stepping over trading days as TradingView does: days with bars,
   * and outside the bars weekdays that are not known holidays. Intraday bars
   * step over the session's hours on those days.
   */
  private stepBars(time: number, count: number, interval: Interval): number {
    const { unit, n } = interval;
    if (unit === 'D') {
      const dir = Math.sign(count);
      let d = utcDay(time);
      for (let left = Math.abs(count) * n; left > 0; ) {
        d += dir;
        if (this.isTradingDay(d)) left--;
      }
      return time + (d - utcDay(time)) * DAY;
    }
    if (unit === 'W') return time + count * n * 7 * DAY;
    if (unit === 'M') {
      const at = new Date(time * 1000);
      return Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + count * n, at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes()) / 1000;
    }
    const step = intradaySeconds(interval);
    const starts = this.slots.filter((s) => (s - this.slots[0]!) % step === 0);
    if (starts.length < 2) return time + count * step;
    const dir = Math.sign(count);
    let left = Math.abs(count);
    for (let d = utcDay(time); ; d += dir) {
      if (d !== utcDay(time) && !this.isTradingDay(d)) continue;
      for (const slot of dir > 0 ? starts : [...starts].reverse()) {
        const t = d * DAY + slot;
        if ((dir > 0 ? t <= time : t >= time) || --left > 0) continue;
        return t;
      }
    }
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
