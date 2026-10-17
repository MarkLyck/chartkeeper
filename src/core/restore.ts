import { promises as fs } from 'node:fs';
import path from 'node:path';
import { captureLayout } from './backup';
import { countLayout, parseLayout } from './layout';
import { checkRestore, sameLayoutName, type PageCount, type RestoreCheck } from './restorePolicy';
import type { DrawingsRecord, LayoutRecord } from './model';
import { APP_NAME, noExtras, SnapshotWriter, type SnapshotReader } from './snapshot';
import type { LayoutListEntry, TvClient } from './tv/client';
import { chartIdOf, drawingSourceFromStored, isDrawingType, mainSeriesOf, placeDrawing, placeShared, type TvContent } from './tv/content';
import { TvError } from './tv/errors';

export type RestoreStep = 'check' | 'create' | 'safetyCopy' | 'replace' | 'clearDrawings' | 'verify';

/** "replace" carries the layout name the user confirmed; it must still match the target when the restore runs. */
export type RestoreMode = { kind: 'new' } | { kind: 'replace'; targetUid: string; confirmedName: string };

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
  /** Opens the layout on TradingView and counts what it shows; null when that fails. */
  countOnPage?: (uid: string) => Promise<PageCount | null>;
}

/**
 * Recreates one layout from a snapshot on TradingView.
 *
 * "new" never touches existing layouts. "replace" only runs when the name the
 * user confirmed still matches the target, and it first saves a safety copy
 * of the layout it overwrites. Afterwards the restored layout is read back,
 * counted on the chart page, and compared with the backup.
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
  const mark = (createdUid: string, finished: boolean) => opts.journal.put({ key, createdUid, name, at: now.toISOString(), finished });

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
    await mark('', false);
    uid = (await client.saveLayout({ fields: saveForm(record, drawings, name) })).uid;
    await mark(uid, false);
  } else {
    const target = list.find((e) => e.uid === mode.targetUid);
    if (!target) throw new TvError('not-found', 'The layout you chose to replace no longer exists on TradingView.');
    if (!sameLayoutName(mode.confirmedName, target.name)) throw new TvError('not-found', 'The layout name you typed does not match the layout you chose. Nothing was changed.');
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
  if (mode.kind === 'new') await mark(uid, true);
  const shown = opts.countOnPage ? await opts.countOnPage(uid) : null;
  const check = checkRestore(expected, countLayout(after.layout), shown);
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

export type TemplateKind = 'study-template' | 'drawing-template' | 'theme';

export interface TemplateRestoreResult {
  added: { kind: TemplateKind; name: string }[];
  skipped: { kind: TemplateKind; name: string }[];
  /** Kinds whose file this backup does not have. */
  missing: TemplateKind[];
}

/** Adds templates and themes from a snapshot that the account doesn't have. Existing ones are never changed. */
export async function restoreTemplates(client: TvClient, snapshot: SnapshotReader): Promise<TemplateRestoreResult> {
  const result: TemplateRestoreResult = { added: [], skipped: [], missing: [] };
  const addUnless = async (exists: boolean, kind: TemplateKind, name: string, add: () => Promise<void>) => {
    if (exists) {
      result.skipped.push({ kind, name });
      return;
    }
    await add();
    result.added.push({ kind, name });
  };

  const studies = await snapshot.studyTemplates();
  if (!studies) result.missing.push('study-template');
  const existingStudies = new Set((await client.studyTemplates()).map((t) => String(t.name)));
  for (const t of studies?.templates ?? []) {
    const name = String(t.name);
    await addUnless(existingStudies.has(name), 'study-template', name, () => client.addStudyTemplate({ name, content: t.content, meta_info: t.meta_info }));
  }

  const tools = await snapshot.drawingTemplates();
  if (!tools) result.missing.push('drawing-template');
  for (const [tool, templates] of Object.entries(tools?.tools ?? {})) {
    const existing = new Set(await client.drawingTemplateNames(tool));
    for (const [name, content] of Object.entries(templates)) await addUnless(existing.has(name), 'drawing-template', name, () => client.addDrawingTemplate(tool, name, content));
  }

  const themes = await snapshot.themes();
  if (!themes) result.missing.push('theme');
  const existingThemes = new Set(Object.keys(await client.themes()));
  for (const [name, content] of Object.entries(themes?.themes ?? {})) await addUnless(existingThemes.has(name), 'theme', name, () => client.addTheme(name, content));
  return result;
}
