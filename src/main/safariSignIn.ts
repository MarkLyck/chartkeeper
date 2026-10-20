import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isTradingViewHost, SESSION_COOKIE } from '../core/tv/endpoints';
import { SignInCancelled } from './browserSignIn';

/** A cookie from a Safari cookie file. `expires` is in seconds since 1970. */
export interface SafariCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
}

/** macOS keeps apps out of Safari's data unless they have Full Disk Access. */
export class SafariAccessDenied extends Error {
  constructor() {
    super("macOS did not let ChartKeeper read Safari's sign-in. ChartKeeper needs Full Disk Access for that.");
  }
}

/** Safari's own data folder. Its cookie files are somewhere below it: one for the default profile, one per extra Safari profile. */
export const safariDataDir = (home: string) => path.join(home, 'Library/Containers/com.apple.Safari/Data/Library');

/** Seconds between 1970 and 2001, where Apple's dates start. */
const APPLE_EPOCH = 978307200;

/**
 * Reads a WebKit `.binarycookies` file: "cook", a big-endian page count and
 * page sizes, then pages of little-endian cookie records whose strings are
 * NUL-terminated at offsets from the record's start.
 */
export function parseBinaryCookies(buf: Buffer): SafariCookie[] {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'cook') throw new Error('Not a Safari cookie file.');
  const pages = buf.readUInt32BE(4);
  const cookies: SafariCookie[] = [];
  let at = 8 + pages * 4;
  for (let p = 0; p < pages; p++) {
    const size = buf.readUInt32BE(8 + p * 4);
    const page = buf.subarray(at, at + size);
    at += size;
    const count = page.readUInt32LE(4);
    for (let i = 0; i < count; i++) {
      const c = page.subarray(page.readUInt32LE(8 + i * 4));
      const text = (field: number) => {
        const s = c.subarray(c.readUInt32LE(field));
        const end = s.indexOf(0);
        return s.toString('utf8', 0, end < 0 ? s.length : end);
      };
      const flags = c.readUInt32LE(8);
      cookies.push({ domain: text(16), name: text(20), path: text(24), value: text(28), secure: (flags & 1) !== 0, httpOnly: (flags & 4) !== 0, expires: c.readDoubleLE(40) + APPLE_EPOCH });
    }
  }
  return cookies;
}

const denied = (e: unknown) => ['EPERM', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '');

/** Every cookie file below `dir`, newest first. Skips caches, which hold thousands of files and no cookies. */
export async function findCookieFiles(dir: string, depth = 6): Promise<string[]> {
  const found: { file: string; mtime: number }[] = [];
  const walk = async (d: string, left: number): Promise<void> => {
    const entries = await fs.readdir(d, { withFileTypes: true }).catch((e: unknown) => {
      if (denied(e)) throw new SafariAccessDenied();
      return [];
    });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isFile() && e.name.endsWith('.binarycookies')) {
        // Safari replaces the file as it saves, so it can be gone a moment later.
        const stat = await fs.stat(p).catch(() => null);
        if (stat) found.push({ file: p, mtime: stat.mtimeMs });
      }
      else if (e.isDirectory() && left > 0 && e.name !== 'Caches') await walk(p, left - 1);
    }
  };
  await walk(dir, depth);
  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.file);
}

/** The TradingView cookies of each Safari cookie file that has a TradingView sign-in. */
export async function safariTradingViewSignIns(dataDir: string): Promise<SafariCookie[][]> {
  const signIns: SafariCookie[][] = [];
  for (const file of await findCookieFiles(dataDir)) {
    const buf = await fs.readFile(file).catch((e: unknown) => {
      if (denied(e)) throw new SafariAccessDenied();
      return null;
    });
    let cookies: SafariCookie[];
    try {
      cookies = buf ? parseBinaryCookies(buf) : [];
    } catch {
      continue; // Safari is writing it right now; the next look gets the finished file.
    }
    const tv = cookies.filter((c) => isTradingViewHost(c.domain));
    if (tv.some((c) => c.name === SESSION_COOKIE)) signIns.push(tv);
  }
  return signIns;
}

export const openInSafari = (url: string) =>
  new Promise<void>((resolve, reject) => execFile('open', ['-b', 'com.apple.Safari', url], (e) => (e ? reject(e) : resolve())));

export interface SafariSignInOptions {
  dataDir: string;
  startUrl: string;
  /** Tries a sign-in found in Safari. False when TradingView no longer accepts it. */
  accept: (cookies: SafariCookie[]) => Promise<boolean>;
  open?: (url: string) => Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Signs in with the user's own Safari: uses the TradingView sign-in Safari
 * already has, or opens the sign-in page in Safari and waits until Safari
 * saves the new sign-in to its cookie file, which WebKit does within seconds.
 */
export async function signInWithSafari(opts: SafariSignInOptions): Promise<void> {
  const tried = new Set<string>();
  const tryNew = async () => {
    for (const cookies of await safariTradingViewSignIns(opts.dataDir)) {
      const session = cookies.find((c) => c.name === SESSION_COOKIE)!.value;
      if (tried.has(session)) continue;
      tried.add(session);
      if (await opts.accept(cookies)) return true;
    }
    return false;
  };
  if (await tryNew()) return;
  await (opts.open ?? openInSafari)(opts.startUrl);
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
  while (Date.now() < deadline) {
    await sleep(opts.pollMs ?? 1500, opts.signal);
    if (await tryNew()) return;
  }
  throw new Error('Signing in took too long. Please try again.');
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new SignInCancelled());
    const onAbort = () => {
      clearTimeout(t);
      reject(new SignInCancelled());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
