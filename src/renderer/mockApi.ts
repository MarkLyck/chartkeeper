// Dev and preview only. The real window gets window.chartkeeper from the preload script;
// scripts/ui-preview.ts installs this mock in its place before app.js loads.
import type { LayoutCounts, ParsedLayout } from '../core/layout';
import type { ChartData, Manifest, ManifestLayout } from '../core/model';
import type { RestoreStep } from '../core/restore';
import { checkRestore, restoredName } from '../core/restorePolicy';
import { urls } from '../core/tv/endpoints';
import type {
  AppError, AppState, BackupOutcome, ChartKeeperApi, CompareOutcome, ProgressEvent, RestoreOutcome, RestoreTargets, Result, SnapshotSummary,
} from '../shared/api';

/** The real reference snapshot, read and parsed in Node by the preview script. */
export interface PreviewFixture {
  layout: ParsedLayout;
  data: Record<string, ChartData | null>;
  manifest: Manifest;
}

export interface MockScenario {
  signIn: 'ok' | 'browser';
  backup: 'ok' | 'format-changed' | 'not-signed-in';
  slots: 'free' | 'full';
  restore: 'ok' | 'mismatch' | 'unchecked' | 'limit-reached';
}

export interface MockControl {
  scenario: MockScenario;
  stepMs: number;
  /** Long tasks stop after this many progress events until release() is called. */
  pauseAfter: number | null;
  release(): void;
  setState(patch: Partial<AppState>): void;
  calls: { method: string; args: unknown[] }[];
}

const FOLDER = '/Users/demo/Documents/ChartKeeper';
const fail = (kind: AppError['kind'], message: string, params: AppError['params'] = {}): { ok: false; error: AppError } => ({ ok: false, error: { kind, message, params } });

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

const point = (day: string, price: number) => ({ time: Date.parse(`${day}T00:00:00Z`) / 1000, offset: 0, price });

function daysAgo(days: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 7, 0);
  return d;
}

export function createMockApi(fixture: PreviewFixture, init: { signedIn?: boolean } = {}): { api: ChartKeeperApi; control: MockControl } {
  const ref = fixture.manifest.layouts[0]!;
  const extra = (uid: string, name: string, symbol: string, drawings: number, studies: number): ManifestLayout => ({
    uid, name, dir: `layouts/${uid}`, symbols: [symbol], charts: 1, drawings, studies, lastModified: null, priceData: false,
  });
  const msft = extra('MSFT1D', 'Microsoft – daily', 'NASDAQ:MSFT', 23, 3);
  const spx = extra('SPXW01', 'S&P 500 – weekly', 'SP:SPX', 14, 1);
  const tsla = extra('TSLA01', 'Tesla old', 'NASDAQ:TSLA', 6, 2);

  const snapshot = (at: Date, layouts: ManifestLayout[], status: 'complete' | 'incomplete', error?: string): SnapshotSummary => {
    const name = stamp(at);
    const manifest: Manifest = {
      ...fixture.manifest,
      createdAt: at.toISOString(),
      status,
      ...(error ? { error } : {}),
      account: { username: 'demo_user', plan: 'Essential' },
      layouts,
      warnings: [],
    };
    return { dir: `${FOLDER}/snapshots/${name}`, name, manifest, problem: null, safetyCopy: false };
  };

  const snapshots: SnapshotSummary[] = [
    snapshot(daysAgo(9, 18, 0), [ref, msft, tsla], 'complete'),
    snapshot(daysAgo(3, 18, 0), [ref], 'incomplete', `TradingView says "S&P 500 – weekly" has 14 drawings but sent none. The backup was stopped so it isn't saved without them.`),
    snapshot(daysAgo(0, 9, 12), [ref, msft, spx], 'complete'),
  ];

  let state: AppState = {
    version: '1.0.0',
    platform: 'darwin',
    settings: { backupFolder: FOLDER, dailyBackup: true, dailyHour: 18, includePrices: true },
    signedIn: init.signedIn ?? true,
    username: init.signedIn === false ? null : 'demo_user',
    browserName: 'Google Chrome',
    lastBackup: { at: snapshots[2]!.manifest!.createdAt, ok: true, dir: snapshots[2]!.dir },
    busy: null,
  };

  const stateListeners = new Set<(s: AppState) => void>();
  const progressListeners = new Set<(e: ProgressEvent) => void>();
  let releaseGate: (() => void) | null = null;
  let emitted = 0;

  const control: MockControl = {
    scenario: { signIn: 'ok', backup: 'ok', slots: 'free', restore: 'ok' },
    stepMs: 350,
    pauseAfter: null,
    release() {
      control.pauseAfter = null;
      releaseGate?.();
    },
    setState(patch) {
      setState(patch);
    },
    calls: [],
  };

  const setState = (patch: Partial<AppState>) => {
    state = { ...state, ...patch, settings: { ...state.settings, ...patch.settings } };
    for (const cb of stateListeners) cb(state);
    return state;
  };

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function progress(e: ProgressEvent) {
    await wait(control.stepMs);
    for (const cb of progressListeners) cb(e);
    emitted++;
    if (control.pauseAfter !== null && emitted >= control.pauseAfter) await new Promise<void>((r) => (releaseGate = r));
  }

  const record = (method: string, ...args: unknown[]) => control.calls.push({ method, args });
  const newest = () => snapshots[snapshots.length - 1]!;
  const findLayout = (dir: string, uid: string) => snapshots.find((s) => s.dir === dir)?.manifest?.layouts.find((l) => l.uid === uid) ?? null;
  const counts = (l: ManifestLayout): LayoutCounts => ({
    charts: l.charts, drawings: l.drawings, studies: l.studies,
    drawingIds: Array.from({ length: l.drawings }, (_, i) => `d${i}`), studyIds: Array.from({ length: l.studies }, (_, i) => `s${i}`), symbols: l.symbols,
  });

  async function runBackup(): Promise<Result<BackupOutcome>> {
    if (control.scenario.backup === 'not-signed-in') {
      await wait(control.stepMs);
      return fail('not-signed-in', 'TradingView answered 401 for /my-charts/: the session has expired.');
    }
    const layouts = newest().manifest!.layouts;
    emitted = 0;
    await progress({ kind: 'backup', progress: { done: 0, total: 1, step: 'list' } });
    const total = layouts.length * 2 + 4;
    let done = 0;
    for (const l of layouts) await progress({ kind: 'backup', progress: { done: ++done, total, step: 'layout', name: l.name } });
    if (control.scenario.backup === 'format-changed') {
      const at = new Date();
      const s = snapshot(at, layouts.slice(0, 1), 'incomplete', 'Some drawings in "Microsoft – daily" have an unknown format.');
      snapshots.push(s);
      setState({ lastBackup: { at: at.toISOString(), ok: false, dir: s.dir } });
      return {
        ok: true,
        value: {
          dir: s.dir, ok: false, layouts: 1, drawings: ref.drawings, warnings: [],
          error: { kind: 'format-changed', message: 'Some drawings in "Microsoft – daily" have an unknown format.\nsource LineToolGannSquare: points missing', params: {} },
        },
      };
    }
    for (const step of ['userDrawings', 'studyTemplates', 'drawingTemplates', 'scripts'] as const) await progress({ kind: 'backup', progress: { done: ++done, total, step } });
    for (const l of layouts) await progress({ kind: 'backup', progress: { done: ++done, total, step: 'prices', name: l.name } });
    await progress({ kind: 'backup', progress: { done: total, total, step: 'finish' } });
    const at = new Date();
    const s = snapshot(at, layouts, 'complete');
    snapshots.push(s);
    setState({ lastBackup: { at: at.toISOString(), ok: true, dir: s.dir } });
    return {
      ok: true,
      value: {
        dir: s.dir, ok: true, layouts: layouts.length, drawings: layouts.reduce((n, l) => n + l.drawings, 0),
        warnings: [
          '"S&P 500 – weekly": TradingView reports 15 drawings, ChartKeeper received 14.',
          'Prices for SP:SPX (1W) could not be loaded: symbol_error. The layout itself is backed up.',
        ],
      },
    };
  }

  const busy = async <T>(kind: 'backup' | 'restore', run: () => Promise<Result<T>>): Promise<Result<T>> => {
    if (state.busy) return fail('busy', `ChartKeeper is already busy (${state.busy}).`);
    setState({ busy: kind });
    try {
      return await run();
    } finally {
      setState({ busy: null });
    }
  };

  const targets = (): RestoreTargets => {
    const layouts = [
      { uid: 'tvAAPL', name: 'Reference AAPL' },
      { uid: 'tvMSFT', name: 'Microsoft – daily' },
      { uid: 'tvSPX', name: 'S&P 500 – weekly' },
      { uid: 'tvJPM', name: 'JPMorgan' },
      ...(control.scenario.slots === 'full' ? [{ uid: 'tvNVDA', name: 'Nvidia – 4 hours' }] : []),
    ];
    return { layouts, used: layouts.length, limit: 5, plan: 'Essential', free: control.scenario.slots === 'free' };
  };

  const api: ChartKeeperApi = {
    async getState() {
      return state;
    },
    async setSettings(patch) {
      record('setSettings', patch);
      return setState({ settings: { ...state.settings, ...patch } });
    },
    async chooseFolder() {
      record('chooseFolder');
      return setState({ settings: { ...state.settings, backupFolder: '/Volumes/USB DRIVE/ChartKeeper' } });
    },
    async signIn() {
      record('signIn');
      setState({ busy: 'signin' });
      await wait(control.stepMs * 3);
      if (control.scenario.signIn === 'browser') {
        setState({ busy: null });
        return fail('browser', 'Could not start Google Chrome: spawn ENOENT');
      }
      return { ok: true, value: setState({ busy: null, signedIn: true, username: 'demo_user' }) };
    },
    async cancelSignIn() {
      record('cancelSignIn');
    },
    async signOut() {
      record('signOut');
      return setState({ signedIn: false, username: null });
    },
    backupNow: () => busy('backup', runBackup),
    async listSnapshots() {
      return structuredClone(snapshots);
    },
    async loadLayout(dir, uid) {
      await wait(control.stepMs / 2);
      const entry = findLayout(dir, uid);
      if (!entry) return fail('not-found', `No layout ${uid} in ${dir}`);
      const layout: ParsedLayout = { ...fixture.layout, uid, name: entry.name };
      const data = entry.priceData ? fixture.data : Object.fromEntries(Object.keys(fixture.data).map((k) => [k, null]));
      return { ok: true, value: { layout, data } };
    },
    async compare(olderDir, newerDir) {
      record('compare', olderDir, newerDir);
      await wait(control.stepMs);
      const value: CompareOutcome = {
        layouts: [
          {
            uid: ref.uid, name: ref.name, status: 'changed', changes: [
              { kind: 'added', what: 'drawing', toolType: 'LineToolTrendLine', text: null, symbol: 'NASDAQ:AAPL', points: [point('2026-09-02', 228.5), point('2026-10-10', 241.2)] },
              { kind: 'removed', what: 'drawing', toolType: 'LineToolHorzLine', text: 'Support', symbol: 'NASDAQ:AAPL', points: [point('2026-08-01', 215)] },
              { kind: 'changed', what: 'study-inputs', shortName: 'RSI', inputs: [{ key: 'length', from: '14', to: '21' }] },
              { kind: 'changed', what: 'drawing-moved', toolType: 'LineToolFibRetracement', from: [point('2026-07-01', 190), point('2026-09-15', 236)], to: [point('2026-07-01', 190), point('2026-10-01', 244)] },
            ],
          },
          { uid: spx.uid, name: spx.name, status: 'added', changes: [] },
          { uid: tsla.uid, name: tsla.name, status: 'removed', changes: [] },
          { uid: msft.uid, name: msft.name, status: 'same', changes: [] },
        ],
        other: [{ kind: 'added', what: 'study-template', name: 'My moving averages' }],
      };
      return { ok: true, value };
    },
    async restoreTargets() {
      await wait(control.stepMs);
      if (!state.signedIn) return fail('not-signed-in', 'Not signed in.');
      return { ok: true, value: targets() };
    },
    restore: (req) =>
      busy('restore', async (): Promise<Result<RestoreOutcome>> => {
        record('restore', req);
        emitted = 0;
        const steps: RestoreStep[] = req.mode === 'new' ? ['check', 'create', 'verify'] : ['check', 'safetyCopy', 'replace', 'clearDrawings', 'verify'];
        const source = findLayout(req.snapshotDir, req.uid);
        if (!source) return fail('not-found', `No layout ${req.uid}`);
        for (const step of steps) {
          await progress({ kind: 'restore', step });
          if (step === 'create' && control.scenario.restore === 'limit-reached')
            return fail('limit-reached', 'TradingView refused the save: maximum number of layouts reached (5 for Essential).', { limit: 5, plan: 'Essential' });
        }
        const expected = counts(source);
        const missing = control.scenario.restore === 'mismatch' ? expected.drawingIds.slice(-2) : [];
        const actual = { ...expected, drawings: expected.drawings - missing.length, drawingIds: expected.drawingIds.filter((id) => !missing.includes(id)) };
        const target = req.mode === 'replace' ? targets().layouts.find((l) => l.uid === req.targetUid) : undefined;
        const uid = target?.uid ?? 'nW3kQ9aZ';
        return {
          ok: true,
          value: {
            uid,
            name: target?.name ?? restoredName(source.name, new Date()),
            url: urls.layoutPage(uid),
            check: checkRestore(expected, actual, control.scenario.restore === 'unchecked' ? null : { drawings: actual.drawings, studies: actual.studies }),
            safetyBackup: req.mode === 'replace' ? `${FOLDER}/safety-copies/${stamp(new Date())}_${target?.name ?? req.targetUid}` : null,
            resumed: false,
          },
        };
      }),
    async restoreTemplates(dir) {
      record('restoreTemplates', dir);
      await wait(control.stepMs * 2);
      return {
        ok: true,
        value: {
          added: [{ kind: 'study-template', name: 'My moving averages' }, { kind: 'theme', name: 'Light blue' }],
          skipped: [{ kind: 'study-template', name: 'Bollinger standard' }],
          missing: [],
        },
      };
    },
    async openFolder(dir) {
      record('openFolder', dir);
    },
    async openOnTradingView(url) {
      record('openOnTradingView', url);
    },
    onProgress(cb) {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
    onStateChanged(cb) {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
  };

  return { api, control };
}

/** Puts the mock on window before app.js runs. Options come from window.__CK_MOCK_INIT__ (set by the preview script). */
export function installMockApi(): void {
  const w = window as unknown as { __CK_FIXTURE__: PreviewFixture; __CK_MOCK_INIT__?: { signedIn?: boolean }; chartkeeper: ChartKeeperApi; __mock: MockControl };
  const { api, control } = createMockApi(w.__CK_FIXTURE__, w.__CK_MOCK_INIT__ ?? {});
  w.chartkeeper = api;
  w.__mock = control;
}
