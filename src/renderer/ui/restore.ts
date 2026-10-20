import { restoredName, type Tally } from '../../core/restorePolicy';
import type { ManifestLayout } from '../../core/model';
import type { AppError, LayoutSlots, RestoreOutcome, SnapshotSummary, TemplatesOutcome } from '../../shared/api';
import { formatDateTime, restoreStepText, t, tn } from '../i18n';
import { templateItemText, templateMissingText } from './changes';
import { button, details, errorBox, icons, notice, pageTitle, progressBar, spinner, topBar } from './components';
import { h, replace } from './dom';
import { loaded, type Ctx, type Loadable, type Screen } from './screen';
import { isIncomplete, layoutFacts, layoutsOf, layoutTitle, newestFirst, snapshotDate, snapshotLines } from './snapshots';

interface Source {
  snapshot: SnapshotSummary;
  layout: ManifestLayout;
}

type Step =
  | { k: 'choose'; snapshotDir: string | null; uid: string | null }
  | { k: 'check'; source: Source; slots: Loadable<LayoutSlots> }
  | { k: 'running'; source: Source; label: string }
  | { k: 'done'; source: Source; outcome: RestoreOutcome }
  | { k: 'failed'; source: Source; error: AppError };

type Templates = null | Loadable<TemplatesOutcome>;

const STEP_NUMBER: Record<Step['k'], 1 | 2 | 3> = { choose: 1, check: 2, running: 3, done: 3, failed: 3 };

export function restoreScreen(ctx: Ctx): Screen {
  const el = h('main', { class: 'screen narrow' });
  let snapshots: SnapshotSummary[] | null = null;
  let step: Step = { k: 'choose', snapshotDir: null, uid: null };
  let templates: Templates = null;

  const set = (next: Step) => {
    const moved = next.k !== step.k;
    step = next;
    render();
    if (moved) (el.querySelector('.step-title') as HTMLElement | null)?.focus();
  };

  const backupWhen = (s: SnapshotSummary) => {
    const d = snapshotDate(s);
    return d ? formatDateTime(d) : s.name;
  };

  function stepper(n: 1 | 2 | 3): HTMLElement {
    const names = [t('restore.step1'), t('restore.step2'), t('restore.step3')];
    return h('ol', { class: 'stepper', attrs: { 'aria-label': t('restore.stepOf', { n }) } }, names.map((name, i) =>
      h('li', { class: i + 1 === n ? 'step-now' : i + 1 < n ? 'step-done' : '', attrs: { 'aria-current': i + 1 === n ? 'step' : undefined } },
        h('span', { class: 'step-num', attrs: { 'aria-hidden': 'true' } }, String(i + 1)), name)));
  }

  function radio(name: string, id: string, checked: boolean, onPick: () => void, ...label: (HTMLElement | string | null)[]): HTMLElement {
    return h('label', { class: `choice${checked ? ' choice-on' : ''}`, htmlFor: id },
      h('input', { type: 'radio', name, id, checked, on: { change: onPick } }),
      h('span', { class: 'choice-body' }, ...label));
  }

  function chooseStep(c: Extract<Step, { k: 'choose' }>): (HTMLElement | null)[] {
    if (!snapshots) return [spinner(t('common.loading'))];
    if (snapshots.length === 0) return [h('p', { class: 'note' }, t('restore.noBackups'))];
    const snap = snapshots.find((s) => s.dir === c.snapshotDir) ?? null;
    const layouts = snap ? layoutsOf(snap) : [];
    const layout = layouts.find((l) => l.uid === c.uid) ?? null;
    const pickSnap = (s: SnapshotSummary) => {
      const only = layoutsOf(s).length === 1 ? layoutsOf(s)[0]!.uid : null;
      templates = null;
      set({ k: 'choose', snapshotDir: s.dir, uid: only });
    };
    return [
      h('h2', { class: 'step-title', tabIndex: -1 }, t('restore.chooseTitle')),
      h('div', { class: 'two-cols' },
        h('fieldset', { class: 'choices' },
          h('legend', {}, t('restore.chooseBackup')),
          snapshots.map((s, i) => radio('snap', `pick-snap-${i}`, s === snap, () => pickSnap(s), ...snapshotLines(s)))),
        h('fieldset', { class: 'choices', disabled: !snap },
          h('legend', {}, t('restore.chooseLayout')),
          snap && layouts.length === 0 ? h('p', { class: 'note' }, t('view.noLayouts')) : null,
          layouts.map((l, i) => radio('layout', `pick-layout-${i}`, l === layout, () => set({ ...c, uid: l.uid }),
            h('span', { class: 'choice-title' }, layoutTitle(l)), h('span', { class: 'choice-note' }, layoutFacts(l)))))),
      h('div', { class: 'actions actions-end' },
        button(`${t('common.next')} →`, () => snap && layout && void toCheck({ snapshot: snap, layout }), { kind: 'primary', id: 'restore-next', disabled: !layout })),
      snap ? templatesSection(snap) : h('div'),
    ];
  }

  function templatesSection(snap: SnapshotSummary): HTMLElement {
    const run = async () => {
      templates = { k: 'loading' };
      render();
      const r = await ctx.api.restoreTemplates(snap.dir);
      templates = loaded(r);
      render();
    };
    const tpl = templates;
    const result =
      tpl === null ? null
      : tpl.k === 'loading' ? spinner(t('restore.templatesRunning'))
      : tpl.k === 'error' ? errorBox(ctx, tpl.error)
      : templatesResult(tpl.value);
    return h('section', { class: 'card templates', attrs: { 'aria-labelledby': 'tpl-title' } },
      h('h2', { id: 'tpl-title' }, t('restore.templatesTitle')),
      h('p', { class: 'note' }, t('restore.templatesNote')),
      button(t('restore.templatesButton'), () => void run(), { id: 'restore-templates', disabled: tpl?.k === 'loading' || ctx.state().busy !== null }),
      result);
  }

  function templatesResult(r: TemplatesOutcome): HTMLElement {
    const added = r.added.map(templateItemText);
    const skipped = [...r.skipped.map(templateItemText), ...r.missing.map(templateMissingText)];
    if (added.length === 0 && skipped.length === 0) return notice('info', t('restore.templatesNothing'));
    const list = (title: string, items: string[]) => (items.length ? h('div', {}, h('h3', { class: 'list-title' }, title), h('ul', { class: 'plain-list' }, items.map((n) => h('li', {}, n)))) : null);
    return notice('success', t('restore.templatesTitle'), list(t('restore.templatesAdded'), added), list(t('restore.templatesSkipped'), skipped));
  }

  async function toCheck(source: Source) {
    const check: Extract<Step, { k: 'check' }> = { k: 'check', source, slots: { k: 'loading' } };
    set(check);
    const r = await ctx.api.layoutSlots();
    if (step !== check) return;
    set({ ...check, slots: loaded(r) });
  }

  function slotsLine(s: LayoutSlots): HTMLElement {
    return h('p', { class: 'note' }, s.limit === null ? t('restore.slotsUnlimited', { used: s.used }) : t('restore.slots', { used: s.used, limit: s.limit }));
  }

  function fullNotice(s: LayoutSlots): HTMLElement {
    const limit = s.limit ?? s.used;
    return notice('warning', t('restore.fullTitle'),
      h('p', {}, s.plan ? t('restore.fullBody', { plan: s.plan, limit }) : t('restore.fullBodyNoPlan', { limit })),
      h('p', {}, t('restore.fullWhat')),
      h('ul', { class: 'plain-list' }, h('li', {}, t('restore.fullDelete')), h('li', {}, t('restore.fullUpgrade'))));
  }

  function checkStep(c: Extract<Step, { k: 'check' }>): (HTMLElement | null)[] {
    const intro = h('p', { class: 'lead' }, t('restore.restoring', { name: layoutTitle(c.source.layout), when: backupWhen(c.source.snapshot) }));
    const back = button(`← ${t('common.back')}`, () => set({ k: 'choose', snapshotDir: c.source.snapshot.dir, uid: c.source.layout.uid }), { id: 'restore-back' });
    const title = h('h2', { class: 'step-title', tabIndex: -1 }, t('restore.newTitle'));
    if (c.slots.k === 'loading') return [title, intro, spinner(t('restore.checking'))];
    if (c.slots.k === 'error') return [title, intro, errorBox(ctx, c.slots.error, { actions: [button(t('common.tryAgain'), () => void toCheck(c.source), { kind: 'primary', id: 'slots-retry' })] }), h('div', { class: 'actions' }, back)];
    const slots = c.slots.value;
    return [
      title, intro,
      h('section', { class: 'card' },
        h('p', { class: 'choice-title' }, t('restore.newName', { name: restoredName(c.source.layout.name, new Date()) })),
        h('p', {}, t('restore.newNote')),
        slotsLine(slots)),
      slots.free ? null : fullNotice(slots),
      h('div', { class: 'actions actions-split' }, back, button(t('restore.start'), () => void begin(c.source), { kind: 'primary', big: true, id: 'restore-start', disabled: !slots.free })),
    ];
  }

  async function begin(source: Source) {
    set({ k: 'running', source, label: t('restoreStep.check') });
    const r = await ctx.api.restore({ snapshotDir: source.snapshot.dir, uid: source.layout.uid });
    set(r.ok ? { k: 'done', source, outcome: r.value } : { k: 'failed', source, error: r.error });
  }

  function verifyTable(o: RestoreOutcome): HTMLElement {
    const { charts, drawings, indicators } = o.check;
    const cell = (tally: Tally) => h('td', { class: tally.ok ? 'cell-ok' : 'cell-warn' }, tally.count);
    const row = (label: string, r: { expected: number; saved: Tally; shown?: Tally | 'unchecked' }) =>
      h('tr', {},
        h('th', { scope: 'row' }, label),
        h('td', {}, r.expected),
        cell(r.saved),
        r.shown === undefined ? h('td', {}, '') : r.shown === 'unchecked' ? h('td', { class: 'cell-warn' }, t('restore.notChecked')) : cell(r.shown));
    return h('table', { class: 'verify' },
      h('caption', {}, t('restore.checkTitle')),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, t('restore.colWhat')),
        h('th', { scope: 'col' }, t('restore.colBackup')),
        h('th', { scope: 'col' }, t('restore.colSaved')),
        h('th', { scope: 'col' }, t('restore.colShown')))),
      h('tbody', {},
        row(t('restore.rowCharts'), charts),
        row(t('restore.rowDrawings'), drawings),
        row(t('restore.rowIndicators'), indicators)));
  }

  function doneStep(c: Extract<Step, { k: 'done' }>): (HTMLElement | null)[] {
    const o = c.outcome;
    const missing = o.check.missingDrawings.length;
    const ok = o.check.verdict === 'verified';
    return [
      h('section', { class: `result ${ok ? 'result-success' : 'result-warning'}` },
        ok ? icons.check() : icons.warn(),
        h('div', { class: 'result-body' },
          h('h2', { class: 'result-title step-title', tabIndex: -1 }, t('restore.done', { name: o.name })),
          h('div', { class: 'actions' }, button(t('restore.open'), () => ctx.api.openOnTradingView(o.url), { kind: 'primary', big: true, id: 'restore-open' })))),
      o.check.verdict === 'mismatch' ? notice('warning', t('restore.missingTitle'), missing ? h('p', {}, tn('restore.missing', missing)) : null, h('p', {}, t('restore.mismatchNote'))) : null,
      o.check.verdict === 'shown-unchecked' ? notice('warning', t('restore.uncheckedTitle'), h('p', {}, t('restore.uncheckedNote'))) : null,
      verifyTable(o),
      o.resumed ? h('p', { class: 'note' }, t('restore.resumed')) : null,
      o.check.missingDrawings.length || o.check.extraDrawings.length
        ? details(t('error.details'), h('pre', { class: 'tech' }, [
            o.check.missingDrawings.length ? `missing: ${o.check.missingDrawings.join(', ')}` : '',
            o.check.extraDrawings.length ? `extra: ${o.check.extraDrawings.join(', ')}` : '',
          ].filter(Boolean).join('\n')))
        : null,
      h('div', { class: 'actions' },
        button(t('restore.another'), () => set({ k: 'choose', snapshotDir: c.source.snapshot.dir, uid: null }), { id: 'restore-another' }),
        button(t('nav.backToStart'), () => ctx.go({ name: 'home' }), { id: 'restore-home' })),
    ];
  }

  function failedStep(c: Extract<Step, { k: 'failed' }>): (HTMLElement | null)[] {
    return [errorBox(ctx, c.error, { title: t('restore.failed'), actions: [button(`← ${t('common.back')}`, () => void toCheck(c.source), { kind: 'primary', id: 'restore-failed-back' })] })];
  }

  function render() {
    const n = STEP_NUMBER[step.k];
    const body =
      step.k === 'choose' ? chooseStep(step)
      : step.k === 'check' ? checkStep(step)
      : step.k === 'running' ? [
          h('h2', { class: 'step-title', tabIndex: -1 }, t('restore.running', { name: layoutTitle(step.source.layout) })),
          h('section', { class: 'card' }, progressBar(null, step.label), h('p', { class: 'note' }, t('restore.runningNote'))),
        ]
      : step.k === 'done' ? doneStep(step)
      : failedStep(step);
    replace(el, topBar(ctx, 'restore', { canLeave: step.k !== 'running' }), pageTitle(t('restore.title')), stepper(n), ...body);
  }

  void ctx.api.listSnapshots().then((list) => {
    snapshots = newestFirst(list);
    if (step.k === 'choose' && step.snapshotDir === null) {
      const first = snapshots.find((s) => !isIncomplete(s)) ?? snapshots[0];
      const only = first && layoutsOf(first).length === 1 ? layoutsOf(first)[0]!.uid : null;
      step = { k: 'choose', snapshotDir: first?.dir ?? null, uid: only };
    }
    render();
  });
  render();

  return {
    el,
    onProgress(e) {
      if (e.kind !== 'restore' || step.k !== 'running') return;
      step = { ...step, label: restoreStepText(e.step) };
      render();
    },
  };
}
