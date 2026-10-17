import { describe, expect, it } from 'vitest';
import { diffLayouts, diffNamed, diffSnapshots } from '../../src/core/diff';
import { parseLayout } from '../../src/core/layout';
import { referenceRecord } from '../fakes/fixtures';

const base = () => referenceRecord();
const sourcesOf = (r: ReturnType<typeof base>) => (r.content.charts as { panes: { sources: Record<string, any>[] }[] }[])[0]!.panes[0]!.sources;

describe('comparing two backups', () => {
  it('reports nothing for identical layouts', () => {
    expect(diffLayouts(parseLayout(base(), null), parseLayout(base(), null))).toEqual([]);
  });

  it('reports a moved trend line, a deleted fib, a new text and a changed indicator setting', () => {
    const after = base();
    const src = sourcesOf(after);
    const trend = src.find((s) => s.type === 'LineToolTrendLine')!;
    trend.points[1].price = 333;
    after.content.charts = structuredClone(after.content.charts);
    const s2 = sourcesOf(after);
    s2.splice(s2.findIndex((s) => s.type === 'LineToolFibRetracement'), 1);
    s2.push({ type: 'LineToolText', id: 'new1', state: { text: 'Sælg', symbol: 'NASDAQ:AAPL' }, points: [{ time_t: 1785000000, offset: 0, price: 320 }], zorder: 1 });
    const ma = s2.find((s) => s.metaInfo === 'MASimple@tv-basicstudies-280')!;
    ma.state.inputs.length = 100;
    const changes = diffLayouts(parseLayout(base(), null), parseLayout(after, null));
    expect(changes).toHaveLength(4);
    expect(changes).toContainEqual({
      kind: 'changed', what: 'drawing-moved', toolType: 'LineToolTrendLine',
      from: [{ time: 1775606400, offset: 0, price: 255 }, { time: 1785196800, offset: 0, price: 315 }],
      to: [{ time: 1775606400, offset: 0, price: 255 }, { time: 1785196800, offset: 0, price: 333 }],
    });
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'removed', what: 'drawing', toolType: 'LineToolFibRetracement' }));
    expect(changes).toContainEqual({ kind: 'added', what: 'drawing', toolType: 'LineToolText', text: 'Sælg', symbol: 'NASDAQ:AAPL', points: [{ time: 1785000000, offset: 0, price: 320 }] });
    expect(changes).toContainEqual({ kind: 'changed', what: 'study-inputs', shortName: 'MA', inputs: [{ key: 'length', from: '50', to: '100' }] });
  });

  it('lists added and removed layouts', () => {
    const a = parseLayout(base(), null);
    const b = { ...a, uid: 'Other', name: 'Other' };
    expect(diffSnapshots(new Map([[a.uid, a]]), new Map([[b.uid, b]])).map((d) => [d.name, d.status])).toEqual([['Reference AAPL', 'removed'], ['Other', 'added']]);
  });

  it('compares named items by content', () => {
    const items = (o: Record<string, unknown>) => new Map(Object.entries(o).map(([k, content]) => [k, { item: k, content }]));
    expect(diffNamed(items({ a: 1, b: { x: 1, y: 2 }, c: 1 }), items({ b: { y: 2, x: 1 }, c: 2, d: 1 }))).toEqual([
      { kind: 'added', item: 'd' },
      { kind: 'removed', item: 'a' },
      { kind: 'changed', item: 'c' },
    ]);
  });
});
