import { describe, it, expect } from 'vitest';
import { renderTemplate, getTemplate } from '../../packages/core/src/config/templates.js';
import { MediaType } from '../../packages/core/src/types/media.js';
import type { TmdbMatchedItem } from '../../packages/core/src/types/media.js';

describe('getTemplate', () => {
  it('should return default TV template', () => {
    const template = getTemplate();
    expect(template).toContain('{show_name}');
    expect(template).toContain('{season}');
    expect(template).toContain('{episode}');
  });

  it('should return custom template when provided', () => {
    const custom = '{title} - Custom';
    expect(getTemplate(custom)).toBe(custom);
  });

  it('should reject templates exceeding max length', () => {
    const longTemplate = '{title} ' + 'x'.repeat(500);
    expect(() => getTemplate(longTemplate)).toThrow(/too long/);
  });

  it('should reject templates with unknown placeholders', () => {
    expect(() => getTemplate('{title} {malicious}')).toThrow(/Unknown template placeholder/);
  });

  it('should allow templates with all valid placeholders', () => {
    const template = '{show_name} {title} {year} {season} {episode} {episode_title} {ext}';
    expect(() => getTemplate(template)).not.toThrow();
  });

  it('should allow templates with no placeholders (literal text)', () => {
    expect(getTemplate('just-a-name')).toBe('just-a-name');
  });
});

describe('renderTemplate', () => {
  it('should render TV show template correctly', () => {
    const item: TmdbMatchedItem = {
      id: 1,
      name: 'Breaking Bad',
      mediaType: MediaType.TV,
      seasonNumber: 1,
      episodeNumber: 2,
      episodeTitle: "Cat's in the Bag",
      searchRank: 0,
    };

    const result = renderTemplate(
      '{show_name} - S{season}E{episode} - {episode_title}',
      item,
      '.mkv',
    );
    expect(result).toBe("Breaking Bad - S01E02 - Cat's in the Bag.mkv");
  });

  it('should handle missing episode title gracefully', () => {
    const item: TmdbMatchedItem = {
      id: 1,
      name: 'Test Show',
      mediaType: MediaType.TV,
      seasonNumber: 1,
      episodeNumber: 1,
      searchRank: 0,
    };

    const result = renderTemplate(
      '{show_name} - S{season}E{episode} - {episode_title}',
      item,
      '.mkv',
    );
    // Should clean up trailing " - " when episode_title is empty
    expect(result).toBe('Test Show - S01E01.mkv');
  });

  it('should zero-pad season and episode numbers', () => {
    const item: TmdbMatchedItem = {
      id: 1,
      name: 'Show',
      mediaType: MediaType.TV,
      seasonNumber: 1,
      episodeNumber: 3,
      searchRank: 0,
    };

    const result = renderTemplate('{show_name} - S{season}E{episode}', item, '.mp4');
    expect(result).toContain('S01E03');
  });

  it('should render multi-episode files as S01E01-02', () => {
    const item: TmdbMatchedItem = {
      id: 1,
      name: 'Stargate Universe',
      mediaType: MediaType.TV,
      seasonNumber: 1,
      episodeNumber: 1,
      episodeNumberEnd: 2,
      episodeTitle: 'Air (1) / Air (2)',
      searchRank: 0,
    };

    const result = renderTemplate(
      '{show_name} - S{season}E{episode} - {episode_title}',
      item,
      '.mkv',
    );
    // The "/" in the episode title gets sanitized out
    expect(result).toBe('Stargate Universe - S01E01-02 - Air (1) Air (2).mkv');
  });
});
