import type { ParsedDrawing, ParsedLayout, ParsedStudy } from './layout';

/** One human-readable change between two backups. */
export interface Change {
  kind: 'added' | 'removed' | 'changed';
  /** What the change is about, e.g. "Trend line", "Indicator RSI", "Layout". */
  subject: string;
  detail: string;
}

export interface LayoutDiff {
  uid: string;
  name: string;
  status: 'added' | 'removed' | 'changed' | 'same';
  changes: Change[];
}

export interface SnapshotDiff {
  layouts: LayoutDiff[];
  other: Change[];
}

/** "LineToolFibRetracement" -> "Fib retracement" */
export function toolName(type: string): string {
  const base = type.replace(/^LineTool/, '');
  const known: Record<string, string> = {
    TrendLine: 'Trend line',
    HorzLine: 'Horizontal line',
    HorzRay: 'Horizontal ray',
    VertLine: 'Vertical line',
    FibRetracement: 'Fib retracement',
    ParallelChannel: 'Parallel channel',
    ArrowMarkUp: 'Arrow up',
    ArrowMarkDown: 'Arrow down',
  };
  return known[base] ?? base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`);
}

const fmtTime = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const fmtPoints = (d: ParsedDrawing) => d.points.map((p) => `${fmtTime(p.time)} @ ${+p.price.toFixed(6)}`).join(', ');

function describeDrawing(d: ParsedDrawing): string {
  const text = typeof d.props.text === 'string' && d.props.text ? ` "${d.props.text}"` : '';
  return `${toolName(d.type)}${text} on ${d.symbol ?? 'the chart'} (${fmtPoints(d)})`;
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

const stable = (v: unknown): string => JSON.stringify(v, (_k, val: unknown) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

function propChanges(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) if (stable(a[k]) !== stable(b[k])) out.push(`${k}: ${stable(a[k]) ?? '–'} → ${stable(b[k]) ?? '–'}`);
  return out;
}

export function diffLayouts(before: ParsedLayout, after: ParsedLayout): Change[] {
  const changes: Change[] = [];
  if (before.name !== after.name) changes.push({ kind: 'changed', subject: 'Layout', detail: `renamed from "${before.name}" to "${after.name}"` });
  if (before.arrangement !== after.arrangement) changes.push({ kind: 'changed', subject: 'Layout', detail: `chart arrangement ${before.arrangement} → ${after.arrangement}` });

  const charts = Math.max(before.charts.length, after.charts.length);
  for (let i = 0; i < charts; i++) {
    const a = before.charts[i];
    const b = after.charts[i];
    if (!a && b) changes.push({ kind: 'added', subject: `Chart ${i + 1}`, detail: `${b.symbol} ${b.interval}` });
    else if (a && !b) changes.push({ kind: 'removed', subject: `Chart ${i + 1}`, detail: `${a.symbol} ${a.interval}` });
    else if (a && b) {
      if (a.symbol !== b.symbol) changes.push({ kind: 'changed', subject: `Chart ${i + 1}`, detail: `symbol ${a.symbol} → ${b.symbol}` });
      if (a.interval !== b.interval) changes.push({ kind: 'changed', subject: `Chart ${i + 1}`, detail: `interval ${a.interval} → ${b.interval}` });
      if (a.style !== b.style) changes.push({ kind: 'changed', subject: `Chart ${i + 1}`, detail: `chart type changed` });
    }
  }

  const sa = allStudies(before);
  const sb = allStudies(after);
  for (const [id, s] of sb) if (!sa.has(id)) changes.push({ kind: 'added', subject: `Indicator ${s.shortName}`, detail: s.name });
  for (const [id, s] of sa) if (!sb.has(id)) changes.push({ kind: 'removed', subject: `Indicator ${s.shortName}`, detail: s.name });
  for (const [id, s] of sb) {
    const old = sa.get(id);
    if (!old) continue;
    const inputs = propChanges(old.inputs, s.inputs).filter((c) => !c.startsWith('text:'));
    if (inputs.length) changes.push({ kind: 'changed', subject: `Indicator ${s.shortName}`, detail: `settings: ${inputs.join('; ')}` });
    if (stable(old.styles) !== stable(s.styles)) changes.push({ kind: 'changed', subject: `Indicator ${s.shortName}`, detail: 'colors or line styles changed' });
  }

  const da = allDrawings(before);
  const db = allDrawings(after);
  for (const [id, d] of db) if (!da.has(id)) changes.push({ kind: 'added', subject: toolName(d.type), detail: describeDrawing(d) });
  for (const [id, d] of da) if (!db.has(id)) changes.push({ kind: 'removed', subject: toolName(d.type), detail: describeDrawing(d) });
  for (const [id, d] of db) {
    const old = da.get(id);
    if (!old) continue;
    const moved = stable(old.points) !== stable(d.points);
    const props = propChanges(old.props, d.props);
    if (moved) changes.push({ kind: 'changed', subject: toolName(d.type), detail: `moved: ${fmtPoints(old)} → ${fmtPoints(d)}` });
    if (props.length) changes.push({ kind: 'changed', subject: toolName(d.type), detail: `style or text: ${props.slice(0, 6).join('; ')}${props.length > 6 ? ` (+${props.length - 6} more)` : ''}` });
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

/** Compares named items (templates, scripts) by content. */
export function diffNamed(subject: string, before: Record<string, unknown>, after: Record<string, unknown>): Change[] {
  const out: Change[] = [];
  for (const k of Object.keys(after)) if (!(k in before)) out.push({ kind: 'added', subject, detail: k });
  for (const k of Object.keys(before)) if (!(k in after)) out.push({ kind: 'removed', subject, detail: k });
  for (const k of Object.keys(after)) if (k in before && stable(before[k]) !== stable(after[k])) out.push({ kind: 'changed', subject, detail: k });
  return out;
}
