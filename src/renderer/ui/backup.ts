import { secondsLeft, type BackupProgress } from '../../core/backupProgress';
import type { AppError, BackupOutcome } from '../../shared/api';
import { backupPartText, backupStepText, formatTimeLeft, t, tn } from '../i18n';
import { button, details, errorBox, icons, pageTitle, progressBar, topBar } from './components';
import { h, replace } from './dom';
import type { Ctx, Screen } from './screen';

type Done = Extract<BackupOutcome, { ok: true }>;
type Incomplete = Extract<BackupOutcome, { ok: false }>;

type Phase =
  | { k: 'running'; progress: BackupProgress | null }
  | { k: 'done'; outcome: Done }
  | { k: 'failed'; error: AppError; outcome: Incomplete | null };

export function backupScreen(ctx: Ctx): Screen {
  const el = h('main', { class: 'screen narrow' });
  let phase: Phase = { k: 'running', progress: null };
  let startedAt = Date.now();

  const set = (next: Phase) => {
    const firstResult = phase.k === 'running' && next.k !== 'running';
    phase = next;
    render();
    if (firstResult) (el.querySelector('.result-title') as HTMLElement | null)?.focus();
  };

  function running(p: BackupProgress | null): HTMLElement {
    const label = p ? backupStepText(p.step, p.name) : t('backup.starting');
    const part = p && backupPartText(p);
    const left = p && secondsLeft(p, Date.now() - startedAt);
    const fraction = p && p.total > 0 ? p.done / p.total : null;
    return h('section', { class: 'progress-panel' },
      h('div', { class: 'figure-row' },
        h('p', { class: 'figure', attrs: { 'aria-hidden': 'true' } }, fraction === null ? '–' : `${Math.floor(fraction * 100)}%`),
        left === null ? null : h('p', { class: 'progress-left', id: 'backup-left' }, formatTimeLeft(left))),
      progressBar(fraction, label),
      part ? h('p', { class: 'progress-part', id: 'backup-part' }, part) : null,
      h('p', { class: 'note' }, t('backup.runningNote')));
  }

  function done(o: Done): HTMLElement {
    return h('section', { class: 'result result-success' },
      icons.check(),
      h('div', { class: 'result-body' },
        h('h1', { class: 'result-title', tabIndex: -1 }, t('backup.done')),
        h('p', { class: 'result-lead' }, t('backup.doneSummary', { layouts: tn('count.layouts', o.layouts), drawings: tn('count.drawings', o.drawings) })),
        h('div', { class: 'actions' },
          button(t('backup.viewIt'), () => ctx.go({ name: 'view', snapshotDir: o.dir }), { kind: 'primary', id: 'backup-view' }),
          button(t('common.openFolder'), () => ctx.api.openFolder(o.dir), { id: 'backup-open' })),
        o.warnings.length
          ? details(tn('count.notes', o.warnings.length), h('p', { class: 'note' }, t('backup.notesIntro')), h('ul', { class: 'tech-list' }, o.warnings.map((w) => h('li', {}, w))))
          : null));
  }

  function failed(error: AppError, o: Incomplete | null): HTMLElement {
    return errorBox(ctx, error, {
      title: t('backup.failed'),
      note: o?.dir ? t('backup.failedPartial') : null,
      actions: [
        button(t('common.tryAgain'), start, { kind: error.kind === 'not-signed-in' ? 'secondary' : 'primary', id: 'backup-retry' }),
        o?.dir ? button(t('common.openFolder'), () => ctx.api.openFolder(o.dir), { id: 'backup-open' }) : null,
      ],
    });
  }

  function render() {
    const body = phase.k === 'running' ? running(phase.progress) : phase.k === 'done' ? done(phase.outcome) : failed(phase.error, phase.outcome);
    replace(el, topBar(ctx, 'backup', { canLeave: phase.k !== 'running' }), phase.k === 'running' ? pageTitle(t('backup.running')) : null, body);
  }

  async function start() {
    startedAt = Date.now();
    set({ k: 'running', progress: null });
    const r = await ctx.api.backupNow();
    if (!r.ok) set({ k: 'failed', error: r.error, outcome: null });
    else if (!r.value.ok) set({ k: 'failed', error: r.value.error, outcome: r.value });
    else set({ k: 'done', outcome: r.value });
  }

  render();
  void start();

  return {
    el,
    onProgress(e) {
      if (e.kind !== 'backup' || phase.k !== 'running') return;
      phase = { k: 'running', progress: e.progress };
      render();
    },
  };
}
