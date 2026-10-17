import type { DrawingPoint, ParsedDrawing, ParsedLayout, ParsedStudy } from './layout';

/** A property whose value changed. Values are JSON with sorted keys, or null when the property was not set. */
export interface PropChange {
  key: string;
  from: string | null;
  to: string | null;
}

export type ChangeKind = 'added' | 'removed' | 'changed';
export type NamedKind = 'study-template' | 'drawing-template' | 'theme' | 'script';

/** One change between two backups, as data. The window puts it into words. */
export type Change =
  | { kind: 'changed'; what: 'layout-name' | 'arrangement'; from: string; to: string }
  | { kind: 'added' | 'removed'; what: 'chart'; index: number; symbol: string; interval: string }
  | { kind: 'changed'; what: 'chart-symbol' | 'chart-interval'; index: number; from: string; to: string }
  | { kind: 'changed'; what: 'chart-style'; index: number }
  | { kind: 'added' | 'removed'; what: 'study'; shortName: string; name: string }
  | { kind: 'changed'; what: 'study-inputs'; shortName: string; inputs: PropChange[] }
  | { kind: 'changed'; what: 'study-style'; shortName: string }
  | { kind: 'added' | 'removed'; what: 'drawing'; toolType: string; text: string | null; symbol: string | null; points: DrawingPoint[] }
  | { kind: 'changed'; what: 'drawing-moved'; toolType: string; from: DrawingPoint[]; to: DrawingPoint[] }
  | { kind: 'changed'; what: 'drawing-props'; toolType: string; props: PropChange[] }
  | { kind: ChangeKind; what: Exclude<NamedKind, 'drawing-template'>; name: string }
  | { kind: ChangeKind; what: 'drawing-template'; name: string; toolType: string };

export interface LayoutDiff {
  uid: string;
  name: string;
  status: 'added' | 'removed' | 'changed' | 'same';
  changes: Change[];
}

function allDrawings(l: ParsedLayout): Map<string, ParsedDrawing> {
  const m = new Map<string, ParsedDrawing>();
  for (const c of l.charts) for (const p of c.panes) for (const d of p.drawings) m.set(d.id, d);
  for (const d of l.sharedDrawings) m.set(d.id, d);
  return m;
}

function allStudies(l: ParsedLayout): Map<string, ParsedStudy> {
  const m = new Map<string, ParsedStudy>();
  for (const c of l.charts) for (const p of c.panes) for (const s of p.studies) m.set(s.id, s);
  return m;
}

const stable = (v: unknown): string | null =>
  JSON.stringify(v, (_k, val: unknown) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val)) ?? null;

function propChanges(a: Record<string, unknown>, b: Record<string, unknown>): PropChange[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: PropChange[] = [];
  for (const key of keys) {
    const [from, to] = [stable(a[key]), stable(b[key])];
    if (from !== to) out.push({ key, from, to });
  }
  return out;
}

const drawingText = (d: ParsedDrawing) => (typeof d.props.text === 'string' && d.props.text ? d.props.text : null);

export function diffLayouts(before: ParsedLayout, after: ParsedLayout): Change[] {
  const changes: Change[] = [];
  if (before.name !== after.name) changes.push({ kind: 'changed', what: 'layout-name', from: before.name, to: after.name });
  if (before.arrangement !== after.arrangement) changes.push({ kind: 'changed', what: 'arrangement', from: before.arrangement, to: after.arrangement });

  const charts = Math.max(before.charts.length, after.charts.length);
  for (let index = 0; index < charts; index++) {
    const a = before.charts[index];
    const b = after.charts[index];
    if (!a && b) changes.push({ kind: 'added', what: 'chart', index, symbol: b.symbol, interval: b.interval });
    else if (a && !b) changes.push({ kind: 'removed', what: 'chart', index, symbol: a.symbol, interval: a.interval });
    else if (a && b) {
      if (a.symbol !== b.symbol) changes.push({ kind: 'changed', what: 'chart-symbol', index, from: a.symbol, to: b.symbol });
      if (a.interval !== b.interval) changes.push({ kind: 'changed', what: 'chart-interval', index, from: a.interval, to: b.interval });
      if (a.style !== b.style) changes.push({ kind: 'changed', what: 'chart-style', index });
    }
  }

  const sa = allStudies(before);
  const sb = allStudies(after);
  for (const [id, s] of sb) if (!sa.has(id)) changes.push({ kind: 'added', what: 'study', shortName: s.shortName, name: s.name });
  for (const [id, s] of sa) if (!sb.has(id)) changes.push({ kind: 'removed', what: 'study', shortName: s.shortName, name: s.name });
  for (const [id, s] of sb) {
    const old = sa.get(id);
    if (!old) continue;
    const inputs = propChanges(old.inputs, s.inputs).filter((c) => c.key !== 'text');
    if (inputs.length) changes.push({ kind: 'changed', what: 'study-inputs', shortName: s.shortName, inputs });
    if (stable(old.styles) !== stable(s.styles)) changes.push({ kind: 'changed', what: 'study-style', shortName: s.shortName });
  }

  const da = allDrawings(before);
  const db = allDrawings(after);
  const drawing = (kind: 'added' | 'removed', d: ParsedDrawing): Change => ({ kind, what: 'drawing', toolType: d.type, text: drawingText(d), symbol: d.symbol, points: d.points });
  for (const [id, d] of db) if (!da.has(id)) changes.push(drawing('added', d));
  for (const [id, d] of da) if (!db.has(id)) changes.push(drawing('removed', d));
  for (const [id, d] of db) {
    const old = da.get(id);
    if (!old) continue;
    if (stable(old.points) !== stable(d.points)) changes.push({ kind: 'changed', what: 'drawing-moved', toolType: d.type, from: old.points, to: d.points });
    const props = propChanges(old.props, d.props);
    if (props.length) changes.push({ kind: 'changed', what: 'drawing-props', toolType: d.type, props });
  }
  return changes;
}

export function diffSnapshots(before: Map<string, ParsedLayout>, after: Map<string, ParsedLayout>): LayoutDiff[] {
  const out: LayoutDiff[] = [];
  for (const [uid, b] of after) {
    const a = before.get(uid);
    if (!a) out.push({ uid, name: b.name, status: 'added', changes: [] });
    else {
      const changes = diffLayouts(a, b);
      out.push({ uid, name: b.name, status: changes.length ? 'changed' : 'same', changes });
    }
  }
  for (const [uid, a] of before) if (!after.has(uid)) out.push({ uid, name: a.name, status: 'removed', changes: [] });
  const order = { removed: 0, changed: 1, added: 2, same: 3 };
  return out.sort((x, y) => order[x.status] - order[y.status] || x.name.localeCompare(y.name));
}

/** Named items (templates, themes, scripts) keyed by an id, with the content that decides whether one changed. */
export type NamedItems<T> = Map<string, { item: T; content: unknown }>;

export function diffNamed<T>(before: NamedItems<T>, after: NamedItems<T>): { kind: ChangeKind; item: T }[] {
  const out: { kind: ChangeKind; item: T }[] = [];
  for (const [k, v] of after) if (!before.has(k)) out.push({ kind: 'added', item: v.item });
  for (const [k, v] of before) if (!after.has(k)) out.push({ kind: 'removed', item: v.item });
  for (const [k, v] of after) {
    const old = before.get(k);
    if (old && stable(old.content) !== stable(v.content)) out.push({ kind: 'changed', item: v.item });
  }
  return out;
}
