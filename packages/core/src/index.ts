// Core pipeline
export { runPipeline, detectPlayAllFiles } from './core/pipeline.js';

// Parsers
export { parseFilename } from './core/parser.js';
export {
  groupFilesBySeason,
  parseDirectoryContext,
} from './core/directory-parser.js';

// Matchers
export {
  identifyShow,
  classifyAndSortFiles,
  matchSeasonBatch,
  matchSpecialsBatch,
} from './core/batch-matcher.js';
export type { IdentifiedShow } from './core/batch-matcher.js';

// Scoring
export { computeConfidence, computeBatchConfidence, computeBatchConfidenceBreakdown } from './core/scorer.js';
export type { BatchConfidenceBreakdown } from './core/scorer.js';

// Scanner & Prober
export { scanDirectory } from './core/scanner.js';
export { probeFile, setFfprobePath, isFfprobeAvailable } from './core/prober.js';

// Renamer
export { executeRenames, writeRenameLog, undoRenames } from './core/renamer.js';

// API
export { TmdbClient } from './api/tmdb-client.js';
export {
  searchDvdCompare,
  fetchDiscEpisodeData,
} from './api/dvdcompare-client.js';
export type {
  DvdCompareEpisode,
  DvdCompareDisc,
  DvdCompareResult,
  DvdCompareSearchResult,
} from './api/dvdcompare-client.js';

// Config
export { loadApiKey, saveApiKey, buildConfig } from './config/config.js';
export { renderTemplate, getTemplate } from './config/templates.js';

// Validation
export {
  validatePipelineOptions,
  sanitizeErrorMessage,
  VALID_LANGUAGE_RE,
  MAX_API_KEY_LENGTH,
  MAX_TEMPLATE_LENGTH,
} from './utils/validation.js';
export type { ValidatedPipelineOptions } from './utils/validation.js';

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
  ConfidenceBreakdownItem,
  TmdbMatchedItem,
  ProbeResult,
  DirectoryContext,
  SeasonGroup,
  ClassifiedFile,
} from './types/media.js';

export type {
  TmdbSearchTvResponse,
  TmdbTvResult,
  TmdbSeasonDetails,
  TmdbEpisode,
  TmdbTvDetails,
} from './types/tmdb.js';

export type { AppConfig } from './types/config.js';

export type {
  UserPrompter,
  UIAdapter,
  ShowIdentificationResult,
} from './types/ui-adapter.js';
