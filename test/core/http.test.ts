import { describe, expect, it } from 'vitest';
import { PoliteHttp, type HttpRequest, type HttpResponse, type PageTransport } from '../../src/core/tv/http';

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
    expect(sent[2]!.at - sent[1]!.at).toBeGreaterThanOrEqual(30000);
  });

  it('never retries a save, so a slow answer cannot create two layouts', async () => {
    const { http, sent } = fakeTransport(() => ({ ...ok, status: 503 }));
    const res = await http.send({ method: 'POST', url: 'https://www.tradingview.com/api/v1/charts/save/', form: {} });
    expect(res.status).toBe(503);
    expect(sent).toHaveLength(1);
  });
});
