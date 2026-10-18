// Bundles the three Electron parts with esbuild into dist/.
// --test-fake also builds the end-to-end tests' fake TradingView into dist-test/, which the installer never includes.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
rmSync('dist-test', { recursive: true, force: true });
mkdirSync('dist/renderer', { recursive: true });
const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'es2023', loader: { '.woff2': 'dataurl' } };
await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js', platform: 'browser', format: 'iife' }),
  process.argv.includes('--test-fake')
    ? build({ ...common, entryPoints: ['test/fakes/fakeTradingViewApp.ts'], outfile: 'dist-test/fake-tradingview.js', platform: 'node', format: 'cjs', external: ['electron'] })
    : null,
]);
cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
cpSync('build/icon.png', 'dist/icon.png');
cpSync('licenses', 'dist/licenses', { recursive: true });
