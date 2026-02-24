import { BrowserWindow, ipcMain } from 'electron';
import type { UIAdapter, MatchResult, TmdbTvResult, TmdbClient, DvdCompareSearchResult } from '@mediafetch/core';

/**
 * Error thrown when the user cancels the pipeline mid-execution.
 * Caught by the main process pipeline runner to distinguish from real errors.
 */
export class PipelineCancelledError extends Error {
  constructor() {
    super('Pipeline cancelled by user');
    this.name = 'PipelineCancelledError';
  }
}

export interface CancellableGuiAdapter extends UIAdapter {
  /** Signal that the pipeline should stop at the next progress checkpoint. */
  cancel(): void;
}

/**
 * Create a UIAdapter that bridges core pipeline events to the Electron renderer
 * via IPC channels. Prompts use request/response patterns where the main process
 * sends a request and awaits a response from the renderer.
 *
 * The adapter supports cancellation: calling `cancel()` sets a flag that is
 * checked on every `progress.update()` call, throwing a PipelineCancelledError
 * to unwind the pipeline.
 */
export function createGuiAdapter(mainWindow: BrowserWindow): CancellableGuiAdapter {
  let cancelled = false;

  return {
    cancel(): void {
      cancelled = true;
    },

    progress: {
      start(message: string): void {
        if (cancelled) throw new PipelineCancelledError();
        mainWindow.webContents.send('progress:start', { message });
      },
      update(message: string): void {
        if (cancelled) throw new PipelineCancelledError();
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
          // Send ALL matches so the ConfirmDialog can display both renameable
          // files (with checkboxes) and skipped files (unmatched/unchanged).
          // The dialog handles filtering internally.
          mainWindow.webContents.send('prompt:confirmRenames', { matches });
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

      confirmDvdCompareSelection(
        showName: string,
        candidates: DvdCompareSearchResult[],
      ): Promise<DvdCompareSearchResult[]> {
        return new Promise((resolve) => {
          mainWindow.webContents.send('prompt:confirmDvdCompare', {
            showName,
            candidates,
          });
          ipcMain.once('prompt:confirmDvdCompare:response', (_event, { selected }) => {
            resolve(selected ?? []);
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
