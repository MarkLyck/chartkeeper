import { dashPattern } from '../colors';
import type { PaintFrame, Painter, StyleBar, StyleView } from './view';

/** A solid colour, or TradingView's vertical gradient from the pane's top to its bottom. */
export type LineColor = string | { top: string; bottom: string };

export interface LineLook {
  color: LineColor;
  width: number;
  style: number;
}

const strokeColor = (f: PaintFrame<StyleBar>, color: LineColor): string | CanvasGradient => {
  if (typeof color === 'string') return color;
  const g = f.ctx.createLinearGradient(0, 0, 0, f.height);
  g.addColorStop(0, color.top);
  g.addColorStop(1, color.bottom);
  return g;
};

function stroke(f: PaintFrame<StyleBar>, look: LineLook, path: () => void): void {
  const { ctx } = f;
  ctx.beginPath();
  path();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = look.width * f.hpr;
  ctx.setLineDash(dashPattern(look.style, look.width).map((d) => d * f.hpr));
  ctx.strokeStyle = strokeColor(f, look.color);
  ctx.stroke();
}

type Value = (b: StyleBar) => number;
const close: Value = (b) => b.close;

const polyline = (f: PaintFrame<StyleBar>, value: Value) => () => {
  f.bars.forEach(({ x, bar }, i) => (i === 0 ? f.ctx.moveTo(x, f.y(value(bar))) : f.ctx.lineTo(x, f.y(value(bar)))));
};

/** TradingView's step line holds each value for the bar's whole slot and steps up or down halfway between bars. */
export function stepPoints(bars: readonly { x: number; y: number }[], barSpacing: number): { x: number; y: number }[] {
  const half = barSpacing / 2;
  return bars.flatMap((b, i) => {
    const prev = bars[i - 1];
    const start = { x: b.x - half, y: b.y };
    return prev ? [{ x: b.x - half, y: prev.y }, start] : [start];
  }).concat(bars.length ? [{ x: bars[bars.length - 1]!.x + half, y: bars[bars.length - 1]!.y }] : []);
}

/** Line, line with markers and step line (styles 2, 14 and 15). */
export function lineStyle(look: LineLook, shape: 'line' | 'markers' | 'step'): StyleView<StyleBar> {
  const painter: Painter<StyleBar> = (f) => {
    if (shape === 'step') {
      const pts = stepPoints(f.bars.map(({ x, bar }) => ({ x, y: f.y(bar.close) })), f.barSpacing);
      stroke(f, look, () => pts.forEach((p, i) => (i === 0 ? f.ctx.moveTo(Math.round(p.x), p.y) : f.ctx.lineTo(Math.round(p.x), p.y))));
      return;
    }
    stroke(f, look, polyline(f, close));
    // TradingView draws the markers only when two of them fit in a bar's slot.
    const radius = look.width + 2;
    if (shape !== 'markers' || 2 * radius >= f.barSpacing / f.hpr) return;
    f.ctx.beginPath();
    for (const { x, bar } of f.bars) {
      const y = f.y(bar.close);
      f.ctx.moveTo(x + radius * f.hpr, y);
      f.ctx.arc(x, y, radius * f.hpr, 0, 2 * Math.PI);
    }
    f.ctx.fillStyle = strokeColor(f, look.color);
    f.ctx.fill();
  };
  return { painter, prices: (b) => [b.close] };
}

export interface HlcAreaLook {
  high: LineLook & { visible: boolean };
  low: LineLook & { visible: boolean };
  close: LineLook;
  highFill: string;
  lowFill: string;
}

/** HLC area (style 16): the high and low lines with the close between them, each side filled. */
export function hlcAreaStyle(look: HlcAreaLook): StyleView<StyleBar> {
  const band = (f: PaintFrame<StyleBar>, a: Value, b: Value, color: string) => {
    const { ctx } = f;
    ctx.beginPath();
    f.bars.forEach(({ x, bar }, i) => (i === 0 ? ctx.moveTo(x, f.y(a(bar))) : ctx.lineTo(x, f.y(a(bar)))));
    for (let i = f.bars.length - 1; i >= 0; i--) ctx.lineTo(f.bars[i]!.x, f.y(b(f.bars[i]!.bar)));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const painter: Painter<StyleBar> = (f) => {
    band(f, (b) => b.high, close, look.highFill);
    band(f, close, (b) => b.low, look.lowFill);
    if (look.low.visible) stroke(f, look.low, polyline(f, (b) => b.low));
    if (look.high.visible) stroke(f, look.high, polyline(f, (b) => b.high));
    stroke(f, look.close, polyline(f, close));
  };
  return { painter, prices: (b) => [b.high, b.low, b.close] };
}

export interface BaselineLook {
  /** 0-100: where the base line sits, as a share of the pane height counted from the bottom. */
  levelPercent: number;
  baseColor: string;
  top: LineLook & { fill1: string; fill2: string };
  bottom: LineLook & { fill1: string; fill2: string };
}

/** TradingView's base line sits at a fixed height of the pane, whatever prices are on screen. */
export const baselineY = (paneHeight: number, levelPercent: number): number => Math.round((paneHeight * Math.abs(100 - levelPercent)) / 100);

/** Baseline (style 10): the close line and its fill, coloured by which side of the base level they are on. */
export function baselineStyle(look: BaselineLook): StyleView<StyleBar> {
  const painter: Painter<StyleBar> = (f) => {
    const { ctx, bars } = f;
    if (!bars.length) return;
    const base = baselineY(f.height / f.vpr, look.levelPercent) * f.vpr;
    const side = (s: BaselineLook['top'], clipTop: number, clipBottom: number, gradientFrom: number, gradientTo: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, clipTop, f.width, clipBottom - clipTop);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(bars[0]!.x, base);
      for (const { x, bar } of bars) ctx.lineTo(x, f.y(bar.close));
      ctx.lineTo(bars[bars.length - 1]!.x, base);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, gradientFrom, 0, gradientTo);
      g.addColorStop(0, s.fill1);
      g.addColorStop(1, s.fill2);
      ctx.fillStyle = g;
      ctx.fill();
      stroke(f, s, polyline(f, close));
      ctx.restore();
    };
    side(look.top, 0, base, base - f.height, base);
    side(look.bottom, base, f.height, base, base + f.height);
    // The base line itself: one-pixel dots four pixels apart, across the whole pane.
    const y = Math.floor(base) + 0.5;
    ctx.beginPath();
    ctx.lineWidth = Math.max(1, Math.floor(f.vpr));
    ctx.lineCap = 'butt';
    ctx.setLineDash([f.hpr, 4 * f.hpr]);
    ctx.moveTo(0, y);
    ctx.lineTo(f.width, y);
    ctx.strokeStyle = look.baseColor;
    ctx.stroke();
  };
  return { painter, prices: (b) => [b.close] };
}
