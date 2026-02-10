import { describe, it, expect } from 'vitest';
import { renderTemplate, getTemplate } from '../../src/config/templates.js';
import { MediaType } from '../../src/types/media.js';
import type { TmdbMatchedItem } from '../../src/types/media.js';

describe('getTemplate', () => {
  it('should return TV template for TV type', () => {
    const template = getTemplate(MediaType.TV);
    expect(template).toContain('{show_name}');
    expect(template).toContain('{season}');
    expect(template).toContain('{episode}');
  });

  it('should return movie template for Movie type', () => {
    const template = getTemplate(MediaType.Movie);
    expect(template).toContain('{title}');
    expect(template).toContain('{year}');
  });

  it('should return custom template when provided', () => {
    const custom = '{title} - Custom';
    expect(getTemplate(MediaType.TV, custom)).toBe(custom);
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

  it('should render movie template correctly', () => {
    const item: TmdbMatchedItem = {
      id: 1,
      name: 'Inception',
      year: 2010,
      mediaType: MediaType.Movie,
      searchRank: 0,
    };

    const result = renderTemplate('{title} ({year})', item, '.mkv');
    expect(result).toBe('Inception (2010).mkv');
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
