/**
 * Walks every screen of the window in Danish and English against the mock
 * api (src/renderer/mockApi.ts) and the real reference snapshot, and saves
 * screenshots to .test-output/ui/<lang>-<screen>.png. Exits non-zero on any
 * console error, page error, horizontal overflow, or failed expectation.
 *
 *   npx tsx scripts/ui-preview.ts
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { parseLayout } from '../src/core/layout';
import { ChartDataSchema, DrawingsRecordSchema, LayoutRecordSchema, ManifestSchema } from '../src/core/model';
import type { PreviewFixture } from '../src/renderer/mockApi';
import type { Lang } from '../src/shared/api';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.test-output/ui');
const SNAP = path.join(ROOT, 'test/fixtures/reference-snapshot');

export async function readFixture(): Promise<PreviewFixture> {
  const json = async (rel: string) => JSON.parse(await fs.readFile(path.join(SNAP, rel), 'utf8'));
  const manifest = ManifestSchema.parse(await json('manifest.json'));
  const dir = manifest.layouts[0]!.dir;
  const record = LayoutRecordSchema.parse(await json(`${dir}/layout.json`));
  const drawings = DrawingsRecordSchema.parse(await json(`${dir}/drawings.json`));
  const layout = parseLayout(record, drawings);
  const data: PreviewFixture['data'] = {};
  for (const chart of layout.charts) {
    const file = path.join(SNAP, dir, 'data', `chart-${chart.chartId}.json`);
    data[chart.chartId] = await fs.readFile(file, 'utf8').then((s) => ChartDataSchema.parse(JSON.parse(s)), () => null);
  }
  return { layout, data, manifest };
}

export async function buildSite(fixture: PreviewFixture, out = OUT): Promise<string> {
  const SITE = path.join(out, 'site');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(SITE, { recursive: true });
  const common = { bundle: true, format: 'iife', platform: 'browser', target: 'es2023', logLevel: 'warning' } as const;
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

  for (const lang of ['da', 'en'] as Lang[]) {
    const open = async (opts: { signedIn?: boolean; size?: { width: number; height: number } } = {}): Promise<Page> => {
      const page = await browser.newPage({ viewport: opts.size ?? { width: 1200, height: 800 } });
      page.on('console', (m) => m.type() === 'error' && problems.push(`[${lang}] console: ${m.text()}`));
      page.on('pageerror', (e) => problems.push(`[${lang}] page error: ${e.message}`));
      await page.addInitScript((init) => ((window as unknown as { __CK_MOCK_INIT__: unknown }).__CK_MOCK_INIT__ = init), { lang, signedIn: opts.signedIn ?? true });
      await page.goto(url);
      await page.waitForSelector('#go-view');
      await page.evaluate(() => ((window as unknown as { __mock: { stepMs: number } }).__mock.stepMs = 120));
      return page;
    };
    const mock = (page: Page, fn: string) => page.evaluate(`(() => { const m = window.__mock; ${fn} })()`);
    const shot = async (page: Page, name: string) => {
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow <= 0, `[${lang}] ${name}: content is ${overflow}px wider than the window`);
      const file = path.join(OUT, `${lang}-${name}.png`);
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
      shots.push(file);
    };
    const calls = (page: Page) => page.evaluate(() => (window as unknown as { __mock: { calls: { method: string; args: unknown[] }[] } }).__mock.calls);

    // Home
    let page = await open();
    await shot(page, 'home');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await shot(page, 'home-focus');
    await page.click('#signout');
    await page.waitForSelector('#signin');
    expect(await page.isDisabled('#go-backup'), `[${lang}] backup button is enabled while signed out`);
    await shot(page, 'home-signed-out');
    await mock(page, `m.scenario.signIn = 'browser';`);
    await page.click('#signin');
    await page.waitForSelector('.signin .loading');
    await shot(page, 'home-signing-in');
    await page.waitForSelector('.signin .result-error');
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
    await mock(page, `m.pauseAfter = 3;`);
    await page.click('#go-backup');
    await page.waitForSelector('.progress-fill[style*="width"]');
    expect((await page.$('#nav-home')) === null, `[${lang}] backup can be left while running`);
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
    expect(String(opened?.args[0]).startsWith('https://www.tradingview.com/chart/'), `[${lang}] Open on TradingView did not pass the layout url`);
    await shot(page, 'restore-success');

    // Restore: plan full, then replace with typed confirmation
    await mock(page, `m.scenario.slots = 'full'; m.scenario.restore = 'mismatch';`);
    await page.click('#restore-another');
    await page.check('#pick-layout-1');
    await page.click('#restore-next');
    await page.waitForSelector('#mode-new');
    expect(await page.isDisabled('#restore-start'), `[${lang}] Restore is enabled although no layout slot is free`);
    await shot(page, 'restore-step2-full');
    await page.check('#mode-replace');
    await page.selectOption('#target-pick', 'tvNOVO');
    await page.fill('#confirm-name', 'Novo Nordisk');
    expect(await page.isDisabled('#restore-start'), `[${lang}] Restore is enabled before the name matches`);
    await shot(page, 'restore-step2-replace-typing');
    await page.fill('#confirm-name', 'novo nordisk - dagligt');
    expect(!(await page.isDisabled('#restore-start')), `[${lang}] Restore stays disabled after the name matches`);
    await shot(page, 'restore-step2-replace');
    await page.click('#restore-start');
    await page.waitForSelector('dialog[open]');
    await shot(page, 'restore-confirm');
    await page.click('#dialog-no');
    expect((await calls(page)).filter((c) => c.method === 'restore').length === 1, `[${lang}] cancelling the confirm dialog still restored`);
    await page.click('#restore-start');
    await page.click('#dialog-yes');
    await page.waitForSelector('.result-warning');
    const replaceReq = (await calls(page)).filter((c) => c.method === 'restore').at(-1)?.args[0] as { mode: string; confirmedName?: string } | undefined;
    expect(replaceReq?.mode === 'replace' && replaceReq.confirmedName === 'Novo Nordisk – dagligt', `[${lang}] replace request did not carry the confirmed name`);
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
  }

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
