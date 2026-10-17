import type { DrawingPoint } from '../../../core/layout';
import type { Bar } from '../../../core/model';
import { obj, type Props } from '../../../core/props';
import { parseColor, rgbaCss, withTransparency } from '../colors';
import { FONT_FAMILY, pnum, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, type AxisEnv, type AxisLabel, type DrawingKind } from './kind';
import { isIntraday, parseInterval, timeZoneOffset } from '../time';
import { formatChange, formatPercent, formatSpan, groupDigits } from './stats';
import { VOLUME_KINDS } from './volume';

type Side = 'long' | 'short';

/** TradingView applies a transparency only to hex colours; rgba colours keep their own alpha. */
const tvColor = (color: string, transparency: unknown) => (color.startsWith('#') ? withTransparency(color, transparency) : color);

/** The colour with its alpha dropped, as TradingView paints label and axis backgrounds. */
function opaque(color: string): string {
  const c = parseColor(color);
  return c ? rgbaCss({ ...c, a: 1 }) : color;
}

export interface Levels {
  entry: number;
  stop: number;
  target: number;
}

/** Stop and target sit `stopLevel` / `profitLevel` ticks from the entry, on the losing and winning side. */
export function positionLevels(side: Side, entry: number, p: Props, priceStep: number): Levels {
  const sign = side === 'long' ? 1 : -1;
  return { entry, stop: entry - sign * pnum(p, 'stopLevel', 0) * priceStep, target: entry + sign * pnum(p, 'profitLevel', 0) * priceStep };
}

export interface Trade {
  /** First bar inside the box whose range touches the entry price. */
  entryBar: number | null;
  /** Bar where the trade ended (stop or target hit), else the last bar up to the box's right edge. */
  closeBar: number | null;
  close: number;
  closed: boolean;
}

/**
 * Plays the position over the chart's bars like TradingView: it enters on the first bar from the left edge that
 * trades through the entry, then closes on the first bar touching the stop (checked first) or the target.
 * An open trade is marked at the close of the last bar up to the right edge.
 */
export function playTrade(bars: readonly Bar[], side: Side, lv: Levels, from: number, to: number): Trade {
  const last = Math.min(bars.length - 1, to - 1);
  let entryBar: number | null = null;
  for (let i = Math.max(0, from); i <= last; i++) {
    if (bars[i]![3] <= lv.entry && lv.entry <= bars[i]![2]) {
      entryBar = i;
      break;
    }
  }
  if (entryBar !== null) {
    for (let i = entryBar; i <= last; i++) {
      const [, , high, low] = bars[i]!;
      const hitStop = side === 'long' ? low <= lv.stop : high >= lv.stop;
      const hitTarget = side === 'long' ? high >= lv.target : low <= lv.target;
      if (hitStop || hitTarget) return { entryBar, closeBar: i, close: hitStop ? lv.stop : lv.target, closed: true };
    }
  }
  const closeBar = Math.min(bars.length - 1, to);
  return { entryBar, closeBar: closeBar >= 0 ? closeBar : null, close: closeBar >= 0 ? bars[closeBar]![4] : lv.entry, closed: false };
}

export interface PositionLabels {
  target: string;
  stop: string;
  middle: string;
}

const visible = (p: Props, block: string) => obj(obj(p.infoBlocks)[block]).visible !== false;

/** The three stats labels TradingView shows on a hovered position (or always, with alwaysShowStats). */
export function positionLabels(side: Side, lv: Levels, trade: Trade, p: Props, formatPrice: (price: number) => string, priceStep: number): PositionLabels {
  const compact = p.compact === true;
  const qty = Math.floor(pnum(p, 'qty', 0) / pnum(p, 'lotSize', 1));
  const sideLabel = (name: 'Target' | 'Stop', level: number, prefix: 'tp' | 'sl', amount: number) => {
    const dist = Math.abs(level - lv.entry);
    const pl = Math.round((side === 'long' ? level - lv.entry : lv.entry - level) * pnum(p, 'qty', 0) * 100) / 100;
    const price = visible(p, `${prefix}PriceOffset`) ? formatChange(dist, formatPrice) : '';
    const pct = visible(p, `${prefix}PercentOffset`) ? formatPercent(lv.entry ? Math.round((dist / lv.entry) * 100000) / 1000 : 0, 3) : '';
    const ticks = visible(p, `${prefix}TickOffset`) ? groupDigits(String(Math.round(dist / priceStep))) : '';
    const amt = visible(p, `${prefix}Amount`) ? String(amount) : '';
    const plText = visible(p, `${prefix}PL`) ? String(pl) : '';
    if (compact) return [price, pct && (price ? `(${pct})` : pct), ticks, amt, plText].filter(Boolean).join(' ');
    const head = [price, pct && (price ? `(${pct})` : pct), ticks].filter(Boolean).join(' ');
    return `${name}: ${head}${amt ? `, Amount: ${amt}` : ''}${plText ? `, PnL: ${plText}` : ''}`;
  };
  const risk = Math.abs(lv.entry - lv.stop);
  const ratio = risk ? String(Math.round((Math.abs(lv.target - lv.entry) / risk) * 100) / 100) : '';
  const pnl = formatChange(side === 'long' ? trade.close - lv.entry : lv.entry - trade.close, formatPrice);
  const showPl = visible(p, 'openClosePL');
  const showQty = visible(p, 'qty');
  const showRatio = visible(p, 'riskRewardRatio') && ratio !== '';
  const middle = compact
    ? [[showPl ? pnl : '', showQty ? String(qty) : ''].filter(Boolean).join(' ~ '), showRatio ? ratio : ''].filter(Boolean).join('\n')
    : [[showPl ? `${trade.closed ? 'Closed' : 'Open'} PnL: ${pnl}` : '', showQty ? `Qty: ${qty}` : ''].filter(Boolean).join(', '), showRatio ? `Risk/reward ratio: ${ratio}` : '']
        .filter(Boolean)
        .join('\n');
  return {
    target: sideLabel('Target', lv.target, 'tp', pnum(p, 'amountTarget', 0)),
    stop: sideLabel('Stop', lv.stop, 'sl', pnum(p, 'amountStop', 0)),
    middle,
  };
}

const TARGET_COLOR = '#089981';
const STOP_COLOR = '#F23645';

/** A stats label box centred on x; `edge` is the box side that touches `y` ('top', 'bottom' or 'middle'). */
function statsBox(dc: DrawContext, p: Props, text: string, x: number, y: number, edge: 'top' | 'bottom' | 'middle', bg: string, border: boolean): void {
  if (!text) return;
  const ctx = dc.ctx;
  const fs = pnum(p, 'fontsize', 12);
  ctx.font = `${fs}px ${FONT_FAMILY}`;
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 8;
  const h = lines.length * fs + (2 * fs) / 3;
  const top = edge === 'top' ? y : edge === 'bottom' ? y - h : y - h / 2;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, top, w, h, 4);
  ctx.fillStyle = bg;
  ctx.fill();
  if (border) {
    setStroke(ctx, '#ffffff', Math.max(fs / 12, 1));
    ctx.stroke();
  }
  ctx.fillStyle = pstr(p, 'textcolor', '#ffffff');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, x, top + fs / 3 + fs * (i + 0.5)));
}

const crispY = (y: number) => Math.round(y) + 0.5;

/** Long/short position: target and stop zones around the entry, the trade played over the bars, and its stats. */
export function riskRewardDrawer(side: Side) {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const p0 = points[0]!;
    const lv = positionLevels(side, p0.price, p, dc.priceStep);
    const from = Math.round(dc.logical(p0));
    const to = points[1] ? Math.round(dc.logical(points[1])) : from + 20;
    const trade = playTrade(dc.bars, side, lv, from, to);
    const ctx = dc.ctx;
    const left = Math.round(dc.x(from));
    const edge = Math.round(dc.x(to));
    const [yEntry, yStop, yTarget, yClose] = [lv.entry, lv.stop, lv.target, trade.close].map((v) => Math.round(dc.y(v))) as [number, number, number, number];
    const pl = side === 'long' ? trade.close - lv.entry : lv.entry - trade.close;
    const entryX = trade.entryBar !== null ? Math.round(dc.x(trade.entryBar)) : edge;
    const rightX = trade.closed && trade.closeBar !== null ? Math.round(dc.x(trade.closeBar)) : edge;
    const zones: [string, string, number, boolean][] = [
      ['stopBackground', 'stopBackgroundTransparency', yStop, pl < 0],
      ['profitBackground', 'profitBackgroundTransparency', yTarget, pl > 0],
    ];
    for (const [colorKey, alphaKey, yLevel, darker] of zones) {
      const t = pnum(p, alphaKey, 80);
      ctx.fillStyle = tvColor(pstr(p, colorKey, colorKey === 'stopBackground' ? 'rgba(242, 54, 69, 0.2)' : 'rgba(8, 153, 129, 0.2)'), t);
      ctx.fillRect(Math.min(left, edge), Math.min(yEntry, yLevel), Math.abs(edge - left), Math.abs(yLevel - yEntry));
      if (darker && entryX !== rightX) {
        ctx.fillStyle = tvColor(pstr(p, colorKey, ''), 100 - 100 * (1 - (t / 100) ** 3));
        ctx.fillRect(Math.min(entryX, rightX), Math.min(yEntry, yClose), Math.abs(rightX - entryX), Math.abs(yClose - yEntry));
      }
    }
    const lineColor = pstr(p, 'linecolor', '#787B86');
    if (trade.entryBar !== null && trade.closeBar !== null) {
      setStroke(ctx, lineColor, 1, 2);
      const a = { x: entryX, y: yEntry };
      const b = { x: Math.round(dc.x(trade.closeBar)), y: yClose };
      strokeLine(ctx, a, b);
      openArrow(ctx, a, b, 5);
    }
    setStroke(ctx, lineColor, pnum(p, 'linewidth', 1));
    strokeLine(ctx, { x: left, y: crispY(yEntry) }, { x: edge, y: crispY(yEntry) });
    setStroke(ctx, pstr(p, 'stopBackground', 'rgba(242, 54, 69, 0.2)'), 1);
    strokeLine(ctx, { x: left, y: crispY(yStop) }, { x: edge, y: crispY(yStop) });
    setStroke(ctx, pstr(p, 'profitBackground', 'rgba(8, 153, 129, 0.2)'), 1);
    strokeLine(ctx, { x: left, y: crispY(yTarget) }, { x: edge, y: crispY(yTarget) });
    if (p.alwaysShowStats !== true) return;
    const labels = positionLabels(side, lv, trade, p, dc.formatPrice, dc.priceStep);
    const cx = (left + edge) / 2;
    const outward = (yLevel: number) => (yLevel < yEntry ? 'bottom' : 'top');
    statsBox(dc, p, labels.target, cx, yTarget, outward(yTarget), TARGET_COLOR, false);
    statsBox(dc, p, labels.stop, cx, yStop, outward(yStop), STOP_COLOR, false);
    const middleBg = pl < 0 ? opaque(pstr(p, 'stopBackground', STOP_COLOR)) : pl > 0 ? opaque(pstr(p, 'profitBackground', TARGET_COLOR)) : lineColor;
    statsBox(dc, p, labels.middle, cx, yEntry, 'middle', middleBg, true);
  };
}

function positionAxisLabels(side: Side) {
  return (p: Props, points: DrawingPoint[], env: AxisEnv): AxisLabel[] => {
    if (p.showPriceLabels === false) return [];
    const lv = positionLevels(side, points[0]!.price, p, env.priceStep);
    return [
      { axis: 'price', price: lv.target, color: opaque(pstr(p, 'profitBackground', TARGET_COLOR)) },
      { axis: 'price', price: lv.entry, color: opaque(pstr(p, 'linecolor', '#808080')) },
      { axis: 'price', price: lv.stop, color: opaque(pstr(p, 'stopBackground', STOP_COLOR)) },
    ];
  };
}

/** Open arrowhead at `tip` with arms `size` px long, 30° off the line. */
function openArrow(ctx: CanvasRenderingContext2D, from: Pt, tip: Pt, size: number): void {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tip.x - size * Math.cos(angle - Math.PI / 6), tip.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(angle + Math.PI / 6), tip.y - size * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
  ctx.restore();
}

/** "2026-08-18", plus the wall-clock time in the chart's timezone on intraday charts. */
export function forecastDate(time: number, intraday: boolean, timeZone: string, timeSeparator: string): string {
  const iso = new Date((time + (intraday ? timeZoneOffset(time, timeZone) : 0)) * 1000).toISOString();
  return intraday ? `${iso.slice(0, 10)}${timeSeparator}${iso.slice(11, 16)}` : iso.slice(0, 10);
}

/** The forecast's two labels: source "315.87" / "2026-08-18" and target "23.71 (7.55%) in 45d" / "337.58" + date. */
export function forecastLabels(source: DrawingPoint, target: DrawingPoint, intraday: boolean, timeZone: string, formatPrice: (price: number) => string) {
  const diff = target.price - source.price;
  return {
    source: [formatPrice(source.price), forecastDate(source.time, intraday, timeZone, ' ')] as const,
    target: [`${formatChange(diff, formatPrice)} (${formatPercent(source.price ? (diff / Math.abs(source.price)) * 100 : 0, 2)}) in ${formatSpan(target.time - source.time)}`, formatPrice(target.price), forecastDate(target.time, intraday, timeZone, '  ')] as const,
  };
}

const STATUS = {
  1: { text: 'SUCCESS', bg: 'successBackground', fg: 'successTextColor' },
  2: { text: 'FAILURE', bg: 'failureBackground', fg: 'failureTextColor' },
} as const;

/** Rounded label box 11 px from `pt` (below when `below`), with a tail whose tip stops 6 px from the point. */
function balloon(dc: DrawContext, pt: Pt, w: number, h: number, below: boolean, fill: string, stroke: string): { x: number; y: number } {
  const ctx = dc.ctx;
  const off = Math.max(20, Math.min(w - 15, pt.x + w - dc.width + 5));
  const x = pt.x - off;
  const y = below ? pt.y + 11 : pt.y - 11 - h;
  const dir = below ? 1 : -1;
  const base = below ? y : y + h;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 3);
  ctx.moveTo(pt.x - 5, base);
  ctx.lineTo(pt.x, pt.y + dir * 6);
  ctx.lineTo(pt.x + 5, base);
  ctx.fillStyle = fill;
  ctx.fill();
  setStroke(ctx, stroke, 2);
  ctx.stroke();
  ctx.fillRect(pt.x - 4, base - dir * 2, 8, 3);
  return { x, y };
}

/** 9×9 clock icon in the text colour. */
function clock(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 4.5, y + 4.5, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  setStroke(ctx, '#000', 1.2);
  ctx.beginPath();
  ctx.moveTo(x + 4.5, y + 2);
  ctx.lineTo(x + 4.5, y + 4.8);
  ctx.lineTo(x + 6.5, y + 6);
  ctx.stroke();
  ctx.restore();
}

/** Forecast: a quarter-ellipse arrow from source to target, price/date balloons at both ends and the saved status badge. */
function drawPrediction(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const [s, t] = points as [DrawingPoint, DrawingPoint];
  const a = dc.pt(s);
  const b = dc.pt(t);
  const ctx = dc.ctx;
  const lw = pnum(p, 'linewidth', 2);
  const color = pstr(p, 'linecolor', '#2962FF');
  const ox = b.x - a.x;
  const oy = b.y - a.y;
  const up = oy < 0;
  const start = up ? Math.PI / 2 : -Math.PI / 2;
  const end = ox > 0 ? 0 : up ? Math.PI : -Math.PI;
  const rx = Math.abs(ox);
  const ry = Math.abs(oy);
  setStroke(ctx, color, lw);
  ctx.beginPath();
  ctx.ellipse(a.x, b.y, rx, ry, 0, start, end, start > end);
  ctx.stroke();
  const head = Math.max(8, 4 * lw);
  const at = (k: number) => {
    const th = end + (start - end) * k;
    return { x: a.x + rx * Math.cos(th), y: b.y + ry * Math.sin(th) };
  };
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const q = at(mid);
    if (Math.hypot(q.x - b.x, q.y - b.y) < head) lo = mid;
    else hi = mid;
  }
  const back = rx < 1 || ry < 1 ? a : at(hi);
  const len = Math.hypot(b.x - back.x, b.y - back.y) || 1;
  const [ux, uy] = [(b.x - back.x) / len, (b.y - back.y) / len];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * ux - (head / 2) * uy, b.y - head * uy + (head / 2) * ux);
  ctx.lineTo(b.x - head * ux + (head / 2) * uy, b.y - head * uy - (head / 2) * ux);
  ctx.closePath();
  ctx.fill();

  const alpha = p.transparency;
  const intraday = isIntraday(parseInterval(pstr(p, 'interval', 'D')));
  const text = forecastLabels(s, t, intraday, dc.timeZone, dc.formatPrice);
  const priceUp = t.price > s.price;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  ctx.font = `12px ${FONT_FAMILY}`;
  const sw1 = ctx.measureText(text.source[0]).width;
  ctx.font = `10px ${FONT_FAMILY}`;
  const sw = Math.max(sw1, ctx.measureText(text.source[1]).width) + 10;
  const sb = balloon(dc, a, sw, 32, priceUp, tvColor(pstr(p, 'sourceBackColor', '#2962FF'), alpha), tvColor(pstr(p, 'sourceStrokeColor', '#2962FF'), alpha));
  ctx.fillStyle = pstr(p, 'sourceTextColor', '#ffffff');
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.fillText(text.source[0], sb.x + 5, sb.y + 4);
  ctx.font = `10px ${FONT_FAMILY}`;
  ctx.fillText(text.source[1], sb.x + 5, sb.y + 18);

  ctx.font = `14px ${FONT_FAMILY}`;
  const tw1 = ctx.measureText(text.target[0]).width;
  ctx.font = `11px ${FONT_FAMILY}`;
  const space = ctx.measureText(' ').width;
  const w2a = ctx.measureText(text.target[1]).width;
  const tw = Math.max(tw1, w2a + 9 + 2 * space + ctx.measureText(text.target[2]).width) + 12;
  const tb = balloon(dc, b, tw, 38, !priceUp, tvColor(pstr(p, 'targetBackColor', '#2962FF'), alpha), tvColor(pstr(p, 'targetStrokeColor', '#2962FF'), alpha));
  const fg = pstr(p, 'targetTextColor', '#ffffff');
  ctx.fillStyle = fg;
  ctx.font = `14px ${FONT_FAMILY}`;
  ctx.fillText(text.target[0], tb.x + 6, tb.y + 5);
  ctx.font = `11px ${FONT_FAMILY}`;
  ctx.fillText(text.target[1], tb.x + 6, tb.y + 22);
  clock(ctx, tb.x + 6 + w2a + space, tb.y + 23, fg);
  ctx.fillStyle = fg;
  ctx.fillText(text.target[2], tb.x + 6 + w2a + 9 + 2 * space, tb.y + 22);

  const status = STATUS[pnum(p, 'status', 0) as 1 | 2];
  if (status) {
    const top = priceUp ? tb.y - 20 : tb.y + 40;
    ctx.beginPath();
    ctx.roundRect(tb.x - 1, top, tw + 2, 18, 5);
    ctx.fillStyle = tvColor(pstr(p, status.bg, '#F23645'), alpha);
    ctx.fill();
    ctx.font = `bold 14px ${FONT_FAMILY}`;
    const textW = ctx.measureText(status.text).width;
    const tx = tb.x + Math.round((tw - textW) / 2);
    ctx.fillStyle = pstr(p, status.fg, '#ffffff');
    ctx.fillText(status.text, tx, top + 3);
    statusIcon(ctx, status.text === 'SUCCESS', tx - 4, top + 9, pstr(p, status.fg, '#ffffff'));
  }

  ctx.fillStyle = pstr(p, 'centersColor', '#202020');
  for (const q of [a, b]) {
    ctx.beginPath();
    ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Small smiling or frowning face ending 4 px left of the status text, centred on `cy`. */
function statusIcon(ctx: CanvasRenderingContext2D, success: boolean, right: number, cy: number, color: string): void {
  const r = 4.5;
  const cx = right - r;
  setStroke(ctx, color, 1.3);
  ctx.fillStyle = color;
  for (const dx of [-2, 2]) ctx.fillRect(cx + dx - 0.7, cy - 2.5, 1.4, 1.4);
  ctx.beginPath();
  if (success) ctx.arc(cx, cy, 2.5, 0.15 * Math.PI, 0.85 * Math.PI);
  else ctx.arc(cx, cy + 3.5, 2.5, 1.2 * Math.PI, 1.8 * Math.PI);
  ctx.stroke();
}

/** Projection ("Sector"): a wedge around the first point from the second point's direction to the third's, radius |p0p1|. */
function drawProjection(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const [c, p1, p2] = points.map((q) => dc.pt(q)) as [Pt, Pt, Pt];
  const ctx = dc.ctx;
  const r0 = Math.hypot(p1.x - c.x, p1.y - c.y);
  const d2 = Math.hypot(p2.x - c.x, p2.y - c.y) || 1;
  const end2 = { x: c.x + ((p2.x - c.x) / d2) * r0, y: c.y + ((p2.y - c.y) / d2) * r0 };
  const angle = (q: Pt) => (Math.atan2(q.y - c.y, q.x - c.x) + 2 * Math.PI) % (2 * Math.PI);
  let [a1, a2] = [angle(p1), angle(end2)].sort((x, y) => x - y) as [number, number];
  if (a2 - a1 > Math.PI) [a1, a2] = [a2, a1 + 2 * Math.PI];
  const level = Array.isArray(p.level1) ? p.level1 : [1, '', true];
  const r = r0 * (typeof level[0] === 'number' ? level[0] : 1);
  const trend = obj(p.trendline);
  const lineColor = pstr(trend, 'color', '#9C9C9C');
  const lw = pnum(p, 'linewidth', 2);
  if (level[2] !== false) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, a1, a2);
    if (p.fillBackground !== false && r > 0) {
      ctx.arc(c.x, c.y, 0, a2, a1, true);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      g.addColorStop(0, tvColor(pstr(p, 'color1', 'rgba(41, 98, 255, 0.2)'), p.transparency));
      g.addColorStop(1, tvColor(pstr(p, 'color2', 'rgba(156, 39, 176, 0.2)'), p.transparency));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, a1, a2);
    }
    setStroke(ctx, lineColor, lw);
    ctx.stroke();
  }
  if (trend.visible !== false) {
    setStroke(ctx, lineColor, lw, trend.linestyle);
    strokeLine(ctx, c, p1);
    strokeLine(ctx, c, end2);
  }
}

export const POSITION_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolRiskRewardLong: kind(1, riskRewardDrawer('long'), positionAxisLabels('long')),
  LineToolRiskRewardShort: kind(1, riskRewardDrawer('short'), positionAxisLabels('short')),
  LineToolPrediction: kind(2, drawPrediction),
  LineToolProjection: kind(3, drawProjection),
  ...VOLUME_KINDS,
};
