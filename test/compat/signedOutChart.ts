import { chromium, type Browser, type Page } from 'playwright-core';
import type { TvContent } from '../../src/core/tv/content';

/** What TradingView's own serializer (`getSaveChartService().saveToJSON()`) returns, parsed. */
export interface TradingViewSaved {
  content: TvContent;
  studyMetaInfoMap: Record<string, Record<string, unknown>>;
}

/** TradingView's loader rejected the layout. Never retried: this is the failure the compat test exists to find. */
export class LoadRejected extends Error {}

/** The chart page at a symbol and interval, as opening a saved layout starts on that layout's own symbol. */
const chartUrl = (at: ChartAt) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(at.symbol)}&interval=${encodeURIComponent(at.interval)}`;

export interface ChartAt {
  symbol: string;
  interval: string;
}

export const launchChromium = (): Promise<Browser> => chromium.launch({ executablePath: chromium.executablePath() });

/**
 * A signed-out tradingview.com chart page, used through the web app's own
 * loader and serializer. Needs no account, so it runs in CI.
 */
export class SignedOutChart {
  private constructor(private readonly page: Page) {}

  /**
   * Opening the page is the only step retried: it fails on slow or flaky networks, not on layout content.
   * Open it at the layout's symbol: loading a layout over a chart of another symbol sometimes leaves its
   * drawings tagged with the old symbol (seen with TSX:JX drawings over NASDAQ:AAPL).
   */
  static async open(browser: Browser, log: (msg: string) => void = () => undefined, at: ChartAt = { symbol: 'NASDAQ:AAPL', interval: 'D' }, attempts = 3): Promise<SignedOutChart> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      try {
        await page.goto(chartUrl(at), { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => (window as any).TradingViewApi?.activeChart && (window as any).TradingViewApi?._chartWidgetCollection, null, { timeout: 60000 });
        await page.waitForTimeout(4000);
        return new SignedOutChart(page);
      } catch (e) {
        lastError = e;
        log(`tradingview.com chart page did not start (attempt ${attempt} of ${attempts}): ${(e as Error).message.split('\n')[0]}`);
        await page.close().catch(() => undefined);
      }
    }
    throw new Error(`tradingview.com chart page did not start after ${attempts} attempts: ${(lastError as Error).message}`);
  }

  /**
   * Loads `content` the way TradingView opens a saved layout, then returns
   * TradingView's own serialization of what it loaded. Waits until two reads
   * in a row agree, because the loader upgrades some sources asynchronously.
   */
  async load(name: string, content: TvContent, studyMetaInfoMap: Record<string, unknown>): Promise<TradingViewSaved> {
    const error = await this.page.evaluate(
      async ({ name, state }) => {
        try {
          await (window as any).TradingViewApi._chartWidgetCollection.loadLayoutState({ name, chartWidgetCollectionState: state });
          return null;
        } catch (e) {
          return String((e as Error)?.stack ?? e);
        }
      },
      { name, state: { ...content, studyMetaInfoMap } },
    );
    if (error) throw new LoadRejected(`TradingView's loader rejected "${name}": ${error}`);
    let previous = '';
    for (let i = 0; i < 20; i++) {
      await this.page.waitForTimeout(1500);
      const now = await this.serialize();
      if (now === previous) break;
      previous = now;
    }
    const saved = JSON.parse(previous) as { content: string; study_meta_info_map?: string };
    return { content: JSON.parse(saved.content) as TvContent, studyMetaInfoMap: JSON.parse(saved.study_meta_info_map ?? '{}') };
  }

  /** The web app build, e.g. "2026-10-16T17:55:37". */
  buildTime(): Promise<string | null> {
    return this.page.evaluate(() => ((window as any).BUILD_TIME as string | undefined) ?? null);
  }

  private serialize(): Promise<string> {
    return this.page.evaluate(() => JSON.stringify((window as any).TradingViewApi.getSaveChartService().saveToJSON()));
  }

  close(): Promise<void> {
    return this.page.close();
  }
}
