import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParsedLayout, ParsedStudy } from '../../src/core/layout';
import type { ChartData } from '../../src/core/model';
import { SnapshotReader } from '../../src/core/snapshot';
import { inflateStudyGraphics } from '../../src/core/studyGraphics';
import { openLayout } from '../../src/core/snapshotView';
import { planPivots, visiblePeriods, type HighLowPivots, type StandardPivots } from '../../src/renderer/viewer/pivots';
import { planLayout } from '../../src/renderer/viewer/plan';

/** NYSE:JPM daily with Pivot Points Standard (Traditional, Auto = monthly) and Pivot Points High Low (10/10), as TradingView stored them. */
const SCENE = 'indicators-4';
let layout: ParsedLayout;
let data: ChartData;

beforeAll(async () => {
  const reader = await SnapshotReader.open(path.join(__dirname, '../fixtures/gallery', SCENE));
  const loaded = await openLayout(reader, SCENE);
  layout = loaded.layout;
  data = loaded.data['1']!;
});

const studyOf = (prefix: string): ParsedStudy => layout.charts[0]!.panes.flatMap((p) => p.studies).find((s) => s.metaInfoId.startsWith(prefix))!;
const graphicsOf = (s: ParsedStudy) => {
  const v = data.studies[s.id]!;
  return v.status === 'ok' ? v.graphics : null;
};
const day = (i: number) => new Date(data.bars[i]![0] * 1000).toISOString().slice(0, 10);

describe('Pivot Points Standard', () => {
  const standard = () => planPivots(studyOf('PivotPointsStandard'), graphicsOf(studyOf('PivotPointsStandard')), data.bars, {}) as StandardPivots;

  it('maps each period to the bars of its month, the current one running past the last bar to the month end', () => {
    const plan = standard();
    expect(plan.periods).toHaveLength(15);
    const last = plan.periods.at(-1)!;
    expect(day(last.start)).toBe('2026-10-01');
    expect([last.start, last.end, data.bars.length - 1]).toEqual([588, 609, 599]);
    expect(day(plan.periods.at(-2)!.start)).toBe('2026-09-01');
  });

  it('draws the eleven levels with the labels and prices TradingView shows for October', () => {
    const last = standard().periods.at(-1)!;
    expect(last.lines.map((l) => l.label)).toEqual(['P', 'S1', 'R1', 'S2', 'R2', 'S3', 'R3', 'S4', 'R4', 'S5', 'R5']);
    expect(last.levels.map((l) => `${l.name} ${l.price.toFixed(2)}`)).toEqual([
      'P 341.51', 'S1 320.15', 'R1 352.18', 'S2 309.48', 'R2 373.54', 'S3 288.12', 'R3 384.21', 'S4 266.77', 'R4 394.89', 'S5 245.42', 'R5 405.57',
    ]);
    expect(last.lines[0]).toMatchObject({ color: '#FB8C00', width: 1 });
  });

  it('leaves out hidden level groups and shares one line and label between levels at the same price', () => {
    const study = studyOf('PivotPointsStandard');
    const levelsStyle = study.state.levelsStyle as { visibility: Record<string, boolean> };
    const hidden: ParsedStudy = { ...study, state: { ...study.state, levelsStyle: { ...levelsStyle, visibility: { ...levelsStyle.visibility, 'S5/R5': false } } } };
    const graphics = { d: JSON.stringify({ data: { pivots: [{ startIndex: 0, endIndex: 1, p: 10, s1: 9, r1: 10, s2: 8, r2: 12, s3: 7, r3: 13, s4: 6, r4: 14, s5: 5, r5: 15 }] } }), indexes: [3, 5] };
    const plan = planPivots(hidden, graphics, data.bars, {}) as StandardPivots;
    expect(plan.periods[0]).toMatchObject({ start: 3, end: 5 });
    expect(plan.periods[0]!.lines.map((l) => l.label)).toEqual(['P/R1', 'S1', 'S2', 'R2', 'S3', 'R3', 'S4', 'R4']);
    expect(plan.periods[0]!.levels.map((l) => l.name)).not.toContain('R5');
  });

  it('shows the period holding the last visible bar, plus earlier ones only when historical pivots are on', () => {
    const plan = standard();
    const inSeptember = plan.periods.findIndex((p) => day(p.start) === '2026-09-01');
    const sept = plan.periods[inSeptember]!;
    expect(visiblePeriods(plan, sept.start + 3).current).toBe(sept);
    expect(visiblePeriods(plan, sept.start + 3).drawn).toHaveLength(inSeptember + 1);
    expect(visiblePeriods({ ...plan, showHistorical: false }, sept.start + 3).drawn).toEqual([sept]);
  });

  it('follows "show indicator last value" for the price axis labels', () => {
    const study = studyOf('PivotPointsStandard');
    expect((planPivots(study, graphicsOf(study), data.bars, { showStudyLastValue: false }) as StandardPivots).axisLabels).toBe(false);
  });
});

describe('Pivot Points High Low', () => {
  it('labels each pivot high at its bar high and each pivot low at its bar low, skipping pivots before the loaded bars', () => {
    const study = studyOf('PivotPointsHighLow');
    const plan = planPivots(study, graphicsOf(study), data.bars, {}) as HighLowPivots;
    expect(plan.pivots).toHaveLength(34);
    const at = (date: string) => plan.pivots.find((p) => day(p.index) === date);
    expect(at('2026-08-13')).toEqual({ index: 554, high: true, price: 366.5 });
    expect(at('2026-05-20')).toEqual({ index: 496, high: false, price: 293.67 });
    expect(plan).toMatchObject({ fontSize: 10, borderColor: '#2962FF', backColor: '#E3EFFD', textColor: '#0F0F0F' });
  });
});

describe('planning a chart with pivot points', () => {
  it('draws both indicators without listing their output as not shown', () => {
    const plan = planLayout(layout, { '1': data });
    expect(plan.notShown.filter((n) => n.kind === 'indicator')).toEqual([]);
    expect(plan.charts[0]!.panes[0]!.studies.map((s) => s.pivots?.kind)).toEqual(['standard', 'high-low']);
  });
});

describe('inflateStudyGraphics', () => {
  const chart = (graphics: unknown): ChartData => ({
    chartId: '1', symbol: 'X', interval: 'D', fetchedAt: '', bars: [],
    studies: { a: { status: 'ok', metaInfoId: 'PivotPointsHighLow@tv-basicstudies-280', rows: [], graphics } },
  });
  const graphicsAfter = (graphics: unknown) => (inflateStudyGraphics(chart(graphics)).studies.a as { graphics: unknown }).graphics;

  it('replaces a zlib "dataCompressed" payload with the plain "data" TradingView inflates it to', () => {
    const payload = deflateSync(JSON.stringify({ pivots: [{ index: 0, type: 1 }] })).toString('base64');
    const out = graphicsAfter({ d: JSON.stringify({ dataCompressed: payload }), indexes: [7] }) as { d: string; indexes: number[] };
    expect(JSON.parse(out.d)).toEqual({ data: { pivots: [{ index: 0, type: 1 }] } });
    expect(out.indexes).toEqual([7]);
  });

  it('keeps a payload that does not inflate as stored', () => {
    const stored = { d: JSON.stringify({ dataCompressed: 'not zlib' }) };
    expect(graphicsAfter(stored)).toEqual(stored);
  });
});
