/**
 * Socket.IO event handlers for pipeline lifecycle.
 *
 * Mirrors the ipcMain.on() handlers from the Electron main process.
 */

import type { Socket } from 'socket.io';
import { stat } from 'node:fs/promises';
import { runPipeline, buildConfig } from '@bluslate/core';
import { createWebAdapter, PipelineCancelledError, type CancellableWebAdapter } from './web-adapter.js';
import { validatePipelineOptions, sanitizeErrorMessage } from './validation.js';
import { loadSettings, saveSettings, addRecentDirectory } from './settings.js';

let pipelineRunning = false;
let currentAdapter: CancellableWebAdapter | null = null;

export function registerSocketHandlers(socket: Socket): void {
  socket.on('pipeline:cancel', () => {
    if (currentAdapter) {
      currentAdapter.cancel();
    }
  });

  socket.on('pipeline:start', async (rawOptions: unknown) => {
    if (pipelineRunning) return;
    pipelineRunning = true;

    const ui = createWebAdapter(socket);
    currentAdapter = ui;

    try {
      const options = validatePipelineOptions(rawOptions);

      // Verify directory exists
      try {
        const dirStat = await stat(options.directory);
        if (!dirStat.isDirectory()) {
          throw new Error('Selected path is not a directory');
        }
      } catch {
        throw new Error('Directory does not exist or is not accessible');
      }

      // Save API key and add to recents
      if (options.apiKey) {
        const settings = await loadSettings();
        settings.apiKey = options.apiKey;
        await saveSettings(settings);
      }
      await addRecentDirectory(options.directory);

      const config = await buildConfig({
        directory: options.directory,
        apiKey: options.apiKey,
        dryRun: options.dryRun,
        recursive: options.recursive,
        lang: options.language,
        yes: options.autoAccept,
        minConfidence: options.minConfidence,
        template: options.template,
      });

      await runPipeline(config, ui);
      socket.emit('pipeline:complete', { success: true });
    } catch (err) {
      if ((err as Error).name === 'PipelineCancelledError') {
        socket.emit('pipeline:complete', { success: false });
      } else {
        const message = sanitizeErrorMessage(err);
        socket.emit('pipeline:error', { message });
      }
    } finally {
      pipelineRunning = false;
      currentAdapter = null;
    }
  });
}
