import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ElectronApplication, Page } from 'playwright-core';
import { UPDATE_FEED_ENV } from '../../src/main/update';
import { launchApp } from './launch';

/** What a release's latest*.yml says, for a version far ahead of any real one. Nothing here is ever downloaded. */
const FEED = `version: 99.0.0
files:
  - url: ChartKeeper-99.0.0-mac-universal.dmg
    sha512: 2dkVfQ1xMOWlP0QW1lq9xD6Yb1nL2E0yO5S2W3uMmV1lYpQp0Xz2G4vO6rN8b3qC1a5e7f9h0j2k4m6o8q0s2u==
    size: 1000
path: ChartKeeper-99.0.0-mac-universal.dmg
sha512: 2dkVfQ1xMOWlP0QW1lq9xD6Yb1nL2E0yO5S2W3uMmV1lYpQp0Xz2G4vO6rN8b3qC1a5e7f9h0j2k4m6o8q0s2u==
releaseDate: '2026-10-20T00:00:00.000Z'
releaseNotes: '<p>Faster backups &amp; a popup for new versions</p>'
`;

describe('a new version on the update feed', () => {
  let server: http.Server;
  let app: ElectronApplication;
  let window: Page;
  const requested: string[] = [];
  const errors: string[] = [];
  const dialogOpen = () => window.$eval('#update-dialog', (d) => (d as HTMLDialogElement).open);
  const update = () => window.evaluate(() => (window as any).chartkeeper.getState().then((s: { update: unknown }) => s.update));

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requested.push(req.url ?? '');
      if (!/^\/latest(-mac|-linux)?\.yml$/.test(req.url ?? '')) return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'text/yaml' }).end(FEED);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const feed = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    ({ app, window } = await launchApp({ env: { [UPDATE_FEED_ENV]: feed } }));
    window.on('pageerror', (e) => errors.push(String(e)));
    window.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  });
  afterAll(async () => {
    await app?.close();
    await new Promise((r) => server?.close(r));
  });

  it('shows the popup with the new version and its notes soon after the app opens', async () => {
    await window.locator('#update-dialog[open]').waitFor({ timeout: 30_000 });
    expect(await window.textContent('#update-version')).toContain('99.0.0');
    expect(await window.textContent('#update-notes')).toBe('Faster backups & a popup for new versions');
    expect(await update()).toMatchObject({ k: 'available', version: '99.0.0', how: process.platform === 'darwin' ? 'installer' : 'restart' });
    const file = process.platform === 'darwin' ? '/latest-mac.yml' : process.platform === 'linux' ? '/latest-linux.yml' : '/latest.yml';
    expect(requested).toContain(file);
  });

  it('hides it with Later and offers it again in the top bar', async () => {
    await window.locator('#update-later').click();
    await window.locator('#update-reopen').waitFor();
    expect(await dialogOpen()).toBe(false);
    expect(await update()).toMatchObject({ k: 'later', version: '99.0.0' });
  });

  it('opens it again from the top bar, and Escape is Later', async () => {
    await window.locator('#update-reopen').click();
    await window.locator('#update-dialog[open]').waitFor();
    expect(await window.textContent('#update-version')).toContain('99.0.0');
    await window.keyboard.press('Escape');
    await window.locator('#update-reopen').waitFor();
    expect(await dialogOpen()).toBe(false);
  });

  it('downloaded nothing and logged no errors in the window', () => {
    expect(requested.filter((u) => !u.endsWith('.yml'))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
