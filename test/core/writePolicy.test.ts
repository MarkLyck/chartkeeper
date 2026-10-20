import { describe, expect, it } from 'vitest';
import { saveForm } from '../../src/core/restore';
import { CHART_STORAGE, ORIGIN, urls } from '../../src/core/tv/endpoints';
import type { HttpRequest } from '../../src/core/tv/http';
import { rawWriteRefusal, uploadFieldNames, writeRefusal, type UploadPart } from '../../src/core/tv/writePolicy';
import { referenceRecord } from '../fakes/fixtures';

const layoutForm = (): Record<string, string> => saveForm(referenceRecord(), { buckets: {}, reportedTotal: null }, 'Copy');
const studyTemplate = { name: 'RSI', content: { panes: [] }, meta_info: { indicators: [] } };
const creates: [string, HttpRequest][] = [
  ['create a layout', { method: 'POST', url: urls.saveLayout, form: layoutForm() }],
  ['add an indicator template', { method: 'POST', url: urls.studyTemplates, json: studyTemplate }],
  ['add a drawing template', { method: 'POST', url: urls.saveDrawingTemplate, form: { name: 'Thick', tool: 'LineToolTrendLine', content: '{}' } }],
  ['add a theme', { method: 'POST', url: urls.saveTheme, form: { name: 'Dark', content: '{}' } }],
];
/** A request no code path may build any more: the type no longer allows PUT. */
const asIfBuilt = (req: { method: string; url: string; json?: unknown; form?: Record<string, string> }) => req as HttpRequest;

describe('the only writes ChartKeeper may send create something new', () => {
  it.each(creates)('allows the request to %s', (_what, req) => expect(writeRefusal(req)).toBeNull());

  it('allows every read', () => {
    expect(writeRefusal({ method: 'GET', url: urls.myCharts })).toBeNull();
    expect(writeRefusal({ method: 'GET', url: urls.layoutSources('Ab12', '1', 'jwt') })).toBeNull();
  });

  it.each([
    ['a layout save that names the layout to overwrite', { method: 'POST', url: urls.saveLayout, form: { ...layoutForm(), image_url: 'Ab12' } }, /"image_url"/],
    ['a layout save that names a layout by number', { method: 'POST', url: urls.saveLayout, form: { ...layoutForm(), id: '501' } }, /"id"/],
    ['a layout save with a field ChartKeeper never sends', { method: 'POST', url: urls.saveLayout, form: { ...layoutForm(), is_private: '0' } }, /"is_private"/],
    ['deleting a layout', { method: 'POST', url: `${ORIGIN}/api/v1/charts/delete/`, json: { uid: ['Ab12'] } }, /not one of the addresses/],
    ['writing drawings to the drawing storage', { method: 'PUT', url: `${CHART_STORAGE}/layout/Ab12/sources?chart_id=1&layout_id=Ab12&jwt=t`, json: { sources: { a: null } } }, /PUT requests/],
    ['a DELETE', { method: 'DELETE', url: urls.studyTemplate(7) }, /DELETE requests/],
    ['a PATCH', { method: 'PATCH', url: urls.studyTemplate(7), json: { name: 'x' } }, /PATCH requests/],
    ['a POST to an address that is not a create', { method: 'POST', url: `${ORIGIN}/api/v1/charts/rename/`, form: { name: 'x' } }, /not one of the addresses/],
    ['a create address with a query string', { method: 'POST', url: `${urls.saveLayout}?image_url=Ab12`, form: layoutForm() }, /not one of the addresses/],
    ['a create address on another TradingView host', { method: 'POST', url: urls.saveLayout.replace('www.', ''), form: layoutForm() }, /not one of the addresses/],
    ['an indicator template that names the one to overwrite', { method: 'POST', url: urls.studyTemplates, json: { ...studyTemplate, id: 7 } }, /"id"/],
    ['a drawing template with an extra field', { method: 'POST', url: urls.saveDrawingTemplate, form: { name: 'Thick', tool: 'LineToolTrendLine', content: '{}', overwrite: '1' } }, /"overwrite"/],
    ['a theme with an extra field', { method: 'POST', url: urls.saveTheme, form: { name: 'Dark', content: '{}', id: '3' } }, /"id"/],
    ['a form where JSON belongs', { method: 'POST', url: urls.studyTemplates, form: { name: 'RSI' } }, /could not be read as JSON/],
    ['JSON where a form belongs', { method: 'POST', url: urls.saveTheme, json: { name: 'Dark' } }, /could not be read as form fields/],
    ['a JSON list instead of an object', { method: 'POST', url: urls.studyTemplates, json: [studyTemplate] }, /could not be read/],
  ])('refuses %s', (_what, req, reason) => expect(writeRefusal(asIfBuilt(req))).toMatch(reason));
});

const bytes = (s: string): UploadPart[] => [{ bytes: new TextEncoder().encode(s) }];

async function multipart(fields: Record<string, string | Blob>): Promise<UploadPart[]> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return [{ bytes: new Uint8Array(await new Request('https://www.tradingview.com/', { method: 'POST', body: fd }).arrayBuffer()) }];
}

describe('the same check on the raw requests of the TradingView browser session', () => {
  it('reads the field names of a form exactly as Chromium sent it from fetch() in the hidden page (captured with Electron 44)', () => {
    const sent = '------WebKitFormBoundaryk0eKcOhwqTC9PCOb\r\nContent-Disposition: form-data; name="name"\r\n\r\nx\r\n------WebKitFormBoundaryk0eKcOhwqTC9PCOb\r\nContent-Disposition: form-data; name="image_url"\r\n\r\nAbc\r\n------WebKitFormBoundaryk0eKcOhwqTC9PCOb\r\nContent-Disposition: form-data; name="content"\r\n\r\n{"a":1}\r\n------WebKitFormBoundaryk0eKcOhwqTC9PCOb--\r\n';
    expect(uploadFieldNames('form', bytes(sent))).toEqual(['name', 'image_url', 'content']);
    expect(rawWriteRefusal('POST', urls.saveLayout, bytes(sent))).toMatch(/"image_url"/);
  });

  it('allows a layout save with exactly the fields ChartKeeper sends', async () => {
    expect(rawWriteRefusal('POST', urls.saveLayout, await multipart(layoutForm()))).toBeNull();
  });

  it('refuses a layout save that names the layout to overwrite, however the body is split', async () => {
    const [whole] = await multipart({ ...layoutForm(), image_url: 'Ab12' });
    const b = whole!.bytes!;
    const split = [{ bytes: b.slice(0, 100) }, { bytes: b.slice(100, 101) }, { bytes: b.slice(101) }];
    expect(rawWriteRefusal('POST', urls.saveLayout, split)).toMatch(/"image_url"/);
  });

  it('allows the template and theme creates and refuses them with an extra field', async () => {
    expect(rawWriteRefusal('POST', urls.saveDrawingTemplate, await multipart({ name: 'Thick', tool: 'LineToolTrendLine', content: '{}' }))).toBeNull();
    expect(rawWriteRefusal('POST', urls.saveTheme, await multipart({ name: 'Dark', content: '{}' }))).toBeNull();
    expect(rawWriteRefusal('POST', urls.studyTemplates, bytes(JSON.stringify(studyTemplate)))).toBeNull();
    expect(rawWriteRefusal('POST', urls.saveTheme, await multipart({ name: 'Dark', content: '{}', id: '3' }))).toMatch(/"id"/);
    expect(rawWriteRefusal('POST', urls.studyTemplates, bytes(JSON.stringify({ ...studyTemplate, id: 7 })))).toMatch(/"id"/);
  });

  it('refuses a body with a part that is not plain bytes, as Chromium hands over a Blob or a file', async () => {
    const [whole] = await multipart({ name: 'Dark', content: '{}' });
    const b = whole!.bytes!;
    expect(rawWriteRefusal('POST', urls.saveTheme, [{ bytes: b.slice(0, 60) }, {}, { bytes: b.slice(60) }])).toMatch(/could not be read/);
  });

  it('refuses a form field sent as a file', async () => {
    expect(rawWriteRefusal('POST', urls.saveTheme, await multipart({ name: 'Dark', content: new Blob(['{}']) }))).toMatch(/could not be read/);
  });

  it('refuses a write it cannot read', () => {
    expect(rawWriteRefusal('POST', urls.saveTheme, undefined)).toMatch(/could not be read/);
    expect(rawWriteRefusal('POST', urls.saveTheme, [])).toMatch(/could not be read/);
    expect(rawWriteRefusal('POST', urls.saveTheme, bytes('name=Dark&content=%7B%7D'))).toMatch(/could not be read/);
    expect(rawWriteRefusal('POST', urls.studyTemplates, bytes('{"name":'))).toMatch(/could not be read/);
    expect(rawWriteRefusal('POST', urls.studyTemplates, [{ bytes: new Uint8Array([0x7b, 0xff, 0x7d]) }])).toMatch(/could not be read/);
  });

  it('refuses every method that changes or deletes, and every other address, whatever the body', async () => {
    const body = await multipart(layoutForm());
    for (const method of ['PUT', 'DELETE', 'PATCH']) expect(rawWriteRefusal(method, urls.saveLayout, body)).toMatch(/requests change or delete/);
    expect(rawWriteRefusal('POST', `${ORIGIN}/api/v1/charts/delete/`, bytes('{"uid":["Ab12"]}'))).toMatch(/not one of the addresses/);
    expect(rawWriteRefusal('POST', `${urls.saveLayout}?image_url=Ab12`, body)).toMatch(/not one of the addresses/);
  });

  it('lets reads through', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(rawWriteRefusal(method, urls.layoutPage('Ab12'), undefined)).toBeNull();
  });
});
