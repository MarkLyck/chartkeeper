import type { DrawingPoint, ParsedDrawing } from '../../../core/layout';
import type { Props } from '../../../core/props';
import { parseColor, rgbaCss } from '../colors';
import { FONT_FAMILY, pnum, pstr, setStroke, type DrawContext } from './canvas';
import { kind, type DrawingKind } from './kind';

/**
 * Wave labels per label set; point 0 (the wave origin) is never labelled.
 * Degrees run 0 (Supermillennium) to 14 (Minuscule); each set serves three adjacent
 * degrees, told apart by decoration: none, round brackets, or a circle.
 */
type LabelSets = readonly [readonly string[], readonly string[], readonly string[], readonly string[], readonly string[]];

const lowerUpper = (upper: readonly string[]): LabelSets => {
  const lower = upper.map((s) => s.toLowerCase());
  return [upper, lower, upper, lower, upper];
};

export const ELLIOTT_LABELS: Readonly<Record<string, LabelSets>> = {
  LineToolElliottImpulse: [
    ['0', '1', '2', '3', '4', '5'],
    ['0', 'i', 'ii', 'iii', 'iv', 'v'],
    ['0', '1', '2', '3', '4', '5'],
    ['0', 'I', 'II', 'III', 'IV', 'V'],
    ['0', '1', '2', '3', '4', '5'],
  ],
  LineToolElliottTriangle: lowerUpper(['0', 'A', 'B', 'C', 'D', 'E']),
  LineToolElliottTripleCombo: lowerUpper(['0', 'W', 'X', 'Y', 'X', 'Z']),
  LineToolElliottCorrection: lowerUpper(['0', 'A', 'B', 'C']),
  LineToolElliottDoubleCombo: lowerUpper(['0', 'W', 'X', 'Y']),
};

const DEGREES = 15;

/** Font size, circle diameter and weight per label set (set 0 is the smallest degrees). */
const SET_STYLE = [
  { font: 11, circle: 14, bold: true },
  { font: 16, circle: 22, bold: false },
  { font: 18, circle: 22, bold: false },
  { font: 20, circle: 28, bold: false },
  { font: 24, circle: 36, bold: true },
] as const;

export interface ElliottLabel {
  text: string;
  circled: boolean;
  font: number;
  circle: number;
  bold: boolean;
}

export function elliottLabel(type: string, degree: number, index: number): ElliottLabel | null {
  const sets = ELLIOTT_LABELS[type];
  const rank = DEGREES - 1 - Math.min(DEGREES - 1, Math.max(0, Math.round(degree)));
  const set = Math.floor(rank / 3);
  const text = sets?.[set]?.[index];
  if (text === undefined) return null;
  const decoration = rank % 3;
  const style = SET_STYLE[set]!;
  return { text: decoration === 1 ? `(${text})` : text, circled: decoration === 2, font: style.font, circle: style.circle, bold: style.bold };
}

const opaque = (color: string) => {
  const c = parseColor(color);
  return c ? rgbaCss({ ...c, a: 1 }) : color;
};

function drawElliott(dc: DrawContext, p: Props, points: DrawingPoint[], drawing: ParsedDrawing): void {
  // Version 1 waves had no origin point; TradingView duplicates the first point when it loads them.
  const wave = drawing.source.version === 1 ? [points[0]!, ...points] : points;
  const pts = wave.map((pt) => dc.pt(pt));
  const { ctx } = dc;
  const lineColor = pstr(p, 'color', '#3d85c6');
  const color = opaque(lineColor);
  if (p.showWave !== false) {
    setStroke(ctx, lineColor, pnum(p, 'linewidth', 2), 0);
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.stroke();
  }
  // Labels alternate sides; point 1 goes above when point 2 lies below it on screen.
  let side = pts.length > 2 ? Math.sign(pts[2]!.y - pts[1]!.y) : 1;
  for (let i = 0; i < pts.length; i++, side = -side) {
    const label = i === 0 ? null : elliottLabel(drawing.type, pnum(p, 'degree', 7), i);
    if (!label) continue;
    const r = label.circle / 2;
    const dir = side === 1 ? 1 : -1;
    const x = Math.round(pts[i]!.x);
    const y = Math.round(pts[i]!.y + dir * (10 + r));
    if (label.circled) {
      ctx.setLineDash([]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + 0.5, y + 0.5, r - 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = `${label.bold ? 'bold ' : ''}${label.font}px ${FONT_FAMILY}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.text, x + 0.5, y + 0.5 + 0.05 * label.font);
  }
}

/** One point fewer than labels, since version 1 waves stored no origin point. */
export const ELLIOTT_KINDS: Readonly<Record<string, DrawingKind>> = Object.fromEntries(
  Object.entries(ELLIOTT_LABELS).map(([type, sets]) => [type, kind(sets[0].length - 1, drawElliott)]),
);
