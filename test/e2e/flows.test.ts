import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ElectronApplication, Page } from 'playwright-core';
import type { Manifest } from '../../src/core/model';
import { isTradingViewHost } from '../../src/core/tv/endpoints';
import type { FakeControl, FakeSeed, Scenario } from '../fakes/fakeTradingViewApp';
import type { FakeLayout } from '../fakes/fakeTradingView';
import { referenceInAccount } from '../fakes/fixtures';
import { launchApp, ROOT } from './launch';

/** The fake TradingView inside the app process, as `app.evaluate` callbacks see it. */
type G = { __chartkeeperFake: FakeControl };

const SHOTS = path.join(ROOT, '.test-output', 'e2e');

const shot = async (window: Page, name: string) => {
  await fs.mkdir(SHOTS, { recursive: true });
  await window.screenshot({ path: path.join(SHOTS, `${name}-${process.platform}.png`), fullPage: true });
};

/** Min AAPL: the reference layout as a real account stores it (11 drawings, 2 indicators). */
const minAapl = () => referenceInAccount('AbCd1234', 'Min AAPL');

/** A second layout with the same chart and no drawings. */
function scratchPad(): FakeLayout {
  const l = referenceInAccount('Scr4tch01', 'Scratch pad');
  for (const pane of l.content.charts[0]!.panes) pane.sources = pane.sources.filter((s) => !String(s.type).startsWith('LineTool'));
  return { ...l, id: 502, storage: {} };
}

const drawingIdsInContent = (l: FakeLayout) => l.content.charts.flatMap((c) => c.panes.flatMap((p) => p.sources.filter((s) => String(s.type).startsWith('LineTool')).map((s) => String(s.id)))).sort();
const storedIds = (l: FakeLayout) => Object.values(l.storage).flatMap((b) => Object.keys(b)).sort();

async function snapshotsOnDisk(backups: string, sub = 'snapshots'): Promise<{ name: string; dir: string; manifest: Manifest }[]> {
  const root = path.join(backups, sub);
  // A run still writing sits in ".in-progress-<stamp>" until it is renamed; only finished backups count.
  const names = (await fs.readdir(root).catch(() => [] as string[])).filter((n) => !n.startsWith('.in-progress-')).sort();
  return Promise.all(names.map(async (name) => ({ name, dir: path.join(root, name), manifest: JSON.parse(await fs.readFile(path.join(root, name, 'manifest.json'), 'utf8')) as Manifest })));
}

async function windowAt(app: ElectronApplication, url: RegExp): Promise<Page> {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const w = app.windows().find((p) => url.test(p.url()));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No window opened at ${url}`);
}

describe('the production bundle', () => {
  it('holds only the switch for the fake TradingView, not the fake itself', async () => {
    const main = await fs.readFile(path.join(ROOT, 'dist/main.js'), 'utf8');
    for (const fakeOnly of ['__chartkeeperFake', 'protocol.handle', 'fake-session', 'TradingViewApi = {', 'class FakeTradingView']) expect(main).not.toContain(fakeOnly);
    expect(main).toContain('!isPackaged && env[FAKE_TRADINGVIEW_ENV] === "1"');
  });
});

describe('every flow against a fake TradingView', () => {
  let app: ElectronApplication;
  let window: Page;
  let backups: string;
  const errors: string[] = [];
  const seed: FakeSeed = { layouts: [minAapl(), scratchPad()], plan: 'pro_premium', signedIn: false, scheduleEveryMs: 15 * 60_000 };

  const fake = {
    setScenario: (s: Scenario) => app.evaluate((_e, s) => (globalThis as unknown as G).__chartkeeperFake.setScenario(s), s),
    layouts: () => app.evaluate(() => [...(globalThis as unknown as G).__chartkeeperFake.tv.layouts.values()]),
    layout: async (uid: string) => (await fake.layouts()).find((l) => l.uid === uid)!,
    requests: () => app.evaluate(() => (globalThis as unknown as G).__chartkeeperFake.tv.requests.map((r) => ({ method: r.method, url: r.url, form: r.form ?? null }))),
    clearRequests: () => app.evaluate(() => void ((globalThis as unknown as G).__chartkeeperFake.tv.requests = [])),
    setPlan: (plan: string) => app.evaluate((_e, plan) => void ((globalThis as unknown as G).__chartkeeperFake.tv.account!.plan = plan), plan),
  };

  const goHome = async () => {
    if (await window.locator('#nav-home').isVisible()) await window.locator('#nav-home').click();
    await window.locator('#go-backup').waitFor();
  };

  const backUp = async () => {
    await goHome();
    await window.locator('#go-backup').click();
    await window.locator('.result-success, .result-error').first().waitFor({ timeout: 90_000 });
  };

  /** Restore screen, step 1, with the newest backup picked (not a safety copy, not an incomplete one). */
  const toRestoreNewestBackup = async () => {
    await goHome();
    await window.locator('#go-restore').click();
    await window.locator('fieldset.choices').first().locator('label.choice').filter({ hasNot: window.locator('.badge') }).first().click();
  };

  /** Restore screen, step 2, for one layout of the newest backup. */
  const toHowStep = async (layout: string) => {
    await toRestoreNewestBackup();
    await window.locator('label.choice', { hasText: layout }).click();
    await window.locator('#restore-next').click();
    await window.locator('#restore-start').waitFor({ timeout: 30_000 });
  };

  /** Waits for the restore to end and returns the result's class: result-success, result-warning or result-error. */
  const restoreResult = async () => {
    const result = window.locator('section.result');
    await result.waitFor({ timeout: 120_000 });
    return result.getAttribute('class');
  };

  const verifyTable = () =>
    window.locator('table.verify tbody tr').evaluateAll((rows) => rows.map((tr) => [...tr.children].map((c) => ({ text: c.textContent ?? '', cls: c.className }))));

  beforeAll(async () => {
    ({ app, window, backups } = await launchApp({}, undefined, seed));
    window.on('pageerror', (e) => errors.push(String(e)));
    window.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await window.locator('#go-backup').waitFor();
  });
  afterAll(async () => app?.close());

  it('signs in through the Sign in button and the TradingView sign-in window', async () => {
    await expect(window.locator('#go-backup').isDisabled()).resolves.toBe(true);
    await window.locator('#signin').click();
    const signInWindow = await windowAt(app, /\/accounts\/signin\/$/);
    await signInWindow.locator('#fake-signin').click();
    await window.getByText('Signed in to TradingView as demo_user').waitFor({ timeout: 30_000 });
    await expect(window.locator('#go-backup').isEnabled()).resolves.toBe(true);
    await expect(window.locator('#go-restore').isEnabled()).resolves.toBe(true);
    const cookies = await app.evaluate(async ({ session }) => (await session.fromPartition('persist:tradingview').cookies.get({ name: 'sessionid' })).map((c) => c.domain));
    expect(cookies).toEqual(['.tradingview.com']);
    await expect.poll(() => signInWindow.isClosed(), { timeout: 10_000 }).toBe(true);
    await shot(window, '01-signed-in');
  });

  it('backs up every layout with progress, and only reads from TradingView', async () => {
    await fake.clearRequests();
    await window.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { progressSeen: string[] }).progressSeen = seen;
      new MutationObserver(() => {
        for (const p of document.querySelectorAll('[role=progressbar]')) seen.push(`${p.getAttribute('aria-valuenow') ?? '-'} ${p.getAttribute('aria-label')}`);
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await backUp();
    const requests = await fake.requests();
    expect(requests.length).toBeGreaterThan(10);
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
    await expect(window.locator('.result-success .result-title').textContent()).resolves.toBe('Backup complete');
    await expect(window.locator('.result-success .result-lead').textContent()).resolves.toBe('2 layouts and 11 drawings are saved on this computer.');
    const progress = await window.evaluate(() => (window as unknown as { progressSeen: string[] }).progressSeen);
    expect(progress.some((p) => /^\d+ Saving the layout “Min AAPL”…$/.test(p))).toBe(true);
    expect(progress.some((p) => /^\d+ Saving prices for “Scratch pad”/.test(p))).toBe(true);
    await shot(window, '02-backup-done');

    const [snap, ...others] = await snapshotsOnDisk(backups);
    expect(others).toEqual([]);
    expect(snap!.name).toMatch(/^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d$/);
    expect(snap!.manifest).toMatchObject({ status: 'complete', account: { username: 'demo_user', plan: 'pro_premium' }, extras: { studyTemplates: 1, drawingTemplates: 1, themes: 1, scripts: 1 } });
    expect(snap!.manifest.layouts.map((l) => [l.name, l.drawings, l.studies, l.priceData])).toEqual([['Min AAPL', 11, 2, true], ['Scratch pad', 0, 2, true]]);
    const drawings = JSON.parse(await fs.readFile(path.join(snap!.dir, 'layouts/AbCd1234/drawings.json'), 'utf8'));
    expect(Object.keys(drawings.buckets['1'].sources).length + Object.keys(drawings.buckets._shared.sources).length).toBe(storedIds(minAapl()).length);
    const prices = JSON.parse(await fs.readFile(path.join(snap!.dir, 'layouts/AbCd1234/data/chart-1.json'), 'utf8'));
    expect(prices.bars.length).toBe(300);
  });

  it('shows the new backup as a chart', async () => {
    await window.locator('#backup-view').click();
    await window.locator('.layout-card.layout-selected', { hasText: 'Min AAPL' }).waitFor();
    await expect.poll(() => window.locator('.chart-box canvas').count(), { timeout: 30_000 }).toBeGreaterThan(2);
    await expect(window.locator('.snap-incomplete').count()).resolves.toBe(0);
    await shot(window, '03-view');
  });

  it('shows the chart full screen and leaves it with Escape', async () => {
    const covers = () => window.evaluate(() => {
      const r = document.querySelector('.chart-stage')?.getBoundingClientRect();
      return r !== undefined && r.x === 0 && r.y === 0 && r.width === innerWidth && r.height === innerHeight;
    });
    const windowFull = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFullScreen()));
    // Without a window manager (xvfb), Linux never reports the window full screen.
    const wm = process.platform !== 'linux';
    await window.locator('#chart-full').click();
    await expect.poll(covers).toBe(true);
    if (wm) await expect.poll(windowFull, { timeout: 10_000 }).toBe(true);
    await window.keyboard.press('Escape');
    const state = async () => `stage full: ${await window.evaluate(() => document.querySelector('.is-full') !== null)}, window full: ${await windowFull()}`;
    await expect.poll(state, { timeout: 10_000 }).toBe('stage full: false, window full: false');
    await expect(covers()).resolves.toBe(false);
  });

  it('compares two backups and shows the drawing added between them', async () => {
    await app.evaluate((_e) => {
      const l = (globalThis as unknown as G).__chartkeeperFake.tv.layouts.get('AbCd1234')!;
      const [first] = Object.values(l.storage['1']!);
      const copy = structuredClone(first!) as { id: string; state: { id: string; points: { price: number }[] } };
      copy.id = copy.state.id = 'e2eAdded1';
      for (const p of copy.state.points) p.price = 123.456;
      l.storage['1']!.e2eAdded1 = copy;
    });
    await backUp();
    await expect(window.locator('.result-success .result-lead').textContent()).resolves.toBe('2 layouts and 12 drawings are saved on this computer.');
    const [older] = await snapshotsOnDisk(backups);
    await window.locator('#backup-view').click();
    await window.locator('#compare-pick').selectOption(older!.dir);
    await window.locator('#compare-go').click();
    const diff = window.locator('.diff', { hasText: 'Min AAPL' });
    await diff.waitFor();
    await expect(diff.locator('.change').count()).resolves.toBe(1);
    await expect(diff.locator('.change.mark-added .change-detail').textContent()).resolves.toContain('@ 123.456');
    await expect(window.getByText('Unchanged: Scratch pad').isVisible()).resolves.toBe(true);
    await shot(window, '04-compare');
  });

  it('restores a layout as a new layout, and TradingView shows all of it', async () => {
    await fake.clearRequests();
    await toHowStep('Min AAPL');
    await expect(window.locator('#mode-replace, #target-pick, input[name=mode], main select, main input[type=text]').count(), 'the restore screen offers a way to overwrite a layout').resolves.toBe(0);
    await expect(window.locator('main').textContent()).resolves.toContain('Nothing on TradingView is changed or deleted.');
    await expect(window.locator('#restore-start').isEnabled()).resolves.toBe(true);
    await window.locator('#restore-start').click();
    await expect(restoreResult()).resolves.toBe('result result-success');
    const created = (await fake.layouts()).filter((l) => l.name.startsWith('Min AAPL (restored '));
    expect(created.map((l) => l.name)).toEqual([expect.stringMatching(/^Min AAPL \(restored \d{4}-\d\d-\d\d\)$/)]);
    await expect(window.locator('.result-title').textContent()).resolves.toBe(`Your layout “${created[0]!.name}” is back on TradingView`);
    const rows = await verifyTable();
    expect(rows.map((r) => r.map((c) => c.text))).toEqual([
      ['Charts', '1', '1', ''],
      ['Drawings', '12', '12', '12'],
      ['Indicators', '2', '2', '2'],
    ]);
    expect(rows.flat().filter((c) => c.cls === 'cell-warn')).toEqual([]);
    await shot(window, '05-restore-new');

    expect(drawingIdsInContent(created[0]!)).toEqual([...storedIds(minAapl()), ...drawingIdsInContent(minAapl()), 'e2eAdded1'].sort());
    const saves = (await fake.requests()).filter((r) => r.method === 'POST');
    expect(saves.map((r) => [new URL(r.url).pathname, r.form?.image_url ?? null])).toEqual([['/api/v1/charts/save/', null]]);
    const opened = await app.evaluate((_e, uid) => (globalThis as unknown as G).__chartkeeperFake.urls.filter((u) => u === `GET https://www.tradingview.com/chart/${uid}/`), created[0]!.uid);
    expect(opened).toHaveLength(1);
  });

  it('explains that the plan has no free slot and keeps Restore disabled', async () => {
    await fake.setPlan('free');
    await fake.clearRequests();
    try {
      await toHowStep('Min AAPL');
      const full = window.locator('.notice', { hasText: 'There is no room for a new layout' });
      await full.waitFor();
      await expect(full.textContent()).resolves.toContain('Your TradingView plan (free) allows 1 saved layouts, and they are all in use.');
      await expect(window.locator('#restore-start').isDisabled()).resolves.toBe(true);
      await shot(window, '06-restore-no-slot');
      expect((await fake.requests()).filter((r) => r.method !== 'GET')).toEqual([]);
    } finally {
      await fake.setPlan('pro_premium');
    }
  });

  it('adds the templates and themes the account is missing and leaves the others alone', async () => {
    await app.evaluate(() => {
      const tv = (globalThis as unknown as G).__chartkeeperFake.tv;
      tv.drawingTemplates = {};
      tv.themes = {};
    });
    await toRestoreNewestBackup();
    await window.locator('#restore-templates').click();
    const result = window.locator('.templates .notice');
    await result.waitFor({ timeout: 60_000 });
    const lists = await result.locator('h3.list-title').evaluateAll((hs) => hs.map((h) => [h.textContent, [...h.nextElementSibling!.querySelectorAll('li')].map((li) => li.textContent)]));
    expect(lists).toEqual([
      ['Added', [expect.stringContaining('Thick orange'), expect.stringContaining('My dark')]],
      ['Already there, left alone', [expect.stringContaining('My RSI setup')]],
    ]);
    await shot(window, '08-restore-templates');
    const tv = await app.evaluate(() => {
      const tv = (globalThis as unknown as G).__chartkeeperFake.tv;
      return { drawing: tv.drawingTemplates, themes: Object.keys(tv.themes), studies: tv.studyTemplates.map((t) => t.name) };
    });
    expect(tv).toEqual({ drawing: { LineToolTrendLine: { 'Thick orange': { linecolor: '#ff9800', linewidth: 4 } } }, themes: ['My dark'], studies: ['My RSI setup'] });
  });

  it('stops the backup and marks it INCOMPLETE in red when TradingView changes its format', async () => {
    await fake.setScenario('format-changed');
    try {
      await backUp();
    } finally {
      await fake.setScenario('normal');
    }
    const error = window.locator('.result-error');
    await expect(error.locator('.result-title').textContent()).resolves.toBe('The backup could not be completed');
    await expect(error.textContent()).resolves.toContain('TradingView has changed something');
    await expect(error.textContent()).resolves.toContain('marked as incomplete');
    await shot(window, '09-backup-format-changed');

    const incomplete = (await snapshotsOnDisk(backups)).filter((s) => s.name.endsWith('-INCOMPLETE'));
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]!.manifest.status).toBe('incomplete');
    expect(incomplete[0]!.manifest.error).toContain('does not recognise');

    await goHome();
    await expect(window.locator('#last-backup.last-backup-failed').isVisible()).resolves.toBe(true);
    await window.locator('#go-view').click();
    const badge = window.locator('.snap-incomplete .badge-error');
    await badge.waitFor();
    await expect(badge.textContent()).resolves.toBe('Incomplete');
    const [background, errorColor] = await badge.evaluate((b) => {
      const probe = document.body.appendChild(document.createElement('span'));
      probe.style.color = 'var(--err)';
      const colors = [getComputedStyle(b).backgroundColor, getComputedStyle(probe).color];
      probe.remove();
      return colors;
    });
    expect(background).toBe(errorColor);
    const [r, g, b] = background!.match(/\d+/g)!.map(Number);
    expect(r! > g! && r! > b!).toBe(true);
    await window.locator('.snap-incomplete').click();
    await window.getByText('This backup did not finish. Do not rely on it.').waitFor();
    await shot(window, '09-view-incomplete');
  });

  it('says TradingView asked to wait when it rate-limits the backup', async () => {
    await fake.setScenario('rate-limited');
    try {
      await backUp();
    } finally {
      await fake.setScenario('normal');
    }
    await expect(window.locator('.result-error').textContent()).resolves.toContain('TradingView asked ChartKeeper to wait');
    await shot(window, '10-backup-rate-limited');
  });

  it('says there is no connection when TradingView cannot be reached', async () => {
    await fake.setScenario('offline');
    try {
      await backUp();
    } finally {
      await fake.setScenario('normal');
    }
    await expect(window.locator('.result-error').textContent()).resolves.toContain('No connection to the internet');
    await shot(window, '11-backup-offline');
  });

  it('signs out and forgets the sign-in', async () => {
    await goHome();
    await window.locator('#signout').click();
    await window.getByText('Not signed in to TradingView').waitFor();
    await expect(window.locator('#go-backup').isDisabled()).resolves.toBe(true);
    await expect(window.locator('#go-restore').isDisabled()).resolves.toBe(true);
    const cookies = await app.evaluate(async ({ session }) => (await session.fromPartition('persist:tradingview').cookies.get({})).length);
    expect(cookies).toBe(0);
    await shot(window, '12-signed-out');
  });

  it('only ever asked tradingview.com, and the window logged no errors', async () => {
    const urls = await app.evaluate(() => (globalThis as unknown as G).__chartkeeperFake.urls);
    expect(urls.length).toBeGreaterThan(100);
    expect(urls.filter((u) => !isTradingViewHost(new URL(u.split(' ')[1]!).hostname))).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe('the daily backup against a fake TradingView', () => {
  let app: ElectronApplication;
  let window: Page;
  let backups: string;
  let userData: string;

  beforeAll(async () => {
    ({ app, window, backups, userData } = await launchApp({}, undefined, { layouts: [minAapl()], plan: 'pro_premium', signedIn: true, scheduleEveryMs: 1000 }));
    await window.locator('#go-backup').waitFor();
  });
  afterAll(async () => app?.close());

  it('runs a backup on its own once it is due, and only once', async () => {
    await window.getByText('Signed in to TradingView').waitFor();
    expect(await snapshotsOnDisk(backups)).toEqual([]);
    await window.locator('label[for=daily]').click();
    await expect.poll(async () => (await snapshotsOnDisk(backups)).length, { timeout: 90_000 }).toBe(1);
    const [snap] = await snapshotsOnDisk(backups);
    expect(snap!.manifest).toMatchObject({ status: 'complete', layouts: [{ name: 'Min AAPL' }] });
    await window.locator('#last-backup', { hasText: '1 layout' }).waitFor();
    const stored = JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8'));
    expect(stored).toMatchObject({ settings: { dailyBackup: true }, lastBackup: { ok: true, dir: snap!.dir } });
    expect(stored.lastScheduledAttemptAt).toEqual(expect.any(String));
    await shot(window, '13-daily-backup');

    // Several more checks run; the backup is not due again until tomorrow.
    await new Promise((r) => setTimeout(r, 4000));
    expect(await snapshotsOnDisk(backups)).toHaveLength(1);
    await window.locator('label[for=daily]').click();
  });
});
