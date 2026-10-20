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
  const dmg = files.find((f) => f.url.toLowerCase().endsWith('.dmg'));
  if (!dmg) throw new Error('The release has no .dmg installer.');
  if (dmg.size === undefined) throw new Error(`The release lists no size for ${dmg.url}.`);
  const url = new URL(dmg.url, base);
  return { url: url.href, name: path.basename(decodeURIComponent(url.pathname)), sha512: dmg.sha512, size: dmg.size };
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
export async function downloadVerified(fetchFn: (url: string) => Promise<Response>, file: ReleaseFile, target: string, onPercent: (percent: number) => void): Promise<void> {
  if ((await sha512Of(target)) === file.sha512) return onPercent(100);
  const res = await fetchFn(file.url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${file.url}`);
  const part = `${target}.part`;
  const hash = createHash('sha512');
  let received = 0;
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      hash.update(chunk);
      onPercent(file.size ? Math.min(99, (received / file.size) * 100) : 0);
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), count, createWriteStream(part));
    if (received !== file.size || hash.digest('base64') !== file.sha512) throw new Error(`The download is damaged: its size or sha512 is not the release's (${received} of ${file.size} bytes).`);
    await fs.rename(part, target);
  } finally {
    await fs.rm(part, { force: true });
  }
  onPercent(100);
}
