/**
 * Publishes the installers CI built for main's newest commit as a GitHub prerelease tagged
 * v<version from package.json>, after checking that each update file (latest*.yml) has that version
 * and lists every installer with its size and sha512. Installed apps read those files to update.
 *
 *   npx tsx scripts/release.ts --notes-file notes.md [--dry-run]
 *
 * The notes are what the update popup shows. --dry-run checks everything and prints the
 * `gh release create` command instead of running it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { checkReleaseFiles, UPDATE_FILES, type BuiltFile } from './releaseFiles';

const REPO = 'MarkLyck/chartkeeper';

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function sha512(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return hash.digest('base64');
}

async function main() {
  const { values } = parseArgs({ options: { 'notes-file': { type: 'string' }, 'dry-run': { type: 'boolean', default: false } } });
  const notesFile = values['notes-file'];
  if (!notesFile) fail('Usage: npx tsx scripts/release.ts --notes-file notes.md [--dry-run]');
  if (!(await fs.readFile(notesFile, 'utf8')).trim()) fail(`${notesFile} is empty. The notes are what the update popup shows.`);

  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const sha = run('git', ['rev-parse', 'main']);
  const remote = run('git', ['rev-parse', 'origin/main']);
  if (sha !== remote) fail(`Local main (${sha.slice(0, 7)}) is not origin/main (${remote.slice(0, 7)}). Pull or push first.`);
  const version = (JSON.parse(run('git', ['show', `${sha}:package.json`])) as { version: string }).version;
  const tag = `v${version}`;
  if (spawnSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore' }).status === 0) fail(`${tag} is already released. Raise "version" in package.json on main first.`);

  const runs = JSON.parse(run('gh', ['run', 'list', '--repo', REPO, '--workflow', 'CI', '--branch', 'main', '--event', 'push', '--commit', sha, '--json', 'databaseId,status,conclusion,url'])) as {
    databaseId: number;
    status: string;
    conclusion: string;
    url: string;
  }[];
  const ci = runs.find((r) => r.status === 'completed' && r.conclusion === 'success');
  if (!ci) fail(`No successful CI run on main for ${sha.slice(0, 7)}: ${runs.map((r) => `${r.url} ${r.status} ${r.conclusion}`).join(', ') || 'none yet'}.`);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `chartkeeper-${version}-`));
  console.log(`Downloading the installers of ${ci.url} to ${dir}`);
  run('gh', ['run', 'download', String(ci.databaseId), '--repo', REPO, '--pattern', 'installer-*', '--dir', dir]);
  const paths = (await fs.readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
  const files: BuiltFile[] = await Promise.all(paths.map(async (p) => ({ name: path.basename(p), size: (await fs.stat(p)).size, sha512: await sha512(p) })));
  const ymls = await Promise.all(
    paths.filter((p) => (UPDATE_FILES as readonly string[]).includes(path.basename(p))).map(async (p) => ({ name: path.basename(p), text: await fs.readFile(p, 'utf8') })),
  );
  const problems = checkReleaseFiles(version, files, ymls);
  if (problems.length) fail(`Not released. The files of ${ci.url} are not right for ${tag}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);

  const args = ['release', 'create', tag, '--repo', REPO, '--target', sha, '--prerelease', '--title', `ChartKeeper ${version}`, '--notes-file', notesFile, ...paths];
  console.log(`${files.length} files checked for ${tag} at ${sha.slice(0, 7)}:\n${files.map((f) => `  ${f.name} (${f.size} bytes)`).join('\n')}`);
  if (values['dry-run']) return console.log(`\nDry run. This would run:\ngh ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  console.log(run('gh', args));
}

main().catch((e) => fail(String(e?.stack ?? e)));
