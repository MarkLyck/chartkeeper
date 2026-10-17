/**
 * Records demo videos to docs/demos/*.mp4:
 *   1. the real app (Electron) with a real backup on disk: home, settings,
 *      the offline viewer, and the TradingView sign-in window;
 *   2. the backup, compare and restore flows in the real window UI against a simulated TradingView account (src/renderer/mockApi.ts),
 *      because those flows need a signed-in account.
 * Each video carries a caption bar saying what is happening and whether
 * TradingView is real or simulated.
 *
 *   npm run build && npx tsx scripts/record-demos.ts [name filter]
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { launchApp } from '../test/e2e/launch';
import { buildSite, readFixture } from './ui-preview';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/demos');
const WORK = path.join(ROOT, '.test-output/demos');
const SIZE = { width: 1280, height: 860 };

/** A visible cursor and a caption bar; video recordings show neither by default. */
const OVERLAY = `(() => {
  if (document.getElementById('demo-cursor')) return;
  const c = document.createElement('div');
  c.id = 'demo-cursor';
  c.style.cssText = 'position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,80,0,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);pointer-events:none;transition:transform .08s;left:-50px;top:-50px';
  const cap = document.createElement('div');
  cap.id = 'demo-caption';
  cap.style.cssText = 'position:fixed;z-index:2147483646;left:0;right:0;bottom:0;padding:10px 18px;background:rgba(17,24,39,.88);color:#fff;font:600 17px system-ui,sans-serif;pointer-events:none;display:none';
  document.documentElement.append(c, cap);
  addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => (c.style.transform = 'scale(.7)'), true);
  addEventListener('mouseup', () => (c.style.transform = ''), true);
})()`;

async function caption(page: Page, text: string, holdMs = 1800) {
  await page.evaluate(OVERLAY);
  await page.evaluate((t) => {
    const cap = document.getElementById('demo-caption')!;
    cap.textContent = t;
    cap.style.display = t ? 'block' : 'none';
  }, text);
  await page.waitForTimeout(holdMs);
}

/** Moves the mouse visibly to an element and clicks it. */
async function click(page: Page, selector: string, pauseMs = 700) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`not visible: ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await page.waitForTimeout(250);
  await page.locator(selector).first().click();
  await page.waitForTimeout(pauseMs);
}

async function type(page: Page, selector: string, text: string) {
  await click(page, selector, 200);
  await page.locator(selector).first().pressSequentially(text, { delay: 90 });
  await page.waitForTimeout(500);
}

const H264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart'];

function toMp4(webm: string, mp4: string, pip?: { file: string; at: number }) {
  if (!pip) return execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, ...H264, mp4]);
  // The sign-in window is recorded on its own; show it over the app while it was open.
  // The sign-in window is 520×760; its recording is the full video size, with the window top-left.
  const filter = `[1:v]crop=520:760:0:0,setpts=PTS-STARTPTS+${pip.at.toFixed(2)}/TB,scale=-2:560,pad=iw+8:ih+8:4:4:color=0x1e4fd8[p];[0:v][p]overlay=x=W-w-24:y=24:eof_action=pass[v]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-i', pip.file, '-filter_complex', filter, '-map', '[v]', ...H264, mp4]);
}

async function realApp() {
  const { app, window } = await launchApp({ recordVideo: { dir: path.join(WORK, 'real'), size: SIZE } }, '/tmp/ChartKeeper Demo');
  const t0 = Date.now();
  await window.setViewportSize(SIZE).catch(() => undefined);
  await window.waitForSelector('#go-view');
  await window.evaluate(OVERLAY);
  await caption(window, 'The real ChartKeeper app. Not signed in yet; one backup already on this computer.', 3500);
  await window.mouse.wheel(0, 500);
  await caption(window, 'Settings: backup folder, daily automatic backup, offline prices.', 2500);
  await click(window, '#daily');
  await caption(window, 'Turning on the daily backup shows when it runs. ChartKeeper then stays in the system tray.', 3000);
  await click(window, '#daily');
  await window.mouse.wheel(0, -800);
  await window.waitForTimeout(600);
  await caption(window, 'Back up and Restore need a TradingView sign-in. Viewing backups works offline.', 2500);
  await click(window, '#go-view', 1500);
  await window.waitForSelector('.chart-box canvas', { timeout: 30000 });
  await caption(window, 'The offline viewer: a real backup of a TradingView layout with 11 drawings, a moving average and RSI.', 3500);
  const chart = (await window.locator('.chart-box canvas').first().boundingBox())!;
  const cx = chart.x + chart.width * 0.55;
  const cy = chart.y + chart.height * 0.35;
  await window.mouse.move(cx - 200, cy, { steps: 10 });
  await caption(window, 'Crosshair and price legend, like on TradingView.', 0);
  await window.mouse.move(cx + 200, cy + 40, { steps: 60 });
  await caption(window, 'Zoom with the mouse wheel…', 0);
  for (let i = 0; i < 6; i++) {
    await window.mouse.wheel(0, -120);
    await window.waitForTimeout(250);
  }
  await window.waitForTimeout(800);
  await caption(window, '…and drag to move back in time.', 0);
  await window.mouse.down();
  await window.mouse.move(cx + 450, cy + 40, { steps: 40 });
  await window.mouse.up();
  await window.waitForTimeout(1000);
  for (let i = 0; i < 6; i++) {
    await window.mouse.wheel(0, 120);
    await window.waitForTimeout(200);
  }
  await caption(window, 'Everything in this layout could be drawn. Anything that can\'t is listed under "Not shown", never hidden.', 3000);
  await click(window, '#nav-home', 1000);
  await caption(window, 'Signing in: ChartKeeper opens TradingView\'s real sign-in page. Thomas signs in himself (Google and 2FA work).', 2500);
  const popupP = app.waitForEvent('window', { timeout: 30000 });
  await click(window, '#signin', 500);
  const popup = await popupP;
  const popupAt = (Date.now() - t0) / 1000;
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(6000);
  // Close it like a user would, with the window's close button.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/accounts/signin'))?.close());
  await window.waitForSelector('.signin .result-error', { timeout: 15000 });
  await caption(window, 'Closing the sign-in window without signing in is reported plainly. Nothing is stored.', 4000);
  const main = await window.video()!.path();
  const signIn = await popup.video()!.path();
  await app.close();
  return { main, pip: { file: signIn, at: popupAt } };
}

async function simulated() {
  const url = `file://${await buildSite(await readFixture(), path.join(WORK, 'site'))}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: path.join(WORK, 'sim'), size: SIZE } });
  const page = await ctx.newPage();
  await page.addInitScript((init) => ((window as unknown as { __CK_MOCK_INIT__: unknown }).__CK_MOCK_INIT__ = init), { signedIn: true });
  await page.goto(url);
  await page.waitForSelector('#go-view');
  await page.evaluate(() => ((window as unknown as { __mock: { stepMs: number } }).__mock.stepMs = 700));
  const mock = (fn: string) => page.evaluate(`(() => { const m = window.__mock; ${fn} })()`);
  const say = (text: string, ms?: number) => caption(page, `${text}   ·   TradingView simulated`, ms);

  await say('Signed in. One click takes a backup of every layout, drawing, indicator, template and script.', 3000);
  await click(page, '#go-backup', 300);
  await say('Progress in plain words. Requests are spaced out so the account is not flagged.', 0);
  await page.waitForSelector('.result-success', { timeout: 30000 });
  await say('Done: a new dated folder on this computer.', 2500);
  await click(page, '#backup-view', 1500);
  await page.waitForSelector('.chart-box canvas', { timeout: 15000 });
  await say('View any backup offline.', 2500);
  await page.selectOption('#compare-pick', { index: 2 });
  await click(page, '#compare-go', 1200);
  await say('Compare two backups: what was added, removed or moved.', 3500);
  await caption(page, '', 0);
  await click(page, '#compare-close', 600);
  await click(page, '#nav-home', 800);

  await click(page, '#go-restore', 800);
  await page.waitForSelector('#pick-layout-0');
  await say('Restore: pick a backup and a layout.', 1500);
  await click(page, '#pick-layout-0', 400);
  await click(page, '#restore-next', 800);
  await say('Default: restore as a NEW layout. Nothing on TradingView is changed or deleted.', 3000);
  await click(page, '#restore-start', 300);
  await page.waitForSelector('.result-success', { timeout: 30000 });
  await say('Afterwards ChartKeeper opens the layout and checks that every drawing and indicator came back.', 4000);

  await mock(`m.scenario.slots = 'full';`);
  await click(page, '#restore-another', 800);
  await click(page, '#pick-layout-1', 400);
  await click(page, '#restore-next', 800);
  await say('If the plan has no free layout slot, ChartKeeper explains the options instead of failing.', 4000);
  await click(page, '#mode-replace', 500);
  await page.selectOption('#target-pick', 'tvMSFT');
  await say('Replacing a layout requires typing its name…', 1200);
  await type(page, '#confirm-name', 'Microsoft - daily');
  await click(page, '#restore-start', 800);
  await say('…and a final confirmation. A safety copy of the old layout is saved first.', 2500);
  await click(page, '#dialog-yes', 300);
  await page.waitForSelector('.result-success, .result-warning', { timeout: 30000 });
  await say('Replaced, verified, and the safety copy location is shown.', 4000);
  const video = page.video();
  await ctx.close();
  await browser.close();
  return video!.path();
}

async function main() {
  await fs.mkdir(WORK, { recursive: true });
  await fs.mkdir(OUT, { recursive: true });
  const jobs: [string, () => Promise<{ main: string; pip?: { file: string; at: number } }>][] = [
    ['1-real-app-viewer-and-sign-in-en', realApp],
    ['2-backup-compare-restore-simulated-en', async () => ({ main: await simulated() })],
  ];
  // Optional filter, e.g. `record-demos.ts simulated` to skip the real-app video.
  const only = process.argv[2];
  for (const [name, run] of jobs.filter(([n]) => !only || n.includes(only))) {
    const { main, pip } = await run();
    toMp4(main, path.join(OUT, `${name}.mp4`), pip);
    console.log('wrote', path.relative(ROOT, path.join(OUT, `${name}.mp4`)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
