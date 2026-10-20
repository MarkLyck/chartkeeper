import { promises as fs } from 'node:fs';
import path from 'node:path';
import { obj } from './props';
import { captureLayout } from './backup';
import { countLayout, parseLayout } from './layout';
import { checkRestore, restoredName, type PageCount, type RestoreCheck } from './restorePolicy';
import type { DrawingsRecord, LayoutRecord } from './model';
import { type SnapshotReader, writePrivate } from './snapshot';
import type { AddResult, LayoutListEntry, TvClient } from './tv/client';
import { drawingSourceFromStored, isDrawingType, mainSeriesOf, placeDrawing, placeShared, type TvContent } from './tv/content';
import { urls } from './tv/endpoints';
import { TvError } from './tv/errors';
import type { LayoutForm } from './tv/writePolicy';

export type RestoreStep = 'check' | 'create' | 'verify';

export interface RestoreResult {
  uid: string;
  name: string;
  url: string;
  check: RestoreCheck;
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
export function symbolFields(record: LayoutRecord) {
  const e = record.listEntry;
  const first = record.content.charts[0];
  const series = obj(first && mainSeriesOf(first)?.state);
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

/** The complete form for TradingView's save request. */
export function saveForm(record: LayoutRecord, drawings: DrawingsRecord, name: string): LayoutForm {
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
 * Remembers the layout a restore is creating, so running it again after
 * a crash or a lost answer finishes that layout instead of making a copy.
 * A finished restore is never picked up again: restoring twice on purpose
 * makes two copies.
 */
export class RestoreJournal {
  constructor(private readonly file: string) {}

  static key(snapshotDir: string, sourceUid: string) {
    // "|new" matches the keys versions with a replace mode wrote, so their unfinished restores are still found.
    return `${path.basename(snapshotDir)}|${sourceUid}|new`;
  }

  async get(key: string): Promise<JournalEntry | null> {
    return (await this.read()).find((e) => e.key === key) ?? null;
  }

  async put(entry: JournalEntry): Promise<void> {
    const all = (await this.read()).filter((e) => e.key !== entry.key);
    all.push(entry);
    await writePrivate(this.file, JSON.stringify(all, null, 2));
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
  journal: RestoreJournal;
  now?: Date;
  onProgress?: (step: RestoreStep, name?: string) => void;
  /** Opens the layout on TradingView and counts what it shows; null when that fails. */
  countOnPage?: (uid: string) => Promise<PageCount | null>;
}

/**
 * Recreates one layout from a snapshot on TradingView as a new layout. It
 * never changes an existing one. Afterwards the new layout is read back,
 * counted on the chart page, and compared with the backup.
 */
export async function restoreLayout(client: TvClient, snapshot: SnapshotReader, sourceUid: string, opts: RestoreOptions): Promise<RestoreResult> {
  const say = opts.onProgress ?? (() => undefined);
  const record = await snapshot.layout(sourceUid);
  const drawings = await snapshot.drawings(sourceUid);
  const expected = countLayout(parseLayout(record, drawings));
  const key = RestoreJournal.key(snapshot.dir, sourceUid);
  const now = opts.now ?? new Date();

  say('check');
  const list = await client.listLayouts();
  const previous = await opts.journal.get(key);
  let uid: string;
  let name: string;
  let resumed = false;
  const mark = (createdUid: string, finished: boolean) => opts.journal.put({ key, createdUid, name, at: now.toISOString(), finished });

  // The planned name is recorded before saving; if the answer to the save was
  // lost, the layout with that name is the one this restore created. Picking
  // it up only reads it.
  const unfinished = previous && !previous.finished ? previous : null;
  const adopted = unfinished ? list.find((e) => (unfinished.createdUid ? e.uid === unfinished.createdUid : e.name === unfinished.name)) : undefined;
  if (unfinished && adopted) {
    uid = adopted.uid;
    name = adopted.name;
    resumed = true;
  } else {
    const slots = await client.slots(list.length);
    if (!slots.free)
      throw new TvError(
        'limit-reached',
        `Your TradingView plan${slots.plan ? ` (${slots.plan})` : ''} allows ${slots.limit} saved layout${slots.limit === 1 ? '' : 's'}, and all are in use. To restore, delete a layout you no longer use on TradingView or upgrade your plan.`,
        '',
        { limit: slots.limit ?? 0, plan: slots.plan ?? '' },
      );
    name = restoredName(record.name, now);
    say('create', name);
    await mark('', false);
    uid = (await client.createLayout(saveForm(record, drawings, name))).uid;
    await mark(uid, false);
  }

  say('verify');
  const entry: LayoutListEntry = (await client.listLayouts()).find((e) => e.uid === uid) ?? { uid, url: uid, id: null, name, lastModified: null, raw: {} };
  const after = await captureLayout(client, entry);
  await mark(uid, true);
  const shown = opts.countOnPage ? await opts.countOnPage(uid) : null;
  const check = checkRestore(expected, countLayout(after.layout), shown);
  return { uid, name, url: urls.layoutPage(uid), check, resumed };
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
  const report = (kind: TemplateKind, name: string, r: AddResult) => (r === 'added' ? result.added : result.skipped).push({ kind, name });

  const studies = await snapshot.studyTemplates();
  if (!studies) result.missing.push('study-template');
  for (const t of studies?.templates ?? []) {
    const name = String(t.name);
    report('study-template', name, await client.addStudyTemplate({ name, content: t.content, meta_info: t.meta_info }));
  }

  const tools = await snapshot.drawingTemplates();
  if (!tools) result.missing.push('drawing-template');
  for (const [tool, templates] of Object.entries(tools?.tools ?? {}))
    for (const [name, content] of Object.entries(templates)) report('drawing-template', name, await client.addDrawingTemplate(tool, name, content));

  const themes = await snapshot.themes();
  if (!themes) result.missing.push('theme');
  for (const [name, content] of Object.entries(themes?.themes ?? {})) report('theme', name, await client.addTheme(name, content));
  return result;
}
