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

type ConfidenceBreakdownItem = import('@bluslate/ui').ConfidenceBreakdownItem;
type MatchResultData = import('@bluslate/ui').MatchResultData;
type ShowCandidate = import('@bluslate/ui').ShowCandidate;
type DvdCompareCandidate = import('@bluslate/ui').DvdCompareCandidate;
