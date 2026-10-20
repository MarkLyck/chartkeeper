import { app, type Session } from 'electron';
import path from 'node:path';
import type { SocketFactory } from '../core/tv/datafeed';
import type { RateLimitOptions } from '../core/tv/http';
import { log } from './log';
import type { ScheduleTiming } from './schedule';
import type { SafariSeam } from './signIn';

export const FAKE_TRADINGVIEW_ENV = 'CHARTKEEPER_FAKE_TRADINGVIEW';

/**
 * The parts of the app the end-to-end tests swap for an in-process fake
 * TradingView. Everything else, including the hidden tradingview.com page,
 * the request policy and the chart-page check, runs as shipped.
 */
export interface FakeTradingView {
  /** Answers every https request of ChartKeeper's session and of the sign-in window's session from the fake. */
  intercept(sessions: { tradingView: Session; signIn: Session }): Promise<void>;
  socketFactory: SocketFactory;
  rate: RateLimitOptions;
  schedule: ScheduleTiming;
  /** A fake Safari, for tests that sign in with Safari. */
  safari?: SafariSeam;
}

/** A packaged app never runs against the fake, whatever the environment says. */
export const fakeModeAllowed = (isPackaged: boolean, env: NodeJS.ProcessEnv): boolean => !isPackaged && env[FAKE_TRADINGVIEW_ENV] === '1';

/** The fake is built only by `npm run test:e2e`, into dist-test/, which the installer does not include. */
export function loadFakeTradingView(): FakeTradingView | null {
  if (!fakeModeAllowed(app.isPackaged, process.env)) return null;
  log('FAKE TRADINGVIEW: answering tradingview.com from the end-to-end test fake');
  const mod = require(path.join(__dirname, '..', 'dist-test', 'fake-tradingview.js')) as { createFakeTradingView(): FakeTradingView };
  return mod.createFakeTradingView();
}
