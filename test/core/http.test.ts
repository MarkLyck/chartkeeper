import http from 'node:http';
import type { AddressInfo } from 'node:net';
import vm from 'node:vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageFetch, pageUser, PoliteHttp, type HttpRequest, type HttpResponse, type PageTransport } from '../../src/core/tv/http';

function fakeTransport(responses: (req: HttpRequest) => HttpResponse) {
  const sent: { req: HttpRequest; at: number }[] = [];
  let clock = 0;
  const transport: PageTransport = {
    send: async (req) => {
      sent.push({ req, at: clock });
      return responses(req);
    },
    user: async () => null,
    buildTime: async () => null,
  };
  const rate = { minIntervalMs: 1500, jitterMs: 1000, now: () => clock, sleep: async (ms: number) => void (clock += ms) };
  return { http: new PoliteHttp(transport, rate), sent };
}

const ok: HttpResponse = { status: 200, contentType: 'application/json', body: '{}' };

describe('request policy', () => {
  it('refuses to contact anything that is not TradingView', () => {
    const { http } = fakeTransport(() => ok);
    expect(() => http.send({ method: 'GET', url: 'https://evil.example.com/steal' })).toThrow(/not a TradingView address/);
    expect(() => http.send({ method: 'GET', url: 'https://tradingview.com.evil.example/x' })).toThrow();
  });

  it('waits at least 1.5 seconds between requests', async () => {
    const { http, sent } = fakeTransport(() => ok);
    await Promise.all([1, 2, 3].map(() => http.send({ method: 'GET', url: 'https://www.tradingview.com/my-charts/' })));
    const gaps = sent.slice(1).map((s, i) => s.at - sent[i]!.at);
    expect(gaps.every((g) => g >= 1500 && g <= 2500)).toBe(true);
  });

  it('retries reads after "too many requests", with back-off', async () => {
    let n = 0;
    const { http, sent } = fakeTransport(() => (++n < 3 ? { ...ok, status: 429 } : ok));
    const res = await http.send({ method: 'GET', url: 'https://www.tradingview.com/my-charts/' });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(3);
    expect(Math.round(sent[2]!.at - sent[1]!.at)).toBeGreaterThanOrEqual(30000);
  });

  it('never retries a save, so a slow answer cannot create two layouts', async () => {
    const { http, sent } = fakeTransport(() => ({ ...ok, status: 503 }));
    const res = await http.send({ method: 'POST', url: 'https://www.tradingview.com/api/v1/charts/save/', form: {} });
    expect(res.status).toBe(503);
    expect(sent).toHaveLength(1);
  });
});

describe('network failures', () => {
  const failing = () => {
    const sent: HttpRequest[] = [];
    let clock = 0;
    const transport: PageTransport = {
      send: async (req) => {
        sent.push(req);
        throw new Error('net::ERR_INTERNET_DISCONNECTED');
      },
      user: async () => null,
      buildTime: async () => null,
    };
    return { http: new PoliteHttp(transport, { minIntervalMs: 0, jitterMs: 0, now: () => clock, sleep: async (ms) => void (clock += ms) }), sent };
  };

  it('retries a read four times, then says the internet connection is the problem', async () => {
    const { http, sent } = failing();
    await expect(http.send({ method: 'GET', url: 'https://www.tradingview.com/my-charts/' })).rejects.toMatchObject({ kind: 'network', detail: expect.stringContaining('ERR_INTERNET_DISCONNECTED') });
    expect(sent).toHaveLength(4);
  });

  it('sends a save only once even when the connection drops', async () => {
    const { http, sent } = failing();
    await expect(http.send({ method: 'POST', url: 'https://www.tradingview.com/api/v1/charts/save/', form: {} })).rejects.toMatchObject({ kind: 'network' });
    expect(sent).toHaveLength(1);
  });

  it('keeps sending queued requests after one of them failed', async () => {
    let n = 0;
    const transport: PageTransport = {
      send: async () => {
        if (n++ === 0) throw new Error('reset');
        return ok;
      },
      user: async () => null,
      buildTime: async () => null,
    };
    const http = new PoliteHttp(transport, { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} });
    const save = http.send({ method: 'POST', url: 'https://www.tradingview.com/api/v1/charts/save/', form: {} });
    const list = http.send({ method: 'GET', url: 'https://www.tradingview.com/my-charts/' });
    await expect(save).rejects.toMatchObject({ kind: 'network' });
    await expect(list).resolves.toEqual(ok);
  });

  it('gives a server error on a read three more tries with growing pauses, then returns it', async () => {
    const { http, sent } = fakeTransport(() => ({ ...ok, status: 502 }));
    const res = await http.send({ method: 'GET', url: 'https://www.tradingview.com/my-charts/' });
    expect(res.status).toBe(502);
    expect(sent).toHaveLength(4);
    const gaps = sent.slice(1).map((s, i) => s.at - sent[i]!.at);
    expect(gaps[0]).toBeGreaterThanOrEqual(3000);
    expect(gaps[1]).toBeGreaterThanOrEqual(6000);
    expect(gaps[2]).toBeGreaterThanOrEqual(12000);
  });
});

describe('the code that runs inside the TradingView page', () => {
  let server: http.Server;
  let base: string;
  let seen: { method: string; headers: http.IncomingHttpHeaders; body: string }[];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method!, headers: req.headers, body });
        if (req.url === '/my-charts/') {
          res.writeHead(302, { location: '/accounts/signin/' });
          return res.end();
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    seen = [];
  });

  it('sends JSON with its content type, and returns status, type and body', async () => {
    const res = await pageFetch({ method: 'PUT', url: `${base}/sources`, json: { sources: { a: null } }, headers: { 'X-BUILD-TIME': 'bt' } });
    expect(res).toEqual({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    expect(seen[0]).toMatchObject({ method: 'PUT', body: '{"sources":{"a":null}}', headers: { 'content-type': 'application/json', 'x-build-time': 'bt' } });
  });

  it('sends a form as multipart fields, like the web app', async () => {
    await pageFetch({ method: 'POST', url: `${base}/save`, form: { name: 'My layout', content: '{"charts":[]}' } });
    expect(seen[0]!.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen[0]!.body).toMatch(/name="name"\r\n\r\nMy layout\r\n/);
    expect(seen[0]!.body).toMatch(/name="content"\r\n\r\n\{"charts":\[\]\}\r\n/);
  });

  it('does not follow the redirect TradingView sends a signed-out visitor', async () => {
    const res = await pageFetch({ method: 'GET', url: `${base}/my-charts/` });
    expect(res.status).toBe(302);
    expect(seen.map((s) => s.method)).toEqual(['GET']);
  });

  describe('reading window.user', () => {
    afterEach(() => vi.unstubAllGlobals());
    const withUser = (user: unknown) => {
      vi.stubGlobal('window', { user });
      return pageUser();
    };

    it('reads the id, name, token and paid plan', () => {
      expect(withUser({ id: 7, username: 'trader', auth_token: 'tok', pro_plan: 'pro_premium', is_pro: true })).toEqual({ id: 7, username: 'trader', authToken: 'tok', plan: 'pro_premium' });
    });

    it('calls an account that is not pro a free plan, so its one-layout limit applies', () => {
      expect(withUser({ id: 7, username: 'trader', pro_plan: '', is_pro: false })).toMatchObject({ plan: 'free', authToken: null });
    });

    it('leaves the plan unknown when the page does not say', () => {
      expect(withUser({ id: 7, username: 'trader', is_pro: true })).toMatchObject({ plan: null });
    });

    it('treats a page without a numeric user id as signed out', () => {
      expect(withUser(undefined)).toBeNull();
      expect(withUser({ id: '7', username: 'trader' })).toBeNull();
    });
  });

  it('works when serialized and run on its own, the way the app injects it into the page', async () => {
    const run = (fn: (...a: never[]) => unknown, arg: unknown, globals: object) =>
      vm.runInNewContext(`(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`, { ...globals });
    const res = await run(pageFetch, { method: 'POST', url: `${base}/save`, form: { a: '1' } }, { fetch, FormData });
    expect(res).toMatchObject({ status: 200, body: '{"ok":true}' });
    expect(run(pageUser, undefined, { window: { user: { id: 1, username: 'u', is_pro: false } } })).toMatchObject({ id: 1, plan: 'free' });
  });
});
