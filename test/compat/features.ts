import type { ParsedDrawing, ParsedLayout } from '../../src/core/layout';
import type { LayoutRecord } from '../../src/core/model';
import { isObj, type Props } from '../../src/core/props';
import { isDrawingType, type TvContent, type TvSource } from '../../src/core/tv/content';
import type { ExpectedDrawing, ExpectedLayout, ExpectedStudy } from './advancedAccount';

/**
 * Where a feature is checked:
 * snapshot     the backup on disk, read back with parseLayout
 * payload      the content ChartKeeper's restore sent to TradingView's save endpoint
 * tradingview  what TradingView's own loader kept, read back with its serializer
 */
export type Stage = 'snapshot' | 'payload' | 'tradingview';

export interface Difference {
  path: string;
  expected: unknown;
  /** undefined: missing. */
  actual: unknown;
}

export interface FeatureCheck {
  layout: string;
  kind: 'layout' | 'chart' | 'drawing' | 'study';
  feature: string;
  differences: Difference[];
}

/**
 * Every value in `expected` must be in `actual` unchanged. TradingView fills
 * in defaults, so extra keys in `actual` are fine; arrays must match item by item.
 */
export function subsetDifferences(expected: unknown, actual: unknown, path = ''): Difference[] {
  if (isObj(expected)) {
    if (!isObj(actual)) return [{ path, expected, actual }];
    return Object.entries(expected).flatMap(([k, v]) => subsetDifferences(v, actual[k], path ? `${path}.${k}` : k));
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return [{ path, expected, actual }];
    return expected.flatMap((v, i) => subsetDifferences(v, actual[i], `${path}[${i}]`));
  }
  return Object.is(expected, actual) ? [] : [{ path, expected, actual }];
}

/**
 * TradingView's loader upgrades these built-in indicators to their Pine
 * versions (seen 2026-10-17). A faithful upgrade keeps each input and plot
 * style under its new name; this table names the matching input and plot.
 */
const LEGACY_TO_PINE: Record<string, { pine: string; inputs: Record<string, string>; styles: Record<string, string> }> = {
  'MASimple@tv-basicstudies-280': { pine: 'Script$STD;SMA@tv-scripting-101', inputs: { length: 'in_0', source: 'in_1' }, styles: { MovAvgSimple: 'plot_0' } },
  'RSI@tv-basicstudies-280': { pine: 'Script$STD;RSI@tv-scripting-101', inputs: { length: 'in_0', source: 'in_1' }, styles: { RelativeStrengthIndex: 'plot_0' } },
};

/** "Script$STD;RSI@tv-scripting-101[v.47.0]" -> "Script$STD;RSI@tv-scripting-101": TradingView bumps Pine versions on its own. */
const withoutVersion = (id: string) => id.replace(/\[v\.[\d.]+\]$/, '');
const renamed = (o: Props, names: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [names[k] ?? k, v]));
const where = (chart: number, pane: number) => `chart ${chart + 1}, pane ${pane + 1}`;
const SHARED = 'shared (placed on restore)';

function expectedStudy(s: ExpectedStudy, stage: Stage) {
  const legacy = stage === 'tradingview' ? LEGACY_TO_PINE[s.metaInfo] : undefined;
  if (!legacy) return { metaInfo: withoutVersion(s.metaInfo), location: where(s.chart, s.pane), inputs: s.inputs, styles: s.styles };
  return { metaInfo: legacy.pine, location: where(s.chart, s.pane), inputs: renamed(s.inputs, legacy.inputs), styles: renamed(s.styles, legacy.styles) };
}

/** A drawing source as the features a user sees: type, place, points, every property, and the top-level fields (z-order, owner, ...). */
function drawingFeatures(source: TvSource, location: string) {
  const { id: _id, type, state, points, ...rest } = source;
  return { type, location, points, state, ...rest };
}

/** The point fields parseLayout reads; the viewer and the diff use these. */
const pointFeatures = (points: unknown) => (Array.isArray(points) ? points : []).map((p: Props) => ({ time_t: p.time_t, offset: p.offset, price: p.price }));

function expectedDrawing(d: ExpectedDrawing, stage: Stage) {
  if (stage !== 'snapshot') return drawingFeatures(d.source, where(d.chart, d.pane));
  return drawingFeatures({ ...d.source, points: pointFeatures(d.source.points) }, d.storedIn === 'storage:_shared' ? SHARED : where(d.chart, d.pane));
}

const duplicatesAndExtras = (ids: string[], expected: Set<string>) => {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].filter(([id, n]) => n > 1 || !expected.has(id)).map(([id, n]) => (n > 1 ? `${id} (${n} times)` : id)).sort();
};

const priceScaleOf = (pane: Props | undefined): unknown => (pane && Array.isArray(pane.rightAxisesState) && isObj(pane.rightAxisesState[0]) ? pane.rightAxisesState[0].state : undefined);
const pick = (o: Props, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));

interface Observed {
  layout: Props;
  charts: Props[];
  drawings: Map<string, Props>;
  studies: Map<string, Props>;
}

function compare(expected: ExpectedLayout, observed: Observed, stage: Stage): FeatureCheck[] {
  const check = (kind: FeatureCheck['kind'], feature: string, want: unknown, got: unknown): FeatureCheck => ({
    layout: expected.uid,
    kind,
    feature,
    differences: got === undefined ? [{ path: '', expected: 'present', actual: undefined }] : subsetDifferences(want, got),
  });
  const layoutWant = { arrangement: expected.arrangement, charts: expected.charts.length, ...expected.settings, unexpectedDrawings: [], unexpectedStudies: [] };
  return [
    check('layout', `layout "${expected.name}"`, layoutWant, observed.layout),
    ...expected.charts.map((c, i) => check('chart', `chart ${i + 1} (${String(c.series.symbol)}, ${String(c.series.interval)})`, c, observed.charts[i])),
    ...expected.studies.map((s) => check('study', `${s.metaInfo} ${s.id}`, expectedStudy(s, stage), observed.studies.get(s.id))),
    ...expected.drawings.map((d) => check('drawing', `${d.type} ${d.id} (${d.storedIn})`, expectedDrawing(d, stage), observed.drawings.get(d.id))),
  ];
}

/** Checks layout content: the restore payload, or what TradingView's serializer returned. */
export function checkContent(expected: ExpectedLayout, content: TvContent, stage: Exclude<Stage, 'snapshot'>): FeatureCheck[] {
  const drawings = new Map<string, Props>();
  const studies = new Map<string, Props>();
  const drawingIds: string[] = [];
  const studyIds: string[] = [];
  const charts = content.charts.map((chart, c) => {
    chart.panes.forEach((pane, p) => {
      for (const s of pane.sources) {
        const id = String(s.id);
        if (isDrawingType(s.type)) {
          drawingIds.push(id);
          drawings.set(id, drawingFeatures(s, where(c, p)));
        } else if (s.metaInfo !== undefined) {
          studyIds.push(id);
          const state = isObj(s.state) ? s.state : {};
          const meta = isObj(s.metaInfo) ? String(s.metaInfo.fullId ?? s.metaInfo.id) : String(s.metaInfo);
          studies.set(id, { metaInfo: withoutVersion(meta), location: where(c, p), inputs: state.inputs, styles: state.styles });
        }
      }
    });
    const series = chart.panes.flatMap((p) => p.sources).find((s) => s.type === 'MainSeries');
    return { chartId: String(chart.chartId ?? c + 1), timezone: chart.timezone, chartProperties: chart.chartProperties, timeScale: chart.timeScale, series: series?.state, priceScale: priceScaleOf(chart.panes[0]) };
  });
  const layout = {
    arrangement: content.layout,
    charts: content.charts.length,
    ...pick(content, Object.keys(expected.settings)),
    unexpectedDrawings: duplicatesAndExtras(drawingIds, new Set(expected.drawings.map((d) => d.id))),
    unexpectedStudies: duplicatesAndExtras(studyIds, new Set(expected.studies.map((s) => s.id))),
  };
  return compare(expected, { layout, charts, drawings, studies }, stage);
}

/** Checks the backup on disk: the layout as parseLayout reads it, plus the content fields parseLayout does not model. */
export function checkSnapshot(expected: ExpectedLayout, record: LayoutRecord, parsed: ParsedLayout, counts: { drawingIds: string[]; studyIds: string[] }): FeatureCheck[] {
  const drawings = new Map<string, Props>();
  const studies = new Map<string, Props>();
  const parsedDrawing = (d: ParsedDrawing, location: string) =>
    drawingFeatures({ ...d.source, type: d.type, state: d.props, points: d.points.map((p) => ({ time_t: p.time, offset: p.offset, price: p.price })) }, location);
  parsed.charts.forEach((chart, c) =>
    chart.panes.forEach((pane, p) => {
      for (const d of pane.drawings) drawings.set(d.id, parsedDrawing(d, where(c, p)));
      for (const s of pane.studies) studies.set(s.id, { metaInfo: withoutVersion(s.metaInfoId), location: where(c, p), inputs: s.inputs, styles: s.styles });
    }),
  );
  for (const d of parsed.sharedDrawings) drawings.set(d.id, parsedDrawing(d, SHARED));
  const charts = parsed.charts.map((chart, c) => ({
    chartId: chart.chartId,
    timezone: chart.timezone,
    chartProperties: chart.chartProperties,
    timeScale: record.content.charts[c]?.timeScale,
    series: chart.seriesState,
    priceScale: priceScaleOf(record.content.charts[c]?.panes[0]),
  }));
  const layout = {
    arrangement: parsed.arrangement,
    charts: parsed.charts.length,
    ...pick(record.content, Object.keys(expected.settings)),
    unexpectedDrawings: duplicatesAndExtras(counts.drawingIds, new Set(expected.drawings.map((d) => d.id))),
    unexpectedStudies: duplicatesAndExtras(counts.studyIds, new Set(expected.studies.map((s) => s.id))),
  };
  return compare(expected, { layout, charts, drawings, studies }, 'snapshot');
}
