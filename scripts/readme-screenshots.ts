/** Regenerates docs/screenshots from the UI preview and the gallery comparison. Run: npm run screenshots */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const run = (script: string, ...args: string[]) => execFileSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'scripts', script), ...args], { stdio: 'inherit', cwd: root });
run('ui-preview.ts');
run('gallery-compare.ts', 'advanced', 'advanced-dark', '--no-fail');

const out = path.join(root, 'docs/screenshots');
mkdirSync(out, { recursive: true });
const pick: Record<string, string> = {
  'home-signed-out': 'home-signed-out',
  'backup-done': 'backup-success',
  view: 'view-chart',
  compare: 'view-compare',
  'restore-choose': 'restore-step2-new',
  'restore-done': 'restore-success',
};
for (const [name, source] of Object.entries(pick)) copyFileSync(path.join(root, '.test-output/ui', `${source}.png`), path.join(out, `${name}.png`));
for (const scene of ['advanced', 'advanced-dark']) copyFileSync(path.join(root, '.test-output/gallery-compare', scene, 'side-by-side.png'), path.join(out, `${scene}-vs-tradingview.png`));
console.log('wrote', out);
