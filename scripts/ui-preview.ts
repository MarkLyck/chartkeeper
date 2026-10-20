/**
 * Walks every screen of the window against the mock api
 * (src/renderer/mockApi.ts) and the real reference snapshot, and saves
 * screenshots to .test-output/ui/<screen>.png. Exits non-zero on any
 * console error, page error, horizontal overflow, or failed expectation.
 *
 *   npx tsx scripts/ui-preview.ts
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { SnapshotReader } from '../src/core/snapshot';
import { openLayout } from '../src/core/snapshotView';
import type { PreviewFixture } from '../src/renderer/mockApi';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.test-output/ui');
const SNAP = path.join(ROOT, 'test/fixtures/reference-snapshot');

export async function readFixture(): Promise<PreviewFixture> {
  const reader = await SnapshotReader.open(SNAP);
  return { ...(await openLayout(reader, reader.manifest.layouts[0]!.uid)), manifest: reader.manifest };
}

export async function buildSite(fixture: PreviewFixture, out = OUT): Promise<string> {
  const SITE = path.join(out, 'site');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(SITE, { recursive: true });
  const common = { bundle: true, format: 'iife', platform: 'browser', target: 'es2023', logLevel: 'warning', loader: { '.woff2': 'dataurl' } } as const;
  await build({ ...common, entryPoints: [path.join(ROOT, 'src/renderer/app.ts')], outfile: path.join(SITE, 'app.js') });
  await build({
    ...common,
    stdin: { contents: `import { installMockApi } from './src/renderer/mockApi'; installMockApi();`, resolveDir: ROOT, loader: 'ts' },
    outfile: path.join(SITE, 'mock.js'),
  });
  await fs.writeFile(path.join(SITE, 'fixture.js'), `window.__CK_FIXTURE__ = ${JSON.stringify(fixture)};`);
  await fs.copyFile(path.join(ROOT, 'src/renderer/styles.css'), path.join(SITE, 'styles.css'));
  const html = await fs.readFile(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  const tag = '<script src="app.js"></script>';
  if (!html.includes(tag)) throw new Error(`index.html no longer loads ${tag}`);
  await fs.writeFile(path.join(SITE, 'index.html'), html.replace(tag, `<script src="fixture.js"></script><script src="mock.js"></script>${tag}`));
  return path.join(SITE, 'index.html');
}

const problems: string[] = [];
const expect = (ok: boolean, what: string) => {
  if (!ok) problems.push(what);
};

async function main() {
  await buildSite(await readFixture());
  const browser = await chromium.launch({ executablePath: chromium.executablePath() });
  const url = `file://${path.join(OUT, 'site', 'index.html')}`;
  const shots: string[] = [];

  const open = async (opts: { signedIn?: boolean; history?: number; size?: { width: number; height: number } } = {}): Promise<Page> => {
    const page = await browser.newPage({ viewport: opts.size ?? { width: 1200, height: 800 } });
    page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    await page.addInitScript((init) => ((window as unknown as { __CK_MOCK_INIT__: unknown }).__CK_MOCK_INIT__ = init), { signedIn: opts.signedIn ?? true, history: opts.history ?? 0 });
    await page.goto(url);
    await page.waitForSelector('#go-view');
    await page.evaluate(() => ((window as unknown as { __mock: { stepMs: number } }).__mock.stepMs = 120));
    return page;
  };
  const mock = (page: Page, fn: string) => page.evaluate(`(() => { const m = window.__mock; ${fn} })()`);
  const shot = async (page: Page, name: string) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow <= 0, `${name}: content is ${overflow}px wider than the window`);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    shots.push(file);
  };
  const calls = (page: Page) => page.evaluate(() => (window as unknown as { __mock: { calls: { method: string; args: unknown[] }[] } }).__mock.calls);

  // Home
  let page = await open({ history: 40 });
  await page.waitForSelector('.spark');
  await shot(page, 'home-history');
  await page.close();

  page = await open();
  expect((await page.$('.spark')) === null, 'home draws a history line for fewer than a week of backups');
  await shot(page, 'home');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await shot(page, 'home-focus');
  await page.click('#signout');
  await page.waitForSelector('#signin');
  expect(await page.isDisabled('#go-backup'), 'backup button is enabled while signed out');
  await shot(page, 'home-signed-out');
  await mock(page, `m.scenario.signIn = 'browser';`);
  await page.click('#signin');
  await page.waitForSelector('.signin-wait .loading');
  await shot(page, 'home-signing-in');
  await page.waitForSelector('.hero .result-error');
  await shot(page, 'home-signin-error');
  await mock(page, `m.scenario.signIn = 'ok';`);
  await page.click('#signin');
  await page.waitForSelector('#signout');
  await page.click('#daily');
  await page.waitForFunction(() => !document.querySelector('#daily-hour'));
  await shot(page, 'home-daily-off');
  await page.close();

  page = await open({ size: { width: 1000, height: 700 } });
  await shot(page, 'home-1000x700');
  await page.close();

  // Backup
  page = await open();
  await mock(page, `m.pauseAfter = 9;`);
  await page.click('#go-backup');
  await page.waitForSelector('#backup-part:has-text("46 of 89 tools checked")');
  expect(/minutes? left/.test((await page.textContent('#backup-left')) ?? ''), 'backup shows the time left');
  expect((await page.$('#nav-home')) === null, 'backup can be left while running');
  await shot(page, 'backup-progress');
  await mock(page, `m.release();`);
  await page.waitForSelector('.result-success', { timeout: 15000 });
  await shot(page, 'backup-success');
  await page.click('.details summary');
  await shot(page, 'backup-success-notes');
  await page.click('#backup-view');
  await page.waitForSelector('.snap-selected');
  await page.click('#nav-home');
  await mock(page, `m.scenario.backup = 'format-changed';`);
  await page.click('#go-backup');
  await page.waitForSelector('.result-error', { timeout: 15000 });
  await page.click('.details summary');
  await shot(page, 'backup-failure');
  await page.click('#nav-home');
  await page.waitForSelector('.last-backup-failed');
  await shot(page, 'home-last-failed');
  await mock(page, `m.scenario.backup = 'not-signed-in';`);
  await page.click('#go-backup');
  await page.waitForSelector('#err-signin');
  await shot(page, 'backup-error-signin');
  await page.close();

  // View my backups
  page = await open();
  await page.click('#go-view');
  await page.waitForSelector('.chart-box canvas', { timeout: 15000 });
  await page.waitForTimeout(500);
  await shot(page, 'view-chart');
  await page.click('#layout-1');
  await page.waitForSelector('.layout-selected#layout-1');
  await page.waitForTimeout(300);
  await shot(page, 'view-no-prices');
  await page.click('.snap-incomplete');
  await page.waitForSelector('.view-main .notice-error');
  await page.waitForTimeout(300);
  await shot(page, 'view-incomplete');
  await page.click('#snap-0');
  await page.waitForSelector('#compare-pick');
  await page.selectOption('#compare-pick', { index: 2 });
  await page.click('#compare-go');
  await page.waitForSelector('.compare .diff');
  const compared = await page.textContent('.compare');
  expect(['Trend line', 'moved:', 'Indicator template'].every((w) => compared?.includes(w)), 'the comparison does not name the tools and changes in words');
  await shot(page, 'view-compare');
  await page.click('#compare-close');
  await page.waitForSelector('.chart-box canvas');
  await page.close();

  page = await open({ size: { width: 1000, height: 700 } });
  await page.click('#go-view');
  await page.waitForSelector('.chart-box canvas', { timeout: 15000 });
  await page.waitForTimeout(500);
  await shot(page, 'view-1000x700');
  await page.close();

  // Restore: as a new layout
  page = await open();
  await page.click('#go-restore');
  await page.waitForSelector('#pick-layout-0');
  await page.check('#pick-layout-0');
  await shot(page, 'restore-step1');
  await page.click('#restore-templates');
  await page.waitForSelector('.templates .notice-success');
  expect((await page.textContent('.templates'))?.includes('Theme “Light blue”') === true, 'restored templates are not listed by kind and name');
  await shot(page, 'restore-templates');
  await page.click('#restore-next');
  await page.waitForSelector('#mode-new');
  await shot(page, 'restore-step2-new');
  await mock(page, `m.pauseAfter = 2;`);
  await page.click('#restore-start');
  await page.waitForSelector('.progress-label');
  await page.waitForTimeout(400);
  await shot(page, 'restore-progress');
  await mock(page, `m.release();`);
  await page.waitForSelector('.result-success');
  await page.click('#restore-open');
  const opened = (await calls(page)).find((c) => c.method === 'openOnTradingView');
  expect(String(opened?.args[0]).startsWith('https://www.tradingview.com/chart/'), 'Open on TradingView did not pass the layout url');
  expect((await page.$$('.verify .cell-ok')).length === 5 && (await page.$$('.verify .cell-warn')).length === 0, 'a verified restore shows a cell that is not green');
  await shot(page, 'restore-success');

  await mock(page, `m.scenario.restore = 'unchecked';`);
  await page.click('#restore-another');
  await page.check('#pick-layout-0');
  await page.click('#restore-next');
  await page.waitForSelector('#mode-new');
  await page.click('#restore-start');
  // Saved but not confirmed on the chart is amber, never the green "verified" result.
  await page.waitForSelector('.result-warning');
  expect((await page.$$('.result-success')).length === 0, 'an unchecked restore is shown as verified');
  expect((await page.$$('.verify .cell-warn')).length === 2, 'an unchecked chart page does not say "could not check" for drawings and indicators');
  await shot(page, 'restore-unchecked');

  // Restore: plan full, then replace with typed confirmation
  await mock(page, `m.scenario.slots = 'full'; m.scenario.restore = 'mismatch';`);
  await page.click('#restore-another');
  await page.check('#pick-layout-1');
  await page.click('#restore-next');
  await page.waitForSelector('#mode-new');
  expect(await page.isDisabled('#restore-start'), 'Restore is enabled although no layout slot is free');
  await shot(page, 'restore-step2-full');
  await page.check('#mode-replace');
  await page.selectOption('#target-pick', 'tvMSFT');
  await page.fill('#confirm-name', 'Microsoft');
  expect(await page.isDisabled('#restore-start'), 'Restore is enabled before the name matches');
  await shot(page, 'restore-step2-replace-typing');
  await page.fill('#confirm-name', 'microsoft - daily');
  expect(!(await page.isDisabled('#restore-start')), 'Restore stays disabled after the name matches');
  await shot(page, 'restore-step2-replace');
  const restores = async () => (await calls(page)).filter((c) => c.method === 'restore').length;
  const before = await restores();
  await page.click('#restore-start');
  await page.waitForSelector('dialog[open]');
  await shot(page, 'restore-confirm');
  await page.click('#dialog-no');
  expect((await restores()) === before, 'cancelling the confirm dialog still restored');
  await page.click('#restore-start');
  await page.click('#dialog-yes');
  await page.waitForSelector('.result-warning');
  expect((await page.$$('.verify .cell-warn')).length === 2, 'a mismatch does not mark the saved and shown drawings');
  const replaceReq = (await calls(page)).filter((c) => c.method === 'restore').at(-1)?.args[0] as { mode: string; confirmedName?: string } | undefined;
  expect(replaceReq?.mode === 'replace' && replaceReq.confirmedName === 'microsoft - daily', 'replace request did not carry the typed name');
  await shot(page, 'restore-mismatch');
  await page.close();

  // Restore: TradingView refuses with limit-reached
  page = await open();
  await mock(page, `m.scenario.restore = 'limit-reached';`);
  await page.click('#go-restore');
  await page.waitForSelector('#pick-layout-0');
  await page.check('#pick-layout-0');
  await page.click('#restore-next');
  await page.waitForSelector('#mode-new');
  await page.click('#restore-start');
  await page.waitForSelector('.result-error');
  await shot(page, 'restore-error-limit');
  await page.close();
  await browser.close();
  console.log(`${shots.length} screenshots in ${path.relative(ROOT, OUT)}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
}

if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
