/**
 * One-off migration of the committed gallery: marks the chart data of
 * computed-style scenes with `computedStyle`, as scripts/capture-gallery.ts
 * now writes it, and refreshes the manifest hashes. Safe to rerun.
 *
 *   npx tsx scripts/gallery-mark-computed.ts
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const GALLERY = path.resolve(__dirname, '../test/fixtures/gallery');

interface Meta {
  uid: string;
  charts: { chartId: string; style: { id: number }; barsSource: string }[];
}

async function main() {
  const index = JSON.parse(await fs.readFile(path.join(GALLERY, 'index.json'), 'utf8')) as { scenes: { dir: string }[] };
  for (const { dir } of index.scenes) {
    const sceneDir = path.join(GALLERY, dir);
    const meta: Meta = JSON.parse(await fs.readFile(path.join(sceneDir, 'meta.json'), 'utf8'));
    const manifestPath = path.join(sceneDir, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    let changed = false;
    for (const chart of meta.charts) {
      if (chart.barsSource !== 'tradingview') continue;
      const rel = `layouts/${meta.uid}/data/chart-${chart.chartId}.json`;
      const file = path.join(sceneDir, rel);
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      const { studies, ...rest } = data;
      const text = JSON.stringify({ ...rest, computedStyle: chart.style.id, studies }, null, 2) + '\n';
      await fs.writeFile(file, text);
      manifest.files[rel] = { sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) };
      changed = true;
      console.log(`${dir}: chart ${chart.chartId} computedStyle ${chart.style.id}`);
    }
    if (changed) await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
