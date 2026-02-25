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
  detectedTrackOrder?: 'forward' | 'reverse';
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

// ── Unified Episode Reference ─────────────────────────────────────────
// Merges TMDb and DVDCompare data into one reference per episode, built
// once before any matching. DVDCompare data augments but never replaces.

export interface UnifiedEpisodeRef {
  tmdbIdx: number;                    // Index into tmdbEpisodes array
  tmdbEpisode: TmdbEpisode;          // TMDb episode data
  tmdbRuntimeMinutes: number | null;  // TMDb runtime in minutes
  dvdCompareTitle?: string;           // DVDCompare title (if matched)
  dvdCompareRuntimeSeconds?: number;  // DVDCompare sub-second runtime
  dvdCompareDiscNumber?: number;      // Which DVDCompare disc this ep is on
}

/**
 * Build a unified episode reference table that merges TMDb episodes with
 * DVDCompare data by title similarity. One ref per TMDb episode.
 */
export function buildUnifiedEpisodeRefs(
  tmdbEpisodes: TmdbEpisode[],
  dvdCompareDiscs?: DvdCompareDisc[],
): UnifiedEpisodeRef[] {
  // Start with one ref per TMDb episode (DVDCompare fields undefined)
  const refs: UnifiedEpisodeRef[] = tmdbEpisodes.map((ep, idx) => ({
    tmdbIdx: idx,
    tmdbEpisode: ep,
    tmdbRuntimeMinutes: ep.runtime,
  }));

  if (!dvdCompareDiscs || dvdCompareDiscs.length === 0) return refs;

  // Flatten DVDCompare episodes in disc order
  const dvdFlat: Array<{ title: string; runtimeSeconds: number; discNumber: number }> = [];
  for (const disc of [...dvdCompareDiscs].sort((a, b) => a.discNumber - b.discNumber)) {
    for (const ep of disc.episodes) {
      dvdFlat.push({ title: ep.title, runtimeSeconds: ep.runtimeSeconds, discNumber: disc.discNumber });
    }
  }

  // Map each DVDCompare episode to its best TMDb match by title
  const usedTmdbIndices = new Set<number>();
  for (const dvdEp of dvdFlat) {
    const result = findTmdbEpisodeByTitle(tmdbEpisodes, dvdEp.title, usedTmdbIndices);
    if (result) {
      const ref = refs[result.idx];
      ref.dvdCompareTitle = dvdEp.title;
      ref.dvdCompareRuntimeSeconds = dvdEp.runtimeSeconds;
      ref.dvdCompareDiscNumber = dvdEp.discNumber;
      usedTmdbIndices.add(result.idx);
    }
  }

  const enrichedCount = refs.filter((r) => r.dvdCompareRuntimeSeconds !== undefined).length;
  if (enrichedCount > 0) {
    logger.batch(`Unified refs: ${enrichedCount}/${refs.length} episodes have DVDCompare data`);
  }

  return refs;
}

/**
 * Match episode files to TMDb season episodes using a unified set-based
 * assignment with combined TMDb + DVDCompare data.
 *
 * DVDCompare data (when available) augments the matching cost function by
 * providing sub-second runtime precision. It never forks or replaces the
 * TMDb-based matching — both data sources feed into one candidate scoring
 * system. Whichever source produces a closer runtime match wins.
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
  trackOrderHint?: 'forward' | 'reverse',
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

  // ── Step 1: Build unified episode reference table ───────────────────
  const unifiedRefs = buildUnifiedEpisodeRefs(tmdbEpisodes, dvdCompareDiscs);

  // ── Step 2: Compute disc episode ranges ─────────────────────────────
  // Physical disc media contains sequential episode sets. Disc 1 holds the
  // first N episodes, Disc 2 the next M, etc. Compute which TMDb episode
  // indices each disc should cover based on the number of episode files per
  // disc. This prevents cross-disc mismatches when runtimes are similar.
  const discEpRanges = new Map<number, { startEp: number; endEp: number }>();

  {
    // TMDb is canonical for episode counts, names, and order. The number
    // of episode-classified files per disc partitions TMDb's episode list
    // across physical discs. DVDCompare augments with sub-second runtimes
    // for matching cost but does not determine episode counts per disc.
    const discEpCounts = new Map<number, number>();
    for (const file of episodeFiles) {
      const disc = parseDiscFromPath(file.file.filePath) ?? 0;
      discEpCounts.set(disc, (discEpCounts.get(disc) ?? 0) + 1);
    }

    const sortedDiscs = [...discEpCounts.entries()].sort((a, b) => a[0] - b[0]);
    let epCursor = 0;
    for (let di = 0; di < sortedDiscs.length; di++) {
      const [disc, epCount] = sortedDiscs[di];
      const isLastDisc = di === sortedDiscs.length - 1;
      const startEp = epCursor;
      // Last disc extends to cover all remaining episodes (handles multi-ep
      // files that consume more TMDb episodes than there are files)
      const endEp = isLastDisc
        ? tmdbEpisodes.length - 1
        : Math.min(epCursor + epCount - 1, tmdbEpisodes.length - 1);
      if (startEp < tmdbEpisodes.length) {
        discEpRanges.set(disc, { startEp, endEp });
      }
      epCursor += epCount;
    }

    if (discEpRanges.size > 1) {
      logger.batch(
        `Disc episode ranges: ${[...discEpRanges.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([disc, r]) => `D${disc}\u2192eps[${r.startEp}..${r.endEp}]`)
          .join(', ')}`,
      );
    }
  }

  // ── Step 3: Detect and fix reverse track order (global decision) ────
  // MakeMKV may extract titles in reverse episode order. Compare forward
  // vs reverse runtime cost across ALL discs using unified refs (preferring
  // DVDCompare seconds when available for sub-minute precision). The
  // decision is global — a physical release is mastered one way.
  // When a hint is provided from a previously-matched season, it biases
  // the decision so that same-release seasons use the same track order.
  const detectedTrackOrder = detectAndApplyTrackOrder(episodeFiles, unifiedRefs, discEpRanges, trackOrderHint);

  const assignedFiles = new Set<number>();
  const assignedEps = new Set<number>();

  // ── Step 4: Unified candidate generation & assignment ───────────────
  // Single cost function using the best available runtime data from the
  // unified ref (DVDCompare sub-second or TMDb minute-level).

  interface UnifiedCandidate {
    fileIdx: number;
    epIdx: number;
    cost: number;
    runtimeDiffMinutes: number;
    dvdCompareRuntimeDiffSeconds?: number;
    isMultiEp: boolean;
    epEndIdx?: number;
    positionalDiff: number;
  }

  const candidates: UnifiedCandidate[] = [];
  const maxFilePos = Math.max(1, episodeFiles.length - 1);
  const maxEpPos = Math.max(1, tmdbEpisodes.length - 1);

  // Positional weight: how many "minutes of cost" a full-season positional
  // displacement is equivalent to. A value of 40 means that matching a file
  // at position 0 to the last episode costs an extra 40 minutes.
  const POSITIONAL_WEIGHT = 40;

  for (let fi = 0; fi < episodeFiles.length; fi++) {
    const file = episodeFiles[fi];
    // Use exact seconds-to-minutes for precise cost calculation.
    const fileDurationMin = file.probeData?.durationSeconds !== undefined
      ? file.probeData.durationSeconds / 60
      : file.durationMinutes;
    if (fileDurationMin === undefined) continue;

    const fileDurationSec = file.probeData?.durationSeconds;
    const filePos = fi / maxFilePos; // 0..1

    // Disc range constraint: only consider episodes in this file's disc range
    const fileDiscNum = parseDiscFromPath(file.file.filePath);
    const fileRange = fileDiscNum !== undefined ? discEpRanges.get(fileDiscNum) : undefined;

    for (let ei = 0; ei < unifiedRefs.length; ei++) {
      const ref = unifiedRefs[ei];
      const ep = ref.tmdbEpisode;
      const epRuntimeMin = ref.tmdbRuntimeMinutes;
      if (epRuntimeMin === null || epRuntimeMin === undefined) continue;

      // Skip episodes outside this disc's allocated range
      if (fileRange && (ei < fileRange.startEp || ei > fileRange.endEp)) continue;

      const epPos = ei / maxEpPos; // 0..1
      const posDiff = Math.abs(filePos - epPos);

      // ── Compute runtime cost using best available data ────────────
      // When DVDCompare sub-second data is available AND we have probe
      // seconds, use whichever source gives the better match.
      const tmdbDiffMin = Math.abs(fileDurationMin - epRuntimeMin);
      let runtimeCostMin = tmdbDiffMin;
      let dvdDiffSec: number | undefined;

      if (ref.dvdCompareRuntimeSeconds !== undefined && fileDurationSec !== undefined) {
        dvdDiffSec = Math.abs(fileDurationSec - ref.dvdCompareRuntimeSeconds);
        const dvdDiffMin = dvdDiffSec / 60;
        runtimeCostMin = Math.min(dvdDiffMin, tmdbDiffMin);
      }

      // ── Single-episode match ──────────────────────────────────────
      // Guard: if the file is clearly multi-episode length (>1.7x TMDb
      // runtime), don't create a single-ep candidate even if DVDCompare
      // runtime matches. This handles cases like "Encounter at Farpoint"
      // where DVDCompare lists the combined runtime but TMDb splits it.
      const isObviousMultiEp = fileDurationMin > epRuntimeMin * MULTI_EPISODE_RUNTIME_MULTIPLIER;
      if (runtimeCostMin <= 10 && !isObviousMultiEp) {
        const cost = runtimeCostMin + posDiff * POSITIONAL_WEIGHT;
        candidates.push({
          fileIdx: fi,
          epIdx: ei,
          cost,
          runtimeDiffMinutes: tmdbDiffMin,
          dvdCompareRuntimeDiffSeconds: dvdDiffSec,
          isMultiEp: false,
          positionalDiff: posDiff,
        });
      }

      // ── Multi-episode match (file spans this episode + next) ──────
      if (
        ei + 1 < unifiedRefs.length &&
        fileDurationMin > epRuntimeMin * MULTI_EPISODE_RUNTIME_MULTIPLIER
      ) {
        const nextRef = unifiedRefs[ei + 1];
        const nextRuntimeMin = nextRef.tmdbRuntimeMinutes;
        if (nextRuntimeMin !== null && nextRuntimeMin !== undefined) {
          const combinedRuntimeMin = epRuntimeMin + nextRuntimeMin;
          const combinedDiffMin = Math.abs(fileDurationMin - combinedRuntimeMin);

          // Also check DVDCompare combined runtime when available
          let combinedDvdDiffSec: number | undefined;
          if (
            ref.dvdCompareRuntimeSeconds !== undefined &&
            nextRef.dvdCompareRuntimeSeconds !== undefined &&
            fileDurationSec !== undefined
          ) {
            const combinedDvdSec = ref.dvdCompareRuntimeSeconds + nextRef.dvdCompareRuntimeSeconds;
            combinedDvdDiffSec = Math.abs(fileDurationSec - combinedDvdSec);
          }

          const combinedCostMin = combinedDvdDiffSec !== undefined
            ? Math.min(combinedDvdDiffSec / 60, combinedDiffMin)
            : combinedDiffMin;

          if (combinedCostMin <= MULTI_EPISODE_COMBINED_TOLERANCE_MIN) {
            // Small penalty for multi-ep to prefer single-ep when close
            const cost = combinedCostMin + posDiff * POSITIONAL_WEIGHT + 3;
            candidates.push({
              fileIdx: fi,
              epIdx: ei,
              cost,
              runtimeDiffMinutes: combinedDiffMin,
              dvdCompareRuntimeDiffSeconds: combinedDvdDiffSec,
              isMultiEp: true,
              epEndIdx: ei + 1,
              positionalDiff: posDiff,
            });
          }
        }
      }
    }
  }

  // ── Handle files with no runtime data (position-only matching) ──────
  const noRuntimeFiles: number[] = [];
  for (let fi = 0; fi < episodeFiles.length; fi++) {
    if (episodeFiles[fi].durationMinutes === undefined) {
      noRuntimeFiles.push(fi);
    }
  }

  // ── Greedy assignment: pick lowest-cost pairing, assign, repeat ─────
  // Tiebreaker: when costs are very close (within 0.01 min), prefer the
  // candidate with smaller positional difference. This ensures that when
  // runtimes are similar (common for episodes of the same show), the
  // detected track order is respected rather than jumbling by tiny
  // DVDCompare runtime deltas.
  candidates.sort((a, b) => {
    const costDiff = a.cost - b.cost;
    if (Math.abs(costDiff) > 0.01) return costDiff;
    return a.positionalDiff - b.positionalDiff;
  });

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
    const ref = unifiedRefs[c.epIdx];
    const ep = ref.tmdbEpisode;

    // Determine if DVDCompare was the winning runtime source for this match
    const usedDvdCompare = ref.dvdCompareRuntimeSeconds !== undefined &&
      c.dvdCompareRuntimeDiffSeconds !== undefined &&
      (c.dvdCompareRuntimeDiffSeconds / 60) <= c.runtimeDiffMinutes;

    if (c.isMultiEp && c.epEndIdx !== undefined) {
      const endRef = unifiedRefs[c.epEndIdx];
      const endEp = endRef.tmdbEpisode;
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
        positionalDiff: c.positionalDiff,
        runtimeDiff: c.runtimeDiffMinutes,
        customTemplate: template,
        isMultiEpisodeMatch: true,
        singleEpisodeRuntimeMinutes: ep.runtime ?? undefined,
        seasonEpisodeCount: tmdbEpisodes.length,
        seasonEpisodes: seasonEpisodesList,
        isDvdCompareMatch: usedDvdCompare,
        dvdCompareRuntimeDiffSeconds: c.dvdCompareRuntimeDiffSeconds,
        dvdCompareTitle: ref.dvdCompareTitle,
        dvdCompareRuntimeSeconds: ref.dvdCompareRuntimeSeconds,
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
        positionalDiff: c.positionalDiff,
        runtimeDiff: c.runtimeDiffMinutes,
        customTemplate: template,
        singleEpisodeRuntimeMinutes: ep.runtime ?? undefined,
        seasonEpisodeCount: tmdbEpisodes.length,
        seasonEpisodes: seasonEpisodesList,
        isDvdCompareMatch: usedDvdCompare,
        dvdCompareRuntimeDiffSeconds: c.dvdCompareRuntimeDiffSeconds,
        dvdCompareTitle: ref.dvdCompareTitle,
        dvdCompareRuntimeSeconds: ref.dvdCompareRuntimeSeconds,
      });
      matched.push(match);
    }

    const sourceLabel = usedDvdCompare
      ? `dvd\u00b1${c.dvdCompareRuntimeDiffSeconds!.toFixed(1)}s`
      : `tmdb\u00b1${c.runtimeDiffMinutes.toFixed(1)}min`;
    logger.batch(
      `Unified match: ${file.file.fileName} \u2192 ` +
      `S${String(season).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}` +
      (c.isMultiEp && c.epEndIdx !== undefined
        ? `-E${String(unifiedRefs[c.epEndIdx].tmdbEpisode.episode_number).padStart(2, '0')}`
        : '') +
      ` "${ep.name}" ` +
      `(cost: ${c.cost.toFixed(1)}, ${sourceLabel}, ` +
      `pos: file ${c.fileIdx}/${episodeFiles.length}, ep ${c.epIdx}/${unifiedRefs.length})`,
    );
  }

  // ── Post-assignment: enforce sequential episode ordering per disc ────
  // Physical media stores episodes in order on each disc. When file
  // runtimes are nearly identical, the greedy matcher may assign episodes
  // out of positional order within a disc. Fix by sorting episode numbers
  // per disc and rebuilding affected matches.
  //
  // GUARD: Only enforce when sequential ordering doesn't significantly
  // degrade runtime match quality. If the runtime-driven assignment is
  // clearly better (e.g., John Adams D3 where D1/D2 are reverse but D3
  // is forward), keep the greedy assignment as-is.
  {
    const discMatchGroups = new Map<number, number[]>(); // disc → matched array indices
    for (let mi = 0; mi < matched.length; mi++) {
      const m = matched[mi];
      const disc = parseDiscFromPath(m.mediaFile.filePath);
      if (disc === undefined) continue;
      // Skip multi-episode matches (complex to reorder, rare)
      if (m.parsed.episodeNumbers && m.parsed.episodeNumbers.length > 1) continue;
      const group = discMatchGroups.get(disc) ?? [];
      group.push(mi);
      discMatchGroups.set(disc, group);
    }

    for (const [disc, matchIndices] of discMatchGroups) {
      if (matchIndices.length < 2) continue;

      // Sort match indices by file position in episodeFiles (already in
      // correct order after track reversal)
      matchIndices.sort((a, b) => {
        const aIdx = episodeFiles.findIndex(ef => ef.file.filePath === matched[a].mediaFile.filePath);
        const bIdx = episodeFiles.findIndex(ef => ef.file.filePath === matched[b].mediaFile.filePath);
        return aIdx - bIdx;
      });

      // Check if episode numbers are monotonically increasing
      const epNums = matchIndices.map(mi => matched[mi].tmdbMatch?.episodeNumber ?? 0);
      let needsFix = false;
      for (let i = 1; i < epNums.length; i++) {
        if (epNums[i] < epNums[i - 1]) { needsFix = true; break; }
      }

      if (needsFix) {
        const sortedEpNums = [...epNums].sort((a, b) => a - b);

        // Compute total runtime cost for current vs sequential ordering.
        // Only enforce when sequential ordering doesn't significantly
        // worsen match quality (max 2 minute total degradation allowed).
        let currentCost = 0;
        let sequentialCost = 0;
        let canCompute = true;

        for (let i = 0; i < matchIndices.length; i++) {
          const mi = matchIndices[i];
          const cf = episodeFiles.find(ef => ef.file.filePath === matched[mi].mediaFile.filePath);
          if (!cf) { canCompute = false; break; }

          const fileDurMin = cf.probeData?.durationSeconds !== undefined
            ? cf.probeData.durationSeconds / 60 : cf.durationMinutes;
          if (fileDurMin === undefined) { canCompute = false; break; }

          const curEp = tmdbEpisodes.find(ep => ep.episode_number === epNums[i]);
          const seqEp = tmdbEpisodes.find(ep => ep.episode_number === sortedEpNums[i]);
          currentCost += Math.abs(fileDurMin - (curEp?.runtime ?? 0));
          sequentialCost += Math.abs(fileDurMin - (seqEp?.runtime ?? 0));
        }

        if (!canCompute || sequentialCost > currentCost + 2) {
          logger.batch(
            `Disc ${disc}: non-sequential ordering kept — sequential would degrade matches ` +
            `(current: ${currentCost.toFixed(1)}min, sequential: ${sequentialCost.toFixed(1)}min)`,
          );
        } else {
          logger.batch(
            `Disc ${disc}: fixing non-sequential episode order ` +
            `(${epNums.join(',')} \u2192 ${sortedEpNums.join(',')})`,
          );

          for (let i = 0; i < matchIndices.length; i++) {
            const mi = matchIndices[i];
            const m = matched[mi];
            const newEpNum = sortedEpNums[i];
            if (m.tmdbMatch?.episodeNumber === newEpNum) continue;

            const newEp = tmdbEpisodes.find(ep => ep.episode_number === newEpNum);
            const newRef = unifiedRefs.find(r => r.tmdbEpisode.episode_number === newEpNum);
            const cf = episodeFiles.find(ef => ef.file.filePath === m.mediaFile.filePath);
            if (!newEp || !newRef || !cf) continue;

            const fileDurMin = cf.probeData?.durationSeconds !== undefined
              ? cf.probeData.durationSeconds / 60 : cf.durationMinutes;
            const tmdbDiffMin = fileDurMin !== undefined && newEp.runtime !== null
              ? Math.abs(fileDurMin - (newEp.runtime ?? 0)) : undefined;

            let dvdDiffSec: number | undefined;
            if (newRef.dvdCompareRuntimeSeconds !== undefined && cf.probeData?.durationSeconds !== undefined) {
              dvdDiffSec = Math.abs(cf.probeData.durationSeconds - newRef.dvdCompareRuntimeSeconds);
            }

            const usedDvd = newRef.dvdCompareRuntimeSeconds !== undefined &&
              dvdDiffSec !== undefined && tmdbDiffMin !== undefined &&
              (dvdDiffSec / 60) <= tmdbDiffMin;

            const fi = episodeFiles.indexOf(cf);
            const ei = newRef.tmdbIdx;
            const posDiff = Math.abs(
              fi / Math.max(1, episodeFiles.length - 1) -
              ei / Math.max(1, tmdbEpisodes.length - 1),
            );

            matched[mi] = createBatchMatch({
              classifiedFile: cf,
              showId,
              showName,
              showYear,
              season,
              episodeNumber: newEp.episode_number,
              episodeTitle: newEp.name,
              runtime: newEp.runtime ?? undefined,
              positionalDiff: posDiff,
              runtimeDiff: tmdbDiffMin,
              customTemplate: template,
              singleEpisodeRuntimeMinutes: newEp.runtime ?? undefined,
              seasonEpisodeCount: tmdbEpisodes.length,
              seasonEpisodes: seasonEpisodesList,
              isDvdCompareMatch: usedDvd,
              dvdCompareRuntimeDiffSeconds: dvdDiffSec,
              dvdCompareTitle: newRef.dvdCompareTitle,
              dvdCompareRuntimeSeconds: newRef.dvdCompareRuntimeSeconds,
            });
          }
        }
      }
    }
  }

  // ── Assign no-runtime files to remaining episodes by position ───────
  const remainingEps = unifiedRefs
    .filter(({ tmdbIdx }) => !assignedEps.has(tmdbIdx))
    .sort((a, b) => a.tmdbIdx - b.tmdbIdx);

  let remEpCursor = 0;
  for (const fi of noRuntimeFiles) {
    if (assignedFiles.has(fi)) continue;

    // Disc range constraint for no-runtime files
    const noRtDisc = parseDiscFromPath(episodeFiles[fi].file.filePath);
    const noRtRange = noRtDisc !== undefined ? discEpRanges.get(noRtDisc) : undefined;

    // Find next remaining episode respecting disc range
    while (remEpCursor < remainingEps.length) {
      const candidateIdx = remainingEps[remEpCursor].tmdbIdx;
      if (noRtRange && (candidateIdx < noRtRange.startEp || candidateIdx > noRtRange.endEp)) {
        remEpCursor++;
        continue;
      }
      break;
    }
    if (remEpCursor >= remainingEps.length) break;

    const ref = remainingEps[remEpCursor];
    const ep = ref.tmdbEpisode;
    assignedFiles.add(fi);
    assignedEps.add(ref.tmdbIdx);
    remEpCursor++;

    const noRtFilePos = fi / Math.max(1, episodeFiles.length - 1);
    const noRtEpPos = ref.tmdbIdx / Math.max(1, tmdbEpisodes.length - 1);
    const noRtPosDiff = Math.abs(noRtFilePos - noRtEpPos);

    const match = createBatchMatch({
      classifiedFile: episodeFiles[fi],
      showId,
      showName,
      showYear,
      season,
      episodeNumber: ep.episode_number,
      episodeTitle: ep.name,
      runtime: ep.runtime ?? undefined,
      positionalDiff: noRtPosDiff,
      runtimeDiff: undefined,
      customTemplate: template,
      seasonEpisodeCount: tmdbEpisodes.length,
      seasonEpisodes: seasonEpisodesList,
      dvdCompareTitle: ref.dvdCompareTitle,
      dvdCompareRuntimeSeconds: ref.dvdCompareRuntimeSeconds,
    });
    matched.push(match);
  }

  // ── Fallback: fill remaining episode slots before sending to extras ──
  // Files may have failed candidate generation due to disc range constraints
  // or the runtimeCost > 10 guard. If they have reasonable episode-length
  // runtimes AND there are still unfilled TMDb episode slots within the same
  // disc range, match by position rather than relegating to the specials pool.
  {
    const unassignedFileIndices: number[] = [];
    for (let fi = 0; fi < episodeFiles.length; fi++) {
      if (!assignedFiles.has(fi)) unassignedFileIndices.push(fi);
    }

    if (unassignedFileIndices.length > 0) {
      // Compute median episode runtime for sanity check
      const epRuntimes = tmdbEpisodes
        .filter(ep => ep.runtime !== null && ep.runtime !== undefined && ep.runtime > 0)
        .map(ep => ep.runtime!);
      const sortedRuntimes = [...epRuntimes].sort((a, b) => a - b);
      const medianRuntime = sortedRuntimes.length > 0
        ? sortedRuntimes[Math.floor(sortedRuntimes.length / 2)]
        : undefined;

      for (const fi of unassignedFileIndices) {
        const file = episodeFiles[fi];
        const fileDurationMin = file.probeData?.durationSeconds !== undefined
          ? file.probeData.durationSeconds / 60
          : file.durationMinutes;

        // Sanity check: file runtime should be within the same classification
        // thresholds used to classify it as an episode in the first place
        if (fileDurationMin !== undefined && medianRuntime !== undefined) {
          if (fileDurationMin < medianRuntime * EPISODE_MIN_RUNTIME_RATIO ||
            fileDurationMin > medianRuntime * EPISODE_MAX_RUNTIME_RATIO) {
            continue; // Runtime too far off — truly an extra
          }
        }

        // Disc range constraint: only match to episodes within this file's disc
        const fbDiscNum = parseDiscFromPath(file.file.filePath);
        const fbRange = fbDiscNum !== undefined ? discEpRanges.get(fbDiscNum) : undefined;

        // Find the first unassigned episode within this file's disc range
        let bestRef: UnifiedEpisodeRef | undefined;
        for (const ref of unifiedRefs) {
          if (assignedEps.has(ref.tmdbIdx)) continue;
          if (fbRange && (ref.tmdbIdx < fbRange.startEp || ref.tmdbIdx > fbRange.endEp)) continue;
          bestRef = ref;
          break;
        }
        if (!bestRef) continue;

        const ref = bestRef;
        const ep = ref.tmdbEpisode;

        assignedFiles.add(fi);
        assignedEps.add(ref.tmdbIdx);

        const fbFilePos = fi / Math.max(1, episodeFiles.length - 1);
        const fbEpPos = ref.tmdbIdx / Math.max(1, tmdbEpisodes.length - 1);
        const fbPosDiff = Math.abs(fbFilePos - fbEpPos);

        const fbRuntimeDiff = fileDurationMin !== undefined && ep.runtime !== null
          ? Math.abs(fileDurationMin - (ep.runtime ?? 0)) : undefined;

        let fbDvdDiffSec: number | undefined;
        if (ref.dvdCompareRuntimeSeconds !== undefined && file.probeData?.durationSeconds !== undefined) {
          fbDvdDiffSec = Math.abs(file.probeData.durationSeconds - ref.dvdCompareRuntimeSeconds);
        }

        const fbUsedDvd = ref.dvdCompareRuntimeSeconds !== undefined &&
          fbDvdDiffSec !== undefined && fbRuntimeDiff !== undefined &&
          (fbDvdDiffSec / 60) <= fbRuntimeDiff;

        const match = createBatchMatch({
          classifiedFile: file,
          showId,
          showName,
          showYear,
          season,
          episodeNumber: ep.episode_number,
          episodeTitle: ep.name,
          runtime: ep.runtime ?? undefined,
          positionalDiff: fbPosDiff,
          runtimeDiff: fbRuntimeDiff,
          customTemplate: template,
          singleEpisodeRuntimeMinutes: ep.runtime ?? undefined,
          seasonEpisodeCount: tmdbEpisodes.length,
          seasonEpisodes: seasonEpisodesList,
          isDvdCompareMatch: fbUsedDvd,
          dvdCompareRuntimeDiffSeconds: fbDvdDiffSec,
          dvdCompareTitle: ref.dvdCompareTitle,
          dvdCompareRuntimeSeconds: ref.dvdCompareRuntimeSeconds,
        });
        matched.push(match);

        logger.batch(
          `Fallback match: ${file.file.fileName} → ` +
          `S${String(season).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}` +
          ` "${ep.name}" (positional, disc-constrained fallback)`,
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

  return { matched, reclassifiedExtras, detectedTrackOrder };
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
        positionalDiff: 1.0, // Specials have no meaningful positional ordering
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
        `Special match: ${candidate.file.fileName} \u2192 ` +
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
  positionalDiff: number;
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
    positionalDiff, runtimeDiff, customTemplate,
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
    positionalDiff,
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
    dvdCompareRuntimeSeconds,
    dvdCompareTitle,
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
 * Detect whether tracks within discs are in reverse episode order and fix.
 *
 * Uses unified episode refs (with DVDCompare sub-second runtimes when
 * available) and disc episode ranges to accurately compare forward vs
 * reverse ordering. The decision is GLOBAL: all discs are summed together
 * because a physical media release is mastered one way.
 *
 * When a `trackOrderHint` is provided (from a previously-matched season of
 * the same show), the hint is followed unless the current season's evidence
 * STRONGLY contradicts it. This prevents per-season detection noise from
 * overriding a decision that was clear in an earlier season.
 *
 * Only discs with 2+ episode files and valid runtime data are evaluated.
 * Tracks are reversed when the reverse ordering cost is < 75% of forward.
 *
 * Returns the detected track order ('forward' or 'reverse') so the caller
 * can propagate it to subsequent seasons.
 */
export function detectAndApplyTrackOrder(
  episodeFiles: ClassifiedFile[],
  unifiedRefs: UnifiedEpisodeRef[],
  discEpRanges: Map<number, { startEp: number; endEp: number }>,
  trackOrderHint?: 'forward' | 'reverse',
): 'forward' | 'reverse' {
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

  if (discRuns.length === 0) return trackOrderHint ?? 'forward';

  // Sum forward and reverse cost GLOBALLY across all discs.
  // Use disc episode ranges to pick the correct unified ref for each slot.
  let totalForwardCost = 0;
  let totalReverseCost = 0;
  let hasValidDisc = false;

  for (const run of discRuns) {
    const count = run.endIdx - run.startIdx + 1;

    // Get the episode range for this disc
    const range = discEpRanges.get(run.disc);
    if (!range) continue;

    // Only evaluate positions where we have unified refs
    const availableEps = Math.min(count, range.endEp - range.startEp + 1);
    if (availableEps < 2) continue;

    let discForward = 0;
    let discReverse = 0;
    let hasAllRuntimes = true;

    for (let i = 0; i < availableEps; i++) {
      const fwd = episodeFiles[run.startIdx + i];
      const rev = episodeFiles[run.endIdx - i];
      const refIdx = range.startEp + i;
      if (refIdx >= unifiedRefs.length) { hasAllRuntimes = false; break; }
      const ref = unifiedRefs[refIdx];

      const fwdDurationMin = fwd.probeData?.durationSeconds !== undefined
        ? fwd.probeData.durationSeconds / 60
        : fwd.durationMinutes;
      const revDurationMin = rev.probeData?.durationSeconds !== undefined
        ? rev.probeData.durationSeconds / 60
        : rev.durationMinutes;

      // Use DVDCompare sub-second runtime when available, TMDb minutes otherwise
      let epRuntimeMin: number | undefined;
      if (ref.dvdCompareRuntimeSeconds !== undefined) {
        epRuntimeMin = ref.dvdCompareRuntimeSeconds / 60;
      } else if (ref.tmdbRuntimeMinutes !== null && ref.tmdbRuntimeMinutes !== undefined) {
        epRuntimeMin = ref.tmdbRuntimeMinutes;
      }

      if (fwdDurationMin === undefined || revDurationMin === undefined || epRuntimeMin === undefined) {
        hasAllRuntimes = false;
        break;
      }

      discForward += Math.abs(fwdDurationMin - epRuntimeMin);
      discReverse += Math.abs(revDurationMin - epRuntimeMin);
    }

    if (!hasAllRuntimes) continue;

    totalForwardCost += discForward;
    totalReverseCost += discReverse;
    hasValidDisc = true;

    logger.batch(
      `Disc ${run.disc}: forward cost: ${discForward.toFixed(1)}min, reverse: ${discReverse.toFixed(1)}min`,
    );
  }

  // ── Correlation-based detection (DVDCompare sub-second precision) ────
  // When absolute costs are too similar to distinguish forward from reverse
  // (common with uniform-runtime shows like TNG where all episodes are ~46min
  // and Blu-ray overhead is a constant ~2min per file), use the PATTERN of
  // runtime variation instead. DVDCompare provides sub-second precision
  // (e.g., 45:24 vs 45:44), and file probes provide sub-second precision
  // (e.g., 47:32 vs 47:53). A file that's slightly longer should match an
  // episode that's slightly longer. The covariance between file runtimes
  // and DVDCompare runtimes will be higher in the correct ordering.
  let totalForwardCorr = 0;
  let totalReverseCorr = 0;
  let hasCorrelationData = false;

  for (const run of discRuns) {
    const count = run.endIdx - run.startIdx + 1;
    const range = discEpRanges.get(run.disc);
    if (!range) continue;

    const availableEps = Math.min(count, range.endEp - range.startEp + 1);
    if (availableEps < 3) continue; // Need 3+ data points for meaningful correlation

    // Collect DVDCompare sub-second runtimes and file probe runtimes (seconds)
    const dvdRuntimes: number[] = [];
    const fwdFileRuntimes: number[] = [];
    const revFileRuntimes: number[] = [];
    let allHaveDvdData = true;

    for (let i = 0; i < availableEps; i++) {
      const refIdx = range.startEp + i;
      if (refIdx >= unifiedRefs.length) { allHaveDvdData = false; break; }
      const ref = unifiedRefs[refIdx];
      if (ref.dvdCompareRuntimeSeconds === undefined) { allHaveDvdData = false; break; }

      const fwd = episodeFiles[run.startIdx + i];
      const rev = episodeFiles[run.endIdx - i];
      const fwdSec = fwd.probeData?.durationSeconds;
      const revSec = rev.probeData?.durationSeconds;
      if (fwdSec === undefined || revSec === undefined) { allHaveDvdData = false; break; }

      dvdRuntimes.push(ref.dvdCompareRuntimeSeconds);
      fwdFileRuntimes.push(fwdSec);
      revFileRuntimes.push(revSec);
    }

    if (!allHaveDvdData || dvdRuntimes.length < 3) continue;

    // Compute covariance for forward and reverse pairings.
    // Higher covariance = runtime variation patterns align better.
    const dvdMean = dvdRuntimes.reduce((a, b) => a + b, 0) / dvdRuntimes.length;
    const fwdMean = fwdFileRuntimes.reduce((a, b) => a + b, 0) / fwdFileRuntimes.length;
    const revMean = revFileRuntimes.reduce((a, b) => a + b, 0) / revFileRuntimes.length;

    let discFwdCorr = 0;
    let discRevCorr = 0;
    for (let i = 0; i < dvdRuntimes.length; i++) {
      const dvdDev = dvdRuntimes[i] - dvdMean;
      discFwdCorr += (fwdFileRuntimes[i] - fwdMean) * dvdDev;
      discRevCorr += (revFileRuntimes[i] - revMean) * dvdDev;
    }

    totalForwardCorr += discFwdCorr;
    totalReverseCorr += discRevCorr;
    hasCorrelationData = true;

    logger.batch(
      `Disc ${run.disc}: forward corr: ${discFwdCorr.toFixed(1)}, reverse corr: ${discRevCorr.toFixed(1)}`,
    );
  }

  if (hasCorrelationData) {
    logger.batch(
      `Correlation totals: forward=${totalForwardCorr.toFixed(1)}, reverse=${totalReverseCorr.toFixed(1)}`,
    );
  }

  if (!hasValidDisc && !hasCorrelationData) return trackOrderHint ?? 'forward';

  // Global decision: reverse if significantly better.
  // Three signals are used in priority order:
  //   1. Absolute cost difference (when costs clearly differ)
  //   2. Runtime correlation (when DVDCompare sub-second data shows a clear pattern)
  //   3. Cross-season hint (from a previously-matched season)
  //
  // When a hint is provided from a previous season, follow it unless the
  // current season STRONGLY contradicts it (forward < 50% of reverse).
  let shouldReverse: boolean;
  let detectionMethod = 'cost';

  // Helper: check if absolute costs clearly distinguish the ordering.
  // Returns true if costs are "ambiguous" (too close to call).
  // Costs are ambiguous when BOTH directions are within the threshold of each
  // other — i.e., neither clearly wins. The previous one-sided check
  // (reverse >= forward * 0.75) would flag forward=10/reverse=50 as ambiguous
  // even though forward is 5x better. The symmetric version requires BOTH to
  // be within the threshold factor of the other.
  const costsAreAmbiguous = !hasValidDisc ||
    (totalForwardCost <= TRACK_REVERSAL_MIN_FORWARD_COST && totalReverseCost <= TRACK_REVERSAL_MIN_FORWARD_COST) ||
    (totalReverseCost >= totalForwardCost * TRACK_REVERSAL_THRESHOLD &&
      totalForwardCost >= totalReverseCost * TRACK_REVERSAL_THRESHOLD);

  if (trackOrderHint === 'reverse') {
    // Hint says reverse — follow it unless forward is dramatically better
    const forwardStronglyBetter = hasValidDisc &&
      totalForwardCost < totalReverseCost * 0.5 &&
      totalReverseCost > TRACK_REVERSAL_MIN_FORWARD_COST;
    shouldReverse = !forwardStronglyBetter;
    detectionMethod = 'hint';
  } else if (trackOrderHint === 'forward') {
    // Hint says forward — follow it unless reverse is dramatically better
    const reverseStronglyBetter = hasValidDisc &&
      totalReverseCost < totalForwardCost * 0.5 &&
      totalForwardCost > TRACK_REVERSAL_MIN_FORWARD_COST;
    shouldReverse = reverseStronglyBetter;
    detectionMethod = 'hint';
  } else if (hasValidDisc &&
    totalReverseCost < totalForwardCost * TRACK_REVERSAL_THRESHOLD &&
    totalForwardCost > TRACK_REVERSAL_MIN_FORWARD_COST) {
    // No hint — absolute costs clearly favor reverse
    shouldReverse = true;
    detectionMethod = 'cost';
  } else if (hasCorrelationData && costsAreAmbiguous) {
    // No hint, costs are ambiguous — use correlation as tiebreaker.
    // The max correlation must exceed a minimum signal threshold to avoid
    // acting on noise from discs with nearly identical runtimes.
    const maxCorr = Math.max(totalForwardCorr, totalReverseCorr);
    if (maxCorr > 10) {
      shouldReverse = totalReverseCorr > totalForwardCorr;
      detectionMethod = 'correlation';
    } else {
      shouldReverse = false;
      detectionMethod = 'default (weak correlation)';
    }
  } else {
    shouldReverse = false;
    detectionMethod = 'default';
  }

  const decision: 'forward' | 'reverse' = shouldReverse ? 'reverse' : 'forward';

  if (shouldReverse) {
    logger.batch(
      `Global track order: REVERSE (${detectionMethod})` +
      (trackOrderHint ? ` (hint: ${trackOrderHint})` : '') +
      ` (forward: ${totalForwardCost.toFixed(1)}min, reverse: ${totalReverseCost.toFixed(1)}min)` +
      (hasCorrelationData ? ` (fwd corr: ${totalForwardCorr.toFixed(0)}, rev corr: ${totalReverseCorr.toFixed(0)})` : '') +
      ` \u2014 reordering all discs`,
    );

    // Reverse files within each disc
    for (const run of discRuns) {
      const slice = episodeFiles.slice(run.startIdx, run.endIdx + 1).reverse();
      for (let i = 0; i < slice.length; i++) {
        episodeFiles[run.startIdx + i] = slice[i];
      }
    }
  } else {
    logger.batch(
      `Global track order: forward (${detectionMethod})` +
      (trackOrderHint ? ` (hint: ${trackOrderHint})` : '') +
      ` (forward: ${totalForwardCost.toFixed(1)}min, reverse: ${totalReverseCost.toFixed(1)}min)` +
      (hasCorrelationData ? ` (fwd corr: ${totalForwardCorr.toFixed(0)}, rev corr: ${totalReverseCorr.toFixed(0)})` : ''),
    );
  }

  return decision;
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
