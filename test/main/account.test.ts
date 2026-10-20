import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageUser } from '../../src/core/tv/http';
import { TvAccount } from '../../src/main/account';

/** The browser side: the sign-in cookie, and the user the tradingview.com page shows when it loads. */
const browser = vi.hoisted(() => ({ cookie: true, user: null as PageUser | null, unreachable: false, signedOut: false }));

vi.mock('../../src/main/tvSession', () => ({
  /** Like the hidden page: it reads window.user when it loads and keeps it until reset. */
  ElectronPageTransport: class {
    private loaded: PageUser | null | undefined;
    reset() {
      this.loaded = undefined;
    }
    async user() {
      if (browser.unreachable) throw new Error('ERR_NAME_NOT_RESOLVED');
      if (this.loaded === undefined) this.loaded = browser.user;
      return this.loaded;
    }
    async send() {
      return { status: 200, contentType: 'application/json', body: '[]' };
    }
  },
  hasSessionCookie: async () => browser.cookie,
  signOut: async () => {
    browser.cookie = false;
    browser.signedOut = true;
  },
}));

const trader: PageUser = { id: 7, username: 'trader', authToken: 'tok', plan: 'pro_plus' };

beforeEach(() => Object.assign(browser, { cookie: true, user: trader, unreachable: false, signedOut: false }));

describe('the signed-in TradingView account', () => {
  it('makes a client for the user the page shows, and remembers the name', async () => {
    const account = new TvAccount();
    expect(account.username).toBeNull();
    const c = await account.client();
    expect([c.username, c.plan, c.authToken]).toEqual(['trader', 'pro_plus', 'tok']);
    expect(account.username).toBe('trader');
    expect(await c.listLayouts()).toEqual([]);
  });

  it('asks to sign in when there is no sign-in cookie', async () => {
    browser.cookie = false;
    const account = new TvAccount();
    await expect(account.client()).rejects.toMatchObject({ kind: 'not-signed-in' });
    expect(account.username).toBeNull();
  });

  it('asks to sign in again when TradingView no longer recognises the cookie', async () => {
    browser.user = null;
    await expect(new TvAccount().client()).rejects.toMatchObject({ kind: 'not-signed-in', message: expect.stringMatching(/does not recognise/) });
  });

  it('calls an unreachable page a connection problem, not a sign-in problem', async () => {
    browser.unreachable = true;
    await expect(new TvAccount().client()).rejects.toMatchObject({ kind: 'network', detail: expect.stringContaining('ERR_NAME_NOT_RESOLVED') });
  });

  it('picks up a sign-in to another account on the next client, so the tray app never backs up the wrong account', async () => {
    const account = new TvAccount();
    await account.client();
    browser.user = { ...trader, id: 8, username: 'other' };
    expect((await account.client()).username).toBe('other');
    expect(account.username).toBe('other');
  });

  it('forgets the name and the page on sign-out', async () => {
    const account = new TvAccount();
    await account.client();
    await account.signOut();
    expect(browser.signedOut).toBe(true);
    expect(account.username).toBeNull();
    await expect(account.client()).rejects.toMatchObject({ kind: 'not-signed-in' });
  });
});
