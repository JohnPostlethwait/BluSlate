import { BrowserWindow, ipcMain } from 'electron';
import type { UIAdapter, MatchResult, TmdbTvResult, TmdbClient } from '@mediafetch/core';

/**
 * Create a UIAdapter that bridges core pipeline events to the Electron renderer
 * via IPC channels. Prompts use request/response patterns where the main process
 * sends a request and awaits a response from the renderer.
 */
export function createGuiAdapter(mainWindow: BrowserWindow): UIAdapter {
  return {
    progress: {
      start(message: string): void {
        mainWindow.webContents.send('progress:start', { message });
      },
      update(message: string): void {
        mainWindow.webContents.send('progress:update', { message });
      },
      succeed(message?: string): void {
        mainWindow.webContents.send('progress:succeed', { message });
      },
      fail(message?: string): void {
        mainWindow.webContents.send('progress:fail', { message });
      },
      stop(): void {
        mainWindow.webContents.send('progress:stop');
      },
    },

    prompts: {
      confirmRenames(
        matches: MatchResult[],
        autoAccept: boolean,
        minConfidence: number,
        _template?: string,
        _scanDirectory?: string,
        _client?: TmdbClient,
      ): Promise<MatchResult[]> {
        // In auto-accept mode, return high-confidence matches directly
        if (autoAccept) {
          return Promise.resolve(
            matches.filter(
              (m) =>
                m.status !== 'unmatched' &&
                m.newFilename !== m.mediaFile.fileName &&
                m.confidence >= minConfidence,
            ),
          );
        }

        return new Promise((resolve) => {
          const renameable = matches.filter(
            (m) => m.status !== 'unmatched' && m.newFilename !== m.mediaFile.fileName,
          );
          mainWindow.webContents.send('prompt:confirmRenames', { matches: renameable });
          ipcMain.once('prompt:confirmRenames:response', (_event, { confirmed }) => {
            resolve(confirmed);
          });
        });
      },

      confirmShowIdentification(
        directoryShowName: string,
        candidates: TmdbTvResult[],
      ): Promise<TmdbTvResult | null> {
        return new Promise((resolve) => {
          mainWindow.webContents.send('prompt:confirmShow', {
            showName: directoryShowName,
            candidates,
          });
          ipcMain.once('prompt:confirmShow:response', (_event, { selected }) => {
            resolve(selected);
          });
        });
      },
    },

    display: {
      displayResults(matches: MatchResult[], scanDirectory: string): void {
        mainWindow.webContents.send('results:display', { matches, scanDirectory });
      },
      displaySummary(
        renamed: number,
        skipped: number,
        failed: number,
        dryRun: boolean,
      ): void {
        mainWindow.webContents.send('results:summary', { renamed, skipped, failed, dryRun });
      },
    },
  };
}
