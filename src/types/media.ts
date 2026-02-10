export enum MediaType {
  TV = 'tv',
  Movie = 'movie',
  Unknown = 'unknown',
}

export interface MediaFile {
  filePath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
}

export interface ParsedFilename {
  mediaType: MediaType;
  title: string;
  year?: number;
  season?: number;
  episodeNumbers?: number[];
  quality?: string;
  codec?: string;
  source?: string;
  releaseGroup?: string;
  airDate?: string;
}

export interface MatchResult {
  mediaFile: MediaFile;
  parsed: ParsedFilename;
  probeData?: ProbeResult;
  tmdbMatch?: TmdbMatchedItem;
  confidence: number;
  newFilename: string;
  status: 'matched' | 'ambiguous' | 'unmatched';
}

export interface TmdbMatchedItem {
  id: number;
  name: string;
  year?: number;
  runtime?: number;
  mediaType: MediaType;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeNumberEnd?: number;
  episodeTitle?: string;
  searchRank: number;
}

export interface ProbeResult {
  durationSeconds?: number;
  durationMinutes?: number;
  title?: string;
  showName?: string;
  season?: number;
  episode?: number;
  format?: string;
}

export interface ProcessingResult {
  file: MediaFile;
  status: 'success' | 'skipped' | 'error';
  match?: MatchResult;
  error?: {
    phase: 'scan' | 'parse' | 'probe' | 'search' | 'match' | 'rename';
    message: string;
    recoverable: boolean;
  };
}

export interface DirectoryContext {
  showName: string;
  season?: number;
  disc?: number;
  sourceHint?: string;
  showNameSource: string;
  seasonDiscSource?: string;
}

export interface SeasonGroup {
  directoryContext: DirectoryContext;
  files: MediaFile[];
  probeResults: Map<string, ProbeResult>;
}

export interface ClassifiedFile {
  file: MediaFile;
  probeData?: ProbeResult;
  classification: 'episode' | 'extra' | 'unknown';
  durationMinutes?: number;
  sortOrder: number;
}

export const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.m4v', '.ts', '.wmv',
  '.mov', '.flv', '.webm', '.mpg', '.mpeg', '.m2ts',
]);
