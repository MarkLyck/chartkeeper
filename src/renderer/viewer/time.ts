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
/** Weekdays from day `a` to day `b`, both included. */
const weekdaysIn = (a: number, b: number) => {
  if (b < a) return 0;
  const whole = Math.floor((b - a + 1) / 7);
  let count = whole * 5;
  for (let d = a + whole * 7; d <= b; d++) if (!isWeekend(d)) count++;
  return count;
};
/** A corrupt offset must not stall drawing, which places every point on every frame. */
const MAX_OFFSET = 100000;
const ymdDay = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) / 1000 / DAY;

export interface TimeIndexOptions {
  /** Exchange holidays (YYYYMMDD). */
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
  /** Days that have bars: the trading days between the first and the last bar, on daily and intraday charts. Null on coarser charts. */
  private readonly barDays: ReadonlySet<number> | null;
  private readonly placed = new Map<string, number>();
  private readonly future = new Map<number, number>();

  constructor(
    readonly times: readonly number[],
    interval: string,
    options: TimeIndexOptions = {},
  ) {
    this.interval = parseInterval(interval);
    // Saturday bars, not Sunday ones: futures and forex open on Sunday evening (UTC) for Monday's session.
    this.tradesWeekends = times.some((t) => (utcDay(t) + 4) % 7 === 6);
    this.holidays = new Set((options.holidays ?? []).map(ymdDay));
    const { unit, n } = this.interval;
    this.barDays = isIntraday(this.interval) || (unit === 'D' && n === 1) ? new Set(times.map(utcDay)) : null;
    const last = times[times.length - 1] ?? 0;
    const recent = isIntraday(this.interval) ? times.filter((t) => t > last - 10 * DAY) : [];
    // One day of bars shows no session boundary; plain intervals are the better guess then.
    this.slots = new Set(recent.map(utcDay)).size > 1 ? [...new Set(recent.map((t) => t - utcDay(t) * DAY))].sort((a, b) => a - b) : [];
  }

  /** A weekday (or any day, for symbols that trade weekends) that is not a holiday and, between the first and the last bar, has bars. */
  private isTradingDay(day: number): boolean {
    if ((!this.tradesWeekends && isWeekend(day)) || this.holidays.has(day)) return false;
    const n = this.times.length;
    if (this.barDays && n && day >= utcDay(this.times[0]!) && day <= utcDay(this.times[n - 1]!)) return this.barDays.has(day);
    return true;
  }

  /** Trading days strictly between two days, all before the first bar. */
  private tradingDaysBetween(a: number, b: number): number {
    if (b - a < 2) return 0;
    const days = this.tradesWeekends ? b - a - 1 : weekdaysIn(a + 1, b - 1);
    let holidays = 0;
    for (const h of this.holidays) if (h > a && h < b && (this.tradesWeekends || !isWeekend(h))) holidays++;
    return days - holidays;
  }

  /** Bars from an intraday time before the first bar up to the first bar, counting the session's bar slots on trading days. */
  private sessionBarsBefore(first: number, time: number): number {
    const from = utcDay(time);
    const to = utcDay(first);
    let count = 0;
    let onSlot = false;
    for (const d of from === to ? [from] : [from, to]) {
      if (d !== to && !this.isTradingDay(d)) continue;
      for (const slot of this.slots) {
        const t = d * DAY + slot;
        if (t < time || t >= first) continue;
        if (t === time) onSlot = true;
        count++;
      }
    }
    count += this.tradingDaysBetween(from, to) * this.slots.length;
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
    const key = `${point.time}|${point.offset}|${point.interval ?? ''}`;
    let at = this.placed.get(key);
    if (at === undefined) {
      const own = point.interval ? parseInterval(point.interval) : null;
      const offset = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, point.offset));
      at = !offset || !own || sameInterval(own, this.interval) ? this.indexOf(point.time) + offset : this.indexOf(this.stepBars(point.time, offset, own));
      this.placed.set(key, at);
    }
    return at;
  }

  /** Opening time of the bar at a position, past the last bar too. */
  timeAt(logical: number): number | undefined {
    const i = Math.round(logical);
    const last = this.times.length - 1;
    if (i <= last) return this.times[i];
    let t = this.future.get(i);
    if (t === undefined) {
      t = this.futureTimes(i - last)[i - last - 1]!;
      this.future.set(i, t);
    }
    return t;
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
    // Bars of the point's interval start on some of the chart's bars only when that interval is a multiple of the chart's.
    const chartStep = isIntraday(this.interval) ? intradaySeconds(this.interval) : 0;
    const starts = chartStep && step % chartStep === 0 ? this.slots.filter((s) => (s - this.slots[0]!) % step === 0) : [];
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
