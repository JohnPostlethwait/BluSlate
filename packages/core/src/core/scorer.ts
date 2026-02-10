import { MediaType } from '../types/media.js';
import type { ParsedFilename, TmdbMatchedItem, ProbeResult } from '../types/media.js';

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

/**
 * Compute confidence for batch mode matching where show has been confirmed
 * by the user and episodes are matched by sequential position + runtime.
 */
export function computeBatchConfidence(params: {
  userConfirmedShow: boolean;
  sequentialPositionMatch: boolean;
  runtimeDiffMinutes: number | undefined;
  episodeExistsInTmdb: boolean;
  isSpecialsMatch?: boolean;
  tmdbRuntimeMinutes?: number;
  isMultiEpisodeMatch?: boolean;
  singleEpisodeRuntimeMinutes?: number;
}): number {
  let score = 0;

  // User confirmed show (0 or 30 points)
  if (params.userConfirmedShow) {
    score += 30;
  }

  // Sequential position match (0 or 25 points)
  if (params.sequentialPositionMatch) {
    score += 25;
  }

  // Runtime match (0-35 points)
  if (params.runtimeDiffMinutes !== undefined) {
    if (params.isSpecialsMatch && params.tmdbRuntimeMinutes) {
      // Specials: use percentage-based thresholds (more forgiving for variable runtimes)
      const pctDiff = (params.runtimeDiffMinutes / params.tmdbRuntimeMinutes) * 100;
      if (pctDiff <= 5) {
        score += 35;
      } else if (pctDiff <= 10) {
        score += 25;
      } else if (pctDiff <= 15) {
        score += 15;
      }
    } else {
      // Regular episodes: absolute minute thresholds
      if (params.runtimeDiffMinutes <= 3) {
        score += 35;
      } else if (params.runtimeDiffMinutes <= 5) {
        score += 25;
      } else if (params.runtimeDiffMinutes <= 10) {
        score += 15;
      }
      // > 10min = 0 points
    }
  }

  // Episode exists in TMDb (0 or 10 points)
  if (params.episodeExistsInTmdb) {
    score += 10;
  }

  // Multi-episode penalty: combining episodes is a heuristic guess
  if (params.isMultiEpisodeMatch) {
    score -= 10;
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
    } else if (relativePct > 10) {
      score -= 5;
    }
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}
