/**
 * Renders test/fixtures/reference-snapshot with the offline viewer in headless
 * Chromium, at the size and visible range of TradingView's own screenshot,
 * and writes both side by side to .test-output/viewer-compare.png.
 *
 * Fails when a drawing or indicator is neither drawn nor listed as not shown,
 * or when the page logs an error.
 *
 *   npx tsx scripts/viewer-compare.ts [--lang da]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { countLayout, parseLayout, type ParsedLayout } from '../src/core/layout';
import { DRAWING_KINDS } from '../src/renderer/viewer/drawings/registry';
import type { ChartData } from '../src/core/model';
import { SnapshotReader } from '../src/core/snapshot';
import { openLayout } from '../src/core/snapshotView';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.test-output');
const FIXTURES = path.join(ROOT, 'test/fixtures');


interface Reference {
  uid: string;
  visibleRange: { from: number; to: number };
  size: { width: number; height: number };
}

interface HarnessResult {
  notShown: { id: string; kind: string; name: string; message: string; partial: boolean }[];
  rendered: { chartId: string; drawings: string[]; studies: string[] }[];
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

async function main() {
  const lang = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : 'en';
  const ref: Reference = JSON.parse(await fs.readFile(path.join(FIXTURES, 'tradingview-reference.json'), 'utf8'));
  const { layout, data } = await openLayout(await SnapshotReader.open(path.join(FIXTURES, 'reference-snapshot')), ref.uid);

  const bundle = await build({
    entryPoints: [path.join(ROOT, 'src/renderer/viewer/harness.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
  });
  const script = bundle.outputFiles[0]!.text;
  await fs.mkdir(OUT, { recursive: true });

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch();
  const errors: string[] = [];
  try {
    const { width, height } = ref.size;
    const shot = await renderPage(browser, script, 'viewer-compare.html', { layout, data, options: { lang, visibleRange: ref.visibleRange } }, width, height, errors);
    await fs.writeFile(path.join(OUT, 'viewer-only.png'), shot.png);

    const refPng = await fs.readFile(path.join(FIXTURES, 'tradingview-reference.png'));
    const side = await browser.newPage({ viewport: { width: width * 2 + 30, height: height + 40 } });
    const img = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
    await side.setContent(`<html><body style="margin:0;display:flex;gap:10px;padding:0 5px;font:bold 16px sans-serif;background:#ddd">
      <div><div style="height:30px;line-height:30px">ChartKeeper viewer</div><img src="${img(shot.png)}" width="${width}" height="${height}"></div>
      <div><div style="height:30px;line-height:30px">TradingView</div><img src="${img(refPng)}" width="${width}" height="${height}"></div>
      </body></html>`);
    await side.screenshot({ path: path.join(OUT, 'viewer-compare.png'), fullPage: true });

    const counts = countLayout(layout);
    const drawn = new Set(shot.result.rendered.flatMap((r) => [...r.drawings, ...r.studies]));
    const listed = new Set(shot.result.notShown.filter((n) => !n.partial).map((n) => n.id));
    const missing = [...counts.drawingIds, ...counts.studyIds].filter((id) => !drawn.has(id) && !listed.has(id));
    console.log(`reference: drawn ${shot.result.rendered.map((r) => `${r.drawings.length} drawings, ${r.studies.length} indicators`).join('; ')}`);
    for (const n of shot.result.notShown) console.log(`reference not shown: ${n.kind} ${n.id} ${n.name}: ${n.message}`);
    if (missing.length) errors.push(`reference: neither drawn nor listed as not shown: ${missing.join(', ')}`);

    const g = await galleryInput(layout, data[layout.charts[0]!.chartId]!);
    const gallery = await renderPage(browser, script, 'viewer-gallery.html', g, 1600, 1100, errors);
    await fs.writeFile(path.join(OUT, 'viewer-gallery.png'), gallery.png);
    console.log(`gallery: drawn ${gallery.result.rendered.map((r) => `${r.drawings.length} drawings, ${r.studies.length} indicators`).join('; ')}; ${gallery.result.notShown.length} not shown`);
    console.log('wrote .test-output/viewer-compare.png, .test-output/viewer-compare.html and .test-output/viewer-gallery.png');
  } finally {
    await browser.close();
  }
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
}

type Browser = Awaited<ReturnType<(typeof import('playwright-core'))['chromium']['launch']>>;

async function renderPage(browser: Browser, script: string, file: string, input: unknown, width: number, height: number, errors: string[]): Promise<{ png: Buffer; result: HarnessResult }> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ChartKeeper viewer</title>
<style>html,body{margin:0;padding:0;background:#fff}#root{width:${width}px;height:${height}px}</style></head>
<body><div id="root"></div>
<script>window.__CK_INPUT__ = ${json(input)};</script>
<script>${script}</script></body></html>`;
  const htmlPath = path.join(OUT, file);
  await fs.writeFile(htmlPath, html);
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => errors.push(`${file}: page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${file}: console error: ${m.text()}`);
  });
  await page.goto(`file://${htmlPath}`);
  await page.waitForFunction(() => '__CK_RESULT__' in window, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const result = (await page.evaluate(() => (window as unknown as { __CK_RESULT__: unknown }).__CK_RESULT__)) as HarnessResult;
  const png = await page.locator('#root').screenshot();
  await page.close();
  return { png, result };
}

const sma = (xs: number[], n: number) => xs.map((_, i) => (i + 1 < n ? null : xs.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));

/**
 * A layout that exercises what the reference does not: every registered
 * drawing type, Volume with palette colours, Pine Bollinger Bands and RSI
 * (fills, gradients, shapes), Heikin Ashi, a chart without prices, an unknown
 * drawing, a hidden one, an indicator error, and Danish text.
 */
async function galleryInput(reference: ParsedLayout, refData: ChartData) {
  const saved = JSON.parse(await fs.readFile(path.join(FIXTURES, 'tv-saved-layout.json'), 'utf8'));
  const content = JSON.parse(saved.content);
  const metaMap = JSON.parse(saved.study_meta_info_map);
  const bars = refData.bars;
  const n = bars.length;
  const closes = bars.map((b) => b[4]);
  const lo = Math.min(...bars.slice(n - 150).map((b) => b[3]));
  const hi = Math.max(...bars.slice(n - 150).map((b) => b[2]));
  const range = hi - lo;
  const point = (i: number, price: number) => ({ time_t: bars[Math.min(n - 1, i)]![0], offset: Math.max(0, i - (n - 1)), price });

  const types = [...Object.keys(DRAWING_KINDS), 'LineToolGannFan'];
  const drawings = types.map((type, k) => {
    const col = k % 7;
    const row = Math.floor(k / 7);
    const i = n - 150 + col * 21;
    const price = hi - (row + 0.5) * (range / 7);
    const short = type.replace('LineTool', '');
    return {
      type,
      id: `g${k}`,
      zorder: k,
      ownerSource: '_seriesId',
      points: [point(i, price), point(i + 12, price - range * 0.06), point(i + 4, price + range * 0.04), point(i + 16, price + range * 0.02)],
      state: {
        symbol: 'BATS:AAPL',
        visible: !type.endsWith('Circle'),
        text: short,
        linecolor: ['#2962FF', '#F23645', '#089981', '#FF9800', '#9C27B0'][k % 5],
        linewidth: 2,
        fillBackground: true,
        stopLevel: 300,
        profitLevel: 600,
        level1: [0, '#808080', true],
        level2: [0.618, '#089981', true],
        level3: [1, '#F23645', true],
        showPrice: true,
        showTime: true,
      },
    };
  });
  const chart1 = content.charts[0];
  chart1.panes[0].sources = [...chart1.panes[0].sources.filter((s: { type: string }) => !s.type.startsWith('LineTool')), ...drawings];

  const chart3 = structuredClone(chart1);
  chart3.chartId = '3';
  for (const pane of chart3.panes) for (const src of pane.sources) if (src.id !== '_seriesId') src.id += '-3';
  content.charts.push(chart3);
  content.layout = '2-1';

  const studyIds = Object.fromEntries(chart1.panes.flatMap((p: { sources: { id: string; metaInfo?: string }[] }) => p.sources.filter((s) => s.metaInfo).map((s) => [s.metaInfo!.split('@')[0], s.id])));
  const volMa = sma(bars.map((b) => b[5]), 20);
  const basis = sma(closes, 20);
  const dev = closes.map((_, i) => (i < 19 ? null : Math.sqrt(closes.slice(i - 19, i + 1).reduce((a, c) => a + (c - basis[i]!) ** 2, 0) / 20)));
  const rsiRef = new Map((refData.studies['20Xh7n'] as { rows: (number | null)[][] }).rows.map((r) => [r[0], r[1]]));
  const rsi = bars.map((b) => rsiRef.get(b[0]) ?? null);
  const rsiMa = rsi.map((_, i) => (i < 14 || rsi.slice(i - 13, i + 1).some((v) => v === null) ? null : (rsi.slice(i - 13, i + 1) as number[]).reduce((a, b) => a + b, 0) / 14));
  const studies: ChartData['studies'] = {
    [studyIds.Volume]: { status: 'ok', metaInfoId: 'Volume@tv-basicstudies-280', rows: bars.map((b, i) => [b[0], b[5], b[4] >= b[1] ? 0 : 1, volMa[i]!]) },
    [studyIds['Script$STD;Bollinger_Bands']]: { status: 'ok', metaInfoId: 'BB', rows: bars.map((b, i) => [b[0], basis[i]!, dev[i] === null ? null : basis[i]! + 2 * dev[i]!, dev[i] === null ? null : basis[i]! - 2 * dev[i]!]) },
    [studyIds['Script$STD;RSI']]: {
      status: 'ok',
      metaInfoId: 'RSI',
      rows: bars.map((b, i) => [b[0], rsi[i]!, 50, rsiMa[i]!, null, null, null, null, null, null, null, null, null, null, null]),
      graphics: { d: JSON.stringify({ graphicsCmds: { create: { labels: [{ id: 1 }] } } }) },
    },
  };
  const record = { uid: 'gallery', id: null, name: 'Gallery', description: '', lastModified: null, content, studyMetaInfoMap: metaMap, listEntry: {} };
  const layout = parseLayout(record, null);
  layout.charts.splice(1, 0, { ...structuredClone(reference.charts[0]!), chartId: '2', style: 8 });
  const errStudy = layout.charts[1]!.panes[1]!.studies[0]!;
  return {
    layout,
    data: {
      [chart1.chartId]: { ...refData, chartId: chart1.chartId, studies },
      '2': { ...refData, chartId: '2', studies: { FIqn6C: refData.studies.FIqn6C!, [errStudy.id]: { status: 'error', metaInfoId: errStudy.metaInfoId, error: 'study_limit_exceeded' } } },
      '3': null,
    },
    options: { lang: 'da' },
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
