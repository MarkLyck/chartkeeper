/**
 * The fake TradingView the end-to-end tests run the real app against. Built
 * into dist-test/fake-tradingview.js by `npm run test:e2e` and loaded by
 * src/main/fakeTradingView.ts only in an unpackaged app with
 * CHARTKEEPER_FAKE_TRADINGVIEW=1.
 *
 * It answers the https requests of ChartKeeper's private session from
 * FakeTradingView, so the hidden tradingview.com page, the request policy and
 * the chart-page check run as shipped. Tests change it between steps through
 * `globalThis.__chartkeeperFake` (Playwright's `app.evaluate`).
 */
import type { Session } from 'electron';
import { readFileSync } from 'node:fs';
import { countLayout, parseLayout } from '../../src/core/layout';
import type { LayoutRecord } from '../../src/core/model';
import type { PageCount } from '../../src/core/restorePolicy';
import { SESSION_COOKIE } from '../../src/core/tv/endpoints';
import type { HttpRequest, HttpResponse } from '../../src/core/tv/http';
import type { FakeTradingView as FakeHooks } from '../../src/main/fakeTradingView';
import { fakeDataSocket } from './fakeDataSocket';
import { FakeTradingView, type FakeLayout } from './fakeTradingView';

export const SEED_ENV = 'CHARTKEEPER_FAKE_TRADINGVIEW_SEED';

/** What the account looks like when the app starts. Written by the test as JSON. */
export interface FakeSeed {
  layouts: FakeLayout[];
  plan: string;
  /** Start with the sign-in cookie already in ChartKeeper's session. */
  signedIn: boolean;
  /** How often the app checks whether the daily backup is due. */
  scheduleEveryMs: number;
  /** Sign in with a fake Safari whose data folder is this; the test writes its cookie files. */
  safariDataDir?: string;
}

/** A sign-in TradingView has ended: the fake treats a session with this value as signed out. */
export const EXPIRED_SESSION = 'expired-session';

export type Scenario = 'normal' | 'format-changed' | 'rate-limited' | 'offline';

export interface FakeControl {
  tv: FakeTradingView;
  scenario: Scenario;
  setScenario(s: Scenario): void;
  /** Every request the app's sessions made, pages included: "GET https://...". */
  urls: string[];
  /** Pages the app asked the fake Safari to open. */
  safariOpened: string[];
}

const json = (status: number, body: unknown): HttpResponse => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const LAYOUT_JSON = /^\/chart\/[^/]+\/json\/$/;

/** `offline`: no request gets an answer. `failOn`: TradingView's answer instead of the fake account's. */
const SCENARIOS: Record<Scenario, { offline: boolean; failOn: FakeTradingView['failOn'] }> = {
  normal: { offline: false, failOn: null },
  // The layout comes back under field names ChartKeeper doesn't know.
  'format-changed': { offline: false, failOn: (req) => (LAYOUT_JSON.test(new URL(req.url).pathname) ? json(200, { layout_content: '{"charts":[]}', title: 'renamed' }) : null) },
  'rate-limited': { offline: false, failOn: () => json(429, { detail: 'Too many requests' }) },
  offline: { offline: true, failOn: null },
};

/** The counts TradingView's chart page would show for this layout: content and storage drawings together. */
function shownCounts(l: FakeLayout): PageCount {
  const record: LayoutRecord = { uid: l.uid, id: l.id, name: l.name, description: '', lastModified: null, content: l.content, studyMetaInfoMap: l.studyMeta as LayoutRecord['studyMetaInfoMap'], listEntry: {} };
  const buckets = Object.fromEntries(Object.entries(l.storage).map(([id, sources]) => [id, { sources, drawing_groups: {} }]));
  const c = countLayout(parseLayout(record, { buckets, reportedTotal: null }));
  return { drawings: c.drawings, studies: c.studies };
}

const html = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>TradingView (fake)</title></head><body>${body}</body></html>`;

function page(tv: FakeTradingView, url: URL, signedIn: boolean, buildTime: string): string | null {
  if (url.hostname !== 'www.tradingview.com') return null;
  if (url.pathname === '/') {
    const a = tv.account;
    const user = signedIn && a ? { id: a.id, username: a.username, auth_token: a.authToken, pro_plan: a.plan } : {};
    return html(`<script>window.user = ${JSON.stringify(user)}; window.BUILD_TIME = ${JSON.stringify(buildTime)};</script>`);
  }
  if (url.pathname === '/accounts/signin/') {
    const set = `document.cookie = 'sessionid=fake-session; domain=.tradingview.com; path=/; secure; samesite=lax'; document.cookie = 'sessionid_sign=fake-sign; domain=.tradingview.com; path=/; secure; samesite=lax';`;
    return html(`<h1>Sign in to TradingView (fake)</h1><button id="fake-signin" onclick="${set}">Sign in</button>`);
  }
  const chart = /^\/chart\/([^/]+)\/$/.exec(url.pathname);
  if (chart) {
    const l = tv.layouts.get(decodeURIComponent(chart[1]!));
    if (!l || !signedIn) return html('<p>This chart layout is private.</p>');
    const n = shownCounts(l);
    const charts = Math.max(1, l.content.charts.length);
    // Every drawing and indicator on the first chart: the app only adds them up.
    // Like TradingView: getAllShapes() leaves out arrow marks, the saved layout has every drawing.
    const saved = JSON.stringify({ content: JSON.stringify({ charts: [{ panes: [{ sources: Array.from({ length: n.drawings }, () => ({ type: 'LineToolTrendLine' })) }] }] }) });
    const api = `window.TradingViewApi = { chartsCount: () => ${charts}, getSaveChartService: () => ({ saveToJSON: () => (${saved}) }), chart: (i) => ({ dataReady: () => true, getAllShapes: () => new Array(i === 0 ? Math.max(0, ${n.drawings} - 1) : 0).fill({}), getAllStudies: () => new Array(i === 0 ? ${n.studies} : 0).fill({}) }) };`;
    return html(`<script>${api}</script>`);
  }
  return null;
}

async function toHttpRequest(req: Request): Promise<HttpRequest> {
  const type = req.headers.get('content-type') ?? '';
  const buildTime = req.headers.get('x-build-time');
  const base: HttpRequest = { method: req.method as HttpRequest['method'], url: req.url, headers: buildTime ? { 'X-BUILD-TIME': buildTime } : {} };
  if (type.startsWith('application/json')) return { ...base, json: await req.json() };
  if (type.startsWith('multipart/form-data')) return { ...base, form: Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)])) };
  return base;
}

function readSeed(): FakeSeed {
  const file = process.env[SEED_ENV];
  const seed: Partial<FakeSeed> = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return { layouts: [], plan: 'pro_premium', signedIn: false, scheduleEveryMs: 15 * 60_000, ...seed };
}

export function createFakeTradingView(): FakeHooks {
  const seed = readSeed();
  const tv = new FakeTradingView();
  for (const l of seed.layouts) tv.add(l);
  tv.account = { ...tv.account!, plan: seed.plan };

  const control: FakeControl = {
    tv,
    scenario: 'normal',
    setScenario(s) {
      control.scenario = s;
      tv.failOn = SCENARIOS[s].failOn;
    },
    urls: [],
    safariOpened: [],
  };
  (globalThis as { __chartkeeperFake?: FakeControl }).__chartkeeperFake = control;
  // Fake mode must never open a real browser on the real tradingview.com.
  process.env.CHARTKEEPER_BROWSER = seed.safariDataDir ? 'safari' : 'none';

  const answer = async (ses: Session, req: Request): Promise<Response> => {
    control.urls.push(`${req.method} ${req.url}`);
    if (SCENARIOS[control.scenario].offline) return Response.error();
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors: Record<string, string> = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {};
    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, PUT', 'access-control-allow-headers': 'content-type, x-build-time' } });
    const signedIn = (await ses.cookies.get({ name: SESSION_COOKIE })).some((c) => c.value !== EXPIRED_SESSION);
    const p = req.method === 'GET' ? page(tv, url, signedIn, (await tv.buildTime()) ?? '') : null;
    if (p !== null) return new Response(p, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const res = signedIn ? await tv.send(await toHttpRequest(req)) : json(403, { detail: 'Authentication credentials were not provided.', code: 'not_authenticated' });
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.contentType, ...cors } });
  };

  return {
    async intercept({ tradingView, signIn }) {
      for (const ses of [tradingView, signIn]) ses.protocol.handle('https', (req) => answer(ses, req));
      if (seed.signedIn)
        await tradingView.cookies.set({ url: 'https://www.tradingview.com/', name: SESSION_COOKIE, value: 'fake-session', domain: '.tradingview.com', path: '/', secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 86400 });
    },
    socketFactory: fakeDataSocket({ bars: 300 }).factory,
    rate: { minIntervalMs: 0, jitterMs: 0, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) },
    schedule: { firstCheckMs: seed.scheduleEveryMs, everyMs: seed.scheduleEveryMs },
    safari: seed.safariDataDir ? { dataDir: seed.safariDataDir, open: async (url) => void control.safariOpened.push(url) } : undefined,
  };
}
