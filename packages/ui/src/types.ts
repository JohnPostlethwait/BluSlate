export interface ConfidenceBreakdownItem {
  label: string;
  points: number;
  maxPoints?: number;
}

export interface MatchResultData {
  mediaFile: { filePath: string; fileName: string; extension: string; sizeBytes: number };
  parsed: { mediaType: string; title: string; season?: number; episodeNumbers?: number[] };
  probeData?: { durationSeconds?: number; durationMinutes?: number };
  tmdbMatch?: {
    id: number;
    name: string;
    year?: number;
    runtime?: number;
    mediaType: string;
    seasonNumber?: number;
    episodeNumber?: number;
    episodeNumberEnd?: number;
    episodeTitle?: string;
    seasonEpisodeCount?: number;
    seasonEpisodes?: Array<{
      episodeNumber: number;
      episodeName: string;
      runtime: number | null;
    }>;
  };
  confidence: number;
  confidenceBreakdown?: ConfidenceBreakdownItem[];
  newFilename: string;
  status: 'matched' | 'ambiguous' | 'unmatched';
  warnings?: string[];
  matchSource?: 'dvdcompare' | 'tmdb';
  dvdCompareUsed?: boolean;
  dvdCompareRuntimeSeconds?: number;
  dvdCompareTitle?: string;
}

export interface ShowCandidate {
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

export interface DvdCompareCandidate {
  fid: number;
  title: string;
  years: string;
  isBluray: boolean;
  episodeCount?: number;
}
