import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PriceScaleMode } from 'lightweight-charts';
import { describe, expect, it } from 'vitest';
import { parseLayout, parsePriceScale } from '../../src/core/layout';
import type { TvContent } from '../../src/core/tv/content';
import { parseLayoutJson, parseListEntry } from '../../src/core/tv/client';
import { priceRangeInScaleUnits, priceScaleOptions, toLogUnits } from '../../src/renderer/viewer/priceScale';
import { planChart } from '../../src/renderer/viewer/plan';
import { FIXTURES } from '../fakes/fixtures';

/**
 * Scale states and visible ranges read from tradingview.com (TSX:JX 1W, build of 2026-10-18) after
 * `getMainSourcePriceScale().setMode(...)`, `setAutoScale(false)` and `setVisiblePriceRange(...)`.
 */
const base = { id: 'x', m_priceRange: null, m_isAutoScale: true, m_isPercentage: false, m_isIndexedTo100: false, m_isLog: false, m_isLockScale: false, m_isInverted: false, m_topMargin: 0.1, m_bottomMargin: 0.08, alignLabels: true, logFormula: { logicalOffset: 4, coordOffset: 0.0001 }, hasCalculatedPriceRange: true };
const TV = {
  log: { ...base, m_isLog: true },
  logManual: { ...base, m_isLog: true, m_isAutoScale: false, m_priceRange: { m_maxValue: 7.489566141915238, m_minValue: 6.567116487700534 } },
  logManualVisible: { from: 299.867206509156, to: 4002.2143268249797 },
  normalManual: { ...base, m_isAutoScale: false, m_priceRange: { m_maxValue: 3630, m_minValue: 596 } },
  percent: { ...base, m_isPercentage: true },
  indexed: { ...base, m_isIndexedTo100: true },
  inverted: { ...base, m_isInverted: true },
  percentOverLog: { ...base, m_isLog: true, m_isPercentage: true },
  autoWithStaleRange: { ...base, m_priceRange: { m_maxValue: 3630, m_minValue: 596 } },
};

describe("reading TradingView's saved price scale", () => {
  it('reads each scale mode', () => {
    expect(parsePriceScale(base)).toEqual({ mode: 'normal', inverted: false, manualRange: null });
    expect(parsePriceScale(TV.log).mode).toBe('log');
    expect(parsePriceScale(TV.percent).mode).toBe('percentage');
    expect(parsePriceScale(TV.indexed).mode).toBe('indexed-to-100');
    expect(parsePriceScale(TV.inverted)).toEqual({ mode: 'normal', inverted: true, manualRange: null });
  });

  it('lets percentage win over a log flag left underneath, as TradingView draws it', () => {
    expect(parsePriceScale(TV.percentOverLog).mode).toBe('percentage');
  });

  it('keeps a manual range only when autoscale is off', () => {
    expect(parsePriceScale(TV.logManual).manualRange).toEqual({ min: 6.567116487700534, max: 7.489566141915238 });
    expect(parsePriceScale(TV.normalManual).manualRange).toEqual({ min: 596, max: 3630 });
    expect(parsePriceScale(TV.autoWithStaleRange).manualRange).toBeNull();
  });

  it('gives every source of a pane its scale: axis lists and overlay scales', () => {
    const raw = JSON.parse(readFileSync(path.join(FIXTURES, 'tv-saved-layout.json'), 'utf8'));
    const content = JSON.parse(raw.content) as TvContent;
    const [pricePane, rsiPane] = content.charts[0]!.panes as Record<string, any>[];
    pricePane!.rightAxisesState[0].state = TV.logManual;
    pricePane!.overlayPriceScales['8rwg3A'] = TV.inverted;
    rsiPane!.rightAxisesState[0].state = TV.percent;
    const record = parseLayoutJson({ content: JSON.stringify(content), content_study_meta: raw.study_meta_info_map, name: 'T', uid: 'Ab12', id: 9 }, parseListEntry({ image_url: 'Ab12', url: 'Ab12', id: 9, name: 'T' }));
    const chart = parseLayout(record, null).charts[0]!;
    expect(chart.priceScale).toEqual({ mode: 'log', inverted: false, manualRange: { min: 6.567116487700534, max: 7.489566141915238 } });

    const plan = planChart(parseLayout(record, null), chart, { chartId: '1', symbol: chart.symbol, interval: 'D', fetchedAt: '', bars: [[1, 1, 2, 0.5, 1.5, 10]], studies: { '8rwg3A': { status: 'ok', metaInfoId: '', rows: [] }, q1aEhE: { status: 'ok', metaInfoId: '', rows: [] }, CRwkdm: { status: 'ok', metaInfoId: '', rows: [] } } });
    const scaleOf = (id: string) => plan.panes.flatMap((p) => p.studies).find((s) => s.study.id === id)?.priceScale;
    expect(scaleOf('8rwg3A')).toMatchObject({ mode: 'normal', inverted: true });
    expect(scaleOf('CRwkdm')).toMatchObject({ mode: 'log' });
    expect(scaleOf('q1aEhE')).toMatchObject({ mode: 'percentage' });
  });
});

describe('mapping the scale onto lightweight-charts', () => {
  it('uses the matching lightweight-charts mode and inversion', () => {
    expect(priceScaleOptions(parsePriceScale(TV.log))).toEqual({ mode: PriceScaleMode.Logarithmic, invertScale: false });
    expect(priceScaleOptions(parsePriceScale(TV.percent)).mode).toBe(PriceScaleMode.Percentage);
    expect(priceScaleOptions(parsePriceScale(TV.indexed)).mode).toBe(PriceScaleMode.IndexedTo100);
    expect(priceScaleOptions(parsePriceScale(TV.inverted))).toEqual({ mode: PriceScaleMode.Normal, invertScale: true });
    expect(priceScaleOptions(parsePriceScale(TV.normalManual))).toMatchObject({ autoScale: false });
  });

  it("converts prices to TradingView's log units: its visible range less the margins is its saved manual range", () => {
    const units = priceRangeInScaleUnits('log', TV.logManualVisible)!;
    const span = units.to - units.from;
    expect(units.from + base.m_bottomMargin * span).toBeCloseTo(TV.logManual.m_priceRange.m_minValue, 3);
    expect(units.to - base.m_topMargin * span).toBeCloseTo(TV.logManual.m_priceRange.m_maxValue, 3);
  });

  it('passes prices through on a normal scale and refuses ranges it cannot place', () => {
    expect(priceRangeInScaleUnits('normal', { from: 1, to: 2 })).toEqual({ from: 1, to: 2 });
    expect(priceRangeInScaleUnits('percentage', { from: 1, to: 2 })).toBeNull();
    expect(priceRangeInScaleUnits('log', { from: -5, to: 2 })).toBeNull();
    expect(toLogUnits(1000)).toBeCloseTo(7, 6);
  });
});
