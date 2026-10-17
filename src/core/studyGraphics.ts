import { inflateSync } from 'node:zlib';
import type { ChartData, StudyValues } from './model';

/** Compressed fields of TradingView's non-series envelope, and the plain field each one inflates to. */
const COMPRESSED = { dataCompressed: 'data', graphicsCmdsCompressed: 'graphicsCmds' } as const;

/**
 * TradingView sends some indicator output (Pivot Points High Low, many Pine
 * scripts) as base64 zlib inside the stored `graphics.d` envelope, and its own
 * chart inflates it before drawing. Inflating it once when a snapshot is opened
 * keeps the browser viewer synchronous. A payload that does not inflate stays
 * as stored, so the viewer still lists the indicator as not fully shown.
 */
export function inflateStudyGraphics(data: ChartData): ChartData {
  const studies: Record<string, StudyValues> = {};
  for (const [id, values] of Object.entries(data.studies)) {
    studies[id] = values.status === 'ok' ? { ...values, graphics: inflateEnvelope(values.graphics) } : values;
  }
  return { ...data, studies };
}

function inflateEnvelope(graphics: unknown): unknown {
  if (typeof graphics !== 'object' || graphics === null) return graphics;
  const d = (graphics as { d?: unknown }).d;
  if (typeof d !== 'string' || !Object.keys(COMPRESSED).some((k) => d.includes(k))) return graphics;
  try {
    const envelope = JSON.parse(d) as Record<string, unknown>;
    for (const [packed, plain] of Object.entries(COMPRESSED)) {
      const payload = envelope[packed];
      if (typeof payload !== 'string') continue;
      envelope[plain] = JSON.parse(inflateSync(Buffer.from(payload, 'base64')).toString('utf8'));
      delete envelope[packed];
    }
    return { ...graphics, d: JSON.stringify(envelope) };
  } catch {
    return graphics;
  }
}
