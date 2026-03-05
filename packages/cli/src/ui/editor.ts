import { select, input } from '@inquirer/prompts';
import chalk from 'chalk';
import { renderTemplate, getTemplate, logger } from '@bluslate/core';
import type { MatchResult, TmdbClient } from '@bluslate/core';

export type EditAction = 'accepted' | 'edited' | 'skipped' | 'cancelled';
export type ReviewStatus = 'pending' | 'accepted' | 'skipped';

/**
 * Format a match's runtime as MM:SS. Uses durationSeconds for precision,
 * falls back to durationMinutes if only that is available.
 * Returns '--:--' if no probe data exists.
 */
export function formatRuntimeMmSs(match: MatchResult): string {
  const probe = match.probeData;
  if (!probe) return chalk.dim('--:--');

  if (probe.durationSeconds != null) {
    const totalSeconds = Math.round(probe.durationSeconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return chalk.dim(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
  }

  if (probe.durationMinutes != null) {
    return chalk.dim(`${String(probe.durationMinutes).padStart(2, '0')}:00`);
  }

  return chalk.dim('--:--');
}

/**
 * Parse episode input string. Accepts single numbers ("5") or ranges ("1-2", "01-02").
 * Returns parsed result or an error string.
 */
export function parseEpisodeInput(value: string): { start: number; end?: number } | string {
  const trimmed = value.trim();

  // Check for range pattern: "1-2", "01-02"
  const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (start < 1) return 'Episode numbers must be positive';
    if (start > 9999 || end > 9999) return 'Episode number must be between 1 and 9999';
    if (end <= start) return 'End episode must be greater than start episode';
    return { start, end };
  }

  // Single number — must be all digits (zero-padded like "05" is fine, "1-2-3" or "1 - 2" are not)
  if (!/^\d+$/.test(trimmed)) {
    return 'Please enter a number (e.g. 5) or range (e.g. 1-2)';
  }
  const num = parseInt(trimmed, 10);
  if (num < 1) return 'Episode number must be a positive integer';
  if (num > 9999) return 'Episode number must be between 1 and 9999';
  return { start: num };
}

/**
 * Apply an episode number edit to a match result.
 * Pure function — no prompts, no side effects beyond mutation.
 * Supports multi-episode ranges via optional episodeEnd parameter.
 * If episodeTitle is provided, it will be used in the rendered filename.
 */
export function applyEpisodeEdit(
  match: MatchResult,
  newEpisodeNumber: number,
  episodeEnd?: number,
  episodeTitle?: string,
  template?: string,
): void {
  const tmdb = match.tmdbMatch!;
  tmdb.episodeNumber = newEpisodeNumber;
  tmdb.episodeNumberEnd = episodeEnd && episodeEnd !== newEpisodeNumber ? episodeEnd : undefined;
  tmdb.episodeTitle = episodeTitle;

  const tmdbTemplate = getTemplate(template);
  match.newFilename = renderTemplate(tmdbTemplate, tmdb, match.mediaFile.extension);
  match.status = 'ambiguous';
  match.confidence = Math.min(match.confidence, 70);
}

/**
 * Apply a season number edit to a match result.
 * Pure function — no prompts, no side effects beyond mutation.
 * If episodeTitle is provided, it will be used in the rendered filename.
 * If not provided, the episode title is cleared (the episode may not exist in the new season).
 */
export function applySeasonEdit(
  match: MatchResult,
  newSeasonNumber: number,
  episodeTitle?: string,
  template?: string,
): void {
  const tmdb = match.tmdbMatch!;
  tmdb.seasonNumber = newSeasonNumber;
  tmdb.episodeTitle = episodeTitle;

  const tmdbTemplate = getTemplate(template);
  match.newFilename = renderTemplate(tmdbTemplate, tmdb, match.mediaFile.extension);
  match.status = 'ambiguous';
  match.confidence = Math.min(match.confidence, 70);
}

/**
 * Mark a match as skipped/unmatched.
 * Pure function — no prompts, no side effects beyond mutation.
 */
export function applySkip(match: MatchResult): void {
  match.status = 'unmatched';
  match.confidence = 0;
  match.newFilename = match.mediaFile.fileName;
  match.tmdbMatch = undefined;
}

/**
 * Display the review list with status indicators for each file.
 */
export function displayReviewList(
  editable: MatchResult[],
  statusMap: Map<MatchResult, ReviewStatus>,
): void {
  console.log(chalk.bold('\n  Current Mappings:\n'));
  for (let i = 0; i < editable.length; i++) {
    const m = editable[i];
    const idx = String(i + 1).padStart(2, ' ');
    const status = statusMap.get(m) ?? 'pending';
    const statusIcon = status === 'accepted' ? chalk.green('✓')
      : status === 'skipped' ? chalk.red('✗')
      : chalk.dim('·');
    const ep = m.tmdbMatch
      ? formatEpisodeTag(m.tmdbMatch.seasonNumber, m.tmdbMatch.episodeNumber, m.tmdbMatch.episodeNumberEnd)
      : '??';

    if (status === 'skipped') {
      console.log(
        `  ${idx}  ${statusIcon}  ${chalk.dim(m.mediaFile.fileName)}  ${chalk.dim('(skipped)')}`,
      );
    } else {
      const runtime = formatRuntimeMmSs(m);
      console.log(
        `  ${idx}  ${statusIcon}  ${ep}  ${runtime}  ${m.mediaFile.fileName}  ${chalk.dim('-->')}  ${m.newFilename}`,
      );
    }
  }
  console.log();
}

function formatEpisodeTag(season?: number, episode?: number, episodeEnd?: number): string {
  const s = `S${String(season ?? 0).padStart(2, '0')}`;
  const e = `E${String(episode ?? 0).padStart(2, '0')}`;
  if (episodeEnd && episodeEnd !== episode) {
    return `${s}${e}-${String(episodeEnd).padStart(2, '0')}`;
  }
  return `${s}${e}`;
}

/**
 * Look up an episode title from TMDb for a given show, season, and episode number.
 * Returns undefined on any error (graceful degradation).
 */
async function lookupEpisodeTitle(
  client: TmdbClient,
  showId: number,
  season: number,
  episode: number,
): Promise<string | undefined> {
  try {
    const seasonDetails = await client.getSeasonDetails(showId, season);
    const ep = seasonDetails.episodes.find((e) => e.episode_number === episode);
    return ep?.name;
  } catch (err) {
    logger.warn(`Could not look up episode title: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}

/**
 * Interactive editor for a single match. Returns the action taken.
 * Includes "Accept this mapping" as the first option.
 * If a TmdbClient is provided, episode titles will be looked up on edit.
 */
export async function editSingleMatch(
  match: MatchResult,
  template?: string,
  client?: TmdbClient,
): Promise<EditAction> {
  const tmdb = match.tmdbMatch!;

  const currentEp = tmdb.episodeNumberEnd && tmdb.episodeNumberEnd !== tmdb.episodeNumber
    ? `${tmdb.episodeNumber}-${tmdb.episodeNumberEnd}`
    : `${tmdb.episodeNumber ?? 'none'}`;

  const runtime = formatRuntimeMmSs(match);
  const action = await select({
    message: `[${runtime}] ${match.mediaFile.fileName}  ${chalk.dim('-->')}  ${match.newFilename} (${match.confidence}%)`,
    choices: [
      { name: chalk.green('Accept this mapping'), value: 'accept' as const },
      { name: `Change episode (current: ${currentEp})`, value: 'episode' as const },
      { name: `Change season number (current: ${tmdb.seasonNumber ?? 'none'})`, value: 'season' as const },
      { name: 'Skip this file (mark as unmatched)', value: 'skip' as const },
      { name: 'Back (no changes)', value: 'cancel' as const },
    ],
  });

  if (action === 'accept') return 'accepted';
  if (action === 'cancel') return 'cancelled';

  if (action === 'skip') {
    applySkip(match);
    console.log(chalk.yellow(`  Skipped: ${match.mediaFile.fileName}`));
    return 'skipped';
  }

  if (action === 'episode') {
    const newEpStr = await input({
      message: 'Enter episode number (e.g. 5 or 1-2), or press Enter to cancel:',
      validate: (v) => {
        if (v.trim() === '') return true;
        const result = parseEpisodeInput(v);
        return typeof result === 'string' ? result : true;
      },
    });
    if (newEpStr.trim() === '') return 'cancelled';
    const parsed = parseEpisodeInput(newEpStr) as { start: number; end?: number };
    const episodeTitle = client
      ? await lookupEpisodeTitle(client, tmdb.id, tmdb.seasonNumber!, parsed.start)
      : undefined;
    applyEpisodeEdit(match, parsed.start, parsed.end, episodeTitle, template);
    console.log(chalk.cyan(`  Updated: ${match.newFilename}`));
    return 'edited';
  }

  if (action === 'season') {
    const newSeasonStr = await input({
      message: 'Enter new season number (or press Enter to cancel):',
      validate: (v) => {
        if (v.trim() === '') return true;
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 0) return 'Please enter a non-negative integer';
        if (n > 999) return 'Season number must be between 0 and 999';
        return true;
      },
    });
    if (newSeasonStr.trim() === '') return 'cancelled';
    const newSeason = parseInt(newSeasonStr, 10);
    const episodeTitle = client && tmdb.episodeNumber != null
      ? await lookupEpisodeTitle(client, tmdb.id, newSeason, tmdb.episodeNumber)
      : undefined;
    applySeasonEdit(match, newSeason, episodeTitle, template);
    console.log(chalk.cyan(`  Updated: ${match.newFilename}`));
    return 'edited';
  }

  return 'cancelled';
}
