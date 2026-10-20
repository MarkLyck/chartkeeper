import type { TvContent } from '../../src/core/tv/content';
import type { HttpRequest, HttpResponse, PageTransport, PageUser } from '../../src/core/tv/http';

export interface FakeLayout {
  uid: string;
  id: number;
  name: string;
  content: TvContent;
  studyMeta: Record<string, unknown>;
  /** chart id ("1", "_shared") -> drawing id -> stored drawing DTO */
  storage: Record<string, Record<string, Record<string, unknown>>>;
  listExtra?: Record<string, unknown>;
}

/**
 * TradingView saves templates and themes by name, over one it has. Whether it
 * matches names regardless of case and spaces is not known, so the fake
 * assumes the worse case for the existing one: it does.
 */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const keyFor = (o: Record<string, unknown>, name: string) => Object.keys(o).find((k) => sameName(k, name)) ?? name;

/**
 * An in-memory stand-in for the parts of tradingview.com ChartKeeper uses,
 * following the request and response formats in docs/INVESTIGATION.md,
 * including how a save overwrites what it names.
 */
export class FakeTradingView implements PageTransport {
  layouts = new Map<string, FakeLayout>();
  requests: HttpRequest[] = [];
  account: PageUser | null = { id: 42, username: 'demo_user', authToken: 'auth-token', plan: 'pro_premium' };
  layoutLimit: number | null = null;
  /** Simulates the storage answering without cookies: empty success. */
  storageIgnoresCookies = false;
  failOn: ((req: HttpRequest) => HttpResponse | null) | null = null;
  drawingTemplates: Record<string, Record<string, unknown>> = { LineToolTrendLine: { 'Thick orange': { linecolor: '#ff9800', linewidth: 4 } } };
  studyTemplates = [{ id: 7, name: 'My RSI setup', content: { panes: [] }, meta_info: { indicators: [{ id: 'RSI', description: 'RSI' }] } }];
  themes: Record<string, unknown> = { 'My dark': { content: { 'paneProperties.background': '#000' } } };
  scripts = [{ scriptIdPart: 'USER;abc123', scriptName: 'My Trend', version: '3.0', source: '//@version=6\nindicator("My Trend")\nplot(close)' }];
  private nextId = 1000;

  user(): Promise<PageUser | null> {
    return Promise.resolve(this.account);
  }

  add(l: FakeLayout) {
    this.layouts.set(l.uid, l);
    return this;
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const forced = this.failOn?.(req);
    if (forced) return forced;
    const u = new URL(req.url);
    const json = (status: number, body: unknown): HttpResponse => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!this.account) return json(403, { detail: 'Authentication credentials were not provided.', code: 'not_authenticated' });
    const p = u.pathname;

    if (u.hostname === 'www.tradingview.com') {
      if (p === '/my-charts/') return json(200, [...this.layouts.values()].map((l) => ({ id: l.id, image_url: l.uid, url: l.uid, name: l.name, modified: 1792000000, ...l.listExtra })));
      if (p === '/api/v1/charts/count/') return json(200, { count: this.layouts.size });
      const lj = /^\/chart\/([^/]+)\/json\/$/.exec(p);
      if (lj) {
        const l = this.layouts.get(decodeURIComponent(lj[1]!));
        if (!l) return json(404, { code: 'not_found', detail: 'Not found' });
        return json(200, { content: JSON.stringify(l.content), content_study_meta: JSON.stringify(l.studyMeta), name: l.name, uid: l.uid, id: l.id, description: '', last_modified: 1792000000, username: 'demo_user', is_private: true });
      }
      if (p === '/chart-token/') {
        const uid = u.searchParams.get('image_url')!;
        if (!this.layouts.has(uid)) return json(404, { code: 'not_found', detail: 'Chart with given id not found' });
        return json(200, { token: `jwt.${uid}.signature` });
      }
      if (p === '/api/v1/charts/save/' && req.method === 'POST') {
        const f = req.form!;
        // A save that names a layout, by id string or by number, overwrites it.
        const target = f.image_url ?? (f.id === undefined ? undefined : [...this.layouts.values()].find((l) => String(l.id) === f.id)?.uid);
        if (!target && this.layoutLimit !== null && this.layouts.size >= this.layoutLimit) return json(403, { detail: 'savedChartsLimit', code: 'limit' });
        const uid = target ?? `New${this.nextId}`;
        const existing = target ? this.layouts.get(target) : undefined;
        const l: FakeLayout = existing ?? { uid, id: this.nextId++, name: f.name!, content: { charts: [] }, studyMeta: {}, storage: {} };
        l.name = f.name!;
        l.content = JSON.parse(f.content!);
        l.studyMeta = JSON.parse(f.study_meta_info_map ?? '{}');
        this.layouts.set(uid, l);
        return json(200, { id: l.id, image_url: uid, last_modified: 1792000001 });
      }
      if (p === '/api/v1/study-templates' && req.method === 'GET') return json(200, { custom: this.studyTemplates.map(({ content: _c, ...t }) => t), standard: [{ id: 1, name: 'Bill Williams' }] });
      if (p === '/api/v1/study-templates' && req.method === 'POST') {
        const t = req.json as { name: string; content: unknown; meta_info: unknown };
        const existing = this.studyTemplates.find((e) => sameName(e.name, t.name));
        if (existing) Object.assign(existing, { content: t.content, meta_info: t.meta_info });
        else this.studyTemplates.push({ id: this.nextId++, name: t.name, content: t.content as { panes: [] }, meta_info: t.meta_info as never });
        return json(200, { id: existing?.id ?? this.nextId - 1 });
      }
      const st = /^\/api\/v1\/study-templates\/(\d+)$/.exec(p);
      if (st) return json(200, this.studyTemplates.find((t) => String(t.id) === st[1]) ?? {});
      const dt = /^\/drawing-templates\/([^/]+)\/$/.exec(p);
      if (dt) return json(200, Object.keys(this.drawingTemplates[dt[1]!] ?? {}));
      const dtt = /^\/drawing-template\/([^/]+)\/$/.exec(p);
      if (dtt) return json(200, { content: JSON.stringify(this.drawingTemplates[dtt[1]!]?.[u.searchParams.get('templateName')!]) });
      if (p === '/save-drawing-template/') {
        const f = req.form!;
        const templates = (this.drawingTemplates[f.tool!] ??= {});
        templates[keyFor(templates, f.name!)] = JSON.parse(f.content!);
        return json(200, {});
      }
      if (p === '/themes/') return json(200, Object.keys(this.themes));
      if (p === '/theme/') return json(200, { content: JSON.stringify(this.themes[u.searchParams.get('themeName')!]) });
      if (p === '/save-theme/') {
        this.themes[keyFor(this.themes, req.form!.name!)] = JSON.parse(req.form!.content!);
        return json(200, {});
      }
    }

    if (u.hostname === 'charts-storage.tradingview.com') {
      const uid = u.searchParams.get('layout_id')!;
      const l = this.layouts.get(uid);
      if (u.searchParams.get('jwt') !== `jwt.${uid}.signature` || !l) return json(401, { success: false });
      if (p.endsWith('/sizes')) return json(200, { success: true, payload: { countSourcesTotal: Object.values(l.storage).reduce((n, b) => n + Object.keys(b).length, 0), charts: {} } });
      if (p === '/charts-storage/get/user/sources') return json(200, { success: true, payload: { sources: { u1: { id: 'u1', ownerSource: '_seriesId', state: { type: 'LineToolHorzLine', id: 'u1', state: { linecolor: '#fff' }, points: [{ time_t: 1780000000, offset: 0, price: 1 }] } } }, drawing_groups: {} } });
      const chartId = u.searchParams.get('chart_id')!;
      if (p.startsWith('/charts-storage/get/layout/')) {
        if (this.storageIgnoresCookies) return json(200, { success: true, payload: { sources: {} } });
        return json(200, { success: true, payload: { sources: l.storage[chartId] ?? {}, drawing_groups: {}, clientId: 'x' } });
      }
    }

    if (u.hostname === 'pine-facade.tradingview.com') {
      if (p === '/pine-facade/list') return json(200, this.scripts.map(({ source: _s, ...s }) => s));
      const g = /^\/pine-facade\/get\/([^/]+)\/([^/]+)$/.exec(p);
      if (g) {
        const s = this.scripts.find((x) => x.scriptIdPart === decodeURIComponent(g[1]!));
        return s ? json(200, { source: s.source, scriptName: s.scriptName, created: '2026-01-01' }) : json(404, {});
      }
    }
    return json(404, { detail: `fake has no ${req.method} ${req.url}` });
  }
}
