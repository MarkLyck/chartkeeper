import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { LayoutRecord } from '../../src/core/model';
import type { FakeLayout } from './fakeTradingView';

export const FIXTURES = path.resolve(__dirname, '../fixtures');

export const referenceRecord = (): LayoutRecord => JSON.parse(readFileSync(path.join(FIXTURES, 'reference-snapshot/layouts/RefAAPL1/layout.json'), 'utf8'));

/**
 * The reference layout as a real account stores it today: three drawings left
 * in the content, the rest in the drawing storage (chart "1" and "_shared"),
 * wrapped in the storage DTO `{id, ownerSource, state: <source>, symbol}`.
 */
export function referenceInAccount(uid = 'AbCd1234', name = 'Min AAPL'): FakeLayout {
  const rec = referenceRecord();
  const content = structuredClone(rec.content);
  const storage: FakeLayout['storage'] = { '1': {}, _shared: {} };
  let n = 0;
  for (const pane of content.charts[0]!.panes) {
    pane.sources = pane.sources.filter((s) => {
      if (!s.type.startsWith('LineTool')) return true;
      n++;
      if (n <= 3) return true;
      const bucket = n % 4 === 0 ? '_shared' : '1';
      storage[bucket]![s.id] = { id: s.id, ownerSource: s.ownerSource, state: s, symbol: 'NASDAQ:AAPL', currencyId: null, unitId: null };
      return false;
    });
  }
  return { uid, id: 501, name, content, studyMeta: rec.studyMetaInfoMap, storage, listExtra: { symbol: 'NASDAQ:AAPL', resolution: '1D', short_name: 'AAPL' } };
}
