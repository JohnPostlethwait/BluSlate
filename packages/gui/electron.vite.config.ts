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
    // Do NOT use externalizeDepsPlugin() here. Sandboxed preload scripts cannot
    // resolve bare module specifiers — only the built-in 'electron' module is
    // available. All other dependencies (e.g. @electron-toolkit/preload) must be
    // bundled into the preload output.
    plugins: [externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload'] })],
    build: {
      rollupOptions: {
        output: {
          // Sandboxed Electron preload scripts MUST be CommonJS — ESM imports
          // fail silently. Force CJS format and .js extension regardless of the
          // package.json "type": "module" setting.
          format: 'cjs',
          entryFileNames: '[name].js',
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
