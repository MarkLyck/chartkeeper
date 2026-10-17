import type { AppError, CompareOutcome, LoadedLayout, SnapshotSummary } from '../../shared/api';
import type { Change, LayoutDiff } from '../../core/diff';
import { getLang, t } from '../i18n';
import { renderLayout } from '../viewer';
import { changeText } from './changes';
import { button, errorBox, notice, screenHeader, spinner } from './components';
import { h, replace } from './dom';
import type { Ctx, Screen } from './screen';
import { incompleteReason, isIncomplete, layoutFacts, layoutsOf, newestFirst, snapshotDate, snapshotLines, snapshotTitle } from './snapshots';

type Loadable<T> = { k: 'loading' } | { k: 'ok'; value: T } | { k: 'error'; error: AppError };

type Main =
  | { k: 'none' }
  | { k: 'chart'; uid: string; load: Loadable<LoadedLayout> }
  | { k: 'compare'; olderDir: string; returnTo: string | null; load: Loadable<CompareOutcome> };

export function viewScreen(ctx: Ctx, opts: { snapshotDir?: string } = {}): Screen {
  const sidebar = h('nav', { class: 'sidebar', attrs: { 'aria-label': t('view.backups') } });
  const main = h('section', { class: 'view-main', attrs: { 'aria-live': 'polite' } });
  const el = h('main', { class: 'screen wide' }, screenHeader(ctx, t('view.title')), h('div', { class: 'view-cols' }, sidebar, main));

  let snapshots: SnapshotSummary[] = [];
  let selected: SnapshotSummary | null = null;
  let content: Main = { k: 'none' };
  let chart: { destroy(): void } | null = null;
  let token = 0;

  const dropChart = () => {
    chart?.destroy();
    chart = null;
  };

  function selectSnapshot(s: SnapshotSummary) {
    selected = s;
    renderSidebar();
    const first = layoutsOf(s)[0];
    if (first) void openLayout(first.uid);
    else setMain({ k: 'none' });
  }

  function setMain(next: Main) {
    content = next;
    renderMain();
  }

  async function openLayout(uid: string) {
    if (!selected) return;
    const mine = ++token;
    setMain({ k: 'chart', uid, load: { k: 'loading' } });
    const r = await ctx.api.loadLayout(selected.dir, uid);
    if (mine !== token) return;
    setMain({ k: 'chart', uid, load: r.ok ? { k: 'ok', value: r.value } : { k: 'error', error: r.error } });
  }

  async function compareWith(olderDir: string) {
    if (!selected) return;
    const mine = ++token;
    const returnTo = content.k === 'chart' ? content.uid : null;
    setMain({ k: 'compare', olderDir, returnTo, load: { k: 'loading' } });
    const r = await ctx.api.compare(olderDir, selected.dir);
    if (mine !== token) return;
    setMain({ k: 'compare', olderDir, returnTo, load: r.ok ? { k: 'ok', value: r.value } : { k: 'error', error: r.error } });
  }

  function renderSidebar() {
    replace(sidebar,
      h('h2', { class: 'sidebar-title' }, t('view.backups')),
      snapshots.length === 0
        ? h('p', { class: 'note' }, t('view.empty'))
        : h('ul', { class: 'snap-list' }, snapshots.map((s, i) =>
            h('li', {},
              h('button', {
                type: 'button',
                id: `snap-${i}`,
                class: `snap${s === selected ? ' snap-selected' : ''}${isIncomplete(s) ? ' snap-incomplete' : ''}`,
                attrs: { 'aria-current': s === selected ? 'true' : undefined },
                on: { click: () => selectSnapshot(s) },
              }, snapshotLines(s))))));
  }

  function layoutStrip(s: SnapshotSummary): HTMLElement {
    const layouts = layoutsOf(s);
    if (layouts.length === 0) return h('p', { class: 'note' }, t('view.noLayouts'));
    const current = content.k === 'chart' ? content.uid : null;
    return h('div', { class: 'layout-strip', attrs: { role: 'group', 'aria-label': t('view.layouts') } }, layouts.map((l, i) =>
      h('button', {
        type: 'button',
        id: `layout-${i}`,
        class: `layout-card${l.uid === current ? ' layout-selected' : ''}`,
        attrs: { 'aria-pressed': l.uid === current ? 'true' : 'false' },
        on: { click: () => void openLayout(l.uid) },
      },
      h('span', { class: 'layout-name' }, l.name),
      h('span', { class: 'layout-facts' }, layoutFacts(l)),
      l.priceData ? null : h('span', { class: 'badge badge-muted' }, t('view.noPrices')))));
  }

  function compareControl(s: SnapshotSummary): HTMLElement {
    const sTime = snapshotDate(s)?.getTime() ?? 0;
    const older = snapshots.filter((o) => o !== s && o.manifest && (snapshotDate(o)?.getTime() ?? 0) < sTime);
    if (older.length === 0) return h('p', { class: 'note compare-none' }, t('view.compareNoOlder'));
    const select = h('select', { id: 'compare-pick', class: 'select', on: { change: () => (go.disabled = !select.value) } },
      h('option', { value: '' }, `${t('view.compareLabel')}…`),
      older.map((o) => h('option', { value: o.dir }, snapshotTitle(o))));
    const go = button(t('view.compareButton'), () => void compareWith(select.value), { id: 'compare-go', disabled: true });
    return h('div', { class: 'compare-control' }, h('label', { htmlFor: 'compare-pick', class: 'sr-only' }, t('view.compareLabel')), select, go);
  }

  function chartArea(c: Extract<Main, { k: 'chart' }>): HTMLElement {
    if (c.load.k === 'loading') return h('div', { class: 'chart-box chart-empty' }, spinner(t('common.loading')));
    if (c.load.k === 'error') return errorBox(ctx, c.load.error);
    const box = h('div', { class: 'chart-box', attrs: { role: 'img', 'aria-label': c.load.value.layout.name } });
    const loaded = c.load.value;
    queueMicrotask(() => {
      if (box.isConnected) chart = renderLayout(box, loaded.layout, loaded.data, { lang: getLang() });
    });
    return box;
  }

  function renderMain() {
    dropChart();
    const s = selected;
    if (!s) return replace(main, h('p', { class: 'note' }, snapshots.length ? '' : t('view.empty')));
    const reason = incompleteReason(s);
    const body =
      content.k === 'chart' ? chartArea(content)
      : content.k === 'compare' ? comparePanel(ctx, content, s, snapshots, () => (content.k === 'compare' && content.returnTo ? void openLayout(content.returnTo) : setMain({ k: 'none' })))
      : layoutsOf(s).length ? h('p', { class: 'note' }, t('view.pickLayout')) : null;
    replace(main,
      content.k === 'compare' ? null : h('div', { class: 'view-head' }, h('h2', { class: 'view-title' }, snapshotTitle(s)), compareControl(s)),
      isIncomplete(s) ? notice('error', s.manifest ? t('view.incompleteNote') : t('view.unreadable'), reason ? h('p', { class: 'tech' }, reason) : null) : null,
      content.k === 'compare' ? null : layoutStrip(s),
      body);
  }

  void ctx.api.listSnapshots().then((list) => {
    snapshots = newestFirst(list);
    renderSidebar();
    const initial = snapshots.find((s) => s.dir === opts.snapshotDir) ?? snapshots[0];
    if (initial) selectSnapshot(initial);
    else renderMain();
  });
  replace(main, spinner(t('common.loading')));

  return { el, destroy: dropChart };
}

const MARKS: Record<Change['kind'], { cls: string; key: 'change.added' | 'change.removed' | 'change.changed' }> = {
  added: { cls: 'mark-added', key: 'change.added' },
  removed: { cls: 'mark-removed', key: 'change.removed' },
  changed: { cls: 'mark-changed', key: 'change.changed' },
};

const STATUS_KEYS = {
  added: 'layoutStatus.added',
  removed: 'layoutStatus.removed',
  changed: 'layoutStatus.changed',
  same: 'layoutStatus.same',
} as const satisfies Record<LayoutDiff['status'], string>;

function changeItem(c: Change): HTMLElement {
  const m = MARKS[c.kind];
  const { subject, detail } = changeText(c);
  return h('li', { class: `change ${m.cls}` },
    h('span', { class: 'mark', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'change-kind' }, t(m.key)),
    h('span', { class: 'change-subject' }, subject),
    detail ? h('span', { class: 'change-detail' }, detail) : null);
}

function comparePanel(ctx: Ctx, c: Extract<Main, { k: 'compare' }>, newer: SnapshotSummary, all: SnapshotSummary[], close: () => void): HTMLElement {
  const older = all.find((s) => s.dir === c.olderDir);
  const title = t('view.compareTitle', { older: older ? snapshotTitle(older) : c.olderDir, newer: snapshotTitle(newer) });
  const head = h('div', { class: 'compare-head' }, h('h3', { class: 'compare-title' }, title), button(`← ${t('view.compareClose')}`, close, { id: 'compare-close' }));
  if (c.load.k === 'loading') return h('div', { class: 'compare' }, head, spinner(t('common.loading')));
  if (c.load.k === 'error') return h('div', { class: 'compare' }, head, errorBox(ctx, c.load.error));
  const { layouts, other } = c.load.value;
  const changed = layouts.filter((l) => l.status !== 'same');
  const same = layouts.filter((l) => l.status === 'same');
  return h('div', { class: 'compare' },
    head,
    changed.length === 0 && other.length === 0 ? notice('success', t('view.compareNone')) : null,
    changed.map((l) =>
      h('section', { class: `diff diff-${l.status}` },
        h('h4', { class: 'diff-title' }, h('span', { class: `badge badge-${l.status}` }, t(STATUS_KEYS[l.status])), l.name),
        l.changes.length ? h('ul', { class: 'change-list' }, l.changes.map(changeItem)) : null)),
    other.length
      ? h('section', { class: 'diff' }, h('h4', { class: 'diff-title' }, t('view.compareOther')), h('ul', { class: 'change-list' }, other.map(changeItem)))
      : null,
    same.length ? h('p', { class: 'note' }, t('view.compareUnchanged', { names: same.map((l) => l.name).join(', ') })) : null);
}
