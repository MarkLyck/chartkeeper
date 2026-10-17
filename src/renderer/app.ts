import type { AppState, ChartKeeperApi } from '../shared/api';
import { backupScreen } from './ui/backup';
import { homeScreen } from './ui/home';
import { restoreScreen } from './ui/restore';
import type { Ctx, Route, Screen } from './ui/screen';
import { viewScreen } from './ui/view';

const api = (window as unknown as { chartkeeper: ChartKeeperApi }).chartkeeper;
const root = document.getElementById('app')!;

let state: AppState;
let route: Route = { name: 'home' };
let screen: Screen | null = null;

const ctx: Ctx = {
  api,
  state: () => state,
  update: applyState,
  go(next) {
    route = next;
    mount();
  },
};

function build(r: Route): Screen {
  switch (r.name) {
    case 'home':
      return homeScreen(ctx, { startSignIn: r.startSignIn ?? false });
    case 'backup':
      return backupScreen(ctx);
    case 'view':
      return viewScreen(ctx, r.snapshotDir ? { snapshotDir: r.snapshotDir } : {});
    case 'restore':
      return restoreScreen(ctx);
  }
}

function mount() {
  screen?.destroy?.();
  screen = build(route);
  root.replaceChildren(screen.el);
  window.scrollTo(0, 0);
  (screen.el.querySelector('h1') as HTMLElement | null)?.focus({ preventScroll: true });
}

function applyState(next: AppState) {
  state = next;
  screen?.onState?.(next);
}

async function start() {
  state = await api.getState();
  api.onStateChanged(applyState);
  api.onProgress((e) => screen?.onProgress?.(e));
  mount();
}

void start();
