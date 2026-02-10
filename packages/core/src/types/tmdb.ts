export interface TmdbSearchTvResponse {
  page: number;
  results: TmdbTvResult[];
  total_pages: number;
  total_results: number;
}

export interface TmdbTvResult {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string;
  popularity: number;
  vote_average: number;
  poster_path: string | null;
  origin_country: string[];
}

export interface TmdbSearchMovieResponse {
  page: number;
  results: TmdbMovieResult[];
  total_pages: number;
  total_results: number;
}

export interface TmdbMovieResult {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  popularity: number;
  vote_average: number;
  poster_path: string | null;
  runtime?: number;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  original_title: string;
  release_date: string;
  runtime: number;
  overview: string;
  popularity: number;
  genres: Array<{ id: number; name: string }>;
}

export interface TmdbSeasonDetails {
  id: number;
  season_number: number;
  name: string;
  episodes: TmdbEpisode[];
}

export interface TmdbEpisode {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string;
  runtime: number | null;
  still_path: string | null;
}

export interface TmdbTvDetails {
  id: number;
  name: string;
  original_name: string;
  first_air_date: string;
  number_of_seasons: number;
  number_of_episodes: number;
  episode_run_time: number[];
  overview: string;
  popularity: number;
  genres: Array<{ id: number; name: string }>;
}
