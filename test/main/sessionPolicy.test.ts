import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { saveForm } from '../../src/core/restore';
import { CHART_STORAGE, ORIGIN, urls } from '../../src/core/tv/endpoints';
import { referenceRecord } from '../fakes/fixtures';

type Details = { method: string; url: string; webContentsId?: number; uploadData?: { bytes?: Buffer; blobUUID?: string }[] };
type Listener = (details: Details, cb: (r: { cancel: boolean }) => void) => void;

const electron = vi.hoisted(() => ({
  onBeforeRequest: null as Listener | null,
  /** What the hidden page does when ChartKeeper runs a script in it. */
  runInPage: null as ((webContentsId: number, script: string) => Promise<unknown>) | null,
  nextWebContentsId: 7,
}));
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: class {
    private destroyed = false;
    readonly webContents;
    constructor() {
      const id = electron.nextWebContentsId++;
      this.webContents = { id, setWindowOpenHandler: () => undefined, on: () => undefined, executeJavaScript: (script: string) => electron.runInPage!(id, script) };
    }
    loadURL = async () => undefined;
    once = () => undefined;
    isDestroyed = () => this.destroyed;
    destroy = () => void (this.destroyed = true);
  },
  session: {
    fromPartition: () => ({
      webRequest: { onBeforeRequest: (_filter: unknown, l: Listener) => (electron.onBeforeRequest = l) },
      setPermissionRequestHandler: () => undefined,
      getUserAgent: () => 'Chrome/140',
      setUserAgent: () => undefined,
    }),
  },
}));

const { ElectronPageTransport, expectWrite, tvSession } = await import('../../src/main/tvSession');

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
const OWN_PAGE = 1;
const OTHER_PAGE = 2;
const createLayout = async (webContentsId?: number): Promise<Details> => ({ method: 'POST', url: urls.saveLayout, webContentsId, uploadData: await formBody(layoutForm()) });
const addTheme = async (webContentsId?: number): Promise<Details> => ({ method: 'POST', url: urls.saveTheme, webContentsId, uploadData: await formBody({ name: 'Dark', content: '{}' }) });

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

  it('lets pages and reads through from any page', () => {
    expect(cancelled({ method: 'GET', url: urls.layoutPage('Ab12') })).toBe(false);
    expect(cancelled({ method: 'GET', url: urls.myCharts, webContentsId: OTHER_PAGE })).toBe(false);
  });

  it("cancels even an allowed create that ChartKeeper is not sending itself, as TradingView's own page could", async () => {
    expect(cancelled(await createLayout(OWN_PAGE))).toBe(true);
    expect(cancelled(await addTheme(OWN_PAGE))).toBe(true);
    expect(cancelled(await addTheme())).toBe(true);
  });

  it('lets a create ChartKeeper registered from the same page through once', async () => {
    const withdraw = expectWrite(OWN_PAGE, 'POST', urls.studyTemplates);
    const template = { method: 'POST', url: urls.studyTemplates, webContentsId: OWN_PAGE, uploadData: [{ bytes: Buffer.from('{"name":"RSI","content":{},"meta_info":{}}') }] };
    expect(cancelled(template)).toBe(false);
    expect(cancelled(template), 'the same request a second time').toBe(true);
    withdraw();
  });

  it('does not let a registration from one page cover a request from another, or from no page', async () => {
    const withdraw = expectWrite(OWN_PAGE, 'POST', urls.saveLayout);
    expect(cancelled(await createLayout(OTHER_PAGE))).toBe(true);
    expect(cancelled(await createLayout())).toBe(true);
    expect(cancelled(await createLayout(OWN_PAGE))).toBe(false);
    withdraw();
  });

  it('does not let a registration cover another address', async () => {
    const withdraw = expectWrite(OWN_PAGE, 'POST', urls.saveLayout);
    expect(cancelled(await addTheme(OWN_PAGE))).toBe(true);
    withdraw();
    expect(cancelled(await createLayout(OWN_PAGE)), 'after it was withdrawn').toBe(true);
  });

  it('cancels a write the policy refuses even when ChartKeeper registered it', async () => {
    const withdraw = expectWrite(OWN_PAGE, 'POST', urls.saveLayout);
    expect(cancelled({ method: 'POST', url: urls.saveLayout, webContentsId: OWN_PAGE, uploadData: await formBody({ ...layoutForm(), image_url: 'Ab12' }) })).toBe(true);
    withdraw();
    const put = `${CHART_STORAGE}/layout/Ab12/sources?chart_id=1&layout_id=Ab12&jwt=t`;
    const withdrawPut = expectWrite(OWN_PAGE, 'PUT', put);
    expect(cancelled({ method: 'PUT', url: put, webContentsId: OWN_PAGE, uploadData: [{ bytes: Buffer.from('{"sources":{}}') }] })).toBe(true);
    withdrawPut();
  });

  it('still blocks everything outside TradingView', () => {
    expect(cancelled({ method: 'GET', url: 'https://www.google-analytics.com/collect' })).toBe(true);
  });
});

describe("ChartKeeper's hidden page", () => {
  /** The page sends what the script asks for; TradingView's own code in it may send something too. */
  async function pageThatSends(alsoFromTradingView?: Details): Promise<{ statuses: number[] }> {
    const statuses: number[] = [];
    electron.runInPage = async (id, script) => {
      const req = JSON.parse(script.slice(script.lastIndexOf(')(') + 2, -1)) as { method: string; url: string; form?: Record<string, string> };
      const sent = cancelled({ method: req.method, url: req.url, webContentsId: id, uploadData: req.form ? await formBody(req.form) : undefined }) ? 0 : 200;
      statuses.push(sent);
      if (alsoFromTradingView) statuses.push(cancelled({ ...alsoFromTradingView, webContentsId: id }) ? 0 : 200);
      return { status: sent, contentType: '', body: '' };
    };
    return { statuses };
  }

  it("gets its own create through, and nothing TradingView's code sends from the same page while or after it runs", async () => {
    const { statuses } = await pageThatSends(await addTheme());
    const t = new ElectronPageTransport();
    await expect(t.send({ method: 'POST', url: urls.saveLayout, form: layoutForm() })).resolves.toMatchObject({ status: 200 });
    await expect(t.send({ method: 'GET', url: urls.myCharts })).resolves.toMatchObject({ status: 200 });
    expect(statuses).toEqual([200, 0, 200, 0]);
    t.close();
  });

  it('withdraws a registration its request did not use', async () => {
    let id = -1;
    electron.runInPage = async (webContentsId) => {
      id = webContentsId;
      return { status: 0, contentType: '', body: '' };
    };
    const t = new ElectronPageTransport();
    await t.send({ method: 'POST', url: urls.saveLayout, form: layoutForm() });
    expect(cancelled(await createLayout(id)), "a later create from TradingView's code in that page").toBe(true);
    t.close();
  });
});
