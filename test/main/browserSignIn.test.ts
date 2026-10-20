import { existsSync, promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { browserCandidates, browserForDefaultId, findBrowser, findBrowsers, parseMacDefaultBrowser, parseWindowsDefaultBrowser, SAFARI, signInProfileDir } from '../../src/main/browsers';
import { BrowserUnusable, signInWithBrowser, SignInCancelled } from '../../src/main/browserSignIn';
import { isGoogleRefusal, isSignInPopup } from '../../src/main/signIn';

const exe = chromium.executablePath();
const haveBrowser = existsSync(exe);
// CI runners can't use Chromium's sandbox (Linux: no user namespaces; Windows: the
// browser folder's permissions). A desktop install of Chrome or Edge can.
const headless = ['--headless=new', ...(process.env.CI ? ['--no-sandbox'] : [])];

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
        extraArgs: headless,
        timeoutMs: 30000,
        pollMs: 300,
      }).catch((e) => {
        throw new Error(`${e.message}\nbrowser output: ${e.browserLog ?? ''}`);
      });
      expect(cookies.map((c) => [c.name, c.value, c.httpOnly])).toEqual([['sessionid', 's3cret', true]]);
      expect(existsSync(profileDir)).toBe(false);
    } finally {
      srv.close();
    }
  }, 60000);

  it('reports a closed window as cancelled', async () => {
    const profileDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ck-signin-')), 'profile');
    const run = signInWithBrowser({ browserPath: exe, profileDir, startUrl: 'about:blank', isSignedIn: () => false, keep: () => true, extraArgs: headless, pollMs: 200, onSpawn: (child) => setTimeout(() => child.kill(), 2500) });
    await expect(run).rejects.toBeInstanceOf(SignInCancelled);
  }, 60000);
});

describe.skipIf(process.platform === 'win32')('a browser that cannot be driven', () => {
  it('gives up at once when the browser closes its DevTools pipe, so the next browser can be tried', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-deadpipe-'));
    const fake = path.join(dir, 'browser');
    await fs.writeFile(fake, '#!/bin/sh\nexec 3>&- 4>&-\nsleep 30\n', { mode: 0o755 });
    let pid = 0;
    const started = Date.now();
    const run = signInWithBrowser({ browserPath: fake, profileDir: path.join(dir, 'profile'), startUrl: 'about:blank', isSignedIn: () => false, keep: () => true, pollMs: 200, onSpawn: (c) => (pid = c.pid ?? 0) });
    await expect(run).rejects.toBeInstanceOf(BrowserUnusable);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(() => process.kill(pid, 0), 'the browser was left running').toThrow();
  }, 20000);
});

describe('finding a browser', () => {
  it('keeps the sign-in profile where a Snap or Flatpak browser can write', () => {
    const [snap] = findBrowsers('linux', { PATH: '/usr/bin' }, '/home/t', (p) => p === '/snap/bin/chromium', null);
    const [flat] = findBrowsers('linux', { PATH: '/usr/bin' }, '/home/t', (p) => p === '/var/lib/flatpak/exports/bin/org.chromium.Chromium', null);
    const [plain] = findBrowsers('linux', { PATH: '/usr/bin' }, '/home/t', (p) => p === '/usr/bin/chromium', null);
    expect(signInProfileDir(snap!, '/home/t/.config/ChartKeeper', '/home/t')).toBe('/home/t/snap/chromium/common/chartkeeper-signin');
    expect(signInProfileDir(flat!, '/home/t/.config/ChartKeeper', '/home/t')).toBe('/home/t/.var/app/org.chromium.Chromium/chartkeeper-signin');
    expect(signInProfileDir(plain!, '/home/t/.config/ChartKeeper', '/home/t')).toBe('/home/t/.config/ChartKeeper/signin-profile');
  });

  it('looks for Chrome first, then Edge, in the standard Windows folders', () => {
    const c = browserCandidates('win32', { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\T\\AppData\\Local' }, 'C:\\Users\\T');
    expect(c[0]).toEqual({ kind: 'chromium', name: 'Google Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
    expect(c.find((b) => b.name === 'Microsoft Edge')!.path).toBe('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('finds Chrome in the user Applications folder on macOS when it is the default browser', () => {
    const want = '/Users/t/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(findBrowser('darwin', {}, '/Users/t', (p) => p === want, 'com.google.chrome')).toEqual({ kind: 'chromium', name: 'Google Chrome', path: want });
  });

  it('can be told which browser to use, or to use the in-app window', () => {
    expect(findBrowser('linux', { CHARTKEEPER_BROWSER: 'none' }, '/home/t', () => true)).toBeNull();
    expect(findBrowser('linux', { CHARTKEEPER_BROWSER: '/opt/vivaldi/vivaldi' }, '/home/t', (p) => p === '/opt/vivaldi/vivaldi')).toEqual({ kind: 'chromium', name: 'vivaldi', path: '/opt/vivaldi/vivaldi' });
    expect(findBrowser('darwin', { CHARTKEEPER_BROWSER: 'safari' }, '/Users/t', () => true)).toEqual(SAFARI);
  });

  it('finds chromium on the PATH on Linux and returns null when nothing is installed', () => {
    expect(findBrowser('linux', { PATH: '/home/t/bin:/usr/bin' }, '/home/t', (p) => p === '/usr/bin/chromium', null)).toEqual({ kind: 'chromium', name: 'Chromium', path: '/usr/bin/chromium' });
    expect(findBrowser('linux', { PATH: '/usr/bin' }, '/home/t', () => false, null)).toBeNull();
  });

  it('finds Chromium however a Linux distribution installs it', () => {
    const found = (p: string, env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }) => findBrowser('linux', env, '/home/t', (x) => x === p, null);
    for (const p of [
      '/var/lib/flatpak/exports/bin/org.chromium.Chromium',
      '/home/t/.local/share/flatpak/exports/bin/org.chromium.Chromium',
      '/var/lib/snapd/snap/bin/chromium',
      '/usr/bin/chromium-freeworld',
      '/usr/bin/ungoogled-chromium',
      '/usr/lib/chromium/chromium',
      '/usr/lib64/chromium-browser/chromium-browser',
      '/home/t/.nix-profile/bin/chromium',
      '/run/current-system/sw/bin/chromium',
    ])
      expect(found(p), p).toEqual({ kind: 'chromium', name: 'Chromium', path: p });
    expect(found('/var/lib/flatpak/exports/bin/com.google.Chrome')?.name).toBe('Google Chrome');
    expect(found('/var/lib/flatpak/exports/bin/com.brave.Browser')?.name).toBe('Brave');
  });

  it('knows Flatpak and Snap browsers as the Linux default browser', () => {
    const lin = new Set(['/usr/bin/google-chrome', '/var/lib/flatpak/exports/bin/org.chromium.Chromium', '/snap/bin/chromium']);
    const first = (id: string) => findBrowsers('linux', { PATH: '/usr/bin' }, '/home/t', (p) => lin.has(p), id)[0]?.name;
    expect(first('org.chromium.Chromium.desktop')).toBe('Chromium');
    expect(first('chromium_chromium.desktop')).toBe('Chromium');
  });

  it('never signs in with Dia or Arc, which open a fresh profile on their own account sign-up', () => {
    const installed = new Set(['/Applications/Dia.app/Contents/MacOS/Dia', '/Applications/Arc.app/Contents/MacOS/Arc']);
    expect(findBrowsers('darwin', {}, '/Users/t', (p) => installed.has(p), 'company.thebrowser.dia')).toEqual([SAFARI]);
    expect(findBrowsers('darwin', {}, '/Users/t', (p) => installed.has(p), 'company.thebrowser.browser')).toEqual([SAFARI]);
  });

  it('on a Mac, uses the default browser when it is Chromium-based, and Safari otherwise', () => {
    const installed = new Set(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Dia.app/Contents/MacOS/Dia', '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi']);
    const names = (id: string | null) => findBrowsers('darwin', {}, '/Users/t', (p) => installed.has(p), id).map((b) => b.name);
    expect(names('com.vivaldi.vivaldi')).toEqual(['Vivaldi', 'Safari']);
    expect(names('company.thebrowser.dia')).toEqual(['Safari']);
    expect(names('com.apple.safari')).toEqual(['Safari']);
    expect(names('org.mozilla.firefox')).toEqual(['Safari']);
    expect(names(null)).toEqual(['Safari']);
  });

  it('prefers the default browser on Windows and Linux too', () => {
    const env = { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\T\\AppData\\Local' };
    const win = new Set(['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']);
    expect(findBrowsers('win32', env, 'C:\\Users\\T', (p) => win.has(p), 'MSEdgeHTM').map((b) => b.name)).toEqual(['Microsoft Edge', 'Google Chrome']);
    const lin = new Set(['/usr/bin/google-chrome', '/usr/bin/brave-browser']);
    expect(findBrowsers('linux', { PATH: '/usr/bin' }, '/home/t', (p) => lin.has(p), 'brave-browser.desktop').map((b) => b.name)).toEqual(['Brave', 'Google Chrome']);
  });

  it('reads the default browser from the macOS and Windows settings formats', () => {
    const mac = `(
    {
        LSHandlerContentType = "public.html";
        LSHandlerRoleAll = "com.apple.safari";
    },
    {
        LSHandlerPreferredVersions =         {
            LSHandlerRoleAll = "-";
        };
        LSHandlerRoleAll = "company.thebrowser.dia";
        LSHandlerURLScheme = https;
    },
    {
        LSHandlerRoleAll = "com.google.chrome";
        LSHandlerURLScheme = http;
    }
)`;
    expect(parseMacDefaultBrowser(mac)).toBe('company.thebrowser.dia');
    expect(parseMacDefaultBrowser('()')).toBeNull();
    const reg = `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice\r\n    ProgId    REG_SZ    BraveHTML\r\n`;
    expect(parseWindowsDefaultBrowser(reg)).toBe('BraveHTML');
    expect(browserForDefaultId('win32', 'BraveHTML')).toBe('Brave');
    expect(browserForDefaultId('darwin', 'com.apple.safari')).toBeNull();
    expect(browserForDefaultId('darwin', 'company.thebrowser.dia')).toBeNull();
  });
});

describe('the built-in sign-in window', () => {
  it('lets sign-in provider popups open, and nothing else', () => {
    expect(isSignInPopup('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')).toBe(true);
    expect(isSignInPopup('https://appleid.apple.com/auth/authorize')).toBe(true);
    expect(isSignInPopup('https://www.tradingview.com/accounts/signin/')).toBe(true);
    expect(isSignInPopup('http://accounts.google.com/')).toBe(false);
    expect(isSignInPopup('https://google.com.evil.example/')).toBe(false);
    expect(isSignInPopup('https://ads.example.com/')).toBe(false);
  });

  it('recognises the page Google shows when it refuses sign-in in an app window', () => {
    expect(isGoogleRefusal('https://accounts.google.com/v3/signin/rejected?continue=x')).toBe(true);
    expect(isGoogleRefusal('https://accounts.google.com/v3/signin/identifier')).toBe(false);
  });
});
