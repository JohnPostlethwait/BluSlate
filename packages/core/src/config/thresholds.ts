/**
 * Named constants for matching thresholds and scoring weights.
 *
 * Centralizes magic numbers previously scattered across batch-matcher,
 * scorer, pipeline, directory-parser, and matcher modules.
 */

// ── Batch mode activation ────────────────────────────────────────────

/** Ratio of generic (non-parseable) filenames that triggers batch mode */
export const BATCH_MODE_GENERIC_RATIO = 0.7;

// ── Episode classification ───────────────────────────────────────────

/** Minimum ratio of expected runtime for a file to classify as episode */
export const EPISODE_MIN_RUNTIME_RATIO = 0.5;

/** Maximum ratio of expected runtime for a file to classify as episode */
export const EPISODE_MAX_RUNTIME_RATIO = 2.5;

/** Default minimum duration (minutes) to classify as episode when no expected runtime available */
export const EPISODE_MIN_DURATION_MINUTES = 15;

// ── Multi-episode detection ──────────────────────────────────────────

/** File runtime must exceed this multiple of single-episode runtime to be considered multi-episode */
export const MULTI_EPISODE_RUNTIME_MULTIPLIER = 1.7;

/** Maximum combined runtime tolerance (minutes) for multi-episode matches */
export const MULTI_EPISODE_COMBINED_TOLERANCE_MIN = 5;

// ── DVDCompare matching ──────────────────────────────────────────────

/** Maximum runtime drift (seconds) for DVDCompare-to-file match */
export const DVDCOMPARE_RUNTIME_TOLERANCE_SEC = 3;

/** Minimum title similarity for DVDCompare episode-to-TMDb mapping */
export const DVDCOMPARE_TITLE_SIMILARITY_MIN = 0.6;

// ── Play All / outlier detection ─────────────────────────────────────

/** File duration must exceed this multiple of median duration to flag as "Play All" */
export const PLAY_ALL_DURATION_MULTIPLIER = 2.5;

/** File size must exceed this multiple of median size to flag as "Play All" */
export const PLAY_ALL_SIZE_MULTIPLIER = 3;

// ── Track order detection ────────────────────────────────────────────

/** Reverse disc track order when reverse cost < this fraction of forward cost */
export const TRACK_REVERSAL_THRESHOLD = 0.75;

/** Minimum forward cost before considering reversal (avoids flipping near-zero cost discs) */
export const TRACK_REVERSAL_MIN_FORWARD_COST = 2;

// ── Specials matching ────────────────────────────────────────────────

/** Maximum absolute runtime difference (minutes) for specials match */
export const SPECIALS_MAX_DIFF_MINUTES = 15;

/** Maximum relative runtime difference (%) for specials match */
export const SPECIALS_MAX_DIFF_PERCENT = 20;

// ── Confidence scoring ──────────────────────────────────────────────

/** Points awarded for sequential position match in batch mode */
export const CONFIDENCE_POSITION_POINTS = 40;

/** Maximum points for runtime match component */
export const CONFIDENCE_RUNTIME_MAX_POINTS = 60;

/** Confidence penalty for multi-episode matches */
export const CONFIDENCE_MULTI_EPISODE_PENALTY = 15;

/** Minimum confidence score for a match to be classified as 'matched' (vs 'ambiguous') */
export const CONFIDENCE_MATCHED_THRESHOLD = 60;
