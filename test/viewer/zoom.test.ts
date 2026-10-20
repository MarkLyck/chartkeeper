import { describe, expect, it } from 'vitest';
import { MIN_ZOOM_BARS, zoomRange } from '../../src/renderer/viewer/chart';

describe('zoomRange', () => {
  it('keeps the right edge, so the latest bars and the space after them stay in view', () => {
    expect(zoomRange({ from: 140, to: 310 }, 0.5)).toEqual({ from: 225, to: 310 });
    expect(zoomRange({ from: 140, to: 310 }, 2)).toEqual({ from: -30, to: 310 });
  });

  it('comes back to the same range after zooming in and out by the same factor', () => {
    const r = zoomRange(zoomRange({ from: 100, to: 300 }, 0.8), 1 / 0.8);
    expect(r.from).toBeCloseTo(100);
    expect(r.to).toBe(300);
  });

  it(`never zooms in to fewer than ${MIN_ZOOM_BARS} bars`, () => {
    expect(zoomRange({ from: 290, to: 310 }, 0.25)).toEqual({ from: 310 - MIN_ZOOM_BARS, to: 310 });
    expect(zoomRange({ from: 305, to: 310 }, 1.25)).toEqual({ from: 310 - MIN_ZOOM_BARS, to: 310 });
  });
});
