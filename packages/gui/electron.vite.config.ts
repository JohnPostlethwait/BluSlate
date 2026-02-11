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
    build: {
      rollupOptions: {
        output: {
          // Output as .mjs so the main process preload path can use a predictable extension.
          // electron-vite defaults depend on the package.json "type" field — force ESM explicitly.
          entryFileNames: '[name].mjs',
        },
      },
    },
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
