import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignInCancelled } from '../../src/main/browserSignIn';
import { findCookieFiles, parseBinaryCookies, SafariAccessDenied, safariTradingViewSignIns, signInWithSafari, type SafariCookie } from '../../src/main/safariSignIn';
import { tvCookie, writeBinaryCookies } from '../fakes/binaryCookies';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-safari-'));
});
afterEach(async () => {
  await fs.chmod(dir, 0o700).catch(() => undefined);
  await fs.rm(dir, { recursive: true, force: true });
});

const put = async (rel: string, pages: SafariCookie[][]) => {
  const file = path.join(dir, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, writeBinaryCookies(pages));
  return file;
};

describe("reading Safari's cookie file", () => {
  it('reads a file WebKit itself wrote, with HttpOnly and expiry', () => {
    // Written by a WKWebView on macOS 27 after a page answered with these two Set-Cookie headers (Max-Age=3600).
    const cookies = parseBinaryCookies(readFileSync(path.join(__dirname, '../fixtures/webkit-written.binarycookies')));
    expect(cookies.map((c) => [c.domain, c.name, c.value, c.path, c.httpOnly, c.secure])).toEqual([
      ['127.0.0.1', 'sessionid', 'probe123', '/', true, false],
      ['127.0.0.1', 'other', '1', '/', false, false],
    ]);
    expect(new Date(cookies[0]!.expires * 1000).toISOString()).toMatch(/^2026-10-20T0/);
  });

  it('reads every page', () => {
    const pages = [[tvCookie('sessionid', 'abc'), tvCookie('csrftoken', 'x')], [tvCookie('a', '1', { domain: 'example.com', secure: false })]];
    const back = parseBinaryCookies(writeBinaryCookies(pages));
    expect(back).toEqual(pages.flat().map((c) => ({ ...c, expires: expect.closeTo(c.expires, 3) })));
  });

  it('refuses a file that is not a cookie file', () => {
    expect(() => parseBinaryCookies(Buffer.from('nope'))).toThrow(/Not a Safari cookie file/);
  });

  it("finds the default profile's and other profiles' files, newest first, and skips caches", async () => {
    const older = await put('Cookies/Cookies.binarycookies', [[]]);
    await fs.utimes(older, new Date(2026, 0, 1), new Date(2026, 0, 1));
    const newer = await put('WebKit/WebsiteDataStore/5F1C/Cookies/Cookies.binarycookies', [[]]);
    await put('Caches/WebKit/stray.binarycookies', [[]]);
    expect(await findCookieFiles(dir)).toEqual([newer, older]);
  });

  it('keeps only TradingView cookies, from files that hold a TradingView sign-in', async () => {
    await put('Cookies/Cookies.binarycookies', [[tvCookie('sessionid', 's1'), tvCookie('sessionid', 'evil', { domain: '.tradingview.com.evil.example' }), tvCookie('_ga', 'g', { domain: '.google.com' })]]);
    await put('Profile2/Cookies.binarycookies', [[tvCookie('csrftoken', 'only')]]);
    const signIns = await safariTradingViewSignIns(dir);
    expect(signIns.map((cs) => cs.map((c) => `${c.domain} ${c.name}=${c.value}`))).toEqual([['.tradingview.com sessionid=s1']]);
  });

  // Windows ignores chmod for folders; Safari only runs on macOS anyway.
  it.skipIf(process.platform === 'win32')('says so when macOS keeps ChartKeeper out of Safari', async () => {
    await fs.chmod(dir, 0o000);
    await expect(safariTradingViewSignIns(dir)).rejects.toBeInstanceOf(SafariAccessDenied);
  });

  it('treats a Mac where Safari never ran as signed out', async () => {
    await expect(safariTradingViewSignIns(path.join(dir, 'no-such-safari'))).resolves.toEqual([]);
  });
});

describe('signing in with Safari', () => {
  it("uses the sign-in Safari already has, without opening Safari", async () => {
    await put('Cookies/Cookies.binarycookies', [[tvCookie('sessionid', 'live')]]);
    const opened: string[] = [];
    const accepted: string[] = [];
    await signInWithSafari({ dataDir: dir, startUrl: 'https://www.tradingview.com/accounts/signin/', open: async (u) => void opened.push(u), accept: async (cs) => (accepted.push(cs[0]!.value), true) });
    expect(accepted).toEqual(['live']);
    expect(opened).toEqual([]);
  });

  it('opens the sign-in page when the saved sign-in has ended, and takes the new one once Safari saves it', async () => {
    const file = await put('Cookies/Cookies.binarycookies', [[tvCookie('sessionid', 'expired')]]);
    const tried: string[] = [];
    const opened: string[] = [];
    await signInWithSafari({
      dataDir: dir,
      startUrl: 'https://www.tradingview.com/accounts/signin/',
      pollMs: 20,
      accept: async (cs) => (tried.push(cs.find((c) => c.name === 'sessionid')!.value), tried.at(-1) === 'fresh'),
      open: async (u) => {
        opened.push(u);
        // Safari saves cookies while it runs; mimic a half-written file first.
        setTimeout(() => void fs.writeFile(file, writeBinaryCookies([[tvCookie('sessionid', 'fresh')]]).subarray(0, 30)), 30);
        setTimeout(() => void fs.writeFile(file, writeBinaryCookies([[tvCookie('sessionid', 'fresh'), tvCookie('csrftoken', 't')]])), 120);
      },
    });
    expect(opened).toEqual(['https://www.tradingview.com/accounts/signin/']);
    expect(tried).toEqual(['expired', 'fresh']);
  });

  it('stops waiting when cancelled', async () => {
    const controller = new AbortController();
    const run = signInWithSafari({ dataDir: dir, startUrl: 'x', pollMs: 20, accept: async () => true, open: async () => void setTimeout(() => controller.abort(), 50), signal: controller.signal });
    await expect(run).rejects.toBeInstanceOf(SignInCancelled);
  });

  it('gives up after the time limit', async () => {
    await expect(signInWithSafari({ dataDir: dir, startUrl: 'x', pollMs: 10, timeoutMs: 50, accept: async () => true, open: async () => undefined })).rejects.toThrow(/took too long/);
  });
});
