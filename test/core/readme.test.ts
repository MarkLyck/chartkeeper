import { describe, expect, it } from 'vitest';
import type { Manifest, ManifestLayout } from '../../src/core/model';
import { BACKUP_FOLDER_README, snapshotReadme } from '../../src/core/readme';

const layout = (over: Partial<ManifestLayout>): ManifestLayout => ({
  uid: 'AbCd1234', name: 'Gold', dir: 'layouts/AbCd1234', symbols: ['TVC:GOLD'], charts: 1, drawings: 4069, studies: 2, lastModified: null, priceData: true, ...over,
});

const manifest = (over: Partial<Manifest> = {}): Manifest => ({
  formatVersion: 1,
  app: { name: 'ChartKeeper', version: '1.0.0' },
  createdAt: new Date(2026, 9, 17, 18, 5).toISOString(),
  status: 'complete',
  account: { username: 'demo_user', plan: 'free' },
  layouts: [
    layout({}),
    layout({ uid: 'Xy98Zw76', name: 'Unnamed', dir: 'layouts/Xy98Zw76', symbols: ['NASDAQ:AAPL', 'NASDAQ:MSFT'], charts: 2, drawings: 12, studies: 0, priceData: false }),
  ],
  extras: { studyTemplates: 3, drawingTemplates: 1250, themes: 1, scripts: 4, userDrawings: 0 },
  warnings: [],
  files: {},
  ...over,
});

/** The block of lines about one layout, from its name to the next blank line. */
const block = (text: string, name: string) => {
  const start = text.indexOf(name);
  expect(start, `${name} is not in the README`).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf('\n\n', start));
};

describe('the README in each backup folder', () => {
  it('names every layout as TradingView does, with its folder and what it holds', () => {
    const text = snapshotReadme(manifest());
    const gold = block(text, '“Gold”');
    expect(gold).toContain('layouts/AbCd1234');
    expect(gold).toMatch(/Charts: +1\b/);
    expect(gold).toMatch(/Drawings: +4,069\b/);
    expect(gold).toMatch(/Symbols: +1 \(TVC:GOLD\)/);
    expect(gold).toMatch(/Indicators: +2\b/);
    expect(gold).toMatch(/Prices: +saved/);
    const unnamed = block(text, '“Unnamed”');
    expect(unnamed).toContain('layouts/Xy98Zw76');
    expect(unnamed).toMatch(/Charts: +2\b/);
    expect(unnamed).toMatch(/Symbols: +2 \(NASDAQ:AAPL, NASDAQ:MSFT\)/);
    expect(unnamed).toMatch(/Prices: +not saved/);
  });

  it('lists a long list of symbols only in part', () => {
    const symbols = Array.from({ length: 312 }, (_, i) => `NYSE:S${i}`);
    const gold = block(snapshotReadme(manifest({ layouts: [layout({ symbols })] })), '“Gold”');
    expect(gold).toMatch(/Symbols: +312 \(NYSE:S0, NYSE:S1, .*, and 302 more\)/);
    expect(gold).not.toContain('NYSE:S311');
  });

  it('says what else was saved, what the files are, where to look at it, and not to edit it', () => {
    const text = snapshotReadme(manifest());
    expect(text).toMatch(/Drawing templates: +1,250/);
    expect(text).toMatch(/Indicator templates: +3/);
    expect(text).toMatch(/Colour themes: +1/);
    expect(text).toMatch(/Pine scripts: +4/);
    for (const file of ['layout.json', 'drawings.json', 'data/', 'manifest.json']) expect(text).toContain(file);
    expect(text).toContain('View my backups');
    expect(text).toMatch(/do not (change|edit)/i);
    expect(text).toContain('17 October 2026');
    expect(text).toContain('demo_user');
    expect(text).not.toMatch(/INCOMPLETE|did not finish/i);
  });

  it('warns at the top that an incomplete backup did not finish, and why', () => {
    const text = snapshotReadme(manifest({ status: 'incomplete', error: 'TradingView sent no drawings for “Gold”.' }));
    const top = text.split('\n').slice(0, 8).join('\n');
    expect(top).toMatch(/did not finish/i);
    expect(text).toContain('TradingView sent no drawings for “Gold”.');
  });

  it('says so when a backup has no layouts', () => {
    expect(snapshotReadme(manifest({ layouts: [] }))).toMatch(/no layouts/i);
  });
});

describe('the README next to the snapshots folder', () => {
  it('says each backup is a dated folder inside snapshots', () => {
    expect(BACKUP_FOLDER_README).toContain('snapshots');
    expect(BACKUP_FOLDER_README).toMatch(/date/i);
    expect(BACKUP_FOLDER_README).toContain('README.txt');
  });
});
