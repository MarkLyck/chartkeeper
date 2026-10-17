import { app, BrowserWindow, session, type Cookie } from 'electron';
import path from 'node:path';
import { isTradingViewHost, SESSION_COOKIE, urls } from '../core/tv/endpoints';
import type { TvAccount } from './account';
import { findBrowser } from './browsers';
import { SignInCancelled, signInWithBrowser } from './browserSignIn';
import { log } from './log';
import { fromCdp, importCookies, type SessionCookie } from './tvSession';

const isTv = (c: { domain?: string }) => isTradingViewHost(c.domain ?? '');

/** The throwaway session of the in-app sign-in window. */
export const SIGNIN_PARTITION = 'signin-temporary';

/** Signs in to TradingView in the user's own browser, or in an app window when there is none, and copies the sign-in into ChartKeeper. */
export async function signIn(account: TvAccount, parent: BrowserWindow | null): Promise<void> {
  const browser = findBrowser();
  let cookies: SessionCookie[];
  const started = Date.now();
  try {
    if (!browser) throw new Error('no browser found');
    log(`sign-in with ${browser.name}`);
    const fromBrowser = await signInWithBrowser({
      browserPath: browser.path,
      profileDir: path.join(app.getPath('userData'), 'signin-profile'),
      startUrl: urls.signIn,
      isSignedIn: (cs) => cs.some((c) => c.name === SESSION_COOKIE && isTv(c)),
      keep: isTv,
    });
    cookies = fromBrowser.map(fromCdp);
  } catch (e) {
    // A browser that quits right away couldn't start (e.g. a sandboxed snap package); offer the in-app window instead.
    if (browser && !(e instanceof SignInCancelled && Date.now() - started < 8000)) throw e;
    log(`sign-in with app window (${(e as Error).message})`);
    cookies = await signInWithAppWindow(parent);
  }
  await importCookies(cookies);
  await account.client();
}

/**
 * Used only when no Chrome, Edge, Brave or Chromium is installed. Google
 * refuses sign-in inside app windows, so this window suits email sign-in.
 */
async function signInWithAppWindow(parent: BrowserWindow | null): Promise<SessionCookie[]> {
  const s = session.fromPartition(SIGNIN_PARTITION);
  s.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  const w = new BrowserWindow({ width: 520, height: 760, title: 'TradingView', parent: parent ?? undefined, webPreferences: { partition: SIGNIN_PARTITION, contextIsolation: true, sandbox: true } });
  // Sign-in pages stay in this one window; nothing opens new windows from it.
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
