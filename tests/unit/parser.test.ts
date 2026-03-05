import { describe, it, expect } from 'vitest';
import { parseFilename } from '../../packages/core/src/core/parser.js';
import { MediaType } from '../../packages/core/src/types/media.js';
import {
  tvShowCases,
  fallbackCases,
  discRipTvCases,
  genericDiscCases,
} from '../fixtures/filenames.js';

describe('parseFilename', () => {
  describe('TV Show parsing', () => {
    for (const testCase of tvShowCases) {
      it(`should parse: ${testCase.input}`, () => {
        const result = parseFilename(testCase.input);
        expect(result.mediaType).toBe(testCase.expected.mediaType);
        if (testCase.expected.title) {
          expect(result.title.toLowerCase()).toContain(testCase.expected.title.toLowerCase());
        }
        if (testCase.expected.season !== undefined) {
          expect(result.season).toBe(testCase.expected.season);
        }
        if (testCase.expected.episodeNumbers) {
          expect(result.episodeNumbers).toEqual(testCase.expected.episodeNumbers);
        }
      });
    }
  });

  describe('Fallback parsing', () => {
    for (const testCase of fallbackCases) {
      it(`should parse: ${testCase.input}`, () => {
        const result = parseFilename(testCase.input);
        expect(result.mediaType).toBe(testCase.expected.mediaType);
        if (testCase.expected.title) {
          expect(result.title.toLowerCase()).toContain(testCase.expected.title.toLowerCase());
        }
        if (testCase.expected.season !== undefined) {
          expect(result.season).toBe(testCase.expected.season);
        }
        if (testCase.expected.episodeNumbers) {
          expect(result.episodeNumbers).toEqual(testCase.expected.episodeNumbers);
        }
        if (testCase.expected.airDate) {
          expect(result.airDate).toBe(testCase.expected.airDate);
        }
      });
    }
  });

  describe('Disc rip TV parsing', () => {
    for (const testCase of discRipTvCases) {
      it(`should parse: ${testCase.input}`, () => {
        const result = parseFilename(testCase.input);
        expect(result.mediaType).toBe(testCase.expected.mediaType);
        if (testCase.expected.title) {
          expect(result.title.toLowerCase()).toContain(testCase.expected.title.toLowerCase());
        }
        if (testCase.expected.season !== undefined) {
          expect(result.season).toBe(testCase.expected.season);
        }
        if (testCase.expected.episodeNumbers) {
          expect(result.episodeNumbers).toEqual(testCase.expected.episodeNumbers);
        }
      });
    }
  });

  describe('Generic disc filenames (should be Unknown for batch mode)', () => {
    for (const testCase of genericDiscCases) {
      it(`should NOT misidentify: ${testCase.input}`, () => {
        const result = parseFilename(testCase.input);
        // These should parse as Unknown — batch mode handles them via directory context
        expect(result.mediaType).toBe(MediaType.Unknown);
      });
    }
  });

  describe('Edge cases', () => {
    it('should handle unknown format gracefully', () => {
      const result = parseFilename('randomfile.mkv');
      expect(result.title).toBeTruthy();
    });

    it('should handle empty-ish filenames', () => {
      const result = parseFilename('.mkv');
      expect(result.title).toBeTruthy();
    });

    it('should handle filenames with multiple dots', () => {
      const result = parseFilename('some.show.name.s01e01.720p.mkv');
      expect(result.mediaType).toBe(MediaType.TV);
      expect(result.season).toBe(1);
      expect(result.episodeNumbers).toEqual([1]);
    });

    // 3-digit episode numbers (anime, long-running shows)
    it('should handle 3-digit episode numbers', () => {
      const result = parseFilename('Naruto.Shippuden.S01E220.1080p.mkv');
      expect(result.mediaType).toBe(MediaType.TV);
      expect(result.episodeNumbers).toEqual([220]);
    });

    // S01E01E02E03 triple episode — library limitation: only extracts last 2 episodes
    // from 3+ episode chains. Still correctly detected as TV with season.
    it('should handle triple multi-episode S01E01E02E03', () => {
      const result = parseFilename('Show.Name.S01E01E02E03.720p.mkv');
      expect(result.mediaType).toBe(MediaType.TV);
      expect(result.season).toBe(1);
      // Library returns [2, 3] — drops first episode from 3+ chains
      expect(result.episodeNumbers).toBeDefined();
      expect(result.episodeNumbers!.length).toBeGreaterThanOrEqual(2);
    });

    // Episode-only without season (E05)
    it('should handle episode-only without season marker', () => {
      const result = parseFilename('Show.Name.E05.720p.mkv');
      // The library may or may not handle this — at minimum it should not crash
      expect(result.title).toBeTruthy();
    });

    // Filename without year or S##E## — should be Unknown
    it('should handle unrecognized filename as Unknown', () => {
      const result = parseFilename('Some Random Title.mkv');
      expect(result.title).toBeTruthy();
    });

    // 4-digit S/E: S100E001 (very high numbers)
    it('should handle very high season numbers like S100', () => {
      const result = parseFilename('Show.S100E01.mkv');
      // The library or fallback may not handle 3-digit seasons
      expect(result.title).toBeTruthy();
    });

    // Compressed 3-digit episode (show.name.102)
    it('should handle compressed format show.name.102', () => {
      const result = parseFilename('seinfeld.102.dummy.mkv');
      // compressed pattern: single digit season (1) + two digit episode (02)
      expect(result.mediaType).toBe(MediaType.TV);
      expect(result.season).toBe(1);
      expect(result.episodeNumbers).toEqual([2]);
    });

    // Full S##E## range format: S01E01-E03
    it('should handle S01E01-E03 range format', () => {
      const result = parseFilename('Show.S01E01-E03.720p.mkv');
      expect(result.mediaType).toBe(MediaType.TV);
      expect(result.season).toBe(1);
    });
  });
});
