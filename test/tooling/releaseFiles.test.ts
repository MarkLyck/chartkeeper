import { describe, expect, it } from 'vitest';
import { checkReleaseFiles, type BuiltFile } from '../../scripts/releaseFiles';

const V = '1.0.0-rc.11';
const file = (name: string, size = 100): BuiltFile => ({ name, size, sha512: `sha-${name}` });
const files = [
  file(`ChartKeeper-${V}-win-x64.exe`),
  file(`ChartKeeper-${V}-win-x64.exe.blockmap`),
  file(`ChartKeeper-${V}-mac-universal.dmg`),
  file(`ChartKeeper-${V}-mac-universal.zip`),
  file(`ChartKeeper-${V}-linux-x86_64.AppImage`),
  file(`ChartKeeper-${V}-linux-amd64.deb`),
];
const yml = (version: string, listed: BuiltFile[]) =>
  `version: ${version}\nfiles:\n${listed.map((f) => `  - url: ${f.name}\n    sha512: ${f.sha512}\n    size: ${f.size}\n`).join('')}path: ${listed[0]!.name}\nsha512: ${listed[0]!.sha512}\nreleaseDate: '2026-10-20T00:00:00.000Z'\n`;
const ymls = (over: Record<string, string> = {}) => [
  { name: 'latest.yml', text: yml(V, [files[0]!]) },
  { name: 'latest-mac.yml', text: yml(V, [files[3]!, files[2]!]) },
  { name: 'latest-linux.yml', text: yml(V, [files[4]!, files[5]!]) },
].map((y) => ({ ...y, text: over[y.name] ?? y.text }));

describe('the files of a release', () => {
  it('passes when every update file has the version and lists every installer with its size and sha512', () => {
    expect(checkReleaseFiles(V, files, ymls())).toEqual([]);
  });

  it('names an update file for another version', () => {
    expect(checkReleaseFiles(V, files, ymls({ 'latest.yml': yml('1.0.0', [files[0]!]) }))).toEqual(['latest.yml is for version 1.0.0, not 1.0.0-rc.11']);
  });

  it('names a listed file that is missing or differs', () => {
    const changed = { ...files[2]!, sha512: 'other' };
    const problems = checkReleaseFiles(V, files, ymls({ 'latest-mac.yml': yml(V, [files[3]!, changed, file('ChartKeeper-old.zip')]) }));
    expect(problems).toEqual([
      `latest-mac.yml: ChartKeeper-${V}-mac-universal.dmg has another sha512 than the built file`,
      'latest-mac.yml: ChartKeeper-old.zip is not among the built files',
    ]);
    expect(checkReleaseFiles(V, files, ymls({ 'latest-mac.yml': yml(V, [files[3]!, file(files[2]!.name, 99)]) }))).toEqual([
      `latest-mac.yml: ChartKeeper-${V}-mac-universal.dmg is 99 bytes, the built file 100`,
    ]);
  });

  it('names an installer no update file lists, which installed apps could not update to', () => {
    expect(checkReleaseFiles(V, files, ymls({ 'latest-linux.yml': yml(V, [files[4]!]) }))).toEqual([`ChartKeeper-${V}-linux-amd64.deb is in no update file`]);
  });

  it('wants one update file for each of Windows, Mac and Linux', () => {
    expect(checkReleaseFiles(V, files, ymls().filter((y) => y.name !== 'latest-mac.yml'))).toEqual([
      'latest-mac.yml is missing',
      `ChartKeeper-${V}-mac-universal.dmg is in no update file`,
      `ChartKeeper-${V}-mac-universal.zip is in no update file`,
    ]);
  });

  it('names an update file that is not YAML with a files list', () => {
    expect(checkReleaseFiles(V, files.slice(2), ymls({ 'latest.yml': 'version: [' }).slice(0, 3))[0]).toMatch(/^latest\.yml can't be read/);
  });

  it('refuses two built files with one name, since one would overwrite the other in the release', () => {
    expect(checkReleaseFiles(V, [...files, files[0]!], ymls())).toEqual([`ChartKeeper-${V}-win-x64.exe was built twice`]);
  });
});
