import { describe, it, expect } from 'vitest';
import { levenshteinDistance, normalizedSimilarity, computeConfidence } from '../../src/core/scorer.js';
import { MediaType } from '../../src/types/media.js';
import type { ParsedFilename, TmdbMatchedItem, ProbeResult } from '../../src/types/media.js';

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
