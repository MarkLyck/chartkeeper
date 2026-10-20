import { describe, expect, it } from 'vitest';
import type { ManifestLayout } from '../../src/core/model';
import { layoutFacts, layoutTitle } from '../../src/renderer/ui/snapshots';

const layout = (name: string, symbols = ['COMEX:SI1!']): ManifestLayout => ({ uid: 'u1', name, dir: 'layouts/u1', symbols, charts: 1, drawings: 1, studies: 1, lastModified: null, priceData: true });

describe('what a backed-up layout is called', () => {
  it('keeps a name given in TradingView, with its symbols in the facts', () => {
    expect(layoutTitle(layout('Silver swing'))).toBe('Silver swing');
    expect(layoutFacts(layout('Silver swing'))).toBe('SI1! · 1 drawing · 1 indicator');
  });

  it('calls a layout TradingView left "Unnamed" by its symbols, and says it has no name', () => {
    for (const name of ['Unnamed', 'unnamed', '', '(no name)']) expect(layoutTitle(layout(name))).toBe('SI1!');
    expect(layoutTitle(layout('Unnamed', ['NASDAQ:AAPL', 'NASDAQ:MSFT']))).toBe('AAPL, MSFT');
    expect(layoutFacts(layout('Unnamed'))).toBe('No name in TradingView · 1 drawing · 1 indicator');
  });

  it('keeps "Unnamed" when there is no symbol to go by', () => {
    expect(layoutTitle(layout('Unnamed', []))).toBe('Unnamed');
  });
});
