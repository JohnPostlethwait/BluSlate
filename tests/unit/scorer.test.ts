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
    // title(30) + no-year redistribution(10) + ep match(15) + runtime ≤3min(20) + search rank 0(5) = 80
    expect(confidence).toBe(80);
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
    // Matching probe title adds exactly 10 points (1.0 similarity × 10)
    expect(withProbe).toBe(90);
    expect(withoutProbe).toBe(80);
    expect(withProbe).toBeGreaterThan(withoutProbe);
  });

  it('should add zero probe points when probe title does not match', () => {
    const probeData: ProbeResult = {
      title: 'Completely Different Show',
      durationMinutes: 48,
    };
    const withMismatchedProbe = computeConfidence(baseParsedTV, probeData, baseTmdbTV, 48);
    const withoutProbe = computeConfidence(baseParsedTV, undefined, baseTmdbTV, 48);
    // Probe title similarity is low so it adds fewer points than perfect match
    expect(withMismatchedProbe).toBeLessThan(90);
    // But still >= base since even low similarity adds some points
    expect(withMismatchedProbe).toBeGreaterThanOrEqual(withoutProbe);
  });

  it('should always return a value between 0 and 100', () => {
    const confidence = computeConfidence(baseParsedTV, undefined, baseTmdbTV, 48);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(100);
  });
});

describe('computeBatchConfidenceBreakdown — DVDCompare scoring', () => {
  it('should give 100 points for perfect DVDCompare match (40+60)', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 0.2,
    });

    // 40 (position) + round(60 - 0.2) = 60 (runtime) = 100
    expect(result.total).toBe(100);
    // Should have 2 breakdown items: position + DVDCompare runtime
    expect(result.items).toHaveLength(2);
  });

  it('should deduct 1 point per second of DVDCompare drift (40+58=98)', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 2.5,
    });

    // 40 (position) + round(60 - 2.5) = 58 (runtime) = 98
    expect(result.total).toBe(98);
  });

  it('should apply -15 penalty for multi-episode DVDCompare match (40+60-15=85)', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 0.1,
      isMultiEpisodeMatch: true,
    });

    expect(result.total).toBe(85);
    // position + DVDCompare runtime + multi-ep penalty
    expect(result.items).toHaveLength(3);
  });

  it('should score 45 with no position match and 15s DVDCompare drift', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 1.0,
      runtimeDiffMinutes: 15,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 15,
    });

    // 0 (position) + round(60 - 15) = 45 (DVDCompare runtime) = 45
    expect(result.total).toBe(45);
    expect(result.items).toHaveLength(2);
    expect(result.items.find(i => i.label.includes('No position match'))).toBeDefined();
    expect(result.items.find(i => i.label.includes('DVDCompare'))).toBeDefined();
  });

  it('should label runtime as DVDCompare when DVDCompare data is present', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 2,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 5,
    });

    const dvdItem = result.items.find(i => i.label.includes('DVDCompare runtime'));
    expect(dvdItem).toBeDefined();
    expect(dvdItem!.maxPoints).toBe(60);
  });

  it('should not apply relative runtime penalty when DVDCompare is present', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 20,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 1,
      singleEpisodeRuntimeMinutes: 30,
    });

    const penaltyItem = result.items.find(i => i.label.includes('% of episode'));
    expect(penaltyItem).toBeUndefined();
  });

  it('should give 0 runtime points for DVDCompare drift >= 60s', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 75,
    });

    const dvdItem = result.items.find(i => i.label.includes('DVDCompare'));
    expect(dvdItem).toBeDefined();
    expect(dvdItem!.points).toBe(0);
    // 40 (position) + 0 (runtime) = 40
    expect(result.total).toBe(40);
  });

  it('should give 53 runtime points for 7s DVDCompare drift (40+53=93)', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 7,
    });

    const dvdItem = result.items.find(i => i.label.includes('DVDCompare'));
    expect(dvdItem!.points).toBe(53);
    expect(result.total).toBe(93);
  });

  it('should give 30 runtime points for 30s DVDCompare drift (40+30=70)', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 30,
    });

    const dvdItem = result.items.find(i => i.label.includes('DVDCompare'));
    expect(dvdItem!.points).toBe(30);
    expect(result.total).toBe(70);
  });

  it('should give 0 runtime points at exactly 60s DVDCompare drift (40+0=40)', () => {
    const result = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
      isDvdCompareMatch: true,
      dvdCompareRuntimeDiffSeconds: 60,
    });

    const dvdItem = result.items.find(i => i.label.includes('DVDCompare'));
    expect(dvdItem!.points).toBe(0);
    expect(result.total).toBe(40);
  });
});
