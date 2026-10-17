/**
 * Measures the offline viewer against TradingView's own rendering of every
 * scene in test/fixtures/gallery, in headless Chromium, without network.
 *
 * For each scene it renders the snapshot at the captured pixel size and main
 * price range (the time scale comes from the layout, as in TradingView), then scores:
 *   - each drawing: the pixels it adds over the drawing-free chart, TradingView vs viewer;
 *   - each pane of the drawing-free chart (series and indicators): foreground pixels;
 *   - the full chart, for the report.
 * Writes .test-output/gallery-compare/index.html and scores.json, and exits
 * non-zero when a score falls below test/gallery/thresholds.ts, when an item
 * has no threshold, or when a drawing or indicator is neither drawn nor listed
 * as not shown.
 *
 *   npm run gallery:compare [-- scene ...] [--no-fail]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { countLayout } from '../src/core/layout';
import { obj, str } from '../src/core/props';
import { SnapshotReader } from '../src/core/snapshot';
import { openLayout } from '../src/core/snapshotView';
import type { AnalyzeInput, AnalyzeResult, MaskScore, RenderInfo, SceneInput } from './gallery/page';
import { parseColor, type Rect } from '../test/gallery/pixels';
import { DRAWING_THRESHOLDS, INDICATOR_THRESHOLDS, STYLE_THRESHOLDS, type Threshold } from '../test/gallery/thresholds';

const ROOT = path.resolve(__dirname, '..');
const GALLERY = path.join(ROOT, 'test/fixtures/gallery');
const OUT = path.join(ROOT, '.test-output/gallery-compare');
const BASELINE = path.join(ROOT, 'test/gallery/baseline-scores.json');

const DRAWING_THRESHOLD = 6;
const FOREGROUND_THRESHOLD = 40;
const TOLERANCE = 3;
const MAX_COLOR = 90;

interface SceneMeta {
  scene: string;
  uid: string;
  size: { width: number; height: number };
  charts: { chartId: string; style: { id: number; name: string }; visibleRange: { from: number; to: number }; priceRange: { from: number; to: number } | null }[];
  drawings: { id: string; type: string; image: string }[];
}

interface Index {
  scenes: { name: string; dir: string }[];
}

export interface DrawingScore {
  scene: string;
  id: string;
  type: string;
  family: string;
  f1: number;
  precision: number;
  recall: number;
  centroidDistance: number | null;
  colorDistance: number | null;
  threshold: Threshold | null;
  failure: string | null;
}

export interface PaneScore extends MaskScore {
  scene: string;
  pane: number;
  /** Plot area of the pane in the viewer render. */
  rect: Rect | null;
  /** "style:<id>" for a main pane without indicators, "indicator:<name>" for each indicator in the pane. */
  keys: string[];
  failure: string | null;
}

interface SceneReport {
  scene: string;
  description: string;
  full: MaskScore;
  drawings: DrawingScore[];
  panes: PaneScore[];
  notShown: RenderInfo['notShown'];
  problems: string[];
}

interface Baseline {
  drawings: Record<string, number>;
  styles: Record<string, number>;
  indicators: Record<string, number>;
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
const fromDataUrl = (u: string) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
const studyKey = (metaInfoId: string) => metaInfoId.split('@')[0]!;

/** TradingView's watermark (bottom left, above the time axis) and the settings button (bottom right) are in every capture; the page finds the chart-events button. */
const ignoredCorners = (w: number, h: number): Rect[] => [
  { x: 0, y: h - 82, w: 190, h: 54 },
  { x: w - 50, y: h - 30, w: 50, h: 30 },
];

function check(score: number, t: Threshold | null): string | null {
  if (!t) return 'no threshold';
  return score < t.min ? `score ${score.toFixed(3)} < ${t.min}` : null;
}

async function main() {
  const args = process.argv.slice(2);
  const noFail = args.includes('--no-fail');
  const only = args.filter((a) => !a.startsWith('--'));
  const index: Index = JSON.parse(await fs.readFile(path.join(GALLERY, 'index.json'), 'utf8'));
  const scenes = index.scenes.filter((s) => !only.length || only.includes(s.name));
  if (!scenes.length) throw new Error(`No scene matches ${only.join(', ')}`);
  const families = familyOf(index);
  const baseline: Baseline | null = await fs.readFile(BASELINE, 'utf8').then(JSON.parse, () => null);

  const bundle = await build({
    entryPoints: [path.join(__dirname, 'gallery/page.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
  });
  const script = bundle.outputFiles[0]!.text;
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch();
  const reports: SceneReport[] = [];
  try {
    for (const s of scenes) {
      const started = Date.now();
      const report = await compareScene(browser, script, s.dir, families);
      reports.push(report);
      const bad = [...report.drawings.filter((d) => d.failure), ...report.panes.filter((p) => p.failure)].length + report.problems.length;
      console.log(`${s.name}: full ${report.full.f1.toFixed(3)}, ${report.drawings.length} drawings, ${report.panes.length} panes, ${bad} failing, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  } finally {
    await browser.close();
  }

  const summary = summarize(reports);
  await fs.writeFile(path.join(OUT, 'scores.json'), JSON.stringify({ summary, scenes: reports }, null, 2));
  await fs.writeFile(path.join(OUT, 'index.html'), reportHtml(reports, summary, baseline));

  const failures = reports.flatMap((r) => [
    ...r.problems.map((p) => `${r.scene}: ${p}`),
    ...r.drawings.filter((d) => d.failure).map((d) => `${r.scene}: drawing ${d.id} ${d.type}: ${d.failure}`),
    ...r.panes.filter((p) => p.failure).map((p) => `${r.scene}: pane ${p.pane} (${p.keys.join(', ')}): ${p.failure}`),
  ]);
  console.log(`\nwrote ${path.relative(ROOT, path.join(OUT, 'index.html'))} and scores.json`);
  printSummary(summary, baseline);
  if (failures.length) {
    console.error(`\n${failures.length} failing:`);
    for (const f of failures) console.error(`  ${f}`);
    if (!noFail) process.exit(1);
  }
}

type Browser = Awaited<ReturnType<(typeof import('playwright-core'))['chromium']['launch']>>;

async function compareScene(browser: Browser, script: string, dir: string, families: Map<string, string>): Promise<SceneReport> {
  const sceneDir = path.join(GALLERY, dir);
  const meta: SceneMeta = JSON.parse(await fs.readFile(path.join(sceneDir, 'meta.json'), 'utf8'));
  const { layout, data } = await openLayout(await SnapshotReader.open(sceneDir), meta.uid);
  const chartMeta = meta.charts[0]!;
  const { width, height } = meta.size;
  const problems: string[] = [];

  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}#root{width:${width}px;height:${height}px}</style></head><body><div id="root"></div></body></html>`);
  await page.addScriptTag({ content: script });
  const input: SceneInput = {
    layout,
    data,
    options: { ...(chartMeta.priceRange ? { priceRange: chartMeta.priceRange } : {}), notShownPanel: false },
  };
  await page.evaluate((i) => (window as any).ck.load(i), JSON.parse(json(input)));
  const shoot = async (only: string[] | null) => {
    const info: RenderInfo = await page.evaluate((o) => (window as any).ck.render(o), only);
    return { info, png: await page.locator('#root').screenshot() };
  };

  const full = await shoot(null);
  const base = await shoot([]);
  const drawingPngs: Record<string, Buffer> = {};
  for (const d of meta.drawings) drawingPngs[d.id] = (await shoot([d.id])).png;

  const counts = countLayout(layout);
  const drawn = new Set(full.info.rendered.flatMap((r) => [...r.drawings, ...r.studies]));
  const listed = new Set(full.info.notShown.filter((n) => !n.partial).map((n) => n.id));
  const missing = [...counts.drawingIds, ...counts.studyIds].filter((id) => !drawn.has(id) && !listed.has(id));
  if (missing.length) problems.push(`neither drawn nor listed as not shown: ${missing.join(', ')}`);

  const tvPng = (f: string) => fs.readFile(path.join(sceneDir, f));
  const background = parseColor(str(obj(obj(layout.charts[0]!.chartProperties).paneProperties).background, '#ffffff'));
  const job: AnalyzeInput = {
    tv: {
      full: dataUrl(await tvPng('tradingview.png')),
      base: dataUrl(await tvPng('isolated/_base.png')),
      drawings: Object.fromEntries(await Promise.all(meta.drawings.map(async (d) => [d.id, dataUrl(await tvPng(d.image))] as const))),
    },
    viewer: { full: dataUrl(full.png), base: dataUrl(base.png), drawings: Object.fromEntries(Object.entries(drawingPngs).map(([id, b]) => [id, dataUrl(b)])) },
    panes: base.info.panes.map((p) => p.rect),
    background,
    ignore: ignoredCorners(width, height),
    drawingThreshold: DRAWING_THRESHOLD,
    foregroundThreshold: FOREGROUND_THRESHOLD,
    tolerance: TOLERANCE,
    maxColor: MAX_COLOR,
  };
  const result: AnalyzeResult = await page.evaluate((j) => (window as any).ck.analyze(j), job);
  await page.close();

  const out = path.join(OUT, meta.scene);
  await fs.mkdir(path.join(out, 'drawings'), { recursive: true });
  await fs.copyFile(path.join(sceneDir, 'tradingview.png'), path.join(out, 'tradingview.png'));
  await fs.writeFile(path.join(out, 'viewer.png'), full.png);
  await fs.copyFile(path.join(sceneDir, 'isolated/_base.png'), path.join(out, 'tradingview-base.png'));
  await fs.writeFile(path.join(out, 'viewer-base.png'), base.png);
  await fs.writeFile(path.join(out, 'overlay.png'), fromDataUrl(result.full.overlay));
  await fs.writeFile(path.join(out, 'overlay-base.png'), fromDataUrl(result.base.overlay));

  const typeOf = new Map(layout.charts.flatMap((c) => c.panes.flatMap((p) => p.drawings.map((d) => [d.id, d.type] as const))));
  const notShownIds = new Set(full.info.notShown.filter((n) => !n.partial).map((n) => n.id));
  const drawings: DrawingScore[] = [];
  for (const r of result.drawings) {
    await fs.writeFile(path.join(out, 'drawings', `${r.id}.png`), fromDataUrl(r.overlay));
    const type = typeOf.get(r.id) ?? meta.drawings.find((d) => d.id === r.id)!.type;
    const threshold = DRAWING_THRESHOLDS[type] ?? null;
    const failure = notShownIds.has(r.id) && !threshold?.reason ? 'listed as not shown' : check(r.f1, threshold);
    drawings.push({ scene: meta.scene, id: r.id, type, family: families.get(type) ?? 'other', f1: r.f1, precision: r.precision, recall: r.recall, centroidDistance: r.centroidDistance, colorDistance: r.colorDistance, threshold, failure });
  }

  const panes: PaneScore[] = result.panes.map((s, i) => {
    const info = base.info.panes[i]!;
    const keys = info.studies.length ? info.studies.map((id) => `indicator:${studyKey(id)}`) : info.main ? [`style:${chartMeta.style.id}`] : [];
    const failures = keys.map((k) => {
      const [kind, name] = k.split(':') as [string, string];
      const t = kind === 'style' ? (STYLE_THRESHOLDS[Number(name)] ?? null) : (INDICATOR_THRESHOLDS[name] ?? null);
      const f = check(s.f1, t);
      return f && `${k} ${f}`;
    });
    return { scene: meta.scene, pane: i, rect: info.rect, keys, ...s, failure: failures.filter(Boolean).join('; ') || null };
  });

  const drawnStudies = new Set(full.info.rendered.flatMap((r) => r.studies));
  for (const chart of layout.charts) {
    for (const study of chart.panes.flatMap((p) => p.studies)) {
      if (drawnStudies.has(study.id)) continue;
      const key = studyKey(study.metaInfoId);
      const reason = INDICATOR_THRESHOLDS[key]?.reason;
      const zero = { f1: 0, precision: 0, recall: 0, tvPixels: 0, viewerPixels: 0 };
      panes.push({ scene: meta.scene, pane: -1, rect: null, keys: [`indicator:${key}`], ...zero, failure: reason ? null : 'indicator not drawn' });
    }
  }

  return { scene: meta.scene, description: str((meta as unknown as { description?: string }).description, ''), full: result.full, drawings, panes, notShown: full.info.notShown, problems };
}

/** A tool's family is the drawings-* scene that shows it. */
function familyOf(index: Index): Map<string, string> {
  const out = new Map<string, string>();
  const raw = index as unknown as { scenes: { name: string; drawings: { type: string }[] }[] };
  for (const s of raw.scenes) {
    if (!s.name.startsWith('drawings-')) continue;
    for (const d of s.drawings) if (!out.has(d.type)) out.set(d.type, s.name.slice('drawings-'.length));
  }
  return out;
}

interface Summary {
  drawings: Record<string, { family: string; min: number; mean: number; count: number }>;
  families: Record<string, { min: number; mean: number; tools: number }>;
  styles: Record<string, number>;
  indicators: Record<string, number>;
}

function summarize(reports: SceneReport[]): Summary {
  const byType = new Map<string, DrawingScore[]>();
  for (const d of reports.flatMap((r) => r.drawings)) byType.set(d.type, [...(byType.get(d.type) ?? []), d]);
  const drawings: Summary['drawings'] = {};
  for (const [type, list] of [...byType].sort()) {
    const f = list.map((d) => d.f1);
    drawings[type] = { family: list[0]!.family, min: Math.min(...f), mean: f.reduce((a, b) => a + b, 0) / f.length, count: f.length };
  }
  const families: Summary['families'] = {};
  for (const [type, d] of Object.entries(drawings)) {
    void type;
    const fam = (families[d.family] ??= { min: 1, mean: 0, tools: 0 });
    fam.min = Math.min(fam.min, d.min);
    fam.mean += d.mean;
    fam.tools++;
  }
  for (const fam of Object.values(families)) fam.mean /= fam.tools;
  const styles: Record<string, number> = {};
  const indicators: Record<string, number> = {};
  for (const p of reports.flatMap((r) => r.panes)) {
    for (const k of p.keys) {
      const [kind, name] = k.split(':') as [string, string];
      const target = kind === 'style' ? styles : indicators;
      target[name] = Math.min(target[name] ?? 1, p.f1);
    }
  }
  return { drawings, families, styles, indicators };
}

function printSummary(s: Summary, base: Baseline | null) {
  const fmt = (v: number, before?: number) => (before === undefined ? v.toFixed(3) : `${before.toFixed(3)} -> ${v.toFixed(3)}`);
  const famBase = (fam: string) => {
    if (!base) return undefined;
    const list = Object.entries(s.drawings).filter(([, d]) => d.family === fam).map(([t]) => base.drawings[t] ?? 0);
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : undefined;
  };
  console.log('\ndrawings by family (mean of per-tool means):');
  for (const [fam, f] of Object.entries(s.families).sort()) console.log(`  ${fam.padEnd(12)} ${fmt(f.mean, famBase(fam))}  (min ${f.min.toFixed(3)}, ${f.tools} tools)`);
  console.log('styles (main pane, worst scene):');
  for (const [id, v] of Object.entries(s.styles)) console.log(`  ${id.padEnd(12)} ${fmt(v, base?.styles[id])}`);
  console.log('indicators (their pane, worst scene):');
  for (const [name, v] of Object.entries(s.indicators)) console.log(`  ${name.padEnd(24)} ${fmt(v, base?.indicators[name])}`);
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function reportHtml(reports: SceneReport[], summary: Summary, base: Baseline | null): string {
  const n = (v: number | null | undefined, d = 3) => (v === null || v === undefined ? '-' : v.toFixed(d));
  const cls = (failure: string | null) => (failure ? ' class="bad"' : '');
  const scenes = reports
    .map((r) => {
      const rows = r.drawings
        .map(
          (d) =>
            `<tr${cls(d.failure)}><td>${esc(d.type)}</td><td>${d.id}</td><td>${n(base?.drawings[d.type])}</td><td><b>${n(d.f1)}</b></td><td>${n(d.precision)}</td><td>${n(d.recall)}</td><td>${n(d.centroidDistance, 1)}</td><td>${n(d.colorDistance, 0)}</td><td>${d.threshold ? n(d.threshold.min, 2) : '-'}</td><td>${esc(d.failure ?? 'ok')}${d.threshold?.reason ? `<br><small>${esc(d.threshold.reason)}</small>` : ''}</td><td><a href="${r.scene}/drawings/${d.id}.png"><img src="${r.scene}/drawings/${d.id}.png" width="250"></a></td></tr>`,
        )
        .join('');
      const panes = r.panes.map((p) => `<tr${cls(p.failure)}><td>pane ${p.pane}</td><td>${esc(p.keys.join(', ') || '-')}</td><td><b>${n(p.f1)}</b></td><td>${n(p.precision)}</td><td>${n(p.recall)}</td><td>${esc(p.failure ?? 'ok')}</td></tr>`).join('');
      const notShown = r.notShown.map((x) => `<li>${esc(x.kind)} ${esc(x.id)} ${esc(x.name)}: ${esc(x.message)}${x.partial ? ' (partly)' : ''}</li>`).join('');
      return `<section id="${r.scene}"><h2>${r.scene} <small>full ${n(r.full.f1)}</small></h2><p>${esc(r.description)}</p>
<div class="imgs"><figure><img src="${r.scene}/tradingview.png"><figcaption>TradingView</figcaption></figure><figure><img src="${r.scene}/viewer.png"><figcaption>ChartKeeper viewer</figcaption></figure><figure><img src="${r.scene}/overlay.png"><figcaption>Foreground: red TradingView only, blue viewer only, violet both</figcaption></figure></div>
<div class="imgs"><figure><img src="${r.scene}/tradingview-base.png"><figcaption>TradingView without drawings</figcaption></figure><figure><img src="${r.scene}/viewer-base.png"><figcaption>Viewer without drawings</figcaption></figure><figure><img src="${r.scene}/overlay-base.png"><figcaption>Without drawings, overlaid</figcaption></figure></div>
${r.problems.length ? `<p class="bad">${r.problems.map(esc).join('<br>')}</p>` : ''}
<table><tr><th>Pane</th><th>Shows</th><th>F1</th><th>Precision</th><th>Recall</th><th>Result</th></tr>${panes}</table>
${rows ? `<table><tr><th>Type</th><th>Id</th><th>Before</th><th>F1</th><th>Precision</th><th>Recall</th><th>Centroid px</th><th>Colour dist</th><th>Min</th><th>Result</th><th>Mask (red TV, blue viewer)</th></tr>${rows}</table>` : ''}
${notShown ? `<details><summary>Not shown (${r.notShown.length})</summary><ul>${notShown}</ul></details>` : ''}</section>`;
    })
    .join('\n');
  const famRows = Object.entries(summary.families)
    .sort()
    .map(([f, v]) => `<tr><td>${f}</td><td>${v.tools}</td><td>${n(v.mean)}</td><td>${n(v.min)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Gallery compare</title><style>
body{font:13px -apple-system,BlinkMacSystemFont,sans-serif;margin:16px}.imgs{display:flex;gap:8px}figure{margin:0}figure img{width:480px;border:1px solid #ccc}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ddd;padding:2px 6px;text-align:left;vertical-align:top}.bad,.bad td{background:#fde2e2}section{margin-bottom:40px}
</style></head><body><h1>ChartKeeper viewer vs TradingView</h1>
<p>Scores are F1 overlaps of the pixels each side drew; a pixel matches when the other side drew a pixel of similar colour (RGB distance ${MAX_COLOR}) within ${TOLERANCE} px. Drawings: pixels a drawing adds to the drawing-free chart. Panes: non-background pixels of the drawing-free chart.</p>
<table><tr><th>Family</th><th>Tools</th><th>Mean</th><th>Min</th></tr>${famRows}</table>
<p>${reports.map((r) => `<a href="#${r.scene}">${r.scene}</a>`).join(' · ')}</p>
${scenes}</body></html>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
