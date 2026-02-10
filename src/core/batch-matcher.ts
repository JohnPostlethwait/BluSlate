import * as path from 'node:path';
import { TmdbClient } from '../api/tmdb-client.js';
import { computeBatchConfidence } from './scorer.js';
import { extractTrackNumber } from './directory-parser.js';
import { renderTemplate, getTemplate } from '../config/templates.js';
import { logger } from '../utils/logger.js';
import { MediaType } from '../types/media.js';
import type {
  SeasonGroup,
  ClassifiedFile,
  MatchResult,
  TmdbMatchedItem,
  ProbeResult,
  DirectoryContext,
} from '../types/media.js';
import type { TmdbTvResult, TmdbSeasonDetails } from '../types/tmdb.js';
import { confirmShowIdentification } from '../ui/prompts.js';

export interface IdentifiedShow {
  showId: number;
  showName: string;
  showYear?: number;
  episodeRunTime: number[];
}

export interface SeasonBatchResult {
  matched: MatchResult[];
  reclassifiedExtras: ClassifiedFile[];
}

/**
 * Identify the show by searching TMDb and confirming with the user.
 */
export async function identifyShow(
  client: TmdbClient,
  directoryContext: DirectoryContext,
): Promise<IdentifiedShow | null> {
  const searchResponse = await client.searchTv(directoryContext.showName);

  if (searchResponse.results.length === 0) {
    logger.warn(`No TMDb results for show: "${directoryContext.showName}"`);
    return null;
  }

  // Present top results to user for confirmation
  const topResults = searchResponse.results.slice(0, 5);
  const confirmed = await confirmShowIdentification(
    directoryContext.showName,
    topResults,
  );

  if (!confirmed) return null;

  // Fetch full show details for episode_run_time
  const details = await client.getTvDetails(confirmed.id);

  const year = confirmed.first_air_date
    ? parseInt(confirmed.first_air_date.substring(0, 4), 10)
    : undefined;

  return {
    showId: confirmed.id,
    showName: confirmed.name,
    showYear: isNaN(year as number) ? undefined : year,
    episodeRunTime: details.episode_run_time ?? [],
  };
}

/**
 * Classify files as episodes or extras based on duration.
 * Sort files by disc order + track number for sequential matching.
 */
export function classifyAndSortFiles(
  group: SeasonGroup,
  expectedRuntimeMinutes?: number,
): ClassifiedFile[] {
  const classified: ClassifiedFile[] = [];

  for (const file of group.files) {
    const probeData = group.probeResults.get(file.filePath);
    const durationMinutes = probeData?.durationMinutes;

    // Compute sort order: disc * 1000 + track
    const context = group.directoryContext;
    // Re-parse disc from the individual file's path since group may span multiple discs
    const disc = parseDiscFromPath(file.filePath) ?? context.disc ?? 0;
    const track = extractTrackNumber(file.fileName);
    const sortOrder = disc * 1000 + track;

    let classification: 'episode' | 'extra' | 'unknown';

    if (durationMinutes === undefined) {
      classification = 'unknown';
    } else if (expectedRuntimeMinutes) {
      // Use adaptive thresholds based on expected episode runtime
      if (durationMinutes >= expectedRuntimeMinutes * 0.5 && durationMinutes <= expectedRuntimeMinutes * 2.5) {
        classification = 'episode';
      } else {
        classification = 'extra';
      }
    } else {
      // No expected runtime: default threshold of 15 minutes
      classification = durationMinutes >= 15 ? 'episode' : 'extra';
    }

    classified.push({
      file,
      probeData,
      classification,
      durationMinutes,
      sortOrder,
    });
  }

  // Sort by sortOrder (disc * 1000 + track)
  classified.sort((a, b) => a.sortOrder - b.sortOrder);

  const episodes = classified.filter((f) => f.classification === 'episode').length;
  const extras = classified.filter((f) => f.classification === 'extra').length;
  const unknown = classified.filter((f) => f.classification === 'unknown').length;

  logger.batch(`Classified: ${episodes} episodes, ${extras} extras, ${unknown} unknown`);

  return classified;
}

/**
 * Match episode files to TMDb season episodes using sequential greedy algorithm
 * validated by runtime.
 */
export async function matchSeasonBatch(
  client: TmdbClient,
  showId: number,
  showName: string,
  showYear: number | undefined,
  season: number,
  episodeFiles: ClassifiedFile[],
  userConfirmed: boolean,
  template?: string,
): Promise<SeasonBatchResult> {
  const matched: MatchResult[] = [];
  const reclassifiedExtras: ClassifiedFile[] = [];

  // Fetch TMDb season details
  let seasonDetails;
  try {
    seasonDetails = await client.getSeasonDetails(showId, season);
  } catch (err) {
    logger.warn(`Could not fetch season ${season} for show ${showId}: ${err}`);
    // Return unmatched results for all files
    return { matched: episodeFiles.map((ef) => createUnmatchedResult(ef)), reclassifiedExtras: [] };
  }

  const tmdbEpisodes = [...seasonDetails.episodes].sort(
    (a, b) => a.episode_number - b.episode_number,
  );

  // Sequential greedy matching
  let fileIdx = 0;
  let epIdx = 0;

  while (fileIdx < episodeFiles.length && epIdx < tmdbEpisodes.length) {
    const classifiedFile = episodeFiles[fileIdx];
    const tmdbEp = tmdbEpisodes[epIdx];
    const fileDuration = classifiedFile.durationMinutes;
    const epRuntime = tmdbEp.runtime ?? undefined;

    // Calculate runtime difference
    const runtimeDiff =
      fileDuration !== undefined && epRuntime !== undefined
        ? Math.abs(fileDuration - epRuntime)
        : undefined;

    if (runtimeDiff !== undefined && runtimeDiff <= 5) {
      // Good runtime match — assign file to episode
      const match = createBatchMatch(
        classifiedFile,
        showId,
        showName,
        showYear,
        season,
        tmdbEp.episode_number,
        undefined,
        tmdbEp.name,
        epRuntime,
        userConfirmed,
        true,
        runtimeDiff,
        template,
        false,
        epRuntime,
      );
      matched.push(match);
      fileIdx++;
      epIdx++;
    } else if (
      fileDuration !== undefined &&
      epRuntime !== undefined &&
      fileDuration > epRuntime * 1.7 &&
      epIdx + 1 < tmdbEpisodes.length
    ) {
      // File might span 2 episodes — check combined runtime
      const nextEp = tmdbEpisodes[epIdx + 1];
      const combinedRuntime = (epRuntime ?? 0) + (nextEp.runtime ?? 0);
      const combinedDiff = Math.abs(fileDuration - combinedRuntime);

      if (combinedDiff <= 10) {
        // Multi-episode match
        const match = createBatchMatch(
          classifiedFile,
          showId,
          showName,
          showYear,
          season,
          tmdbEp.episode_number,
          nextEp.episode_number,
          `${tmdbEp.name} / ${nextEp.name}`,
          combinedRuntime,
          userConfirmed,
          true,
          combinedDiff,
          template,
          true,
          epRuntime,
        );
        matched.push(match);
        fileIdx++;
        epIdx += 2;
      } else {
        // Doesn't match combined either — reclassify as extra
        reclassifiedExtras.push(classifiedFile);
        fileIdx++;
      }
    } else if (fileDuration !== undefined && epRuntime !== undefined && fileDuration < epRuntime * 0.5) {
      // File is too short — reclassify as extra
      reclassifiedExtras.push(classifiedFile);
      fileIdx++;
    } else if (runtimeDiff !== undefined && runtimeDiff <= 10) {
      // Acceptable runtime match (TMDb runtimes can be approximate)
      const match = createBatchMatch(
        classifiedFile,
        showId,
        showName,
        showYear,
        season,
        tmdbEp.episode_number,
        undefined,
        tmdbEp.name,
        epRuntime,
        userConfirmed,
        true,
        runtimeDiff,
        template,
        false,
        epRuntime,
      );
      matched.push(match);
      fileIdx++;
      epIdx++;
    } else if (runtimeDiff === undefined) {
      // No runtime data — match by position only
      const match = createBatchMatch(
        classifiedFile,
        showId,
        showName,
        showYear,
        season,
        tmdbEp.episode_number,
        undefined,
        tmdbEp.name,
        epRuntime,
        userConfirmed,
        true,
        undefined,
        template,
        false,
        undefined,
      );
      matched.push(match);
      fileIdx++;
      epIdx++;
    } else {
      // Runtime diff > 10min — reclassify as extra
      reclassifiedExtras.push(classifiedFile);
      fileIdx++;
    }
  }

  // Remaining unmatched files — reclassify as extras for specials pass
  while (fileIdx < episodeFiles.length) {
    reclassifiedExtras.push(episodeFiles[fileIdx]);
    fileIdx++;
  }

  return { matched, reclassifiedExtras };
}

export interface SpecialsBatchResult {
  matched: MatchResult[];
  unmatched: ClassifiedFile[];
}

/**
 * Match unmatched files against TMDb Season 0 (Specials) by runtime.
 * All unmatched files are candidates — no duration filtering.
 * Uses greedy best-fit matching: each candidate is matched to the
 * closest-runtime Season 0 episode within thresholds.
 */
export async function matchSpecialsBatch(
  client: TmdbClient,
  showId: number,
  showName: string,
  showYear: number | undefined,
  candidates: ClassifiedFile[],
  userConfirmed: boolean,
  template?: string,
  season0Cache?: Map<number, TmdbSeasonDetails | null>,
): Promise<SpecialsBatchResult> {
  if (candidates.length === 0) {
    return { matched: [], unmatched: [] };
  }

  // Fetch Season 0 (Specials), using cache if available
  let seasonDetails: TmdbSeasonDetails | null = null;

  if (season0Cache?.has(showId)) {
    seasonDetails = season0Cache.get(showId) ?? null;
  } else {
    try {
      seasonDetails = await client.getSeasonDetails(showId, 0);
    } catch {
      logger.batch(`No Season 0 (Specials) found for show ${showId}`);
      seasonDetails = null;
    }
    season0Cache?.set(showId, seasonDetails);
  }

  if (!seasonDetails || seasonDetails.episodes.length === 0) {
    logger.batch(`No specials episodes available for show ${showId}`);
    return { matched: [], unmatched: candidates };
  }

  // Build runtime index — only episodes with non-null runtime
  const specialsWithRuntime = seasonDetails.episodes
    .filter((ep) => ep.runtime !== null && ep.runtime > 0)
    .map((ep) => ({
      episode: ep,
      runtime: ep.runtime as number,
      consumed: false,
    }));

  if (specialsWithRuntime.length === 0) {
    logger.batch(`Season 0 has episodes but none with runtime data`);
    return { matched: [], unmatched: candidates };
  }

  const matched: MatchResult[] = [];
  const unmatched: ClassifiedFile[] = [];

  // Greedy best-fit matching: for each candidate, find closest-runtime special
  for (const candidate of candidates) {
    const fileDuration = candidate.durationMinutes;

    if (fileDuration === undefined) {
      // No duration data — can't match by runtime
      unmatched.push(candidate);
      continue;
    }

    // Find the closest unconsumed special by runtime
    let bestIdx = -1;
    let bestDiff = Infinity;

    for (let i = 0; i < specialsWithRuntime.length; i++) {
      if (specialsWithRuntime[i].consumed) continue;

      const diff = Math.abs(fileDuration - specialsWithRuntime[i].runtime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      unmatched.push(candidate);
      continue;
    }

    const bestSpecial = specialsWithRuntime[bestIdx];
    const pctDiff = (bestDiff / bestSpecial.runtime) * 100;

    // Dual threshold: absolute ≤ 15min AND relative ≤ 20%
    if (bestDiff <= 15 && pctDiff <= 20) {
      bestSpecial.consumed = true;

      const tmdbMatch: TmdbMatchedItem = {
        id: showId,
        name: showName,
        year: showYear,
        runtime: bestSpecial.runtime,
        mediaType: MediaType.TV,
        seasonNumber: 0,
        episodeNumber: bestSpecial.episode.episode_number,
        episodeTitle: bestSpecial.episode.name,
        searchRank: 0,
      };

      const confidence = computeBatchConfidence({
        userConfirmedShow: userConfirmed,
        sequentialPositionMatch: false,
        runtimeDiffMinutes: bestDiff,
        episodeExistsInTmdb: true,
        isSpecialsMatch: true,
        tmdbRuntimeMinutes: bestSpecial.runtime,
      });

      const tmdbTemplate = getTemplate(MediaType.TV, template);
      const newFilename = renderTemplate(tmdbTemplate, tmdbMatch, candidate.file.extension);

      matched.push({
        mediaFile: candidate.file,
        parsed: {
          mediaType: MediaType.TV,
          title: showName,
          season: 0,
          episodeNumbers: [bestSpecial.episode.episode_number],
        },
        probeData: candidate.probeData,
        tmdbMatch,
        confidence,
        newFilename,
        status: confidence >= 60 ? 'matched' : 'ambiguous',
      });

      logger.batch(
        `Special match: ${candidate.file.fileName} → ` +
        `S00E${String(bestSpecial.episode.episode_number).padStart(2, '0')} ` +
        `"${bestSpecial.episode.name}" ` +
        `(file: ${fileDuration}min, tmdb: ${bestSpecial.runtime}min, diff: ${bestDiff.toFixed(1)}min/${pctDiff.toFixed(0)}%)`
      );
    } else {
      unmatched.push(candidate);
    }
  }

  logger.batch(
    `Specials pass: ${matched.length} matched, ${unmatched.length} unmatched ` +
    `out of ${candidates.length} candidates`
  );

  return { matched, unmatched };
}

function createBatchMatch(
  classifiedFile: ClassifiedFile,
  showId: number,
  showName: string,
  showYear: number | undefined,
  season: number,
  episodeNumber: number,
  episodeNumberEnd: number | undefined,
  episodeTitle: string,
  runtime: number | undefined,
  userConfirmed: boolean,
  sequentialPositionMatch: boolean,
  runtimeDiff: number | undefined,
  customTemplate?: string,
  isMultiEpisodeMatch?: boolean,
  singleEpisodeRuntimeMinutes?: number,
): MatchResult {
  const tmdbMatch: TmdbMatchedItem = {
    id: showId,
    name: showName,
    year: showYear,
    runtime,
    mediaType: MediaType.TV,
    seasonNumber: season,
    episodeNumber,
    episodeNumberEnd,
    episodeTitle,
    searchRank: 0,
  };

  const confidence = computeBatchConfidence({
    userConfirmedShow: userConfirmed,
    sequentialPositionMatch,
    runtimeDiffMinutes: runtimeDiff,
    episodeExistsInTmdb: true,
    isMultiEpisodeMatch,
    singleEpisodeRuntimeMinutes,
  });

  const tmdbTemplate = getTemplate(MediaType.TV, customTemplate);
  const newFilename = renderTemplate(tmdbTemplate, tmdbMatch, classifiedFile.file.extension);

  return {
    mediaFile: classifiedFile.file,
    parsed: {
      mediaType: MediaType.TV,
      title: showName,
      season,
      episodeNumbers: episodeNumberEnd
        ? [episodeNumber, episodeNumberEnd]
        : [episodeNumber],
    },
    probeData: classifiedFile.probeData,
    tmdbMatch,
    confidence,
    newFilename,
    status: confidence >= 60 ? 'matched' : 'ambiguous',
  };
}

function createUnmatchedResult(classifiedFile: ClassifiedFile): MatchResult {
  return {
    mediaFile: classifiedFile.file,
    parsed: { mediaType: MediaType.Unknown, title: classifiedFile.file.fileName },
    probeData: classifiedFile.probeData,
    confidence: 0,
    newFilename: classifiedFile.file.fileName,
    status: 'unmatched',
  };
}

function createExtraResult(classifiedFile: ClassifiedFile): MatchResult {
  return {
    mediaFile: classifiedFile.file,
    parsed: { mediaType: MediaType.TV, title: classifiedFile.file.fileName },
    probeData: classifiedFile.probeData,
    confidence: 0,
    newFilename: classifiedFile.file.fileName,
    status: 'unmatched',
  };
}

/**
 * Re-parse disc number from a file's full path using the same patterns
 * used by the directory parser.
 */
function parseDiscFromPath(filePath: string): number | undefined {
  const dir = filePath.split(path.sep);
  for (const segment of dir) {
    // Look for S#D# pattern anywhere in directory segments
    const match = segment.match(/S\d{1,2}D(\d{1,2})/i);
    if (match) return parseInt(match[1], 10);

    // Look for "Disc N" or "Disk N" patterns
    const discMatch = segment.match(/(?:Disc|Disk|D)\s*(\d{1,2})/i);
    if (discMatch) return parseInt(discMatch[1], 10);
  }
  return undefined;
}
