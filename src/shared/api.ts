import type { BackupProgress } from '../core/backup';
import type { Manifest } from '../core/model';
import type { RestoreResult, RestoreStep } from '../core/restore';
import type { LoadedLayout, SnapshotComparison } from '../core/snapshotView';
export type { LoadedLayout } from '../core/snapshotView';
import type { TvErrorKind } from '../core/tv/errors';

/**
 * The contract between the window (renderer) and the app process (main).
 * The preload script exposes exactly this object as `window.chartkeeper`.
 */
export type Lang = 'da' | 'en';

export interface Settings {
  /** Folder that holds the "snapshots" folder. */
  backupFolder: string;
  dailyBackup: boolean;
  /** Hour of day (0-23) after which the daily backup runs. */
  dailyHour: number;
  includePrices: boolean;
  lang: Lang;
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
  busy: 'backup' | 'restore' | 'signin' | null;
}

/** A failure the window can explain. `kind` picks the wording; `message` is the English text. */
export interface AppError {
  kind: TvErrorKind | 'cancelled' | 'unexpected' | 'busy' | 'browser';
  message: string;
  params: Record<string, string | number>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface SnapshotSummary {
  dir: string;
  name: string;
  manifest: Manifest | null;
  problem: string | null;
  /** A copy ChartKeeper took of a layout just before replacing it. */
  safetyCopy: boolean;
}

export interface BackupOutcome {
  dir: string;
  ok: boolean;
  layouts: number;
  drawings: number;
  warnings: string[];
  error: AppError | null;
}

export interface TvLayoutInfo {
  uid: string;
  name: string;
}

export interface RestoreTargets {
  layouts: TvLayoutInfo[];
  used: number;
  limit: number | null;
  plan: string | null;
  free: boolean;
}

export type RestoreRequest = { snapshotDir: string; uid: string } & ({ mode: 'new' } | { mode: 'replace'; targetUid: string; confirmedName: string });

export type RestoreOutcome = RestoreResult;

export type CompareOutcome = SnapshotComparison;

export type ProgressEvent = { kind: 'backup'; progress: BackupProgress } | { kind: 'restore'; step: RestoreStep; name?: string };

export interface ChartKeeperApi {
  getState(): Promise<AppState>;
  setSettings(patch: Partial<Settings>): Promise<AppState>;
  chooseFolder(): Promise<AppState>;
  signIn(): Promise<Result<AppState>>;
  signOut(): Promise<AppState>;
  backupNow(): Promise<Result<BackupOutcome>>;
  listSnapshots(): Promise<SnapshotSummary[]>;
  loadLayout(snapshotDir: string, uid: string): Promise<Result<LoadedLayout>>;
  compare(olderDir: string, newerDir: string): Promise<Result<CompareOutcome>>;
  restoreTargets(): Promise<Result<RestoreTargets>>;
  restore(req: RestoreRequest): Promise<Result<RestoreOutcome>>;
  restoreTemplates(snapshotDir: string): Promise<Result<{ added: string[]; skipped: string[] }>>;
  openFolder(dir: string): Promise<void>;
  openOnTradingView(url: string): Promise<void>;
  onProgress(cb: (e: ProgressEvent) => void): () => void;
  onStateChanged(cb: (s: AppState) => void): () => void;
}

export const IPC = {
  getState: 'ck:getState',
  setSettings: 'ck:setSettings',
  chooseFolder: 'ck:chooseFolder',
  signIn: 'ck:signIn',
  signOut: 'ck:signOut',
  backupNow: 'ck:backupNow',
  listSnapshots: 'ck:listSnapshots',
  loadLayout: 'ck:loadLayout',
  compare: 'ck:compare',
  restoreTargets: 'ck:restoreTargets',
  restore: 'ck:restore',
  restoreTemplates: 'ck:restoreTemplates',
  openFolder: 'ck:openFolder',
  openOnTradingView: 'ck:openOnTradingView',
  progress: 'ck:progress',
  state: 'ck:state',
} as const;
