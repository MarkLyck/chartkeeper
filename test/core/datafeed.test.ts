import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDrawing, parseLayout, type ParsedChart, type ParsedDrawing } from '../../src/core/layout';
import type { TvSource } from '../../src/core/tv/content';
import { decodeFrames, drawingStudyRequest, encodeFrame, fetchChartData, studyRequest, type SocketFactory, type SocketLike } from '../../src/core/tv/datafeed';
import { parseLayoutJson, parseListEntry } from '../../src/core/tv/client';
import { fakeDataSocket } from '../fakes/fakeDataSocket';
import { FIXTURES } from '../fakes/fixtures';

const tvSaved = JSON.parse(readFileSync(path.join(FIXTURES, 'tv-saved-layout.json'), 'utf8'));
const layout = parseLayout(parseLayoutJson({ content: tvSaved.content, content_study_meta: tvSaved.study_meta_info_map }, parseListEntry({ image_url: 'X' })), null);
const studies = layout.charts[0]!.panes.flatMap((p) => p.studies);

describe('websocket frames', () => {
  it('splits several frames in one message, including multi-byte text', () => {
    const a = JSON.stringify({ m: 'x', p: ['café ✓'] });
    expect(decodeFrames(encodeFrame(a) + encodeFrame('~h~3'))).toEqual([a, '~h~3']);
  });
});

describe('create_study requests', () => {
  it('sends built-in studies with their stored inputs', () => {
    const vol = studies.find((s) => s.metaInfoId.startsWith('Volume'))!;
    expect(studyRequest(vol)).toEqual({ id: vol.id, createId: 'Volume@tv-basicstudies-280', inputs: { col_prev_close: false, length: 20 } });
  });

  it('sends Pine studies exactly like the chart page does (frame captured 2026-10-17)', () => {
    const rsi = studies.find((s) => s.metaInfoId.startsWith('Script$STD;RSI'))!;
    const req = studyRequest(rsi);
    const text = (rsi.metaInfo!.inputs as { id: string; defval: unknown }[]).find((i) => i.id === 'text')!.defval;
    const captured = {
      text,
      pineId: 'STD;RSI',
      pineVersion: '47.0',
      pineFeatures: { v: '{"indicator":1,"plot":1,"ta":1,"math":1,"alertcondition":1}', f: true, t: 'text' },
      in_0: { v: 14, f: true, t: 'integer' },
      in_1: { v: 'close', f: true, t: 'source' },
      in_2: { v: false, f: true, t: 'bool' },
      in_3: { v: 'SMA', f: true, t: 'text' },
      in_4: { v: 14, f: true, t: 'integer' },
      in_5: { v: 2, f: true, t: 'float' },
      in_6: { v: '', f: true, t: 'resolution' },
      in_7: { v: true, f: true, t: 'bool' },
      __fast_calc: { v: false, f: true, t: 'bool' },
      __profile: { v: false, f: true, t: 'bool' },
    };
    expect(req.createId).toBe('Script@tv-scripting-101!');
    expect(JSON.stringify(req.inputs)).toBe(JSON.stringify(captured));
  });

  it('refuses a Pine study whose compiled script is missing, instead of sending a broken request', () => {
    const rsi = studies.find((s) => s.metaInfoId.startsWith('Script$STD;RSI'))!;
    const broken = { ...rsi, metaInfo: { ...rsi.metaInfo!, inputs: [] } };
    expect(() => studyRequest(broken)).toThrow(/compiled script/);
  });
});

describe('fetching prices and indicator values', () => {
  it('collects bars and per-study values, turning "no value" markers into null', async () => {
    const { factory, sent } = fakeDataSocket({ bars: 20 });
    const data = await fetchChartData(layout.charts[0]!, studies, factory, { authToken: 'tok', bars: 20 });
    expect(data.bars).toHaveLength(20);
    expect(data.bars[0]).toEqual([1780000000, 100, 101, 99, 100.5, 0]);
    for (const s of studies) expect(data.studies[s.id]).toMatchObject({ status: 'ok' });
    const ok = Object.values(data.studies)[0]!;
    expect(ok.status === 'ok' && ok.rows[0]).toEqual([1780000000, 50, null]);
    expect(sent.find((m) => m.m === 'set_auth_token')!.p).toEqual(['tok']);
    expect(sent.filter((m) => m.m === 'remove_study')).toHaveLength(studies.length);
  });

  it('adds indicators one at a time so the plan limit is not hit', async () => {
    const { factory, sent } = fakeDataSocket();
    await fetchChartData(layout.charts[0]!, studies, factory, { authToken: null, bars: 10 });
    const order = sent.filter((m) => m.m === 'create_study' || m.m === 'remove_study').map((m) => m.m);
    expect(order).toEqual(studies.flatMap(() => ['create_study', 'remove_study']));
  });

  it('fails clearly for an unknown symbol', async () => {
    const { factory } = fakeDataSocket({ unknownSymbols: ['NASDAQ:AAPL'] });
    await expect(fetchChartData(layout.charts[0]!, [], factory, { authToken: null, bars: 10 })).rejects.toThrow(/does not know the symbol NASDAQ:AAPL/);
  });
});

describe('broken frames', () => {
  it('keeps the whole frames and stops at a broken one', () => {
    expect(decodeFrames(encodeFrame('a') + 'garbage' + encodeFrame('b'))).toEqual(['a']);
    expect(decodeFrames('~m~5')).toEqual([]);
  });
});

interface Server {
  reply(m: string, p: unknown[]): void;
  raw(data: string): void;
  error(message: string): void;
  close(): void;
}
type Msg = { m: string; p: unknown[] };

/** A data socket whose answers each test writes. `open` is called when the client connects. */
function scriptedSocket(answer: (msg: Msg, server: Server) => void) {
  const frames: string[] = [];
  let closed = 0;
  const factory: SocketFactory = () => {
    const later = (fn: () => void) => setTimeout(fn, 0);
    const sock: SocketLike = {
      onmessage: null,
      onerror: null,
      onclose: null,
      onopen: null,
      close: () => void closed++,
      send(data: string) {
        for (const f of decodeFrames(data)) {
          frames.push(f);
          if (!f.startsWith('~h~')) answer(JSON.parse(f) as Msg, server);
        }
      },
    };
    const server: Server = {
      raw: (data) => later(() => sock.onmessage?.({ data })),
      reply: (m, p) => server.raw(encodeFrame(JSON.stringify({ m, p }))),
      error: (message) => later(() => sock.onerror?.({ message })),
      close: () => later(() => sock.onclose?.({})),
    };
    answer({ m: 'open', p: [] }, server);
    return sock;
  };
  const sent = () => frames.filter((f) => !f.startsWith('~h~')).map((f) => JSON.parse(f) as Msg);
  return { factory, frames, sent, closed: () => closed };
}

const t0 = 1780000000;
/** Answers like TradingView: a hello, the symbol, `bars` daily bars, and one value row per study. */
function normal({ m, p }: Msg, s: Server, bars = 3) {
  const cs = p[0];
  if (m === 'open') s.raw(encodeFrame(JSON.stringify({ session_id: 'x', timestamp: 1 })));
  if (m === 'resolve_symbol') s.reply('symbol_resolved', [cs, p[1], { name: 'AAPL' }]);
  if (m === 'create_series') {
    s.reply('timescale_update', [cs, { sds_1: { s: Array.from({ length: bars }, (_, i) => ({ i, v: [t0 + i * 86400, 1, 2, 0.5, 1.5, 10] })) } }]);
    s.reply('series_completed', [cs, 'sds_1']);
  }
  if (m === 'create_study') {
    s.reply('du', [cs, { [String(p[1])]: { st: [{ i: 0, v: [t0, 42] }] } }]);
    s.reply('study_completed', [cs, p[1]]);
  }
}

const aapl = layout.charts[0]!;
const chartWith = (over: Partial<ParsedChart>): ParsedChart => ({ ...aapl, ...over });
const load = (chart: ParsedChart, factory: SocketFactory, list = studies, timeoutMs?: number) => fetchChartData(chart, list, factory, { authToken: null, bars: 10, ...(timeoutMs ? { timeoutMs } : {}) });
const studyBy = (prefix: string) => studies.find((s) => s.metaInfoId.startsWith(prefix))!;

describe('the price connection', () => {
  it('echoes heartbeats, so TradingView keeps the connection open', async () => {
    const sock = scriptedSocket((msg, s) => {
      if (msg.m === 'chart_create_session') s.raw(encodeFrame('~h~7'));
      normal(msg, s);
    });
    await load(aapl, sock.factory, []);
    expect(sock.frames).toContain('~h~7');
  });

  it('asks for the trading session, currency and time zone the chart uses, with sorted keys like the chart page', async () => {
    const sock = scriptedSocket(normal);
    await load(chartWith({ interval: '60', timezone: 'Europe/Copenhagen', seriesState: { session: 'extended', currencyId: 'EUR' } }), sock.factory, []);
    const sent = sock.sent();
    expect(sent.find((m) => m.m === 'switch_timezone')!.p[1]).toBe('Europe/Copenhagen');
    expect(sent.find((m) => m.m === 'resolve_symbol')!.p[2]).toBe('={"adjustment":"splits","currency-id":"EUR","session":"extended","symbol":"NASDAQ:AAPL"}');
  });

  it('falls back to the older session field and to UTC', async () => {
    const sock = scriptedSocket(normal);
    await load(chartWith({ interval: '5', timezone: '', seriesState: { sessionId: 'extended' } }), sock.factory, []);
    const sent = sock.sent();
    expect(sent.find((m) => m.m === 'switch_timezone')!.p[1]).toBe('Etc/UTC');
    expect(String(sent.find((m) => m.m === 'resolve_symbol')!.p[2])).toContain('"session":"extended"');
  });

  it('sends no session for daily charts or for the regular session, like the chart page (frame captured 2026-10-17)', async () => {
    for (const chart of [chartWith({ interval: 'D', seriesState: { sessionId: 'extended' } }), chartWith({ interval: '60', seriesState: { sessionId: 'regular' } })]) {
      const sock = scriptedSocket(normal);
      await load(chart, sock.factory, []);
      expect(sock.sent().find((m) => m.m === 'resolve_symbol')!.p[2]).toBe('={"adjustment":"splits","symbol":"NASDAQ:AAPL"}');
    }
  });

  it('asks for dividend-adjusted prices when the chart has them on', async () => {
    const sock = scriptedSocket(normal);
    await load(chartWith({ seriesState: { dividendsAdjustment: true } }), sock.factory, []);
    expect(sock.sent().find((m) => m.m === 'resolve_symbol')!.p[2]).toBe('={"adjustment":"dividends","symbol":"NASDAQ:AAPL"}');
  });

  it('merges repeated bar updates by time, sorts them, and skips bars without a time', async () => {
    const sock = scriptedSocket((msg, s) => {
      if (msg.m !== 'create_series') return normal(msg, s);
      const cs = msg.p[0];
      s.reply('timescale_update', [cs, { sds_1: { s: [{ v: [t0 + 86400, 5, 5, 5, 5, 5] }, { v: [t0, 1, 1, 1, 1, 1] }, { v: [1e100, 9, 9, 9, 9, 9] }] } }]);
      s.reply('du', [cs, { sds_1: { s: [{ v: [t0, 2, 3, 1, 2.5, 1e100] }] } }]);
      s.reply('series_completed', [cs, 'sds_1']);
    });
    const data = await load(aapl, sock.factory, []);
    expect(data.bars).toEqual([
      [t0, 2, 3, 1, 2.5, 0],
      [t0 + 86400, 5, 5, 5, 5, 5],
    ]);
  });

  it('closes the connection when it is done', async () => {
    const sock = scriptedSocket(normal);
    await load(aapl, sock.factory, []);
    expect(sock.closed()).toBe(1);
  });

  it('fails the chart when TradingView cannot load its prices, and closes the connection', async () => {
    const sock = scriptedSocket((msg, s) => (msg.m === 'create_series' ? s.reply('series_error', [msg.p[0], 'sds_1', 's1', 'no data']) : normal(msg, s)));
    await expect(load(aapl, sock.factory)).rejects.toThrow(/could not load prices for NASDAQ:AAPL: \["s1","no data"\]/);
    expect(sock.closed()).toBe(1);
  });

  it('stops the whole chart when the connection closes during an indicator, instead of saving it without values', async () => {
    const sock = scriptedSocket((msg, s) => (msg.m === 'create_study' ? s.close() : normal(msg, s)));
    await expect(load(aapl, sock.factory)).rejects.toThrow(/closed the price data connection/);
    expect(sock.sent().filter((m) => m.m === 'create_study')).toHaveLength(1);
  });

  it('stops on a protocol error', async () => {
    const sock = scriptedSocket((msg, s) => (msg.m === 'resolve_symbol' ? s.reply('protocol_error', ['wrong data']) : normal(msg, s)));
    await expect(load(aapl, sock.factory)).rejects.toThrow(/data connection error: \["wrong data"\]/);
  });

  it('reports a connection that fails before it opens', async () => {
    const sock = scriptedSocket((msg, s) => (msg.m === 'open' ? s.error('ECONNREFUSED') : normal(msg, s)));
    await expect(load(aapl, sock.factory)).rejects.toThrow(/Could not connect to TradingView price data: ECONNREFUSED/);
  });

  it('gives up when TradingView does not answer', async () => {
    const sock = scriptedSocket((msg, s) => (msg.m === 'create_series' ? undefined : normal(msg, s)));
    await expect(load(aapl, sock.factory, [], 30)).rejects.toThrow(/did not answer in time \(series\)/);
  });
});

describe('indicator values', () => {
  it('records each refused indicator with a reason and still loads the others', async () => {
    const sock = scriptedSocket((msg, s) => {
      if (msg.m !== 'create_study') return normal(msg, s);
      const [cs, sid, , , createId] = msg.p as string[];
      if (createId!.startsWith('Volume')) s.reply('study_error', [cs, sid, 'st1', { ctx: { code: 'study_limit_exceeded' }, error: 'limit' }]);
      else if (msg.p[5] && (msg.p[5] as { pineId?: string }).pineId === 'STD;RSI') s.reply('study_error', [cs, sid, 'st1', { error: 'Script could not be compiled' }]);
      else normal(msg, s);
    });
    const data = await load(aapl, sock.factory);
    const vol = studyBy('Volume');
    const rsi = studyBy('Script$STD;RSI');
    const bb = studyBy('Script$STD;Bollinger');
    expect(data.studies[vol.id]).toEqual({ status: 'error', metaInfoId: vol.metaInfoId, error: 'Your TradingView plan does not allow more indicators on one chart.' });
    expect(data.studies[rsi.id]).toEqual({ status: 'error', metaInfoId: rsi.metaInfoId, error: 'Script could not be compiled' });
    expect(data.studies[bb.id]).toEqual({ status: 'ok', metaInfoId: bb.metaInfoId, rows: [[t0, 42]] });
  });

  it('describes a refusal without a message from what TradingView sent', async () => {
    const sock = scriptedSocket((msg, s) => (msg.m === 'create_study' ? s.reply('study_error', [msg.p[0], msg.p[1], 'bad input']) : normal(msg, s)));
    const vol = studyBy('Volume');
    const data = await load(aapl, sock.factory, [vol]);
    expect(data.studies[vol.id]).toMatchObject({ status: 'error', error: 'TradingView could not calculate this indicator (["bad input"]).' });
  });

  it('records a Pine indicator without its compiled script as an error without asking TradingView for it', async () => {
    const rsi = studyBy('Script$STD;RSI');
    const broken = { ...rsi, metaInfo: { ...rsi.metaInfo!, inputs: [] } };
    const sock = scriptedSocket(normal);
    const data = await load(aapl, sock.factory, [broken, studyBy('Volume')]);
    expect(data.studies[rsi.id]).toMatchObject({ status: 'error', error: expect.stringMatching(/compiled script/) });
    expect(data.studies[studyBy('Volume').id]).toMatchObject({ status: 'ok' });
    expect(sock.sent().filter((m) => m.m === 'create_study')).toHaveLength(1);
  });

  it('keeps the graphics a Pine script draws, and sorts its rows by time', async () => {
    const sock = scriptedSocket((msg, s) => {
      if (msg.m !== 'create_study') return normal(msg, s);
      const [cs, sid] = msg.p as string[];
      s.reply('du', [cs, { [sid!]: { st: [{ v: [t0 + 86400, 2] }, { v: [t0, 1] }, { v: [1e100, 3] }], ns: { d: '{"labels":[1]}' } } }]);
      s.reply('study_completed', [cs, sid]);
    });
    const bb = studyBy('Script$STD;Bollinger');
    const data = await load(aapl, sock.factory, [bb]);
    expect(data.studies[bb.id]).toEqual({ status: 'ok', metaInfoId: bb.metaInfoId, rows: [[t0, 1], [t0 + 86400, 2]], graphics: { d: '{"labels":[1]}' } });
  });
});

const tvFrames = JSON.parse(readFileSync(path.join(FIXTURES, 'tv-computed-style-frames.json'), 'utf8')) as { computedStyleFrames: Record<string, string[]>; studyDrawings: TvSource[] };
const STYLE_STATE_KEYS: Record<string, string> = { 4: 'renkoStyle', 5: 'kagiStyle', 6: 'pnfStyle', 7: 'pbStyle', 8: 'haStyle', 11: 'rangeStyle' };
/** What the chart page sent for a computed style: the symbol it resolved and the interval it asked for. */
const capturedStyle = (style: string) => {
  const [resolve, modify] = tvFrames.computedStyleFrames[style]!.map((f) => JSON.parse(f) as Msg);
  const symbol = String(resolve!.p[2]);
  return { symbol, interval: String(modify!.p[4]), inputs: (JSON.parse(symbol.slice(1)) as { inputs: Record<string, unknown> }).inputs };
};
/** The chart TradingView had on screen: AAPL in USD, regular session, the style's inputs in a different key order than sent. */
const computedChart = (style: string): ParsedChart => {
  const { interval, inputs } = capturedStyle(style);
  const shuffled = Object.fromEntries(Object.entries(inputs).reverse());
  return chartWith({ style: Number(style), interval, seriesState: { style: Number(style), sessionId: 'regular', currencyId: 'USD', [STYLE_STATE_KEYS[style]!]: { inputs: shuffled } } });
};

describe('charts in computed styles', () => {
  it.each(Object.keys(tvFrames.computedStyleFrames))('style %s resolves the computed series exactly like the chart page (frames captured 2026-10-17)', async (style) => {
    const sock = scriptedSocket(normal);
    const data = await load(computedChart(style), sock.factory, []);
    const sent = sock.sent();
    const captured = capturedStyle(style);
    expect(sent.find((m) => m.m === 'resolve_symbol')!.p[2]).toBe(captured.symbol);
    expect(sent.find((m) => m.m === 'create_series')!.p.slice(3, 5)).toEqual(['sds_sym_1', captured.interval]);
    expect(data.computedStyle).toBe(Number(style));
    expect(data.bars).toHaveLength(3);
  });

  it('sends an empty input set when the layout has none for the style', async () => {
    const sock = scriptedSocket(normal);
    await load(chartWith({ style: 8, seriesState: { currencyId: 'USD' } }), sock.factory, []);
    expect(sock.sent().find((m) => m.m === 'resolve_symbol')!.p[2]).toBe(capturedStyle('8').symbol);
  });

  it('calculates indicators on the computed series, as the chart page does', async () => {
    const sock = scriptedSocket(normal);
    await load(computedChart('4'), sock.factory, [studyBy('Volume')]);
    expect(sock.sent().find((m) => m.m === 'create_study')!.p[3]).toBe('sds_1');
  });

  it.each([0, 1, 2, 3, 9, 10, 12])('leaves plain style %s unchanged', async (style) => {
    const sock = scriptedSocket(normal);
    const data = await load(chartWith({ style, seriesState: { style, currencyId: 'USD', renkoStyle: { inputs: { boxSize: 3 } } } }), sock.factory, []);
    expect(sock.sent().find((m) => m.m === 'resolve_symbol')!.p[2]).toBe('={"adjustment":"splits","currency-id":"USD","symbol":"NASDAQ:AAPL"}');
    expect(data).not.toHaveProperty('computedStyle');
  });
});

const savedDrawing = (type: string) => parseDrawing(tvFrames.studyDrawings.find((s) => s.type === type)!, 'content');
const avwap = savedDrawing('LineToolAnchoredVWAP');
const frvp = savedDrawing('LineToolFixedRangeVolumeProfile');
const withDrawings = (drawings: ParsedDrawing[]): ParsedChart => ({ ...aapl, panes: aapl.panes.map((p, i) => (i === 0 ? { ...p, drawings: [...p.drawings, ...drawings] } : p)) });

describe('study-backed drawings', () => {
  it('asks for Anchored VWAP from its anchor bar, in milliseconds, with the saved inputs', () => {
    expect(drawingStudyRequest(avwap, t0)).toEqual({
      id: avwap.id,
      createId: 'AnchoredVWAP@tv-basicstudies-280',
      inputs: {
        'Bands Calculation Mode': 'Standard Deviation',
        bands_multiplier: 1,
        bands_multiplier_2: 2,
        bands_multiplier_3: 3,
        calculate_stDev: true,
        calculate_stDev_2: false,
        calculate_stDev_3: false,
        source: 'hlc3',
        start_time: avwap.points[0]!.time * 1000,
      },
    });
  });

  it('asks for a Fixed Range Volume Profile between its two anchors, live only when the range reaches the last bar', () => {
    const [from, to] = frvp.points.map((p) => p.time * 1000);
    const req = drawingStudyRequest(frvp, frvp.points[1]!.time + 86400);
    expect(req.createId).toBe('VbPFixed@tv-basicstudies-280');
    expect(req.inputs).toEqual({ extendToRight: false, rows: 24, rowsLayout: 'Number Of Rows', vaVolume: 70, volume: 'Up/Down', subscribeRealtime: false, mapRightBoundaryToBarStartTime: true, first_bar_time: from, last_bar_time: to });
    expect(drawingStudyRequest(frvp, frvp.points[1]!.time).inputs.subscribeRealtime).toBe(true);
    const reversed = { ...frvp, points: [...frvp.points].reverse() };
    expect(drawingStudyRequest(reversed, 0).inputs).toMatchObject({ first_bar_time: from, last_bar_time: to });
  });

  it('refuses a drawing without the anchors TradingView needs', () => {
    expect(() => drawingStudyRequest({ ...frvp, points: frvp.points.slice(0, 1) }, t0)).toThrow(/1 anchor points; TradingView needs 2/);
  });

  it('stores the values TradingView computes for each drawing, one study at a time, keyed by drawing id', async () => {
    const sock = scriptedSocket((msg, s) => {
      if (msg.m !== 'create_study' || !String(msg.p[4]).startsWith('VbPFixed')) return normal(msg, s);
      const [cs, sid] = msg.p as string[];
      s.reply('du', [cs, { [sid!]: { st: [], ns: { d: '{"graphicsCmds":{"create":{"hhists":[]}}}', indexes: [] } } }]);
      s.reply('study_completed', [cs, sid]);
    });
    const otherSymbol = { ...avwap, id: 'elsewhere', symbol: 'NASDAQ:MSFT' };
    const data = await load(withDrawings([avwap, frvp, otherSymbol]), sock.factory, [studyBy('Volume')]);
    const creates = sock.sent().filter((m) => m.m === 'create_study');
    expect(creates.map((m) => m.p[4])).toEqual(['Volume@tv-basicstudies-280', 'AnchoredVWAP@tv-basicstudies-280', 'VbPFixed@tv-basicstudies-280']);
    expect(creates.every((m) => m.p[3] === 'sds_1')).toBe(true);
    expect(sock.sent().filter((m) => m.m === 'remove_study')).toHaveLength(3);
    expect(data.drawingStudies).toEqual({
      [avwap.id]: { status: 'ok', metaInfoId: 'AnchoredVWAP@tv-basicstudies-280', rows: [[t0, 42]] },
      [frvp.id]: { status: 'ok', metaInfoId: 'VbPFixed@tv-basicstudies-280', rows: [], graphics: { d: '{"graphicsCmds":{"create":{"hhists":[]}}}', indexes: [] } },
    });
    expect(Object.keys(data.studies)).toEqual([studyBy('Volume').id]);
  });

  it('records a drawing TradingView refuses as an error, and adds nothing for charts without such drawings', async () => {
    const sock = scriptedSocket((msg, s) => (msg.m === 'create_study' ? s.reply('study_error', [msg.p[0], msg.p[1], 'st1', { error: 'study_not_auth:AnchoredVWAP@tv-basicstudies-280' }]) : normal(msg, s)));
    const data = await load(withDrawings([avwap]), sock.factory, []);
    expect(data.drawingStudies).toEqual({ [avwap.id]: { status: 'error', metaInfoId: 'AnchoredVWAP@tv-basicstudies-280', error: 'study_not_auth:AnchoredVWAP@tv-basicstudies-280' } });
    const plain = await load(aapl, scriptedSocket(normal).factory, []);
    expect(plain).not.toHaveProperty('drawingStudies');
  });
});
