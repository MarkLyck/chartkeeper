import { sameLayoutName, type Tally } from '../../core/restorePolicy';
import type { ManifestLayout } from '../../core/model';
import type { AppError, RestoreOutcome, RestoreRequest, RestoreTargets, SnapshotSummary } from '../../shared/api';
import { formatDateTime, restoreStepText, t, tn } from '../i18n';
import { button, confirmDialog, details, errorBox, icons, notice, progressBar, screenHeader, spinner } from './components';
import { h, replace } from './dom';
import type { Ctx, Screen } from './screen';
import { isIncomplete, layoutFacts, layoutsOf, newestFirst, snapshotDate, snapshotLines } from './snapshots';

type Loadable<T> = { k: 'loading' } | { k: 'ok'; value: T } | { k: 'error'; error: AppError };

interface Source {
  snapshot: SnapshotSummary;
  layout: ManifestLayout;
}

type Mode = 'new' | 'replace';

type Step =
  | { k: 'choose'; snapshotDir: string | null; uid: string | null }
  | { k: 'how'; source: Source; targets: Loadable<RestoreTargets>; mode: Mode; targetUid: string | null }
  | { k: 'running'; source: Source; label: string }
  | { k: 'done'; source: Source; outcome: RestoreOutcome }
  | { k: 'failed'; source: Source; error: AppError; mode: Mode };

type Templates = null | { k: 'running' } | { k: 'ok'; value: { added: string[]; skipped: string[] } } | { k: 'error'; error: AppError };

const STEP_NUMBER: Record<Step['k'], 1 | 2 | 3> = { choose: 1, how: 2, running: 3, done: 3, failed: 3 };

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
            h('span', { class: 'choice-title' }, l.name), h('span', { class: 'choice-note' }, layoutFacts(l)))))),
      h('div', { class: 'actions actions-end' },
        button(`${t('common.next')} →`, () => snap && layout && void toHow({ snapshot: snap, layout }), { kind: 'primary', id: 'restore-next', disabled: !layout })),
      snap ? templatesSection(snap) : h('div'),
    ];
  }

  function templatesSection(snap: SnapshotSummary): HTMLElement {
    const run = async () => {
      templates = { k: 'running' };
      render();
      const r = await ctx.api.restoreTemplates(snap.dir);
      templates = r.ok ? { k: 'ok', value: r.value } : { k: 'error', error: r.error };
      render();
    };
    const tpl = templates;
    const result =
      tpl === null ? null
      : tpl.k === 'running' ? spinner(t('restore.templatesRunning'))
      : tpl.k === 'error' ? errorBox(ctx, tpl.error)
      : tpl.value.added.length === 0 && tpl.value.skipped.length === 0 ? notice('info', t('restore.templatesNothing'))
      : notice('success', t('restore.templatesTitle'),
          tpl.value.added.length ? h('div', {}, h('h3', { class: 'list-title' }, t('restore.templatesAdded')), h('ul', { class: 'plain-list' }, tpl.value.added.map((n) => h('li', {}, n)))) : null,
          tpl.value.skipped.length ? h('div', {}, h('h3', { class: 'list-title' }, t('restore.templatesSkipped')), h('ul', { class: 'plain-list' }, tpl.value.skipped.map((n) => h('li', {}, n)))) : null);
    return h('section', { class: 'card templates', attrs: { 'aria-labelledby': 'tpl-title' } },
      h('h2', { id: 'tpl-title' }, t('restore.templatesTitle')),
      h('p', { class: 'note' }, t('restore.templatesNote')),
      button(t('restore.templatesButton'), () => void run(), { id: 'restore-templates', disabled: tpl?.k === 'running' || ctx.state().busy !== null }),
      result);
  }

  async function toHow(source: Source, mode: Mode = 'new') {
    const how: Extract<Step, { k: 'how' }> = { k: 'how', source, targets: { k: 'loading' }, mode, targetUid: null };
    set(how);
    const r = await ctx.api.restoreTargets();
    if (step !== how) return;
    set({ ...how, targets: r.ok ? { k: 'ok', value: r.value } : { k: 'error', error: r.error } });
  }

  function slotsLine(tg: RestoreTargets): HTMLElement {
    return h('p', { class: 'choice-note' }, tg.limit === null ? t('restore.slotsUnlimited', { used: tg.used }) : t('restore.slots', { used: tg.used, limit: tg.limit }));
  }

  function fullNotice(tg: RestoreTargets): HTMLElement {
    const limit = tg.limit ?? tg.used;
    return notice('warning', t('restore.fullTitle'),
      h('p', {}, tg.plan ? t('restore.fullBody', { plan: tg.plan, limit }) : t('restore.fullBodyNoPlan', { limit })),
      h('p', {}, t('restore.fullWhat')),
      h('ul', { class: 'plain-list' }, h('li', {}, t('restore.fullDelete')), h('li', {}, t('restore.fullUpgrade')), h('li', {}, t('restore.fullReplace'))));
  }

  function howStep(c: Extract<Step, { k: 'how' }>): (HTMLElement | null)[] {
    const intro = h('p', { class: 'lead' }, t('restore.restoring', { name: c.source.layout.name, when: backupWhen(c.source.snapshot) }));
    const back = button(`← ${t('common.back')}`, () => set({ k: 'choose', snapshotDir: c.source.snapshot.dir, uid: c.source.layout.uid }), { id: 'restore-back' });
    const title = h('h2', { class: 'step-title', tabIndex: -1 }, t('restore.howTitle'));
    if (c.targets.k === 'loading') return [title, intro, spinner(t('restore.checking'))];
    if (c.targets.k === 'error') return [title, intro, errorBox(ctx, c.targets.error, { actions: [button(t('common.tryAgain'), () => void toHow(c.source), { kind: 'primary', id: 'targets-retry' })] }), h('div', { class: 'actions' }, back)];

    const tg = c.targets.value;
    const target = tg.layouts.find((l) => l.uid === c.targetUid) ?? null;
    const start = button(t('restore.start'), () => void begin(c, target), { kind: 'primary', big: true, id: 'restore-start' });
    const hint = h('p', { class: 'match-hint', id: 'confirm-name-hint', attrs: { 'aria-live': 'polite' } });
    const nameInput = h('input', {
      type: 'text', id: 'confirm-name', class: 'text-input', autocomplete: 'off', spellcheck: false,
      attrs: { 'aria-describedby': 'confirm-name-hint' },
      on: { input: () => sync() },
    });
    const sync = () => {
      const typed = nameInput.value;
      const matches = target !== null && sameLayoutName(typed, target.name);
      start.disabled = c.mode === 'new' ? !tg.free : !matches;
      hint.textContent = target && typed.trim() ? (matches ? t('restore.nameMatches') : t('restore.nameMismatch')) : '';
      hint.className = `match-hint${matches ? ' match-ok' : ''}`;
    };

    const targetSelect = h('select', { id: 'target-pick', class: 'select select-wide', on: { change: () => set({ ...c, targetUid: targetSelect.value || null }) } },
      h('option', { value: '' }, t('restore.targetPick')),
      tg.layouts.map((l) => h('option', { value: l.uid, selected: l.uid === c.targetUid }, l.name)));

    const replaceFields =
      c.mode !== 'replace' ? null
      : tg.layouts.length === 0 ? h('p', { class: 'note' }, t('restore.noTargets'))
      : h('div', { class: 'replace-fields' },
          h('label', { htmlFor: 'target-pick', class: 'field-label' }, t('restore.target')), targetSelect,
          target
            ? h('div', { class: 'confirm-name' },
                h('label', { htmlFor: 'confirm-name', class: 'field-label' }, t('restore.typeName')),
                h('p', { class: 'name-to-type', attrs: { 'aria-label': t('restore.typeNameLabel') } }, target.name),
                nameInput, hint)
            : null);

    const els = [
      title, intro,
      h('fieldset', { class: 'choices' },
        h('legend', { class: 'sr-only' }, t('restore.howTitle')),
        radio('mode', 'mode-new', c.mode === 'new', () => set({ ...c, mode: 'new' }),
          h('span', { class: 'choice-title' }, t('restore.modeNew'), h('span', { class: 'badge badge-ok' }, t('restore.recommended'))),
          h('span', { class: 'choice-note' }, t('restore.modeNewNote')),
          slotsLine(tg)),
        c.mode === 'new' && !tg.free ? fullNotice(tg) : null,
        radio('mode', 'mode-replace', c.mode === 'replace', () => set({ ...c, mode: 'replace' }),
          h('span', { class: 'choice-title' }, t('restore.modeReplace')),
          h('span', { class: 'choice-note' }, t('restore.modeReplaceNote'))),
        replaceFields),
      h('div', { class: 'actions actions-split' }, back, start),
    ];
    sync();
    return els;
  }

  async function begin(c: Extract<Step, { k: 'how' }>, target: { uid: string; name: string } | null) {
    const base = { snapshotDir: c.source.snapshot.dir, uid: c.source.layout.uid };
    let req: RestoreRequest;
    if (c.mode === 'replace') {
      if (!target) return;
      const ok = await confirmDialog({
        title: t('restore.confirmTitle', { name: target.name }),
        body: t('restore.confirmBody', { name: target.name }),
        yes: t('restore.confirmYes'),
        no: t('common.cancel'),
        danger: true,
      });
      if (!ok) return;
      req = { ...base, mode: 'replace', targetUid: target.uid, confirmedName: target.name };
    } else req = { ...base, mode: 'new' };

    set({ k: 'running', source: c.source, label: t('restoreStep.check') });
    const r = await ctx.api.restore(req);
    set(r.ok ? { k: 'done', source: c.source, outcome: r.value } : { k: 'failed', source: c.source, error: r.error, mode: c.mode });
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
    // When TradingView's own count could not run, the table says so; the read-back still matched.
    const ok = o.check.verdict !== 'mismatch';
    return [
      h('section', { class: `result ${ok ? 'result-success' : 'result-warning'}` },
        ok ? icons.check() : icons.warn(),
        h('div', { class: 'result-body' },
          h('h2', { class: 'result-title step-title', tabIndex: -1 }, t('restore.done', { name: o.name })),
          h('div', { class: 'actions' }, button(t('restore.open'), () => ctx.api.openOnTradingView(o.url), { kind: 'primary', big: true, id: 'restore-open' })))),
      ok ? null : notice('warning', t('restore.missingTitle'), missing ? h('p', {}, tn('restore.missing', missing)) : null, h('p', {}, t('restore.mismatchNote'))),
      verifyTable(o),
      o.safetyBackup ? h('div', { class: 'card card-quiet' }, h('p', {}, t('restore.safety')), h('p', { class: 'path' }, o.safetyBackup), button(t('common.openFolder'), () => ctx.api.openFolder(o.safetyBackup!), { id: 'safety-open' })) : null,
      o.resumed ? h('p', { class: 'note' }, t('restore.resumed')) : null,
      o.check.missingDrawings.length || o.check.extraDrawings.length
        ? details(t('error.details'), h('pre', { class: 'tech' }, [
            o.check.missingDrawings.length ? `missing: ${o.check.missingDrawings.join(', ')}` : '',
            o.check.extraDrawings.length ? `extra: ${o.check.extraDrawings.join(', ')}` : '',
          ].filter(Boolean).join('\n')))
        : null,
      h('div', { class: 'actions' },
        button(t('restore.another'), () => set({ k: 'choose', snapshotDir: c.source.snapshot.dir, uid: null }), { id: 'restore-another' }),
        button(t('nav.home'), () => ctx.go({ name: 'home' }), { id: 'restore-home' })),
    ];
  }

  function failedStep(c: Extract<Step, { k: 'failed' }>): (HTMLElement | null)[] {
    return [errorBox(ctx, c.error, { title: t('restore.failed'), actions: [button(`← ${t('common.back')}`, () => void toHow(c.source, c.mode), { kind: 'primary', id: 'restore-failed-back' })] })];
  }

  function render() {
    const n = STEP_NUMBER[step.k];
    const body =
      step.k === 'choose' ? chooseStep(step)
      : step.k === 'how' ? howStep(step)
      : step.k === 'running' ? [
          h('h2', { class: 'step-title', tabIndex: -1 }, t('restore.running', { name: step.source.layout.name })),
          h('section', { class: 'card' }, progressBar(null, step.label), h('p', { class: 'note' }, t('restore.runningNote'))),
        ]
      : step.k === 'done' ? doneStep(step)
      : failedStep(step);
    replace(el, screenHeader(ctx, t('restore.title'), { canLeave: step.k !== 'running' }), stepper(n), ...body);
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
