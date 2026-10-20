import type { AppState, UpdateState } from '../../shared/api';
import { t } from '../i18n';
import { button, details, progressBar } from './components';
import { h, replace, type Child } from './dom';
import type { Ctx } from './screen';

type Shown = Exclude<UpdateState, { k: 'none' } | { k: 'later' }>;

const isShown = (u: UpdateState): u is Shown => u.k !== 'none' && u.k !== 'later';

function waitText(busy: AppState['busy']): string | null {
  if (busy === 'backup') return t('update.waitBackup');
  if (busy === 'restore') return t('update.waitRestore');
  return busy ? t('update.waitOther') : null;
}

/**
 * The update popup, over whichever screen is open. A modal <dialog> makes the screen behind it
 * unreachable and keeps Tab inside; Escape means Later, except while the download runs.
 */
export function updateDialog(ctx: Ctx): { el: HTMLDialogElement; refresh(s: AppState): void } {
  const el = h('dialog', { class: 'dialog', id: 'update-dialog', attrs: { 'aria-labelledby': 'update-title', 'aria-modal': 'true' } });
  const later = async () => ctx.update(await ctx.api.postponeUpdate());
  el.addEventListener('cancel', (e) => {
    if (ctx.state().update.k === 'downloading') e.preventDefault();
  });
  // Chromium closes a dialog on a second Escape even when the first was refused, so every close
  // the state didn't ask for counts as Later, and a running download comes straight back.
  el.addEventListener('close', () => {
    const u = ctx.state().update;
    if (u.k === 'downloading') el.showModal();
    else if (isShown(u)) void later();
  });
  // A modal dialog lets Tab leave the page after its last button, which in this window means nowhere.
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const stops = [...el.querySelectorAll<HTMLElement>('button:not(:disabled), summary')];
    const [first, last] = [stops[0], stops.at(-1)];
    const at = document.activeElement;
    if (!first || !last) return;
    if (e.shiftKey && (at === first || !stops.includes(at as HTMLElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  });
  let shownKind: Shown['k'] | null = null;

  const title = (text: string) => h('h2', { id: 'update-title', class: 'dialog-title', tabIndex: -1 }, text);

  function body(s: AppState, u: Shown): Child[] {
    switch (u.k) {
      case 'available': {
        const wait = waitText(s.busy);
        return [
          h('p', { class: 'eyebrow' }, t('update.eyebrow')),
          title(t('update.title')),
          h('p', { class: 'lead', id: 'update-version' }, t('update.version', { version: u.version, current: s.version })),
          u.notes ? h('p', { class: 'update-notes', id: 'update-notes' }, u.notes) : null,
          h('p', {}, u.how === 'restart' ? t('update.howRestart') : t('update.howInstaller')),
          wait ? h('p', { class: 'update-wait', attrs: { role: 'status' } }, wait) : null,
          h('div', { class: 'actions' },
            button(t('update.now'), async () => ctx.update(await ctx.api.startUpdate()), { kind: 'primary', id: 'update-now', disabled: s.busy !== null }),
            button(t('update.later'), later, { id: 'update-later' })),
        ];
      }
      case 'downloading': {
        const restarting = u.percent === 100 && u.how === 'restart';
        return [
          title(restarting ? t('update.installingTitle') : t('update.downloadingTitle')),
          progressBar(u.percent / 100, restarting ? t('update.restarting') : t('update.percent', { percent: u.percent })),
          restarting ? null : h('p', { class: 'note' }, t('update.keepOpen')),
        ];
      }
      case 'installer-open':
        return [
          title(t('update.installerTitle')),
          h('p', {}, t('update.installerIntro')),
          h('ol', { class: 'update-steps' }, (['update.installerStep1', 'update.installerStep2', 'update.installerStep3', 'update.installerStep4'] as const).map((k) => h('li', {}, t(k)))),
          h('p', { class: 'note' }, t('update.installerNote')),
          h('div', { class: 'actions' },
            button(t('update.quit'), () => void ctx.api.quitApp(), { kind: 'primary', id: 'update-quit', disabled: s.busy !== null }),
            button(t('update.later'), later, { id: 'update-later' })),
        ];
      case 'failed':
        return [
          title(t('update.failedTitle')),
          h('p', {}, t('update.failedBody')),
          details(t('error.details'), h('pre', { class: 'tech' }, u.message)),
          h('div', { class: 'actions' },
            button(t('update.github'), () => void ctx.api.openReleasePage(), { kind: 'primary', id: 'update-github' }),
            button(t('update.close'), later, { id: 'update-close' })),
        ];
    }
  }

  return {
    el,
    refresh(s) {
      const u = s.update;
      if (!isShown(u)) {
        shownKind = null;
        if (el.open) el.close();
        return;
      }
      replace(el, body(s, u));
      if (!el.open) el.showModal();
      // A new step moves focus to its title, so a screen reader reads it and the old button's focus isn't lost.
      if (u.k !== shownKind) el.querySelector<HTMLElement>('#update-title')?.focus();
      shownKind = u.k;
    },
  };
}
