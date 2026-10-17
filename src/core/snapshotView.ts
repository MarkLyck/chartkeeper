import { diffNamed, diffSnapshots, type Change, type LayoutDiff } from './diff';
import { parseLayout, type ParsedLayout } from './layout';
import type { ChartData } from './model';
import type { SnapshotReader } from './snapshot';

export interface LoadedLayout {
  layout: ParsedLayout;
  /** chartId -> prices and indicator values, or null when none were saved. */
  data: Record<string, ChartData | null>;
}

/** One layout of a snapshot as the viewer shows it, including the drawings synced to all layouts. */
export async function openLayout(reader: SnapshotReader, uid: string): Promise<LoadedLayout> {
  const layout = parseLayout(await reader.layout(uid), await reader.drawings(uid), await reader.userDrawings());
  const data: Record<string, ChartData | null> = {};
  for (const c of layout.charts) data[c.chartId] = await reader.chartData(uid, c.chartId);
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
  const layouts = async (r: SnapshotReader) => {
    const out = new Map<string, ParsedLayout>();
    for (const l of r.manifest.layouts) out.set(l.uid, parseLayout(await r.layout(l.uid), await r.drawings(l.uid)));
    return out;
  };
  const named = async (r: SnapshotReader) => {
    const [tools, studies, themes, scripts] = [await r.drawingTemplates(), await r.studyTemplates(), await r.themes(), await r.scriptsIndex()];
    return {
      drawingTemplates: Object.fromEntries(Object.entries(tools?.tools ?? {}).flatMap(([tool, t]) => Object.entries(t).map(([n, c]) => [`${n} (${tool.replace('LineTool', '')})`, c]))),
      studyTemplates: Object.fromEntries((studies?.templates ?? []).map((t) => [String(t.name), t.content])),
      themes: themes?.themes ?? {},
      scripts: Object.fromEntries((scripts?.scripts ?? []).map((s) => [s.name, s.version])),
    };
  };
  const [a, b] = [await named(older), await named(newer)];
  return {
    layouts: diffSnapshots(await layouts(older), await layouts(newer)),
    other: [
      ...diffNamed('Drawing template', a.drawingTemplates, b.drawingTemplates),
      ...diffNamed('Indicator template', a.studyTemplates, b.studyTemplates),
      ...diffNamed('Theme', a.themes, b.themes),
      ...diffNamed('Pine script', a.scripts, b.scripts),
    ],
  };
}
