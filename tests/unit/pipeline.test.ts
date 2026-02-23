import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all core dependencies
vi.mock('../../packages/core/src/core/scanner.js', () => ({
  scanDirectory: vi.fn(),
}));

vi.mock('../../packages/core/src/core/parser.js', () => ({
  parseFilename: vi.fn(),
}));

vi.mock('../../packages/core/src/core/prober.js', () => ({
  probeFile: vi.fn(),
}));

vi.mock('../../packages/core/src/core/matcher.js', () => ({
  findMatch: vi.fn(),
}));

vi.mock('../../packages/core/src/core/renamer.js', () => ({
  executeRenames: vi.fn(),
  writeRenameLog: vi.fn(),
}));

vi.mock('../../packages/core/src/core/directory-parser.js', () => ({
  shouldUseBatchMode: vi.fn(() => false),
  groupFilesBySeason: vi.fn(),
}));

vi.mock('../../packages/core/src/core/batch-matcher.js', () => ({
  identifyShow: vi.fn(),
  classifyAndSortFiles: vi.fn(),
  matchSeasonBatch: vi.fn(),
  matchSpecialsBatch: vi.fn(),
}));

vi.mock('../../packages/core/src/api/tmdb-client.js', () => {
  return {
    TmdbClient: class MockTmdbClient {
      searchTv = vi.fn();
      searchMovie = vi.fn();
      getSeasonDetails = vi.fn();
      getMovieDetails = vi.fn();
      getTvDetails = vi.fn();
    },
  };
});

vi.mock('../../packages/core/src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    scan: vi.fn(),
    rename: vi.fn(),
    tmdb: vi.fn(),
  },
}));

import { runPipeline } from '../../packages/core/src/core/pipeline.js';
import { scanDirectory } from '../../packages/core/src/core/scanner.js';
import { parseFilename } from '../../packages/core/src/core/parser.js';
import { probeFile } from '../../packages/core/src/core/prober.js';
import { findMatch } from '../../packages/core/src/core/matcher.js';
import { executeRenames, writeRenameLog } from '../../packages/core/src/core/renamer.js';
import { shouldUseBatchMode } from '../../packages/core/src/core/directory-parser.js';
import { MediaType } from '../../packages/core/src/types/media.js';
import { FatalError, AuthenticationError } from '../../packages/core/src/errors.js';
import type { AppConfig } from '../../packages/core/src/types/config.js';
import type { UIAdapter } from '../../packages/core/src/types/ui-adapter.js';

const mockedScanDirectory = vi.mocked(scanDirectory);
const mockedParseFilename = vi.mocked(parseFilename);
const mockedProbeFile = vi.mocked(probeFile);
const mockedFindMatch = vi.mocked(findMatch);
const mockedExecuteRenames = vi.mocked(executeRenames);
const mockedWriteRenameLog = vi.mocked(writeRenameLog);
const mockedShouldUseBatchMode = vi.mocked(shouldUseBatchMode);

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    apiKey: 'test-key',
    directory: '/media',
    dryRun: false,
    mediaType: 'auto',
    recursive: false,
    verbose: false,
    autoAccept: false,
    minConfidence: 85,
    language: 'en-US',
    ...overrides,
  };
}

function makeUIAdapter(): UIAdapter {
  return {
    progress: {
      start: vi.fn(),
      update: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    },
    prompts: {
      confirmRenames: vi.fn().mockResolvedValue([]),
      confirmShowIdentification: vi.fn(),
      confirmDvdCompareSelection: vi.fn().mockResolvedValue([]),
    },
    display: {
      displayResults: vi.fn(),
      displaySummary: vi.fn(),
    },
  };
}

function makeMediaFile(name: string) {
  return {
    filePath: `/media/${name}`,
    fileName: name,
    extension: name.substring(name.lastIndexOf('.')),
    sizeBytes: 700_000_000,
  };
}

describe('runPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedShouldUseBatchMode.mockReturnValue(false);
  });

  it('should scan directory and report file count', async () => {
    mockedScanDirectory.mockResolvedValue([]);
    const ui = makeUIAdapter();

    await runPipeline(makeConfig(), ui);

    expect(mockedScanDirectory).toHaveBeenCalledWith('/media', false);
    expect(ui.progress.start).toHaveBeenCalledWith('Scanning for media files...');
    expect(ui.progress.succeed).toHaveBeenCalledWith('Found 0 media file(s)');
  });

  it('should return early when no media files found', async () => {
    mockedScanDirectory.mockResolvedValue([]);
    const ui = makeUIAdapter();

    await runPipeline(makeConfig(), ui);

    // Should not call any processing steps
    expect(mockedParseFilename).not.toHaveBeenCalled();
    expect(mockedFindMatch).not.toHaveBeenCalled();
    expect(ui.display.displayResults).not.toHaveBeenCalled();
  });

  it('should scan recursively when configured', async () => {
    mockedScanDirectory.mockResolvedValue([]);
    const ui = makeUIAdapter();

    await runPipeline(makeConfig({ recursive: true }), ui);

    expect(mockedScanDirectory).toHaveBeenCalledWith('/media', true);
  });

  it('should parse, probe, and match each file in per-file mode', async () => {
    const file = makeMediaFile('Breaking.Bad.S01E01.mkv');
    mockedScanDirectory.mockResolvedValue([file]);
    mockedParseFilename.mockReturnValue({ mediaType: MediaType.TV, title: 'Breaking Bad', season: 1, episodeNumbers: [1] });
    mockedProbeFile.mockResolvedValue(null);
    mockedFindMatch.mockResolvedValue({
      mediaFile: file,
      parsed: { mediaType: MediaType.TV, title: 'Breaking Bad', season: 1, episodeNumbers: [1] },
      confidence: 95,
      newFilename: 'Breaking Bad - S01E01 - Pilot.mkv',
      status: 'matched',
      tmdbMatch: { id: 1, name: 'Breaking Bad', mediaType: MediaType.TV, seasonNumber: 1, episodeNumber: 1, episodeTitle: 'Pilot' },
    });

    const ui = makeUIAdapter();
    await runPipeline(makeConfig(), ui);

    expect(mockedParseFilename).toHaveBeenCalledWith('Breaking.Bad.S01E01.mkv');
    expect(mockedProbeFile).toHaveBeenCalledWith('/media/Breaking.Bad.S01E01.mkv');
    expect(mockedFindMatch).toHaveBeenCalledOnce();
    expect(ui.display.displayResults).toHaveBeenCalledOnce();
  });

  it('should display dry run summary and skip rename', async () => {
    const file = makeMediaFile('old.mkv');
    mockedScanDirectory.mockResolvedValue([file]);
    mockedParseFilename.mockReturnValue({ mediaType: MediaType.Movie, title: 'Movie' });
    mockedProbeFile.mockResolvedValue(null);
    mockedFindMatch.mockResolvedValue({
      mediaFile: file,
      parsed: { mediaType: MediaType.Movie, title: 'Movie' },
      confidence: 90,
      newFilename: 'Movie (2020).mkv',
      status: 'matched',
    });

    const ui = makeUIAdapter();
    await runPipeline(makeConfig({ dryRun: true }), ui);

    expect(ui.display.displaySummary).toHaveBeenCalledWith(1, 0, 0, true);
    expect(mockedExecuteRenames).not.toHaveBeenCalled();
  });

  it('should confirm renames and execute them', async () => {
    const file = makeMediaFile('old.mkv');
    const matchResult = {
      mediaFile: file,
      parsed: { mediaType: MediaType.Movie as MediaType, title: 'Movie' },
      confidence: 90,
      newFilename: 'Movie (2020).mkv',
      status: 'matched' as const,
    };

    mockedScanDirectory.mockResolvedValue([file]);
    mockedParseFilename.mockReturnValue({ mediaType: MediaType.Movie, title: 'Movie' });
    mockedProbeFile.mockResolvedValue(null);
    mockedFindMatch.mockResolvedValue(matchResult);
    mockedExecuteRenames.mockResolvedValue([{ from: 'old.mkv', to: 'Movie (2020).mkv' }]);
    mockedWriteRenameLog.mockResolvedValue(undefined);

    const ui = makeUIAdapter();
    vi.mocked(ui.prompts.confirmRenames).mockResolvedValue([matchResult]);

    await runPipeline(makeConfig(), ui);

    expect(ui.prompts.confirmRenames).toHaveBeenCalled();
    expect(mockedExecuteRenames).toHaveBeenCalledWith([matchResult], false);
    expect(mockedWriteRenameLog).toHaveBeenCalled();
    expect(ui.display.displaySummary).toHaveBeenCalledWith(1, 0, 0, false);
  });

  it('should not rename when user cancels confirmation', async () => {
    const file = makeMediaFile('old.mkv');
    mockedScanDirectory.mockResolvedValue([file]);
    mockedParseFilename.mockReturnValue({ mediaType: MediaType.Movie, title: 'Movie' });
    mockedProbeFile.mockResolvedValue(null);
    mockedFindMatch.mockResolvedValue({
      mediaFile: file,
      parsed: { mediaType: MediaType.Movie, title: 'Movie' },
      confidence: 90,
      newFilename: 'Movie (2020).mkv',
      status: 'matched',
    });

    const ui = makeUIAdapter();
    vi.mocked(ui.prompts.confirmRenames).mockResolvedValue([]); // User rejected all

    await runPipeline(makeConfig(), ui);

    expect(mockedExecuteRenames).not.toHaveBeenCalled();
  });

  it('should abort on FatalError during matching', async () => {
    const file = makeMediaFile('test.mkv');
    mockedScanDirectory.mockResolvedValue([file]);
    mockedParseFilename.mockReturnValue({ mediaType: MediaType.Movie, title: 'Test' });
    mockedProbeFile.mockResolvedValue(null);
    mockedFindMatch.mockRejectedValue(new AuthenticationError('Bad API key'));

    const ui = makeUIAdapter();

    await expect(runPipeline(makeConfig(), ui)).rejects.toThrow(AuthenticationError);
    expect(ui.progress.stop).toHaveBeenCalled();
  });

  it('should handle non-fatal errors per file and continue', async () => {
    const file1 = makeMediaFile('file1.mkv');
    const file2 = makeMediaFile('file2.mkv');
    mockedScanDirectory.mockResolvedValue([file1, file2]);
    mockedParseFilename.mockReturnValue({ mediaType: MediaType.Movie, title: 'Test' });
    mockedProbeFile.mockResolvedValue(null);

    // First file errors, second succeeds
    mockedFindMatch
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({
        mediaFile: file2,
        parsed: { mediaType: MediaType.Movie, title: 'Test' },
        confidence: 90,
        newFilename: 'Test (2020).mkv',
        status: 'matched',
      });

    const ui = makeUIAdapter();
    await runPipeline(makeConfig(), ui);

    // Should display results — first file unmatched (error), second matched
    expect(ui.display.displayResults).toHaveBeenCalled();
    const displayedMatches = vi.mocked(ui.display.displayResults).mock.calls[0][0];
    expect(displayedMatches).toHaveLength(2);
    expect(displayedMatches[0].status).toBe('unmatched'); // error fallback
    expect(displayedMatches[1].status).toBe('matched');
  });

  it('should override media type when configured', async () => {
    const file = makeMediaFile('test.mkv');
    mockedScanDirectory.mockResolvedValue([file]);
    mockedParseFilename.mockReturnValue({ mediaType: MediaType.Unknown, title: 'Test' });
    mockedProbeFile.mockResolvedValue(null);
    mockedFindMatch.mockResolvedValue({
      mediaFile: file,
      parsed: { mediaType: MediaType.TV, title: 'Test' },
      confidence: 0,
      newFilename: 'test.mkv',
      status: 'unmatched',
    });

    const ui = makeUIAdapter();
    await runPipeline(makeConfig({ mediaType: MediaType.TV }), ui);

    // findMatch should have been called with TV-overridden parsed data
    const parsedArg = mockedFindMatch.mock.calls[0][2];
    expect(parsedArg.mediaType).toBe(MediaType.TV);
  });

  it('should enrich parsed data with probe results', async () => {
    const file = makeMediaFile('episode.mkv');
    mockedScanDirectory.mockResolvedValue([file]);
    mockedParseFilename.mockReturnValue({ mediaType: MediaType.Unknown, title: '' });
    mockedProbeFile.mockResolvedValue({
      durationMinutes: 45,
      durationSeconds: 2700,
      showName: 'Probed Show',
      season: 2,
      episode: 5,
    });
    mockedFindMatch.mockResolvedValue({
      mediaFile: file,
      parsed: { mediaType: MediaType.TV, title: 'Probed Show', season: 2, episodeNumbers: [5] },
      confidence: 0,
      newFilename: 'episode.mkv',
      status: 'unmatched',
    });

    const ui = makeUIAdapter();
    await runPipeline(makeConfig(), ui);

    const parsedArg = mockedFindMatch.mock.calls[0][2];
    expect(parsedArg.title).toBe('Probed Show');
    expect(parsedArg.season).toBe(2);
    expect(parsedArg.episodeNumbers).toEqual([5]);
    expect(parsedArg.mediaType).toBe(MediaType.TV);
  });

  it('should not rename when all files are already correctly named', async () => {
    const file = makeMediaFile('Already Correct.mkv');
    mockedScanDirectory.mockResolvedValue([file]);
    mockedParseFilename.mockReturnValue({ mediaType: MediaType.Movie, title: 'Already Correct' });
    mockedProbeFile.mockResolvedValue(null);
    mockedFindMatch.mockResolvedValue({
      mediaFile: file,
      parsed: { mediaType: MediaType.Movie, title: 'Already Correct' },
      confidence: 95,
      newFilename: 'Already Correct.mkv', // Same as current filename
      status: 'matched',
    });

    const ui = makeUIAdapter();
    await runPipeline(makeConfig(), ui);

    expect(ui.prompts.confirmRenames).not.toHaveBeenCalled();
    expect(mockedExecuteRenames).not.toHaveBeenCalled();
  });
});
