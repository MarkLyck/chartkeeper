import { describe, expect, it } from 'vitest';
import { diffLayouts, diffSnapshots, toolName } from '../../src/core/diff';
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
    const text = changes.map((c) => `${c.kind} ${c.subject}: ${c.detail}`);
    expect(text).toContainEqual(expect.stringMatching(/^changed Trend line: moved: .* 315 → .* 333$/));
    expect(text).toContainEqual(expect.stringMatching(/^removed Fib retracement/));
    expect(text).toContainEqual(expect.stringMatching(/^added Text: Text "Sælg"/));
    expect(text).toContainEqual(expect.stringMatching(/^changed Indicator MA: settings: length: 50 → 100/));
    expect(changes).toHaveLength(4);
  });

  it('lists added and removed layouts', () => {
    const a = parseLayout(base(), null);
    const b = { ...a, uid: 'Other', name: 'Other' };
    expect(diffSnapshots(new Map([[a.uid, a]]), new Map([[b.uid, b]])).map((d) => [d.name, d.status])).toEqual([['Reference AAPL', 'removed'], ['Other', 'added']]);
  });

  it('names drawing tools in plain words', () => {
    expect(toolName('LineToolTrendBasedFibExtension')).toBe('Trend based fib extension');
  });
});
