/// <reference types="svelte" />
/// <reference types="vite/client" />

interface Window {
  api: {
    selectDirectory: () => Promise<string | null>;
    cancelPipeline: () => void;
    startPipeline: (options: {
      directory: string;
      apiKey: string;
      dryRun: boolean;
      recursive: boolean;
      language: string;
      autoAccept: boolean;
      minConfidence: number;
      template?: string;
      mediaType?: string;
    }) => void;
    onProgress: (callback: (event: string, data: { message?: string }) => void) => () => void;
    onResults: (callback: (data: { matches: MatchResultData[]; scanDirectory: string }) => void) => () => void;
    onSummary: (callback: (data: { renamed: number; skipped: number; failed: number; dryRun: boolean }) => void) => () => void;
    onConfirmRenames: (callback: (data: { matches: MatchResultData[] }) => void) => () => void;
    respondConfirmRenames: (confirmed: MatchResultData[]) => void;
    onConfirmShow: (callback: (data: { showName: string; candidates: ShowCandidate[] }) => void) => () => void;
    respondConfirmShow: (selected: ShowCandidate | { __retry: string } | null) => void;
    onConfirmDvdCompare: (callback: (data: { showName: string; candidates: DvdCompareCandidate[] }) => void) => () => void;
    respondConfirmDvdCompare: (selected: DvdCompareCandidate[]) => void;
    onPipelineComplete: (callback: (data: { success: boolean }) => void) => () => void;
    onPipelineError: (callback: (data: { message: string }) => void) => () => void;
    onMenuOpenDirectory: (callback: (directory: string) => void) => () => void;
    regenerateFilenames: (items: Array<{ tmdbMatch: MatchResultData['tmdbMatch']; extension: string }>) => Promise<string[]>;
    undoRenames: (directory: string) => Promise<{ restored: number; failed: number }>;
    checkFfprobe: () => Promise<boolean>;
    loadSettings: () => Promise<{ apiKey?: string; recentDirectories: string[] }>;
    saveApiKey: (apiKey: string) => Promise<void>;
    getRecentDirectories: () => Promise<string[]>;
  };
}

interface ConfidenceBreakdownItem {
  label: string;
  points: number;
  maxPoints?: number;
}

interface MatchResultData {
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

interface ShowCandidate {
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

interface DvdCompareCandidate {
  fid: number;
  title: string;
  years: string;
  isBluray: boolean;
  episodeCount?: number;
}
