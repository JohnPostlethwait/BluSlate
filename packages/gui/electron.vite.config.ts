import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@mediafetch/core': path.resolve(__dirname, '../core/src/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [svelte()],
    resolve: {
      alias: {
        '@mediafetch/core': path.resolve(__dirname, '../core/src/index.ts'),
      },
    },
  },
});
