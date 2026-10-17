import { countLayout, parseLayout } from './layout';
import type { DrawingBucket, DrawingsRecord, ManifestLayout } from './model';
import { layoutDir, SnapshotWriter, type ManifestBody } from './snapshot';
import type { LayoutListEntry, TvClient } from './tv/client';
import { fetchChartData, type SocketFactory } from './tv/datafeed';
import { TvError, type TvErrorKind } from './tv/errors';

export interface BackupOptions {
  root: string;
  appVersion: string;
  /** Also save prices and indicator values for the offline viewer. */
  includePrices: boolean;
  bars: number;
  authToken: string | null;
  socketFactory: SocketFactory;
  onProgress?: (p: BackupProgress) => void;
  now?: Date;
  /** Pause between price requests (default 1.5 s). */
  pauseMs?: number;
}

export type BackupStep = 'list' | 'layout' | 'userDrawings' | 'studyTemplates' | 'drawingTemplates' | 'scripts' | 'prices' | 'finish';

export interface BackupProgress {
  done: number;
  total: number;
  step: BackupStep;
  /** Layout name, for the 'layout' and 'prices' steps. */
  name?: string;
}

export interface BackupResult {
  dir: string;
  ok: boolean;
  layouts: number;
  drawings: number;
  warnings: string[];
  error: { kind: TvErrorKind | 'unexpected'; message: string; params: Record<string, string | number> } | null;
}

const safeFileName = (s: string) => s.replace(/[^\p{L}\p{N} _.-]/gu, '_').slice(0, 80) || 'script';

/**
 * Reads one layout and all of its drawings. Throws when TradingView's answer
 * would make the copy incomplete, e.g. drawings reported but not sent (which
 * happens when the session cookies are missing: the storage then answers with
 * an empty success).
 */
export async function captureLayout(client: TvClient, entry: LayoutListEntry) {
  const record = await client.getLayout(entry);
  const token = await client.chartToken(record.uid);
  const chartIds = (record.content.charts as Record<string, unknown>[]).map((c, i) => String(c.chartId ?? i + 1));
  const buckets: Record<string, DrawingBucket> = {};
  for (const chartId of [...chartIds, '_shared']) buckets[chartId] = await client.drawingBucket(record.uid, chartId, token);
  const reportedTotal = await client.drawingCount(record.uid, token);
  const drawings: DrawingsRecord = { buckets, reportedTotal };
  const fetched = Object.values(buckets).reduce((n, b) => n + Object.keys(b.sources).length, 0);
  if (reportedTotal !== null && reportedTotal > 0 && fetched === 0)
    throw new TvError('format-changed', `TradingView says "${entry.name}" has ${reportedTotal} drawings but sent none. The backup was stopped so it isn't saved without them.`);
  const layout = parseLayout(record, drawings);
  if (layout.problems.length) throw new TvError('format-changed', `Some drawings in "${entry.name}" have an unknown format.`, layout.problems.join('\n'));
  return { record, drawings, layout, token };
}

/**
 * Takes one snapshot of everything in the account. Only reads from
 * TradingView. Layout and drawing failures stop the run and mark the snapshot
 * INCOMPLETE; a symbol whose prices can't be loaded only adds a warning,
 * because the layout itself is still fully backed up.
 */
export async function runBackup(client: TvClient, opts: BackupOptions): Promise<BackupResult> {
  const writer = await SnapshotWriter.begin(opts.root, opts.now);
  const warnings: string[] = [];
  const layouts: ManifestLayout[] = [];
  const extras = { studyTemplates: 0, drawingTemplates: 0, themes: 0, scripts: 0, userDrawings: 0 };
  const body = (): ManifestBody => ({
    app: { name: 'ChartKeeper', version: opts.appVersion },
    createdAt: (opts.now ?? new Date()).toISOString(),
    account: { username: client.username, plan: client.plan },
    layouts,
    extras,
    warnings,
  });
  const progress = (done: number, total: number, step: BackupStep, name?: string) => opts.onProgress?.({ done, total, step, ...(name === undefined ? {} : { name }) });

  try {
    progress(0, 1, 'list');
    const entries = await client.listLayouts();
    await writer.writeJson('account.json', { username: client.username, plan: client.plan, layoutList: entries.map((e) => e.raw) });
    const steps = entries.length * (opts.includePrices ? 2 : 1) + 4;
    let step = 0;

    let firstToken: { uid: string; token: string } | null = null;
    const parsedForPrices: { entry: LayoutListEntry; dir: string; layout: ReturnType<typeof parseLayout> }[] = [];

    for (const entry of entries) {
      progress(++step, steps, 'layout', entry.name);
      const { record, drawings, layout, token } = await captureLayout(client, entry);
      firstToken ??= { uid: record.uid, token };
      const fetched = Object.values(drawings.buckets).reduce((n, b) => n + Object.keys(b.sources).length, 0);
      if (drawings.reportedTotal !== null && fetched < drawings.reportedTotal)
        warnings.push(`"${entry.name}": TradingView reports ${drawings.reportedTotal} drawings, ChartKeeper received ${fetched}.`);
      const counts = countLayout(layout);
      const dir = layoutDir(record.uid);
      await writer.writeJson(`${dir}/layout.json`, record);
      await writer.writeJson(`${dir}/drawings.json`, drawings);
      layouts.push({ uid: record.uid, name: record.name, dir, symbols: counts.symbols, charts: counts.charts, drawings: counts.drawings, studies: counts.studies, lastModified: record.lastModified, priceData: false });
      parsedForPrices.push({ entry, dir, layout });
    }

    if (firstToken) {
      progress(++step, steps, 'userDrawings');
      const user = await client.userDrawings(firstToken.uid, firstToken.token);
      extras.userDrawings = Object.keys(user.sources).length;
      await writer.writeJson('user-drawings.json', user);
    }

    progress(++step, steps, 'studyTemplates');
    const studyTemplates = await client.studyTemplates();
    extras.studyTemplates = studyTemplates.length;
    await writer.writeJson('templates/study-templates.json', { templates: studyTemplates });

    progress(++step, steps, 'drawingTemplates');
    const tools = await client.drawingTemplates();
    extras.drawingTemplates = Object.values(tools).reduce((n, t) => n + Object.keys(t).length, 0);
    await writer.writeJson('templates/drawing-templates.json', { tools });
    const themes = await client.themes();
    extras.themes = Object.keys(themes).length;
    await writer.writeJson('templates/themes.json', { themes });

    progress(++step, steps, 'scripts');
    const scripts = await client.pineScripts();
    const index = [];
    const used = new Set<string>();
    for (const s of scripts) {
      let file = `scripts/${safeFileName(s.name)}.pine`;
      for (let i = 2; used.has(file); i++) file = `scripts/${safeFileName(s.name)} (${i}).pine`;
      used.add(file);
      await writer.writeText(file, s.source);
      index.push({ id: s.id, name: s.name, version: s.version, file, meta: s.meta });
    }
    extras.scripts = scripts.length;
    await writer.writeJson('scripts/index.json', { scripts: index });

    if (opts.includePrices) {
      for (const { entry, dir, layout } of parsedForPrices) {
        progress(++step, steps, 'prices', entry.name);
        let allCharts = true;
        for (const chart of layout.charts) {
          const studies = chart.panes.flatMap((p) => p.studies).filter((s) => s.metaInfoId);
          try {
            const data = await fetchChartData(chart, studies, opts.socketFactory, { authToken: opts.authToken, bars: opts.bars, studyPauseMs: opts.pauseMs === undefined ? 500 : opts.pauseMs / 3 });
            if (data.bars.length === 0) throw new Error('no prices returned');
            await writer.writeJson(`${dir}/data/chart-${chart.chartId}.json`, data);
            for (const [id, s] of Object.entries(data.studies)) if (s.status === 'error') warnings.push(`"${entry.name}", ${chart.shortName}: indicator ${id} could not be calculated (${s.error}).`);
          } catch (e) {
            allCharts = false;
            warnings.push(`"${entry.name}": prices for ${chart.symbol} (${chart.interval}) could not be saved: ${(e as Error).message}`);
          }
          await new Promise((r) => setTimeout(r, opts.pauseMs ?? 1500));
        }
        const m = layouts.find((l) => l.uid === layout.uid);
        if (m) m.priceData = allCharts;
      }
    }

    progress(steps, steps, 'finish');
    const dir = await writer.finish(body());
    return { dir, ok: true, layouts: layouts.length, drawings: layouts.reduce((n, l) => n + l.drawings, 0), warnings, error: null };
  } catch (e) {
    const message = e instanceof TvError ? e.message : `The backup stopped because of an unexpected error: ${(e as Error).message}`;
    const detail = e instanceof TvError && e.detail ? `\n${e.detail}` : '';
    const dir = await writer.fail(body(), message + detail);
    const error = { kind: e instanceof TvError ? e.kind : ('unexpected' as const), message, params: e instanceof TvError ? e.params : {} };
    return { dir, ok: false, layouts: layouts.length, drawings: layouts.reduce((n, l) => n + l.drawings, 0), warnings, error };
  }
}
