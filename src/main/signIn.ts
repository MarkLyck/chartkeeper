import { app, BrowserWindow, dialog, session, type Cookie } from 'electron';
import path from 'node:path';
import { isTradingViewHost, SESSION_COOKIE, urls } from '../core/tv/endpoints';
import type { TvAccount } from './account';
import { findBrowsers } from './browsers';
import { SignInCancelled, signInWithBrowser } from './browserSignIn';
import { log } from './log';
import { fromCdp, importCookies, type SessionCookie } from './tvSession';

const isTv = (c: { domain?: string }) => isTradingViewHost(c.domain ?? '');

/** The throwaway session of the in-app sign-in window. */
export const SIGNIN_PARTITION = 'signin-temporary';

/** A browser that quits this soon after starting couldn't run (e.g. a sandboxed snap package); try the next one. */
const QUICK_EXIT_MS = 8000;

/**
 * Signs in to TradingView in the user's own browser (their default browser
 * first, then any other Chromium-based browser installed), or in an app window
 * when none can run, and copies the sign-in into ChartKeeper.
 */
export async function signIn(account: TvAccount, parent: BrowserWindow | null): Promise<void> {
  let cookies: SessionCookie[] | null = null;
  for (const browser of findBrowsers()) {
    const started = Date.now();
    try {
      log(`sign-in with ${browser.name}`);
      const fromBrowser = await signInWithBrowser({
        browserPath: browser.path,
        profileDir: path.join(app.getPath('userData'), 'signin-profile'),
        startUrl: urls.signIn,
        isSignedIn: (cs) => cs.some((c) => c.name === SESSION_COOKIE && isTv(c)),
        keep: isTv,
      });
      cookies = fromBrowser.map(fromCdp);
      break;
    } catch (e) {
      if (!(e instanceof SignInCancelled && Date.now() - started < QUICK_EXIT_MS)) throw e;
      log(`${browser.name} could not start (${(e as Error).message}); trying the next browser`);
    }
  }
  if (!cookies) {
    log('sign-in with app window');
    cookies = await signInWithAppWindow(parent);
  }
  await importCookies(cookies);
  await account.client();
}

/** Sign-in providers TradingView offers, which open in a popup that reports back to the sign-in page. */
const SIGN_IN_POPUP_HOSTS = [/(^|\.)google\.com$/, /(^|\.)apple\.com$/, /(^|\.)facebook\.com$/, /(^|\.)x\.com$/, /(^|\.)twitter\.com$/, /(^|\.)linkedin\.com$/, /(^|\.)yahoo\.com$/, /(^|\.)tradingview\.com$/];

/** The page Google shows when it refuses sign-in in an embedded window. */
export const isGoogleRefusal = (url: string) => /^https:\/\/accounts\.google\.com\/(v3\/)?signin\/rejected/.test(url);

export function isSignInPopup(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SIGN_IN_POPUP_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/**
 * The last resort when no Chromium-based browser can run. Email sign-in works
 * here. Sign-in buttons like "Continue with Google" open their popup in a child
 * window; Google may still refuse sign-in in an app window, which it decides itself.
 */
async function signInWithAppWindow(parent: BrowserWindow | null): Promise<SessionCookie[]> {
  const s = session.fromPartition(SIGNIN_PARTITION);
  s.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  s.setUserAgent(s.getUserAgent().replace(/ (Electron|chartkeeper)\/\S+/gi, ''));
  const options = { width: 520, height: 760, title: 'TradingView', webPreferences: { partition: SIGNIN_PARTITION, contextIsolation: true, sandbox: true } };
  const w = new BrowserWindow({ ...options, parent: parent ?? undefined });
  const guard = (contents: Electron.WebContents) =>
    contents.setWindowOpenHandler(({ url }) => (isSignInPopup(url) ? { action: 'allow', overrideBrowserWindowOptions: { ...options, width: 500, height: 640, parent: w } } : { action: 'deny' }));
  guard(w.webContents);
  w.webContents.on('did-create-window', (child) => {
    guard(child.webContents);
    // Google refuses sign-in inside app windows. Say so plainly instead of leaving its error page up.
    child.webContents.on('did-navigate', (_e, url) => {
      if (!isGoogleRefusal(url)) return;
      child.destroy();
      void dialog.showMessageBox(w, {
        type: 'info',
        message: 'Google sign-in does not work in this window',
        detail: 'Google only allows signing in from a regular web browser. Sign in with your TradingView email and password here, or install Google Chrome and click "Sign in to TradingView" again.',
      });
    });
  });
  await w.loadURL(urls.signIn);
  try {
    return await new Promise<SessionCookie[]>((resolve, reject) => {
      w.on('closed', () => reject(new SignInCancelled()));
      const poll = async () => {
        if (w.isDestroyed()) return;
        const tv = (await s.cookies.get({})).filter((c): c is Cookie & { domain: string } => isTv(c));
        if (tv.some((c) => c.name === SESSION_COOKIE)) {
          resolve(tv);
          w.destroy();
        } else setTimeout(poll, 1500);
      };
      void poll();
    });
  } finally {
    await s.clearStorageData();
  }
}
