import { existsSync, promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { browserCandidates, findBrowser } from '../../src/main/browsers';
import { signInWithBrowser, SignInCancelled } from '../../src/main/browserSignIn';

const exe = chromium.executablePath();
const haveBrowser = existsSync(exe);

/** A page that "signs in" two seconds after it loads by setting a sessionid cookie. */
function fakeSignInServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/done') {
      res.setHeader('Set-Cookie', ['sessionid=s3cret; Path=/; Max-Age=3600; HttpOnly', 'other=1; Path=/']);
      return res.end('signed in');
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<script>setTimeout(() => fetch("/done"), 2000)</script>sign in here');
  });
  return new Promise<{ url: string; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, close: () => server.close() })),
  );
}

describe.skipIf(!haveBrowser)('signing in through a real browser window', () => {
  it('waits for the sign-in cookie, returns only the wanted cookies, then closes the browser and deletes its profile', async () => {
    const srv = await fakeSignInServer();
    const profileDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ck-signin-')), 'profile');
    try {
      const cookies = await signInWithBrowser({
        browserPath: exe,
        profileDir,
        startUrl: srv.url,
        isSignedIn: (c) => c.some((x) => x.name === 'sessionid'),
        keep: (c) => c.name === 'sessionid',
        extraArgs: ['--headless=new'],
        timeoutMs: 30000,
        pollMs: 300,
      });
      expect(cookies.map((c) => [c.name, c.value, c.httpOnly])).toEqual([['sessionid', 's3cret', true]]);
      expect(existsSync(profileDir)).toBe(false);
    } finally {
      srv.close();
    }
  }, 60000);

  it('reports a closed window as cancelled', async () => {
    const profileDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ck-signin-')), 'profile');
    const run = signInWithBrowser({ browserPath: exe, profileDir, startUrl: 'about:blank', isSignedIn: () => false, keep: () => true, extraArgs: ['--headless=new'], pollMs: 200 });
    setTimeout(() => void import('node:child_process').then(({ execSync }) => execSync(process.platform === 'win32' ? `taskkill /F /FI "COMMANDLINE eq *${path.basename(path.dirname(profileDir))}*"` : `pkill -f ${path.basename(path.dirname(profileDir))} || true`)), 2500);
    await expect(run).rejects.toBeInstanceOf(SignInCancelled);
  }, 60000);
});

describe('finding a browser', () => {
  it('looks for Chrome first, then Edge, in the standard Windows folders', () => {
    const c = browserCandidates('win32', { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\T\\AppData\\Local' }, 'C:\\Users\\T');
    expect(c[0]).toEqual({ name: 'Google Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
    expect(c.find((b) => b.name === 'Microsoft Edge')!.path).toBe('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('finds Chrome in the user Applications folder on macOS', () => {
    const want = '/Users/t/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(findBrowser('darwin', {}, '/Users/t', (p) => p === want)).toEqual({ name: 'Google Chrome', path: want });
  });

  it('finds chromium on the PATH on Linux and returns null when nothing is installed', () => {
    expect(findBrowser('linux', { PATH: '/home/t/bin:/usr/bin' }, '/home/t', (p) => p === '/usr/bin/chromium')).toEqual({ name: 'Chromium', path: '/usr/bin/chromium' });
    expect(findBrowser('linux', { PATH: '/usr/bin' }, '/home/t', () => false)).toBeNull();
  });
});
