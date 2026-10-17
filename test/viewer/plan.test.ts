import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { countLayout, drawingsForChart, parseLayout, type ParsedLayout } from '../../src/core/layout';
import type { ChartData, DrawingsRecord, LayoutRecord } from '../../src/core/model';
import { SnapshotReader } from '../../src/core/snapshot';
import { planLayout, type LayoutPlan } from '../../src/renderer/viewer/plan';

const UID = 'RefAAPL1';
let record: LayoutRecord;
let chartData: ChartData;

beforeAll(async () => {
  const reader = await SnapshotReader.open(path.join(__dirname, '../fixtures/reference-snapshot'));
  record = await reader.layout(UID);
  chartData = (await reader.chartData(UID, '1'))!;
});

/** Study ids are TradingView's random ids, new on every capture of the reference. */
const studyId = (metaInfoPrefix: string) => Object.entries(chartData.studies).find(([, s]) => s.metaInfoId.startsWith(metaInfoPrefix))![0];

/**
 * The never-silently-drop rule: on every chart, each drawing and indicator is
 * either drawn or listed as not shown (as a whole, not just partially), and
 * shared drawings that fit no chart are listed too.
 */
function expectEveryItemAccountedFor(layout: ParsedLayout, plan: LayoutPlan) {
  layout.charts.forEach((chart, i) => {
    const p = plan.charts[i]!;
    const drawn = new Set([...p.rendered.drawings, ...p.rendered.studies]);
    const listed = new Set(plan.notShown.filter((n) => n.chartId === chart.chartId && !n.partial).map((n) => n.id));
    const ids = [...drawingsForChart(layout, chart).map((d) => d.id), ...chart.panes.flatMap((pane) => pane.studies.map((s) => s.id))];
    for (const id of ids) expect(drawn.has(id) !== listed.has(id), `chart ${chart.chartId}: ${id} must be drawn or listed, not both or neither`).toBe(true);
  });
  const placed = new Set(layout.charts.flatMap((c) => drawingsForChart(layout, c).map((d) => d.id)));
  for (const d of layout.sharedDrawings.filter((d) => !placed.has(d.id))) expect(plan.notShown.some((n) => n.id === d.id)).toBe(true);
  expect(countLayout(layout).drawings).toBeGreaterThan(0);
}

const clone = <T>(v: T): T => structuredClone(v);
const reasonOf = (plan: LayoutPlan, id: string) => plan.notShown.find((n) => n.id === id && !n.partial)?.reason.code;

describe('planLayout on the reference snapshot', () => {
  it('draws all 11 drawings and both indicators', () => {
    const layout = parseLayout(record, null);
    const plan = planLayout(layout, { 1: chartData });
    expectEveryItemAccountedFor(layout, plan);
    expect(plan.notShown).toEqual([]);
    expect(plan.charts[0]!.rendered.drawings).toHaveLength(11);
    expect(plan.charts[0]!.rendered.studies.sort()).toEqual([studyId('MASimple@'), studyId('RSI@')].sort());
    const panes = plan.charts[0]!.panes;
    expect(panes.map((p) => [p.main, p.studies.map((s) => s.study.shortName)])).toEqual([
      [true, ['MA']],
      [false, ['RSI']],
    ]);
    expect(panes.map((p) => p.stretchFactor)).toEqual([2000, 1000]);
  });
});

describe('planLayout on a layout with problems', () => {
  function problemLayout(): { layout: ParsedLayout; data: Record<string, ChartData | null> } {
    const content = clone(record.content);
    const mainSources = content.charts[0]!.panes[0]!.sources;
    const trend = mainSources.find((s) => s.id === 'tl0001')!;
    mainSources.push(
      { ...clone(trend), id: 'unknown1', type: 'LineToolNotARealTool' },
      { ...clone(trend), id: 'hidden1', state: { ...(trend.state as object), visible: false } },
      { ...clone(trend), id: 'short1', points: [(trend.points as unknown[])[0]] },
      { ...clone(trend), id: 'msft1', state: { ...(trend.state as object), symbol: 'NASDAQ:MSFT' } },
      { type: 'Study', id: 'err1', metaInfo: 'MASimple@tv-basicstudies-280', state: { inputs: { length: 500 }, styles: {}, visible: true } },
      { type: 'Study', id: 'nodata1', metaInfo: 'MASimple@tv-basicstudies-280', state: { inputs: { length: 20 }, styles: {}, visible: true } },
      { type: 'Study', id: 'pine1', metaInfo: 'MASimple@tv-basicstudies-280', state: { inputs: { length: 10 }, styles: {}, visible: true } },
      { type: 'Study', id: 'off1', metaInfo: 'MASimple@tv-basicstudies-280', state: { inputs: { length: 30 }, styles: {}, visible: false } },
    );
    const chart2 = clone(content.charts[0]!);
    chart2.chartId = '2';
    for (const pane of chart2.panes) for (const src of pane.sources) if (src.id !== '_seriesId') src.id += '-2';
    content.charts.push(chart2);
    content.layout = '2h';
    const drawings: DrawingsRecord = {
      reportedTotal: null,
      buckets: {
        _shared: {
          drawing_groups: {},
          sources: {
            sharedAapl: { id: 'sharedAapl', ownerSource: '_seriesId', state: { ...clone(trend), id: 'sharedAapl', state: { ...(trend.state as object), symbol: 'BATS:AAPL' } } },
            sharedTsla: { id: 'sharedTsla', ownerSource: '_seriesId', state: { ...clone(trend), id: 'sharedTsla', state: { ...(trend.state as object), symbol: 'NASDAQ:TSLA' } } },
          },
        },
      },
    };
    const layout = parseLayout({ ...record, content }, drawings);
    const ma = chartData.studies[studyId('MASimple@')]!;
    if (ma.status !== 'ok') throw new Error('the reference Moving Average has values');
    const data: ChartData = {
      ...chartData,
      studies: {
        ...chartData.studies,
        err1: { status: 'error', metaInfoId: 'MASimple@tv-basicstudies-280', error: 'study_limit_exceeded' },
        pine1: { ...ma, graphics: { d: JSON.stringify({ graphicsCmds: { create: { labels: [{ id: 1 }] } } }) } },
      },
    };
    return { layout, data: { 1: data, 2: null } };
  }

  it('lists each problem with its reason and still draws the rest', () => {
    const { layout, data } = problemLayout();
    const plan = planLayout(layout, data);
    expectEveryItemAccountedFor(layout, plan);

    const chart1 = plan.charts[0]!;
    expect(chart1.rendered.drawings).toContain('tl0001');
    expect(chart1.rendered.drawings).toContain('sharedAapl');
    expect(chart1.rendered.studies).toContain('pine1');
    expect(reasonOf(plan, 'unknown1')).toBe('unknown-drawing');
    expect(reasonOf(plan, 'hidden1')).toBe('hidden');
    expect(reasonOf(plan, 'short1')).toBe('too-few-points');
    expect(reasonOf(plan, 'msft1')).toBe('other-symbol');
    expect(reasonOf(plan, 'err1')).toBe('study-error');
    expect(reasonOf(plan, 'nodata1')).toBe('no-study-values');
    expect(reasonOf(plan, 'off1')).toBe('hidden');
    expect(reasonOf(plan, 'sharedTsla')).toBe('symbol-not-in-layout');
    expect(plan.notShown.find((n) => n.id === 'pine1')).toMatchObject({ partial: true, reason: { code: 'pine-graphics' } });
    expect(plan.notShown.find((n) => n.id === 'err1')!.message).toBe('Could not be calculated: study_limit_exceeded');

    const chart2Items = plan.notShown.filter((n) => n.chartId === '2');
    expect(plan.charts[1]!.rendered).toEqual({ drawings: [], studies: [] });
    expect(chart2Items.length).toBeGreaterThan(0);
    expect(chart2Items.every((n) => n.reason.code === 'no-price-data' || n.reason.code === 'other-symbol')).toBe(true);
  });

  it('names what is not shown and says why in plain words', () => {
    const { layout, data } = problemLayout();
    const plan = planLayout(layout, data);
    expect(plan.notShown.find((n) => n.id === 'hidden1')).toMatchObject({ name: 'Trend line', message: 'Hidden in TradingView' });
    expect(plan.notShown.find((n) => n.id === 'nodata1')!.message).toBe('No values were saved for this indicator');
  });
});
