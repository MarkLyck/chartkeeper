/**
 * Builds test/fixtures/compat/line-tools.json: every TradingView drawing tool
 * as TradingView itself serializes it, with all default properties filled in.
 * test/compat/advancedAccount.ts customizes these into an "advanced" account.
 *
 * Each tool is loaded on its own into a signed-out chart through the web
 * app's loader and read back with its serializer, so no account is needed.
 *
 *   npx tsx scripts/build-compat-fixture.ts
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TvSource } from '../src/core/tv/content';
import { LoadRejected, launchChromium, SignedOutChart } from '../test/compat/signedOutChart';

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test/fixtures/compat/line-tools.json');

/** Every tool of TradingView's drawing toolbar (bundle 3233, module 899801 `supportedLineTools`), with the number of points it is drawn with. */
const TOOLS: Record<string, number> = {
  LineToolBrush: 2, LineToolHighlighter: 2, LineToolText: 2, LineToolTextAbsolute: 1, LineToolNote: 2, LineToolTextNote: 2,
  LineToolNoteAbsolute: 1, LineToolSignpost: 2, LineToolCallout: 2, LineToolBalloon: 2, LineToolComment: 2,
  LineToolArrowMarkUp: 2, LineToolArrowMarkDown: 2, LineToolArrowMarkLeft: 2, LineToolArrowMarkRight: 2,
  LineToolPriceLabel: 2, LineToolPriceNote: 2, LineToolArrowMarker: 2, LineToolFlagMark: 2, LineToolImage: 2, LineToolTable: 2,
  LineToolVertLine: 2, LineToolHorzLine: 2, LineToolCrossLine: 2, LineToolHorzRay: 2, LineToolTrendLine: 2, LineToolInfoLine: 2,
  LineToolTrendAngle: 2, LineToolArrow: 2, LineToolRay: 2, LineToolExtended: 2, LineToolParallelChannel: 3,
  LineToolDisjointAngle: 3, LineToolFlatBottom: 3, LineToolAnchoredVWAP: 1, LineToolPitchfork: 3, LineToolSchiffPitchfork: 3,
  LineToolSchiffPitchfork2: 3, LineToolInsidePitchfork: 3, LineToolPitchfan: 3, LineToolGannSquare: 2, LineToolGannComplex: 2,
  LineToolGannFixed: 2, LineToolGannFan: 2, LineToolFibRetracement: 2, LineToolTrendBasedFibExtension: 3,
  LineToolFibSpeedResistanceFan: 2, LineToolFibTimeZone: 2, LineToolTrendBasedFibTime: 3, LineToolFibCircles: 2,
  LineToolFibSpiral: 3, LineToolFibSpeedResistanceArcs: 3, LineToolFibChannel: 3, LineTool5PointsPattern: 5,
  LineToolCypherPattern: 5, LineToolABCD: 4, LineToolTrianglePattern: 4, LineToolHeadAndShoulders: 7,
  LineToolElliottImpulse: 6, LineToolElliottTriangle: 6, LineToolElliottTripleCombo: 6, LineToolElliottCorrection: 4,
  LineToolElliottDoubleCombo: 4, LineToolCircleLines: 2, LineToolTimeCycles: 2, LineToolSineLine: 2,
  LineToolRiskRewardLong: 2, LineToolRiskRewardShort: 2, LineToolPrediction: 3, LineToolDateRange: 2, LineToolPriceRange: 2,
  LineToolDateAndPriceRange: 2, LineToolBarsPattern: 2, LineToolGhostFeed: 3, LineToolProjection: 3, LineToolRectangle: 2,
  LineToolRotatedRectangle: 3, LineToolCircle: 2, LineToolEllipse: 3, LineToolTriangle: 3, LineToolPolyline: 4, LineToolPath: 4,
  LineToolBezierQuadro: 3, LineToolBezierCubic: 4, LineToolArc: 3, LineToolIcon: 1, LineToolEmoji: 1, LineToolSticker: 1,
  LineToolRegressionTrend: 2, LineToolFixedRangeVolumeProfile: 2,
};

/**
 * Source format versions TradingView's loader needs to keep a tool as it is.
 * Without one, its migration (bundle 16242, module 546654) turns a version 1
 * LineToolGannComplex into a LineToolGannFixed.
 */
const VERSIONS: Record<string, number> = { LineToolGannComplex: 2 };

const DAY = 86400;
/** Daily AAPL bars are stamped at 00:00 UTC; 2026-04-01 is a Wednesday, and points are a week apart. */
const pointsFor = (n: number) => Array.from({ length: n }, (_, k) => ({ time_t: Date.UTC(2026, 3, 1) / 1000 + k * 7 * DAY, offset: 0, price: 250 + ((k * 23) % 70), interval: '1D' }));

async function main() {
  const reference = JSON.parse(await fs.readFile(path.join(ROOT, 'test/fixtures/reference-snapshot/layouts/RefAAPL1/layout.json'), 'utf8'));
  const base = structuredClone(reference.content);
  base.charts[0].panes = [{ ...base.charts[0].panes[0], sources: base.charts[0].panes[0].sources.filter((s: TvSource) => s.type === 'MainSeries') }];

  const browser = await launchChromium();
  const chart = await SignedOutChart.open(browser, console.log);
  const tools: Record<string, TvSource> = {};
  const unsupported: Record<string, string> = {};
  const pointCountChanged: Record<string, { sent: number; kept: number }> = {};
  for (const [type, n] of Object.entries(TOOLS)) {
    const content = structuredClone(base);
    const id = `fx${type.replace('LineTool', '').slice(0, 10)}`;
    // Drawings saved today carry state versions 2; the loader migrates older ones and changes their fields.
    content.charts[0].panes[0].sources.push({ type, id, state: { symbol: 'NASDAQ:AAPL', interval: '1D', symbolStateVersion: 2, zOrderVersion: 2, text: type.replace('LineTool', '') }, points: pointsFor(n), zorder: -5000, ownerSource: '_seriesId', linkKey: `lk${id}`, ...(VERSIONS[type] ? { version: VERSIONS[type] } : {}) });
    try {
      const saved = await chart.load(type, content, {});
      const source = saved.content.charts[0]!.panes.flatMap((p) => p.sources).find((s) => s.id === id);
      if (source && source.type !== type) unsupported[type] = `TradingView turned it into a ${String(source.type)}`;
      else if (source) {
        const kept = Array.isArray(source.points) ? source.points.length : 0;
        if (kept !== n) pointCountChanged[type] = { sent: n, kept };
        tools[type] = source;
      } else unsupported[type] = 'loaded without error, but TradingView dropped the drawing';
    } catch (e) {
      if (!(e instanceof LoadRejected)) throw e;
      unsupported[type] = e.message.split('\n')[0]!.slice(0, 300);
    }
    console.log(type, tools[type] ? 'ok' : `UNSUPPORTED: ${unsupported[type]}`);
  }
  const buildTime = await chart.buildTime();
  await browser.close();

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify({ tradingViewBuild: buildTime, generatedAt: new Date().toISOString(), unsupportedSignedOut: unsupported, pointCountChanged, tools }, null, 1) + '\n');
  console.log(`wrote ${OUT}: ${Object.keys(tools).length} tools, ${Object.keys(unsupported).length} unsupported signed out`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
