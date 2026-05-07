import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    globals: false,
  },
});
