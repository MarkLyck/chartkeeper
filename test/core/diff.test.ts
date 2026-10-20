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
    s2.push({ type: 'LineToolText', id: 'new1', state: { text: 'Sell', symbol: 'NASDAQ:AAPL' }, points: [{ time_t: 1785000000, offset: 0, price: 320 }], zorder: 1 });
    const ma = s2.find((s) => s.metaInfo === 'MASimple@tv-basicstudies-280')!;
    ma.state.inputs.length = 100;
    const changes = diffLayouts(parseLayout(base(), null), parseLayout(after, null));
    expect(changes).toHaveLength(4);
    expect(changes).toContainEqual({
      kind: 'changed', what: 'drawing-moved', toolType: 'LineToolTrendLine',
      from: [{ time: 1775606400, offset: 0, price: 255, interval: '1D' }, { time: 1785196800, offset: 0, price: 315, interval: '1D' }],
      to: [{ time: 1775606400, offset: 0, price: 255, interval: '1D' }, { time: 1785196800, offset: 0, price: 333, interval: '1D' }],
    });
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'removed', what: 'drawing', toolType: 'LineToolFibRetracement' }));
    expect(changes).toContainEqual({ kind: 'added', what: 'drawing', toolType: 'LineToolText', text: 'Sell', symbol: 'NASDAQ:AAPL', points: [{ time: 1785000000, offset: 0, price: 320, interval: null }] });
    expect(changes).toContainEqual({ kind: 'changed', what: 'study-inputs', shortName: 'MA', inputs: [{ key: 'length', from: '50', to: '100' }] });
  });

  it('lists added and removed layouts', () => {
    const a = parseLayout(base(), null);
    const b = { ...a, uid: 'Other', name: 'Other' };
    expect(diffSnapshots(new Map([[a.uid, a]]), new Map([[b.uid, b]])).map((d) => [d.name, d.status])).toEqual([['Reference AAPL', 'removed'], ['Other', 'added']]);
  });

  it('reports a renamed layout and a new chart arrangement', () => {
    const a = parseLayout(base(), null);
    const b = { ...structuredClone(a), name: 'Renamed', arrangement: '2h' };
    expect(diffLayouts(a, b)).toEqual([
      { kind: 'changed', what: 'layout-name', from: 'Reference AAPL', to: 'Renamed' },
      { kind: 'changed', what: 'arrangement', from: 's', to: '2h' },
    ]);
  });

  it('reports charts added and removed, and a chart whose symbol, interval or style changed', () => {
    const one = parseLayout(base(), null);
    const two = structuredClone(one);
    two.charts.push({ ...structuredClone(one.charts[0]!), chartId: '2', symbol: 'NASDAQ:MSFT', interval: '60' });
    expect(diffLayouts(one, two)).toEqual([{ kind: 'added', what: 'chart', index: 1, symbol: 'NASDAQ:MSFT', interval: '60' }]);
    expect(diffLayouts(two, one)).toEqual([{ kind: 'removed', what: 'chart', index: 1, symbol: 'NASDAQ:MSFT', interval: '60' }]);

    const changed = structuredClone(one);
    Object.assign(changed.charts[0]!, { symbol: 'NYSE:IBM', interval: 'W', style: 2 });
    expect(diffLayouts(one, changed)).toEqual([
      { kind: 'changed', what: 'chart-symbol', index: 0, from: 'NASDAQ:AAPL', to: 'NYSE:IBM' },
      { kind: 'changed', what: 'chart-interval', index: 0, from: 'D', to: 'W' },
      { kind: 'changed', what: 'chart-style', index: 0 },
    ]);
  });

  it('reports indicators added, removed and restyled, but not a recompiled script', () => {
    const a = parseLayout(base(), null);
    const pane = (l: typeof a) => l.charts[0]!.panes[0]!;
    const [first, ...rest] = pane(a).studies;
    const removed = structuredClone(a);
    pane(removed).studies = rest;
    expect(diffLayouts(a, removed)).toEqual([{ kind: 'removed', what: 'study', shortName: first!.shortName, name: first!.name }]);
    expect(diffLayouts(removed, a)).toEqual([{ kind: 'added', what: 'study', shortName: first!.shortName, name: first!.name }]);

    const restyled = structuredClone(a);
    pane(restyled).studies[0]!.styles = { plot_0: { color: '#123456' } };
    pane(restyled).studies[0]!.inputs = { ...pane(restyled).studies[0]!.inputs, text: 'recompiled source' };
    expect(diffLayouts(a, restyled)).toEqual([{ kind: 'changed', what: 'study-style', shortName: first!.shortName }]);
  });

  it('reports which drawing properties changed, ignoring key order', () => {
    const a = parseLayout(base(), null);
    const b = structuredClone(a);
    const d = b.charts[0]!.panes[0]!.drawings.find((x) => x.type === 'LineToolTrendLine')!;
    d.props = Object.fromEntries(Object.entries(d.props).reverse());
    expect(diffLayouts(a, b)).toEqual([]);
    d.props = { ...d.props, linecolor: '#000000', linewidth: undefined, newProp: { b: 1, a: 2 } };
    expect(diffLayouts(a, b)).toEqual([
      {
        kind: 'changed', what: 'drawing-props', toolType: 'LineToolTrendLine',
        props: [
          { key: 'linecolor', from: '"#ff9800"', to: '"#000000"' },
          { key: 'linewidth', from: '3', to: null },
          { key: 'newProp', from: null, to: '{"a":2,"b":1}' },
        ],
      },
    ]);
  });

  it('lists removed layouts first, then changed, added and unchanged ones, each by name', () => {
    const l = parseLayout(base(), null);
    const named = (uid: string, name: string) => ({ ...structuredClone(l), uid, name });
    const before = new Map([['r', named('r', 'Removed')], ['s2', named('s2', 'B same')], ['s1', named('s1', 'A same')], ['c', named('c', 'Changed')]]);
    const after = new Map([['a', named('a', 'Added')], ['s2', named('s2', 'B same')], ['s1', named('s1', 'A same')], ['c', named('c', 'Changed now')]]);
    expect(diffSnapshots(before, after).map((d) => [d.name, d.status])).toEqual([
      ['Removed', 'removed'],
      ['Changed now', 'changed'],
      ['Added', 'added'],
      ['A same', 'same'],
      ['B same', 'same'],
    ]);
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
