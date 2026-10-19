/**
 * Starts the packaged app from release/ (what the installer contains), opens
 * the reference backup in the viewer, and takes a screenshot. Fails on any
 * page error. It also asks for the end-to-end tests' fake TradingView, signed
 * in, and fails if the packaged app listens. On macOS it first checks the code
 * signature of the app and of the copy inside the DMG. Run after `electron-builder`:
 * npx tsx scripts/packaged-smoke.ts
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, promises as fs, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { FAKE_TRADINGVIEW_ENV } from '../src/main/fakeTradingView';
import { SEED_ENV } from '../test/fakes/fakeTradingViewApp';

const root = path.resolve(__dirname, '..');
const release = path.join(root, 'release');

function packagedBinary(): string {
  const dirs = readdirSync(release);
  const candidates =
    process.platform === 'darwin'
      ? dirs.filter((d) => d.startsWith('mac')).map((d) => path.join(release, d, 'ChartKeeper.app/Contents/MacOS/ChartKeeper'))
      : process.platform === 'win32'
        ? dirs.filter((d) => d.startsWith('win')).map((d) => path.join(release, d, 'ChartKeeper.exe'))
        : dirs.filter((d) => d.startsWith('linux')).map((d) => path.join(release, d, 'chartkeeper'));
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`No packaged app in ${release} (looked at ${candidates.join(', ')})`);
  return found;
}

/**
 * macOS kills an app at launch when its signature doesn't cover its code, and
 * the fuses rewrite Electron Framework after Electron built it, so an unsigned
 * build crashes on every Mac. GitHub's macOS runners don't enforce signatures,
 * so launching the app there proves nothing: check the signature itself, on
 * the app and on the copy users get from the DMG.
 */
async function verifyMacSignatures(appPath: string) {
  const verify = (app: string) => execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
  verify(appPath);
  const dmg = readdirSync(release).find((f) => f.endsWith('.dmg'));
  if (!dmg) throw new Error(`No DMG in ${release}`);
  const mount = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-dmg-'));
  execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, path.join(release, dmg)], { stdio: 'ignore' });
  try {
    verify(path.join(mount, 'ChartKeeper.app'));
  } finally {
    execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
  }
  console.log(`signatures OK: ${appPath} and ${dmg}`);
}

async function waitForCdp(port: number, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The packaged app did not start.');
}

async function main() {
  const binary = packagedBinary();
  if (process.platform === 'darwin') await verifyMacSignatures(path.resolve(binary, '../../..'));
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-smoke-'));
  const userData = path.join(base, 'userData');
  const backups = path.join(base, 'Backups');
  await fs.cp(path.join(root, 'test/fixtures/reference-snapshot'), path.join(backups, 'snapshots', '2026-10-17_10-00-00'), { recursive: true });
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ settings: { backupFolder: backups, dailyBackup: false, dailyHour: 18, includePrices: true }, lastBackup: null }));
  const fakeSeed = path.join(base, 'fake-seed.json');
  await fs.writeFile(fakeSeed, JSON.stringify({ layouts: [], plan: 'pro_premium', signedIn: true, scheduleEveryMs: 1000 }));

  const port = 9300 + Math.floor(Math.random() * 500);
  const env = { ...process.env, CHARTKEEPER_USER_DATA: userData, [FAKE_TRADINGVIEW_ENV]: '1', [SEED_ENV]: fakeSeed } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [`--remote-debugging-port=${port}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
  const child = spawn(binary, args, { env, stdio: 'ignore', detached: process.platform !== 'win32' });
  const errors: string[] = [];
  try {
    await waitForCdp(port, 60000);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    let page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('file:'));
    for (let i = 0; !page && i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('file:'));
    }
    if (!page) throw new Error('The app window did not open.');
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    try {
      await page.getByRole('button', { name: /view my backups/i }).click({ timeout: 30000 });
      await page.getByText('Reference AAPL').first().click({ timeout: 15000 });
      await page.locator('canvas').first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(2000);
    } catch (e) {
      console.error('Page text:', (await page.locator('body').innerText()).slice(0, 1000));
      console.error('Diagnostics:', await page.evaluate(async () => ({
        hasApi: typeof (window as any).chartkeeper,
        html: document.documentElement.outerHTML.slice(0, 600),
        state: await Promise.race([(window as any).chartkeeper?.getState().then((s: unknown) => JSON.stringify(s).slice(0, 200)), new Promise((r) => setTimeout(() => r('getState timed out'), 5000))]),
      })), errors);
      throw e;
    }
    const state = await page.evaluate(() => (window as any).chartkeeper.getState());
    const logged = await fs.readFile(path.join(userData, 'logs', 'chartkeeper.log'), 'utf8').catch(() => '');
    if (state.signedIn || logged.includes('FAKE TRADINGVIEW')) throw new Error('The packaged app used the fake TradingView.');
    const canvases = await page.locator('canvas').count();
    await fs.mkdir(path.join(root, '.test-output'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.test-output', `packaged-${process.platform}.png`) });
    const userDataMode = (await fs.stat(userData)).mode & 0o777;
    console.log(`packaged app OK: ${canvases} chart canvases, data folder mode ${userDataMode.toString(8)}`);
    if (canvases < 3) throw new Error('The chart did not render.');
    if (process.platform !== 'win32' && userDataMode !== 0o700) throw new Error('The private folder is readable by others.');
    if (errors.length) throw new Error(`Errors in the window:\n${errors.join('\n')}`);
    await browser.close().catch(() => undefined);
  } finally {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
