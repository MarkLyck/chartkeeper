import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/live/**', 'test/e2e/**'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: '.test-output/coverage',
      include: ['src/core/**', 'src/main/**', 'src/renderer/**', 'src/shared/**'],
      exclude: [
        // Electron-only: the app's bootstrap, its window and tray, its log file, its sign-in window and its page session.
        'src/main/main.ts',
        'src/main/shell.ts',
        'src/main/log.ts',
        'src/main/signIn.ts',
        'src/main/tvSession.ts',
        // Window entry points and the dev-only preview mock.
        'src/renderer/app.ts',
        'src/renderer/viewer/harness.ts',
        'src/renderer/mockApi.ts',
        'src/renderer/**/*.{html,css}',
      ],
      // Just below the measured values, so coverage can't drop unnoticed. Raise them when coverage rises.
      // The global numbers include test/main/browserSignIn.test.ts, which needs Playwright's Chromium.
      thresholds: {
        lines: 54,
        branches: 47,
        functions: 55,
        statements: 55,
        'src/core/**': { lines: 98, branches: 89, functions: 95, statements: 97 },
      },
    },
  },
});
