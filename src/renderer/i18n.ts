import type { BackupProgress, BackupStep } from '../core/backupProgress';
import type { RestoreStep } from '../core/restore';
import type { AppError } from '../shared/api';
import { LOCALE } from '../shared/locale';
import { fill, type ParamNames } from '../shared/template';

/** Every sentence the window shows, in one place. */
export const TEXT = {
  'nav.home': 'Home',
  'nav.backups': 'Backups',
  'nav.restore': 'Restore',
  'nav.label': 'ChartKeeper',
  'nav.signedIn': 'Signed in',
  'nav.signedOut': 'Not signed in',
  'nav.backToStart': 'Back to start',
  'common.loading': 'One moment…',
  'common.next': 'Next',
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.tryAgain': 'Try again',
  'common.openFolder': 'Open folder',

  'signin.signedInAs': 'Signed in to TradingView as {name}',
  'signin.signedIn': 'Signed in to TradingView',
  'signin.signOut': 'Sign out',
  'signin.notSignedIn': 'Not signed in to TradingView',
  'signin.button': 'Sign in to TradingView',
  'signin.explain': 'A browser window opens where you sign in to TradingView yourself, the way you usually do. Google sign-in and two-step codes work there. ChartKeeper never sees or stores your password.',
  'signin.browser': 'The window opens in {browser}.',
  'signin.safari': 'ChartKeeper uses your sign-in from Safari. If you are not signed in to TradingView in Safari, the sign-in page opens there. The first time, macOS asks you to allow ChartKeeper to read it.',
  'signin.cancel': 'Cancel',
  'signin.noBrowser': 'No Chrome, Edge, Brave or similar browser was found on this computer, so a ChartKeeper window opens instead. Google and Apple sign-in do not work there: sign in with your TradingView email and password, or install Google Chrome and try again.',
  'signin.waitingTitle': 'Waiting for you to sign in…',
  'signin.waitingBody': 'Sign in in the browser window that just opened. This window updates by itself when you are done.',
  'signin.waitingSafari': 'Sign in to TradingView in Safari. This window updates by itself a few seconds after you are done.',

  'home.backup': 'Back up now',
  'home.view': 'View my backups',
  'home.restore': 'Restore a chart',
  'home.needSignIn': 'Sign in to TradingView first to back up or restore. You can look at your backups without signing in.',
  'home.actions': 'What to do',
  'home.lastBackupLabel': 'Last backup',
  'home.lastGoodLabel': 'Last complete backup',
  'home.never': 'None yet',
  'home.lastBackupSafe': '{layouts} and {drawings} are safe on this computer.',
  'home.lastBackupNoCount': 'Your layouts are safe on this computer.',
  'home.signInTitle': 'Sign in to start backing up',
  'home.statsLabel': 'Your backups at a glance',
  'home.statLayouts': 'Layouts',
  'home.statDrawings': 'Drawings',
  'home.statBackups': 'Backups kept',
  'home.statSchedule': 'Automatic backup',
  'home.daily': 'Daily at {time}',
  'home.off': 'Off',
  'home.recent': 'Recent backups',
  'home.history': 'Drawings saved in each of your last {n} backups, since {since}',
  'home.seeAll': 'See all',
  'home.lastBackupFailed': 'The last backup ({when}) did not finish. Press “Back up now” to try again.',
  'home.noBackupYet': 'You have not made a backup yet.',
  'home.busyBackup': 'A backup is running right now.',
  'home.busyRestore': 'A chart is being restored right now.',

  'settings.title': 'Settings',
  'settings.folder': 'Your backups are saved in this folder',
  'settings.change': 'Change…',
  'settings.daily': 'Back up automatically every day',
  'settings.dailyHour': 'At what time',
  'settings.dailyNote': 'ChartKeeper keeps running in the background after you close the window, so the backup can happen on time. Look for its small icon next to the clock. The computer must be switched on.',
  'settings.prices': 'Also save prices so charts can be viewed offline',
  'settings.pricesNote': 'For your personal use only. The prices belong to TradingView and its data providers.',

  'count.layouts_one': '{n} layout',
  'count.layouts_other': '{n} layouts',
  'count.drawings_one': '{n} drawing',
  'count.drawings_other': '{n} drawings',
  'count.indicators_one': '{n} indicator',
  'count.indicators_other': '{n} indicators',
  'count.notes_one': '{n} note',
  'count.notes_other': '{n} notes',

  'backupStep.list': 'Getting the list of your layouts from TradingView…',
  'backupStep.layout': 'Saving the layout “{name}”…',
  'backupStep.userDrawings': 'Saving drawings that are shared between your layouts…',
  'backupStep.studyTemplates': 'Saving your indicator templates…',
  'backupStep.drawingTemplates': 'Looking for your drawing templates…',
  'backupStep.themes': 'Saving your colour themes…',
  'backupStep.scripts': 'Saving your Pine scripts…',
  'backupStep.prices': 'Saving prices for “{name}” so you can view it offline…',
  'backupStep.finish': 'Finishing the backup…',
  'backupPart.done': '{done} of {total} done',
  'backupPart.drawingTemplates': 'TradingView must be asked about each drawing tool separately, so this step takes a few minutes. {done} of {total} tools checked.',
  'backup.minutesLeft_one': 'About {n} minute left',
  'backup.minutesLeft_other': 'About {n} minutes left',
  'backup.underAMinute': 'Less than a minute left',

  'backup.running': 'Making a backup…',
  'backup.runningNote': 'You can leave the window open and do something else in the meantime.',
  'backup.starting': 'Starting…',
  'backup.done': 'Backup complete',
  'backup.doneSummary': '{layouts} and {drawings} are saved on this computer.',
  'backup.viewIt': 'View it',
  'backup.notesIntro': 'Technical notes from the backup. The backup is still complete.',
  'backup.failed': 'The backup could not be completed',
  'backup.failedPartial': 'What was saved before the problem is marked as incomplete, so you will not mistake it for a full backup.',

  'view.unnamed': 'No name in TradingView',
  'view.title': 'My backups',
  'view.backups': 'Backups',
  'view.empty': 'There are no backups yet. Go back and press “Back up now”.',
  'view.incomplete': 'Incomplete',
  'view.incompleteNote': 'This backup did not finish. Do not rely on it.',
  'view.unreadable': 'This backup could not be read.',
  'view.safetyCopy': 'Safety copy before a replace',
  'view.layouts': 'Layouts in this backup',
  'view.noLayouts': 'This backup has no layouts.',
  'view.noPrices': 'No offline prices',
  'view.compareLabel': 'Compare with an older backup',
  'view.compareButton': 'Compare',
  'view.compareNoOlder': 'There is no older backup to compare with.',
  'view.compareTitle': 'Changes from {older} to {newer}',
  'view.compareNone': 'Nothing changed between these two backups.',
  'view.compareUnchanged': 'Unchanged: {names}',
  'view.compareOther': 'Templates, themes and scripts',
  'view.compareClose': 'Back to the chart',
  'view.pickLayout': 'Choose a layout above to see it.',
  'view.chart': 'Chart',
  'view.chartHint': 'Drag to move · scroll or pinch to zoom',
  'view.zoomIn': 'Zoom in',
  'view.zoomOut': 'Zoom out',
  'view.resetView': 'Reset view',
  'view.fullScreen': 'Full screen',
  'view.exitFullScreen': 'Exit full screen',
  'view.prevLayout': 'Previous layout',
  'view.nextLayout': 'Next layout',
  'view.layoutOf': '{n} of {total}',

  'change.added': 'Added',
  'change.removed': 'Removed',
  'change.changed': 'Changed',
  'change.layout': 'Layout',
  'change.chart': 'Chart {n}',
  'change.indicator': 'Indicator {name}',
  'change.drawingTemplate': 'Drawing template',
  'change.studyTemplate': 'Indicator template',
  'change.theme': 'Theme',
  'change.script': 'Pine script',
  'change.renamed': 'renamed from “{from}” to “{to}”',
  'change.arrangement': 'chart arrangement {from} → {to}',
  'change.symbol': 'symbol {from} → {to}',
  'change.interval': 'interval {from} → {to}',
  'change.chartType': 'chart type changed',
  'change.settings': 'settings: {list}',
  'change.styles': 'colors or line styles changed',
  'change.drawingOn': '{tool} on {symbol} ({points})',
  'change.drawingWithText': '{tool} “{text}” on {symbol} ({points})',
  'change.theChart': 'the chart',
  'change.moved': 'moved: {from} → {to}',
  'change.props': 'style or text: {list}',
  'change.more': '(+{n} more)',
  'layoutStatus.added': 'New layout',
  'layoutStatus.removed': 'Layout deleted',
  'layoutStatus.changed': 'Changed',
  'layoutStatus.same': 'No changes',

  'restore.title': 'Restore a chart',
  'restore.stepOf': 'Step {n} of 3',
  'restore.step1': 'Choose the chart',
  'restore.step2': 'Check',
  'restore.step3': 'Restore',
  'restore.chooseTitle': 'Which chart do you want back?',
  'restore.chooseBackup': 'Choose a backup',
  'restore.chooseLayout': 'Choose the layout',
  'restore.noBackups': 'There are no backups to restore from yet.',
  'restore.newTitle': 'It will be added as a new layout',
  'restore.restoring': 'You are restoring “{name}” from the backup taken {when}.',
  'restore.checking': 'Checking your TradingView account…',
  'restore.newName': 'Its name on TradingView: “{name}”',
  'restore.newNote': 'Nothing on TradingView is changed or deleted. The chart is added next to your other layouts.',
  'restore.uncheckedTitle': 'Saved, but not checked on the chart',
  'restore.uncheckedNote': 'TradingView saved everything from the backup, but ChartKeeper could not open the chart to check what it shows. Open the layout on TradingView and look it over.',
  'restore.slots': 'You have {used} of {limit} saved layouts on TradingView.',
  'restore.slotsUnlimited': 'You have {used} saved layouts on TradingView.',
  'restore.fullTitle': 'There is no room for a new layout',
  'restore.fullBody': 'Your TradingView plan ({plan}) allows {limit} saved layouts, and they are all in use.',
  'restore.fullBodyNoPlan': 'Your TradingView plan allows {limit} saved layouts, and they are all in use.',
  'restore.fullWhat': 'What you can do:',
  'restore.fullDelete': 'Delete a layout you no longer use on TradingView, then come back here.',
  'restore.fullUpgrade': 'Upgrade your TradingView plan to get room for more layouts.',
  'restore.start': 'Restore',
  'restore.running': 'Restoring “{name}”…',
  'restore.runningNote': 'Please wait. This takes about a minute.',
  'restore.done': 'Your layout “{name}” is back on TradingView',
  'restore.checkTitle': 'ChartKeeper checked the result',
  'restore.colWhat': 'What',
  'restore.colBackup': 'In the backup',
  'restore.colSaved': 'Saved on TradingView',
  'restore.colShown': 'Shown on the chart',
  'restore.notChecked': 'Could not check. Open the layout to look.',
  'restore.rowCharts': 'Charts',
  'restore.rowDrawings': 'Drawings',
  'restore.rowIndicators': 'Indicators',
  'restore.open': 'Open on TradingView',
  'restore.missingTitle': 'Not everything came back',
  'restore.missing_one': '{n} drawing from the backup is missing on TradingView.',
  'restore.missing_other': '{n} drawings from the backup are missing on TradingView.',
  'restore.mismatchNote': 'Open the layout on TradingView and look it over. Your backup is untouched, so you can try again.',
  'restore.resumed': 'An earlier attempt had already started this restore, so ChartKeeper finished it instead of making a second copy.',
  'restore.another': 'Restore another chart',
  'restore.failed': 'The chart could not be restored',
  'restore.templatesTitle': 'Templates and themes',
  'restore.templatesNote': 'Adds the indicator templates, drawing templates and colour themes from the chosen backup to TradingView. The ones you already have are left alone.',
  'restore.templatesButton': 'Restore my templates and themes',
  'restore.templatesRunning': 'Restoring templates and themes…',
  'restore.templatesAdded': 'Added',
  'restore.templatesSkipped': 'Already there, left alone',
  'restore.templatesNothing': 'There was nothing to restore in this backup.',
  'restore.templateStudy': 'Indicator template “{name}”',
  'restore.templateDrawing': 'Drawing template “{name}”',
  'restore.templateTheme': 'Theme “{name}”',
  'restore.missingStudy': 'Indicator templates (not in this backup)',
  'restore.missingDrawing': 'Drawing templates (not in this backup)',
  'restore.missingTheme': 'Themes (not in this backup)',

  'restoreStep.check': 'Checking your TradingView account…',
  'restoreStep.create': 'Creating the layout on TradingView…',
  'restoreStep.verify': 'Checking that everything came back…',

  'error.details': 'Details',
  'error.signInAgain': 'Sign in again',
  'error.not-signed-in.title': 'You are not signed in to TradingView',
  'error.not-signed-in.body': 'Your sign-in has run out. Sign in again, then try once more.',
  'error.rate-limited.title': 'TradingView asked ChartKeeper to wait',
  'error.rate-limited.body': 'Too many requests were sent in a short time. Wait an hour, then try again. Nothing is wrong with your account.',
  'error.format-changed.title': 'TradingView has changed something',
  'error.format-changed.body': 'ChartKeeper did not recognise TradingView’s answer and stopped to be safe. Nothing on TradingView was changed. Please check for a new version of ChartKeeper.',
  'error.limit-reached.title': 'There is no room for another layout',
  'error.limit-reached.body': 'Your TradingView plan ({plan}) allows {limit} saved layouts, and they are all in use. Delete a layout you no longer use on TradingView, or upgrade your plan, then try again.',
  'error.limit-reached.bodyGeneric': 'Your TradingView plan has no room for more saved layouts. Delete a layout you no longer use on TradingView, or upgrade your plan, then try again.',
  'error.too-large.title': 'The layout is too large',
  'error.too-large.body': 'TradingView will not accept a layout this large. Nothing was changed.',
  'error.not-found.title': 'The layout could not be found',
  'error.not-found.body': 'TradingView could not find it. It may have been deleted in the meantime.',
  'error.network.title': 'No connection to the internet',
  'error.network.body': 'Check that the computer is connected to the internet, then try again.',
  'error.server.title': 'TradingView is having problems right now',
  'error.server.body': 'This is on TradingView’s side. Try again a little later.',
  'error.cancelled.title': 'Sign-in window closed',
  'error.cancelled.body': 'The sign-in window was closed before you finished signing in. Nothing was saved. Click "Sign in to TradingView" to try again.',
  'error.unexpected.title': 'Something went wrong',
  'error.unexpected.body': 'ChartKeeper ran into an unexpected problem. Try again. If it keeps happening, send the details below to the person who helps you.',
  'error.busy.title': 'ChartKeeper is busy',
  'error.busy.body': 'Another task is running. Wait until it has finished, then try again.',
  'error.browser.title': 'The browser could not be opened',
  'error.browser.body': 'ChartKeeper could not open a window for signing in. Try again. If it keeps happening, restart the computer.',
  'error.safari-access.title': 'ChartKeeper needs your permission to use Safari',
  'error.safari-access.body': 'Open System Settings, then Privacy & Security, then Full Disk Access. Turn on ChartKeeper (if it is not in the list, click + and choose ChartKeeper in Applications). Click "Quit & Reopen" if macOS asks, then click "Sign in to TradingView" again.',
} as const;

export type Key = keyof typeof TEXT;

export type Params<K extends Key> = Record<ParamNames<(typeof TEXT)[K]>, string | number>;
type ParamArgs<K extends Key> = [ParamNames<(typeof TEXT)[K]>] extends [never] ? [] : [params: Params<K>];

export function t<K extends Key>(key: K, ...args: ParamArgs<K>): string {
  return fill(TEXT[key], args[0]);
}

type PluralBase = { [K in Key]: K extends `${infer B}_one` ? B : never }[Key];
export function tn(base: PluralBase, n: number): string {
  const key = `${base}_${n === 1 ? 'one' : 'other'}` as Key;
  return fill(TEXT[key], { n: n.toLocaleString(LOCALE) });
}

/** Every kind of failure the window explains, and where its words live. */
export const ERROR_KEYS = {
  'not-signed-in': ['error.not-signed-in.title', 'error.not-signed-in.body'],
  'rate-limited': ['error.rate-limited.title', 'error.rate-limited.body'],
  'format-changed': ['error.format-changed.title', 'error.format-changed.body'],
  'limit-reached': ['error.limit-reached.title', 'error.limit-reached.body'],
  'too-large': ['error.too-large.title', 'error.too-large.body'],
  'not-found': ['error.not-found.title', 'error.not-found.body'],
  network: ['error.network.title', 'error.network.body'],
  server: ['error.server.title', 'error.server.body'],
  cancelled: ['error.cancelled.title', 'error.cancelled.body'],
  unexpected: ['error.unexpected.title', 'error.unexpected.body'],
  busy: ['error.busy.title', 'error.busy.body'],
  browser: ['error.browser.title', 'error.browser.body'],
  'safari-access': ['error.safari-access.title', 'error.safari-access.body'],
} as const satisfies Record<AppError['kind'], readonly [Key, Key]>;

export const BACKUP_STEP_KEYS = {
  list: 'backupStep.list',
  layout: 'backupStep.layout',
  userDrawings: 'backupStep.userDrawings',
  studyTemplates: 'backupStep.studyTemplates',
  drawingTemplates: 'backupStep.drawingTemplates',
  themes: 'backupStep.themes',
  scripts: 'backupStep.scripts',
  prices: 'backupStep.prices',
  finish: 'backupStep.finish',
} as const satisfies Record<BackupStep, Key>;

export const RESTORE_STEP_KEYS = {
  check: 'restoreStep.check',
  create: 'restoreStep.create',
  verify: 'restoreStep.verify',
} as const satisfies Record<RestoreStep, Key>;

export function explainError(error: AppError): { title: string; body: string } {
  const [titleKey, bodyKey] = ERROR_KEYS[error.kind] ?? ERROR_KEYS.unexpected;
  if (error.kind === 'limit-reached' && error.params.limit === undefined) return { title: TEXT[titleKey], body: TEXT['error.limit-reached.bodyGeneric'] };
  const params = error.kind === 'limit-reached' ? { plan: error.params.plan ?? '', ...error.params } : error.params;
  return { title: TEXT[titleKey], body: fill(TEXT[bodyKey], params) };
}

export function backupStepText(step: BackupStep, name: string | undefined): string {
  return fill(TEXT[BACKUP_STEP_KEYS[step]], { name: name ?? '' });
}

/** The line under the step: how far it is through its list. */
export function backupPartText(p: BackupProgress): string | null {
  if (!p.part || p.part.total === 0) return null;
  return fill(TEXT[p.step === 'drawingTemplates' ? 'backupPart.drawingTemplates' : 'backupPart.done'], p.part);
}

export function formatTimeLeft(seconds: number): string {
  return seconds < 60 ? TEXT['backup.underAMinute'] : tn('backup.minutesLeft', Math.round(seconds / 60));
}

export function restoreStepText(step: RestoreStep): string {
  return TEXT[RESTORE_STEP_KEYS[step]];
}

export function formatTime(d: Date): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }).format(d);
}

/** "Saturday, 17 October 2026" */
export function formatDay(d: Date): string {
  const s = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

export function formatHour(hour: number): string {
  return formatTime(new Date(2000, 0, 1, hour, 0));
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today at 09:12", "yesterday at 18:30", "3 days ago", then the plain date. */
export function formatRelative(d: Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return `today at ${formatTime(d)}`;
  if (days === 1) return `yesterday at ${formatTime(d)}`;
  if (days > 1 && days < 7) return new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' }).format(-days, 'day');
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}
