import type { BackupProgress } from '../../core/backup';
import type { AppError, BackupOutcome } from '../../shared/api';
import { backupStepText, t, tn } from '../i18n';
import { button, details, errorBox, icons, progressBar, screenHeader } from './components';
import { h, replace } from './dom';
import type { Ctx, Screen } from './screen';

type Phase =
  | { k: 'running'; progress: BackupProgress | null }
  | { k: 'done'; outcome: BackupOutcome }
  | { k: 'failed'; error: AppError; outcome: BackupOutcome | null };

export function backupScreen(ctx: Ctx): Screen {
  const el = h('main', { class: 'screen narrow' });
  let phase: Phase = { k: 'running', progress: null };

  const set = (next: Phase) => {
    const firstResult = phase.k === 'running' && next.k !== 'running';
    phase = next;
    render();
    if (firstResult) (el.querySelector('.result-title') as HTMLElement | null)?.focus();
  };

  function running(p: BackupProgress | null): HTMLElement {
    const label = p ? backupStepText(p.step, p.name) : t('backup.starting');
    return h('section', { class: 'card' },
      progressBar(p && p.total > 0 ? p.done / p.total : null, label),
      h('p', { class: 'note' }, t('backup.runningNote')));
  }

  function done(o: BackupOutcome): HTMLElement {
    return h('section', { class: 'result result-success' },
      icons.check(),
      h('div', { class: 'result-body' },
        h('h2', { class: 'result-title', tabIndex: -1 }, t('backup.done')),
        h('p', { class: 'result-lead' }, t('backup.doneSummary', { layouts: tn('count.layouts', o.layouts), drawings: tn('count.drawings', o.drawings) })),
        h('div', { class: 'actions' },
          button(t('backup.viewIt'), () => ctx.go({ name: 'view', snapshotDir: o.dir }), { kind: 'primary', id: 'backup-view' }),
          button(t('common.openFolder'), () => ctx.api.openFolder(o.dir), { id: 'backup-open' })),
        o.warnings.length
          ? details(tn('count.notes', o.warnings.length), h('p', { class: 'note' }, t('backup.notesIntro')), h('ul', { class: 'tech-list' }, o.warnings.map((w) => h('li', {}, w))))
          : null));
  }

  function failed(error: AppError, o: BackupOutcome | null): HTMLElement {
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
    const title = phase.k === 'running' ? t('backup.running') : t('backup.title');
    replace(el, screenHeader(ctx, title, { canLeave: phase.k !== 'running' }), body);
  }

  async function start() {
    set({ k: 'running', progress: null });
    const r = await ctx.api.backupNow();
    if (!r.ok) set({ k: 'failed', error: r.error, outcome: null });
    else if (!r.value.ok) set({ k: 'failed', error: r.value.error ?? { kind: 'unexpected', message: '', params: {} }, outcome: r.value });
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
