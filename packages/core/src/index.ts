// Core pipeline
export { runPipeline } from './core/pipeline.js';

// Parsers
export { parseFilename } from './core/parser.js';
export {
  shouldUseBatchMode,
  groupFilesBySeason,
  extractTrackNumber,
  parseDirectoryContext,
} from './core/directory-parser.js';

// Matchers
export { findMatch } from './core/matcher.js';
export {
  identifyShow,
  classifyAndSortFiles,
  matchSeasonBatch,
  matchSpecialsBatch,
} from './core/batch-matcher.js';
export type { IdentifiedShow, SeasonBatchResult, SpecialsBatchResult } from './core/batch-matcher.js';

// Scoring
export { computeConfidence, computeBatchConfidence } from './core/scorer.js';

// Scanner & Prober
export { scanDirectory } from './core/scanner.js';
export { probeFile } from './core/prober.js';

// Renamer
export { executeRenames, writeRenameLog } from './core/renamer.js';

// API
export { TmdbClient } from './api/tmdb-client.js';
export { LRUCache } from './api/cache.js';
export { RateLimiter } from './api/rate-limiter.js';

// Config
export { loadApiKey, saveApiKey, buildConfig } from './config/config.js';
export { renderTemplate, getTemplate } from './config/templates.js';

// Utils
export { safeRename } from './utils/filesystem.js';
export { sanitizeFilename } from './utils/sanitize.js';
export { logger, setVerbose, setLogLevel, LogLevel } from './utils/logger.js';
export { getConfigDir, getConfigFilePath } from './utils/platform.js';

// Errors
export { FatalError, AuthenticationError } from './errors.js';

// Types
export { MediaType, VIDEO_EXTENSIONS } from './types/media.js';
export type {
  MediaFile,
  ParsedFilename,
  MatchResult,
  TmdbMatchedItem,
  ProbeResult,
  ProcessingResult,
  DirectoryContext,
  SeasonGroup,
  ClassifiedFile,
} from './types/media.js';

export type {
  TmdbSearchTvResponse,
  TmdbTvResult,
  TmdbSearchMovieResponse,
  TmdbMovieResult,
  TmdbMovieDetails,
  TmdbSeasonDetails,
  TmdbEpisode,
  TmdbTvDetails,
} from './types/tmdb.js';

export type { AppConfig } from './types/config.js';

export type {
  ProgressReporter,
  UserPrompter,
  DisplayAdapter,
  UIAdapter,
} from './types/ui-adapter.js';
