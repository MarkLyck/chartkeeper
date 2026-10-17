import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countLayout, drawingsForChart, parseLayout } from '../../src/core/layout';
import { contentWithDrawings } from '../../src/core/restore';
import { drawingSourceFromStored, isDrawingType, LayoutParseError } from '../../src/core/tv/content';
import { layoutSlots, parseLayoutJson, parseListEntry } from '../../src/core/tv/client';
import { FIXTURES, referenceInAccount, referenceRecord } from '../fakes/fixtures';

const tvSaved = JSON.parse(readFileSync(path.join(FIXTURES, 'tv-saved-layout.json'), 'utf8'));

describe('parsing a layout exactly as TradingView saved it', () => {
  const entry = parseListEntry({ image_url: 'Ab12', url: 'Ab12', id: 9, name: 'Test' });
  const record = parseLayoutJson({ content: tvSaved.content, content_study_meta: tvSaved.study_meta_info_map, name: 'Test', uid: 'Ab12', id: 9 }, entry);
  const layout = parseLayout(record, null);

  it('finds the chart, its symbol and interval', () => {
    expect(layout.charts).toHaveLength(1);
    expect(layout.charts[0]).toMatchObject({ chartId: '1', symbol: 'NASDAQ:AAPL', interval: 'D', style: 1 });
  });

  it('finds all 11 drawings with their points and styles', () => {
    const drawings = layout.charts[0]!.panes.flatMap((p) => p.drawings);
    expect(drawings.map((d) => d.type).sort()).toEqual(
      ['LineToolArrowMarkUp', 'LineToolEllipse', 'LineToolFibRetracement', 'LineToolHorzLine', 'LineToolHorzRay', 'LineToolParallelChannel', 'LineToolRay', 'LineToolRectangle', 'LineToolText', 'LineToolTrendLine', 'LineToolVertLine'].sort(),
    );
    const trend = drawings.find((d) => d.type === 'LineToolTrendLine')!;
    expect(trend.points).toEqual([{ time: 1775606400, offset: 0, price: 255 }, { time: 1785196800, offset: 0, price: 315 }]);
    expect(trend.props).toMatchObject({ linecolor: '#ff9800', linewidth: 3 });
    expect(drawings.find((d) => d.type === 'LineToolText')!.props.text).toBe('Buy here');
  });

  it('resolves indicators against the separate study_meta_info_map', () => {
    const studies = layout.charts[0]!.panes.flatMap((p) => p.studies);
    expect(studies.map((s) => s.metaInfoId).sort()).toEqual(['Script$STD;Bollinger_Bands@tv-scripting-101[v.35.0]', 'Script$STD;RSI@tv-scripting-101[v.47.0]', 'Volume@tv-basicstudies-280']);
    const bb = studies.find((s) => s.shortName === 'BB')!;
    expect(bb).toMatchObject({ isPine: true, isPriceStudy: true });
    expect(bb.plots.map((p) => p.id)).toEqual(['plot_0', 'plot_1', 'plot_2']);
    expect(bb.inputs).toMatchObject({ in_0: 20, in_2: 'close', in_3: 2 });
  });

  it('rejects a layout without charts instead of returning an empty one', () => {
    expect(() => parseLayout({ ...record, content: { charts: [] } }, null)).toThrow(LayoutParseError);
  });
});

describe('drawings from the drawing storage', () => {
  it('accepts the DTO whose state is the full drawing source', () => {
    const src = drawingSourceFromStored('x1', { id: 'x1', ownerSource: '_seriesId', state: { type: 'LineToolHorzLine', id: 'x1', state: { linecolor: 'red' }, points: [{ time_t: 1, offset: 0, price: 2 }] } });
    expect(src).toMatchObject({ type: 'LineToolHorzLine', id: 'x1', ownerSource: '_seriesId' });
  });

  it('accepts the DTO whose state holds only the properties', () => {
    const src = drawingSourceFromStored('x2', { id: 'x2', type: 'LineToolRay', ownerSource: '_seriesId', state: { linecolor: 'red' }, points: [{ time_t: 1, offset: 0, price: 2 }] });
    expect(src).toMatchObject({ type: 'LineToolRay', id: 'x2', state: { linecolor: 'red' } });
  });

  it('reports an unknown drawing format as a problem', () => {
    expect(() => drawingSourceFromStored('x3', { id: 'x3', state: { foo: 1 } })).toThrow(/does not recognise/);
  });

  it('merges storage drawings with content drawings, counting each id once', () => {
    const fake = referenceInAccount();
    const rec = { ...referenceRecord(), content: fake.content };
    const buckets = Object.fromEntries(Object.entries(fake.storage).map(([k, v]) => [k, { sources: v, drawing_groups: {} }]));
    // The same drawing in both places must not be counted twice.
    const dup = Object.values(fake.storage['1']!)[0]!;
    buckets._shared!.sources[String(dup.id)] = dup;
    const counts = countLayout(parseLayout(rec, { buckets, reportedTotal: null }));
    expect(counts.drawings).toBe(11);
    expect(new Set(counts.drawingIds).size).toBe(11);
  });
});

describe('where a stored drawing goes', () => {
  const horz = (id: string, ownerSource: string, symbol?: string) => ({
    id,
    ownerSource,
    state: { type: 'LineToolHorzLine', id, ownerSource, state: { linecolor: '#fff', ...(symbol ? { symbol } : {}) }, points: [{ time_t: 1780000000, offset: 0, price: 1 }] },
  });
  const bucket = (sources: Record<string, Record<string, unknown>>) => ({ sources, drawing_groups: {} });

  it('goes on the indicator pane that owns it, and an orphan goes on the price pane', () => {
    const rec = referenceRecord();
    const drawings = { buckets: { '1': bucket({ onRsi: horz('onRsi', 'YuxZ0W'), orphan: horz('orphan', 'deleted-indicator') }) }, reportedTotal: null };
    const layout = parseLayout(rec, drawings);
    const ids = (pane: number) => layout.charts[0]!.panes[pane]!.drawings.map((d) => d.id);
    expect(ids(1)).toEqual(['onRsi']);
    expect(ids(0)).toContain('orphan');
    const content = contentWithDrawings(rec, drawings);
    expect(content.charts[0]!.panes[1]!.sources.map((s) => s.id)).toEqual(['YuxZ0W', 'onRsi']);
    expect(content.charts[0]!.panes[0]!.sources.at(-1)!.id).toBe('orphan');
  });

  it('shares a drawing with the chart of the same company, also on another exchange, and nowhere else', () => {
    const rec = referenceRecord();
    const aapl = rec.content.charts[0]!;
    const msft = structuredClone(aapl);
    for (const p of msft.panes) p.sources = p.sources.filter((s) => !isDrawingType(s.type));
    const series = msft.panes[0]!.sources.find((s) => s.type === 'MainSeries')!;
    series.state = { ...(series.state as object), symbol: 'NASDAQ:MSFT' };
    rec.content.charts = [msft, aapl];
    const drawings = { buckets: { _shared: bucket({ s1: horz('s1', '_seriesId', 'BATS:AAPL'), s2: horz('s2', '_seriesId', 'NYSE:IBM') }) }, reportedTotal: null };

    const layout = parseLayout(rec, drawings);
    const shown = (chart: number) => drawingsForChart(layout, layout.charts[chart]!).map((d) => d.id);
    expect(shown(1)).toContain('s1');
    expect(shown(0)).not.toContain('s1');
    expect(shown(0)).not.toContain('s2');

    const content = contentWithDrawings(rec, drawings);
    const restoredOn = (chart: number) => content.charts[chart]!.panes.flatMap((p) => p.sources.map((s) => s.id));
    expect(restoredOn(1)).toContain('s1');
    expect(restoredOn(0)).not.toContain('s1');
    expect(restoredOn(0)).toContain('s2');
  });

  it('gives a stored drawing without an id of its own the id it is stored under', () => {
    expect(drawingSourceFromStored('key1', { ownerSource: '_seriesId', state: { type: 'LineToolRay', state: {}, points: [] } })).toMatchObject({ id: 'key1', ownerSource: '_seriesId' });
  });
});

describe('unusual sources', () => {
  it('keeps a layout with an odd indicator or a numeric id readable instead of failing the backup', () => {
    const content = JSON.parse(tvSaved.content);
    content.charts[0].panes[0].sources.push({ type: 'Study', id: 7, state: null }, { id: 'x', type: 'StudyStrategy', state: [], ownerSource: 5 });
    const rec = parseLayoutJson({ content: JSON.stringify(content), content_study_meta: tvSaved.study_meta_info_map }, parseListEntry({ image_url: 'Odd1' }));
    const layout = parseLayout(rec, null);
    expect(layout.charts[0]!.panes[0]!.studies.map((s) => s.id)).toContain('7');
  });
});

describe('free layout slots', () => {
  it('knows the limits of the published plans', () => {
    expect(layoutSlots({ count: 1 }, 1, 'free')).toMatchObject({ limit: 1, free: false });
    expect(layoutSlots({ count: 4 }, 4, 'pro')).toMatchObject({ limit: 5, free: true });
    expect(layoutSlots({ count: 400 }, 400, 'pro_premium')).toMatchObject({ limit: null, free: true });
  });
  it('does not block a restore for a plan name it has never seen', () => {
    expect(layoutSlots({ count: 3 }, 3, 'trial')).toMatchObject({ limit: null, free: true });
  });
  it('prefers the limit the server reports', () => {
    expect(layoutSlots({ count: 2, limit: 2 }, 2, 'trial')).toMatchObject({ limit: 2, free: false });
  });
});

describe('layout list entries', () => {
  it('fails loudly when an entry has no layout id', () => {
    expect(() => parseListEntry({ name: 'x' })).toThrow(/does not recognise/);
  });
});
