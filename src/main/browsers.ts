import { existsSync } from 'node:fs';
import path from 'node:path';

export interface Browser {
  name: string;
  path: string;
}

/**
 * Where Chromium-based browsers install themselves, in order of preference.
 * Chrome is the most common, so it comes first; Edge ships with every Windows PC.
 */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): Browser[] {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((r): r is string => !!r);
    const win = path.win32;
    const at = (name: string, rel: string) => roots.map((r) => ({ name, path: win.join(r, rel) }));
    return [
      ...at('Google Chrome', 'Google\\Chrome\\Application\\chrome.exe'),
      ...at('Microsoft Edge', 'Microsoft\\Edge\\Application\\msedge.exe'),
      ...at('Brave', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      ...at('Chromium', 'Chromium\\Application\\chrome.exe'),
    ];
  }
  if (platform === 'darwin') {
    const apps = ['/Applications', path.posix.join(home, 'Applications')];
    const at = (name: string, rel: string) => apps.map((a) => ({ name, path: path.posix.join(a, rel) }));
    return [
      ...at('Google Chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'),
      ...at('Microsoft Edge', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      ...at('Brave', 'Brave Browser.app/Contents/MacOS/Brave Browser'),
      ...at('Chromium', 'Chromium.app/Contents/MacOS/Chromium'),
    ];
  }
  const dirs = (env.PATH ?? '/usr/bin:/usr/local/bin').split(':').concat(['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome']);
  const names: [string, string][] = [
    ['Google Chrome', 'google-chrome-stable'],
    ['Google Chrome', 'google-chrome'],
    ['Google Chrome', 'chrome'],
    ['Microsoft Edge', 'microsoft-edge-stable'],
    ['Microsoft Edge', 'microsoft-edge'],
    ['Brave', 'brave-browser'],
    ['Chromium', 'chromium'],
    ['Chromium', 'chromium-browser'],
  ];
  return names.flatMap(([name, bin]) => [...new Set(dirs)].map((d) => ({ name, path: path.posix.join(d, bin) })));
}

/**
 * The browser for signing in. CHARTKEEPER_BROWSER picks one by path, or "none"
 * for ChartKeeper's own sign-in window (support's way around a browser that
 * won't start).
 */
export function findBrowser(platform = process.platform, env = process.env, home = process.env.HOME ?? process.env.USERPROFILE ?? '', exists: (p: string) => boolean = existsSync): Browser | null {
  const chosen = env.CHARTKEEPER_BROWSER;
  if (chosen === 'none') return null;
  if (chosen && exists(chosen)) return { name: path.basename(chosen).replace(/\.(exe|app)$/i, ''), path: chosen };
  return browserCandidates(platform, env, home).find((b) => exists(b.path)) ?? null;
}
