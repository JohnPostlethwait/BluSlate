import { describe, it, expect } from 'vitest';
import { applyEpisodeEdit, applySeasonEdit, applySkip, parseEpisodeInput, formatRuntimeMmSs } from '../../packages/cli/src/ui/editor.js';
import { MediaType } from '../../packages/core/src/types/media.js';
import type { MatchResult, TmdbMatchedItem } from '../../packages/core/src/types/media.js';

function makeMatch(overrides: Partial<TmdbMatchedItem> = {}): MatchResult {
  const tmdbMatch: TmdbMatchedItem = {
    id: 100,
    name: 'Stargate Universe',
    mediaType: MediaType.TV,
    seasonNumber: 1,
    episodeNumber: 3,
    episodeTitle: 'Darkness',
    searchRank: 0,
    ...overrides,
  };

  return {
    mediaFile: {
      filePath: '/media/SGU/title_t03.mkv',
      fileName: 'title_t03.mkv',
      extension: '.mkv',
      sizeBytes: 1000000,
    },
    parsed: { mediaType: MediaType.TV, title: 'title_t03' },
    tmdbMatch,
    confidence: 90,
    newFilename: 'Stargate Universe - S01E03 - Darkness.mkv',
    status: 'matched',
  };
}

describe('parseEpisodeInput', () => {
  it('should parse a single number', () => {
    expect(parseEpisodeInput('5')).toEqual({ start: 5 });
  });

  it('should parse a zero-padded number', () => {
    expect(parseEpisodeInput('05')).toEqual({ start: 5 });
  });

  it('should parse a range', () => {
    expect(parseEpisodeInput('1-2')).toEqual({ start: 1, end: 2 });
  });

  it('should parse a zero-padded range', () => {
    expect(parseEpisodeInput('01-02')).toEqual({ start: 1, end: 2 });
  });

  it('should parse a wider range', () => {
    expect(parseEpisodeInput('3-7')).toEqual({ start: 3, end: 7 });
  });

  it('should reject zero', () => {
    const result = parseEpisodeInput('0');
    expect(typeof result).toBe('string');
  });

  it('should reject non-numeric input', () => {
    const result = parseEpisodeInput('abc');
    expect(typeof result).toBe('string');
  });

  it('should reject reversed range (end < start)', () => {
    const result = parseEpisodeInput('3-1');
    expect(typeof result).toBe('string');
  });

  it('should reject equal range', () => {
    const result = parseEpisodeInput('5-5');
    expect(typeof result).toBe('string');
  });

  it('should reject negative numbers', () => {
    const result = parseEpisodeInput('-5');
    expect(typeof result).toBe('string');
  });

  it('should trim whitespace', () => {
    expect(parseEpisodeInput('  3  ')).toEqual({ start: 3 });
  });

  it('should trim whitespace for ranges', () => {
    expect(parseEpisodeInput(' 1-2 ')).toEqual({ start: 1, end: 2 });
  });

  it('should reject episode number above 9999', () => {
    const result = parseEpisodeInput('10000');
    expect(typeof result).toBe('string');
  });

  it('should accept episode number at 9999', () => {
    expect(parseEpisodeInput('9999')).toEqual({ start: 9999 });
  });

  it('should reject range with start above 9999', () => {
    const result = parseEpisodeInput('10000-10001');
    expect(typeof result).toBe('string');
  });

  it('should reject range with end above 9999', () => {
    const result = parseEpisodeInput('1-10000');
    expect(typeof result).toBe('string');
  });

  it('should accept range at upper bound', () => {
    expect(parseEpisodeInput('9998-9999')).toEqual({ start: 9998, end: 9999 });
  });

  it('should accept minimum valid episode number', () => {
    expect(parseEpisodeInput('1')).toEqual({ start: 1 });
  });

  it('should reject multiple dashes (ambiguous range)', () => {
    // '1-2-3' does not match the range regex ^(\d+)-(\d+)$ so parseInt picks up '1'
    // and the validation lets it through — this documents the current behavior
    const result = parseEpisodeInput('1-2-3');
    expect(typeof result).toBe('string'); // should be rejected as invalid
  });

  it('should reject range with internal whitespace', () => {
    // '1 - 2' does not match the range regex ^(\d+)-(\d+)$ so it falls through
    // to single-number parsing — documents the current behavior
    const result = parseEpisodeInput('1 - 2');
    expect(typeof result).toBe('string'); // should be rejected as invalid
  });
});

describe('applyEpisodeEdit', () => {
  it('should update episode number and re-render filename', () => {
    const match = makeMatch();
    applyEpisodeEdit(match, 5);

    expect(match.tmdbMatch!.episodeNumber).toBe(5);
    expect(match.newFilename).toContain('S01E05');
  });

  it('should clear episodeNumberEnd for single episode edit', () => {
    const match = makeMatch({ episodeNumber: 1, episodeNumberEnd: 2 });
    applyEpisodeEdit(match, 7);

    expect(match.tmdbMatch!.episodeNumber).toBe(7);
    expect(match.tmdbMatch!.episodeNumberEnd).toBeUndefined();
    expect(match.newFilename).toContain('E07');
    // Should not contain multi-episode range pattern like E07-08
    expect(match.newFilename).not.toMatch(/E07-\d{2}/);
  });

  it('should set multi-episode range when episodeEnd provided', () => {
    const match = makeMatch();
    applyEpisodeEdit(match, 1, 2);

    expect(match.tmdbMatch!.episodeNumber).toBe(1);
    expect(match.tmdbMatch!.episodeNumberEnd).toBe(2);
    expect(match.newFilename).toContain('E01-02');
  });

  it('should render wider multi-episode range', () => {
    const match = makeMatch();
    applyEpisodeEdit(match, 3, 5);

    expect(match.tmdbMatch!.episodeNumber).toBe(3);
    expect(match.tmdbMatch!.episodeNumberEnd).toBe(5);
    expect(match.newFilename).toContain('E03-05');
  });

  it('should clear episodeEnd when same as start', () => {
    const match = makeMatch();
    applyEpisodeEdit(match, 5, 5);

    expect(match.tmdbMatch!.episodeNumberEnd).toBeUndefined();
    expect(match.newFilename).toContain('E05');
  });

  it('should clear episode title since new episode title is unknown', () => {
    const match = makeMatch({ episodeTitle: 'Original Title' });
    applyEpisodeEdit(match, 10);

    expect(match.tmdbMatch!.episodeTitle).toBeUndefined();
    // Filename should not contain old title or trailing separator
    expect(match.newFilename).not.toContain('Original Title');
    expect(match.newFilename).not.toMatch(/\s-\s*\.mkv$/);
  });

  it('should set status to ambiguous', () => {
    const match = makeMatch();
    expect(match.status).toBe('matched');

    applyEpisodeEdit(match, 5);
    expect(match.status).toBe('ambiguous');
  });

  it('should cap confidence at 70', () => {
    const match = makeMatch();
    match.confidence = 95;

    applyEpisodeEdit(match, 5);
    expect(match.confidence).toBe(70);
  });

  it('should not increase confidence if already below 70', () => {
    const match = makeMatch();
    match.confidence = 40;

    applyEpisodeEdit(match, 5);
    expect(match.confidence).toBe(40);
  });

  it('should preserve show name in rendered filename', () => {
    const match = makeMatch();
    applyEpisodeEdit(match, 12);

    expect(match.newFilename).toMatch(/^Stargate Universe/);
  });

  it('should respect custom template', () => {
    const match = makeMatch();
    applyEpisodeEdit(match, 5, undefined, undefined, '{show_name} {season}x{episode}');

    expect(match.newFilename).toContain('Stargate Universe');
    // Template uses {season}x{episode} format
    expect(match.newFilename).toContain('01x05');
  });

  it('should render multi-episode with custom template', () => {
    const match = makeMatch();
    applyEpisodeEdit(match, 1, 2, undefined, '{show_name} - S{season}E{episode}');

    expect(match.newFilename).toContain('S01E01-02');
  });

  it('should include episode title in filename when provided', () => {
    const match = makeMatch();
    applyEpisodeEdit(match, 5, undefined, 'Air');

    expect(match.tmdbMatch!.episodeTitle).toBe('Air');
    expect(match.newFilename).toContain('Air');
    expect(match.newFilename).toContain('S01E05');
    expect(match.newFilename).toBe('Stargate Universe - S01E05 - Air.mkv');
  });

  it('should clear episode title when not provided', () => {
    const match = makeMatch({ episodeTitle: 'Original Title' });
    applyEpisodeEdit(match, 5);

    expect(match.tmdbMatch!.episodeTitle).toBeUndefined();
    expect(match.newFilename).not.toContain('Original Title');
  });
});

describe('applySeasonEdit', () => {
  it('should update season number and re-render filename', () => {
    const match = makeMatch();
    applySeasonEdit(match, 2);

    expect(match.tmdbMatch!.seasonNumber).toBe(2);
    expect(match.newFilename).toContain('S02E03');
  });

  it('should allow season 0 for specials', () => {
    const match = makeMatch();
    applySeasonEdit(match, 0);

    expect(match.tmdbMatch!.seasonNumber).toBe(0);
    expect(match.newFilename).toContain('S00E03');
  });

  it('should set status to ambiguous', () => {
    const match = makeMatch();
    applySeasonEdit(match, 3);

    expect(match.status).toBe('ambiguous');
  });

  it('should cap confidence at 70', () => {
    const match = makeMatch();
    match.confidence = 100;

    applySeasonEdit(match, 2);
    expect(match.confidence).toBe(70);
  });

  it('should include episode title when provided', () => {
    const match = makeMatch({ episodeTitle: 'Darkness' });
    applySeasonEdit(match, 2, 'Darkness');

    expect(match.tmdbMatch!.episodeTitle).toBe('Darkness');
    expect(match.newFilename).toContain('Darkness');
    expect(match.newFilename).toContain('S02E03');
  });

  it('should clear episode title when not provided', () => {
    const match = makeMatch({ episodeTitle: 'Darkness' });
    applySeasonEdit(match, 2);

    expect(match.tmdbMatch!.episodeTitle).toBeUndefined();
    expect(match.newFilename).not.toContain('Darkness');
  });
});

describe('applySkip', () => {
  it('should set status to unmatched', () => {
    const match = makeMatch();
    applySkip(match);

    expect(match.status).toBe('unmatched');
  });

  it('should set confidence to 0', () => {
    const match = makeMatch();
    applySkip(match);

    expect(match.confidence).toBe(0);
  });

  it('should clear tmdbMatch', () => {
    const match = makeMatch();
    expect(match.tmdbMatch).toBeDefined();

    applySkip(match);
    expect(match.tmdbMatch).toBeUndefined();
  });

  it('should revert newFilename to original fileName', () => {
    const match = makeMatch();
    expect(match.newFilename).not.toBe(match.mediaFile.fileName);

    applySkip(match);
    expect(match.newFilename).toBe('title_t03.mkv');
  });
});

describe('formatRuntimeMmSs', () => {
  it('should format seconds as MM:SS', () => {
    const match = makeMatch();
    match.probeData = { durationSeconds: 2723, durationMinutes: 45 };
    expect(formatRuntimeMmSs(match)).toContain('45:23');
  });

  it('should format exact minutes with :00 seconds', () => {
    const match = makeMatch();
    match.probeData = { durationSeconds: 2700, durationMinutes: 45 };
    expect(formatRuntimeMmSs(match)).toContain('45:00');
  });

  it('should zero-pad minutes under 10', () => {
    const match = makeMatch();
    match.probeData = { durationSeconds: 300, durationMinutes: 5 };
    expect(formatRuntimeMmSs(match)).toContain('05:00');
  });

  it('should handle durations over 1 hour', () => {
    const match = makeMatch();
    match.probeData = { durationSeconds: 5400, durationMinutes: 90 };
    expect(formatRuntimeMmSs(match)).toContain('90:00');
  });

  it('should fall back to durationMinutes when durationSeconds is unavailable', () => {
    const match = makeMatch();
    match.probeData = { durationMinutes: 45 };
    expect(formatRuntimeMmSs(match)).toContain('45:00');
  });

  it('should return --:-- when no probe data exists', () => {
    const match = makeMatch();
    match.probeData = undefined;
    expect(formatRuntimeMmSs(match)).toContain('--:--');
  });

  it('should return --:-- when probe data has no duration fields', () => {
    const match = makeMatch();
    match.probeData = {};
    expect(formatRuntimeMmSs(match)).toContain('--:--');
  });

  it('should handle fractional seconds by rounding', () => {
    const match = makeMatch();
    match.probeData = { durationSeconds: 2723.7, durationMinutes: 45 };
    expect(formatRuntimeMmSs(match)).toContain('45:24');
  });
});
