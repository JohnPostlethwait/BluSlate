import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/core/src/index.ts', 'packages/core/src/types/**'],
    },
  },
  resolve: {
    alias: {
      '@bluslate/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
});
