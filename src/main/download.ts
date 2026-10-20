import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** A file of a release as its latest*.yml lists it: sha512 in base64. */
export interface ReleaseFile {
  url: string;
  sha512: string;
  size: number;
}

/** The release's .dmg, with its address resolved against where the update file came from. */
export function installerFile(files: readonly (Omit<ReleaseFile, 'size'> & { size?: number })[], base: string): ReleaseFile & { name: string } {
  const nameOf = (url: URL) => path.posix.basename(decodeURIComponent(url.pathname));
  const dmg = files.map((f) => ({ ...f, at: new URL(f.url, base) })).find((f) => /^[^/\\]+\.dmg$/i.test(nameOf(f.at)));
  if (!dmg) throw new Error('The release has no .dmg installer.');
  // The update file names the installer; it must come from the same place as the update file.
  if (dmg.at.origin !== new URL(base).origin) throw new Error(`The release points to an installer on another site: ${dmg.at.origin}.`);
  if (dmg.size === undefined) throw new Error(`The release lists no size for ${dmg.url}.`);
  return { url: dmg.at.href, name: nameOf(dmg.at), sha512: dmg.sha512, size: dmg.size };
}

async function sha512Of(file: string): Promise<string | null> {
  const hash = createHash('sha512');
  try {
    await pipeline(createReadStream(file), hash);
  } catch {
    return null;
  }
  return hash.digest('base64');
}

/**
 * Downloads `file` to `target` and keeps it only when its size and sha512 match the release's.
 * An installer already at `target` with that hash is kept as it is.
 */
export async function downloadVerified(
  fetchFn: (url: string, init: { signal: AbortSignal }) => Promise<Response>,
  file: ReleaseFile,
  target: string,
  onPercent: (percent: number) => void,
  { stallMs = 60_000 } = {},
): Promise<void> {
  if ((await sha512Of(target)) === file.sha512) return onPercent(100);
  const abort = new AbortController();
  let stall = setTimeout(() => abort.abort(), stallMs);
  const alive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => abort.abort(), stallMs);
  };
  const res = await fetchFn(file.url, { signal: abort.signal }).catch((e) => {
    clearTimeout(stall);
    throw e;
  });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${file.url}`);
  const part = `${target}.part`;
  const hash = createHash('sha512');
  let received = 0;
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      alive();
      received += chunk.length;
      hash.update(chunk);
      onPercent(file.size ? Math.min(99, (received / file.size) * 100) : 0);
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), count, createWriteStream(part)).catch((e) => {
      throw abort.signal.aborted ? new Error(`The download stopped: nothing arrived for ${stallMs / 1000} seconds.`) : e;
    });
    if (received !== file.size || hash.digest('base64') !== file.sha512) throw new Error(`The download is damaged: its size or sha512 is not the release's (${received} of ${file.size} bytes).`);
    await fs.rename(part, target);
  } finally {
    clearTimeout(stall);
    await fs.rm(part, { force: true });
  }
  onPercent(100);
}
