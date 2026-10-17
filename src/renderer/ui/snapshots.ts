import type { ManifestLayout } from '../../core/model';
import type { SnapshotSummary } from '../../shared/api';
import { formatDateTime, formatDay, formatTime, t, tn } from '../i18n';
import { h } from './dom';

/** When the backup was taken: the manifest's time, else the folder name "YYYY-MM-DD_HH-mm-ss" (local time). */
export function snapshotDate(s: SnapshotSummary): Date | null {
  if (s.manifest) return new Date(s.manifest.createdAt);
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(s.name);
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : null;
}

export const isIncomplete = (s: SnapshotSummary) => s.problem !== null || s.manifest === null || s.manifest.status === 'incomplete';

/** The technical reason a backup is incomplete, in English as core wrote it. */
export const incompleteReason = (s: SnapshotSummary): string | null => s.problem ?? s.manifest?.error ?? null;

export function newestFirst(list: SnapshotSummary[]): SnapshotSummary[] {
  const time = (s: SnapshotSummary) => snapshotDate(s)?.getTime() ?? 0;
  return [...list].sort((a, b) => time(b) - time(a));
}

export const snapshotTitle = (s: SnapshotSummary) => {
  const d = snapshotDate(s);
  return d ? formatDateTime(d) : s.name;
};

export const layoutsOf = (s: SnapshotSummary): ManifestLayout[] => s.manifest?.layouts ?? [];

/** The two-line description of a backup used in lists: day, then time and size. */
export function snapshotLines(s: SnapshotSummary): HTMLElement[] {
  const d = snapshotDate(s);
  const lines = [h('span', { class: 'snap-day' }, d ? formatDay(d) : s.name)];
  const parts = [d ? formatTime(d) : null, s.manifest ? tn('count.layouts', s.manifest.layouts.length) : null].filter(Boolean);
  lines.push(h('span', { class: 'snap-meta' }, parts.join(' · ')));
  if (s.safetyCopy) lines.push(h('span', { class: 'badge' }, t('view.safetyCopy')));
  if (isIncomplete(s)) lines.push(h('span', { class: 'badge badge-error' }, s.manifest ? t('view.incomplete') : t('view.unreadable')));
  return lines;
}

export function layoutFacts(l: ManifestLayout): string {
  return [l.symbols.map(shortSymbol).join(', '), tn('count.drawings', l.drawings), tn('count.indicators', l.studies)].filter(Boolean).join(' · ');
}

/** "NASDAQ:AAPL" -> "AAPL"; the exchange prefix means little to a non-technical user. */
export const shortSymbol = (s: string) => s.split(':').pop() ?? s;
