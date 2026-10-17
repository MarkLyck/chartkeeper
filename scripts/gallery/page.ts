/** Browser side of scripts/gallery-compare.ts: renders a scene with the viewer and measures it against TradingView's captures. */
import type { ParsedLayout } from '../../src/core/layout';
import type { ChartData } from '../../src/core/model';
import { planLayout, renderLayout, type RenderOptions, type RenderedLayout } from '../../src/renderer/viewer';
import {
  bboxDistance,
  colorDistance,
  diffMask,
  dominantColor,
  findEventsButton,
  findLegendHighlight,
  foregroundMask,
  overlap,
  overlayImage,
  shape,
  type Img,
  type Rect,
  type Rgb,
} from '../../test/gallery/pixels';

export interface SceneInput {
  layout: ParsedLayout;
  data: Record<string, ChartData | null>;
  options: RenderOptions;
}

export interface PaneInfo {
  rect: Rect;
  main: boolean;
  /** metaInfo ids of the indicators drawn in the pane. */
  studies: string[];
}

export interface RenderInfo {
  notShown: { id: string; kind: string; name: string; message: string; partial: boolean }[];
  rendered: { chartId: string; drawings: string[]; studies: string[] }[];
  panes: PaneInfo[];
}

export interface AnalyzeInput {
  tv: { full: string; base: string; drawings: Record<string, string> };
  viewer: { full: string; base: string; drawings: Record<string, string> };
  panes: Rect[];
  background: Rgb;
  ignore: Rect[];
  /** Colour difference that counts as "drawn" in drawing masks (captures are lossless). */
  drawingThreshold: number;
  /** Colour difference from the background that counts as foreground (above the faint grid). */
  foregroundThreshold: number;
  tolerance: number;
  /** RGB distance within which two pixels count as the same colour. */
  maxColor: number;
}

export interface MaskScore {
  f1: number;
  precision: number;
  recall: number;
  tvPixels: number;
  viewerPixels: number;
}

export interface DrawingResult extends MaskScore {
  id: string;
  centroidDistance: number | null;
  bboxDistance: number | null;
  tvColor: Rgb | null;
  viewerColor: Rgb | null;
  colorDistance: number | null;
  overlay: string;
}

export interface AnalyzeResult {
  drawings: DrawingResult[];
  panes: MaskScore[];
  full: MaskScore & { overlay: string };
  base: { overlay: string };
  sideBySide: string;
}

let current: { input: SceneInput; rendered: RenderedLayout | null } | null = null;

function withOnly(layout: ParsedLayout, only: readonly string[] | null): ParsedLayout {
  if (!only) return layout;
  const keep = new Set(only);
  return {
    ...layout,
    sharedDrawings: layout.sharedDrawings.filter((d) => keep.has(d.id)),
    charts: layout.charts.map((c) => ({ ...c, panes: c.panes.map((p) => ({ ...p, drawings: p.drawings.filter((d) => keep.has(d.id)) })) })),
  };
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** The plot area of each pane, from lightweight-charts' table: one row per pane with the canvas cell in the middle. */
function paneRects(root: HTMLElement): Rect[] {
  const origin = root.getBoundingClientRect();
  const rows = [...root.querySelectorAll('table tr')] as HTMLTableRowElement[];
  const out: Rect[] = [];
  for (const row of rows) {
    if (row.cells.length !== 3) continue;
    const cell = row.cells[1]!;
    if (!cell.querySelector('canvas')) continue;
    const r = cell.getBoundingClientRect();
    if (r.height < 4) continue;
    out.push({ x: Math.round(r.left - origin.left), y: Math.round(r.top - origin.top), w: Math.round(r.width), h: Math.round(r.height) });
  }
  // The last row with three cells is the time axis.
  return out.slice(0, -1);
}

async function render(only: string[] | null): Promise<RenderInfo> {
  if (!current) throw new Error('load() first');
  current.rendered?.destroy();
  const root = document.getElementById('root')!;
  const layout = withOnly(current.input.layout, only);
  current.rendered = renderLayout(root, layout, current.input.data, current.input.options);
  for (let i = 0; i < 4; i++) await frame();
  await new Promise((r) => setTimeout(r, 80));
  await frame();
  const plan = planLayout(layout, current.input.data);
  const rects = paneRects(root);
  const chartPlan = plan.charts[0];
  return {
    notShown: current.rendered.notShown,
    rendered: plan.charts.map((c) => ({ chartId: c.chart.chartId, ...c.rendered })),
    panes: (chartPlan?.panes ?? []).map((p, i) => ({ rect: rects[i] ?? { x: 0, y: 0, w: 0, h: 0 }, main: p.main, studies: p.studies.map((s) => s.study.metaInfoId) })),
  };
}

async function decode(url: string): Promise<Img> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return { width: bmp.width, height: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

async function canvasUrl(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

async function encode(img: Img): Promise<string> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvasUrl(canvas);
}

/** TradingView left, the viewer right, each under a caption. */
async function sideBySide(tvUrl: string, viewerUrl: string): Promise<string> {
  const [tv, viewer] = await Promise.all([tvUrl, viewerUrl].map(async (u) => createImageBitmap(await (await fetch(u)).blob())));
  const gap = 12;
  const caption = 34;
  const canvas = new OffscreenCanvas(tv!.width + viewer!.width + gap * 3, Math.max(tv!.height, viewer!.height) + caption + gap);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f0f3fa';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#131722';
  ctx.font = `600 17px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('TradingView', gap, caption / 2 + 2);
  ctx.fillText('ChartKeeper (offline viewer)', tv!.width + gap * 2, caption / 2 + 2);
  ctx.drawImage(tv!, gap, caption);
  ctx.drawImage(viewer!, tv!.width + gap * 2, caption);
  return canvasUrl(canvas);
}

async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  let job = input;
  const [tvBase, viewerBase, tvFull, viewerFull] = await Promise.all([decode(job.tv.base), decode(job.viewer.base), decode(job.tv.full), decode(job.viewer.full)]);
  const { width: w, height: h } = tvBase;
  const main = job.panes[0];
  const button = main ? findEventsButton(tvBase, { x: 0, y: main.y + main.h - 50, w: main.w, h: 56 }) : null;
  job = { ...job, ignore: button ? [...job.ignore, button] : job.ignore };

  const drawings: DrawingResult[] = [];
  for (const [id, tvUrl] of Object.entries(job.tv.drawings)) {
    const viewerUrl = job.viewer.drawings[id];
    const tvImg = await decode(tvUrl);
    const raw = diffMask(tvImg, tvBase, job.drawingThreshold, job.ignore);
    const legend = findLegendHighlight(raw, w);
    const ignore = legend ? [...job.ignore, legend] : job.ignore;
    const tvMask = legend ? diffMask(tvImg, tvBase, job.drawingThreshold, ignore) : raw;
    const viewerImg = viewerUrl ? await decode(viewerUrl) : viewerBase;
    const viewerMask = diffMask(viewerImg, viewerBase, job.drawingThreshold, ignore);
    const s = overlap(tvImg, tvMask, viewerImg, viewerMask, job.tolerance, job.maxColor);
    const ts = shape(tvMask, w, h);
    const vs = shape(viewerMask, w, h);
    const tvColor = dominantColor(tvImg, tvMask);
    const viewerColor = dominantColor(viewerImg, viewerMask);
    drawings.push({
      id,
      ...s,
      centroidDistance: ts.centroid && vs.centroid ? Math.hypot(ts.centroid.x - vs.centroid.x, ts.centroid.y - vs.centroid.y) : null,
      bboxDistance: bboxDistance(ts.bbox, vs.bbox),
      tvColor,
      viewerColor,
      colorDistance: colorDistance(tvColor, viewerColor),
      overlay: await encode(overlayImage(tvBase, tvMask, viewerMask)),
    });
  }

  const panes = job.panes.map((rect) => {
    const tvMask = foregroundMask(tvBase, job.background, job.foregroundThreshold, job.ignore, rect);
    const viewerMask = foregroundMask(viewerBase, job.background, job.foregroundThreshold, job.ignore, rect);
    return overlap(tvBase, tvMask, viewerBase, viewerMask, job.tolerance, job.maxColor);
  });

  const fullRect = { x: 0, y: 0, w, h };
  const tvAll = foregroundMask(tvFull, job.background, job.foregroundThreshold, job.ignore, fullRect);
  const viewerAll = foregroundMask(viewerFull, job.background, job.foregroundThreshold, job.ignore, fullRect);
  const tvBaseMask = foregroundMask(tvBase, job.background, job.foregroundThreshold, job.ignore, fullRect);
  const viewerBaseMask = foregroundMask(viewerBase, job.background, job.foregroundThreshold, job.ignore, fullRect);
  return {
    drawings,
    panes,
    full: { ...overlap(tvFull, tvAll, viewerFull, viewerAll, job.tolerance, job.maxColor), overlay: await encode(overlayImage(tvFull, tvAll, viewerAll)) },
    base: { overlay: await encode(overlayImage(tvBase, tvBaseMask, viewerBaseMask)) },
    sideBySide: await sideBySide(job.tv.full, job.viewer.full),
  };
}

(window as unknown as { ck: unknown }).ck = {
  load(input: SceneInput) {
    current?.rendered?.destroy();
    current = { input, rendered: null };
  },
  render,
  analyze,
};
