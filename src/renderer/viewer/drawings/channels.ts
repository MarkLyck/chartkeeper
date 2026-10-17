import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor } from '../colors';
import { extendSegment, fillPolygon, pnum, pobj, pstr, setStroke, strokeLine, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';

interface ChannelLevel {
  coeff: number;
  color: string;
  width: number;
  style: number;
}

/** Parallel channel: line 1-2, a parallel copy through point 3, and the levels between them (0 = line 1-2, 1 = the copy). */
export function drawParallelChannel(dc: DrawContext, p: Props, points: DrawingPoint[]): void {
  const a = dc.pt(points[0]!);
  const b = dc.pt(points[1]!);
  const c = dc.pt(points[2]!);
  const slope = b.x !== a.x ? (b.y - a.y) / (b.x - a.x) : 0;
  const dy = c.y - (a.y + slope * (c.x - a.x));
  const at = (coeff: number): [Pt, Pt] => [
    { x: a.x, y: a.y + dy * coeff },
    { x: b.x, y: b.y + dy * coeff },
  ];
  const left = p.extendLeft === true;
  const right = p.extendRight === true;
  const ctx = dc.ctx;

  if (p.fillBackground !== false) {
    const [l0a, l0b] = extendSegment(...at(0), left, right, dc);
    const [l1a, l1b] = extendSegment(...at(1), left, right, dc);
    fillPolygon(ctx, [l0a, l0b, l1b, l1a], fillColor(pstr(p, 'backgroundColor', 'rgba(41, 98, 255, 0.2)'), p.transparency));
  }

  const levels: ChannelLevel[] = [];
  for (let i = 1; `level${i}` in p; i++) {
    const l = pobj(p, `level${i}`);
    if (l.visible === false || typeof l.coeff !== 'number') continue;
    levels.push({ coeff: l.coeff, color: pstr(l, 'color', '#2962FF'), width: pnum(l, 'lineWidth', 1), style: pnum(l, 'lineStyle', 0) });
  }
  if (levels.length === 0) {
    const color = pstr(p, 'linecolor', '#2962FF');
    const width = pnum(p, 'linewidth', 1);
    levels.push({ coeff: 0, color, width, style: pnum(p, 'linestyle', 0) }, { coeff: 1, color, width, style: pnum(p, 'linestyle', 0) });
    if (p.showMidline !== false) levels.push({ coeff: 0.5, color: pstr(p, 'midlinecolor', color), width: pnum(p, 'midlinewidth', 1), style: pnum(p, 'midlinestyle', 2) });
  }
  for (const l of levels) {
    setStroke(ctx, l.color, l.width, l.style);
    strokeLine(ctx, ...extendSegment(...at(l.coeff), left, right, dc));
  }
}

export const CHANNEL_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolParallelChannel: kind(3, drawParallelChannel),
};
