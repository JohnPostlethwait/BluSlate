import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  root: 'src/client',
  plugins: [svelte()],
  resolve: {
    alias: {
      '@bluslate/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
