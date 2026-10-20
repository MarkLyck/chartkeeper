import { app, BrowserWindow, dialog, session, shell, type Cookie, type MessageBoxOptions } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { TvError } from '../core/tv/errors';
import { isTradingViewHost, SESSION_COOKIE, urls } from '../core/tv/endpoints';
import type { TvAccount } from './account';
import { findBrowsers, signInProfileDir } from './browsers';
import { BrowserUnusable, SignInCancelled, signInWithBrowser } from './browserSignIn';
import { log } from './log';
import { SafariAccessDenied, safariDataDir, signInWithSafari, type SafariCookie } from './safariSignIn';
import { fromCdp, importCookies, type SessionCookie } from './tvSession';

const isTv = (c: { domain?: string }) => isTradingViewHost(c.domain ?? '');

/** The throwaway session of the in-app sign-in window. */
export const SIGNIN_PARTITION = 'signin-temporary';

/** A browser that quits this soon after starting couldn't run (e.g. a sandboxed snap package); try the next one. */
const QUICK_EXIT_MS = 8000;

/** System Settings, Privacy & Security, Full Disk Access. */
const FULL_DISK_ACCESS_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/** Where Safari sign-in looks and how it opens Safari. The end-to-end tests point these at a fake Safari. */
export interface SafariSeam {
  dataDir: string;
  open?: (url: string) => Promise<void>;
}

let running: AbortController | null = null;

/** Stops a sign-in that is waiting for the user. It then ends as cancelled. */
export function cancelSignIn(): void {
  running?.abort();
}

/**
 * Signs in to TradingView in the user's own browser (their default browser
 * first; then any other Chromium-based browser, or Safari on a Mac), or in an
 * app window when none can be used, and copies the sign-in into ChartKeeper.
 */
export async function signIn(account: TvAccount, parent: BrowserWindow | null, safari: SafariSeam = { dataDir: safariDataDir(os.homedir()) }): Promise<void> {
  const controller = new AbortController();
  running = controller;
  const { signal } = controller;
  try {
    let cookies: SessionCookie[] | null = null;
    for (const browser of findBrowsers()) {
      if (browser.kind === 'safari') {
        log('sign-in with Safari');
        if (await signInWithSafariOrExplain(account, parent, safari, signal)) return;
        break;
      }
      const started = Date.now();
      try {
        log(`sign-in with ${browser.name}`);
        const fromBrowser = await signInWithBrowser({
          browserPath: browser.path,
          profileDir: signInProfileDir(browser, app.getPath('userData'), os.homedir()),
          startUrl: urls.signIn,
          isSignedIn: (cs) => cs.some((c) => c.name === SESSION_COOKIE && isTv(c)),
          keep: isTv,
          signal,
        });
        cookies = fromBrowser.map(fromCdp);
        break;
      } catch (e) {
        if (signal.aborted || !(e instanceof BrowserUnusable || (e instanceof SignInCancelled && Date.now() - started < QUICK_EXIT_MS))) throw e;
        log(`${browser.name} could not start (${(e as Error).message}); trying the next browser`);
      }
    }
    if (!cookies) {
      log('sign-in with app window');
      cookies = await signInWithAppWindow(parent, signal);
    }
    await importCookies(cookies);
    await account.client();
  } finally {
    if (running === controller) running = null;
  }
}

const fromSafari = (c: SafariCookie): SessionCookie => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path,
  secure: c.secure,
  httpOnly: c.httpOnly,
  ...(c.expires > 0 ? { expirationDate: c.expires } : {}),
  sameSite: 'lax',
});

/**
 * Signs in with Safari's TradingView sign-in. Without Full Disk Access macOS
 * hides it, so this asks the user to allow that, or to use the app window.
 * False means: use the app window.
 */
async function signInWithSafariOrExplain(account: TvAccount, parent: BrowserWindow | null, safari: SafariSeam, signal: AbortSignal): Promise<boolean> {
  // A sign-in Safari still has can be one TradingView has since ended: then keep waiting for a fresh one.
  const accept = async (cookies: SafariCookie[]) => {
    await importCookies(cookies.map(fromSafari));
    try {
      await account.client();
      return true;
    } catch (e) {
      if (!(e instanceof TvError && e.kind === 'not-signed-in')) throw e;
      await account.signOut();
      return false;
    }
  };
  try {
    await signInWithSafari({ dataDir: safari.dataDir, open: safari.open, startUrl: urls.signIn, accept, signal });
    return true;
  } catch (e) {
    if (!(e instanceof SafariAccessDenied)) throw e;
    log('sign-in with Safari: no Full Disk Access');
    const options: MessageBoxOptions = {
      type: 'info',
      buttons: ['Open System Settings', 'Use a ChartKeeper window instead', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Allow ChartKeeper to use your Safari sign-in',
      detail:
        'ChartKeeper signs in to TradingView through Safari. macOS only lets it read your TradingView sign-in from Safari once you turn on Full Disk Access for ChartKeeper.\n\n' +
        'Click "Open System Settings", turn on ChartKeeper in the list (if it is missing, click + and choose ChartKeeper in Applications), then click "Quit & Reopen" and sign in again.\n\n' +
        'Or sign in with your TradingView email and password in a ChartKeeper window. Google and Apple sign-in do not work there.',
    };
    const { response } = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
    if (response === 1) return false;
    if (response === 0) await shell.openExternal(FULL_DISK_ACCESS_SETTINGS);
    throw e;
  }
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
async function signInWithAppWindow(parent: BrowserWindow | null, signal: AbortSignal): Promise<SessionCookie[]> {
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
      signal.addEventListener('abort', () => w.isDestroyed() || w.close(), { once: true });
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
