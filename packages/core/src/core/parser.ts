import { filenameParse, type ParsedShow } from '@ctrl/video-filename-parser';
import { MediaType } from '../types/media.js';
import type { ParsedFilename } from '../types/media.js';
import { logger } from '../utils/logger.js';
import { stripExtension } from '../utils/string.js';

// Regex to detect season/episode indicators in the filename
const TV_INDICATOR = /s\d{1,2}e\d{1,2}/i;

// Custom regex patterns for filenames the library doesn't handle
const PATTERNS = {
  // 1x02 format: "Show Name - 1x02 - Title.ext"
  crossFormat: /^(.+?)[\s._-]+(\d{1,2})x(\d{1,2})(?:[\s._-]|$)/i,
  // Compressed format: "show.name.102.ext" (single digit season, two digit episode)
  compressed: /^(.+?)[\s._-]+(\d)(\d{2})[\s._-]/,
  // Air date format: "show.name.2024.01.15.ext"
  airDate: /^(.+?)[\s._-]+(\d{4})\.(\d{2})\.(\d{2})/,
};

function cleanTitle(raw: string): string {
  return raw
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeTv(filename: string): boolean {
  return TV_INDICATOR.test(filename);
}

function parseWithLibrary(filename: string): ParsedFilename | null {
  try {
    const isTv = looksLikeTv(filename);
    const result = filenameParse(filename, isTv);

    // Check if the library detected it as a TV show
    if ('isTv' in result && (result as ParsedShow).isTv) {
      const show = result as ParsedShow;
      if (show.seasons?.length > 0) {
        return {
          mediaType: MediaType.TV,
          title: show.title,
          season: show.seasons[0],
          episodeNumbers: show.episodeNumbers,
          quality: show.resolution ?? undefined,
          codec: show.videoCodec ?? undefined,
          source: show.sources?.[0] ?? undefined,
          releaseGroup: show.group ?? undefined,
        };
      }
    }

    // Library returned something but couldn't fully categorize
    if (result.title) {
      return {
        mediaType: MediaType.Unknown,
        title: result.title,
        quality: result.resolution ?? undefined,
        codec: result.videoCodec ?? undefined,
      };
    }
  } catch {
    logger.debug(`Library parser failed for: ${filename}`);
  }

  return null;
}

function parseWithFallback(filename: string): ParsedFilename | null {
  // Remove extension for matching
  const nameWithoutExt = stripExtension(filename);

  // Try 1x02 format
  let match = nameWithoutExt.match(PATTERNS.crossFormat);
  if (match) {
    return {
      mediaType: MediaType.TV,
      title: cleanTitle(match[1]),
      season: parseInt(match[2], 10),
      episodeNumbers: [parseInt(match[3], 10)],
    };
  }

  // Try air date format
  match = nameWithoutExt.match(PATTERNS.airDate);
  if (match) {
    return {
      mediaType: MediaType.TV,
      title: cleanTitle(match[1]),
      airDate: `${match[2]}-${match[3]}-${match[4]}`,
    };
  }

  // Try compressed format (102 = S01E02)
  match = nameWithoutExt.match(PATTERNS.compressed);
  if (match) {
    return {
      mediaType: MediaType.TV,
      title: cleanTitle(match[1]),
      season: parseInt(match[2], 10),
      episodeNumbers: [parseInt(match[3], 10)],
    };
  }

  return null;
}

export function parseFilename(filename: string): ParsedFilename {
  logger.parse(`Parsing: ${filename}`);

  // Check for air date format first (before library), since the library
  // would misidentify the year portion
  const nameWithoutExt = stripExtension(filename);
  const airDateMatch = nameWithoutExt.match(PATTERNS.airDate);
  if (airDateMatch) {
    const result: ParsedFilename = {
      mediaType: MediaType.TV,
      title: cleanTitle(airDateMatch[1]),
      airDate: `${airDateMatch[2]}-${airDateMatch[3]}-${airDateMatch[4]}`,
    };
    logger.parse(`Air date parsed: "${result.title}" (${result.airDate})`);
    return result;
  }

  // Try the library
  const libraryResult = parseWithLibrary(filename);
  if (libraryResult && libraryResult.mediaType !== MediaType.Unknown) {
    logger.parse(`Library parsed as ${libraryResult.mediaType}: "${libraryResult.title}"`);
    return libraryResult;
  }

  // Fall back to custom regex for patterns the library doesn't handle
  const fallbackResult = parseWithFallback(filename);
  if (fallbackResult) {
    logger.parse(`Fallback parsed as ${fallbackResult.mediaType}: "${fallbackResult.title}"`);
    return fallbackResult;
  }

  // If library returned something with Unknown type, use that
  if (libraryResult) {
    logger.parse(`Using partial library result: "${libraryResult.title}"`);
    return libraryResult;
  }

  // Last resort: use the entire filename (minus extension) as the title
  const title = cleanTitle(stripExtension(filename));
  logger.warn(`Could not parse filename, using raw title: "${title}"`);
  return {
    mediaType: MediaType.Unknown,
    title,
  };
}
