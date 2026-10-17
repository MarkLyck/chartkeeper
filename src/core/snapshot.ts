import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import {
  ChartDataSchema,
  DrawingBucketSchema,
  DrawingsRecordSchema,
  LayoutRecordSchema,
  ManifestSchema,
  type ChartData,
  type DrawingBucket,
  type DrawingsRecord,
  type LayoutRecord,
  type Manifest,
} from './model';

export const SNAPSHOTS_DIR = 'snapshots';
const IN_PROGRESS = '.in-progress-';
const INCOMPLETE = '-INCOMPLETE';

/** Folder name for a snapshot taken at `date`, in local time, safe on every OS. */
export function snapshotStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

/** A safe folder name for a layout: its id, which TradingView keeps short and alphanumeric. */
export function layoutDir(uid: string): string {
  return `layouts/${uid.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');

/**
 * On Windows, antivirus, search indexing and OneDrive briefly lock new files,
 * which makes a rename fail with EPERM/EBUSY/EACCES. Retry for up to ~10 s.
 */
export async function renameWithRetry(from: string, to: string, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 12 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw e;
      await sleep(Math.min(100 * 2 ** attempt, 2000));
    }
  }
}

/** Writes files private to the current user (no effect on Windows, where the profile folder is private already). */
async function writePrivate(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await renameWithRetry(tmp, file);
}

export type ManifestBody = Omit<Manifest, 'files' | 'status' | 'error' | 'formatVersion'>;

/**
 * Builds one snapshot in a hidden ".in-progress-" folder and only gives it its
 * final name once every file is written. A failed run is renamed to
 * "<stamp>-INCOMPLETE" with the error in its manifest, so a partial backup is
 * never mistaken for a good one.
 */
export class SnapshotWriter {
  private readonly files: Manifest['files'] = {};

  private constructor(
    readonly root: string,
    readonly stamp: string,
    readonly workDir: string,
  ) {}

  static async begin(root: string, now = new Date()): Promise<SnapshotWriter> {
    const stamp = snapshotStamp(now);
    const base = path.join(root, SNAPSHOTS_DIR);
    await fs.mkdir(base, { recursive: true, mode: 0o700 });
    const workDir = path.join(base, IN_PROGRESS + stamp);
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.mkdir(workDir, { recursive: true, mode: 0o700 });
    return new SnapshotWriter(root, stamp, workDir);
  }

  async writeJson(rel: string, value: unknown): Promise<void> {
    await this.writeText(rel, JSON.stringify(value, null, 2) + '\n');
  }

  async writeText(rel: string, text: string): Promise<void> {
    await writePrivate(path.join(this.workDir, rel), text);
    this.files[rel.split(path.sep).join('/')] = { sha256: sha256(text), bytes: Buffer.byteLength(text) };
  }

  async finish(body: ManifestBody): Promise<string> {
    return this.close({ ...body, formatVersion: 1, status: 'complete', files: this.files }, this.stamp);
  }

  /** Marks the run INCOMPLETE. Never throws: it runs while reporting another error. */
  async fail(body: ManifestBody, error: string): Promise<string> {
    try {
      return await this.close({ ...body, formatVersion: 1, status: 'incomplete', error, files: this.files }, this.stamp + INCOMPLETE);
    } catch {
      return this.workDir;
    }
  }

  private async close(manifest: Manifest, name: string): Promise<string> {
    ManifestSchema.parse(manifest);
    await writePrivate(path.join(this.workDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const final = path.join(this.root, SNAPSHOTS_DIR, name);
    await fs.rm(final, { recursive: true, force: true });
    await renameWithRetry(this.workDir, final);
    return final;
  }
}

export interface SnapshotInfo {
  dir: string;
  name: string;
  manifest: Manifest | null;
  /** Set when the manifest is missing or unreadable. */
  problem: string | null;
}

/** All snapshots under `root`, newest first. Leftover in-progress folders from a crash are removed. */
export async function listSnapshots(root: string): Promise<SnapshotInfo[]> {
  const base = path.join(root, SNAPSHOTS_DIR);
  let names: string[];
  try {
    names = await fs.readdir(base);
  } catch {
    return [];
  }
  const out: SnapshotInfo[] = [];
  for (const name of names) {
    const dir = path.join(base, name);
    if (name.startsWith(IN_PROGRESS)) continue;
    if (!(await fs.stat(dir)).isDirectory()) continue;
    try {
      const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')));
      out.push({ dir, name, manifest, problem: null });
    } catch (e) {
      out.push({ dir, name, manifest: null, problem: `This backup cannot be read: ${(e as Error).message.slice(0, 200)}` });
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Renames work folders left by a crashed run to "<stamp>-INCOMPLETE", so they
 * are never mistaken for a good backup and never deleted (call it only when no
 * backup is running).
 */
export async function cleanupInterrupted(root: string): Promise<number> {
  const base = path.join(root, SNAPSHOTS_DIR);
  const names = await fs.readdir(base).catch(() => [] as string[]);
  const stale = names.filter((n) => n.startsWith(IN_PROGRESS));
  for (const n of stale) {
    const to = path.join(base, n.slice(IN_PROGRESS.length) + INCOMPLETE);
    if (existsSync(to)) await fs.rm(path.join(base, n), { recursive: true, force: true });
    else await renameWithRetry(path.join(base, n), to).catch(() => undefined);
  }
  return stale.length;
}

async function readParsed<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
}

/** Reads one snapshot's files on demand. */
export class SnapshotReader {
  constructor(
    readonly dir: string,
    readonly manifest: Manifest,
  ) {}

  static async open(dir: string): Promise<SnapshotReader> {
    return new SnapshotReader(dir, await readParsed(path.join(dir, 'manifest.json'), ManifestSchema));
  }

  layout(uid: string): Promise<LayoutRecord> {
    return readParsed(path.join(this.dir, this.layoutEntry(uid).dir, 'layout.json'), LayoutRecordSchema);
  }

  drawings(uid: string): Promise<DrawingsRecord> {
    return readParsed(path.join(this.dir, this.layoutEntry(uid).dir, 'drawings.json'), DrawingsRecordSchema);
  }

  async chartData(uid: string, chartId: string): Promise<ChartData | null> {
    const file = path.join(this.dir, this.layoutEntry(uid).dir, 'data', `chart-${chartId}.json`);
    try {
      return await readParsed(file, ChartDataSchema);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async userDrawings(): Promise<DrawingBucket | null> {
    try {
      return await readParsed(path.join(this.dir, 'user-drawings.json'), DrawingBucketSchema);
    } catch {
      return null;
    }
  }

  async readJson(rel: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(path.join(this.dir, rel), 'utf8'));
  }

  private layoutEntry(uid: string) {
    const l = this.manifest.layouts.find((x) => x.uid === uid);
    if (!l) throw new Error(`Layout ${uid} is not in this backup.`);
    return l;
  }

  /** Checks every file against the checksums in the manifest. Returns the files that changed or are missing. */
  async verify(): Promise<string[]> {
    const bad: string[] = [];
    for (const [rel, { sha256: want }] of Object.entries(this.manifest.files)) {
      try {
        if (sha256(await fs.readFile(path.join(this.dir, rel), 'utf8')) !== want) bad.push(rel);
      } catch {
        bad.push(rel);
      }
    }
    return bad;
  }
}
