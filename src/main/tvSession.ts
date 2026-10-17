import { BrowserWindow, session, type Cookie, type Session } from 'electron';
import { isTradingViewHost, SESSION_COOKIE, urls } from '../core/tv/endpoints';
import { pageFetch, pageUser, type HttpRequest, type HttpResponse, type PageTransport, type PageUser } from '../core/tv/http';
import type { CdpCookie } from './browserSignIn';

export const PARTITION = 'persist:tradingview';

/** Hosts that tradingview.com pages call but ChartKeeper doesn't need: usage tracking. */
const BLOCKED_TV_HOSTS = /(^|\.)(telemetry|snowplow[\w-]*|pushstream)\.tradingview\.com$/;

export function isRequestAllowed(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'devtools:') return true;
  if (u.protocol !== 'https:' && u.protocol !== 'wss:') return false;
  if (BLOCKED_TV_HOSTS.test(u.hostname)) return false;
  return isTradingViewHost(u.hostname);
}

let configured: Session | null = null;

/**
 * The private browser session that holds the TradingView sign-in. Anything it
 * tries to load outside tradingview.com (ads, analytics, other sites) is
 * blocked, so ChartKeeper only ever talks to TradingView.
 */
export function tvSession(): Session {
  if (configured) return configured;
  const s = session.fromPartition(PARTITION);
  s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => cb({ cancel: !isRequestAllowed(details.url) }));
  s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  s.setUserAgent(s.getUserAgent().replace(/ (Electron|chartkeeper)\/\S+/gi, ''));
  configured = s;
  return s;
}

/** A sign-in cookie in Electron's own shape, ready to copy into ChartKeeper's session. */
export type SessionCookie = Pick<Cookie, 'name' | 'value' | 'path' | 'secure' | 'httpOnly' | 'expirationDate' | 'sameSite'> & { domain: string };

const SAME_SITE: Record<NonNullable<CdpCookie['sameSite']>, Cookie['sameSite']> = { Strict: 'strict', Lax: 'lax', None: 'no_restriction' };

export const fromCdp = (c: CdpCookie): SessionCookie => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path,
  secure: c.secure,
  httpOnly: c.httpOnly,
  ...(c.expires > 0 ? { expirationDate: c.expires } : {}),
  sameSite: c.sameSite ? SAME_SITE[c.sameSite] : 'lax',
});

/** Copies the sign-in cookies from the sign-in window into ChartKeeper's private session. */
export async function importCookies(cookies: SessionCookie[]): Promise<void> {
  const s = tvSession();
  const thirtyDays = Date.now() / 1000 + 30 * 86400;
  for (const c of cookies) {
    const path = c.path ?? '/';
    await s.cookies.set({
      url: `https://${c.domain.replace(/^\./, '')}${path}`,
      name: c.name,
      value: c.value,
      domain: c.domain,
      path,
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      // A cookie without expiry would vanish when ChartKeeper closes.
      expirationDate: c.expirationDate && c.expirationDate > 0 ? c.expirationDate : thirtyDays,
      sameSite: c.sameSite === 'unspecified' ? 'lax' : c.sameSite,
    });
  }
  await s.cookies.flushStore();
}

export async function hasSessionCookie(): Promise<boolean> {
  const cookies = await tvSession().cookies.get({ name: SESSION_COOKIE });
  return cookies.some((c) => isTradingViewHost(c.domain ?? ''));
}

export async function signOut(): Promise<void> {
  await tvSession().clearStorageData();
  await tvSession().clearCache();
}

function hiddenWindow(): BrowserWindow {
  const w = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e, url) => {
    if (!isRequestAllowed(url)) e.preventDefault();
  });
  return w;
}

/**
 * Runs requests inside a hidden tradingview.com page in ChartKeeper's session,
 * so they go out exactly like the web app's own requests.
 */
export class ElectronPageTransport implements PageTransport {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  /** Rejects when this page is closed: a script still running in a destroyed page would otherwise never settle. */
  private closed: { promise: Promise<never>; reject: (e: Error) => void } | null = null;

  constructor(private readonly callTimeoutMs = 90_000) {}

  private page(): Promise<BrowserWindow> {
    if (!this.ready || !this.win || this.win.isDestroyed()) {
      tvSession();
      this.win = hiddenWindow();
      const w = this.win;
      let reject!: (e: Error) => void;
      const promise = new Promise<never>((_, r) => (reject = r));
      promise.catch(() => undefined);
      this.closed = { promise, reject };
      w.once('closed', () => reject(new Error('The TradingView page was closed.')));
      this.ready = w.loadURL(urls.home).then(
        () => undefined,
        (e: unknown) => {
          // Don't keep a failed page around: the next request starts over.
          this.close();
          throw e;
        },
      );
    }
    const w = this.win!;
    return this.ready.then(() => w);
  }

  /** Runs a script in the page; fails instead of hanging if the page closes or stops answering. */
  private async run<T>(script: string): Promise<T> {
    const w = await this.page();
    const closed = this.closed!.promise;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('TradingView did not answer in time.')), this.callTimeoutMs);
    });
    try {
      return (await Promise.race([w.webContents.executeJavaScript(script, true), closed, timeout])) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  send(req: HttpRequest): Promise<HttpResponse> {
    return this.run(`(${pageFetch.toString()})(${JSON.stringify(req)})`);
  }

  user(): Promise<PageUser | null> {
    return this.run(`(${pageUser.toString()})()`);
  }

  buildTime(): Promise<string | null> {
    return this.run('typeof BUILD_TIME === "string" ? BUILD_TIME : null');
  }

  /** Reload, e.g. after signing in, so `window.user` is fresh. */
  reset(): void {
    this.close();
  }

  close(): void {
    this.closed?.reject(new Error('The TradingView page was closed.'));
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = null;
    this.closed = null;
  }
}

/**
 * Opens a layout the way the user would and counts what TradingView itself shows.
 * This is the final check after a restore. ChartKeeper changes nothing here;
 * TradingView may move the drawings from the layout content into its drawing
 * storage while the layout is open, exactly as when the user opens it.
 */
export async function countOnChartPage(uid: string, timeoutMs = 60_000): Promise<{ drawings: number; studies: number } | null> {
  tvSession();
  const w = hiddenWindow();
  try {
    await w.loadURL(urls.layoutPage(uid));
    const script = `new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const api = window.TradingViewApi;
        try {
          if (api && api.chartsCount && api.chartsCount() > 0) {
            let drawings = 0, studies = 0, ready = true;
            for (let i = 0; i < api.chartsCount(); i++) {
              const c = api.chart(i);
              if (!c.dataReady || !c.dataReady()) ready = false;
              drawings += c.getAllShapes().length;
              studies += c.getAllStudies().length;
            }
            if (ready && Date.now() - started > 5000) return resolve({ drawings, studies });
          }
        } catch (e) {}
        if (Date.now() - started > ${timeoutMs}) return resolve(null);
        setTimeout(tick, 1000);
      };
      tick();
    })`;
    return (await w.webContents.executeJavaScript(script, true)) as { drawings: number; studies: number } | null;
  } catch {
    return null;
  } finally {
    w.destroy();
  }
}
