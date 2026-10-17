import { describe, expect, it } from 'vitest';
import { isTradingViewHost } from '../../src/core/tv/endpoints';
import { isRequestAllowed } from '../../src/main/tvSession';

describe('ChartKeeper only talks to TradingView', () => {
  it.each([
    'https://www.tradingview.com/my-charts/',
    'https://static.tradingview.com/static/bundles/app.js',
    'https://charts-storage.tradingview.com/charts-storage/get/layout/x/sources',
    'wss://data.tradingview.com/socket.io/websocket',
    'https://pine-facade.tradingview.com/pine-facade/list',
  ])('allows %s', (url) => expect(isRequestAllowed(url)).toBe(true));

  it.each([
    'https://www.google-analytics.com/collect',
    'https://www.recaptcha.net/recaptcha/api2/anchor',
    'https://tradingview.com.evil.example/steal',
    'https://eviltradingview.com/steal',
    'http://www.tradingview.com/insecure',
    'https://telemetry.tradingview.com/report',
    'https://snowplow-pixel.tradingview.com/i',
    'file:///etc/passwd',
    'not a url',
  ])('blocks %s', (url) => expect(isRequestAllowed(url)).toBe(false));

  it('treats only tradingview.com and its subdomains as TradingView, also as cookie domains', () => {
    expect(['tradingview.com', '.tradingview.com', 'www.tradingview.com', 'charts-storage.tradingview.com'].map(isTradingViewHost)).toEqual([true, true, true, true]);
    expect(['eviltradingview.com', '.eviltradingview.com', 'tradingview.com.evil.example', ''].map(isTradingViewHost)).toEqual([false, false, false, false]);
  });
});

describe('opening folders from the window', () => {
  it('only opens folders inside the backup folder', async () => {
    const { isInside } = await import('../../src/main/ipc');
    expect(isInside('/Users/t/Backups', '/Users/t/Backups/snapshots/2026-10-17_10-00-00')).toBe(true);
    expect(isInside('/Users/t/Backups', '/Users/t/Backups')).toBe(true);
    expect(isInside('/Users/t/Backups', '/Users/t/Backups/../Evil.app')).toBe(false);
    expect(isInside('/Users/t/Backups', '/Applications/Calculator.app')).toBe(false);
  });
});
