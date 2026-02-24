import type { MatchResult } from './media.js';
import type { TmdbTvResult } from './tmdb.js';
import type { TmdbClient } from '../api/tmdb-client.js';
import type { DvdCompareSearchResult } from '../api/dvdcompare-client.js';

/** Signal from the UI that the user wants to retry with a different search query. */
export interface ShowRetrySignal {
  __retry: string;
}

/** Result of show identification: a confirmed show, a retry signal, or null (skip). */
export type ShowIdentificationResult = TmdbTvResult | ShowRetrySignal | null;

/** Progress reporting — spinners, progress bars, status updates */
export interface ProgressReporter {
  start(message: string): void;
  update(message: string): void;
  succeed(message?: string): void;
  fail(message?: string): void;
  stop(): void;
}

/** User interaction — confirmations, selections, text input */
export interface UserPrompter {
  confirmRenames(
    matches: MatchResult[],
    autoAccept: boolean,
    minConfidence: number,
    template?: string,
    scanDirectory?: string,
    client?: TmdbClient,
  ): Promise<MatchResult[]>;

  confirmShowIdentification(
    directoryShowName: string,
    candidates: TmdbTvResult[],
  ): Promise<ShowIdentificationResult>;

  /**
   * Present DVDCompare search results to the user and ask them to select
   * one or more disc releases for runtime matching (e.g., Season 1 DVD +
   * Season 3 Blu-ray), or skip DVDCompare entirely.
   * Returns the selected results, or an empty array to skip.
   */
  confirmDvdCompareSelection(
    showName: string,
    candidates: DvdCompareSearchResult[],
  ): Promise<DvdCompareSearchResult[]>;
}

/** Display — tables, summaries, results */
export interface DisplayAdapter {
  displayResults(matches: MatchResult[], scanDirectory: string): void;
  displaySummary(renamed: number, skipped: number, failed: number, dryRun: boolean): void;
}

/** Combined adapter passed to pipeline */
export interface UIAdapter {
  progress: ProgressReporter;
  prompts: UserPrompter;
  display: DisplayAdapter;
}
