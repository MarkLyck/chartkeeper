import type { AppError, AppState, ProgressEvent, Settings, SnapshotSummary } from '../../shared/api';
import { backupStepText, formatDay, formatHour, formatRelative, restoreStepText, t, tn } from '../i18n';
import { button, errorBox, notice, pageTitle, progressBar, sparkline, spinner, toggle, topBar } from './components';
import { h, replace } from './dom';
import type { Ctx, Screen } from './screen';
import { isIncomplete, layoutsOf, newestFirst, snapshotDate, snapshotLines } from './snapshots';

const RECENT = 5;
const HISTORY = 60;
/** Fewer backups than a week's worth make a line that says nothing. */
const HISTORY_MIN = 7;

const drawingsIn = (s: SnapshotSummary) => layoutsOf(s).reduce((n, l) => n + l.drawings, 0);

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function homeScreen(ctx: Ctx, opts: { startSignIn?: boolean } = {}): Screen {
  const el = h('main', { class: 'screen home' });
  let snapshots: SnapshotSummary[] | null = null;
  let signingIn = false;
  let cancelling = false;
  let signInError: AppError | null = null;
  let progress: { text: string; fraction: number | null } | null = null;

  const save = async (patch: Partial<Settings>) => ctx.update(await ctx.api.setSettings(patch));

  async function signIn() {
    signingIn = true;
    signInError = null;
    render();
    const r = await ctx.api.signIn();
    signingIn = false;
    if (r.ok) ctx.update(r.value);
    else {
      // Cancelling is not a failure worth a red box.
      signInError = cancelling && r.error.kind === 'cancelled' ? null : r.error;
      render();
    }
    cancelling = false;
  }

  function actions(s: AppState): HTMLElement {
    const locked = !s.signedIn || s.busy !== null;
    return h('nav', { class: 'hero-actions', attrs: { 'aria-label': t('home.actions') } },
      button(t('home.backup'), () => ctx.go({ name: 'backup' }), { kind: 'primary', big: true, id: 'go-backup', disabled: locked }),
      button(t('home.view'), () => ctx.go({ name: 'view' }), { big: true, id: 'go-view' }),
      button(t('home.restore'), () => ctx.go({ name: 'restore' }), { big: true, id: 'go-restore', disabled: locked }));
  }

  /** Signed in: the last backup is the headline, the way a balance is. */
  function backupHero(s: AppState): HTMLElement {
    const last = s.lastBackup;
    const snap = last && snapshots?.find((x) => x.dir === last.dir);
    const layouts = snap ? layoutsOf(snap) : [];
    const figure = last ? capitalized(formatRelative(new Date(last.at))) : t('home.never');
    const line = !last
      ? h('p', { class: 'hero-sub', id: 'last-backup' }, t('home.noBackupYet'))
      : !last.ok
        ? h('p', { class: 'hero-sub last-backup-failed', id: 'last-backup' }, t('home.lastBackupFailed', { when: formatRelative(new Date(last.at)) }))
        : h('p', { class: 'hero-sub', id: 'last-backup' },
            h('span', { class: 'dot dot-ok', attrs: { 'aria-hidden': 'true' } }),
            snap?.manifest
              ? t('home.lastBackupSafe', { layouts: tn('count.layouts', layouts.length), drawings: tn('count.drawings', drawingsIn(snap)) })
              : t('home.lastBackupNoCount'));
    return h('section', { class: 'hero' },
      h('p', { class: 'eyebrow' }, t('home.lastBackupLabel')),
      pageTitle(figure),
      line,
      history(),
      actions(s));
  }

  /** How many drawings each complete backup holds, oldest first. */
  function history(): HTMLElement | null {
    const complete = newestFirst(snapshots ?? []).filter((x) => !isIncomplete(x)).slice(0, HISTORY).reverse();
    const since = complete[0] && snapshotDate(complete[0]);
    return since && complete.length >= HISTORY_MIN ? sparkline(complete.map(drawingsIn), t('home.history', { n: complete.length, since: formatDay(since) })) : null;
  }

  /** Signed out: signing in is the one thing to do. */
  function signInHero(s: AppState): HTMLElement {
    const waiting = signingIn || s.busy === 'signin';
    const how = s.browserName === 'Safari' ? t('signin.safari') : s.browserName ? t('signin.browser', { browser: s.browserName }) : t('signin.noBrowser');
    return h('section', { class: 'hero', attrs: { 'aria-label': t('signin.notSignedIn') } },
      h('p', { class: 'eyebrow signin-status' }, h('span', { class: 'dot dot-off', attrs: { 'aria-hidden': 'true' } }), t('signin.notSignedIn')),
      pageTitle(t('home.signInTitle')),
      waiting
        ? h('div', { class: 'signin-wait' },
            spinner(t('signin.waitingTitle')),
            h('p', { class: 'hero-sub' }, s.browserName === 'Safari' ? t('signin.waitingSafari') : t('signin.waitingBody')),
            button(t('signin.cancel'), () => {
              cancelling = true;
              void ctx.api.cancelSignIn();
            }, { id: 'signin-cancel' }))
        : h('div', { class: 'signin-ask' },
            h('p', { class: 'hero-sub signin-explain' }, `${t('signin.explain')} ${how}`),
            h('div', { class: 'hero-actions' }, button(t('signin.button'), signIn, { kind: 'primary', big: true, id: 'signin', disabled: s.busy !== null }))),
      signInError ? errorBox(ctx, signInError) : null,
      h('p', { class: 'note' }, t('home.needSignIn')),
      h('div', { class: 'hero-actions' },
        button(t('home.view'), () => ctx.go({ name: 'view' }), { id: 'go-view' }),
        button(t('home.backup'), () => undefined, { id: 'go-backup', disabled: true }),
        button(t('home.restore'), () => undefined, { id: 'go-restore', disabled: true })));
  }

  function busyBanner(s: AppState): HTMLElement | null {
    if (s.busy !== 'backup' && s.busy !== 'restore') return null;
    return notice('info', s.busy === 'backup' ? t('home.busyBackup') : t('home.busyRestore'), progressBar(progress?.fraction ?? null, progress?.text ?? t('common.loading')));
  }

  function stats(s: AppState): HTMLElement | null {
    if (!snapshots) return null;
    const latest = newestFirst(snapshots).find((x) => !isIncomplete(x));
    const layouts = latest ? layoutsOf(latest) : [];
    const cell = (label: string, value: string, id: string) => h('div', { class: 'stat', id }, h('p', { class: 'stat-label' }, label), h('p', { class: 'stat-value' }, value));
    return h('section', { class: 'stats', attrs: { 'aria-label': t('home.statsLabel') } },
      cell(t('home.statLayouts'), latest ? String(layouts.length) : '–', 'stat-layouts'),
      cell(t('home.statDrawings'), latest ? drawingsIn(latest).toLocaleString() : '–', 'stat-drawings'),
      cell(t('home.statBackups'), String(snapshots.length), 'stat-backups'),
      cell(t('home.statSchedule'), s.settings.dailyBackup ? t('home.daily', { time: formatHour(s.settings.dailyHour) }) : t('home.off'), 'stat-schedule'));
  }

  function recent(): HTMLElement | null {
    if (!snapshots?.length) return null;
    const list = newestFirst(snapshots).slice(0, RECENT);
    return h('section', { class: 'section', attrs: { 'aria-labelledby': 'recent-title' } },
      h('div', { class: 'section-head' },
        h('h2', { id: 'recent-title' }, t('home.recent')),
        snapshots.length > RECENT ? button(`${t('home.seeAll')} →`, () => ctx.go({ name: 'view' }), { kind: 'link', id: 'recent-all' }) : null),
      h('ul', { class: 'rows' }, list.map((s, i) =>
        h('li', {},
          h('button', { type: 'button', id: `recent-${i}`, class: `row row-button${isIncomplete(s) ? ' snap-incomplete' : ''}`, on: { click: () => ctx.go({ name: 'view', snapshotDir: s.dir }) } },
            h('span', { class: 'row-main' }, snapshotLines(s)),
            h('span', { class: 'row-chevron', attrs: { 'aria-hidden': 'true' } }, '›'))))));
  }

  function settings(s: AppState): HTMLElement {
    const st = s.settings;
    const hour = h('select', { id: 'daily-hour', class: 'select', on: { change: () => save({ dailyHour: Number(hour.value) }) } },
      Array.from({ length: 24 }, (_, i) => h('option', { value: String(i), selected: i === st.dailyHour }, formatHour(i))));

    return h('section', { class: 'section settings', attrs: { 'aria-labelledby': 'settings-title' } },
      h('div', { class: 'section-head' }, h('h2', { id: 'settings-title' }, t('settings.title'))),
      h('div', { class: 'rows' },
        h('div', { class: 'row setting', attrs: { 'aria-label': s.signedIn ? t('signin.signedIn') : t('signin.notSignedIn') } },
          h('div', { class: 'row-main' },
            h('p', { class: 'setting-label signin-status' }, s.signedIn && s.username ? t('signin.signedInAs', { name: s.username }) : s.signedIn ? t('signin.signedIn') : t('signin.notSignedIn'))),
          s.signedIn ? button(t('signin.signOut'), async () => ctx.update(await ctx.api.signOut()), { id: 'signout', disabled: s.busy !== null }) : null),
        h('div', { class: 'row setting' },
          h('div', { class: 'row-main' },
            h('p', { class: 'setting-label', id: 'folder-label' }, t('settings.folder')),
            h('p', { class: 'path', attrs: { 'aria-labelledby': 'folder-label' } }, st.backupFolder)),
          h('div', { class: 'actions' },
            button(t('settings.change'), async () => ctx.update(await ctx.api.chooseFolder()), { id: 'folder-change', disabled: s.busy !== null }),
            button(t('common.openFolder'), () => ctx.api.openFolder(st.backupFolder), { id: 'folder-open' }))),
        h('div', { class: 'row setting setting-stack' },
          toggle('daily', t('settings.daily'), st.dailyBackup, (on) => save({ dailyBackup: on })),
          st.dailyBackup
            ? h('div', { class: 'setting-sub' },
                h('div', { class: 'inline-field' }, h('label', { htmlFor: 'daily-hour', class: 'inline-label' }, t('settings.dailyHour')), hour),
                h('p', { class: 'note' }, t('settings.dailyNote')))
            : null),
        h('div', { class: 'row setting setting-stack' },
          toggle('prices', t('settings.prices'), st.includePrices, (on) => save({ includePrices: on })),
          h('p', { class: 'note setting-sub' }, t('settings.pricesNote')))));
  }

  function render() {
    const s = ctx.state();
    replace(el,
      topBar(ctx, 'home'),
      s.signedIn ? backupHero(s) : signInHero(s),
      busyBanner(s),
      stats(s),
      recent(),
      settings(s));
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
      progress = e.kind === 'backup'
        ? { text: backupStepText(e.progress.step, e.progress.name), fraction: e.progress.total ? e.progress.done / e.progress.total : null }
        : { text: restoreStepText(e.step), fraction: null };
      render();
    },
  };
}
