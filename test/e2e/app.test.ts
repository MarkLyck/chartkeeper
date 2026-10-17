import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ElectronApplication, Page } from 'playwright-core';
import { launchApp, ROOT } from './launch';

describe('the installed app', () => {
  let app: ElectronApplication;
  let window: Page;
  let userData: string;
  const errors: string[] = [];

  beforeAll(async () => {
    ({ app, window, userData } = await launchApp('en'));
    window.on('pageerror', (e) => errors.push(String(e)));
    window.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  });
  afterAll(async () => app?.close());

  it('opens on the home screen with the three main buttons and is not signed in', async () => {
    await window.getByRole('button', { name: /back up now/i }).waitFor();
    for (const name of [/back up now/i, /view my backups/i, /restore a chart/i]) await expect(window.getByRole('button', { name }).isVisible()).resolves.toBe(true);
    await expect(window.getByRole('button', { name: /sign in to tradingview/i }).isVisible()).resolves.toBe(true);
    const state = await window.evaluate(() => (window as any).chartkeeper.getState());
    expect(state).toMatchObject({ signedIn: false, busy: null, settings: { lang: 'en' } });
  });

  it('keeps its private folder readable only by the user (macOS and Linux)', async () => {
    if (process.platform === 'win32') return;
    expect((await fs.stat(userData)).mode & 0o777).toBe(0o700);
  });

  it('shows the backed-up layout as a chart, offline', async () => {
    await window.getByRole('button', { name: /view my backups/i }).click();
    await window.getByText('Reference AAPL').first().click();
    await window.locator('canvas').first().waitFor({ timeout: 30000 });
    await window.waitForTimeout(1500);
    const canvases = await window.locator('canvas').count();
    expect(canvases).toBeGreaterThan(2);
    await fs.mkdir(path.join(ROOT, '.test-output'), { recursive: true });
    await window.screenshot({ path: path.join(ROOT, '.test-output', `e2e-viewer-${process.platform}.png`) });
  });

  it('asks to sign in before a restore instead of failing silently', async () => {
    const r = await window.evaluate(() => (window as any).chartkeeper.restoreTargets());
    expect(r).toMatchObject({ ok: false, error: { kind: 'not-signed-in' } });
  });

  it('logged no errors in the window', () => {
    expect(errors).toEqual([]);
  });
});
