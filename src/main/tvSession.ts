import { BrowserWindow, session, type Session } from 'electron';
import { ALLOWED_HOSTS, urls } from '../core/tv/endpoints';
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
  return u.hostname === 'tradingview.com' || u.hostname.endsWith('.tradingview.com') || ALLOWED_HOSTS.includes(u.hostname);
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

const SAME_SITE: Record<string, 'strict' | 'lax' | 'no_restriction'> = { Strict: 'strict', Lax: 'lax', None: 'no_restriction' };

/** Copies the sign-in cookies from the browser window into ChartKeeper's private session. */
export async function importCookies(cookies: CdpCookie[]): Promise<void> {
  const s = tvSession();
  const thirtyDays = Date.now() / 1000 + 30 * 86400;
  for (const c of cookies) {
    await s.cookies.set({
      url: `https://${c.domain.replace(/^\./, '')}${c.path}`,
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      // A cookie without expiry would vanish when ChartKeeper closes.
      expirationDate: c.expires > 0 ? c.expires : thirtyDays,
      sameSite: SAME_SITE[c.sameSite ?? ''] ?? 'lax',
    });
  }
  await s.cookies.flushStore();
}

export async function hasSessionCookie(): Promise<boolean> {
  const cookies = await tvSession().cookies.get({ name: 'sessionid' });
  return cookies.some((c) => c.domain?.endsWith('tradingview.com'));
}

export async function signOut(): Promise<void> {
  await tvSession().clearStorageData();
  await tvSession().clearCache();
}

function hiddenWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
}

/**
 * Runs requests inside a hidden tradingview.com page in ChartKeeper's session,
 * so they go out exactly like the web app's own requests.
 */
export class ElectronPageTransport implements PageTransport {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;

  private page(): Promise<BrowserWindow> {
    if (!this.ready || !this.win || this.win.isDestroyed()) {
      tvSession();
      this.win = hiddenWindow();
      const w = this.win;
      this.ready = w.loadURL(urls.home).then(() => undefined);
    }
    const w = this.win!;
    return this.ready.then(() => w);
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    const w = await this.page();
    return w.webContents.executeJavaScript(`(${pageFetch.toString()})(${JSON.stringify(req)})`, true) as Promise<HttpResponse>;
  }

  async user(): Promise<PageUser | null> {
    const w = await this.page();
    return w.webContents.executeJavaScript(`(${pageUser.toString()})()`, true) as Promise<PageUser | null>;
  }

  async buildTime(): Promise<string | null> {
    const w = await this.page();
    return w.webContents.executeJavaScript('typeof BUILD_TIME === "string" ? BUILD_TIME : null', true) as Promise<string | null>;
  }

  /** Reload, e.g. after signing in, so `window.user` is fresh. */
  reset(): void {
    this.close();
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = null;
  }
}

/**
 * Opens a layout the way Thomas would and counts what TradingView itself shows.
 * This is the final check after a restore. It only reads; it never saves.
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
