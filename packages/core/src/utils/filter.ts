import type { MatchResult } from '../types/media.js';

/**
 * Filter matches for auto-accept mode: return only matched files
 * whose confidence meets or exceeds the minimum threshold.
 */
export function filterAutoAccepted(matches: MatchResult[], minConfidence: number): MatchResult[] {
  return matches.filter((m) => m.status !== 'unmatched' && m.confidence >= minConfidence);
}
