import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Change } from '../../src/core/diff';
import { changeText, templateItemText, templateMissingText } from '../../src/renderer/ui/changes';

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const pts = [{ time: day('2026-07-01'), offset: 0, price: 190 }];

// One of each, written out so a new kind of change fails `tsc` here until it has words.
const EVERY: Record<Change['what'], Change> = {
  'layout-name': { kind: 'changed', what: 'layout-name', from: 'a', to: 'b' },
  arrangement: { kind: 'changed', what: 'arrangement', from: 's', to: '2h' },
  chart: { kind: 'added', what: 'chart', index: 1, symbol: 'NASDAQ:AAPL', interval: 'D' },
  'chart-symbol': { kind: 'changed', what: 'chart-symbol', index: 0, from: 'NASDAQ:AAPL', to: 'NASDAQ:MSFT' },
  'chart-interval': { kind: 'changed', what: 'chart-interval', index: 0, from: 'D', to: '60' },
  'chart-style': { kind: 'changed', what: 'chart-style', index: 0 },
  study: { kind: 'removed', what: 'study', shortName: 'RSI', name: 'Relative Strength Index' },
  'study-inputs': { kind: 'changed', what: 'study-inputs', shortName: 'MA', inputs: [{ key: 'length', from: '50', to: '100' }] },
  'study-style': { kind: 'changed', what: 'study-style', shortName: 'MA' },
  drawing: { kind: 'added', what: 'drawing', toolType: 'LineToolText', text: 'Sell', symbol: null, points: pts },
  'drawing-moved': { kind: 'changed', what: 'drawing-moved', toolType: 'LineToolTrendLine', from: pts, to: [{ ...pts[0]!, price: 200 }] },
  'drawing-props': { kind: 'changed', what: 'drawing-props', toolType: 'LineToolTrendLine', props: Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, from: null, to: '1' })) },
  'study-template': { kind: 'added', what: 'study-template', name: 'My MA' },
  'drawing-template': { kind: 'changed', what: 'drawing-template', name: 'Thick', toolType: 'LineToolTrendLine' },
  theme: { kind: 'removed', what: 'theme', name: 'Dark' },
  script: { kind: 'changed', what: 'script', name: 'My Trend' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wording a comparison', () => {
  it('words every kind of change, with every placeholder filled', () => {
    const missing = vi.spyOn(console, 'error');
    for (const c of Object.values(EVERY)) {
      const { subject, detail } = changeText(c);
      expect(subject.trim(), c.what).not.toBe('');
      expect(detail.trim(), c.what).not.toBe('');
    }
    expect(missing).not.toHaveBeenCalled();
  });

  it('names drawing tools, and plainly when there is no name for them', () => {
    expect(changeText(EVERY.drawing)).toEqual({ subject: 'Text', detail: 'Text “Sell” on the chart (2026-07-01 @ 190)' });
    expect(changeText(EVERY['drawing-template']).detail).toBe('Thick (Trend line)');
    expect(changeText({ ...EVERY['drawing-moved'], toolType: 'LineToolMoonPhase' } as Change).subject).toBe('Moon Phase');
    expect(changeText({ ...EVERY.drawing, text: null } as Change).detail).toBe('Text on the chart (2026-07-01 @ 190)');
    expect(changeText(EVERY['drawing-moved']).detail).toBe('moved: 2026-07-01 @ 190 → 2026-07-01 @ 200');
    expect(changeText(EVERY['drawing-props']).detail).toBe('style or text: k0: – → 1; k1: – → 1; k2: – → 1; k3: – → 1; k4: – → 1; k5: – → 1 (+2 more)');
  });

  it('words restored and missing templates', () => {
    expect(templateItemText({ kind: 'theme', name: 'Dark' })).toBe('Theme “Dark”');
    expect(templateMissingText('drawing-template')).toBe('Drawing templates (not in this backup)');
    expect(templateItemText({ kind: 'study-template', name: 'My RSI' })).toBe('Indicator template “My RSI”');
  });
});
