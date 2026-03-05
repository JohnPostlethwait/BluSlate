/**
 * Web UIAdapter — bridges the core pipeline to a browser client via Socket.IO.
 *
 * Direct translation of gui-adapter.ts:
 *   mainWindow.webContents.send() → socket.emit()
 *   ipcMain.once() → socket.once()
 */

import type { Socket } from 'socket.io';
import type { UIAdapter, MatchResult, TmdbTvResult, TmdbClient, DvdCompareSearchResult, ShowIdentificationResult } from '@bluslate/core';

export class PipelineCancelledError extends Error {
  constructor() {
    super('Pipeline cancelled by user');
    this.name = 'PipelineCancelledError';
  }
}

export interface CancellableWebAdapter extends UIAdapter {
  cancel(): void;
}

export function createWebAdapter(socket: Socket): CancellableWebAdapter {
  let cancelled = false;

  return {
    cancel(): void {
      cancelled = true;
    },

    progress: {
      start(message: string): void {
        if (cancelled) throw new PipelineCancelledError();
        socket.emit('progress:start', { message });
      },
      update(message: string): void {
        if (cancelled) throw new PipelineCancelledError();
        socket.emit('progress:update', { message });
      },
      succeed(message?: string): void {
        socket.emit('progress:succeed', { message });
      },
      fail(message?: string): void {
        socket.emit('progress:fail', { message });
      },
      stop(): void {
        socket.emit('progress:stop');
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
          return Promise.resolve(
            matches.filter(
              (m) => m.status !== 'unmatched' && m.confidence >= minConfidence,
            ),
          );
        }

        return new Promise((resolve) => {
          socket.emit('prompt:confirmRenames', { matches });
          socket.once('prompt:confirmRenames:response', ({ confirmed }) => {
            resolve(confirmed);
          });
        });
      },

      confirmShowIdentification(
        directoryShowName: string,
        candidates: TmdbTvResult[],
      ): Promise<ShowIdentificationResult> {
        return new Promise((resolve) => {
          socket.emit('prompt:confirmShow', {
            showName: directoryShowName,
            candidates,
          });
          socket.once('prompt:confirmShow:response', ({ selected }) => {
            resolve(selected);
          });
        });
      },

      confirmDvdCompareSelection(
        showName: string,
        candidates: DvdCompareSearchResult[],
      ): Promise<DvdCompareSearchResult[]> {
        return new Promise((resolve) => {
          socket.emit('prompt:confirmDvdCompare', {
            showName,
            candidates,
          });
          socket.once('prompt:confirmDvdCompare:response', ({ selected }) => {
            resolve(selected ?? []);
          });
        });
      },
    },

    display: {
      displayResults(matches: MatchResult[], scanDirectory: string): void {
        socket.emit('results:display', { matches, scanDirectory });
      },
      displaySummary(
        renamed: number,
        skipped: number,
        failed: number,
        dryRun: boolean,
      ): void {
        socket.emit('results:summary', { renamed, skipped, failed, dryRun });
      },
    },
  };
}
