import type { ChartData, StudyValues } from '../model';
import type { ParsedChart, ParsedStudy } from '../layout';
import { DATA_SOCKET, ORIGIN } from './endpoints';

/** Websocket frames: `~m~<length>~m~<payload>`, several per message. */
export function decodeFrames(data: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < data.length) {
    if (!data.startsWith('~m~', i)) break;
    const end = data.indexOf('~m~', i + 3);
    if (end < 0) break;
    const len = Number(data.slice(i + 3, end));
    out.push(data.slice(end + 3, end + 3 + len));
    i = end + 3 + len;
  }
  return out;
}

export const encodeFrame = (payload: string) => `~m~${payload.length}~m~${payload}`;
export const msg = (m: string, p: unknown[]) => encodeFrame(JSON.stringify({ m, p }));

/** TradingView uses huge numbers to mean "no value". */
const clean = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e90 ? v : null);

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onopen: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string, origin: string) => SocketLike;

/** Node 22+/Electron main: the built-in WebSocket accepts an Origin header. */
export const nodeSocketFactory: SocketFactory = (url, origin) =>
  new (globalThis as unknown as { WebSocket: new (u: string, o: unknown) => SocketLike }).WebSocket(url, { headers: { Origin: origin } });

export interface FetchChartOptions {
  authToken: string | null;
  bars: number;
  timeoutMs?: number;
  /** Pause between studies, to stay polite. */
  studyPauseMs?: number;
  log?: (line: string) => void;
}

export interface StudyRequest {
  /** The study's source id in the layout. */
  id: string;
  /** What `create_study` is called with: the metaInfo id, or "Script@tv-scripting-101!" for Pine. */
  createId: string;
  inputs: Record<string, unknown>;
}

const randomId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 14);

/** Stored inputs as `create_study` expects them for built-in studies. */
export function studyInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) if (v !== undefined) out[k] = v;
  return out;
}

const PINE_STUDY = 'Script@tv-scripting-101!';
const PINE_ENVELOPE = new Set(['text', 'pineId', 'pineVersion']);

/**
 * Build the `create_study` call the chart page itself sends for a study.
 *
 * Built-in studies ("BB@tv-basicstudies-280") take the stored inputs as they
 * are. Pine studies, including TradingView's own "Script$STD;RSI" and the
 * user's private scripts, are sent as "Script@tv-scripting-101!" with the
 * compiled script (`text`, from the metaInfo input defaults), its id and
 * version, and every other input wrapped as `{v, f: true, t: <type>}`.
 */
export function studyRequest(study: ParsedStudy): StudyRequest {
  const meta = study.metaInfo;
  // Only what the chart page itself sends as Script@tv-scripting-101! (see the frames in docs/INVESTIGATION.md).
  const sentAsPine = study.metaInfoId.startsWith('Script$') || meta?.isTVScript === true;
  if (!sentAsPine || !meta) return { id: study.id, createId: study.metaInfoId, inputs: studyInputs(study.inputs) };
  const defs = Array.isArray(meta.inputs) ? (meta.inputs as Record<string, unknown>[]) : [];
  const text = defs.find((d) => d.id === 'text')?.defval;
  const pine = (meta.pine ?? {}) as Record<string, unknown>;
  const scriptId = typeof meta.scriptIdPart === 'string' ? meta.scriptIdPart : '';
  if (typeof text !== 'string' || !scriptId) throw new Error(`The compiled script for "${study.name}" is not in the backup.`);
  const inputs: Record<string, unknown> = { text, pineId: scriptId, pineVersion: String(pine.version ?? study.inputs.pineVersion ?? '') };
  for (const d of defs) {
    const id = String(d.id);
    if (PINE_ENVELOPE.has(id)) continue;
    inputs[id] = { v: id in study.inputs ? study.inputs[id] : d.defval, f: true, t: String(d.type) };
  }
  return { id: study.id, createId: PINE_STUDY, inputs };
}

/**
 * Fetch prices and indicator values for one chart of a layout.
 *
 * Opens one websocket, loads the series, then adds the layout's indicators one
 * at a time (each plan has a per-chart indicator limit), removing each after
 * it completes. Indicators TradingView refuses are recorded as errors, not
 * dropped, so the viewer can say why it can't show them.
 */
export async function fetchChartData(chart: ParsedChart, studies: ParsedStudy[], factory: SocketFactory, opts: FetchChartOptions): Promise<ChartData> {
  const timeoutMs = opts.timeoutMs ?? 45000;
  const ws = factory(DATA_SOCKET, ORIGIN);
  const cs = randomId('cs_');
  const bars = new Map<number, ChartData['bars'][number]>();
  const studyRows = new Map<string, Map<number, (number | null)[]>>();
  const studyGraphics = new Map<string, unknown>();
  const waiters = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let failure: Error | null = null;

  const waitFor = (key: string) =>
    new Promise<unknown>((resolve, reject) => {
      if (failure) return reject(failure);
      const t = setTimeout(() => {
        waiters.delete(key);
        reject(new Error(`TradingView did not answer in time (${key}).`));
      }, timeoutMs);
      waiters.set(key, { resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) });
    });
  const settle = (key: string, value: unknown, error?: Error) => {
    const w = waiters.get(key);
    if (!w) return;
    waiters.delete(key);
    error ? w.reject(error) : w.resolve(value);
  };
  const failAll = (e: Error) => {
    failure = e;
    for (const [k, w] of waiters) {
      waiters.delete(k);
      w.reject(e);
    }
  };

  const handle = (payload: string) => {
    if (payload.startsWith('~h~')) return ws.send(encodeFrame(payload));
    let m: { m?: string; p?: unknown[]; session_id?: string };
    try {
      m = JSON.parse(payload);
    } catch {
      return;
    }
    if (m.session_id !== undefined || !m.m) return settle('hello', true);
    const p = m.p ?? [];
    switch (m.m) {
      case 'symbol_resolved':
        return settle('symbol', p[2]);
      case 'symbol_error':
        return settle('symbol', null, new Error(`TradingView does not know the symbol ${chart.symbol}: ${JSON.stringify(p[2] ?? '')}`));
      case 'timescale_update':
      case 'du': {
        const upd = (p[1] ?? {}) as Record<string, { s?: { v: unknown[] }[]; st?: { v: unknown[] }[]; ns?: unknown }>;
        for (const r of upd.sds_1?.s ?? []) {
          const v = r.v;
          const t = clean(v[0]);
          if (t === null) continue;
          bars.set(t, [t, clean(v[1]) ?? 0, clean(v[2]) ?? 0, clean(v[3]) ?? 0, clean(v[4]) ?? 0, clean(v[5]) ?? 0]);
        }
        for (const [sid, u] of Object.entries(upd)) {
          if (!u.st && !u.ns) continue;
          const rows = studyRows.get(sid) ?? new Map();
          for (const r of u.st ?? []) {
            const t = clean(r.v[0]);
            if (t !== null) rows.set(t, r.v.map(clean));
          }
          studyRows.set(sid, rows);
          if (u.ns) studyGraphics.set(sid, u.ns);
        }
        return;
      }
      case 'series_completed':
        return settle('series', true);
      case 'series_error':
        return settle('series', null, new Error(`TradingView could not load prices for ${chart.symbol}: ${JSON.stringify(p.slice(2))}`));
      case 'study_completed':
        return settle(`study:${String(p[1])}`, true);
      case 'study_error':
        return settle(`study:${String(p[1])}`, null, new Error(studyErrorText(p)));
      case 'critical_error':
      case 'protocol_error':
        return failAll(new Error(`TradingView data connection error: ${JSON.stringify(p)}`));
    }
  };

  ws.onmessage = (ev) => {
    for (const f of decodeFrames(String(ev.data))) handle(f);
  };
  ws.onerror = (ev) => failAll(new Error(`Could not connect to TradingView price data: ${String((ev as { message?: string })?.message ?? ev)}`));
  ws.onclose = () => failAll(new Error('TradingView closed the price data connection.'));

  try {
    await waitFor('hello');
    ws.send(msg('set_auth_token', [opts.authToken ?? 'unauthorized_user_token']));
    ws.send(msg('chart_create_session', [cs, '']));
    ws.send(msg('switch_timezone', [cs, chart.timezone || 'Etc/UTC']));
    const symbolSpec: Record<string, unknown> = { adjustment: 'splits', symbol: chart.symbol };
    if (typeof chart.seriesState.session === 'string') symbolSpec.session = chart.seriesState.session;
    else if (typeof chart.seriesState.sessionId === 'string') symbolSpec.session = chart.seriesState.sessionId;
    if (typeof chart.seriesState.currencyId === 'string') symbolSpec['currency-id'] = chart.seriesState.currencyId;
    ws.send(msg('resolve_symbol', [cs, 'sds_sym_1', '=' + JSON.stringify(symbolSpec)]));
    await waitFor('symbol');
    ws.send(msg('create_series', [cs, 'sds_1', 's1', 'sds_sym_1', chart.interval, opts.bars, '']));
    await waitFor('series');

    const studyResults: Record<string, StudyValues> = {};
    for (const s of studies) {
      let req: StudyRequest;
      try {
        req = studyRequest(s);
      } catch (e) {
        studyResults[s.id] = { status: 'error', metaInfoId: s.metaInfoId, error: (e as Error).message };
        continue;
      }
      const sid = randomId('st_');
      opts.log?.(`  indicator ${s.metaInfoId}`);
      ws.send(msg('create_study', [cs, sid, 'st1', 'sds_1', req.createId, req.inputs]));
      try {
        await waitFor(`study:${sid}`);
        const rows = [...(studyRows.get(sid)?.values() ?? [])].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
        studyResults[s.id] = { status: 'ok', metaInfoId: s.metaInfoId, rows, ...(studyGraphics.has(sid) ? { graphics: studyGraphics.get(sid) } : {}) };
      } catch (e) {
        if (failure) throw failure;
        studyResults[s.id] = { status: 'error', metaInfoId: s.metaInfoId, error: (e as Error).message };
      }
      ws.send(msg('remove_study', [cs, sid]));
      if (opts.studyPauseMs) await new Promise((r) => setTimeout(r, opts.studyPauseMs));
    }

    return {
      chartId: chart.chartId,
      symbol: chart.symbol,
      interval: chart.interval,
      fetchedAt: new Date().toISOString(),
      bars: [...bars.values()].sort((a, b) => a[0] - b[0]),
      studies: studyResults,
    };
  } finally {
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
}

function studyErrorText(p: unknown[]): string {
  const info = p.find((x) => typeof x === 'object' && x !== null && 'error' in (x as object)) as { error?: string; ctx?: { code?: string } } | undefined;
  if (info?.ctx?.code === 'study_limit_exceeded') return 'Your TradingView plan does not allow more indicators on one chart.';
  return info?.error ?? `TradingView could not calculate this indicator (${JSON.stringify(p.slice(2)).slice(0, 200)}).`;
}
