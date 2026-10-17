import type { DrawingPoint } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { fillColor } from '../colors';
import { arrowHead, pnum, pstr, setStroke, type DrawContext, type Pt } from './canvas';
import { kind, type DrawingKind } from './kind';

const lineColor = (p: Props) => pstr(p, 'linecolor', '#2962FF');
const lineWidth = (p: Props) => pnum(p, 'linewidth', 1);

function smoothPath(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i]!.x + pts[i + 1]!.x) / 2, y: (pts[i]!.y + pts[i + 1]!.y) / 2 };
    ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, mid.x, mid.y);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last.x, last.y);
}

/** Path, polyline, brush and highlighter: a line through every point. */
export function polylineDrawer(kind: 'path' | 'polyline' | 'brush' | 'highlighter') {
  return (dc: DrawContext, p: Props, points: DrawingPoint[]): void => {
    const pts = points.map((pt) => dc.pt(pt));
    const ctx = dc.ctx;
    const highlighter = kind === 'highlighter';
    const width = highlighter ? pnum(p, 'width', 20) : lineWidth(p);
    const color = highlighter ? fillColor(lineColor(p), pnum(p, 'transparency', 80)) : lineColor(p);
    setStroke(ctx, color, width, highlighter ? 0 : p.linestyle);
    if (kind === 'brush' || highlighter) ctx.lineCap = 'round';
    ctx.beginPath();
    if (kind === 'brush' || highlighter) smoothPath(ctx, pts);
    else {
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (const pt of pts.slice(1)) ctx.lineTo(pt.x, pt.y);
    }
    if (p.fillBackground === true && (kind === 'polyline' || kind === 'brush')) {
      ctx.fillStyle = fillColor(pstr(p, 'backgroundColor', 'rgba(41, 98, 255, 0.2)'), p.transparency);
      ctx.fill();
    }
    ctx.stroke();
    if (pts.length >= 2 && !highlighter) {
      if (pnum(p, 'leftEnd', 0) === 1) arrowHead(ctx, pts[1]!, pts[0]!, width);
      if (pnum(p, 'rightEnd', 0) === 1) arrowHead(ctx, pts[pts.length - 2]!, pts[pts.length - 1]!, width);
    }
  };
}

export const FREEHAND_KINDS: Readonly<Record<string, DrawingKind>> = {
  LineToolPath: kind(2, polylineDrawer('path')),
  LineToolPolyline: kind(2, polylineDrawer('polyline')),
  LineToolBrush: kind(2, polylineDrawer('brush')),
  LineToolHighlighter: kind(2, polylineDrawer('highlighter')),
};
