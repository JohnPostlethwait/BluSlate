import { RateLimiter } from './rate-limiter.js';
import { LRUCache } from './cache.js';
import { logger } from '../utils/logger.js';
import { AuthenticationError } from '../errors.js';
import type {
  TmdbSearchTvResponse,
  TmdbSeasonDetails,
  TmdbTvDetails,
} from '../types/tmdb.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
const REQUEST_TIMEOUT_MS = 30_000;

export class TmdbClient {
  private readonly apiKey: string;
  private readonly language: string;
  private readonly rateLimiter = new RateLimiter();
  private readonly cache = new LRUCache<unknown>();

  constructor(apiKey: string, language: string = 'en-US') {
    this.apiKey = apiKey;
    this.language = language;
  }

  private async request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    url.searchParams.set('language', this.language);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const cacheKey = url.toString();
    const cached = this.cache.get(cacheKey) as T | undefined;
    if (cached) {
      logger.tmdb(`Cache hit: ${path}`);
      return cached;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.rateLimiter.acquire();

      logger.tmdb(`${attempt > 0 ? `Retry ${attempt}: ` : ''}GET ${path}`);

      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          response = await fetch(url.toString(), {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Accept': 'application/json',
            },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err) {
        // Sanitize network errors — they may contain the full URL with auth headers
        const safeMessage = err instanceof Error ? err.message : 'Unknown network error';
        throw new Error(`TMDb API network error on ${path}: ${safeMessage}`);
      }

      if (response.status === 401) {
        throw new AuthenticationError(
          'TMDb API authentication failed. Check your API key.\n' +
          'Get a free API key at: https://www.themoviedb.org/settings/api\n' +
          'Note: Use the "API Read Access Token" (v4 auth), not the "API Key" (v3 auth).'
        );
      }

      if (response.status === 429 && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] ?? 4000;
        logger.warn(`Rate limited, waiting ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] ?? 4000;
        logger.warn(`Server error ${response.status}, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`TMDb API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as T;
      this.cache.set(cacheKey, data);
      return data;
    }

    throw new Error(`TMDb API request failed after ${MAX_RETRIES} retries: ${path}`);
  }

  async searchTv(query: string, year?: number): Promise<TmdbSearchTvResponse> {
    const params: Record<string, string> = { query };
    if (year) params['first_air_date_year'] = String(year);
    return this.request<TmdbSearchTvResponse>('/search/tv', params);
  }

  async getTvDetails(tvId: number): Promise<TmdbTvDetails> {
    return this.request<TmdbTvDetails>(`/tv/${tvId}`);
  }

  async getSeasonDetails(tvId: number, seasonNumber: number): Promise<TmdbSeasonDetails> {
    return this.request<TmdbSeasonDetails>(`/tv/${tvId}/season/${seasonNumber}`);
  }

}
