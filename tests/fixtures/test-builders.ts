/**
 * Shared test factory functions for building common test objects.
 */

import type { MediaFile, ProbeResult, ParsedFilename } from '../../packages/core/src/types/media.js';
import { MediaType } from '../../packages/core/src/types/media.js';

export function makeMediaFile(name: string, sizeBytes: number = 700_000_000): MediaFile {
  return {
    filePath: `/media/${name}`,
    fileName: name,
    extension: name.substring(name.lastIndexOf('.')),
    sizeBytes,
  };
}

export function makeProbeResult(durationMinutes: number): ProbeResult {
  return {
    durationMinutes,
    durationSeconds: durationMinutes * 60,
  };
}

export function makeParsedTv(title: string, season: number, episodes: number[]): ParsedFilename {
  return { mediaType: MediaType.TV, title, season, episodeNumbers: episodes };
}

export function makeParsedMovie(title: string, year?: number): ParsedFilename {
  return { mediaType: MediaType.Movie, title, year };
}

export function makeParsedUnknown(title: string): ParsedFilename {
  return { mediaType: MediaType.Unknown, title };
}
