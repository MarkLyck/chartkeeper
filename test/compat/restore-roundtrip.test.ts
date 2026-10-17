/**
 * "Restore keeps every feature", checked against the real tradingview.com.
 *
 * An advanced account (every drawing tool, customized styles, indicators,
 * chart properties, two charts) is backed up from FakeTradingView with the
 * real backup code and restored with the real restore code. The content the
 * restore sent to the save endpoint is then loaded into a signed-out
 * tradingview.com chart through TradingView's own loader and read back with
 * its own serializer, feature by feature. No account needed.
 *
 *   npm run test:compat
 *
 * Report: .test-output/compat/report.md and report.json.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBackup } from '../../src/core/backup';
import { countLayout, parseLayout } from '../../src/core/layout';
import { restoreLayout, RestoreJournal } from '../../src/core/restore';
import { listSnapshots, SnapshotReader } from '../../src/core/snapshot';
import { TvClient } from '../../src/core/tv/client';
import type { TvContent } from '../../src/core/tv/content';
import { PoliteHttp } from '../../src/core/tv/http';
import { fakeDataSocket } from '../fakes/fakeDataSocket';
import { FakeTradingView } from '../fakes/fakeTradingView';
import { advancedAccount, lineToolsFixture } from './advancedAccount';
import { checkContent, checkSnapshot } from './features';
import { classify, renderMarkdown, staleRewrites, type StageRun } from './report';
import { launchChromium, SignedOutChart } from './signedOutChart';

const OUT = path.resolve(__dirname, '../../.test-output/compat');
const account = advancedAccount();
const runs: StageRun[] = [];
const payloads = new Map<string, { content: TvContent; studyMetaInfoMap: Record<string, unknown> }>();
let tv: FakeTradingView;
let snapshot: SnapshotReader;
let root: string;
let browser: Browser | null = null;
let tradingViewBuild: string | null = null;

const fast = { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} };
const client = () => new TvClient(new PoliteHttp(tv, fast), tv.account!);
const failures = (stage: StageRun['stage']) =>
  runs
    .filter((r) => r.stage === stage)
    .flatMap((r) => [...(r.error ? [{ layout: r.layout, error: r.error }] : []), ...classify(r).filter((c) => c.verdict === 'FAIL').map((c) => ({ layout: c.layout, feature: c.feature, differences: c.unexplained }))]);

beforeAll(async () => {
  tv = new FakeTradingView();
  for (const l of account.layouts) tv.add(l);
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'chartkeeper-compat-'));
  const backup = await runBackup(client(), { root, appVersion: 'compat', includePrices: false, bars: 0, authToken: null, socketFactory: fakeDataSocket().factory, pauseMs: 0 });
  expect(backup, 'backup of the advanced account').toMatchObject({ ok: true, layouts: account.layouts.length });
  snapshot = await SnapshotReader.open((await listSnapshots(root))[0]!.dir);
});

afterAll(async () => {
  await browser?.close();
  await fs.mkdir(OUT, { recursive: true });
  const meta = { tradingViewBuild, date: new Date().toISOString(), unsupported: lineToolsFixture().unsupportedSignedOut };
  await fs.writeFile(path.join(OUT, 'report.md'), renderMarkdown(runs, meta));
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ...meta, results: runs.flatMap(classify), errors: runs.filter((r) => r.error) }, null, 2));
  await fs.rm(root, { recursive: true, force: true });
});

describe('restore keeps every feature', () => {
  it('the backup on disk holds every drawing, indicator and chart setting', async () => {
    expect(await snapshot.verify(), 'snapshot checksums').toEqual([]);
    for (const expected of account.expected) {
      const record = await snapshot.layout(expected.uid);
      const parsed = parseLayout(record, await snapshot.drawings(expected.uid));
      expect(parsed.problems).toEqual([]);
      runs.push({ stage: 'snapshot', layout: expected.uid, checks: checkSnapshot(expected, record, parsed, countLayout(parsed)) });
    }
    expect(failures('snapshot')).toEqual([]);
  });

  it('the restore sends TradingView every drawing, indicator and chart setting', async () => {
    for (const expected of account.expected) {
      const before = tv.requests.length;
      await restoreLayout(client(), snapshot, expected.uid, { kind: 'new' }, { root, journal: new RestoreJournal(path.join(root, 'journal.json')), buildTime: null });
      const saves = tv.requests.slice(before).filter((r) => r.method === 'POST' && r.url.endsWith('/api/v1/charts/save/'));
      expect(saves, `one save request for ${expected.uid}`).toHaveLength(1);
      const form = saves[0]!.form!;
      const payload = { content: JSON.parse(form.content!) as TvContent, studyMetaInfoMap: JSON.parse(form.study_meta_info_map!) as Record<string, unknown> };
      payloads.set(expected.uid, payload);
      runs.push({ stage: 'payload', layout: expected.uid, checks: checkContent(expected, payload.content, 'payload') });
    }
    expect(failures('payload')).toEqual([]);
  });

  it("TradingView's own loader keeps every feature of the restore payload", async () => {
    expect(payloads.size, 'restore payloads from the previous test').toBe(account.expected.length);
    browser = await launchChromium();
    for (const expected of account.expected) {
      const payload = payloads.get(expected.uid)!;
      const chart = await SignedOutChart.open(browser, console.warn);
      try {
        tradingViewBuild ??= await chart.buildTime();
        const saved = await chart.load(expected.name, payload.content, payload.studyMetaInfoMap);
        await fs.mkdir(OUT, { recursive: true });
        await fs.writeFile(path.join(OUT, `${expected.uid}-tradingview.json`), JSON.stringify(saved, null, 1));
        runs.push({ stage: 'tradingview', layout: expected.uid, checks: checkContent(expected, saved.content, 'tradingview') });
      } catch (e) {
        runs.push({ stage: 'tradingview', layout: expected.uid, checks: [], error: (e as Error).message });
      } finally {
        await chart.close();
      }
    }
    expect(failures('tradingview')).toEqual([]);
    const stale = staleRewrites(runs.filter((r) => r.stage === 'tradingview').flatMap(classify));
    expect(stale, 'known TradingView rewrites that no longer happen (remove them from knownRewrites.ts)').toEqual([]);
  });
});
