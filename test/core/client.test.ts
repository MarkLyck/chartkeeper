import { beforeEach, describe, expect, it } from 'vitest';
import { layoutSlots, parseBucket, parseLayoutJson, parseLayoutList, parseListEntry, TvClient } from '../../src/core/tv/client';
import type { HttpRequest, HttpResponse } from '../../src/core/tv/http';
import { PoliteHttp } from '../../src/core/tv/http';
import { FakeTradingView } from '../fakes/fakeTradingView';
import { saveForm } from '../../src/core/restore';
import { referenceInAccount, referenceRecord } from '../fakes/fixtures';

const fast = { minIntervalMs: 0, jitterMs: 0, sleep: async () => {} };
let tv: FakeTradingView;
const client = () => new TvClient(new PoliteHttp(tv, fast), tv.account!);
const answer = (status: number, body: string, contentType = 'application/json'): HttpResponse => ({ status, contentType, body });
const failWhen = (match: (req: HttpRequest) => boolean, res: HttpResponse) => (tv.failOn = (req) => (match(req) ? res : null));
const entry = parseListEntry({ image_url: 'Ab12', name: 'My layout' });
const form = saveForm(referenceRecord(), { buckets: {}, reportedTotal: null }, 'x');

beforeEach(() => {
  tv = new FakeTradingView().add(referenceInAccount('Ab12', 'My layout'));
});

describe('turning TradingView error answers into something the user can act on', () => {
  it.each([
    [0, 'not-signed-in'],
    [401, 'not-signed-in'],
    [403, 'not-signed-in'],
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'server'],
  ])('HTTP %i on the layout list is "%s"', async (status, kind) => {
    failWhen((r) => r.url.endsWith('/my-charts/'), answer(status, '{}'));
    await expect(client().listLayouts()).rejects.toMatchObject({ kind });
  });

  it('says a layout is too large when the save is refused with 413', async () => {
    failWhen((r) => r.method === 'POST', answer(413, ''));
    await expect(client().createLayout(form)).rejects.toMatchObject({ kind: 'too-large' });
  });

  it('says the plan is full when the save is refused for the layout limit', async () => {
    tv.layoutLimit = 1;
    await expect(client().createLayout(form)).rejects.toMatchObject({ kind: 'limit-reached' });
    expect(tv.layouts.size).toBe(1);
  });

  it('treats a plain 403 on save as an expired sign-in, not a full plan', async () => {
    failWhen((r) => r.method === 'POST', answer(403, '{"code":"login_required"}'));
    await expect(client().createLayout(form)).rejects.toMatchObject({ kind: 'not-signed-in' });
  });

  it('reports a web page where JSON was expected as a TradingView change', async () => {
    failWhen((r) => r.url.endsWith('/my-charts/'), answer(200, '<html>maintenance</html>', 'text/html'));
    await expect(client().listLayouts()).rejects.toMatchObject({ kind: 'format-changed', detail: expect.stringContaining('text/html') });
  });

  it('does not ask for a drawing token without a signed-in user id', async () => {
    const c = new TvClient(new PoliteHttp(tv, fast), { ...tv.account!, id: null });
    await expect(c.chartToken('Ab12')).rejects.toMatchObject({ kind: 'not-signed-in' });
    expect(tv.requests).toEqual([]);
  });
});

describe('the layout list', () => {
  it('accepts a list wrapped in "results"', () => {
    expect(parseLayoutList({ results: [{ image_url: 'A1', name: 'One' }] }).map((e) => e.uid)).toEqual(['A1']);
  });

  it('rejects anything that is not a list', () => {
    expect(() => parseLayoutList({ layouts: [] })).toThrow(/does not recognise/);
  });

  it('reads the other known spellings of an entry', () => {
    expect(parseListEntry({ uid: 'U1', title: 'Titled', last_modified: 5 })).toMatchObject({ uid: 'U1', url: 'U1', name: 'Titled', lastModified: 5, id: null });
    expect(parseListEntry({ image_url: 'U2' })).toMatchObject({ name: '(no name)', lastModified: null });
  });
});

describe('a layout as TradingView sends it', () => {
  const content = (c: unknown) => ({ content: JSON.stringify(c), name: 'My layout' });

  it.each(['', 'null', 'undefined'])('reports content %j as an empty answer, not as an empty layout', (c) => {
    expect(() => parseLayoutJson({ content: c }, entry)).toThrow(/came back empty/);
  });

  it('reports content that is not JSON', () => {
    expect(() => parseLayoutJson({ content: '{"charts":' }, entry)).toThrow(/is not valid JSON/);
  });

  it('reports content without charts', () => {
    expect(() => parseLayoutJson(content({ panes: [] }), entry)).toThrow(/has no charts/);
  });

  it('reports a chart without panes, saying where, instead of saving a backup that cannot be opened', () => {
    expect(() => parseLayoutJson(content({ charts: [{ chartId: 1 }] }), entry)).toThrow(expect.objectContaining({ kind: 'format-changed', detail: expect.stringContaining('panes') }));
  });

  it('merges indicator definitions kept inside the content with the separate map, and keeps them out of the content', () => {
    const r = parseLayoutJson(
      { ...content({ charts: [], studyMetaInfoMap: { 'Old@x': { id: 'inline' }, 'Both@x': { id: 'inline' } } }), content_study_meta: JSON.stringify({ 'Both@x': { id: 'separate' } }) },
      entry,
    );
    expect(r.studyMetaInfoMap).toEqual({ 'Old@x': { id: 'inline' }, 'Both@x': { id: 'separate' } });
    expect(r.content).toEqual({ charts: [] });
  });

  it('falls back to the list entry for fields the layout answer leaves out', () => {
    const e = parseListEntry({ image_url: 'Ab12', id: 9, name: 'Listed', modified: 77 });
    expect(parseLayoutJson({ content: JSON.stringify({ charts: [] }) }, e)).toMatchObject({ uid: 'Ab12', id: 9, name: 'Listed', lastModified: 77, description: '' });
  });
});

describe('drawing storage answers', () => {
  it('drops drawings the storage reports as deleted (null)', () => {
    expect(parseBucket({ success: true, payload: { sources: { a: { id: 'a' }, b: null } } }, 'x')).toEqual({ sources: { a: { id: 'a' } }, drawing_groups: {} });
  });

  it('reads an empty payload as no drawings', () => {
    expect(parseBucket({ success: true, payload: null }, 'x')).toEqual({ sources: {}, drawing_groups: {} });
  });

  it('reads a count answer without a payload as "no count", so completeness is not checked against zero', async () => {
    failWhen((r) => r.url.includes('/sizes'), answer(200, '{"success":true,"payload":null}'));
    expect(await client().drawingSizes('Ab12', 'jwt.Ab12.signature')).toEqual({ total: null, chartIds: [] });
  });
});

describe('free layout slots', () => {
  it('accepts a bare number as the count', () => {
    expect(layoutSlots(1, 0, 'free')).toMatchObject({ used: 1, free: false });
  });

  it('counts the list when the count answer has no number', () => {
    expect(layoutSlots({}, 5, 'essential')).toMatchObject({ used: 5, limit: 5, free: false });
    expect(layoutSlots({}, 4, 'essential')).toMatchObject({ used: 4, free: true });
  });

  it('asks TradingView for the count', async () => {
    tv.account = { ...tv.account!, plan: 'free' };
    expect(await client().slots(0)).toEqual({ used: 1, limit: 1, plan: 'free', free: false });
  });
});

describe('templates and themes', () => {
  it('stops on an indicator template without an id instead of skipping it', async () => {
    failWhen((r) => r.url.endsWith('/api/v1/study-templates'), answer(200, JSON.stringify({ custom: [{ name: 'No id' }] })));
    await expect(client().studyTemplates()).rejects.toMatchObject({ kind: 'format-changed' });
  });

  it('keeps the list fields of each indicator template next to its content', async () => {
    expect(await client().studyTemplates()).toEqual([{ id: 7, name: 'My RSI setup', content: { panes: [] }, meta_info: { indicators: [{ id: 'RSI', description: 'RSI' }] } }]);
  });

  it('reads an account without themes as no themes', async () => {
    failWhen((r) => r.url.endsWith('/themes/'), answer(200, '{"content":""}'));
    expect(await client().themes()).toEqual({});
    expect(tv.requests.filter((r) => r.url.includes('/theme/'))).toEqual([]);
  });
});

describe('adding templates and themes, which TradingView saves by name', () => {
  const writes = () => tv.requests.filter((r) => r.method !== 'GET');

  it('leaves a drawing template alone when the tool has one by that name, whatever its case and spacing', async () => {
    const before = structuredClone(tv.drawingTemplates);
    expect(await client().addDrawingTemplate('LineToolTrendLine', ' thick  ORANGE ', { linecolor: '#000' })).toBe('exists');
    expect(writes()).toEqual([]);
    expect(tv.drawingTemplates).toEqual(before);
    expect(await client().addDrawingTemplate('LineToolRay', 'Thick orange', { linecolor: '#000' })).toBe('added');
    expect(tv.drawingTemplates.LineToolRay).toEqual({ 'Thick orange': { linecolor: '#000' } });
  });

  it('leaves an indicator template alone when one has that name', async () => {
    const before = structuredClone(tv.studyTemplates);
    expect(await client().addStudyTemplate({ name: 'my rsi setup', content: { panes: [1] }, meta_info: {} })).toBe('exists');
    expect(writes()).toEqual([]);
    expect(tv.studyTemplates).toEqual(before);
    expect(await client().addStudyTemplate({ name: 'My MACD', content: { panes: [] }, meta_info: {} })).toBe('added');
    expect(tv.studyTemplates.map((t) => t.name)).toEqual(['My RSI setup', 'My MACD']);
  });

  it('leaves a theme alone when one has that name, and adds one to an account without themes', async () => {
    expect(await client().addTheme('MY DARK', { 'paneProperties.background': '#fff' })).toBe('exists');
    expect(writes()).toEqual([]);
    expect(tv.themes).toEqual({ 'My dark': { content: { 'paneProperties.background': '#000' } } });
    failWhen((r) => r.method === 'GET' && r.url.endsWith('/themes/'), answer(200, '{"content":""}'));
    expect(await client().addTheme('My dark', { a: 1 })).toBe('added');
  });

  it('reads only the list of indicator template names before adding one, not every template', async () => {
    await client().addStudyTemplate({ name: 'My MACD', content: {}, meta_info: {} });
    expect(tv.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(['GET /api/v1/study-templates', 'POST /api/v1/study-templates']);
  });
});
