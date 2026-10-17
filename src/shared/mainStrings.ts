import type { Lang } from './api';
import { fill, type ParamNames } from './template';

/** Text the app process shows outside the window: notifications, the tray menu, restored layout names. */
const en = {
  backupDoneTitle: 'Backup complete',
  backupDoneBody: '{n} layouts saved.',
  backupFailedTitle: 'Backup failed',
  backupFailedBody: 'Open ChartKeeper to see why. {detail}',
  signInNeededTitle: "ChartKeeper can't take today's backup",
  signInNeededBody: 'You are no longer signed in to TradingView. Open ChartKeeper and sign in again.',
  trayBackingUp: 'ChartKeeper is backing up…',
  trayOpen: 'Open ChartKeeper',
  trayBackUpNow: 'Back up now',
  trayQuit: 'Quit',
  restoredWord: 'restored',
} as const;

type MainStringKey = keyof typeof en;

const da: Record<MainStringKey, string> = {
  backupDoneTitle: 'Backup gennemført',
  backupDoneBody: '{n} layouts er gemt.',
  backupFailedTitle: 'Backup mislykkedes',
  backupFailedBody: 'Åbn ChartKeeper for at se hvorfor. {detail}',
  signInNeededTitle: 'ChartKeeper kan ikke tage backup',
  signInNeededBody: 'Du er ikke længere logget ind på TradingView. Åbn ChartKeeper, og log ind igen.',
  trayBackingUp: 'ChartKeeper tager backup…',
  trayOpen: 'Åbn ChartKeeper',
  trayBackUpNow: 'Tag backup nu',
  trayQuit: 'Afslut',
  restoredWord: 'gendannet',
};

const STRINGS: Record<Lang, Record<MainStringKey, string>> = { en, da };

type Args<K extends MainStringKey> = [ParamNames<(typeof en)[K]>] extends [never] ? [] : [params: Record<ParamNames<(typeof en)[K]>, string | number>];

export function mainStrings(lang: Lang) {
  return <K extends MainStringKey>(key: K, ...args: Args<K>): string => fill(STRINGS[lang][key], args[0]);
}
