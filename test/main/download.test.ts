import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { downloadVerified, installerFile } from '../../src/main/download';

const body = Buffer.from('ChartKeeper installer bytes '.repeat(5000));
const sha512 = createHash('sha512').update(body).digest('base64');

let server: http.Server;
let base: string;
let requests: string[];
let dir: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url !== '/ChartKeeper.dmg') return void res.writeHead(404).end();
    res.writeHead(200, { 'content-length': body.length });
    // In pieces, so progress is reported more than once.
    for (let i = 0; i < body.length; i += 16_384) res.write(body.subarray(i, i + 16_384));
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(async () => {
  requests = [];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-download-'));
});

const file = (over: Partial<{ url: string; sha512: string; size: number }> = {}) => ({ url: `${base}ChartKeeper.dmg`, sha512, size: body.length, ...over });

describe('downloading the Mac installer', () => {
  it('saves the file once its size and sha512 match, reporting progress up to 100', async () => {
    const target = path.join(dir, 'ChartKeeper.dmg');
    const percents: number[] = [];
    await downloadVerified(fetch, file(), target, (p) => percents.push(p));
    expect(Buffer.compare(await fs.readFile(target), body)).toBe(0);
    expect(await fs.readdir(dir)).toEqual(['ChartKeeper.dmg']);
    expect(percents.length).toBeGreaterThan(2);
    expect(percents.at(-1)).toBe(100);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });

  it('leaves nothing behind when the bytes are not the release’s', async () => {
    const target = path.join(dir, 'ChartKeeper.dmg');
    await expect(downloadVerified(fetch, file({ sha512: createHash('sha512').update('other').digest('base64') }), target, () => undefined)).rejects.toThrow(/damaged/);
    await expect(downloadVerified(fetch, file({ size: body.length + 1 }), target, () => undefined)).rejects.toThrow(/damaged/);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('keeps an installer downloaded before instead of fetching it again', async () => {
    const target = path.join(dir, 'ChartKeeper.dmg');
    await fs.writeFile(target, body);
    const percents: number[] = [];
    await downloadVerified(fetch, file(), target, (p) => percents.push(p));
    expect(requests).toEqual([]);
    expect(percents).toEqual([100]);
  });

  it('replaces a file of the same name that is not this installer', async () => {
    const target = path.join(dir, 'ChartKeeper.dmg');
    await fs.writeFile(target, 'half a download');
    await downloadVerified(fetch, file(), target, () => undefined);
    expect(Buffer.compare(await fs.readFile(target), body)).toBe(0);
  });

  it('fails with the HTTP status when the release has no such file', async () => {
    await expect(downloadVerified(fetch, file({ url: `${base}missing.dmg` }), path.join(dir, 'x.dmg'), () => undefined)).rejects.toThrow(/404/);
    expect(await fs.readdir(dir)).toEqual([]);
  });
});

describe('finding the installer in the release', () => {
  const files = [
    { url: 'ChartKeeper-2.0.0-mac-universal.zip', sha512: 'zip', size: 1 },
    { url: 'ChartKeeper-2.0.0-mac-universal.dmg', sha512: 'dmg', size: 2 },
  ];

  it('picks the dmg, not the zip, next to the update file', () => {
    expect(installerFile(files, 'https://github.com/MarkLyck/chartkeeper/releases/download/v2.0.0/')).toEqual({
      url: 'https://github.com/MarkLyck/chartkeeper/releases/download/v2.0.0/ChartKeeper-2.0.0-mac-universal.dmg',
      name: 'ChartKeeper-2.0.0-mac-universal.dmg',
      sha512: 'dmg',
      size: 2,
    });
  });

  it('fails when the release has no dmg', () => {
    expect(() => installerFile(files.slice(0, 1), 'https://example.com/')).toThrow(/no .dmg/);
  });
});
