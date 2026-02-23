import { describe, it, expect } from 'vitest';
import { levenshteinDistance, normalizedSimilarity, computeConfidence, computeBatchConfidenceBreakdown } from '../../packages/core/src/core/scorer.js';
import { MediaType } from '../../packages/core/src/types/media.js';
import type { ParsedFilename, TmdbMatchedItem, ProbeResult } from '../../packages/core/src/types/media.js';

describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('should return the length of the other string when one is empty', () => {
    expect(levenshteinDistance('', 'hello')).toBe(5);
    expect(levenshteinDistance('hello', '')).toBe(5);
  });

  it('should compute correct distance for single character difference', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('should compute correct distance for multiple differences', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('normalizedSimilarity', () => {
  it('should return 1.0 for identical strings', () => {
    expect(normalizedSimilarity('hello', 'hello')).toBe(1.0);
  });

  it('should return 0 for completely different strings of equal length', () => {
    const sim = normalizedSimilarity('abc', 'xyz');
    expect(sim).toBeLessThan(0.5);
  });

  it('should return high similarity for close matches', () => {
    const sim = normalizedSimilarity('breaking bad', 'breaking bad');
    expect(sim).toBe(1.0);
  });

  it('should handle empty strings', () => {
    expect(normalizedSimilarity('', '')).toBe(1.0);
  });
});

describe('computeConfidence', () => {
  const baseParsedTV: ParsedFilename = {
    mediaType: MediaType.TV,
    title: 'Breaking Bad',
    season: 1,
    episodeNumbers: [2],
  };

  const baseTmdbTV: TmdbMatchedItem = {
    id: 1396,
    name: 'Breaking Bad',
    year: 2008,
    runtime: 48,
    mediaType: MediaType.TV,
    seasonNumber: 1,
    episodeNumber: 2,
    episodeTitle: "Cat's in the Bag...",
    searchRank: 0,
  };

  it('should return high confidence for perfect match', () => {
    const confidence = computeConfidence(baseParsedTV, undefined, baseTmdbTV, 48);
    expect(confidence).toBeGreaterThanOrEqual(80);
  });

  it('should return lower confidence for title mismatch', () => {
    const parsed: ParsedFilename = { ...baseParsedTV, title: 'Breaking Bread' };
    const confidence = computeConfidence(parsed, undefined, baseTmdbTV, 48);
    expect(confidence).toBeLessThan(80);
  });

  it('should boost confidence with matching runtime', () => {
    const withRuntime = computeConfidence(baseParsedTV, undefined, baseTmdbTV, 48);
    const withoutRuntime = computeConfidence(baseParsedTV, undefined, baseTmdbTV, undefined);
    expect(withRuntime).toBeGreaterThan(withoutRuntime);
  });

  it('should handle movie scoring', () => {
    const parsed: ParsedFilename = {
      mediaType: MediaType.Movie,
      title: 'Inception',
      year: 2010,
    };
    const tmdb: TmdbMatchedItem = {
      id: 27205,
      name: 'Inception',
      year: 2010,
      runtime: 148,
      mediaType: MediaType.Movie,
      searchRank: 0,
    };
    const confidence = computeConfidence(parsed, undefined, tmdb, 148);
    expect(confidence).toBeGreaterThanOrEqual(80);
  });

  it('should reduce confidence for wrong season/episode', () => {
    const tmdbWrongEp: TmdbMatchedItem = {
      ...baseTmdbTV,
      seasonNumber: 2,
      episodeNumber: 5,
    };
    const confidence = computeConfidence(baseParsedTV, undefined, tmdbWrongEp, 48);
    const correctConfidence = computeConfidence(baseParsedTV, undefined, baseTmdbTV, 48);
    expect(confidence).toBeLessThan(correctConfidence);
  });

  it('should factor in probe data agreement', () => {
    const probeData: ProbeResult = {
      title: 'Breaking Bad',
      durationMinutes: 48,
    };
    const withProbe = computeConfidence(baseParsedTV, probeData, baseTmdbTV, 48);
    const withoutProbe = computeConfidence(baseParsedTV, undefined, baseTmdbTV, 48);
    expect(withProbe).toBeGreaterThanOrEqual(withoutProbe);
  });

  it('should always return a value between 0 and 100', () => {
    const confidence = computeConfidence(baseParsedTV, undefined, baseTmdbTV, 48);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(100);
  });
});

describe('computeBatchConfidenceBreakdown — DVDCompare', () => {
  it('should give 95 points for sub-second DVDCompare match', () => {
    const result = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 0.2,
    });

    expect(result.total).toBe(95);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].label).toContain('DVDCompare');
    expect(result.items[0].points).toBe(95);
  });

  it('should give 90 points for DVDCompare match with 1-3 second diff', () => {
    const result = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 2.5,
    });

    expect(result.total).toBe(90);
    expect(result.items[0].points).toBe(90);
  });

  it('should apply small penalty for multi-episode DVDCompare match', () => {
    const result = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 0.1,
      isMultiEpisodeMatch: true,
    });

    expect(result.total).toBe(90); // 95 - 5
    expect(result.items).toHaveLength(2);
  });

  it('should bypass normal scoring when DVDCompare match is set', () => {
    // Even with no sequential position match or bad runtime, DVDCompare takes priority
    const result = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 15,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 0.5,
    });

    expect(result.total).toBe(95);
  });
});
