import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude: ['test/live/**', 'test/e2e/**', 'test/compat/**'], testTimeout: 20000 } });
