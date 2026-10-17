import { diffNamed, diffSnapshots, type Change, type LayoutDiff, type NamedItems, type NamedKind } from './diff';
import { parseLayout, type ParsedLayout } from './layout';
import type { ChartData } from './model';
import type { SnapshotReader } from './snapshot';
import { inflateStudyGraphics } from './studyGraphics';

export interface LoadedLayout {
  layout: ParsedLayout;
  /** chartId -> prices and indicator values, or null when none were saved. */
  data: Record<string, ChartData | null>;
}

/** One layout of a snapshot as the viewer shows it, including the drawings synced to all layouts. */
export async function openLayout(reader: SnapshotReader, uid: string): Promise<LoadedLayout> {
  const layout = parseLayout(await reader.layout(uid), await reader.drawings(uid), await reader.userDrawings());
  const data: Record<string, ChartData | null> = {};
  for (const c of layout.charts) {
    const chartData = await reader.chartData(uid, c.chartId);
    data[c.chartId] = chartData && inflateStudyGraphics(chartData);
  }
  return { layout, data };
}

export interface SnapshotComparison {
  layouts: LayoutDiff[];
  /** Templates, themes and Pine scripts. */
  other: Change[];
}

/**
 * What changed between two snapshots. Drawings synced to all layouts belong
 * to the account, not to one layout, so the layout diff leaves them out.
 */
export async function compareSnapshots(older: SnapshotReader, newer: SnapshotReader): Promise<SnapshotComparison> {
  const [a, b] = [await namedItems(older), await namedItems(newer)];
  const byName = (what: Exclude<NamedKind, 'drawing-template'>, before: NamedItems<string>, after: NamedItems<string>) =>
    diffNamed(before, after).map(({ kind, item }): Change => ({ kind, what, name: item }));
  return {
    layouts: diffSnapshots(await parsedLayouts(older), await parsedLayouts(newer)),
    other: [
      ...diffNamed(a.drawingTemplates, b.drawingTemplates).map(({ kind, item }): Change => ({ kind, what: 'drawing-template', ...item })),
      ...byName('study-template', a.studyTemplates, b.studyTemplates),
      ...byName('theme', a.themes, b.themes),
      ...byName('script', a.scripts, b.scripts),
    ],
  };
}

async function parsedLayouts(r: SnapshotReader): Promise<Map<string, ParsedLayout>> {
  const out = new Map<string, ParsedLayout>();
  for (const l of r.manifest.layouts) out.set(l.uid, parseLayout(await r.layout(l.uid), await r.drawings(l.uid)));
  return out;
}

/** A missing file reads as no items. */
async function namedItems(r: SnapshotReader) {
  const byName = (entries: [string, unknown][]): NamedItems<string> => new Map(entries.map(([name, content]) => [name, { item: name, content }]));
  const drawingTemplates: NamedItems<{ name: string; toolType: string }> = new Map();
  for (const [toolType, templates] of Object.entries((await r.drawingTemplates())?.tools ?? {}))
    for (const [name, content] of Object.entries(templates)) drawingTemplates.set(`${toolType}/${name}`, { item: { name, toolType }, content });
  return {
    drawingTemplates,
    studyTemplates: byName(((await r.studyTemplates())?.templates ?? []).map((t) => [String(t.name), t.content])),
    themes: byName(Object.entries((await r.themes())?.themes ?? {})),
    scripts: byName(((await r.scriptsIndex())?.scripts ?? []).map((s) => [s.name, s.version])),
  };
}
