import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLayout } from '../../src/core/layout';
import { decodeFrames, encodeFrame, fetchChartData, studyRequest } from '../../src/core/tv/datafeed';
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
