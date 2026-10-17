import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/live/**/*.test.ts'], testTimeout: 600000, hookTimeout: 600000, fileParallelism: false } });
