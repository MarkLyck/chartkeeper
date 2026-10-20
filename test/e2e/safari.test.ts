import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tvCookie, writeBinaryCookies } from '../fakes/binaryCookies';
import { EXPIRED_SESSION, type FakeControl } from '../fakes/fakeTradingViewApp';
import { referenceInAccount } from '../fakes/fixtures';
import { launchApp } from './launch';

type G = { __chartkeeperFake: FakeControl; __dialogs: string[]; __opened: string[] };

/**
 * Sign-in through Safari, end to end: the app runs as shipped against the
 * fake TradingView, and a fake Safari whose cookie file the test writes,
 * the way Safari saves it after the user signs in.
 */
describe('signing in with Safari', () => {
  let app: ElectronApplication;
  let window: Page;
  let safari: string;
  const cookieFile = () => path.join(safari, 'Cookies/Cookies.binarycookies');
  const safariHas = (session: string) => fs.writeFile(cookieFile(), writeBinaryCookies([[tvCookie('sessionid', session), tvCookie('csrftoken', 'tok', { httpOnly: false })]]));
  const opened = () => app.evaluate(() => (globalThis as unknown as G).__chartkeeperFake.safariOpened.length);
  const savedSession = () => app.evaluate(async ({ session }) => (await session.fromPartition('persist:tradingview').cookies.get({ name: 'sessionid' })).map((c) => `${c.domain} ${c.value}`));
  const signOut = async () => {
    await window.locator('#signout').click();
    await window.locator('#signin').waitFor();
  };
  /** Answers the app's next message box with button `response`, and records its message and any page it opens in the browser. */
  const answerDialogs = (response: number) =>
    app.evaluate(({ dialog, shell }, response) => {
      const g = globalThis as unknown as G;
      g.__dialogs = [];
      g.__opened = [];
      dialog.showMessageBox = (async (...args: unknown[]) => {
        g.__dialogs.push((args.at(-1) as { message: string }).message);
        return { response, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
      shell.openExternal = async (url: string) => void g.__opened.push(url);
    }, response);

  beforeAll(async () => {
    safari = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-fake-safari-'));
    await fs.mkdir(path.dirname(cookieFile()), { recursive: true });
    await safariHas(EXPIRED_SESSION);
    ({ app, window } = await launchApp({}, undefined, { layouts: [referenceInAccount('AbCd1234', 'Min AAPL')], plan: 'pro_premium', signedIn: false, scheduleEveryMs: 15 * 60_000, safariDataDir: safari }));
    await window.locator('#signin').waitFor();
  });
  afterAll(async () => {
    await app?.close();
    await fs.chmod(safari, 0o700).catch(() => undefined);
    await fs.rm(safari, { recursive: true, force: true });
  });

  it('says on the home screen that it uses the Safari sign-in', async () => {
    await window.getByText('ChartKeeper uses your sign-in from Safari').waitFor();
  });

  it('opens the sign-in page in Safari when the saved sign-in has ended, and finishes once Safari saves the new one', async () => {
    await window.locator('#signin').click();
    await expect.poll(opened, { timeout: 30_000 }).toBe(1);
    await window.getByText('Sign in to TradingView in Safari').waitFor();
    await expect(window.locator('#signin-cancel').isVisible()).resolves.toBe(true);
    await safariHas('fresh-from-safari');
    await window.getByText('Signed in to TradingView as demo_user').waitFor({ timeout: 30_000 });
    expect(await savedSession()).toEqual(['.tradingview.com fresh-from-safari']);
    await expect(window.locator('#go-backup').isEnabled()).resolves.toBe(true);
    expect(app.windows().filter((w) => /accounts\/signin/.test(w.url()))).toEqual([]);
  });

  it('signs in straight away, without opening Safari, when Safari is already signed in', async () => {
    await signOut();
    await safariHas('already-in-safari');
    await window.locator('#signin').click();
    await window.getByText('Signed in to TradingView as demo_user').waitFor({ timeout: 30_000 });
    expect(await opened()).toBe(1);
    expect(await savedSession()).toEqual(['.tradingview.com already-in-safari']);
  });

  it('stops waiting when Cancel is clicked, without an error', async () => {
    await signOut();
    await safariHas(EXPIRED_SESSION);
    await window.locator('#signin').click();
    await window.locator('#signin-cancel').click();
    await window.locator('#signin').waitFor({ timeout: 10_000 });
    await expect(window.locator('.result-error').count()).resolves.toBe(0);
    await expect(window.locator('#go-backup').isDisabled()).resolves.toBe(true);
  });

  describe.skipIf(process.platform === 'win32')('when macOS keeps ChartKeeper out of Safari', () => {
    beforeAll(() => fs.chmod(safari, 0o000));
    afterAll(() => fs.chmod(safari, 0o700));

    it('asks for Full Disk Access, opens that page of System Settings, and explains the steps', async () => {
      await answerDialogs(0);
      await window.locator('#signin').click();
      await window.getByText('ChartKeeper needs your permission to use Safari').waitFor({ timeout: 30_000 });
      await window.getByText('Privacy & Security, then Full Disk Access').waitFor();
      expect(await app.evaluate(() => (globalThis as unknown as G).__dialogs)).toEqual(['Allow ChartKeeper to use your Safari sign-in']);
      expect(await app.evaluate(() => (globalThis as unknown as G).__opened)).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles']);
    });

    it('can sign in in a ChartKeeper window instead', async () => {
      await answerDialogs(1);
      await window.locator('#signin').click();
      const deadline = Date.now() + 30_000;
      let signInWindow: Page | undefined;
      while (!signInWindow && Date.now() < deadline) {
        signInWindow = app.windows().find((w) => /\/accounts\/signin\/$/.test(w.url()));
        if (!signInWindow) await new Promise((r) => setTimeout(r, 200));
      }
      await signInWindow!.locator('#fake-signin').click();
      await window.getByText('Signed in to TradingView as demo_user').waitFor({ timeout: 30_000 });
    });
  });
});
