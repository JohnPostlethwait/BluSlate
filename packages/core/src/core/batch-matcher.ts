import * as path from 'node:path';
import { TmdbClient } from '../api/tmdb-client.js';
import { computeBatchConfidenceBreakdown } from './scorer.js';
import { normalizedSimilarity } from './scorer.js';
import { extractTrackNumber } from './directory-parser.js';
import { renderTemplate, getTemplate } from '../config/templates.js';
import {
  EPISODE_MIN_RUNTIME_RATIO,
  EPISODE_MAX_RUNTIME_RATIO,
  EPISODE_MIN_DURATION_MINUTES,
  MULTI_EPISODE_RUNTIME_MULTIPLIER,
  MULTI_EPISODE_COMBINED_TOLERANCE_MIN,
  DVDCOMPARE_RUNTIME_TOLERANCE_SEC,
  DVDCOMPARE_TITLE_SIMILARITY_MIN,
  SPECIALS_MAX_DIFF_MINUTES,
  SPECIALS_MAX_DIFF_PERCENT,
  CONFIDENCE_MATCHED_THRESHOLD,
  TRACK_REVERSAL_THRESHOLD,
  TRACK_REVERSAL_MIN_FORWARD_COST,
} from '../config/thresholds.js';
import { logger } from '../utils/logger.js';
import { MediaType } from '../types/media.js';
import type { DvdCompareDisc } from '../api/dvdcompare-client.js';
import type {
  SeasonGroup,
  ClassifiedFile,
  MatchResult,
  TmdbMatchedItem,
  ProbeResult,
  DirectoryContext,
} from '../types/media.js';
import type { TmdbTvResult, TmdbEpisode, TmdbSeasonDetails } from '../types/tmdb.js';
import type { UserPrompter } from '../types/ui-adapter.js';

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
  prompts: UserPrompter,
): Promise<IdentifiedShow | null> {
  let searchQuery = directoryContext.showName;

  while (true) {
    const searchResponse = await client.searchTv(searchQuery);

    if (searchResponse.results.length === 0) {
      logger.warn(`No TMDb results for show: "${searchQuery}"`);
      // Let user retry with a different query even when no results found
      const result = await prompts.confirmShowIdentification(searchQuery, []);
      if (result !== null && typeof result === 'object' && '__retry' in result) {
        searchQuery = result.__retry;
        continue;
      }
      return null;
    }

    // Present top results to user for confirmation
    const topResults = searchResponse.results.slice(0, 5);
    const result = await prompts.confirmShowIdentification(searchQuery, topResults);

    if (result === null) return null; // User skipped

    if (typeof result === 'object' && '__retry' in result) {
      searchQuery = result.__retry;
      continue; // Loop again with new query
    }

    // User confirmed a show — fetch full details for episode_run_time
    const details = await client.getTvDetails(result.id);

    const year = result.first_air_date
      ? parseInt(result.first_air_date.substring(0, 4), 10)
      : undefined;

    return {
      showId: result.id,
      showName: result.name,
      showYear: isNaN(year as number) ? undefined : year,
      episodeRunTime: details.episode_run_time ?? [],
    };
  }
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
      if (durationMinutes >= expectedRuntimeMinutes * EPISODE_MIN_RUNTIME_RATIO && durationMinutes <= expectedRuntimeMinutes * EPISODE_MAX_RUNTIME_RATIO) {
        classification = 'episode';
      } else {
        classification = 'extra';
      }
    } else {
      // No expected runtime: default threshold
      classification = durationMinutes >= EPISODE_MIN_DURATION_MINUTES ? 'episode' : 'extra';
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
 * Find the TMDb episode that best matches a DVDCompare episode title.
 * Uses Levenshtein similarity with a minimum threshold.
 * Returns the matched episode and its index, or null if no good match.
 */
function findTmdbEpisodeByTitle(
  tmdbEpisodes: TmdbEpisode[],
  dvdCompareTitle: string,
  assignedEps: Set<number>,
): { ep: TmdbEpisode; idx: number } | null {
  const normalizedDvdTitle = dvdCompareTitle.toLowerCase().trim();
  let bestIdx = -1;
  let bestSimilarity = 0;

  for (let i = 0; i < tmdbEpisodes.length; i++) {
    if (assignedEps.has(i)) continue;

    const tmdbName = tmdbEpisodes[i].name.toLowerCase().trim();
    const similarity = normalizedSimilarity(normalizedDvdTitle, tmdbName);

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestIdx = i;
    }
  }

  // Require minimum similarity to consider it a match
  // (handles cases like "Encounter at Farpoint" vs "Encounter at Farpoint, Part 1")
  if (bestIdx >= 0 && bestSimilarity >= DVDCOMPARE_TITLE_SIMILARITY_MIN) {
    return { ep: tmdbEpisodes[bestIdx], idx: bestIdx };
  }

  return null;
}

/**
 * Match episode files to TMDb season episodes using set-based optimal assignment.
 *
 * When DVDCompare disc data is provided, a high-precision first pass uses
 * to-the-second runtime matching for definitive episode identification.
 * Files not matched by DVDCompare fall through to the set-based approach.
 *
 * Without DVDCompare data, evaluates ALL possible file→episode pairings using a
 * cost function that considers both runtime proximity and positional proximity.
 * Assignments are made greedily from lowest cost to highest, ensuring that
 * files from Disc 1 naturally match early episodes and Disc 6 matches late ones.
 */
export async function matchSeasonBatch(
  client: TmdbClient,
  showId: number,
  showName: string,
  showYear: number | undefined,
  season: number,
  episodeFiles: ClassifiedFile[],
  template?: string,
  dvdCompareDiscs?: DvdCompareDisc[],
): Promise<SeasonBatchResult> {
  const matched: MatchResult[] = [];
  const reclassifiedExtras: ClassifiedFile[] = [];

  // Fetch TMDb season details
  let seasonDetails;
  try {
    seasonDetails = await client.getSeasonDetails(showId, season);
  } catch (err) {
    logger.warn(`Could not fetch season ${season} for show ${showId}: ${err}`);
    return { matched: episodeFiles.map((ef) => createUnmatchedResult(ef)), reclassifiedExtras: [] };
  }

  const tmdbEpisodes = [...seasonDetails.episodes].sort(
    (a, b) => a.episode_number - b.episode_number,
  );

  const seasonEpisodesList = tmdbEpisodes.map((ep) => ({
    episodeNumber: ep.episode_number,
    episodeName: ep.name,
    runtime: ep.runtime,
  }));

  if (episodeFiles.length === 0 || tmdbEpisodes.length === 0) {
    return { matched: [], reclassifiedExtras: [...episodeFiles] };
  }

  // ── Detect and fix reverse track order within discs ─────────────────
  // MakeMKV may extract titles in reverse episode order on some discs.
  // Compare forward vs reverse runtime cost per disc and reorder if needed.
  detectAndApplyTrackOrder(episodeFiles, tmdbEpisodes);

  const assignedFiles = new Set<number>();
  const assignedEps = new Set<number>();

  // ── DVDCompare first-pass: set-based sub-second runtime matching ─────
  // When DVDCompare disc data is available, use to-the-second runtimes for
  // definitive episode identification. Uses a set-based approach (like the
  // TMDb matcher below) with cost = runtimeDiff + positionalDiff * WEIGHT
  // to correctly assign episodes when multiple have similar runtimes
  // (e.g., Venture Bros S3 where eps 3-7 are all within 22:42-22:52).
  if (dvdCompareDiscs && dvdCompareDiscs.length > 0) {
    logger.batch(`DVDCompare: attempting set-based matching with ${dvdCompareDiscs.length} disc(s)`);

    // 1. Flatten DVDCompare episodes in disc order, preserving disc number
    interface DvdEpisodeFlat {
      title: string;
      runtimeSeconds: number;
      runtimeFormatted: string;
      discNumber: number;
    }

    const dvdEpisodesFlat: DvdEpisodeFlat[] = [];
    for (const disc of [...dvdCompareDiscs].sort((a, b) => a.discNumber - b.discNumber)) {
      for (const ep of disc.episodes) {
        dvdEpisodesFlat.push({ ...ep, discNumber: disc.discNumber });
      }
    }

    // 2. Pre-map each DVDCompare episode to its best TMDb episode by title.
    //    Track used TMDb indices to prevent two DVDCompare episodes from
    //    mapping to the same TMDb episode (e.g., similarly named parts).
    const dvdToTmdb = new Map<number, { ep: TmdbEpisode; idx: number }>();
    const premapUsed = new Set<number>();

    for (let di = 0; di < dvdEpisodesFlat.length; di++) {
      const result = findTmdbEpisodeByTitle(tmdbEpisodes, dvdEpisodesFlat[di].title, premapUsed);
      if (result) {
        dvdToTmdb.set(di, result);
        premapUsed.add(result.idx);
      }
    }

    // 3. Build candidate pairings with cost = runtimeDiff + positionalDiff * weight
    interface DvdCandidate {
      fileIdx: number;
      dvdIdx: number;
      tmdbIdx: number;
      cost: number;
      runtimeDiffSeconds: number;
    }

    const dvdCandidates: DvdCandidate[] = [];
    const maxFilePosD = Math.max(1, episodeFiles.length - 1);
    const maxDvdPos = Math.max(1, dvdEpisodesFlat.length - 1);

    // Positional weight: seconds of cost for full-season positional displacement.
    // With 3s runtime tolerance, 5s ensures position is the decisive tiebreaker
    // when multiple episodes have runtimes within 1-2s of each other.
    const DVD_POSITIONAL_WEIGHT = 5;

    for (let fi = 0; fi < episodeFiles.length; fi++) {
      const file = episodeFiles[fi];
      const durationSeconds = file.probeData?.durationSeconds;
      if (durationSeconds === undefined) continue;

      const discNumber = parseDiscFromPath(file.file.filePath);
      const filePos = fi / maxFilePosD; // 0..1

      for (let di = 0; di < dvdEpisodesFlat.length; di++) {
        const dvdEp = dvdEpisodesFlat[di];

        // Apply disc constraint: if file is from a specific disc, only match
        // against DVDCompare episodes from that disc
        if (discNumber !== undefined && dvdEp.discNumber !== discNumber) continue;

        // Must have a TMDb mapping for this DVDCompare episode
        const tmdbMapping = dvdToTmdb.get(di);
        if (!tmdbMapping) continue;

        const runtimeDiff = Math.abs(durationSeconds - dvdEp.runtimeSeconds);
        if (runtimeDiff > DVDCOMPARE_RUNTIME_TOLERANCE_SEC) continue; // Beyond tolerance

        const dvdPos = di / maxDvdPos; // 0..1
        const positionalDiff = Math.abs(filePos - dvdPos);
        const cost = runtimeDiff + positionalDiff * DVD_POSITIONAL_WEIGHT;

        dvdCandidates.push({
          fileIdx: fi,
          dvdIdx: di,
          tmdbIdx: tmdbMapping.idx,
          cost,
          runtimeDiffSeconds: runtimeDiff,
        });
      }
    }

    // 4. Greedy assignment from lowest cost
    dvdCandidates.sort((a, b) => a.cost - b.cost);
    const assignedDvdEps = new Set<number>();

    for (const c of dvdCandidates) {
      if (assignedFiles.has(c.fileIdx)) continue;
      if (assignedEps.has(c.tmdbIdx)) continue;
      if (assignedDvdEps.has(c.dvdIdx)) continue;

      const file = episodeFiles[c.fileIdx];
      const dvdEp = dvdEpisodesFlat[c.dvdIdx];
      const tmdbEp = tmdbEpisodes[c.tmdbIdx];

      // Check for multi-episode file (e.g., "Encounter at Farpoint" is ~91 min
      // but TMDb may list it as two ~46 min episodes)
      const durationSeconds = file.probeData!.durationSeconds!;
      let isMultiEp = false;
      let epEndNumber: number | undefined;
      let combinedRuntime: number | undefined;
      const singleEpRuntime = tmdbEp.runtime;

      if (singleEpRuntime && (durationSeconds / 60) > singleEpRuntime * MULTI_EPISODE_RUNTIME_MULTIPLIER) {
        const nextIdx = c.tmdbIdx + 1;
        if (nextIdx < tmdbEpisodes.length && !assignedEps.has(nextIdx)) {
          const nextEp = tmdbEpisodes[nextIdx];
          if (nextEp.runtime) {
            const combined = singleEpRuntime + nextEp.runtime;
            if (Math.abs(durationSeconds / 60 - combined) <= MULTI_EPISODE_COMBINED_TOLERANCE_MIN) {
              isMultiEp = true;
              epEndNumber = nextEp.episode_number;
              combinedRuntime = combined;
              assignedEps.add(nextIdx);
            }
          }
        }
      }

      assignedFiles.add(c.fileIdx);
      assignedEps.add(c.tmdbIdx);
      assignedDvdEps.add(c.dvdIdx);

      const match = createBatchMatch({
        classifiedFile: file,
        showId,
        showName,
        showYear,
        season,
        episodeNumber: tmdbEp.episode_number,
        episodeNumberEnd: epEndNumber,
        episodeTitle: isMultiEp
          ? `${tmdbEp.name} / ${tmdbEpisodes[c.tmdbIdx + 1].name}`
          : tmdbEp.name,
        runtime: isMultiEp ? combinedRuntime : (singleEpRuntime ?? undefined),
        sequentialPositionMatch: true,
        runtimeDiff: 0,
        customTemplate: template,
        isMultiEpisodeMatch: isMultiEp,
        singleEpisodeRuntimeMinutes: singleEpRuntime ?? undefined,
        seasonEpisodeCount: tmdbEpisodes.length,
        seasonEpisodes: seasonEpisodesList,
        isDvdCompareMatch: true,
        dvdCompareRuntimeDiffSeconds: c.runtimeDiffSeconds,
        dvdCompareTitle: dvdEp.title,
        dvdCompareRuntimeSeconds: dvdEp.runtimeSeconds,
      });
      matched.push(match);

      logger.batch(
        `DVDCompare match: ${file.file.fileName} → ` +
        `S${String(season).padStart(2, '0')}E${String(tmdbEp.episode_number).padStart(2, '0')}` +
        (isMultiEp ? `-E${String(epEndNumber).padStart(2, '0')}` : '') +
        ` "${tmdbEp.name}" ` +
        `(via DVDCompare "${dvdEp.title}", ±${c.runtimeDiffSeconds.toFixed(1)}s, ` +
        `cost: ${c.cost.toFixed(2)}, disc ${dvdEp.discNumber})`,
      );
    }

    const dvdMatched = assignedFiles.size;
    if (dvdMatched > 0) {
      logger.batch(
        `DVDCompare: matched ${dvdMatched}/${episodeFiles.length} files, ` +
        `${episodeFiles.length - dvdMatched} remaining for set-based matching`,
      );
    }
  }

  // ── Build candidate pairings with cost ────────────────────────────────
  // Cost = runtimeCost + positionalCost
  //   runtimeCost:    absolute runtime difference in minutes (lower = better)
  //   positionalCost: how far the episode is from the file's expected position,
  //                   scaled to be a meaningful tiebreaker (~20 min penalty for
  //                   matching a file at position 0 to the last episode)

  interface MatchCandidate {
    fileIdx: number;
    epIdx: number;
    cost: number;
    runtimeDiff: number;
    isMultiEp: boolean;
    epEndIdx?: number;       // index into tmdbEpisodes for multi-ep end
    sequentialMatch: boolean; // true if file position ≈ episode position
  }

  const candidates: MatchCandidate[] = [];
  const maxFilePos = Math.max(1, episodeFiles.length - 1);
  const maxEpPos = Math.max(1, tmdbEpisodes.length - 1);

  // Positional weight: how many "minutes of cost" a full-season positional
  // displacement is equivalent to. A value of 40 means that matching a file
  // at position 0 to the last episode costs an extra 40 minutes.
  // This ensures sequential position is the dominant signal for shows where
  // TMDb runtimes are similar (e.g., miniseries with all ~90 min episodes).
  const POSITIONAL_WEIGHT = 40;

  for (let fi = 0; fi < episodeFiles.length; fi++) {
    if (assignedFiles.has(fi)) continue; // Already matched (e.g., by DVDCompare)

    const file = episodeFiles[fi];
    // Use exact seconds-to-minutes for precise cost calculation.
    // file.durationMinutes is Math.round()'d which loses sub-minute precision
    // and can cause wrong greedy assignments when costs differ by < 1 minute.
    const fileDuration = file.probeData?.durationSeconds !== undefined
      ? file.probeData.durationSeconds / 60
      : file.durationMinutes;
    if (fileDuration === undefined) continue;

    const filePos = fi / maxFilePos; // 0..1

    for (let ei = 0; ei < tmdbEpisodes.length; ei++) {
      if (assignedEps.has(ei)) continue; // Already matched (e.g., by DVDCompare)

      const ep = tmdbEpisodes[ei];
      const epRuntime = ep.runtime;
      if (epRuntime === null || epRuntime === undefined) continue;

      const epPos = ei / maxEpPos; // 0..1
      const positionalDiff = Math.abs(filePos - epPos);
      const runtimeDiff = Math.abs(fileDuration - epRuntime);

      // Is this file at roughly the expected sequential position?
      const sequentialMatch = positionalDiff <= 0.15;

      // ── Single-episode match ──────────────────────────────────────
      if (runtimeDiff <= 10) {
        const cost = runtimeDiff + positionalDiff * POSITIONAL_WEIGHT;
        candidates.push({
          fileIdx: fi,
          epIdx: ei,
          cost,
          runtimeDiff,
          isMultiEp: false,
          sequentialMatch,
        });
      }

      // ── Multi-episode match (file spans this episode + next) ──────
      if (
        ei + 1 < tmdbEpisodes.length &&
        fileDuration > epRuntime * MULTI_EPISODE_RUNTIME_MULTIPLIER
      ) {
        const nextEp = tmdbEpisodes[ei + 1];
        if (nextEp.runtime !== null && nextEp.runtime !== undefined) {
          const combinedRuntime = epRuntime + nextEp.runtime;
          const combinedDiff = Math.abs(fileDuration - combinedRuntime);

          if (combinedDiff <= 10) {
            // Small penalty for multi-ep to prefer single-ep when close
            const cost = combinedDiff + positionalDiff * POSITIONAL_WEIGHT + 3;
            candidates.push({
              fileIdx: fi,
              epIdx: ei,
              cost,
              runtimeDiff: combinedDiff,
              isMultiEp: true,
              epEndIdx: ei + 1,
              sequentialMatch,
            });
          }
        }
      }
    }
  }

  // ── Handle files with no runtime data (position-only matching) ──────
  // These get assigned after runtime-based matches, filling remaining slots
  const noRuntimeFiles: number[] = [];
  for (let fi = 0; fi < episodeFiles.length; fi++) {
    if (episodeFiles[fi].durationMinutes === undefined) {
      noRuntimeFiles.push(fi);
    }
  }

  // ── Greedy assignment: pick lowest-cost pairing, assign, repeat ─────
  candidates.sort((a, b) => a.cost - b.cost);

  for (const c of candidates) {
    if (assignedFiles.has(c.fileIdx)) continue;
    if (assignedEps.has(c.epIdx)) continue;
    if (c.isMultiEp && c.epEndIdx !== undefined && assignedEps.has(c.epEndIdx)) continue;

    assignedFiles.add(c.fileIdx);
    assignedEps.add(c.epIdx);
    if (c.isMultiEp && c.epEndIdx !== undefined) {
      assignedEps.add(c.epEndIdx);
    }

    const file = episodeFiles[c.fileIdx];
    const ep = tmdbEpisodes[c.epIdx];

    if (c.isMultiEp && c.epEndIdx !== undefined) {
      const endEp = tmdbEpisodes[c.epEndIdx];
      const combinedRuntime = (ep.runtime ?? 0) + (endEp.runtime ?? 0);
      const match = createBatchMatch({
        classifiedFile: file,
        showId,
        showName,
        showYear,
        season,
        episodeNumber: ep.episode_number,
        episodeNumberEnd: endEp.episode_number,
        episodeTitle: `${ep.name} / ${endEp.name}`,
        runtime: combinedRuntime,
        sequentialPositionMatch: c.sequentialMatch,
        runtimeDiff: c.runtimeDiff,
        customTemplate: template,
        isMultiEpisodeMatch: true,
        singleEpisodeRuntimeMinutes: ep.runtime ?? undefined,
        seasonEpisodeCount: tmdbEpisodes.length,
        seasonEpisodes: seasonEpisodesList,
      });
      matched.push(match);
    } else {
      const match = createBatchMatch({
        classifiedFile: file,
        showId,
        showName,
        showYear,
        season,
        episodeNumber: ep.episode_number,
        episodeTitle: ep.name,
        runtime: ep.runtime ?? undefined,
        sequentialPositionMatch: c.sequentialMatch,
        runtimeDiff: c.runtimeDiff,
        customTemplate: template,
        singleEpisodeRuntimeMinutes: ep.runtime ?? undefined,
        seasonEpisodeCount: tmdbEpisodes.length,
        seasonEpisodes: seasonEpisodesList,
      });
      matched.push(match);
    }

    logger.batch(
      `Set match: ${file.file.fileName} → ` +
      `S${String(season).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}` +
      (c.isMultiEp && c.epEndIdx !== undefined
        ? `-E${String(tmdbEpisodes[c.epEndIdx].episode_number).padStart(2, '0')}`
        : '') +
      ` "${ep.name}" ` +
      `(cost: ${c.cost.toFixed(1)}, runtime±${c.runtimeDiff.toFixed(0)}min, ` +
      `pos: file ${c.fileIdx}/${episodeFiles.length}, ep ${c.epIdx}/${tmdbEpisodes.length})`,
    );
  }

  // ── Assign no-runtime files to remaining episodes by position ───────
  const remainingEps = tmdbEpisodes
    .map((ep, idx) => ({ ep, idx }))
    .filter(({ idx }) => !assignedEps.has(idx))
    .sort((a, b) => a.idx - b.idx);

  let remEpCursor = 0;
  for (const fi of noRuntimeFiles) {
    if (assignedFiles.has(fi)) continue;
    if (remEpCursor >= remainingEps.length) break;

    const { ep } = remainingEps[remEpCursor];
    assignedFiles.add(fi);
    assignedEps.add(remainingEps[remEpCursor].idx);
    remEpCursor++;

    const match = createBatchMatch({
      classifiedFile: episodeFiles[fi],
      showId,
      showName,
      showYear,
      season,
      episodeNumber: ep.episode_number,
      episodeTitle: ep.name,
      runtime: ep.runtime ?? undefined,
      sequentialPositionMatch: true,
      runtimeDiff: undefined,
      customTemplate: template,
      seasonEpisodeCount: tmdbEpisodes.length,
      seasonEpisodes: seasonEpisodesList,
    });
    matched.push(match);
  }

  // ── Enrich set-based matches with DVDCompare runtime data ───────────
  // Files matched via the set-based matcher don't have DVDCompare data yet.
  // Now that we know which TMDb episode each file was assigned to, we can
  // look up the corresponding DVDCompare runtime by title similarity.
  if (dvdCompareDiscs && dvdCompareDiscs.length > 0) {
    const allDvdEpisodes = dvdCompareDiscs.flatMap((d) => d.episodes);

    for (const match of matched) {
      // Skip matches that already have DVDCompare data (from first-pass)
      if (match.dvdCompareRuntimeSeconds !== undefined) continue;
      if (!match.tmdbMatch?.episodeTitle) continue;

      const tmdbTitle = match.tmdbMatch.episodeTitle.toLowerCase().trim();
      let bestSimilarity = 0;
      let bestDvdEp: typeof allDvdEpisodes[0] | null = null;

      for (const dvdEp of allDvdEpisodes) {
        const similarity = normalizedSimilarity(tmdbTitle, dvdEp.title.toLowerCase().trim());
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestDvdEp = dvdEp;
        }
      }

      if (bestDvdEp && bestSimilarity >= DVDCOMPARE_TITLE_SIMILARITY_MIN) {
        match.dvdCompareRuntimeSeconds = bestDvdEp.runtimeSeconds;
        match.dvdCompareTitle = bestDvdEp.title;
        match.matchSource = 'dvdcompare';

        // Recompute confidence with combined TMDb + DVDCompare scoring
        const fileDurationSeconds = match.probeData?.durationSeconds;
        const dvdCompareRuntimeDiffSeconds = fileDurationSeconds !== undefined
          ? Math.abs(fileDurationSeconds - bestDvdEp.runtimeSeconds)
          : undefined;

        const hasSeqMatch = match.confidenceBreakdown?.some(
          (item) => item.label.includes('Sequential position match') && item.points > 0,
        ) ?? false;

        const runtimeDiffMinutes =
          match.probeData?.durationSeconds !== undefined && match.tmdbMatch?.runtime !== undefined
            ? Math.abs(match.probeData.durationSeconds / 60 - match.tmdbMatch.runtime)
            : undefined;

        const isMultiEp = match.tmdbMatch?.episodeNumberEnd !== undefined;

        const breakdown = computeBatchConfidenceBreakdown({
          sequentialPositionMatch: hasSeqMatch,
          runtimeDiffMinutes,
          isMultiEpisodeMatch: isMultiEp,
          singleEpisodeRuntimeMinutes: match.tmdbMatch?.runtime ?? undefined,
          isDvdCompareMatch: true,
          dvdCompareRuntimeDiffSeconds,
        });

        match.confidence = breakdown.total;
        match.confidenceBreakdown = breakdown.items;
        match.status = breakdown.total >= CONFIDENCE_MATCHED_THRESHOLD ? 'matched' : 'ambiguous';

        logger.batch(
          `DVDCompare enrichment: ${match.mediaFile.fileName} → ` +
          `"${bestDvdEp.title}" (${bestDvdEp.runtimeSeconds}s, ` +
          `similarity: ${(bestSimilarity * 100).toFixed(0)}%, ` +
          `confidence: ${breakdown.total}%)`,
        );
      }
    }
  }

  // ── Unassigned files become reclassified extras ─────────────────────
  for (let fi = 0; fi < episodeFiles.length; fi++) {
    if (!assignedFiles.has(fi)) {
      reclassifiedExtras.push(episodeFiles[fi]);
    }
  }

  logger.batch(
    `Season ${season}: ${matched.length} matched, ` +
    `${reclassifiedExtras.length} reclassified as extras ` +
    `(${episodeFiles.length} files, ${tmdbEpisodes.length} TMDb episodes)`,
  );

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

    // Dual threshold: absolute AND relative
    if (bestDiff <= SPECIALS_MAX_DIFF_MINUTES && pctDiff <= SPECIALS_MAX_DIFF_PERCENT) {
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
        seasonEpisodeCount: seasonDetails.episodes.length,
        seasonEpisodes: seasonDetails.episodes.map((ep) => ({
          episodeNumber: ep.episode_number,
          episodeName: ep.name,
          runtime: ep.runtime,
        })),
      };

      const breakdown = computeBatchConfidenceBreakdown({
        sequentialPositionMatch: false,
        runtimeDiffMinutes: bestDiff,
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
        confidence: breakdown.total,
        confidenceBreakdown: breakdown.items,
        newFilename,
        status: breakdown.total >= CONFIDENCE_MATCHED_THRESHOLD ? 'matched' : 'ambiguous',
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

interface CreateBatchMatchParams {
  classifiedFile: ClassifiedFile;
  showId: number;
  showName: string;
  showYear: number | undefined;
  season: number;
  episodeNumber: number;
  episodeNumberEnd?: number;
  episodeTitle: string;
  runtime: number | undefined;
  sequentialPositionMatch: boolean;
  runtimeDiff: number | undefined;
  customTemplate?: string;
  isMultiEpisodeMatch?: boolean;
  singleEpisodeRuntimeMinutes?: number;
  seasonEpisodeCount?: number;
  seasonEpisodes?: Array<{ episodeNumber: number; episodeName: string; runtime: number | null }>;
  isDvdCompareMatch?: boolean;
  dvdCompareRuntimeDiffSeconds?: number;
  dvdCompareTitle?: string;
  dvdCompareRuntimeSeconds?: number;
}

function createBatchMatch(params: CreateBatchMatchParams): MatchResult {
  const {
    classifiedFile, showId, showName, showYear, season,
    episodeNumber, episodeNumberEnd, episodeTitle, runtime,
    sequentialPositionMatch, runtimeDiff, customTemplate,
    isMultiEpisodeMatch, singleEpisodeRuntimeMinutes,
    seasonEpisodeCount, seasonEpisodes,
    isDvdCompareMatch, dvdCompareRuntimeDiffSeconds,
    dvdCompareTitle, dvdCompareRuntimeSeconds,
  } = params;

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
    seasonEpisodeCount,
    seasonEpisodes,
  };

  const breakdown = computeBatchConfidenceBreakdown({
    sequentialPositionMatch,
    runtimeDiffMinutes: runtimeDiff,
    isMultiEpisodeMatch,
    singleEpisodeRuntimeMinutes,
    isDvdCompareMatch,
    dvdCompareRuntimeDiffSeconds,
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
    confidence: breakdown.total,
    confidenceBreakdown: breakdown.items,
    newFilename,
    status: breakdown.total >= CONFIDENCE_MATCHED_THRESHOLD ? 'matched' : 'ambiguous',
    matchSource: isDvdCompareMatch ? 'dvdcompare' : 'tmdb',
    dvdCompareRuntimeSeconds: isDvdCompareMatch ? dvdCompareRuntimeSeconds : undefined,
    dvdCompareTitle: isDvdCompareMatch ? dvdCompareTitle : undefined,
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

/**
 * Detect whether tracks within individual discs are in reverse episode order.
 *
 * MakeMKV extracts titles in physical title-id order, which doesn't always
 * correspond to episode chronological order. This function compares the
 * total runtime cost of the current (forward) track ordering against a
 * reversed ordering for each disc. If reversing a disc's tracks produces
 * a significantly better fit against the positionally expected TMDb
 * episodes, those tracks are reversed in-place.
 *
 * Only discs with 2+ episode files and valid runtime data are evaluated.
 * A disc is reversed when the reverse ordering cost is < 75% of forward cost.
 */
export function detectAndApplyTrackOrder(
  episodeFiles: ClassifiedFile[],
  tmdbEpisodes: TmdbEpisode[],
): void {
  // Group contiguous runs of files by disc number
  interface DiscRun { disc: number; startIdx: number; endIdx: number }
  const discRuns: DiscRun[] = [];

  let currentDisc: number | undefined;
  let runStart = 0;

  for (let i = 0; i < episodeFiles.length; i++) {
    const disc = parseDiscFromPath(episodeFiles[i].file.filePath) ?? 0;
    if (disc !== currentDisc) {
      if (currentDisc !== undefined && i - runStart >= 2) {
        discRuns.push({ disc: currentDisc, startIdx: runStart, endIdx: i - 1 });
      }
      currentDisc = disc;
      runStart = i;
    }
  }
  // Final run
  if (currentDisc !== undefined && episodeFiles.length - runStart >= 2) {
    discRuns.push({ disc: currentDisc, startIdx: runStart, endIdx: episodeFiles.length - 1 });
  }

  if (discRuns.length === 0) return;

  for (const run of discRuns) {
    const count = run.endIdx - run.startIdx + 1;
    // The TMDb episodes these files would positionally map to
    if (run.startIdx + count > tmdbEpisodes.length) continue;

    let forwardCost = 0;
    let reverseCost = 0;
    let hasAllRuntimes = true;

    for (let i = 0; i < count; i++) {
      const fwd = episodeFiles[run.startIdx + i];
      const rev = episodeFiles[run.endIdx - i];
      const ep = tmdbEpisodes[run.startIdx + i];

      const fwdDuration = fwd.probeData?.durationSeconds !== undefined
        ? fwd.probeData.durationSeconds / 60
        : fwd.durationMinutes;
      const revDuration = rev.probeData?.durationSeconds !== undefined
        ? rev.probeData.durationSeconds / 60
        : rev.durationMinutes;
      const epRuntime = ep.runtime;

      if (fwdDuration === undefined || revDuration === undefined ||
          epRuntime === null || epRuntime === undefined) {
        hasAllRuntimes = false;
        break;
      }

      forwardCost += Math.abs(fwdDuration - epRuntime);
      reverseCost += Math.abs(revDuration - epRuntime);
    }

    if (!hasAllRuntimes) continue;

    // Reverse if it's significantly better: < 75% of forward cost (25%+ savings).
    // Also require forward cost to be non-trivial (> 2 min total) to avoid
    // flipping discs that already match well in forward order.
    if (reverseCost < forwardCost * TRACK_REVERSAL_THRESHOLD && forwardCost > TRACK_REVERSAL_MIN_FORWARD_COST) {
      logger.batch(
        `Disc ${run.disc}: reverse track order detected ` +
        `(forward cost: ${forwardCost.toFixed(1)}min, reverse: ${reverseCost.toFixed(1)}min) ` +
        `— reordering ${count} files`,
      );

      // Reverse the files in-place within this disc's range
      const slice = episodeFiles.slice(run.startIdx, run.endIdx + 1).reverse();
      for (let i = 0; i < slice.length; i++) {
        episodeFiles[run.startIdx + i] = slice[i];
      }
    } else {
      logger.batch(
        `Disc ${run.disc}: track order OK ` +
        `(forward cost: ${forwardCost.toFixed(1)}min, reverse: ${reverseCost.toFixed(1)}min)`,
      );
    }
  }
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
