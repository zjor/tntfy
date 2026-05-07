import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    globals: false,
  },
});
