import { MediaType } from '../types/media.js';
import type { ParsedFilename, TmdbMatchedItem, ProbeResult, ConfidenceBreakdownItem } from '../types/media.js';

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return dp[m][n];
}

export function normalizedSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(a, b);
  return 1.0 - distance / maxLen;
}

export function computeConfidence(
  parsed: ParsedFilename,
  probeData: ProbeResult | undefined,
  tmdbResult: TmdbMatchedItem,
  fileDurationMinutes: number | undefined,
): number {
  let score = 0;

  const titleSim = normalizedSimilarity(
    parsed.title.toLowerCase(),
    tmdbResult.name.toLowerCase(),
  );

  // 1. Title similarity (0-30 points)
  score += titleSim * 30;

  // 2. Year match (0-20 points)
  if (parsed.year && tmdbResult.year) {
    if (parsed.year === tmdbResult.year) {
      score += 20;
    } else if (Math.abs(parsed.year - tmdbResult.year) === 1) {
      score += 10;
    }
  } else if (!parsed.year) {
    // No year to compare; redistribute some weight to title
    score += titleSim * 10;
  }

  // 3. Season/Episode match (0-15 points)
  if (parsed.mediaType === MediaType.TV && parsed.season !== undefined && parsed.episodeNumbers) {
    if (
      tmdbResult.seasonNumber === parsed.season &&
      tmdbResult.episodeNumber !== undefined &&
      parsed.episodeNumbers.includes(tmdbResult.episodeNumber)
    ) {
      score += 15;
    }
  } else if (parsed.mediaType === MediaType.Movie) {
    // Redistribute for movies
    score += titleSim * 7.5;
    if (parsed.year && parsed.year === tmdbResult.year) {
      score += 7.5;
    }
  }

  // 4. Runtime match (0-20 points)
  if (fileDurationMinutes !== undefined && tmdbResult.runtime) {
    const diff = Math.abs(fileDurationMinutes - tmdbResult.runtime);
    if (diff <= 3) score += 20;
    else if (diff <= 5) score += 15;
    else if (diff <= 10) score += 10;
    else if (diff <= 20) score += 5;
  } else {
    // No runtime; redistribute some to title
    score += titleSim * 10;
  }

  // 5. Embedded metadata agreement (0-10 points)
  if (probeData?.title || probeData?.showName) {
    const probeName = (probeData.showName ?? probeData.title ?? '').toLowerCase();
    const tmdbName = tmdbResult.name.toLowerCase();
    const probeSim = normalizedSimilarity(probeName, tmdbName);
    score += probeSim * 10;
  }

  // 6. Popularity/search rank bonus (0-5 points)
  score += Math.max(0, 5 - tmdbResult.searchRank * 2);

  return Math.round(Math.min(100, Math.max(0, score)));
}

export interface BatchConfidenceBreakdown {
  total: number;
  items: ConfidenceBreakdownItem[];
}

export type BatchConfidenceParams = {
  sequentialPositionMatch: boolean;
  runtimeDiffMinutes: number | undefined;
  isSpecialsMatch?: boolean;
  tmdbRuntimeMinutes?: number;
  isMultiEpisodeMatch?: boolean;
  singleEpisodeRuntimeMinutes?: number;
  isDvdCompareMatch?: boolean;
  dvdCompareRuntimeDiffSeconds?: number;
};

/**
 * Compute confidence for batch mode matching where episodes are matched
 * by sequential position + runtime comparison. Returns both the total
 * score and a line-item breakdown of each scoring factor.
 *
 * Scoring (max 100):
 *   - Sequential position match: +40
 *   - Runtime match: 0–60 (continuous per-minute deduction for regular, percentage for specials)
 *   - Multi-episode penalty: -15
 *   - Relative runtime penalty: -5 or -10
 */
export function computeBatchConfidenceBreakdown(params: BatchConfidenceParams): BatchConfidenceBreakdown {
  let score = 0;
  const items: ConfidenceBreakdownItem[] = [];

  // DVDCompare definitive match — bypass normal scoring
  // Sub-second runtime matching against DVDCompare's to-the-second data
  // provides near-certain episode identification
  if (params.isDvdCompareMatch) {
    const diffSeconds = params.dvdCompareRuntimeDiffSeconds ?? 0;
    const dvdPoints = diffSeconds <= 1 ? 95 : 90;
    items.push({
      label: `DVDCompare match (±${diffSeconds.toFixed(1)}s)`,
      points: dvdPoints,
    });
    if (params.isMultiEpisodeMatch) {
      items.push({ label: 'Multi-episode match', points: -5 });
      return { total: Math.max(0, dvdPoints - 5), items };
    }
    return { total: dvdPoints, items };
  }

  // Sequential position match (0 or 40 points)
  if (params.sequentialPositionMatch) {
    score += 40;
    items.push({ label: 'Sequential position match', points: 40 });
  } else {
    items.push({ label: 'No sequential position match', points: 0 });
  }

  // Runtime match (0-60 points)
  if (params.runtimeDiffMinutes !== undefined) {
    if (params.isSpecialsMatch && params.tmdbRuntimeMinutes) {
      // Specials: use percentage-based thresholds (more forgiving for variable runtimes)
      const pctDiff = (params.runtimeDiffMinutes / params.tmdbRuntimeMinutes) * 100;
      const diffLabel = `±${Math.round(params.runtimeDiffMinutes)}min (${Math.round(pctDiff)}%)`;
      if (pctDiff <= 5) {
        score += 60;
        items.push({ label: `Runtime match ${diffLabel}`, points: 60 });
      } else if (pctDiff <= 10) {
        score += 45;
        items.push({ label: `Runtime close ${diffLabel}`, points: 45 });
      } else if (pctDiff <= 15) {
        score += 25;
        items.push({ label: `Runtime diff ${diffLabel}`, points: 25 });
      } else {
        items.push({ label: `Runtime diff ${diffLabel}`, points: 0 });
      }
    } else {
      // Regular episodes: continuous per-minute deduction from 60-point max.
      // Each minute of runtime difference costs 1 point (e.g., 3min diff → 57pts → 97% total).
      const diffLabel = `±${Math.round(params.runtimeDiffMinutes)}min`;
      const runtimePoints = Math.round(Math.max(0, 60 - params.runtimeDiffMinutes));
      if (runtimePoints > 0) {
        score += runtimePoints;
        items.push({ label: `Runtime match ${diffLabel}`, points: runtimePoints });
      } else {
        items.push({ label: `Runtime diff ${diffLabel}`, points: 0 });
      }
    }
  } else {
    items.push({ label: 'Runtime: no data', points: 0 });
  }

  // Multi-episode penalty: combining episodes is a heuristic guess
  if (params.isMultiEpisodeMatch) {
    score -= 15;
    items.push({ label: 'Multi-episode match', points: -15 });
  }

  // Relative runtime penalty: penalize when runtime diff is large relative to episode length
  // Skip for specials — they already use percentage-based scoring above
  if (
    !params.isSpecialsMatch &&
    params.singleEpisodeRuntimeMinutes !== undefined &&
    params.singleEpisodeRuntimeMinutes > 0 &&
    params.runtimeDiffMinutes !== undefined
  ) {
    const relativePct = (params.runtimeDiffMinutes / params.singleEpisodeRuntimeMinutes) * 100;
    if (relativePct > 15) {
      score -= 10;
      items.push({ label: `Runtime >${Math.round(relativePct)}% of episode`, points: -10 });
    } else if (relativePct > 10) {
      score -= 5;
      items.push({ label: `Runtime >${Math.round(relativePct)}% of episode`, points: -5 });
    }
  }

  const total = Math.round(Math.min(100, Math.max(0, score)));
  return { total, items };
}

/**
 * Convenience wrapper that returns just the numeric score.
 */
export function computeBatchConfidence(params: BatchConfidenceParams): number {
  return computeBatchConfidenceBreakdown(params).total;
}
