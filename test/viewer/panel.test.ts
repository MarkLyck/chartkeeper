import { describe, expect, it } from 'vitest';
import { summarizeNotShown } from '../../src/renderer/viewer/panel';
import type { NotShownItem } from '../../src/renderer/viewer/plan';
import { reasonText, type NotShownReason } from '../../src/renderer/viewer/strings';

const item = (chartId: string, id: string, name: string, reason: NotShownReason): NotShownItem => ({ chartId, kind: 'drawing', id, name, partial: false, reason, message: reasonText(reason) });
const elsewhere = (chartId: string, id: string, symbol: string) => item(chartId, id, 'Trend line', { code: 'other-symbol', symbol });
const notInLayout = (chartId: string, id: string, symbol: string) => item(chartId, id, 'Horizontal line', { code: 'symbol-not-in-layout', symbol });
const gold = { chartId: '1', shortName: 'GOLD', interval: 'D' };
const silver = { chartId: '2', shortName: 'SILVER', interval: '60' };

describe('the "Not shown" list', () => {
  it('says in one line which other symbols hold drawings, most drawings first, and lists other reasons as before', () => {
    const items = [
      elsewhere('1', 'a', 'NYSE:AG'),
      elsewhere('1', 'b', 'TVC:SILVER'),
      item('1', 'h', 'Ray', { code: 'hidden' }),
      notInLayout('1', 'c', 'TVC:SILVER'),
      elsewhere('1', 'd', 'TVC:SILVER'),
    ];
    const s = summarizeNotShown(items, [gold])!;
    expect(s.count).toBe('5');
    expect(s.open).toBe(true);
    expect(s.charts).toEqual([{
      heading: null,
      lines: [
        { names: 'Ray', title: 'Drawing h', text: 'Hidden in TradingView' },
        { names: null, title: '', text: '4 drawings on 2 other symbols are saved in this backup. TradingView shows them when the chart is switched to that symbol: TVC:SILVER (3), NYSE:AG (1)' },
      ],
    }]);
  });

  it('starts closed when every item is only on another symbol', () => {
    const s = summarizeNotShown([elsewhere('1', 'a', 'NYSE:AG')], [gold])!;
    expect(s.open).toBe(false);
    expect(s.charts[0]!.lines.map((l) => l.text)).toEqual(['1 drawing on 1 other symbol is saved in this backup. TradingView shows it when the chart is switched to that symbol: NYSE:AG (1)']);
  });

  it('keeps thousands of drawings on hundreds of symbols to one short line', () => {
    const counts: [string, number][] = [['NYSE:AG', 15], ['TVC:SILVER', 24], ...Array.from({ length: 310 }, (_, i): [string, number] => [`NYSE:S${i}`, 13])];
    const items = counts.flatMap(([symbol, n]) => Array.from({ length: n }, (_, i) => elsewhere('1', `${symbol}-${i}`, symbol)));
    const s = summarizeNotShown(items, [gold])!;
    expect(s.count).toBe('4,069');
    expect(s.open).toBe(false);
    expect(s.charts[0]!.lines).toHaveLength(1);
    const { text } = s.charts[0]!.lines[0]!;
    expect(text.startsWith('4,069 drawings on 312 other symbols are saved in this backup. TradingView shows them when the chart is switched to that symbol: TVC:SILVER (24), NYSE:AG (15), NYSE:S')).toBe(true);
    expect(text.endsWith(', and 292 more')).toBe(true);
    expect(text.length).toBeLessThan(600);
  });

  it('gives each chart of a multi-chart layout its own line', () => {
    const s = summarizeNotShown([elsewhere('1', 'a', 'NYSE:AG'), elsewhere('2', 'b', 'TVC:GOLD'), elsewhere('2', 'c', 'TVC:GOLD')], [gold, silver])!;
    expect(s.charts.map((c) => [c.heading, c.lines.map((l) => l.text.split('.')[0])])).toEqual([
      ['Chart 1 · GOLD · 1D', ['1 drawing on 1 other symbol is saved in this backup']],
      ['Chart 2 · SILVER · 1h', ['2 drawings on 1 other symbol are saved in this backup']],
    ]);
  });

  it('shows nothing when everything was drawn', () => {
    expect(summarizeNotShown([], [gold])).toBeNull();
  });
});
