import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ app: { isPackaged: true } }));
vi.mock('electron', () => electron);
vi.mock('../../src/main/log', () => ({ log: () => undefined }));

const { FAKE_TRADINGVIEW_ENV, fakeModeAllowed, loadFakeTradingView } = await import('../../src/main/fakeTradingView');

describe('the fake TradingView switch', () => {
  afterEach(() => {
    delete process.env[FAKE_TRADINGVIEW_ENV];
    electron.app.isPackaged = true;
  });

  it('is honoured only by an unpackaged app with the variable set to 1', () => {
    expect(fakeModeAllowed(false, { [FAKE_TRADINGVIEW_ENV]: '1' })).toBe(true);
    expect(fakeModeAllowed(true, { [FAKE_TRADINGVIEW_ENV]: '1' })).toBe(false);
    expect(fakeModeAllowed(false, {})).toBe(false);
    expect(fakeModeAllowed(false, { [FAKE_TRADINGVIEW_ENV]: 'true' })).toBe(false);
  });

  it('loads nothing in a packaged app, even with the variable set', () => {
    process.env[FAKE_TRADINGVIEW_ENV] = '1';
    expect(loadFakeTradingView()).toBeNull();
  });

  it('looks for the fake only in dist-test/ of an unpackaged app', () => {
    process.env[FAKE_TRADINGVIEW_ENV] = '1';
    electron.app.isPackaged = false;
    expect(() => loadFakeTradingView()).toThrow(/dist-test[\\/]fake-tradingview\.js/);
  });
});
