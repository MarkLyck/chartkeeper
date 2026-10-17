/**
 * Builds test/fixtures/reference-snapshot: a real snapshot of a known layout,
 * plus a screenshot of TradingView rendering that same layout. The viewer check
 * (scripts/viewer-compare.ts) renders the snapshot next to the screenshot.
 *
 * Needs no TradingView account: the layout is loaded into a signed-out chart
 * through TradingView's own loader, and prices come over the public data feed.
 *
 *   npx tsx scripts/capture-reference.ts
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { countLayout, parseLayout } from '../src/core/layout';
import type { LayoutRecord } from '../src/core/model';
import { layoutDir, SnapshotWriter } from '../src/core/snapshot';
import { fetchChartData, nodeSocketFactory } from '../src/core/tv/datafeed';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test/fixtures/reference-snapshot');
const UID = 'RefAAPL1';

async function main() {
  const saved = JSON.parse(await fs.readFile(path.join(ROOT, 'test/fixtures/tv-saved-layout.json'), 'utf8'));
  const content = JSON.parse(saved.content);
  const metaMap = JSON.parse(saved.study_meta_info_map);
  // Signed-out charts allow two indicators and can't compute Pine-based ones,
  // which is what the loader turns stored indicators into. So we load the
  // drawings only and add Bollinger Bands and RSI through the chart API below.
  for (const pane of content.charts[0].panes) pane.sources = pane.sources.filter((s: { metaInfo?: unknown }) => !s.metaInfo);
  content.charts[0].panes = content.charts[0].panes.filter((p: { sources: unknown[] }) => p.sources.length > 0);
  for (const k of Object.keys(metaMap)) delete metaMap[k];
  content.name = 'Reference AAPL';

  const browser = await chromium.launch({ executablePath: chromium.executablePath() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL&interval=D', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).TradingViewApi?.activeChart, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(async (st) => {
    await (window as any).TradingViewApi._chartWidgetCollection.loadLayoutState({ name: st.name, chartWidgetCollectionState: st });
  }, { ...content, studyMetaInfoMap: metaMap });
  await page.waitForTimeout(5000);
  for (let i = 0; i < 3; i++) {
    const b = page.getByRole('button', { name: 'Reconnect' });
    if (await b.count()) {
      await b.click();
      await page.waitForTimeout(8000);
    }
  }
  await page.evaluate(async () => {
    const c = (window as any).TradingViewApi.activeChart();
    await c.createStudy('Moving Average', false, false, { length: 50 });
    await c.createStudy('Relative Strength Index', false, false);
  });
  await page.waitForTimeout(6000);
  await page.mouse.move(5, 995);
  await page.waitForTimeout(1000);
  const view = await page.evaluate(() => {
    const api = (window as any).TradingViewApi;
    const c = api.activeChart();
    const el = document.querySelector('.chart-container') ?? document.querySelector('.layout__area--center');
    const r = el!.getBoundingClientRect();
    return { visibleRange: c.getVisibleRange(), shapes: c.getAllShapes().length, studies: c.getAllStudies().map((s: { name: string }) => s.name), box: { x: r.x, y: r.y, width: r.width, height: r.height } };
  });
  console.log('TradingView shows', view.shapes, 'drawings and', view.studies);
  await fs.mkdir(OUT, { recursive: true });
  const shot = await page.screenshot({ clip: view.box });
  const normalized = await page.evaluate(() => (window as any).TradingViewApi.getSaveChartService().saveToJSON());
  await browser.close();

  const record: LayoutRecord = {
    uid: UID,
    id: 1,
    name: 'Reference AAPL',
    description: 'Known layout used to compare the viewer with TradingView',
    lastModified: Math.floor(Date.now() / 1000),
    content: JSON.parse(normalized.content),
    studyMetaInfoMap: JSON.parse(normalized.study_meta_info_map),
    listEntry: { image_url: UID, url: UID, id: 1, name: 'Reference AAPL' },
  };
  const layout = parseLayout(record, null);
  const chart = layout.charts[0]!;
  const studies = chart.panes.flatMap((p) => p.studies);
  const data = await fetchChartData(chart, studies, nodeSocketFactory, { authToken: null, bars: 1000, log: console.log });
  console.log('bars', data.bars.length, 'studies', Object.fromEntries(Object.entries(data.studies).map(([k, v]) => [k, v.status === 'ok' ? v.rows.length : v.error])));

  const parent = path.join(ROOT, '.test-output/reference-build');
  await fs.rm(parent, { recursive: true, force: true });
  const writer = await SnapshotWriter.begin(parent, new Date('2026-10-17T10:00:00'));
  const dir = layoutDir(UID);
  await writer.writeJson(`${dir}/layout.json`, record);
  await writer.writeJson(`${dir}/drawings.json`, { buckets: {}, reportedTotal: null });
  await writer.writeJson(`${dir}/data/chart-${chart.chartId}.json`, data);
  const counts = countLayout(layout);
  const final = await writer.finish({
    app: { name: 'ChartKeeper', version: 'reference' },
    createdAt: new Date().toISOString(),
    account: { username: 'reference', plan: null },
    layouts: [{ uid: UID, name: record.name, dir, symbols: counts.symbols, charts: counts.charts, drawings: counts.drawings, studies: counts.studies, lastModified: record.lastModified, priceData: true }],
    extras: { studyTemplates: 0, drawingTemplates: 0, themes: 0, scripts: 0, userDrawings: 0 },
    warnings: [],
  });
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.cp(final, OUT, { recursive: true });
  await fs.writeFile(path.join(ROOT, 'test/fixtures/tradingview-reference.png'), shot);
  await fs.writeFile(path.join(ROOT, 'test/fixtures/tradingview-reference.json'), JSON.stringify({ uid: UID, visibleRange: view.visibleRange, size: view.box, tradingViewCounts: { drawings: view.shapes, studies: view.studies } }, null, 2) + '\n');
  console.log('wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
