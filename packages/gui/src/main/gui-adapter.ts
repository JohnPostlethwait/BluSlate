import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { PipelineCancelledError, filterAutoAccepted } from '@bluslate/core';
import type { UIAdapter, MatchResult, TmdbTvResult, TmdbClient, DvdCompareSearchResult, ShowIdentificationResult } from '@bluslate/core';

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
  const cancelCallbacks: Set<() => void> = new Set();

  function registerCancel(cb: () => void): () => void {
    cancelCallbacks.add(cb);
    return () => cancelCallbacks.delete(cb);
  }

  return {
    cancel(): void {
      cancelled = true;
      for (const cb of cancelCallbacks) cb();
      cancelCallbacks.clear();
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
        if (autoAccept) {
          return Promise.resolve(filterAutoAccepted(matches, minConfidence));
        }
        if (cancelled) return Promise.reject(new PipelineCancelledError());

        return new Promise((resolve, reject) => {
          const listener = (_event: IpcMainEvent, { confirmed }: { confirmed: MatchResult[] }) => {
            unregister();
            resolve(confirmed);
          };
          // Send ALL matches so the ConfirmDialog can display both renameable
          // files (with checkboxes) and skipped files (unmatched only).
          // The dialog handles filtering internally.
          ipcMain.once('prompt:confirmRenames:response', listener);
          mainWindow.webContents.send('prompt:confirmRenames', { matches });
          const unregister = registerCancel(() => {
            ipcMain.removeListener('prompt:confirmRenames:response', listener);
            reject(new PipelineCancelledError());
          });
        });
      },

      confirmShowIdentification(
        directoryShowName: string,
        candidates: TmdbTvResult[],
      ): Promise<ShowIdentificationResult> {
        if (cancelled) return Promise.reject(new PipelineCancelledError());

        return new Promise((resolve, reject) => {
          const listener = (_event: IpcMainEvent, { selected }: { selected: ShowIdentificationResult }) => {
            unregister();
            resolve(selected);
          };
          ipcMain.once('prompt:confirmShow:response', listener);
          mainWindow.webContents.send('prompt:confirmShow', {
            showName: directoryShowName,
            candidates,
          });
          const unregister = registerCancel(() => {
            ipcMain.removeListener('prompt:confirmShow:response', listener);
            reject(new PipelineCancelledError());
          });
        });
      },

      confirmDvdCompareSelection(
        showName: string,
        candidates: DvdCompareSearchResult[],
      ): Promise<DvdCompareSearchResult[]> {
        if (cancelled) return Promise.reject(new PipelineCancelledError());

        return new Promise((resolve, reject) => {
          const listener = (_event: IpcMainEvent, { selected }: { selected: DvdCompareSearchResult[] }) => {
            unregister();
            resolve(selected ?? []);
          };
          ipcMain.once('prompt:confirmDvdCompare:response', listener);
          mainWindow.webContents.send('prompt:confirmDvdCompare', {
            showName,
            candidates,
          });
          const unregister = registerCancel(() => {
            ipcMain.removeListener('prompt:confirmDvdCompare:response', listener);
            reject(new PipelineCancelledError());
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
