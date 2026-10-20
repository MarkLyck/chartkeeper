import { z } from 'zod';
import type { DrawingBucket, LayoutRecord } from '../model';
import { TvContentSchema } from './content';
import { formatChanged, TvError } from './errors';
import { PLAN_LAYOUT_LIMITS, TEMPLATE_TOOLS, urls } from './endpoints';
import type { HttpResponse, PageUser, PoliteHttp } from './http';

/** One saved layout as listed by TradingView. */
export interface LayoutListEntry {
  uid: string;
  /** Path segment used in /chart/<url>/ (the same as uid for every layout we have seen). */
  url: string;
  id: number | null;
  name: string;
  lastModified: number | null;
  raw: Record<string, unknown>;
}

const obj = z.record(z.string(), z.unknown());

/** Told how many of a list's items are fetched: first (0, n) once the list is known, then after each item. */
export type OnEach = (done: number, total: number) => void;

const LayoutJsonSchema = z.object({
  content: z.string().nullable().optional(),
  content_study_meta: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  uid: z.string().optional(),
  id: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  last_modified: z.number().nullable().optional(),
});

const StorageResponseSchema = z.object({
  success: z.literal(true),
  payload: z
    .object({
      sources: z.record(z.string(), obj.nullable()).nullable().optional(),
      drawing_groups: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .passthrough()
    .nullable(),
});

const SizesResponseSchema = z.object({
  success: z.literal(true),
  payload: z.object({ countSourcesTotal: z.number().optional(), charts: z.record(z.string(), z.unknown()).optional() }).passthrough().nullable(),
});

const SaveResponseSchema = z.object({ id: z.number(), image_url: z.string(), last_modified: z.number().optional() });

function parseJson(res: HttpResponse, what: string): unknown {
  try {
    return JSON.parse(res.body);
  } catch {
    throw formatChanged(what, `HTTP ${res.status} ${res.contentType}: ${res.body.slice(0, 300)}`);
  }
}

function check(res: HttpResponse, what: string): void {
  if (res.status >= 200 && res.status < 300) return;
  // status 0 is a redirect the page did not follow: TradingView sends signed-out visitors to the sign-in page.
  if (res.status === 0 || res.status === 401 || res.status === 403)
    throw new TvError('not-signed-in', 'You are not signed in to TradingView any more. Click "Sign in" and try again.', `${what}: HTTP ${res.status} ${res.body.slice(0, 300)}`);
  if (res.status === 404) throw new TvError('not-found', `TradingView could not find ${what}.`, res.body.slice(0, 300));
  if (res.status === 429) throw new TvError('rate-limited', 'TradingView asked ChartKeeper to slow down. Please wait an hour and try again.', what);
  if (res.status === 413) throw new TvError('too-large', 'This layout is too large for TradingView to save.', what);
  throw new TvError('server', `TradingView had a problem with ${what} (error ${res.status}). Please try again later.`, res.body.slice(0, 500));
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw formatChanged(what, r.error.message);
  return r.data;
}

const firstString = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  return null;
};
const firstNumber = (o: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) if (typeof o[k] === 'number') return o[k] as number;
  return null;
};

/** Parse one /my-charts/ entry. Field names follow the web app's own code. */
export function parseListEntry(raw: Record<string, unknown>): LayoutListEntry {
  const uid = firstString(raw, ['image_url', 'uid', 'url']);
  if (!uid) throw formatChanged('layout list entry without an id', JSON.stringify(raw).slice(0, 300));
  return {
    uid,
    url: firstString(raw, ['url', 'image_url', 'uid']) ?? uid,
    id: firstNumber(raw, ['id']),
    name: firstString(raw, ['name', 'title']) ?? '(no name)',
    lastModified: firstNumber(raw, ['modified', 'last_modified', 'lastModified']),
    raw,
  };
}

export function parseLayoutList(value: unknown): LayoutListEntry[] {
  const list = Array.isArray(value) ? value : obj.safeParse(value).success && Array.isArray((value as Record<string, unknown>).results) ? ((value as Record<string, unknown>).results as unknown[]) : null;
  if (!list) throw formatChanged('layout list', JSON.stringify(value).slice(0, 300));
  return list.map((e) => parseListEntry(parse(obj, e, 'layout list entry')));
}

export function parseLayoutJson(value: unknown, entry: LayoutListEntry): LayoutRecord {
  const j = parse(LayoutJsonSchema, value, 'layout');
  if (!j.content || j.content === 'null' || j.content === 'undefined') throw formatChanged(`layout "${entry.name}" came back empty`, JSON.stringify(value).slice(0, 300));
  let content: unknown;
  let meta: unknown = {};
  try {
    content = JSON.parse(j.content);
    if (j.content_study_meta) meta = JSON.parse(j.content_study_meta);
  } catch (e) {
    throw formatChanged(`layout "${entry.name}" is not valid JSON`, String(e));
  }
  const c = parse(obj, content, 'layout content');
  if (!Array.isArray(c.charts)) throw formatChanged(`layout "${entry.name}" has no charts`, Object.keys(c).join(','));
  const inlineMeta = obj.safeParse(c.studyMetaInfoMap);
  const studyMetaInfoMap = { ...(inlineMeta.success ? inlineMeta.data : {}), ...parse(obj, meta, 'study meta info') } as Record<string, Record<string, unknown>>;
  const { studyMetaInfoMap: _dropped, ...withoutMeta } = c;
  const contentWithoutMeta = parse(TvContentSchema, withoutMeta, `layout "${entry.name}"`);
  return {
    uid: j.uid ?? entry.uid,
    id: j.id ?? entry.id,
    name: j.name ?? entry.name,
    description: j.description ?? '',
    lastModified: j.last_modified ?? entry.lastModified,
    content: contentWithoutMeta,
    studyMetaInfoMap,
    listEntry: entry.raw,
  };
}

export function parseBucket(value: unknown, what: string): DrawingBucket {
  const r = parse(StorageResponseSchema, value, what);
  const sources: Record<string, Record<string, unknown>> = {};
  for (const [id, s] of Object.entries(r.payload?.sources ?? {})) if (s) sources[id] = s;
  return { sources, drawing_groups: r.payload?.drawing_groups ?? {} };
}

export interface LayoutSlots {
  used: number;
  limit: number | null;
  plan: string | null;
  free: boolean;
}

export function layoutSlots(countBody: unknown, listLength: number, plan: string | null): LayoutSlots {
  const c = typeof countBody === 'number' ? countBody : obj.safeParse(countBody).success ? firstNumber(countBody as Record<string, unknown>, ['count', 'charts_count', 'total']) : null;
  const serverLimit = obj.safeParse(countBody).success ? firstNumber(countBody as Record<string, unknown>, ['limit', 'max', 'charts_limit']) : null;
  const used = c ?? listLength;
  // A plan name we don't know gets no limit here; the server's refusal then explains it.
  const limit = serverLimit ?? (plan && plan in PLAN_LAYOUT_LIMITS ? PLAN_LAYOUT_LIMITS[plan]! : null);
  return { used, limit, plan, free: limit === null || used < limit };
}

/** TradingView's internal API, as the web app uses it. One method per request. */
export class TvClient {
  constructor(
    readonly http: PoliteHttp,
    private readonly user: PageUser,
  ) {}

  get username() {
    return this.user.username;
  }
  get plan() {
    return this.user.plan;
  }
  /** For the price websocket. */
  get authToken() {
    return this.user.authToken;
  }

  private async getJson(url: string, what: string): Promise<unknown> {
    const res = await this.http.send({ method: 'GET', url });
    check(res, what);
    return parseJson(res, what);
  }

  async listLayouts(): Promise<LayoutListEntry[]> {
    return parseLayoutList(await this.getJson(urls.myCharts, 'layout list'));
  }

  async getLayout(entry: LayoutListEntry): Promise<LayoutRecord> {
    return parseLayoutJson(await this.getJson(urls.layoutJson(entry.url), `layout "${entry.name}"`), entry);
  }

  async chartToken(uid: string): Promise<string> {
    if (this.user.id === null) throw new TvError('not-signed-in', 'You are not signed in to TradingView.');
    const v = parse(z.object({ token: z.string().min(10) }), await this.getJson(urls.chartToken(uid, this.user.id), 'drawing access token'), 'drawing access token');
    return v.token;
  }

  async drawingBucket(uid: string, chartId: string, token: string): Promise<DrawingBucket> {
    return parseBucket(await this.getJson(urls.layoutSources(uid, chartId, token), `drawings of chart ${chartId}`), `drawings of chart ${chartId}`);
  }

  async userDrawings(uid: string, token: string): Promise<DrawingBucket> {
    return parseBucket(await this.getJson(urls.userSources(uid, token), 'synced drawings'), 'synced drawings');
  }

  /** How many drawings TradingView says this layout has (null if it does not say), and which chart buckets hold them. */
  async drawingSizes(uid: string, token: string): Promise<{ total: number | null; chartIds: string[] }> {
    const r = parse(SizesResponseSchema, await this.getJson(urls.layoutSizes(uid, token), 'drawing counts'), 'drawing counts');
    return { total: r.payload?.countSourcesTotal ?? null, chartIds: Object.keys(r.payload?.charts ?? {}) };
  }

  async studyTemplates(onEach?: OnEach): Promise<Record<string, unknown>[]> {
    const list = parse(z.object({ custom: z.array(obj).default([]) }).passthrough(), await this.getJson(urls.studyTemplates, 'indicator templates'), 'indicator templates');
    const out: Record<string, unknown>[] = [];
    onEach?.(0, list.custom.length);
    for (const t of list.custom) {
      const id = t.id;
      if (typeof id !== 'number' && typeof id !== 'string') throw formatChanged('indicator template without id', JSON.stringify(t).slice(0, 200));
      out.push({ ...t, ...parse(obj, await this.getJson(urls.studyTemplate(id), `indicator template "${String(t.name)}"`), 'indicator template') });
      onEach?.(out.length, list.custom.length);
    }
    return out;
  }

  async drawingTemplateNames(tool: string): Promise<string[]> {
    return parse(z.array(z.string()), await this.getJson(urls.drawingTemplates(tool), `${tool} templates`), `${tool} templates`);
  }

  async addDrawingTemplate(tool: string, name: string, content: unknown): Promise<void> {
    const res = await this.http.send({ method: 'POST', url: urls.saveDrawingTemplate, form: { name, tool, content: JSON.stringify(content) } });
    check(res, `drawing template "${name}"`);
  }

  async addStudyTemplate(t: { name: string; content: unknown; meta_info: unknown }): Promise<void> {
    const res = await this.http.send({ method: 'POST', url: urls.studyTemplates, json: { name: t.name, content: t.content, meta_info: t.meta_info ?? { indicators: [] } } });
    check(res, `indicator template "${t.name}"`);
  }

  async addTheme(name: string, content: unknown): Promise<void> {
    const res = await this.http.send({ method: 'POST', url: urls.saveTheme, form: { name, content: JSON.stringify(content) } });
    check(res, `theme "${name}"`);
  }

  /** TradingView only lists drawing templates one tool at a time, so this asks about every tool: about 90 requests. `onEach` counts tools. */
  async drawingTemplates(onEach?: OnEach): Promise<Record<string, Record<string, unknown>>> {
    const out: Record<string, Record<string, unknown>> = {};
    onEach?.(0, TEMPLATE_TOOLS.length);
    for (const [i, tool] of TEMPLATE_TOOLS.entries()) {
      const names = await this.drawingTemplateNames(tool);
      if (names.length) out[tool] = {};
      for (const name of names) {
        const t = parse(z.object({ content: z.string() }), await this.getJson(urls.drawingTemplate(tool, name), `template "${name}"`), `template "${name}"`);
        out[tool]![name] = JSON.parse(t.content);
      }
      onEach?.(i + 1, TEMPLATE_TOOLS.length);
    }
    return out;
  }

  async themes(onEach?: OnEach): Promise<Record<string, unknown>> {
    const v = await this.getJson(urls.themes, 'color themes');
    // An account without themes answers {"content": ""}.
    const empty = z.object({ content: z.literal('') }).safeParse(v).success;
    const names = empty ? [] : parse(z.array(z.string()), v, 'color themes');
    const out: Record<string, unknown> = {};
    onEach?.(0, names.length);
    for (const [i, name] of names.entries()) {
      const t = parse(z.object({ content: z.string() }), await this.getJson(urls.theme(name), `theme "${name}"`), `theme "${name}"`);
      out[name] = JSON.parse(t.content);
      onEach?.(i + 1, names.length);
    }
    return out;
  }

  async pineScripts(onEach?: OnEach): Promise<{ id: string; name: string; version: string; source: string; meta: Record<string, unknown> }[]> {
    const list = parse(z.array(z.object({ scriptIdPart: z.string(), scriptName: z.string(), version: z.string() }).passthrough()), await this.getJson(urls.pineList, 'Pine scripts'), 'Pine scripts');
    const out = [];
    onEach?.(0, list.length);
    for (const s of list) {
      const full = parse(z.object({ source: z.string() }).passthrough(), await this.getJson(urls.pineScript(s.scriptIdPart, s.version), `script "${s.scriptName}"`), `script "${s.scriptName}"`);
      const { source, ...meta } = full;
      out.push({ id: s.scriptIdPart, name: s.scriptName, version: s.version, source, meta: { ...s, ...meta } });
      onEach?.(out.length, list.length);
    }
    return out;
  }

  async slots(listLength: number): Promise<LayoutSlots> {
    const res = await this.http.send({ method: 'GET', url: urls.chartCount });
    check(res, 'layout count');
    return layoutSlots(parseJson(res, 'layout count'), listLength, this.user.plan);
  }

  /** Creates a new layout. Never retried. */
  async createLayout(form: Record<string, string>): Promise<{ id: number; uid: string }> {
    const res = await this.http.send({ method: 'POST', url: urls.saveLayout, form });
    if (res.status === 403 && /limit|paywall|over_limit|savedCharts/i.test(res.body))
      throw new TvError('limit-reached', 'Your TradingView plan has no free layout slot.', res.body.slice(0, 300));
    check(res, 'the restored layout');
    const v = parse(SaveResponseSchema, parseJson(res, 'save result'), 'save result');
    return { id: v.id, uid: v.image_url };
  }
}
