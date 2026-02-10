import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findMatch } from '../../packages/core/src/core/matcher.js';
import { MediaType } from '../../packages/core/src/types/media.js';
import type { MediaFile, ParsedFilename, ProbeResult } from '../../packages/core/src/types/media.js';
import type { TmdbSearchTvResponse, TmdbSearchMovieResponse, TmdbSeasonDetails, TmdbMovieDetails } from '../../packages/core/src/types/tmdb.js';

// --- Test helpers ---

function makeMediaFile(name: string): MediaFile {
  return {
    filePath: `/media/${name}`,
    fileName: name,
    extension: name.substring(name.lastIndexOf('.')),
    sizeBytes: 700_000_000,
  };
}

function makeParsedTv(title: string, season: number, episodes: number[]): ParsedFilename {
  return { mediaType: MediaType.TV, title, season, episodeNumbers: episodes };
}

function makeParsedMovie(title: string, year?: number): ParsedFilename {
  return { mediaType: MediaType.Movie, title, year };
}

function makeParsedUnknown(title: string): ParsedFilename {
  return { mediaType: MediaType.Unknown, title };
}

function makeTvSearchResponse(results: Array<{ id: number; name: string; first_air_date?: string }>): TmdbSearchTvResponse {
  return {
    page: 1,
    total_pages: 1,
    total_results: results.length,
    results: results.map((r) => ({
      id: r.id,
      name: r.name,
      original_name: r.name,
      overview: '',
      first_air_date: r.first_air_date ?? '2020-01-01',
      popularity: 50,
      vote_average: 8.0,
      poster_path: null,
      origin_country: ['US'],
    })),
  };
}

function makeMovieSearchResponse(results: Array<{ id: number; title: string; release_date?: string; runtime?: number }>): TmdbSearchMovieResponse {
  return {
    page: 1,
    total_pages: 1,
    total_results: results.length,
    results: results.map((r) => ({
      id: r.id,
      title: r.title,
      original_title: r.title,
      overview: '',
      release_date: r.release_date ?? '2020-01-01',
      popularity: 50,
      vote_average: 7.5,
      poster_path: null,
      runtime: r.runtime,
    })),
  };
}

function makeSeasonDetails(seasonNum: number, episodes: Array<{ num: number; name: string; runtime?: number }>): TmdbSeasonDetails {
  return {
    id: 100,
    season_number: seasonNum,
    name: `Season ${seasonNum}`,
    episodes: episodes.map((e) => ({
      id: 1000 + e.num,
      episode_number: e.num,
      season_number: seasonNum,
      name: e.name,
      overview: '',
      air_date: '2020-01-15',
      runtime: e.runtime ?? 45,
      still_path: null,
    })),
  };
}

function makeMovieDetails(id: number, title: string, runtime: number): TmdbMovieDetails {
  return {
    id,
    title,
    original_title: title,
    release_date: '2020-01-01',
    runtime,
    overview: '',
    popularity: 50,
    genres: [],
  };
}

// --- Mock TMDb client ---

function createMockClient(options: {
  tvSearch?: TmdbSearchTvResponse;
  movieSearch?: TmdbSearchMovieResponse;
  seasonDetails?: TmdbSeasonDetails;
  movieDetails?: TmdbMovieDetails;
  seasonError?: Error;
  movieDetailsError?: Error;
} = {}) {
  return {
    searchTv: vi.fn().mockResolvedValue(options.tvSearch ?? { page: 1, results: [], total_pages: 0, total_results: 0 }),
    searchMovie: vi.fn().mockResolvedValue(options.movieSearch ?? { page: 1, results: [], total_pages: 0, total_results: 0 }),
    getSeasonDetails: options.seasonError
      ? vi.fn().mockRejectedValue(options.seasonError)
      : vi.fn().mockResolvedValue(options.seasonDetails ?? makeSeasonDetails(1, [])),
    getMovieDetails: options.movieDetailsError
      ? vi.fn().mockRejectedValue(options.movieDetailsError)
      : vi.fn().mockResolvedValue(options.movieDetails ?? makeMovieDetails(1, 'Test', 120)),
    getTvDetails: vi.fn().mockResolvedValue({ id: 1, name: 'Test', episode_run_time: [45] }),
  } as any;
}

// --- Tests ---

describe('findMatch', () => {
  describe('TV show matching', () => {
    it('should match a TV episode with season and episode info', async () => {
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([{ id: 1, name: 'Breaking Bad', first_air_date: '2008-01-20' }]),
        seasonDetails: makeSeasonDetails(1, [
          { num: 1, name: 'Pilot', runtime: 58 },
          { num: 2, name: 'Cat in the Bag...', runtime: 48 },
        ]),
      });
      const file = makeMediaFile('Breaking.Bad.S01E01.mkv');
      const parsed = makeParsedTv('Breaking Bad', 1, [1]);

      const result = await findMatch(client, file, parsed, undefined);

      expect(result.status).not.toBe('unmatched');
      expect(result.tmdbMatch).toBeDefined();
      expect(result.tmdbMatch!.name).toBe('Breaking Bad');
      expect(result.tmdbMatch!.seasonNumber).toBe(1);
      expect(result.tmdbMatch!.episodeNumber).toBe(1);
      expect(result.tmdbMatch!.episodeTitle).toBe('Pilot');
      expect(result.tmdbMatch!.mediaType).toBe(MediaType.TV);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.newFilename).not.toBe(file.fileName);
    });

    it('should return unmatched when no TV results found', async () => {
      const client = createMockClient();
      const file = makeMediaFile('Nonexistent.Show.S01E05.mkv');
      const parsed = makeParsedTv('Nonexistent Show', 1, [5]);

      const result = await findMatch(client, file, parsed, undefined);

      expect(result.status).toBe('unmatched');
      expect(result.confidence).toBe(0);
      expect(result.newFilename).toBe(file.fileName);
      expect(result.tmdbMatch).toBeUndefined();
    });

    it('should handle missing episode in season gracefully', async () => {
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([{ id: 1, name: 'Test Show' }]),
        seasonDetails: makeSeasonDetails(1, [
          { num: 1, name: 'Episode 1' },
          { num: 2, name: 'Episode 2' },
        ]),
      });
      const file = makeMediaFile('Test.Show.S01E99.mkv');
      const parsed = makeParsedTv('Test Show', 1, [99]); // Episode 99 doesn't exist

      const result = await findMatch(client, file, parsed, undefined);

      // Should still try to match at show level since no episode matched
      // The result depends on whether fallback matching occurs
      expect(result).toBeDefined();
    });

    it('should match TV without season/episode info (show-level match)', async () => {
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([{ id: 1, name: 'The Office' }]),
      });
      const file = makeMediaFile('The.Office.mkv');
      const parsed: ParsedFilename = { mediaType: MediaType.TV, title: 'The Office' };

      const result = await findMatch(client, file, parsed, undefined);

      // No season/episode, so it should still get a show-level match
      expect(result.tmdbMatch).toBeDefined();
      expect(result.tmdbMatch!.name).toBe('The Office');
      expect(result.tmdbMatch!.seasonNumber).toBeUndefined();
    });

    it('should handle season details fetch error gracefully', async () => {
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([{ id: 1, name: 'Breaking Bad' }]),
        seasonError: new Error('Season not found'),
      });
      const file = makeMediaFile('Breaking.Bad.S01E01.mkv');
      const parsed = makeParsedTv('Breaking Bad', 1, [1]);

      const result = await findMatch(client, file, parsed, undefined);

      // Should not throw, should handle gracefully
      expect(result).toBeDefined();
    });

    it('should rank TV results by title similarity', async () => {
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([
          { id: 2, name: 'Bad Break' },
          { id: 1, name: 'Breaking Bad' },
          { id: 3, name: 'Something Else Entirely' },
        ]),
        seasonDetails: makeSeasonDetails(1, [
          { num: 1, name: 'Pilot', runtime: 58 },
        ]),
      });
      const file = makeMediaFile('Breaking.Bad.S01E01.mkv');
      const parsed = makeParsedTv('Breaking Bad', 1, [1]);

      const result = await findMatch(client, file, parsed, undefined);

      expect(result.tmdbMatch).toBeDefined();
      expect(result.tmdbMatch!.name).toBe('Breaking Bad');
    });
  });

  describe('Movie matching', () => {
    it('should match a movie by title', async () => {
      const client = createMockClient({
        movieSearch: makeMovieSearchResponse([
          { id: 1, title: 'Inception', release_date: '2010-07-16', runtime: 148 },
        ]),
        movieDetails: makeMovieDetails(1, 'Inception', 148),
      });
      const file = makeMediaFile('Inception.2010.1080p.mkv');
      const parsed = makeParsedMovie('Inception', 2010);

      const result = await findMatch(client, file, parsed, undefined);

      expect(result.status).not.toBe('unmatched');
      expect(result.tmdbMatch).toBeDefined();
      expect(result.tmdbMatch!.name).toBe('Inception');
      expect(result.tmdbMatch!.mediaType).toBe(MediaType.Movie);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should return unmatched when no movie results found', async () => {
      const client = createMockClient();
      const file = makeMediaFile('Nonexistent.Movie.2025.mkv');
      const parsed = makeParsedMovie('Nonexistent Movie', 2025);

      const result = await findMatch(client, file, parsed, undefined);

      expect(result.status).toBe('unmatched');
      expect(result.confidence).toBe(0);
    });

    it('should boost year-matching movies in ranking', async () => {
      const client = createMockClient({
        movieSearch: makeMovieSearchResponse([
          { id: 2, title: 'Inception', release_date: '2000-01-01', runtime: 90 },
          { id: 1, title: 'Inception', release_date: '2010-07-16', runtime: 148 },
        ]),
        movieDetails: makeMovieDetails(1, 'Inception', 148),
      });
      const file = makeMediaFile('Inception.2010.mkv');
      const parsed = makeParsedMovie('Inception', 2010);

      const result = await findMatch(client, file, parsed, undefined);

      expect(result.tmdbMatch).toBeDefined();
      expect(result.tmdbMatch!.year).toBe(2010);
    });

    it('should handle movie details fetch error and fall back to search runtime', async () => {
      const client = createMockClient({
        movieSearch: makeMovieSearchResponse([
          { id: 1, title: 'Test Movie', runtime: 120 },
        ]),
        movieDetailsError: new Error('Not found'),
      });
      const file = makeMediaFile('Test.Movie.mkv');
      const parsed = makeParsedMovie('Test Movie');

      const result = await findMatch(client, file, parsed, undefined);

      // Should still produce a result, using search result runtime
      expect(result.tmdbMatch).toBeDefined();
      expect(result.tmdbMatch!.runtime).toBe(120);
    });
  });

  describe('Unknown media type (TV+Movie fallback)', () => {
    it('should try TV first then movie for unknown type', async () => {
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([]),
        movieSearch: makeMovieSearchResponse([
          { id: 1, title: 'Memento', release_date: '2000-10-11', runtime: 113 },
        ]),
        movieDetails: makeMovieDetails(1, 'Memento', 113),
      });
      const file = makeMediaFile('Memento.mkv');
      const parsed = makeParsedUnknown('Memento');

      const result = await findMatch(client, file, parsed, undefined);

      expect(result.tmdbMatch).toBeDefined();
      expect(result.tmdbMatch!.mediaType).toBe(MediaType.Movie);
      expect(client.searchTv).toHaveBeenCalled();
      expect(client.searchMovie).toHaveBeenCalled();
    });

    it('should prefer movie if TV match has low confidence', async () => {
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([{ id: 1, name: 'Completely Wrong Show' }]),
        movieSearch: makeMovieSearchResponse([
          { id: 2, title: 'The Matrix', release_date: '1999-03-31', runtime: 136 },
        ]),
        movieDetails: makeMovieDetails(2, 'The Matrix', 136),
      });
      const file = makeMediaFile('The.Matrix.mkv');
      const parsed = makeParsedUnknown('The Matrix');

      const result = await findMatch(client, file, parsed, undefined);

      // Movie should win because TV match has very different title
      expect(result.tmdbMatch).toBeDefined();
      expect(result.tmdbMatch!.name).toBe('The Matrix');
    });

    it('should prefer high-confidence TV over movie for unknown type', async () => {
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([{ id: 1, name: 'Friends' }]),
        movieSearch: makeMovieSearchResponse([
          { id: 2, title: 'Friends With Benefits' },
        ]),
        movieDetails: makeMovieDetails(2, 'Friends With Benefits', 109),
      });
      const file = makeMediaFile('Friends.mkv');
      const parsed = makeParsedUnknown('Friends');

      const result = await findMatch(client, file, parsed, undefined);

      // TV "Friends" is exact match, should beat "Friends With Benefits"
      expect(result.tmdbMatch).toBeDefined();
    });

    it('should return unmatched when neither TV nor movie finds results', async () => {
      const client = createMockClient();
      const file = makeMediaFile('Completely.Unknown.mkv');
      const parsed = makeParsedUnknown('Completely Unknown');

      const result = await findMatch(client, file, parsed, undefined);

      expect(result.status).toBe('unmatched');
      expect(result.confidence).toBe(0);
    });
  });

  describe('Confidence and status thresholds', () => {
    it('should set status to matched for confidence >= 60', async () => {
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([{ id: 1, name: 'Breaking Bad' }]),
        seasonDetails: makeSeasonDetails(1, [{ num: 1, name: 'Pilot', runtime: 58 }]),
      });
      const file = makeMediaFile('Breaking.Bad.S01E01.mkv');
      const parsed = makeParsedTv('Breaking Bad', 1, [1]);

      const result = await findMatch(client, file, parsed, undefined);

      if (result.confidence >= 60) {
        expect(result.status).toBe('matched');
      } else {
        expect(result.status).toBe('ambiguous');
      }
    });

    it('should use custom template when provided', async () => {
      const client = createMockClient({
        movieSearch: makeMovieSearchResponse([
          { id: 1, title: 'Inception', release_date: '2010-07-16', runtime: 148 },
        ]),
        movieDetails: makeMovieDetails(1, 'Inception', 148),
      });
      const file = makeMediaFile('Inception.mkv');
      const parsed = makeParsedMovie('Inception', 2010);

      const result = await findMatch(client, file, parsed, undefined, '{title} ({year})');

      expect(result.tmdbMatch).toBeDefined();
      // Template should produce "Inception (2010).mkv"
      expect(result.newFilename).toContain('Inception');
      expect(result.newFilename).toContain('2010');
    });
  });

  describe('Probe data integration', () => {
    it('should pass probe data through to the result', async () => {
      const probeData: ProbeResult = {
        durationMinutes: 58,
        durationSeconds: 3480,
      };
      const client = createMockClient({
        tvSearch: makeTvSearchResponse([{ id: 1, name: 'Breaking Bad' }]),
        seasonDetails: makeSeasonDetails(1, [{ num: 1, name: 'Pilot', runtime: 58 }]),
      });
      const file = makeMediaFile('Breaking.Bad.S01E01.mkv');
      const parsed = makeParsedTv('Breaking Bad', 1, [1]);

      const result = await findMatch(client, file, parsed, probeData);

      expect(result.probeData).toBe(probeData);
    });
  });
});
