import type { AppState, ChartKeeperApi, ProgressEvent } from '../../shared/api';

export type Route =
  | { name: 'home'; startSignIn?: boolean }
  | { name: 'backup' }
  | { name: 'view'; snapshotDir?: string }
  | { name: 'restore' };

export interface Ctx {
  api: ChartKeeperApi;
  state(): AppState;
  /** Takes a state returned by an api call, so the app and the current screen see it at once. */
  update(s: AppState): void;
  go(route: Route): void;
}

/** A mounted screen. The app forwards state and progress events to the one on display. */
export interface Screen {
  el: HTMLElement;
  onState?(s: AppState): void;
  onProgress?(e: ProgressEvent): void;
  destroy?(): void;
}
