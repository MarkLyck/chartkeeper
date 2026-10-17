import { promises as fs } from 'node:fs';
import path from 'node:path';
import { captureLayout } from './backup';
import { countLayout, parseLayout, type LayoutCounts } from './layout';
import type { DrawingsRecord, LayoutRecord } from './model';
import { APP_NAME, noExtras, SNAPSHOT_FILES, SnapshotWriter, type SnapshotReader } from './snapshot';
import type { LayoutListEntry, TvClient } from './tv/client';
import { chartIdOf, drawingSourceFromStored, isDrawingType, mainSeriesOf, placeDrawing, placeShared, type TvContent } from './tv/content';
import { TvError } from './tv/errors';

export type RestoreStep = 'check' | 'create' | 'safetyCopy' | 'replace' | 'clearDrawings' | 'verify';

export type RestoreMode = { kind: 'new' } | { kind: 'replace'; targetUid: string; confirmedByUser: true };

export interface RestoreCheck {
  ok: boolean;
  expected: LayoutCounts;
  actual: LayoutCounts;
  missingDrawings: string[];
  extraDrawings: string[];
}

export interface RestoreResult {
  uid: string;
  name: string;
  url: string;
  check: RestoreCheck;
  /** Folder with a copy of the replaced layout as it was just before the restore. */
  safetyBackup: string | null;
  /** True when a previous, interrupted run had already created the layout. */
  resumed: boolean;
}

/**
 * The layout content to send to TradingView: the backed-up content with every
 * drawing from the drawing storage put back into the pane it belongs to.
 * This is the format TradingView's own saver writes when its drawing storage
 * is unavailable, and its loader reads it back (see docs/INVESTIGATION.md).
 */
export function contentWithDrawings(record: LayoutRecord, drawings: DrawingsRecord): TvContent {
  const content = structuredClone(record.content);
  const present = new Set(content.charts.flatMap((c) => c.panes.flatMap((p) => p.sources.filter((s) => isDrawingType(s.type)).map((s) => s.id))));
  for (const [bucketId, bucket] of Object.entries(drawings.buckets)) {
    for (const [id, stored] of Object.entries(bucket.sources)) {
      const source = drawingSourceFromStored(id, stored);
      if (present.has(source.id)) continue;
      present.add(source.id);
      const at = placeDrawing(content, bucketId, source);
      const { chart, pane } = at === 'shared' ? placeShared(content, source) : at;
      content.charts[chart]!.panes[pane]!.sources.push(source);
    }
  }
  return content;
}

/** The symbol fields the save request carries, from the list entry or else the active chart's price series. */
export function symbolFields(record: LayoutRecord): Record<string, string> {
  const e = record.listEntry;
  const first = record.content.charts[0];
  const series: Record<string, unknown> = (first && mainSeriesOf(first)?.state) ?? {};
  const symbol = String(e.symbol ?? series.symbol ?? '');
  const exchange = symbol.includes(':') ? symbol.split(':')[0]! : '';
  const pick = (k: string, fallback: string) => (typeof e[k] === 'string' && e[k] ? String(e[k]) : fallback);
  return {
    resolution: pick('resolution', pick('interval', String(series.interval ?? 'D'))),
    symbol_type: pick('symbol_type', 'stock'),
    exchange: pick('exchange', exchange),
    listed_exchange: pick('listed_exchange', exchange),
    symbol,
    short_name: pick('short_name', pick('short_symbol', String(series.shortName ?? symbol.split(':').pop() ?? ''))),
    legs: typeof e.legs === 'string' ? e.legs : JSON.stringify(Array.isArray(e.legs) ? e.legs : [{ symbol, pro_symbol: symbol }]),
  };
}

export function restoredName(name: string, at: Date, word = 'restored'): string {
  return `${name} (${word} ${at.toISOString().slice(0, 10)})`;
}

/** The complete form for TradingView's save request. */
export function saveForm(record: LayoutRecord, drawings: DrawingsRecord, name: string): Record<string, string> {
  const content = contentWithDrawings(record, drawings);
  return {
    ...symbolFields(record),
    name,
    description: record.description,
    is_realtime: '1',
    content: JSON.stringify({ ...content, name }),
    study_meta_info_map: JSON.stringify(record.studyMetaInfoMap),
  };
}

export function compareCounts(expected: LayoutCounts, actual: LayoutCounts): RestoreCheck {
  const have = new Set(actual.drawingIds);
  const want = new Set(expected.drawingIds);
  const missingDrawings = expected.drawingIds.filter((id) => !have.has(id));
  const extraDrawings = actual.drawingIds.filter((id) => !want.has(id));
  const ok = missingDrawings.length === 0 && extraDrawings.length === 0 && actual.studies === expected.studies && actual.charts === expected.charts;
  return { ok, expected, actual, missingDrawings, extraDrawings };
}

interface JournalEntry {
  key: string;
  createdUid: string;
  name: string;
  at: string;
  /** Set once the restore was checked. Only unfinished restores are picked up again. */
  finished: boolean;
}

/**
 * Remembers the layout a "new" restore is creating, so running it again after
 * a crash or a lost answer finishes that layout instead of making a copy.
 * A finished restore is never picked up again: restoring twice on purpose
 * makes two copies.
 */
export class RestoreJournal {
  constructor(private readonly file: string) {}

  static key(snapshotDir: string, sourceUid: string, mode: RestoreMode) {
    return `${path.basename(snapshotDir)}|${sourceUid}|${mode.kind === 'new' ? 'new' : `replace:${mode.targetUid}`}`;
  }

  async get(key: string): Promise<JournalEntry | null> {
    return (await this.read()).find((e) => e.key === key) ?? null;
  }

  async put(entry: JournalEntry): Promise<void> {
    const all = (await this.read()).filter((e) => e.key !== entry.key);
    all.push(entry);
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }

  private async read(): Promise<JournalEntry[]> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as JournalEntry[];
    } catch {
      return [];
    }
  }
}

export interface RestoreOptions {
  /** Backup folder; the safety copy of a replaced layout goes in <root>/safety-copies. */
  root: string;
  journal: RestoreJournal;
  buildTime: string | null;
  now?: Date;
  onProgress?: (step: RestoreStep, name?: string) => void;
  /** Word used in the new layout's name, in the user's language. */
  restoredWord?: string;
}

/**
 * Recreates one layout from a snapshot on TradingView.
 *
 * "new" never touches existing layouts. "replace" requires the caller to pass
 * `confirmedByUser: true`, which the app only does after the user confirmed
 * by name, and it first saves a safety copy of the layout it overwrites.
 * Afterwards the restored layout is read back and compared with the backup.
 */
export async function restoreLayout(client: TvClient, snapshot: SnapshotReader, sourceUid: string, mode: RestoreMode, opts: RestoreOptions): Promise<RestoreResult> {
  const say = opts.onProgress ?? (() => undefined);
  const record = await snapshot.layout(sourceUid);
  const drawings = await snapshot.drawings(sourceUid);
  const expected = countLayout(parseLayout(record, drawings));
  const key = RestoreJournal.key(snapshot.dir, sourceUid, mode);
  const now = opts.now ?? new Date();

  say('check');
  const list = await client.listLayouts();
  const previous = await opts.journal.get(key);
  let uid: string;
  let name: string;
  let safetyBackup: string | null = null;
  let resumed = false;

  // A "new" restore records its planned name before saving; if the answer to
  // the save was lost, the layout with that name is the one it created.
  // "replace" is never picked up: overwriting again is what the user asked for.
  const unfinished = mode.kind === 'new' && previous && !previous.finished ? previous : null;
  const adopted = unfinished ? list.find((e) => (unfinished.createdUid ? e.uid === unfinished.createdUid : e.name === unfinished.name)) : undefined;
  if (unfinished && adopted) {
    uid = adopted.uid;
    name = adopted.name;
    resumed = true;
  } else if (mode.kind === 'new') {
    const slots = await client.slots(list.length);
    if (!slots.free)
      throw new TvError(
        'limit-reached',
        `Your TradingView plan${slots.plan ? ` (${slots.plan})` : ''} allows ${slots.limit} saved layout${slots.limit === 1 ? '' : 's'}, and all are in use. To restore as a new layout, delete a layout on TradingView or upgrade your plan. Or choose "Replace an existing layout".`,
        '',
        { limit: slots.limit ?? 0, plan: slots.plan ?? '' },
      );
    name = restoredName(record.name, now, opts.restoredWord);
    say('create', name);
    await opts.journal.put({ key, createdUid: '', name, at: now.toISOString(), finished: false });
    uid = (await client.saveLayout({ fields: saveForm(record, drawings, name) })).uid;
    await opts.journal.put({ key, createdUid: uid, name, at: now.toISOString(), finished: false });
  } else {
    const target = list.find((e) => e.uid === mode.targetUid);
    if (!target) throw new TvError('not-found', 'The layout you chose to replace no longer exists on TradingView.');
    say('safetyCopy', target.name);
    safetyBackup = await saveSafetyCopy(client, target, opts.root, now);
    name = target.name;
    say('replace', target.name);
    await client.saveLayout({ fields: saveForm(record, drawings, name), replaceUid: target.uid });
    uid = target.uid;
    say('clearDrawings');
    await clearStoredDrawings(client, uid, record, opts.buildTime);
  }

  say('verify');
  const entry: LayoutListEntry = (await client.listLayouts()).find((e) => e.uid === uid) ?? { uid, url: uid, id: null, name, lastModified: null, raw: {} };
  const after = await captureLayout(client, entry);
  const check = compareCounts(expected, countLayout(after.layout));
  if (mode.kind === 'new') await opts.journal.put({ key, createdUid: uid, name, at: now.toISOString(), finished: true });
  return { uid, name, url: `https://www.tradingview.com/chart/${uid}/`, check, safetyBackup, resumed };
}

/** After "replace", the saved content holds every backed-up drawing, so the storage copies are removed to avoid duplicates. */
async function clearStoredDrawings(client: TvClient, uid: string, record: LayoutRecord, buildTime: string | null) {
  const token = await client.chartToken(uid);
  for (const chartId of [...record.content.charts.map(chartIdOf), '_shared']) {
    const bucket = await client.drawingBucket(uid, chartId, token);
    const ids = Object.keys(bucket.sources);
    if (ids.length) await client.putDrawings(uid, chartId, token, Object.fromEntries(ids.map((id) => [id, null])), buildTime);
  }
}

async function saveSafetyCopy(client: TvClient, target: LayoutListEntry, root: string, now: Date): Promise<string> {
  const captured = await captureLayout(client, target);
  const writer = await SnapshotWriter.begin(path.join(root, 'safety-copies'), now);
  return writer.finish({
    app: { name: APP_NAME, version: 'safety-copy' },
    createdAt: now.toISOString(),
    account: { username: client.username, plan: client.plan },
    layouts: [await writer.addLayout(captured)],
    extras: noExtras(),
    warnings: ['Safety copy taken just before ChartKeeper replaced this layout.'],
  });
}

export interface TemplateRestoreResult {
  added: string[];
  skipped: string[];
}

/** Adds templates and themes from a snapshot that the account doesn't have. Existing ones are never changed. */
export async function restoreTemplates(client: TvClient, snapshot: SnapshotReader): Promise<TemplateRestoreResult> {
  const added: string[] = [];
  const skipped: string[] = [];
  const read = async <T>(file: Promise<T | null>, rel: string, empty: T): Promise<T> => {
    const v = await file;
    if (v === null) skipped.push(`${rel} (not in this backup)`);
    return v ?? empty;
  };
  const studies = (await read(snapshot.studyTemplates(), SNAPSHOT_FILES.studyTemplates, { templates: [] })).templates;
  const existingStudies = new Set((await client.studyTemplates()).map((t) => String(t.name)));
  for (const t of studies) {
    const n = String(t.name);
    if (existingStudies.has(n)) skipped.push(`Indicator template "${n}"`);
    else {
      await client.addStudyTemplate({ name: n, content: t.content, meta_info: t.meta_info });
      added.push(`Indicator template "${n}"`);
    }
  }
  const tools = (await read(snapshot.drawingTemplates(), SNAPSHOT_FILES.drawingTemplates, { tools: {} })).tools;
  for (const [tool, templates] of Object.entries(tools)) {
    const existing = new Set(await client.drawingTemplateNames(tool));
    for (const [n, content] of Object.entries(templates)) {
      if (existing.has(n)) skipped.push(`Drawing template "${n}"`);
      else {
        await client.addDrawingTemplate(tool, n, content);
        added.push(`Drawing template "${n}"`);
      }
    }
  }
  const themes = (await read(snapshot.themes(), SNAPSHOT_FILES.themes, { themes: {} })).themes;
  const existingThemes = new Set(Object.keys(await client.themes()));
  for (const [n, content] of Object.entries(themes)) {
    if (existingThemes.has(n)) skipped.push(`Theme "${n}"`);
    else {
      await client.addTheme(n, content);
      added.push(`Theme "${n}"`);
    }
  }
  return { added, skipped };
}
