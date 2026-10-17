/** Number and time formats of TradingView's measuring labels (ranges, positions, forecast), in English. */

const MINUS = '−';

/** "1,234,567.89": groups the integer digits of an already formatted number. */
export const groupDigits = (text: string): string => text.replace(/^(\d+)/, (int) => int.replace(/\B(?=(\d{3})+$)/g, ','));

/** A price difference as TradingView's formatChange writes it: symbol decimals, grouped, a true minus sign and no plus. */
export function formatChange(diff: number, formatPrice: (price: number) => string): string {
  const text = groupDigits(formatPrice(Math.abs(diff)));
  return diff < 0 && /[1-9]/.test(text) ? MINUS + text : text;
}

/** "8.36%" (or "−8.36%"), with a fixed number of decimals. */
export function formatPercent(value: number, decimals: number): string {
  const text = Math.abs(value).toFixed(decimals);
  return `${value < 0 && /[1-9]/.test(text) ? MINUS : ''}${text}%`;
}

/** Whole ticks between two prices, grouped: "2,587". */
export function formatTicks(diff: number, priceStep: number): string {
  const ticks = Math.round(diff / priceStep);
  return `${ticks < 0 ? MINUS : ''}${groupDigits(String(Math.abs(ticks)))}`;
}

/** A duration in seconds as "51d", "5d 1h", "3m 20s": zero parts left out, no weeks or months. */
export function formatSpan(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  const parts: [number, string][] = [
    [Math.floor(s / 86400), 'd'],
    [Math.floor((s % 86400) / 3600), 'h'],
    [Math.floor((s % 3600) / 60), 'm'],
    [s % 60, 's'],
  ];
  const text = parts
    .filter(([n]) => n > 0)
    .map(([n, unit]) => `${groupDigits(String(n))}${unit}`)
    .join(' ');
  return seconds < 0 && text ? `-${text}` : text;
}

/** Volume with at most three digits before the point and a K/M/B/T suffix: "1.67 B", "9.83 M", "512". */
export function formatVolume(volume: number): string {
  const units = ['', ' K', ' M', ' B', ' T'];
  let v = volume;
  let u = 0;
  while (Math.abs(v) >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return u === 0 ? String(Math.round(v)) : `${Number(v.toFixed(2))}${units[u]}`;
}
