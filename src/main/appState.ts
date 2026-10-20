import { app } from 'electron';
import { TvError } from '../core/tv/errors';
import type { AppError, AppState, Result, UpdateState } from '../shared/api';
import type { TvAccount } from './account';
import { findBrowser } from './browsers';
import { SignInCancelled } from './browserSignIn';
import { log } from './log';
import { SafariAccessDenied } from './safariSignIn';
import type { Store } from './store';
import { hasSessionCookie } from './tvSession';

export type Task = NonNullable<AppState['busy']>;

function toAppError(e: unknown): AppError {
  if (e instanceof TvError) {
    log(`error ${e.kind}: ${e.message} ${e.detail}`);
    return { kind: e.kind, message: e.message, params: e.params };
  }
  if (e instanceof SignInCancelled) return { kind: 'cancelled', message: e.message, params: {} };
  if (e instanceof SafariAccessDenied) return { kind: 'safari-access', message: e.message, params: {} };
  const err = e as Error;
  log(`unexpected: ${err?.stack ?? String(e)}`);
  return { kind: 'unexpected', message: err?.message ?? String(e), params: {} };
}

export async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: toAppError(e) };
  }
}

/** Settings, the last backup, the signed-in account and the task that is running: everything the window shows. */
export class AppStatus {
  private running: Task | null = null;
  private updateState: UpdateState = { k: 'none' };

  constructor(
    readonly store: Store,
    readonly account: TvAccount,
    /** Called whenever the state the window shows may have changed. */
    private readonly changed: () => void,
  ) {}

  get busy(): Task | null {
    return this.running;
  }

  get update(): UpdateState {
    return this.updateState;
  }

  /** Only src/main/update.ts calls this, with the state its nextUpdate() returned. */
  setUpdate(next: UpdateState): void {
    if (next === this.updateState) return;
    this.updateState = next;
    this.changed();
  }

  async read(): Promise<AppState> {
    const signedIn = await hasSessionCookie();
    return {
      version: app.getVersion(),
      platform: process.platform as AppState['platform'],
      settings: this.store.settings,
      signedIn,
      username: signedIn ? this.account.username : null,
      browserName: findBrowser()?.name ?? null,
      lastBackup: this.store.lastBackup,
      busy: this.running,
      update: this.updateState,
    };
  }

  /** Runs one task at a time; a second one is refused with a "busy" error. */
  async exclusive<T>(kind: Task, fn: () => Promise<T>): Promise<Result<T>> {
    if (this.running) return { ok: false, error: { kind: 'busy', message: `ChartKeeper is busy (${this.running}).`, params: { task: this.running } } };
    this.running = kind;
    this.changed();
    try {
      return await guarded(fn);
    } finally {
      this.running = null;
      this.changed();
    }
  }
}
