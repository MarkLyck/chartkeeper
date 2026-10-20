import type { BackupResult } from '../core/backup';
import type { BackupProgress } from '../core/backupProgress';
import type { Manifest } from '../core/model';
import type { RestoreResult, RestoreStep, TemplateRestoreResult } from '../core/restore';
import type { LoadedLayout, SnapshotComparison } from '../core/snapshotView';
export type { LoadedLayout } from '../core/snapshotView';
import type { LayoutSlots } from '../core/tv/client';
export type { LayoutSlots } from '../core/tv/client';
import type { TvErrorKind } from '../core/tv/errors';

/**
 * The contract between the window (renderer) and the app process (main).
 * The preload script exposes exactly this object as `window.chartkeeper`.
 */
export interface Settings {
  /** Folder that holds the "snapshots" folder. */
  backupFolder: string;
  dailyBackup: boolean;
  /** Hour of day (0-23) after which the daily backup runs. */
  dailyHour: number;
  includePrices: boolean;
}

export interface AppState {
  version: string;
  platform: 'win32' | 'darwin' | 'linux';
  settings: Settings;
  signedIn: boolean;
  username: string | null;
  /** The browser used for signing in, or null when none was found (an in-app window is used then). */
  browserName: string | null;
  lastBackup: { at: string; ok: boolean; dir: string } | null;
  busy: 'backup' | 'restore' | 'signin' | 'update' | null;
  update: UpdateState;
}

/**
 * How a new version gets installed. 'restart': ChartKeeper replaces itself and starts again (Windows, Linux).
 * 'installer': it opens the downloaded installer for the user to drag in (macOS, where an app without a
 * paid developer certificate can't replace itself).
 */
export type UpdateHow = 'restart' | 'installer';

/** A newer release than the one running. `notes` is plain text. */
export interface UpdateRelease {
  version: string;
  notes: string;
  how: UpdateHow;
}

/** The update popup: shown for every state but 'none' and 'later'; 'later' leaves a button in the top bar to show it again. */
export type UpdateState =
  | { k: 'none' }
  | ({ k: 'available' } & UpdateRelease)
  | ({ k: 'later' } & UpdateRelease)
  | ({ k: 'downloading'; percent: number } & UpdateRelease)
  | ({ k: 'installer-open' } & UpdateRelease)
  | ({ k: 'failed'; message: string } & UpdateRelease);

/** A failure the window can explain. `kind` picks the wording; `message` is shown under Details. */
export interface AppError {
  kind: TvErrorKind | 'cancelled' | 'unexpected' | 'busy' | 'browser' | 'safari-access';
  message: string;
  params: Record<string, string | number>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface SnapshotSummary {
  dir: string;
  name: string;
  manifest: Manifest | null;
  problem: string | null;
  /** A copy older versions of ChartKeeper took of a layout just before replacing it. */
  safetyCopy: boolean;
}

export type BackupOutcome = BackupResult;

export interface RestoreRequest {
  snapshotDir: string;
  uid: string;
}

export type RestoreOutcome = RestoreResult;

export type TemplatesOutcome = TemplateRestoreResult;

export type CompareOutcome = SnapshotComparison;

export type ProgressEvent = { kind: 'backup'; progress: BackupProgress } | { kind: 'restore'; step: RestoreStep; name?: string };

export interface ChartKeeperApi {
  getState(): Promise<AppState>;
  setSettings(patch: Partial<Settings>): Promise<AppState>;
  chooseFolder(): Promise<AppState>;
  signIn(): Promise<Result<AppState>>;
  /** Stops a sign-in that is waiting for the user; its signIn() call then ends as cancelled. */
  cancelSignIn(): Promise<void>;
  signOut(): Promise<AppState>;
  backupNow(): Promise<Result<BackupOutcome>>;
  listSnapshots(): Promise<SnapshotSummary[]>;
  loadLayout(snapshotDir: string, uid: string): Promise<Result<LoadedLayout>>;
  compare(olderDir: string, newerDir: string): Promise<Result<CompareOutcome>>;
  /** How many saved layouts the TradingView plan allows and how many are in use. */
  layoutSlots(): Promise<Result<LayoutSlots>>;
  restore(req: RestoreRequest): Promise<Result<RestoreOutcome>>;
  restoreTemplates(snapshotDir: string): Promise<Result<TemplatesOutcome>>;
  openFolder(dir: string): Promise<void>;
  openOnTradingView(url: string): Promise<void>;
  /** Puts the window in full screen, or back as it was before; for the chart viewer. */
  setFullScreen(on: boolean): Promise<void>;
  onProgress(cb: (e: Events['progress']) => void): () => void;
  onStateChanged(cb: (s: Events['state']) => void): () => void;
}

/** Calls from the window to the app process: one IPC channel each. */
export type Invoke = Omit<ChartKeeperApi, 'onProgress' | 'onStateChanged'>;

/** Pushed from the app process to the window. */
export interface Events {
  progress: ProgressEvent;
  state: AppState;
}

export const INVOKE_CHANNELS = {
  getState: 'ck:getState',
  setSettings: 'ck:setSettings',
  chooseFolder: 'ck:chooseFolder',
  signIn: 'ck:signIn',
  cancelSignIn: 'ck:cancelSignIn',
  signOut: 'ck:signOut',
  backupNow: 'ck:backupNow',
  listSnapshots: 'ck:listSnapshots',
  loadLayout: 'ck:loadLayout',
  compare: 'ck:compare',
  layoutSlots: 'ck:layoutSlots',
  restore: 'ck:restore',
  restoreTemplates: 'ck:restoreTemplates',
  openFolder: 'ck:openFolder',
  openOnTradingView: 'ck:openOnTradingView',
  setFullScreen: 'ck:setFullScreen',
} as const satisfies { [K in keyof Invoke]: `ck:${K}` };

export const EVENT_CHANNELS = { progress: 'ck:progress', state: 'ck:state' } as const satisfies { [K in keyof Events]: `ck:${K}` };
