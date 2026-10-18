import { fill, type ParamNames } from './template';

/** Text the app process shows outside the window: notifications and the tray menu. */
const STRINGS = {
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
} as const;

type MainStringKey = keyof typeof STRINGS;

/** Singular wording, used when the count `n` is 1. */
const ONE: Partial<Record<MainStringKey, string>> = {
  backupDoneBody: '{n} layout saved.',
};

type Args<K extends MainStringKey> = [ParamNames<(typeof STRINGS)[K]>] extends [never] ? [] : [params: Record<ParamNames<(typeof STRINGS)[K]>, string | number>];

export function mainString<K extends MainStringKey>(key: K, ...args: Args<K>): string {
  const params = args[0] as Record<string, string | number> | undefined;
  return fill(params?.n === 1 ? (ONE[key] ?? STRINGS[key]) : STRINGS[key], params);
}
