import type { MatchResult } from './media.js';
import type { TmdbTvResult } from './tmdb.js';
import type { TmdbClient } from '../api/tmdb-client.js';
import type { DvdCompareSearchResult } from '../api/dvdcompare-client.js';

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
  ): Promise<TmdbTvResult | null>;

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
