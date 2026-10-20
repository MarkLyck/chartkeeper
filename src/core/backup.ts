import { parseLayout } from './layout';
import type { DrawingBucket, DrawingsRecord, DrawingTemplatesFile, ManifestLayout, ScriptsIndex, StudyTemplatesFile, ThemesFile } from './model';
import { APP_NAME, layoutFiles, noExtras, SNAPSHOT_FILES, SnapshotWriter, type ManifestBody, fileNameKey } from './snapshot';
import type { LayoutListEntry, OnEach, TvClient } from './tv/client';
import { chartIdOf } from './tv/content';
import { TEMPLATE_TOOLS } from './tv/endpoints';
import type { BackupProgress, BackupStep } from './backupProgress';
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

/** Requests a part of the backup is expected to take before its real size is known. A chart's prices take about as long as three requests. */
const COST = { layout: 5, list: 1, chartPrices: 3 } as const;

interface BackupSummary {
  dir: string;
  layouts: number;
  drawings: number;
  warnings: string[];
}

/** A failed run still names its INCOMPLETE folder and what it got through. */
export type BackupResult =
  | (BackupSummary & { ok: true })
  | (BackupSummary & { ok: false; error: { kind: TvErrorKind | 'unexpected'; message: string; params: Record<string, string | number> } });

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
  const sizes = await client.drawingSizes(record.uid, token);
  const buckets: Record<string, DrawingBucket> = {};
  for (const chartId of new Set([...record.content.charts.map(chartIdOf), ...sizes.chartIds, '_shared'])) buckets[chartId] = await client.drawingBucket(record.uid, chartId, token);
  const reportedTotal = sizes.total;
  const drawings: DrawingsRecord = { buckets, reportedTotal };
  const fetched = Object.values(buckets).reduce((n, b) => n + Object.keys(b.sources).length, 0);
  if (reportedTotal !== null && fetched < reportedTotal)
    throw new TvError(
      'format-changed',
      `TradingView says "${entry.name}" has ${reportedTotal} drawings but sent ${fetched}. The backup was stopped so it isn't saved without them.`,
      '',
      { name: entry.name, reported: reportedTotal, received: fetched },
    );
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
  const extras = noExtras();
  const body = (): ManifestBody => ({
    app: { name: APP_NAME, version: opts.appVersion },
    createdAt: (opts.now ?? new Date()).toISOString(),
    account: { username: client.username, plan: client.plan },
    layouts,
    extras,
    warnings,
  });
  const meter = { done: 0, total: 0 };
  /**
   * Starts a step expected to take `expected` requests. Its `each` follows a
   * list as it is fetched (`fixed` requests for the list, `unit` per item)
   * and corrects the total once the real length is known.
   */
  const begin = (step: BackupStep, expected: number, at: Pick<BackupProgress, 'name' | 'part'> = {}) => {
    const start = meter.done;
    const { name } = at;
    let cost = expected;
    let part = at.part;
    const say = () => opts.onProgress?.({ step, ...(name === undefined ? {} : { name }), ...(part ? { part } : {}), done: meter.done, total: meter.total });
    say();
    return {
      each: (fixed: number, unit = 1): OnEach => (done, total) => {
        meter.total += fixed + total * unit - cost;
        cost = fixed + total * unit;
        meter.done = start + fixed + done * unit;
        part = { done, total };
        say();
      },
      end: () => void (meter.done = start + cost),
    };
  };
  /** A step that fetches a list (`fixed` requests) and then each item on it. `expected` is what the total already counts for it. */
  const step = async <T>(name: BackupStep, run: (each: OnEach) => Promise<T>, fixed: number = COST.list, expected = fixed): Promise<T> => {
    const s = begin(name, expected);
    const value = await run(s.each(fixed));
    s.end();
    return value;
  };

  try {
    begin('list', 0);
    const entries = await client.listLayouts();
    await writer.writeJson(SNAPSHOT_FILES.account, { username: client.username, plan: client.plan, layoutList: entries.map((e) => e.raw) });
    const userDrawings = entries.length ? 1 : 0;
    const lists = 3 * COST.list; // study templates, themes and scripts
    meter.total = entries.length * (COST.layout + (opts.includePrices ? COST.chartPrices : 0)) + userDrawings + lists + TEMPLATE_TOOLS.length;

    let firstToken: { uid: string; token: string } | null = null;
    const parsedForPrices: { entry: LayoutListEntry; dir: string; layout: ReturnType<typeof parseLayout> }[] = [];

    for (const [i, entry] of entries.entries()) {
      const s = begin('layout', COST.layout, { name: entry.name, part: { done: i, total: entries.length } });
      const captured = await captureLayout(client, entry);
      firstToken ??= { uid: captured.record.uid, token: captured.token };
      const manifestLayout = await writer.addLayout(captured);
      layouts.push(manifestLayout);
      parsedForPrices.push({ entry, dir: manifestLayout.dir, layout: captured.layout });
      s.end();
    }

    if (firstToken) {
      const user = await step('userDrawings', () => client.userDrawings(firstToken.uid, firstToken.token));
      extras.userDrawings = Object.keys(user.sources).length;
      await writer.writeJson(SNAPSHOT_FILES.userDrawings, user);
    }

    const studyTemplates = await step('studyTemplates', (each) => client.studyTemplates(each));
    extras.studyTemplates = studyTemplates.length;
    await writer.writeJson(SNAPSHOT_FILES.studyTemplates, { templates: studyTemplates } satisfies StudyTemplatesFile);

    const tools = await step('drawingTemplates', (each) => client.drawingTemplates(each), 0, TEMPLATE_TOOLS.length);
    extras.drawingTemplates = Object.values(tools).reduce((n, t) => n + Object.keys(t).length, 0);
    await writer.writeJson(SNAPSHOT_FILES.drawingTemplates, { tools } satisfies DrawingTemplatesFile);

    const themes = await step('themes', (each) => client.themes(each));
    extras.themes = Object.keys(themes).length;
    await writer.writeJson(SNAPSHOT_FILES.themes, { themes } satisfies ThemesFile);

    const scripts = await step('scripts', (each) => client.pineScripts(each));
    const index: ScriptsIndex['scripts'] = [];
    const used = new Set<string>();
    for (const s of scripts) {
      let file = `scripts/${safeFileName(s.name)}.pine`;
      for (let i = 2; used.has(fileNameKey(file)); i++) file = `scripts/${safeFileName(s.name)} (${i}).pine`;
      used.add(fileNameKey(file));
      await writer.writeText(file, s.source);
      index.push({ id: s.id, name: s.name, version: s.version, file, meta: s.meta });
    }
    extras.scripts = scripts.length;
    await writer.writeJson(SNAPSHOT_FILES.scriptsIndex, { scripts: index } satisfies ScriptsIndex);

    if (opts.includePrices) {
      for (const { entry, dir, layout } of parsedForPrices) {
        const s = begin('prices', COST.chartPrices, { name: entry.name });
        const each = s.each(0, COST.chartPrices);
        each(0, layout.charts.length);
        let allCharts = true;
        for (const [i, chart] of layout.charts.entries()) {
          const studies = chart.panes.flatMap((p) => p.studies).filter((s) => s.metaInfoId);
          try {
            const data = await fetchChartData(chart, studies, opts.socketFactory, { authToken: opts.authToken, bars: opts.bars, studyPauseMs: opts.pauseMs === undefined ? 500 : opts.pauseMs / 3 });
            if (data.bars.length === 0) throw new Error('no prices returned');
            await writer.writeJson(layoutFiles(dir).chartData(chart.chartId), data);
            for (const [id, s] of Object.entries(data.studies)) if (s.status === 'error') warnings.push(`"${entry.name}", ${chart.shortName}: indicator ${id} could not be calculated (${s.error}).`);
          } catch (e) {
            allCharts = false;
            warnings.push(`"${entry.name}": prices for ${chart.symbol} (${chart.interval}) could not be saved: ${(e as Error).message}`);
          }
          await new Promise((r) => setTimeout(r, opts.pauseMs ?? 1500));
          each(i + 1, layout.charts.length);
        }
        s.end();
        const m = layouts.find((l) => l.uid === layout.uid);
        if (m) m.priceData = allCharts;
      }
    }

    meter.done = meter.total;
    begin('finish', 0);
    const dir = await writer.finish(body());
    return { dir, ok: true, layouts: layouts.length, drawings: layouts.reduce((n, l) => n + l.drawings, 0), warnings };
  } catch (e) {
    const message = e instanceof TvError ? e.message : `The backup stopped because of an unexpected error: ${(e as Error).message}`;
    const detail = e instanceof TvError && e.detail ? `\n${e.detail}` : '';
    const dir = await writer.fail(body(), message + detail);
    const error = { kind: e instanceof TvError ? e.kind : ('unexpected' as const), message, params: e instanceof TvError ? e.params : {} };
    return { dir, ok: false, layouts: layouts.length, drawings: layouts.reduce((n, l) => n + l.drawings, 0), warnings, error };
  }
}
