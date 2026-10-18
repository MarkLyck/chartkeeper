import type { AppError, AppState, ProgressEvent, Settings, SnapshotSummary } from '../../shared/api';
import { backupStepText, formatHour, formatRelative, restoreStepText, t, tn } from '../i18n';
import { button, errorBox, notice, progressBar, spinner, toggle } from './components';
import { h, replace } from './dom';
import type { Ctx, Screen } from './screen';

export function homeScreen(ctx: Ctx, opts: { startSignIn?: boolean } = {}): Screen {
  const el = h('main', { class: 'screen home' });
  let snapshots: SnapshotSummary[] | null = null;
  let signingIn = false;
  let signInError: AppError | null = null;
  let progressText: string | null = null;

  const save = async (patch: Partial<Settings>) => ctx.update(await ctx.api.setSettings(patch));

  async function signIn() {
    signingIn = true;
    signInError = null;
    render();
    const r = await ctx.api.signIn();
    signingIn = false;
    if (r.ok) ctx.update(r.value);
    else {
      signInError = r.error;
      render();
    }
  }

  function signInCard(s: AppState): HTMLElement {
    if (s.signedIn)
      return h('section', { class: 'card signin signin-ok', attrs: { 'aria-label': t('signin.signedIn') } },
        h('span', { class: 'dot dot-ok', attrs: { 'aria-hidden': 'true' } }),
        h('p', { class: 'signin-status' }, s.username ? t('signin.signedInAs', { name: s.username }) : t('signin.signedIn')),
        button(t('signin.signOut'), async () => ctx.update(await ctx.api.signOut()), { kind: 'link', id: 'signout', disabled: s.busy !== null }));
    if (signingIn || s.busy === 'signin')
      return h('section', { class: 'card signin' }, spinner(t('signin.waitingTitle')), h('p', {}, t('signin.waitingBody')));
    return h('section', { class: 'card signin', attrs: { 'aria-label': t('signin.notSignedIn') } },
      h('p', { class: 'signin-status' }, h('span', { class: 'dot dot-off', attrs: { 'aria-hidden': 'true' } }), t('signin.notSignedIn')),
      h('p', { class: 'signin-explain' }, t('signin.explain'), ` ${s.browserName ? t('signin.browser', { browser: s.browserName }) : t('signin.noBrowser')}`),
      button(t('signin.button'), signIn, { kind: 'primary', big: true, id: 'signin', disabled: s.busy !== null }),
      signInError ? errorBox(ctx, signInError) : null);
  }

  function lastBackupLine(s: AppState): HTMLElement {
    const last = s.lastBackup;
    if (!last) return h('p', { class: 'last-backup' }, t('home.noBackupYet'));
    const when = formatRelative(new Date(last.at));
    if (!last.ok) return h('p', { class: 'last-backup last-backup-failed', id: 'last-backup' }, t('home.lastBackupFailed', { when }));
    const snap = snapshots?.find((x) => x.dir === last.dir);
    const text = snap?.manifest ? t('home.lastBackup', { when, layouts: tn('count.layouts', snap.manifest.layouts.length) }) : t('home.lastBackupNoCount', { when });
    return h('p', { class: 'last-backup', id: 'last-backup' }, h('span', { class: 'dot dot-ok', attrs: { 'aria-hidden': 'true' } }), text);
  }

  function busyBanner(s: AppState): HTMLElement | null {
    if (s.busy !== 'backup' && s.busy !== 'restore') return null;
    return notice('info', s.busy === 'backup' ? t('home.busyBackup') : t('home.busyRestore'), progressBar(null, progressText ?? t('common.loading')));
  }

  function settingsCard(s: AppState): HTMLElement {
    const st = s.settings;
    const hour = h('select', { id: 'daily-hour', class: 'select', on: { change: () => save({ dailyHour: Number(hour.value) }) } },
      Array.from({ length: 24 }, (_, i) => h('option', { value: String(i), selected: i === st.dailyHour }, formatHour(i))));

    return h('section', { class: 'card settings', attrs: { 'aria-labelledby': 'settings-title' } },
      h('h2', { id: 'settings-title' }, t('settings.title')),
      h('div', { class: 'setting' },
        h('p', { class: 'setting-label', id: 'folder-label' }, t('settings.folder')),
        h('p', { class: 'path', attrs: { 'aria-labelledby': 'folder-label' } }, st.backupFolder),
        h('div', { class: 'actions' },
          button(t('settings.change'), async () => ctx.update(await ctx.api.chooseFolder()), { id: 'folder-change', disabled: s.busy !== null }),
          button(t('common.openFolder'), () => ctx.api.openFolder(st.backupFolder), { id: 'folder-open' }))),
      h('div', { class: 'setting' },
        toggle('daily', t('settings.daily'), st.dailyBackup, (on) => save({ dailyBackup: on })),
        st.dailyBackup
          ? h('div', { class: 'setting-sub' },
              h('label', { htmlFor: 'daily-hour', class: 'inline-label' }, t('settings.dailyHour')), hour,
              h('p', { class: 'note' }, t('settings.dailyNote')))
          : null),
      h('div', { class: 'setting' },
        toggle('prices', t('settings.prices'), st.includePrices, (on) => save({ includePrices: on })),
        h('p', { class: 'note setting-sub' }, t('settings.pricesNote'))));
  }

  function render() {
    const s = ctx.state();
    const locked = !s.signedIn || s.busy !== null;
    replace(el,
      h('header', { class: 'home-header' }, h('h1', { tabIndex: -1, class: 'screen-title' }, 'ChartKeeper'), h('p', { class: 'tagline' }, t('app.tagline'))),
      signInCard(s),
      busyBanner(s),
      h('nav', { class: 'big-actions', attrs: { 'aria-label': 'ChartKeeper' } },
        button(t('home.backup'), () => ctx.go({ name: 'backup' }), { kind: 'primary', big: true, id: 'go-backup', disabled: locked }),
        button(t('home.view'), () => ctx.go({ name: 'view' }), { kind: 'primary', big: true, id: 'go-view' }),
        button(t('home.restore'), () => ctx.go({ name: 'restore' }), { kind: 'primary', big: true, id: 'go-restore', disabled: locked })),
      s.signedIn ? null : h('p', { class: 'note center' }, t('home.needSignIn')),
      lastBackupLine(s),
      settingsCard(s));
  }

  render();
  void ctx.api.listSnapshots().then((list) => {
    snapshots = list;
    render();
  });
  if (opts.startSignIn && !ctx.state().signedIn) void signIn();

  return {
    el,
    onState(s) {
      const dir = s.lastBackup?.dir;
      if (dir && snapshots && !snapshots.some((x) => x.dir === dir)) void ctx.api.listSnapshots().then((list) => { snapshots = list; render(); });
      render();
    },
    onProgress(e: ProgressEvent) {
      progressText = e.kind === 'backup' ? backupStepText(e.progress.step, e.progress.name) : restoreStepText(e.step);
      render();
    },
  };
}
