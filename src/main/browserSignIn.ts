import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { Readable, Writable } from 'node:stream';

/** A cookie as Chrome's DevTools protocol reports it (Storage.getCookies). */
export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface BrowserSignInOptions {
  browserPath: string;
  /** A fresh profile folder only ChartKeeper uses; deleted afterwards. */
  profileDir: string;
  startUrl: string;
  isSignedIn: (cookies: CdpCookie[]) => boolean;
  /** Which cookies to hand back. */
  keep: (c: CdpCookie) => boolean;
  timeoutMs?: number;
  pollMs?: number;
  extraArgs?: string[];
  onSpawn?: (child: ChildProcess) => void;
  /** Aborting closes the browser, which ends the sign-in as cancelled. */
  signal?: AbortSignal;
}

export class SignInCancelled extends Error {
  constructor() {
    super('The browser window was closed before signing in finished.');
  }
}

/**
 * Opens the user's own browser on the sign-in page, with a private profile,
 * and waits until the sign-in cookies appear.
 *
 * The browser is started without automation flags and is watched through
 * `--remote-debugging-pipe`, which needs no network port. That keeps Google
 * sign-in and two-step verification working, since Google refuses sign-in in
 * embedded or automated browsers, and it means no other program on the PC can
 * attach to the window. ChartKeeper only ever asks the browser for cookies.
 */
export async function signInWithBrowser(opts: BrowserSignInOptions): Promise<CdpCookie[]> {
  await fs.mkdir(opts.profileDir, { recursive: true, mode: 0o700 });
  const child = spawn(
    opts.browserPath,
    [`--user-data-dir=${opts.profileDir}`, '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--new-window', ...(opts.extraArgs ?? []), opts.startUrl],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] },
  );
  opts.onSpawn?.(child);
  opts.signal?.addEventListener('abort', () => child.kill(), { once: true });
  let browserLog = '';
  const keepTail = (chunk: Buffer) => (browserLog = (browserLog + chunk.toString('utf8')).slice(-2000));
  child.stdout?.on('data', keepTail);
  child.stderr?.on('data', keepTail);
  const cdp = new PipeCdp(child);
  try {
    return await new Promise<CdpCookie[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('Signing in took too long. Please try again.'), { browserLog })), opts.timeoutMs ?? 15 * 60_000);
      child.once('exit', () => reject(new SignInCancelled()));
      child.once('error', (e) => reject(e));
      const poll = async () => {
        try {
          const { cookies } = (await cdp.call('Storage.getCookies')) as { cookies: CdpCookie[] };
          if (opts.isSignedIn(cookies)) {
            clearTimeout(timer);
            return resolve(cookies.filter(opts.keep));
          }
        } catch {
          /* browser still starting, or closing */
        }
        if (child.exitCode === null) setTimeout(poll, opts.pollMs ?? 1500);
      };
      void poll();
    });
  } finally {
    await cdp.call('Browser.close').catch(() => undefined);
    await waitForExit(child, 5000);
    await fs.rm(opts.profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function waitForExit(child: ChildProcess, ms: number) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      child.kill();
      resolve();
    }, ms);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** Chrome DevTools protocol over the pipe: JSON messages separated by NUL bytes on fds 3 (in) and 4 (out). */
class PipeCdp {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly out: Writable;

  constructor(child: ChildProcess) {
    this.out = child.stdio[3] as Writable;
    const input = child.stdio[4] as Readable;
    this.out.on('error', () => undefined);
    input.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let i: number;
      while ((i = this.buffer.indexOf('\0')) >= 0) {
        const raw = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        const msg = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message: string } };
        const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
        if (!p) continue;
        this.pending.delete(msg.id!);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    });
    child.once('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('browser exited'));
      this.pending.clear();
    });
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.out.writable) return reject(new Error('browser pipe closed'));
      this.pending.set(id, { resolve, reject });
      this.out.write(JSON.stringify({ id, method, params }) + '\0');
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 10_000);
    });
  }
}
