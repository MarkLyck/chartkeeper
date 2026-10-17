import { TvError } from './errors';
import { isAllowedUrl } from './endpoints';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  /** Sent as application/json. */
  json?: unknown;
  /** Sent as multipart/form-data, like the web app's FormData requests. */
  form?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  contentType: string;
  body: string;
}

/** The signed-in user as the TradingView page sees it (`window.user`). */
export interface PageUser {
  id: number | null;
  username: string;
  authToken: string | null;
  plan: string | null;
}

/**
 * Runs requests from inside a tradingview.com page so they carry the same
 * cookies, origin and headers as the web app's own requests.
 * Implemented by the Electron session (hidden window) and by Playwright in live tests.
 */
export interface PageTransport {
  send(req: HttpRequest): Promise<HttpResponse>;
  user(): Promise<PageUser | null>;
  buildTime(): Promise<string | null>;
}

/**
 * The function that runs inside the page. It must not reference anything
 * outside itself, because it is serialized with `toString()`.
 */
export async function pageFetch(req: HttpRequest): Promise<HttpResponse> {
  const init: RequestInit = { method: req.method, credentials: 'include', headers: { ...(req.headers ?? {}) } };
  if (req.json !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(req.json);
  } else if (req.form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(req.form)) fd.append(k, v);
    init.body = fd;
  }
  const res = await fetch(req.url, init);
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: await res.text() };
}

/** Reads `window.user` inside the page. Serialized like `pageFetch`. */
export function pageUser(): PageUser | null {
  const u = (window as unknown as { user?: Record<string, unknown> }).user;
  if (!u || typeof u.id !== 'number') return null;
  const plan = typeof u.pro_plan === 'string' && u.pro_plan ? u.pro_plan : typeof u.is_pro === 'boolean' && !u.is_pro ? 'free' : null;
  return { id: u.id, username: String(u.username ?? ''), authToken: typeof u.auth_token === 'string' ? u.auth_token : null, plan };
}

export interface RateLimitOptions {
  minIntervalMs: number;
  jitterMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_RATE: RateLimitOptions = { minIntervalMs: 1500, jitterMs: 1000 };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wraps a transport with ChartKeeper's request policy: only TradingView hosts,
 * one request at a time, a pause of 1.5 to 2.5 s between requests, and retries
 * with back-off on 429 and 5xx for reads. Writes are never retried, so a
 * timeout can't create two copies of a layout.
 */
export class PoliteHttp {
  private last = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly transport: PageTransport,
    private readonly rate: RateLimitOptions = DEFAULT_RATE,
  ) {
    this.sleep = rate.sleep ?? realSleep;
    this.now = rate.now ?? Date.now;
  }

  send(req: HttpRequest): Promise<HttpResponse> {
    if (!isAllowedUrl(req.url)) throw new Error(`Refusing to contact ${req.url}: not a TradingView address.`);
    const run = this.queue.then(() => this.sendWithRetry(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async sendWithRetry(req: HttpRequest): Promise<HttpResponse> {
    const attempts = req.method === 'GET' ? 4 : 1;
    for (let attempt = 1; ; attempt++) {
      await this.waitTurn();
      let res: HttpResponse;
      try {
        res = await this.transport.send(req);
      } catch (e) {
        if (attempt >= attempts) throw new TvError('network', 'Could not reach TradingView. Check the internet connection and try again.', String(e));
        await this.sleep(2000 * 2 ** attempt);
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= attempts) return res;
      await this.sleep((res.status === 429 ? 15000 : 3000) * 2 ** (attempt - 1));
    }
  }

  private async waitTurn() {
    const gap = this.rate.minIntervalMs + Math.random() * this.rate.jitterMs;
    const wait = this.last + gap - this.now();
    if (wait > 0) await this.sleep(wait);
    this.last = this.now();
  }
}
