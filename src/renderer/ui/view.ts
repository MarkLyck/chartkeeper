import type { CompareOutcome, LoadedLayout, SnapshotSummary } from '../../shared/api';
import type { Change, LayoutDiff } from '../../core/diff';
import { t } from '../i18n';
import { renderLayout, type RenderedLayout } from '../viewer';
import { changeText } from './changes';
import { button, errorBox, icons, notice, spinner, topBar } from './components';
import { h, replace } from './dom';
import { loaded, type Ctx, type Loadable, type Screen } from './screen';
import { incompleteReason, isIncomplete, layoutFacts, layoutsOf, layoutTitle, newestFirst, snapshotDate, snapshotLines, snapshotTitle } from './snapshots';

type Main =
  | { k: 'none' }
  | { k: 'chart'; uid: string; load: Loadable<LoadedLayout> }
  | { k: 'compare'; olderDir: string; returnTo: string | null; load: Loadable<CompareOutcome> };

export function viewScreen(ctx: Ctx, opts: { snapshotDir?: string } = {}): Screen {
  const sidebar = h('div');
  const main = h('section', { class: 'view-main', attrs: { 'aria-live': 'polite' } });
  const el = h('main', { class: 'screen wide' }, topBar(ctx, 'view'),
    h('div', { class: 'view-cols' },
      h('nav', { class: 'sidebar', attrs: { 'aria-label': t('view.backups') } }, h('h1', { tabIndex: -1, class: 'sidebar-title' }, t('view.title')), sidebar),
      main));

  let snapshots: SnapshotSummary[] = [];
  let selected: SnapshotSummary | null = null;
  let content: Main = { k: 'none' };
  let chart: RenderedLayout | null = null;
  /** The chart stage fills the window. Only while a layout is open. */
  let expanded = false;
  let token = 0;
  // Kept across renders, so the toolbar can follow the chart and full screen without redrawing the chart.
  const bar = h('div', { class: 'stage-bar' });

  const dropChart = () => {
    chart?.destroy();
    chart = null;
  };

  function setExpanded(on: boolean) {
    if (on === expanded) return;
    expanded = on;
    el.classList.toggle('is-full', on);
    // The stage covers the window either way; real full screen is a bonus the system may refuse.
    if (on) void document.documentElement.requestFullscreen().catch(() => {});
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    renderBar();
  }

  function toggleFull() {
    setExpanded(!expanded);
    document.getElementById('chart-full')?.focus();
  }

  const onFullscreenChange = () => {
    if (!document.fullscreenElement) setExpanded(false);
    else if (!expanded) void document.exitFullscreen().catch(() => {});
  };

  function stepLayout(by: -1 | 1) {
    if (!selected || content.k !== 'chart') return;
    const { uid } = content;
    const layouts = layoutsOf(selected);
    const next = layouts[layouts.findIndex((l) => l.uid === uid) + by];
    if (next) void openLayout(next.uid);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof Element && e.target.closest('input, select, textarea'))) return;
    if (content.k !== 'chart') return;
    const c = chart;
    const act =
      e.key === 'f' || e.key === 'F' ? (e.repeat ? null : toggleFull)
      : e.key === 'Escape' ? (expanded ? () => setExpanded(false) : null)
      : e.key === 'ArrowLeft' ? (expanded ? () => stepLayout(-1) : null)
      : e.key === 'ArrowRight' ? (expanded ? () => stepLayout(1) : null)
      : e.key === '+' || e.key === '=' ? (c ? () => c.zoom(ZOOM_IN) : null)
      : e.key === '-' ? (c ? () => c.zoom(1 / ZOOM_IN) : null)
      : e.key === '0' ? (c ? () => c.reset() : null)
      : null;
    if (!act) return;
    e.preventDefault();
    act();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFullscreenChange);

  function selectSnapshot(s: SnapshotSummary) {
    setExpanded(false);
    selected = s;
    renderSidebar();
    const first = layoutsOf(s)[0];
    if (first) void openLayout(first.uid);
    else setMain({ k: 'none' });
  }

  function setMain(next: Main) {
    content = next;
    if (next.k !== 'chart') setExpanded(false);
    renderMain();
  }

  async function openLayout(uid: string) {
    if (!selected) return;
    const mine = ++token;
    setMain({ k: 'chart', uid, load: { k: 'loading' } });
    const r = await ctx.api.loadLayout(selected.dir, uid);
    if (mine !== token) return;
    setMain({ k: 'chart', uid, load: loaded(r) });
  }

  async function compareWith(olderDir: string) {
    if (!selected) return;
    const mine = ++token;
    const returnTo = content.k === 'chart' ? content.uid : null;
    setMain({ k: 'compare', olderDir, returnTo, load: { k: 'loading' } });
    const r = await ctx.api.compare(olderDir, selected.dir);
    if (mine !== token) return;
    setMain({ k: 'compare', olderDir, returnTo, load: loaded(r) });
  }

  function renderSidebar() {
    replace(sidebar,
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
    const strip = h('div', { class: 'layout-strip', attrs: { role: 'group', 'aria-label': t('view.layouts') }, on: { wheel: (e) => scrollSideways(strip, e) } }, layouts.map((l, i) =>
      h('button', {
        type: 'button',
        id: `layout-${i}`,
        class: `layout-card${l.uid === current ? ' layout-selected' : ''}`,
        attrs: { 'aria-pressed': l.uid === current ? 'true' : 'false' },
        on: { click: () => void openLayout(l.uid) },
      },
      h('span', { class: 'layout-name' }, layoutTitle(l)),
      h('span', { class: 'layout-facts' }, layoutFacts(l)),
      l.priceData ? null : h('span', { class: 'badge badge-muted' }, t('view.noPrices')))));
    return strip;
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

  function renderBar() {
    if (!selected || content.k !== 'chart') return;
    const layouts = layoutsOf(selected);
    const uid = content.uid;
    const i = layouts.findIndex((l) => l.uid === uid);
    const tool = (id: string, label: string, key: string, icon: SVGSVGElement, onClick: () => void, disabled: boolean) =>
      h('button', { type: 'button', id, class: 'tool', disabled, title: `${label} (${key})`, attrs: { 'aria-label': label }, on: { click: onClick } }, icon);
    const full = expanded ? t('view.exitFullScreen') : t('view.fullScreen');
    // Redrawing the bar drops focus; put it back once the stage is in the page again, so arrows and zoom can be pressed repeatedly from the keyboard.
    const focused = bar.contains(document.activeElement) ? document.activeElement?.id : undefined;
    if (focused) queueMicrotask(() => {
      const again = document.getElementById(focused);
      (again instanceof HTMLButtonElement && !again.disabled ? again : document.getElementById('chart-full'))?.focus();
    });
    replace(bar,
      // The arrows come first so they stay put under the mouse while the names change.
      h('div', { class: 'stage-nav' },
        tool('stage-prev', t('view.prevLayout'), '←', icons.prev(), () => stepLayout(-1), i <= 0),
        tool('stage-next', t('view.nextLayout'), '→', icons.next(), () => stepLayout(1), i < 0 || i >= layouts.length - 1),
        h('p', { class: 'stage-title' },
          h('span', { class: 'stage-name' }, layouts[i] ? layoutTitle(layouts[i]) : ''),
          h('span', { class: 'stage-count' }, t('view.layoutOf', { n: i + 1, total: layouts.length })))),
      h('p', { class: 'stage-hint' }, t('view.chartHint')),
      h('div', { class: 'stage-tools' },
        tool('chart-zoom-out', t('view.zoomOut'), '−', icons.zoomOut(), () => chart?.zoom(1 / ZOOM_IN), !chart),
        tool('chart-zoom-in', t('view.zoomIn'), '+', icons.zoomIn(), () => chart?.zoom(ZOOM_IN), !chart),
        tool('chart-reset', t('view.resetView'), '0', icons.reset(), () => chart?.reset(), !chart),
        h('button', {
          type: 'button',
          id: 'chart-full',
          class: 'tool tool-full',
          title: `${full} (${expanded ? 'Esc' : 'F'})`,
          attrs: { 'aria-pressed': String(expanded) },
          on: { click: toggleFull },
        }, expanded ? icons.collapse() : icons.expand(), full)));
  }

  function chartStage(c: Extract<Main, { k: 'chart' }>): HTMLElement {
    renderBar();
    const stage = (box: HTMLElement) => h('section', { class: 'chart-stage', attrs: { 'aria-label': t('view.chart') } }, bar, box);
    if (c.load.k === 'loading') return stage(h('div', { class: 'chart-box chart-empty' }, spinner(t('common.loading'))));
    if (c.load.k === 'error') return stage(h('div', { class: 'chart-box chart-empty' }, errorBox(ctx, c.load.error)));
    const known = selected && layoutsOf(selected).find((l) => l.uid === c.uid);
    const box = h('div', { class: 'chart-box', attrs: { role: 'img', 'aria-label': known ? layoutTitle(known) : c.load.value.layout.name } });
    const loaded = c.load.value;
    queueMicrotask(() => {
      if (!box.isConnected) return;
      chart = renderLayout(box, loaded.layout, loaded.data);
      renderBar();
    });
    return stage(box);
  }

  function renderMain() {
    dropChart();
    const s = selected;
    if (!s) return replace(main, h('p', { class: 'note' }, snapshots.length ? '' : t('view.empty')));
    const reason = incompleteReason(s);
    const body =
      content.k === 'chart' ? chartStage(content)
      : content.k === 'compare' ? comparePanel(ctx, content, s, snapshots, () => (content.k === 'compare' && content.returnTo ? void openLayout(content.returnTo) : setMain({ k: 'none' })))
      : layoutsOf(s).length ? h('p', { class: 'note' }, t('view.pickLayout')) : null;
    replace(main,
      content.k === 'compare' ? null : h('div', { class: 'view-head' }, h('h2', { class: 'view-title' }, snapshotTitle(s)), compareControl(s)),
      isIncomplete(s) ? notice('error', s.manifest ? t('view.incompleteNote') : t('view.unreadable'), reason ? h('p', { class: 'tech' }, reason) : null) : null,
      content.k === 'compare' ? null : layoutStrip(s),
      body);
    main.querySelector('.layout-selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  void ctx.api.listSnapshots().then((list) => {
    snapshots = newestFirst(list);
    renderSidebar();
    const initial = snapshots.find((s) => s.dir === opts.snapshotDir) ?? snapshots[0];
    if (initial) selectSnapshot(initial);
    else renderMain();
  });
  replace(main, spinner(t('common.loading')));

  return {
    el,
    destroy() {
      dropChart();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    },
  };
}

/** Lets a mouse wheel scroll the layout row, which has no visible scrollbar on a Mac; at either end the page scrolls as usual. */
function scrollSideways(row: HTMLElement, e: WheelEvent) {
  if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  const before = row.scrollLeft;
  row.scrollLeft += e.deltaY;
  if (row.scrollLeft !== before) e.preventDefault();
}

/** How much one zoom in narrows the chart: a quarter fewer bars. */
const ZOOM_IN = 0.75;

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
  const known = new Map([...(older ? layoutsOf(older) : []), ...layoutsOf(newer)].map((l) => [l.uid, l]));
  const nameOf = (l: LayoutDiff) => layoutTitle(known.get(l.uid) ?? { name: l.name, symbols: [] });
  const changed = layouts.filter((l) => l.status !== 'same');
  const same = layouts.filter((l) => l.status === 'same');
  return h('div', { class: 'compare' },
    head,
    changed.length === 0 && other.length === 0 ? notice('success', t('view.compareNone')) : null,
    changed.map((l) =>
      h('section', { class: `diff diff-${l.status}` },
        h('h4', { class: 'diff-title' }, h('span', { class: `badge badge-${l.status}` }, t(STATUS_KEYS[l.status])), nameOf(l)),
        l.changes.length ? h('ul', { class: 'change-list' }, l.changes.map(changeItem)) : null)),
    other.length
      ? h('section', { class: 'diff' }, h('h4', { class: 'diff-title' }, t('view.compareOther')), h('ul', { class: 'change-list' }, other.map(changeItem)))
      : null,
    same.length ? h('p', { class: 'note' }, t('view.compareUnchanged', { names: same.map(nameOf).join(', ') })) : null);
}
