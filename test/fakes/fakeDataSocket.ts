import { decodeFrames, encodeFrame, type SocketFactory, type SocketLike } from '../../src/core/tv/datafeed';

export interface FakeDataOptions {
  bars?: number;
  /** create_study ids (2nd param of create_study's 5th arg) that answer with study_error */
  failStudies?: (createId: string, inputs: Record<string, unknown>) => string | null;
  unknownSymbols?: string[];
}

/** Speaks the websocket protocol from docs/INVESTIGATION.md, enough for fetchChartData. */
export function fakeDataSocket(opts: FakeDataOptions = {}): { factory: SocketFactory; sent: { m: string; p: unknown[] }[] } {
  const sent: { m: string; p: unknown[] }[] = [];
  const factory: SocketFactory = () => {
    const out = (m: string, p: unknown[]) => setTimeout(() => sock.onmessage?.({ data: encodeFrame(JSON.stringify({ m, p })) }), 0);
    const sock: SocketLike = {
      onmessage: null,
      onerror: null,
      onclose: null,
      onopen: null,
      close() {},
      send(data: string) {
        for (const f of decodeFrames(data)) {
          if (f.startsWith('~h~')) continue;
          const msg = JSON.parse(f) as { m: string; p: unknown[] };
          sent.push(msg);
          const [cs] = msg.p as string[];
          if (msg.m === 'resolve_symbol') {
            const spec = JSON.parse(String(msg.p[2]).slice(1)) as { symbol: string };
            if (opts.unknownSymbols?.includes(spec.symbol)) out('symbol_error', [cs, msg.p[1], 'invalid symbol']);
            else out('symbol_resolved', [cs, msg.p[1], { name: spec.symbol }]);
          }
          if (msg.m === 'create_series') {
            const n = opts.bars ?? 50;
            const s = Array.from({ length: n }, (_, i) => ({ i, v: [1780000000 + i * 86400, 100 + i, 101 + i, 99 + i, 100.5 + i, 1000 * i] }));
            out('timescale_update', [cs, { sds_1: { s } }]);
            out('series_completed', [cs, 'sds_1', 'streaming', 's1']);
          }
          if (msg.m === 'create_study') {
            const [, sid, , , createId, inputs] = msg.p as [string, string, string, string, string, Record<string, unknown>];
            const err = opts.failStudies?.(createId, inputs);
            if (err) out('study_error', [cs, sid, 's1_st1', { ctx: { code: err }, error: err }]);
            else {
              const st = Array.from({ length: opts.bars ?? 50 }, (_, i) => ({ i, v: [1780000000 + i * 86400, 50 + i / 10, 1e100] }));
              out('du', [cs, { [sid]: { st } }]);
              out('study_completed', [cs, sid, 's1_st1']);
            }
          }
        }
      },
    };
    setTimeout(() => sock.onmessage?.({ data: encodeFrame(JSON.stringify({ session_id: 'fake', timestamp: 1 })) }), 0);
    return sock;
  };
  return { factory, sent };
}
