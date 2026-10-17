/**
 * Round trip against a real TradingView account:
 * back up a layout, restore it as a NEW layout, and diff the two.
 *
 *   npm run test:live
 *
 * The first run opens a browser window to sign in (session saved to
 * .test-output/live-session.json, readable only by you). Environment:
 *   TV_TEST_LAYOUT   name of the layout to use (default: the first one)
 *   TV_TEST_CLEANUP  set to 1 to delete the restored copy afterwards
 * The account needs a free layout slot.
 */
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureLayout, runBackup } from '../../src/core/backup';
import { diffLayouts } from '../../src/core/diff';
import { countLayout, parseLayout } from '../../src/core/layout';
import { restoreLayout, RestoreJournal } from '../../src/core/restore';
import { listSnapshots, SnapshotReader } from '../../src/core/snapshot';
import { TvClient } from '../../src/core/tv/client';
import { nodeSocketFactory } from '../../src/core/tv/datafeed';
import { urls } from '../../src/core/tv/endpoints';
import { pageFetch, pageUser, PoliteHttp, type PageTransport } from '../../src/core/tv/http';
import { findBrowser } from '../../src/main/browsers';
import { signInWithBrowser, type CdpCookie } from '../../src/main/browserSignIn';

const OUT = path.resolve(__dirname, '../../.test-output');
const SESSION = path.join(OUT, 'live-session.json');

async function session(): Promise<CdpCookie[]> {
  if (existsSync(SESSION)) return JSON.parse(await fs.readFile(SESSION, 'utf8'));
  const browser = findBrowser() ?? { name: 'Chromium', path: chromium.executablePath() };
  const isTv = (c: { domain: string }) => c.domain.endsWith('tradingview.com');
  const cookies = await signInWithBrowser({ browserPath: browser.path, profileDir: path.join(os.tmpdir(), `ck-live-${Date.now()}`), startUrl: urls.signIn, isSignedIn: (cs) => cs.some((c) => c.name === 'sessionid' && isTv(c)), keep: isTv });
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(SESSION, JSON.stringify(cookies), { mode: 0o600 });
  return cookies;
}

function transportFor(page: Page): PageTransport {
  return {
    send: (req) => page.evaluate(`(${pageFetch.toString()})(${JSON.stringify(req)})`),
    user: () => page.evaluate(`(${pageUser.toString()})()`),
    buildTime: () => page.evaluate('typeof BUILD_TIME === "string" ? BUILD_TIME : null'),
  };
}

async function countOnPage(page: Page, uid: string) {
  await page.goto(urls.layoutPage(uid), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).TradingViewApi?.chartsCount?.() > 0, null, { timeout: 60000 });
  await page.waitForTimeout(10000);
  return page.evaluate(() => {
    const api = (window as any).TradingViewApi;
    let drawings = 0;
    let studies = 0;
    for (let i = 0; i < api.chartsCount(); i++) {
      drawings += api.chart(i).getAllShapes().length;
      studies += api.chart(i).getAllStudies().length;
    }
    return { drawings, studies };
  });
}

describe('live round trip on tradingview.com', () => {
  let page: Page;
  let close: () => Promise<void>;
  let client: TvClient;
  const root = path.join(OUT, 'live-roundtrip');

  beforeAll(async () => {
    const cookies = await session();
    const browser = await chromium.launch({ executablePath: findBrowser()?.path ?? chromium.executablePath() });
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite ?? 'Lax' })));
    page = await ctx.newPage();
    await page.goto(urls.home);
    const t = transportFor(page);
    const user = await t.user();
    if (!user) throw new Error(`Not signed in. Delete ${SESSION} and run again.`);
    client = new TvClient(new PoliteHttp(t), user);
    close = () => browser.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  afterAll(async () => close?.());

  it('backs up the whole account, restores one layout as a new layout, and the two match', async () => {
    const backup = await runBackup(client, { root, appVersion: 'live-test', includePrices: true, bars: 300, authToken: (await transportFor(page).user())!.authToken, socketFactory: nodeSocketFactory });
    expect(backup).toMatchObject({ ok: true });
    const reader = await SnapshotReader.open((await listSnapshots(root))[0]!.dir);
    const wanted = process.env.TV_TEST_LAYOUT;
    const source = reader.manifest.layouts.find((l) => !wanted || l.name === wanted)!;
    expect(source, `layout ${wanted} not found`).toBeTruthy();

    const data = await reader.chartData(source.uid, '1');
    expect(data?.bars.length ?? 0).toBeGreaterThan(0);
    const studyErrors = Object.values(data?.studies ?? {}).filter((s) => s.status === 'error');
    expect(studyErrors, 'every indicator, including Pine ones, was calculated').toEqual([]);

    const restored = await restoreLayout(client, reader, source.uid, { kind: 'new' }, { root, journal: new RestoreJournal(path.join(root, 'journal.json')), buildTime: await transportFor(page).buildTime() });
    expect(restored.check.missingDrawings).toEqual([]);
    expect(restored.check.verdict).toBe('shown-unchecked');

    const original = parseLayout(await reader.layout(source.uid), await reader.drawings(source.uid));
    const entry = (await client.listLayouts()).find((l) => l.uid === restored.uid)!;
    const copy = (await captureLayout(client, entry)).layout;
    const changes = diffLayouts({ ...original, name: copy.name }, copy);
    await fs.writeFile(path.join(root, 'roundtrip-diff.json'), JSON.stringify({ source: source.name, restored: restored.name, url: restored.url, changes }, null, 2));
    expect(changes).toEqual([]);

    const onPage = await countOnPage(page, restored.uid);
    const expected = countLayout(original);
    expect(onPage.drawings, 'drawings TradingView shows').toBe(expected.drawings);
    expect(onPage.studies, 'indicators TradingView shows').toBeGreaterThanOrEqual(expected.studies);

    if (process.env.TV_TEST_CLEANUP === '1') {
      const res = await transportFor(page).send({ method: 'POST', url: 'https://www.tradingview.com/api/v1/charts/delete/', json: { uid: [restored.uid] } });
      expect(res.status).toBe(200);
    }
  });
});
