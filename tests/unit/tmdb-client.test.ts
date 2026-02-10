import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger
vi.mock('../../packages/core/src/utils/logger.js', () => ({
  logger: {
    tmdb: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { TmdbClient } from '../../packages/core/src/api/tmdb-client.js';
import { AuthenticationError } from '../../packages/core/src/errors.js';

// Store original fetch
const originalFetch = globalThis.fetch;

describe('TmdbClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeJsonResponse(data: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(data),
      headers: new Headers(),
    } as Response;
  }

  describe('constructor', () => {
    it('should create a client with API key and default language', () => {
      const client = new TmdbClient('test-key');
      expect(client).toBeDefined();
    });

    it('should create a client with custom language', () => {
      const client = new TmdbClient('test-key', 'de-DE');
      expect(client).toBeDefined();
    });
  });

  describe('searchTv', () => {
    it('should search for TV shows', async () => {
      const responseData = { page: 1, results: [{ id: 1, name: 'Breaking Bad' }], total_pages: 1, total_results: 1 };
      mockFetch.mockResolvedValue(makeJsonResponse(responseData));

      const client = new TmdbClient('test-key');
      const result = await client.searchTv('Breaking Bad');

      expect(result).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledOnce();

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.pathname).toBe('/3/search/tv');
      expect(url.searchParams.get('query')).toBe('Breaking Bad');
      expect(url.searchParams.get('language')).toBe('en-US');
    });

    it('should include year filter when provided', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ page: 1, results: [], total_pages: 0, total_results: 0 }));

      const client = new TmdbClient('test-key');
      await client.searchTv('Breaking Bad', 2008);

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('first_air_date_year')).toBe('2008');
    });
  });

  describe('searchMovie', () => {
    it('should search for movies', async () => {
      const responseData = { page: 1, results: [{ id: 1, title: 'Inception' }], total_pages: 1, total_results: 1 };
      mockFetch.mockResolvedValue(makeJsonResponse(responseData));

      const client = new TmdbClient('test-key');
      const result = await client.searchMovie('Inception');

      expect(result).toEqual(responseData);
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.pathname).toBe('/3/search/movie');
      expect(url.searchParams.get('query')).toBe('Inception');
    });

    it('should include year filter when provided', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ page: 1, results: [], total_pages: 0, total_results: 0 }));

      const client = new TmdbClient('test-key');
      await client.searchMovie('Inception', 2010);

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('year')).toBe('2010');
    });
  });

  describe('getTvDetails', () => {
    it('should fetch TV details by ID', async () => {
      const details = { id: 1396, name: 'Breaking Bad', episode_run_time: [45] };
      mockFetch.mockResolvedValue(makeJsonResponse(details));

      const client = new TmdbClient('test-key');
      const result = await client.getTvDetails(1396);

      expect(result).toEqual(details);
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.pathname).toBe('/3/tv/1396');
    });
  });

  describe('getSeasonDetails', () => {
    it('should fetch season details', async () => {
      const seasonData = { id: 100, season_number: 1, episodes: [] };
      mockFetch.mockResolvedValue(makeJsonResponse(seasonData));

      const client = new TmdbClient('test-key');
      const result = await client.getSeasonDetails(1396, 1);

      expect(result).toEqual(seasonData);
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.pathname).toBe('/3/tv/1396/season/1');
    });
  });

  describe('getMovieDetails', () => {
    it('should fetch movie details by ID', async () => {
      const movieData = { id: 27205, title: 'Inception', runtime: 148 };
      mockFetch.mockResolvedValue(makeJsonResponse(movieData));

      const client = new TmdbClient('test-key');
      const result = await client.getMovieDetails(27205);

      expect(result).toEqual(movieData);
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.pathname).toBe('/3/movie/27205');
    });
  });

  describe('authentication', () => {
    it('should include Bearer token in Authorization header', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ page: 1, results: [] }));

      const client = new TmdbClient('my-secret-token');
      await client.searchTv('test');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer my-secret-token');
    });

    it('should throw AuthenticationError on 401 response', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({}, 401));

      const client = new TmdbClient('bad-key');

      await expect(client.searchTv('test')).rejects.toThrow(AuthenticationError);
    });

    it('should not retry on 401', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({}, 401));

      const client = new TmdbClient('bad-key');

      try {
        await client.searchTv('test');
      } catch {
        // Expected
      }

      // 401 should not retry — only 1 call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry logic', () => {
    // Override setTimeout to resolve instantly for retry delay tests
    let originalSetTimeout: typeof globalThis.setTimeout;

    beforeEach(() => {
      originalSetTimeout = globalThis.setTimeout;
      // Make setTimeout resolve nearly instantly for retry delay tests
      globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number) => {
        return originalSetTimeout(fn, 0);
      }) as unknown as typeof globalThis.setTimeout;
    });

    afterEach(() => {
      globalThis.setTimeout = originalSetTimeout;
    });

    it('should retry on 429 (rate limited)', async () => {
      // First call: 429, second call: success
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse({}, 429))
        .mockResolvedValueOnce(makeJsonResponse({ page: 1, results: [] }));

      const client = new TmdbClient('test-key');
      const result = await client.searchTv('test');

      expect(result).toEqual({ page: 1, results: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 5xx server errors', async () => {
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse({}, 500))
        .mockResolvedValueOnce(makeJsonResponse({ page: 1, results: [] }));

      const client = new TmdbClient('test-key');
      const result = await client.searchTv('test');

      expect(result).toEqual({ page: 1, results: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting retries on 429', async () => {
      // All responses are 429
      mockFetch.mockResolvedValue(makeJsonResponse({}, 429));

      const client = new TmdbClient('test-key');

      // After MAX_RETRIES, the final attempt falls through to the generic error handler
      await expect(client.searchTv('test')).rejects.toThrow(/TMDb API error: 429/);

      // Initial + 3 retries = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should throw after exhausting retries on 500', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({}, 500));

      const client = new TmdbClient('test-key');

      await expect(client.searchTv('test')).rejects.toThrow(/TMDb API error: 500/);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should throw immediately on non-retryable errors (e.g. 404)', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({}, 404));

      const client = new TmdbClient('test-key');

      await expect(client.searchTv('test')).rejects.toThrow(/TMDb API error: 404/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('caching', () => {
    it('should cache responses and return cached data on repeated calls', async () => {
      const data = { page: 1, results: [{ id: 1 }], total_pages: 1, total_results: 1 };
      mockFetch.mockResolvedValue(makeJsonResponse(data));

      const client = new TmdbClient('test-key');

      const result1 = await client.searchTv('Breaking Bad');
      const result2 = await client.searchTv('Breaking Bad');

      expect(result1).toEqual(data);
      expect(result2).toEqual(data);
      // Should only fetch once — second call served from cache
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not cache different queries', async () => {
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse({ page: 1, results: [{ id: 1 }] }))
        .mockResolvedValueOnce(makeJsonResponse({ page: 1, results: [{ id: 2 }] }));

      const client = new TmdbClient('test-key');

      await client.searchTv('Breaking Bad');
      await client.searchTv('Better Call Saul');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('language parameter', () => {
    it('should use default language en-US', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ page: 1, results: [] }));

      const client = new TmdbClient('test-key');
      await client.searchTv('test');

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('language')).toBe('en-US');
    });

    it('should use custom language', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ page: 1, results: [] }));

      const client = new TmdbClient('test-key', 'ja-JP');
      await client.searchTv('test');

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('language')).toBe('ja-JP');
    });
  });

  describe('network error handling', () => {
    it('should wrap network errors without exposing the full URL', async () => {
      mockFetch.mockRejectedValue(new Error('fetch failed'));

      const client = new TmdbClient('super-secret-token');

      await expect(client.searchTv('test')).rejects.toThrow(/TMDb API network error/);
      // Error message should NOT contain the API key
      try {
        await client.searchTv('test');
      } catch (err) {
        expect((err as Error).message).not.toContain('super-secret-token');
        expect((err as Error).message).toContain('/search/tv');
      }
    });
  });
});
