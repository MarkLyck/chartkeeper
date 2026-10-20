import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * How ChartKeeper signs in with a browser. A Chromium-based browser runs with
 * a private profile that ChartKeeper watches; Safari is the user's own, whose
 * TradingView sign-in ChartKeeper reads from Safari's cookie file.
 */
export type Browser = { kind: 'chromium'; name: string; path: string } | { kind: 'safari'; name: 'Safari'; path: string };

export const SAFARI: Browser = { kind: 'safari', name: 'Safari', path: '/Applications/Safari.app' };

/**
 * Chromium-based browsers ChartKeeper can sign in with: they all accept a
 * private profile (--user-data-dir) and the --remote-debugging-pipe channel.
 * Not Dia or Arc: with a fresh profile they open on their own account sign-up.
 * `ids` are how each OS names the browser when it is the default browser.
 */
interface BrowserSpec {
  name: string;
  /** App bundle path inside /Applications. */
  mac?: string;
  /** Paths below Program Files, Program Files (x86) or %LOCALAPPDATA%. */
  win?: string[];
  /** Executable names on the PATH. */
  linux?: string[];
  ids: { mac?: string[]; win?: string[]; linux?: string[] };
}

const BROWSERS: BrowserSpec[] = [
  { name: 'Google Chrome', mac: 'Google Chrome.app/Contents/MacOS/Google Chrome', win: ['Google\\Chrome\\Application\\chrome.exe'], linux: ['google-chrome-stable', 'google-chrome', 'chrome'], ids: { mac: ['com.google.chrome'], win: ['ChromeHTML'], linux: ['google-chrome.desktop', 'google-chrome-stable.desktop'] } },
  { name: 'Microsoft Edge', mac: 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', win: ['Microsoft\\Edge\\Application\\msedge.exe'], linux: ['microsoft-edge-stable', 'microsoft-edge'], ids: { mac: ['com.microsoft.edgemac'], win: ['MSEdgeHTM'], linux: ['microsoft-edge.desktop'] } },
  { name: 'Brave', mac: 'Brave Browser.app/Contents/MacOS/Brave Browser', win: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'], linux: ['brave-browser', 'brave'], ids: { mac: ['com.brave.browser'], win: ['BraveHTML'], linux: ['brave-browser.desktop'] } },
  { name: 'Vivaldi', mac: 'Vivaldi.app/Contents/MacOS/Vivaldi', win: ['Vivaldi\\Application\\vivaldi.exe'], linux: ['vivaldi-stable', 'vivaldi'], ids: { mac: ['com.vivaldi.vivaldi'], win: ['VivaldiHTM'], linux: ['vivaldi-stable.desktop'] } },
  { name: 'Opera', mac: 'Opera.app/Contents/MacOS/Opera', win: ['Programs\\Opera\\opera.exe'], linux: ['opera'], ids: { mac: ['com.operasoftware.opera'], win: ['OperaStable'], linux: ['opera.desktop'] } },
  { name: 'Opera GX', mac: 'Opera GX.app/Contents/MacOS/Opera', win: ['Programs\\Opera GX\\opera.exe'], ids: { mac: ['com.operasoftware.operagx'], win: ['Opera GXStable'] } },
  { name: 'Comet', mac: 'Comet.app/Contents/MacOS/Comet', win: ['Perplexity\\Comet\\Application\\comet.exe'], ids: { mac: ['ai.perplexity.comet'] } },
  { name: 'Google Chrome Beta', mac: 'Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta', win: ['Google\\Chrome Beta\\Application\\chrome.exe'], linux: ['google-chrome-beta'], ids: { mac: ['com.google.chrome.beta'], win: ['ChromeBHTML'], linux: ['google-chrome-beta.desktop'] } },
  { name: 'Google Chrome Canary', mac: 'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', win: ['Google\\Chrome SxS\\Application\\chrome.exe'], ids: { mac: ['com.google.chrome.canary'], win: ['ChromeSSHTM'] } },
  { name: 'Yandex', mac: 'Yandex.app/Contents/MacOS/Yandex', win: ['Yandex\\YandexBrowser\\Application\\browser.exe'], linux: ['yandex-browser'], ids: { mac: ['ru.yandex.desktop.yandex-browser'], win: ['YandexHTML'], linux: ['yandex-browser.desktop'] } },
  { name: 'Chromium', mac: 'Chromium.app/Contents/MacOS/Chromium', win: ['Chromium\\Application\\chrome.exe'], linux: ['chromium', 'chromium-browser'], ids: { mac: ['org.chromium.chromium'], linux: ['chromium.desktop', 'chromium-browser.desktop'] } },
];

const osKey = (platform: NodeJS.Platform) => (platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux');

/** Where each browser would be installed, in table order. */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): Browser[] {
  const at = (name: string, p: string): Browser => ({ kind: 'chromium', name, path: p });
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((r): r is string => !!r);
    return BROWSERS.flatMap((b) => (b.win ?? []).flatMap((rel) => roots.map((r) => at(b.name, path.win32.join(r, rel)))));
  }
  if (platform === 'darwin') {
    const apps = ['/Applications', path.posix.join(home, 'Applications')];
    return BROWSERS.flatMap((b) => (b.mac ? apps.map((a) => at(b.name, path.posix.join(a, b.mac!))) : []));
  }
  const dirs = [...new Set((env.PATH ?? '/usr/bin:/usr/local/bin').split(':').concat(['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome']))];
  return BROWSERS.flatMap((b) => (b.linux ?? []).flatMap((bin) => dirs.map((d) => at(b.name, path.posix.join(d, bin)))));
}

/** The browser name behind an OS's default-browser id (bundle id, Windows ProgId, or .desktop file), if it is one we support. */
export function browserForDefaultId(platform: NodeJS.Platform, id: string | null): string | null {
  if (!id) return null;
  const key = osKey(platform);
  const wanted = id.trim().toLowerCase();
  return BROWSERS.find((b) => (b.ids[key] ?? []).some((x) => x.toLowerCase() === wanted))?.name ?? null;
}

/** The https handler from `defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers`. */
export function parseMacDefaultBrowser(lsHandlers: string): string | null {
  for (const block of lsHandlers.split('}')) {
    if (!/LSHandlerURLScheme = https;/.test(block)) continue;
    const m = /LSHandlerRoleAll = "?([^";\s]+)"?;/.exec(block);
    if (m) return m[1]!;
  }
  return null;
}

/** The ProgId from `reg query ...\UrlAssociations\https\UserChoice /v ProgId`. */
export function parseWindowsDefaultBrowser(regOutput: string): string | null {
  return /ProgId\s+REG_SZ\s+(\S.*)$/m.exec(regOutput)?.[1]?.trim() ?? null;
}

const asked = new Map<NodeJS.Platform, string | null>();

/** Asks the OS once per run which browser opens web links. Never throws: unknown just means "no preference". */
export function defaultBrowserId(platform = process.platform): string | null {
  if (!asked.has(platform)) asked.set(platform, askDefaultBrowser(platform));
  return asked.get(platform)!;
}

function askDefaultBrowser(platform: NodeJS.Platform): string | null {
  const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    if (platform === 'darwin') return parseMacDefaultBrowser(run('defaults', ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers']));
    if (platform === 'win32') return parseWindowsDefaultBrowser(run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']));
    return run('xdg-settings', ['get', 'default-web-browser']).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Installed browsers to sign in with, best first: the user's default browser
 * (that's where they're used to signing in), then the rest in table order.
 * On a Mac, Safari takes the place of the rest: every Mac has it.
 * CHARTKEEPER_BROWSER picks one by path, "safari", or "none" for ChartKeeper's
 * own sign-in window (support's way around a browser that won't start).
 */
export function findBrowsers(
  platform = process.platform,
  env = process.env,
  home = process.env.HOME ?? process.env.USERPROFILE ?? '',
  exists: (p: string) => boolean = existsSync,
  defaultId: string | null = env.CHARTKEEPER_BROWSER ? null : defaultBrowserId(platform),
): Browser[] {
  const chosen = env.CHARTKEEPER_BROWSER;
  if (chosen === 'none') return [];
  if (chosen === 'safari') return [SAFARI];
  if (chosen && exists(chosen)) return [{ kind: 'chromium', name: path.basename(chosen).replace(/\.(exe|app)$/i, ''), path: chosen }];
  const seen = new Set<string>();
  const installed = browserCandidates(platform, env, home).filter((b) => exists(b.path) && !seen.has(b.name) && seen.add(b.name));
  const preferred = browserForDefaultId(platform, defaultId);
  const others = platform === 'darwin' ? [SAFARI] : installed.filter((b) => b.name !== preferred);
  return [...installed.filter((b) => b.name === preferred), ...others];
}

export function findBrowser(...args: Parameters<typeof findBrowsers>): Browser | null {
  return findBrowsers(...args)[0] ?? null;
}
