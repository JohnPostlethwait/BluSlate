import { TmdbClient } from '../api/tmdb-client.js';
import { computeConfidence, normalizedSimilarity } from './scorer.js';
import { MediaType } from '../types/media.js';
import type { ParsedFilename, TmdbMatchedItem, ProbeResult, MatchResult, MediaFile } from '../types/media.js';
import type { TmdbTvResult, TmdbMovieResult } from '../types/tmdb.js';
import { renderTemplate, getTemplate } from '../config/templates.js';
import { logger } from '../utils/logger.js';

const TOP_CANDIDATES = 3;

function extractYear(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;
  const year = parseInt(dateStr.substring(0, 4), 10);
  return isNaN(year) ? undefined : year;
}

function rankTvResults(results: TmdbTvResult[], parsed: ParsedFilename): TmdbTvResult[] {
  return [...results]
    .map((r) => ({
      result: r,
      score: normalizedSimilarity(parsed.title.toLowerCase(), r.name.toLowerCase()),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CANDIDATES)
    .map((r) => r.result);
}

function rankMovieResults(results: TmdbMovieResult[], parsed: ParsedFilename): TmdbMovieResult[] {
  return [...results]
    .map((r) => {
      let score = normalizedSimilarity(parsed.title.toLowerCase(), r.title.toLowerCase());
      const resultYear = extractYear(r.release_date);
      if (parsed.year && resultYear && parsed.year === resultYear) {
        score += 0.3;
      }
      return { result: r, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CANDIDATES)
    .map((r) => r.result);
}

async function matchTvShow(
  client: TmdbClient,
  parsed: ParsedFilename,
  probeData: ProbeResult | undefined,
  fileDurationMinutes: number | undefined,
): Promise<{ match: TmdbMatchedItem; confidence: number } | null> {
  const searchResponse = await client.searchTv(parsed.title, parsed.year);

  if (searchResponse.results.length === 0) {
    logger.tmdb(`No TV results for: "${parsed.title}"`);
    return null;
  }

  const candidates = rankTvResults(searchResponse.results, parsed);
  let bestMatch: TmdbMatchedItem | null = null;
  let bestConfidence = 0;

  for (let rank = 0; rank < candidates.length; rank++) {
    const candidate = candidates[rank];
    const candidateYear = extractYear(candidate.first_air_date);

    if (parsed.season !== undefined && parsed.episodeNumbers?.length) {
      try {
        const season = await client.getSeasonDetails(candidate.id, parsed.season);
        for (const epNum of parsed.episodeNumbers) {
          const episode = season.episodes.find((e) => e.episode_number === epNum);
          if (episode) {
            const tmdbItem: TmdbMatchedItem = {
              id: candidate.id,
              name: candidate.name,
              year: candidateYear,
              runtime: episode.runtime ?? undefined,
              mediaType: MediaType.TV,
              seasonNumber: parsed.season,
              episodeNumber: episode.episode_number,
              episodeTitle: episode.name,
              searchRank: rank,
            };

            const confidence = computeConfidence(parsed, probeData, tmdbItem, fileDurationMinutes);
            if (confidence > bestConfidence) {
              bestConfidence = confidence;
              bestMatch = tmdbItem;
            }
          }
        }
      } catch (err) {
        logger.debug(`Could not fetch season ${parsed.season} for "${candidate.name}": ${err}`);
      }
    } else {
      // No season/episode info; just match on show level
      const tmdbItem: TmdbMatchedItem = {
        id: candidate.id,
        name: candidate.name,
        year: candidateYear,
        mediaType: MediaType.TV,
        searchRank: rank,
      };

      const confidence = computeConfidence(parsed, probeData, tmdbItem, fileDurationMinutes);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = tmdbItem;
      }
    }
  }

  if (bestMatch) {
    return { match: bestMatch, confidence: bestConfidence };
  }

  return null;
}

async function matchMovie(
  client: TmdbClient,
  parsed: ParsedFilename,
  probeData: ProbeResult | undefined,
  fileDurationMinutes: number | undefined,
): Promise<{ match: TmdbMatchedItem; confidence: number } | null> {
  const searchResponse = await client.searchMovie(parsed.title, parsed.year);

  if (searchResponse.results.length === 0) {
    logger.tmdb(`No movie results for: "${parsed.title}"`);
    return null;
  }

  const candidates = rankMovieResults(searchResponse.results, parsed);
  let bestMatch: TmdbMatchedItem | null = null;
  let bestConfidence = 0;

  for (let rank = 0; rank < candidates.length; rank++) {
    const candidate = candidates[rank];

    // Fetch full details for runtime
    let runtime: number | undefined;
    try {
      const details = await client.getMovieDetails(candidate.id);
      runtime = details.runtime;
    } catch {
      runtime = candidate.runtime;
    }

    const candidateYear = extractYear(candidate.release_date);
    const tmdbItem: TmdbMatchedItem = {
      id: candidate.id,
      name: candidate.title,
      year: candidateYear,
      runtime,
      mediaType: MediaType.Movie,
      searchRank: rank,
    };

    const confidence = computeConfidence(parsed, probeData, tmdbItem, fileDurationMinutes);
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMatch = tmdbItem;
    }
  }

  if (bestMatch) {
    return { match: bestMatch, confidence: bestConfidence };
  }

  return null;
}

export async function findMatch(
  client: TmdbClient,
  mediaFile: MediaFile,
  parsed: ParsedFilename,
  probeData: ProbeResult | undefined,
  customTemplate?: string,
): Promise<MatchResult> {
  const fileDurationMinutes = probeData?.durationMinutes;
  let result: { match: TmdbMatchedItem; confidence: number } | null = null;

  if (parsed.mediaType === MediaType.TV) {
    result = await matchTvShow(client, parsed, probeData, fileDurationMinutes);
  } else if (parsed.mediaType === MediaType.Movie) {
    result = await matchMovie(client, parsed, probeData, fileDurationMinutes);
  } else {
    // Unknown type: try TV first (more structured), then movie
    result = await matchTvShow(client, parsed, probeData, fileDurationMinutes);
    if (!result || result.confidence < 50) {
      const movieResult = await matchMovie(client, parsed, probeData, fileDurationMinutes);
      if (movieResult && (!result || movieResult.confidence > result.confidence)) {
        result = movieResult;
      }
    }
  }

  if (!result) {
    return {
      mediaFile,
      parsed,
      probeData,
      confidence: 0,
      newFilename: mediaFile.fileName,
      status: 'unmatched',
    };
  }

  const template = getTemplate(result.match.mediaType, customTemplate);
  const newFilename = renderTemplate(template, result.match, mediaFile.extension);

  return {
    mediaFile,
    parsed,
    probeData,
    tmdbMatch: result.match,
    confidence: result.confidence,
    newFilename,
    status: result.confidence >= 60 ? 'matched' : 'ambiguous',
  };
}
