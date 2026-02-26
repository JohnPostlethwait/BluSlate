import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all core dependencies
vi.mock('../../packages/core/src/core/scanner.js', () => ({
  scanDirectory: vi.fn(),
}));

vi.mock('../../packages/core/src/core/prober.js', () => ({
  probeFile: vi.fn(),
}));

vi.mock('../../packages/core/src/core/renamer.js', () => ({
  executeRenames: vi.fn(),
  writeRenameLog: vi.fn(),
}));

vi.mock('../../packages/core/src/core/directory-parser.js', () => ({
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

vi.mock('../../packages/core/src/api/dvdcompare-client.js', () => ({
  searchDvdCompare: vi.fn().mockResolvedValue([]),
  fetchDiscEpisodeData: vi.fn(),
}));

vi.mock('../../packages/core/src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    scan: vi.fn(),
    rename: vi.fn(),
    tmdb: vi.fn(),
    batch: vi.fn(),
  },
}));

import { runPipeline } from '../../packages/core/src/core/pipeline.js';
import { scanDirectory } from '../../packages/core/src/core/scanner.js';
import { executeRenames, writeRenameLog } from '../../packages/core/src/core/renamer.js';
import { groupFilesBySeason } from '../../packages/core/src/core/directory-parser.js';
import { identifyShow, classifyAndSortFiles, matchSeasonBatch } from '../../packages/core/src/core/batch-matcher.js';
import { MediaType } from '../../packages/core/src/types/media.js';
import { AuthenticationError } from '../../packages/core/src/errors.js';
import type { AppConfig } from '../../packages/core/src/types/config.js';
import type { UIAdapter } from '../../packages/core/src/types/ui-adapter.js';
import type { MatchResult, SeasonGroup, DirectoryContext } from '../../packages/core/src/types/media.js';
import { makeMediaFile } from '../fixtures/test-builders.js';

const mockedScanDirectory = vi.mocked(scanDirectory);
const mockedExecuteRenames = vi.mocked(executeRenames);
const mockedWriteRenameLog = vi.mocked(writeRenameLog);
const mockedGroupFilesBySeason = vi.mocked(groupFilesBySeason);
const mockedIdentifyShow = vi.mocked(identifyShow);
const mockedClassifyAndSortFiles = vi.mocked(classifyAndSortFiles);
const mockedMatchSeasonBatch = vi.mocked(matchSeasonBatch);

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

function makeSeasonGroup(files: ReturnType<typeof makeMediaFile>[], showName = 'Test Show', season = 1): SeasonGroup {
  const context: DirectoryContext = { showName, showNameSource: '/media', season };
  return {
    directoryContext: context,
    files,
    probeResults: new Map(),
  };
}

/** Set up batch mocks to return a single matched result for one file */
function setupBatchMocks(file: ReturnType<typeof makeMediaFile>, matchResult: MatchResult) {
  const group = makeSeasonGroup([file]);
  mockedGroupFilesBySeason.mockReturnValue(new Map([['Test Show::1', group]]));
  mockedIdentifyShow.mockResolvedValue({
    showId: 1,
    showName: 'Test Show',
    showYear: 2020,
    episodeRunTime: [45],
  });
  mockedClassifyAndSortFiles.mockReturnValue([{
    file,
    classification: 'episode' as const,
    durationMinutes: 45,
    sortOrder: 1000,
  }]);
  mockedMatchSeasonBatch.mockResolvedValue({
    matched: [matchResult],
    reclassifiedExtras: [],
  });
}

describe('runPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(mockedGroupFilesBySeason).not.toHaveBeenCalled();
    expect(ui.display.displayResults).not.toHaveBeenCalled();
  });

  it('should scan recursively when configured', async () => {
    mockedScanDirectory.mockResolvedValue([]);
    const ui = makeUIAdapter();

    await runPipeline(makeConfig({ recursive: true }), ui);

    expect(mockedScanDirectory).toHaveBeenCalledWith('/media', true);
  });

  it('should display dry run summary and skip rename', async () => {
    const file = makeMediaFile('old.mkv');
    mockedScanDirectory.mockResolvedValue([file]);

    const matchResult: MatchResult = {
      mediaFile: file,
      parsed: { mediaType: MediaType.TV, title: 'Test Show' },
      confidence: 90,
      newFilename: 'Test Show - S01E01 - Pilot.mkv',
      status: 'matched',
    };
    setupBatchMocks(file, matchResult);

    const ui = makeUIAdapter();
    await runPipeline(makeConfig({ dryRun: true }), ui);

    expect(ui.display.displaySummary).toHaveBeenCalledWith(1, 0, 0, true);
    expect(mockedExecuteRenames).not.toHaveBeenCalled();
  });

  it('should confirm renames and execute them', async () => {
    const file = makeMediaFile('old.mkv');
    mockedScanDirectory.mockResolvedValue([file]);

    const matchResult: MatchResult = {
      mediaFile: file,
      parsed: { mediaType: MediaType.TV, title: 'Test Show' },
      confidence: 90,
      newFilename: 'Test Show - S01E01 - Pilot.mkv',
      status: 'matched',
    };
    setupBatchMocks(file, matchResult);
    mockedExecuteRenames.mockResolvedValue([{ from: 'old.mkv', to: 'Test Show - S01E01 - Pilot.mkv' }]);
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

    const matchResult: MatchResult = {
      mediaFile: file,
      parsed: { mediaType: MediaType.TV, title: 'Test Show' },
      confidence: 90,
      newFilename: 'Test Show - S01E01 - Pilot.mkv',
      status: 'matched',
    };
    setupBatchMocks(file, matchResult);

    const ui = makeUIAdapter();
    vi.mocked(ui.prompts.confirmRenames).mockResolvedValue([]);

    await runPipeline(makeConfig(), ui);

    expect(mockedExecuteRenames).not.toHaveBeenCalled();
  });

  it('should abort on FatalError during batch matching', async () => {
    const file = makeMediaFile('test.mkv');
    mockedScanDirectory.mockResolvedValue([file]);

    const group = makeSeasonGroup([file]);
    mockedGroupFilesBySeason.mockReturnValue(new Map([['Test Show::1', group]]));
    mockedIdentifyShow.mockRejectedValue(new AuthenticationError('Bad API key'));

    const ui = makeUIAdapter();

    await expect(runPipeline(makeConfig(), ui)).rejects.toThrow(AuthenticationError);
    expect(ui.progress.stop).toHaveBeenCalled();
  });

  it('should attach warning messages to unmatched results when Phase 5 errors', async () => {
    const file = makeMediaFile('test.mkv');
    mockedScanDirectory.mockResolvedValue([file]);

    const group = makeSeasonGroup([file]);
    mockedGroupFilesBySeason.mockReturnValue(new Map([['Test Show::1', group]]));
    mockedIdentifyShow.mockResolvedValue({
      showId: 1,
      showName: 'Test Show',
      showYear: 2020,
      episodeRunTime: [45],
    });
    // classifyAndSortFiles throws — simulating a Phase 5 error
    mockedClassifyAndSortFiles.mockImplementation(() => {
      throw new Error('TMDb API timeout');
    });

    const ui = makeUIAdapter();
    vi.mocked(ui.prompts.confirmRenames).mockResolvedValue([]);
    await runPipeline(makeConfig(), ui);

    // The confirmRenames call should have received matches with warnings
    const confirmCall = vi.mocked(ui.prompts.confirmRenames).mock.calls[0];
    const matches = confirmCall[0] as MatchResult[];
    expect(matches).toHaveLength(1);
    expect(matches[0].status).toBe('unmatched');
    expect(matches[0].warnings).toBeDefined();
    expect(matches[0].warnings![0]).toContain('Matching failed');
    expect(matches[0].warnings![0]).toContain('TMDb API timeout');
  });

  it('should show confirm dialog even when all files are already correctly named', async () => {
    const file = makeMediaFile('Already Correct.mkv');
    mockedScanDirectory.mockResolvedValue([file]);

    const matchResult: MatchResult = {
      mediaFile: file,
      parsed: { mediaType: MediaType.TV, title: 'Test Show' },
      confidence: 95,
      newFilename: 'Already Correct.mkv', // Same as current filename
      status: 'matched',
    };
    setupBatchMocks(file, matchResult);

    const ui = makeUIAdapter();
    // confirmRenames returns empty — user has nothing to rename
    vi.mocked(ui.prompts.confirmRenames).mockResolvedValue([]);
    await runPipeline(makeConfig(), ui);

    // Confirm dialog is always shown so user can reorder/edit
    expect(ui.prompts.confirmRenames).toHaveBeenCalled();
    expect(mockedExecuteRenames).not.toHaveBeenCalled();
  });
});
