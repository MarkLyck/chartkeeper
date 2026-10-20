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
import type { ChartKeeperApi } from '../src/shared/api';

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
  const shot = async (page: Page, name: string, fullPage = true) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow <= 0, `${name}: content is ${overflow}px wider than the window`);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage, animations: 'disabled' });
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
  await mock(page, `m.setState({ busy: 'backup' });`);
  expect(await page.isDisabled('#nav-restore'), 'the top bar still offers Restore while a daily backup runs');
  await mock(page, `m.setState({ busy: null });`);
  expect(await page.isEnabled('#nav-restore'), 'the top bar keeps Restore off after the daily backup ends');
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
  await page.waitForSelector('#chart-zoom-in:enabled');
  const viewport = page.viewportSize()!;
  // The crosshair follows the mouse, so it is moved off the chart before every comparison.
  const chartPixels = async () => {
    await page.mouse.move(1, viewport.height - 1);
    await page.waitForTimeout(400);
    return page.locator('.chart-box').screenshot({ animations: 'disabled' });
  };
  const stageCovers = async () => {
    const b = await page.locator('.chart-stage').boundingBox();
    return b !== null && b.x === 0 && b.y === 0 && b.width === viewport.width && b.height === viewport.height;
  };
  const opening = await chartPixels();
  await shot(page, 'view-chart');
  await page.click('#chart-zoom-in');
  expect(!(await chartPixels()).equals(opening), 'Zoom in did not change the chart');
  await page.click('#chart-reset');
  expect((await chartPixels()).equals(opening), 'Reset view did not bring back the view the chart opened with');
  await page.click('#chart-full');
  await page.waitForSelector('.is-full');
  await page.waitForTimeout(300);
  expect(await stageCovers(), 'full screen does not cover the window');
  expect(await page.isVisible('.stage-nav'), 'full screen does not show the layout name and arrows');
  expect((await page.textContent('#chart-full')) === 'Exit full screen', 'the full screen button does not offer to exit');
  expect((await page.evaluate(() => document.activeElement?.id)) === 'chart-full', 'focus left the full screen button');
  await chartPixels();
  await shot(page, 'view-full');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.layout-selected#layout-1', { state: 'attached' });
  await page.waitForTimeout(300);
  expect(await stageCovers(), 'full screen ends when the right arrow opens the next layout');
  expect((await page.textContent('.stage-count')) === '2 of 3', 'full screen does not count the layouts');
  await shot(page, 'view-full-next');
  await page.click('#stage-next');
  await page.waitForSelector('.layout-selected#layout-2', { state: 'attached' });
  await page.click('#stage-prev');
  await page.waitForSelector('.layout-selected#layout-1', { state: 'attached' });
  await page.waitForTimeout(300);
  expect((await page.evaluate(() => document.activeElement?.id)) === 'stage-prev', 'the previous layout button loses focus after it is pressed');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.is-full'));
  const fullScreenCalls = (await calls(page)).filter((c) => c.method === 'setFullScreen').map((c) => c.args[0]);
  expect(JSON.stringify(fullScreenCalls) === '[true,false]', `the window was asked to go full screen and back as ${JSON.stringify(fullScreenCalls)}`);
  expect(!(await stageCovers()) && !(await page.isVisible('.stage-nav')), 'Escape does not leave full screen');
  await page.click('#layout-1');
  await page.waitForSelector('.layout-selected#layout-1');
  await page.waitForTimeout(300);
  await shot(page, 'view-no-prices');
  await page.click('.snap-incomplete');
  await page.waitForSelector('.view-main .notice-error');
  await page.waitForTimeout(300);
  await shot(page, 'view-incomplete');
  const setStep = (ms: number) => page.evaluate((v) => ((window as unknown as { __mock: { stepMs: number } }).__mock.stepMs = v), ms);
  await setStep(2000);
  await page.click('#snap-0');
  await page.waitForSelector('#compare-pick');
  await page.selectOption('#compare-pick', { index: 2 });
  await page.waitForSelector('.chart-box:not(.chart-empty)', { timeout: 5000 });
  await setStep(120);
  expect((await page.inputValue('#compare-pick')) !== '' && (await page.isEnabled('#compare-go')), 'a backup picked to compare with while the chart loads is forgotten when it arrives');
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
  await mock(page, `m.setState({ platform: 'linux' });`);
  await page.keyboard.press('f');
  await page.waitForSelector('.is-full');
  await page.waitForTimeout(300);
  expect((await page.textContent('#chart-full')) === 'Back to normal size', 'on Linux, where the window never goes full screen, the button still says full screen');
  await shot(page, 'view-full-1000x700');
  await page.keyboard.press('f');
  await page.waitForFunction(() => !document.querySelector('.is-full'));
  await page.close();

  // A layout that keeps drawings for hundreds of symbols besides the one on the chart, like a user's "Gold" layout.
  page = await open();
  await page.evaluate(() => {
    const api = (window as unknown as { chartkeeper: ChartKeeperApi }).chartkeeper;
    const load = api.loadLayout.bind(api);
    api.loadLayout = async (dir, uid) => {
      const r = await load(dir, uid);
      if (!r.ok) return r;
      const { layout } = r.value;
      const model = layout.charts[0]!.panes.flatMap((p) => p.drawings)[0]!;
      const counts: [string, number][] = [['NYSE:AG', 15], ['TVC:SILVER', 24], ...Array.from({ length: 310 }, (_, i): [string, number] => [`NYSE:S${i}`, 13])];
      const elsewhere = counts.flatMap(([symbol, n]) => Array.from({ length: n }, (_, i) => ({ ...model, id: `${symbol}-${i}`, symbol })));
      return { ok: true, value: { ...r.value, layout: { ...layout, sharedDrawings: [...layout.sharedDrawings, ...elsewhere] } } };
    };
  });
  await page.click('#go-view');
  await page.waitForSelector('.chart-box canvas', { timeout: 15000 });
  await page.waitForSelector('.ck-not-shown');
  expect((await page.textContent('.ck-not-shown summary')) === 'Not shown (4,069)', 'the Not shown list does not count the drawings on other symbols');
  expect(!(await page.$eval('.ck-not-shown', (d) => (d as HTMLDetailsElement).open)), 'the Not shown list starts open although it only holds drawings on other symbols');
  await shot(page, 'view-other-symbols');
  await page.click('.ck-not-shown summary');
  const lines = await page.$$eval('.ck-not-shown li', (li) => li.map((l) => l.textContent ?? ''));
  expect(lines.length === 1 && lines[0]!.startsWith('4,069 drawings on 312 other symbols are saved in this backup.'), `drawings on other symbols are not one line: ${lines.length} lines`);
  await shot(page, 'view-other-symbols-open');
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
  await page.waitForSelector('#restore-start');
  expect((await page.$$('input[name=mode], #mode-replace, select, input[type=text]')).length === 0, 'the check step offers a choice other than a new layout');
  expect((await page.textContent('main'))?.includes('Nothing on TradingView is changed or deleted.') === true, 'the check step does not say that nothing on TradingView changes');
  await shot(page, 'restore-step2');
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
  await page.waitForSelector('#restore-start');
  await page.click('#restore-start');
  // Saved but not confirmed on the chart is amber, never the green "verified" result.
  await page.waitForSelector('.result-warning');
  expect((await page.$$('.result-success')).length === 0, 'an unchecked restore is shown as verified');
  expect((await page.$$('.verify .cell-warn')).length === 2, 'an unchecked chart page does not say "could not check" for drawings and indicators');
  await shot(page, 'restore-unchecked');

  // Restore: plan full, then a restore whose check finds drawings missing
  await mock(page, `m.scenario.slots = 'full'; m.scenario.restore = 'mismatch';`);
  await page.click('#restore-another');
  await page.check('#pick-layout-1');
  await page.click('#restore-next');
  await page.waitForSelector('#restore-start');
  expect(await page.isDisabled('#restore-start'), 'Restore is enabled although no layout slot is free');
  expect(!/replace/i.test((await page.textContent('main')) ?? ''), 'the full-plan notice still mentions replacing a layout');
  await shot(page, 'restore-step2-full');
  await page.click('#restore-back');
  await mock(page, `m.scenario.slots = 'free';`);
  await page.click('#restore-next');
  await page.waitForSelector('#restore-start:not([disabled])');
  await page.click('#restore-start');
  await page.waitForSelector('.result-warning');
  expect((await page.$$('.verify .cell-warn')).length === 2, 'a mismatch does not mark the saved and shown drawings');
  const sent = (await calls(page)).filter((c) => c.method === 'restore').at(-1)?.args[0];
  expect(JSON.stringify(Object.keys(sent as object).sort()) === '["snapshotDir","uid"]', 'a restore request carries more than the backup and layout');
  await shot(page, 'restore-mismatch');
  await page.close();

  // Restore: TradingView refuses with limit-reached
  page = await open();
  await mock(page, `m.scenario.restore = 'limit-reached';`);
  await page.click('#go-restore');
  await page.waitForSelector('#pick-layout-0');
  await page.check('#pick-layout-0');
  await page.click('#restore-next');
  await page.waitForSelector('#restore-start');
  await page.click('#restore-start');
  await page.waitForSelector('.result-error');
  await shot(page, 'restore-error-limit');
  await page.close();

  // Update popup. Shown as the window shows it: the popup and its backdrop cover the window, not the whole page.
  const release = {
    version: '1.0.0-rc.11',
    notes: "What's new\n• Backups of large layouts are faster\n• Drawings made on a daily chart are placed right on a 5-minute chart",
    how: 'installer',
  };
  const setUpdate = (page: Page, update: object) => mock(page, `m.setState({ update: ${JSON.stringify(update)} });`);
  const dialogOpen = (page: Page) => page.$eval('#update-dialog', (d) => (d as HTMLDialogElement).open);
  const focusInDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('#update-dialog'));
  page = await open();
  await setUpdate(page, { k: 'available', ...release });
  await page.waitForSelector('#update-dialog[open]');
  expect((await page.evaluate(() => document.activeElement?.id)) === 'update-title', 'the update popup does not move focus to its title');
  expect((await page.textContent('#update-version'))?.includes('1.0.0-rc.11') === true, 'the update popup does not name the new version');
  await shot(page, 'update-available', false);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await focusInDialog(page), `Tab ${i + 1} left the update popup`);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInDialog(page), `Shift+Tab ${i + 1} left the update popup`);
  }
  await mock(page, `m.setState({ busy: 'backup' });`);
  expect(await page.isDisabled('#update-now'), 'Update now is enabled while a backup runs');
  expect((await page.textContent('#update-dialog'))?.includes('A backup is running') === true, 'the update popup does not say to wait for the backup');
  await shot(page, 'update-available-busy', false);
  await mock(page, `m.setState({ busy: null });`);
  await page.waitForSelector('#update-now:enabled');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#update-reopen');
  expect(!(await dialogOpen(page)), 'Escape did not close the update popup');
  expect((await calls(page)).some((c) => c.method === 'postponeUpdate'), 'Escape did not count as Later');
  await shot(page, 'update-later', false);
  await page.click('#update-reopen');
  await page.waitForSelector('#update-dialog[open]');
  await page.click('#update-later');
  await page.waitForSelector('#update-reopen');
  await page.click('#update-reopen');
  await page.click('#update-now');
  await page.waitForSelector('#update-dialog .progress');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  expect(await dialogOpen(page), 'Escape closed the popup while the download runs');
  await page.waitForSelector('#update-quit', { timeout: 10000 });
  await shot(page, 'update-installer-open', false);
  await page.click('#update-quit');
  expect((await calls(page)).some((c) => c.method === 'quitApp'), 'Quit ChartKeeper did not ask the app to quit');
  await setUpdate(page, { k: 'downloading', percent: 42, ...release });
  await page.waitForSelector('[role=progressbar][aria-valuenow="42"]');
  await shot(page, 'update-downloading', false);
  await mock(page, `m.setState({ platform: 'win32' });`);
  await setUpdate(page, { k: 'downloading', percent: 100, ...release, how: 'restart' });
  expect((await page.textContent('#update-dialog'))?.includes('opens again by itself') === true, 'a finished download on Windows does not say ChartKeeper restarts');
  await shot(page, 'update-restarting', false);
  await setUpdate(page, { k: 'failed', message: 'net::ERR_CONNECTION_RESET while downloading ChartKeeper-1.0.0-rc.11-mac-universal.dmg', ...release });
  await page.waitForSelector('#update-github');
  await page.click('#update-dialog .details summary');
  await shot(page, 'update-failed', false);
  await page.click('#update-github');
  expect((await calls(page)).some((c) => c.method === 'openReleasePage'), 'Download from GitHub did not open the releases page');
  await page.click('#update-close');
  await page.waitForSelector('#update-reopen');
  await page.close();

  page = await open({ size: { width: 1000, height: 700 } });
  await setUpdate(page, { k: 'available', ...release, how: 'restart' });
  await page.waitForSelector('#update-dialog[open]');
  await shot(page, 'update-available-1000x700', false);
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
