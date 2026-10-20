import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { saveForm } from '../../src/core/restore';
import { CHART_STORAGE, ORIGIN, urls } from '../../src/core/tv/endpoints';
import { referenceRecord } from '../fakes/fixtures';

type Details = { method: string; url: string; uploadData?: { bytes?: Buffer; blobUUID?: string }[] };
type Listener = (details: Details, cb: (r: { cancel: boolean }) => void) => void;

const electron = vi.hoisted(() => ({ onBeforeRequest: null as Listener | null }));
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  session: {
    fromPartition: () => ({
      webRequest: { onBeforeRequest: (_filter: unknown, l: Listener) => (electron.onBeforeRequest = l) },
      setPermissionRequestHandler: () => undefined,
      getUserAgent: () => 'Chrome/140',
      setUserAgent: () => undefined,
    }),
  },
}));

const { tvSession } = await import('../../src/main/tvSession');

/** What the session does with a request: true when it is cancelled before it leaves. */
function cancelled(details: Details): boolean {
  tvSession();
  let answer: boolean | undefined;
  electron.onBeforeRequest!(details, (r) => (answer = r.cancel));
  return answer!;
}

async function formBody(fields: Record<string, string>): Promise<Details['uploadData']> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return [{ bytes: Buffer.from(await new Request(ORIGIN, { method: 'POST', body: fd }).arrayBuffer()) }];
}

const layoutForm = () => saveForm(referenceRecord(), { buckets: {}, reportedTotal: null }, 'Copy');

describe('the TradingView browser session', () => {
  it('cancels a save from the page that would overwrite an existing layout', async () => {
    expect(cancelled({ method: 'POST', url: urls.saveLayout, uploadData: await formBody({ ...layoutForm(), image_url: 'Ab12' }) })).toBe(true);
  });

  it('cancels writes to the drawing storage and layout deletes', () => {
    expect(cancelled({ method: 'PUT', url: `${CHART_STORAGE}/layout/Ab12/sources?chart_id=1&layout_id=Ab12&jwt=t`, uploadData: [{ bytes: Buffer.from('{"sources":{"a":null}}') }] })).toBe(true);
    expect(cancelled({ method: 'POST', url: `${ORIGIN}/api/v1/charts/delete/`, uploadData: [{ bytes: Buffer.from('{"uid":["Ab12"]}') }] })).toBe(true);
  });

  it('cancels a save whose content is a file part, as TradingView sends a gzipped layout', () => {
    expect(cancelled({ method: 'POST', url: urls.saveLayout, uploadData: [{ bytes: Buffer.from('------B\r\nContent-Disposition: form-data; name="content"; filename="blob.gz"\r\n\r\n') }, { blobUUID: '1' }, { bytes: Buffer.from('\r\n------B--\r\n') }] })).toBe(true);
  });

  it('lets pages, reads and the creates ChartKeeper makes through', async () => {
    expect(cancelled({ method: 'GET', url: urls.layoutPage('Ab12') })).toBe(false);
    expect(cancelled({ method: 'POST', url: urls.saveLayout, uploadData: await formBody(layoutForm()) })).toBe(false);
    expect(cancelled({ method: 'POST', url: urls.studyTemplates, uploadData: [{ bytes: Buffer.from('{"name":"RSI","content":{},"meta_info":{}}') }] })).toBe(false);
  });

  it('still blocks everything outside TradingView', () => {
    expect(cancelled({ method: 'GET', url: 'https://www.google-analytics.com/collect' })).toBe(true);
  });
});
