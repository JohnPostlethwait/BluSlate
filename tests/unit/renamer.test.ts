import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}));

// Mock filesystem utility
vi.mock('../../packages/core/src/utils/filesystem.js', () => ({
  safeRename: vi.fn(),
}));

// Mock the logger
vi.mock('../../packages/core/src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    rename: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import * as fs from 'node:fs/promises';
import { safeRename } from '../../packages/core/src/utils/filesystem.js';
import { executeRenames, writeRenameLog } from '../../packages/core/src/core/renamer.js';
import { MediaType } from '../../packages/core/src/types/media.js';
import type { MatchResult } from '../../packages/core/src/types/media.js';

const mockedSafeRename = vi.mocked(safeRename);
const mockedWriteFile = vi.mocked(fs.writeFile);

function makeMatch(opts: {
  fileName: string;
  newFilename: string;
  status?: 'matched' | 'ambiguous' | 'unmatched';
  filePath?: string;
}): MatchResult {
  const filePath = opts.filePath ?? `/media/${opts.fileName}`;
  return {
    mediaFile: {
      filePath,
      fileName: opts.fileName,
      extension: path.extname(opts.fileName),
      sizeBytes: 700_000_000,
    },
    parsed: { mediaType: MediaType.TV, title: 'Test' },
    confidence: opts.status === 'unmatched' ? 0 : 90,
    newFilename: opts.newFilename,
    status: opts.status ?? 'matched',
  };
}

describe('executeRenames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should rename matched files', async () => {
    mockedSafeRename.mockResolvedValue('/media/Breaking Bad - S01E01 - Pilot.mkv');

    const matches = [
      makeMatch({ fileName: 'breaking.bad.s01e01.mkv', newFilename: 'Breaking Bad - S01E01 - Pilot.mkv' }),
    ];

    const result = await executeRenames(matches, false);

    expect(result).toHaveLength(1);
    expect(result[0].from).toBe('breaking.bad.s01e01.mkv');
    expect(result[0].to).toBe('Breaking Bad - S01E01 - Pilot.mkv');
    expect(mockedSafeRename).toHaveBeenCalledOnce();
  });

  it('should skip unmatched files', async () => {
    const matches = [
      makeMatch({ fileName: 'unknown.mkv', newFilename: 'unknown.mkv', status: 'unmatched' }),
    ];

    const result = await executeRenames(matches, false);

    expect(result).toHaveLength(0);
    expect(mockedSafeRename).not.toHaveBeenCalled();
  });

  it('should count already-correct files as successful without renaming', async () => {
    const matches = [
      makeMatch({ fileName: 'Already Correct.mkv', newFilename: 'Already Correct.mkv' }),
    ];

    const result = await executeRenames(matches, false);

    // File counts as successfully processed but no filesystem rename happens
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe('Already Correct.mkv');
    expect(result[0].to).toBe('Already Correct.mkv');
    expect(mockedSafeRename).not.toHaveBeenCalled();
  });

  it('should handle dry run mode', async () => {
    const matches = [
      makeMatch({ fileName: 'old.mkv', newFilename: 'new.mkv' }),
    ];

    const result = await executeRenames(matches, true);

    expect(result).toHaveLength(1);
    expect(result[0].from).toBe('old.mkv');
    expect(result[0].to).toBe('new.mkv');
    expect(mockedSafeRename).not.toHaveBeenCalled(); // No actual rename in dry run
  });

  it('should handle rename errors gracefully', async () => {
    mockedSafeRename.mockRejectedValue(new Error('EACCES: permission denied'));

    const matches = [
      makeMatch({ fileName: 'locked.mkv', newFilename: 'renamed.mkv' }),
    ];

    const result = await executeRenames(matches, false);

    expect(result).toHaveLength(0); // Failed rename not in results
  });

  it('should rename multiple files', async () => {
    mockedSafeRename
      .mockResolvedValueOnce('/media/File One.mkv')
      .mockResolvedValueOnce('/media/File Two.mkv');

    const matches = [
      makeMatch({ fileName: 'file1.mkv', newFilename: 'File One.mkv' }),
      makeMatch({ fileName: 'file2.mkv', newFilename: 'File Two.mkv' }),
    ];

    const result = await executeRenames(matches, false);

    expect(result).toHaveLength(2);
    expect(mockedSafeRename).toHaveBeenCalledTimes(2);
  });

  it('should use the actual renamed path from safeRename (collision handling)', async () => {
    // safeRename may return a different name due to collision appending
    mockedSafeRename.mockResolvedValue('/media/Movie (1).mkv');

    const matches = [
      makeMatch({ fileName: 'movie.mkv', newFilename: 'Movie.mkv' }),
    ];

    const result = await executeRenames(matches, false);

    expect(result).toHaveLength(1);
    expect(result[0].to).toBe('Movie (1).mkv'); // Uses basename of actual path
  });

  it('should skip files whose new path would escape the source directory', async () => {
    const matches = [
      makeMatch({
        fileName: 'test.mkv',
        newFilename: '../../../etc/evil.mkv',
        filePath: '/media/test.mkv',
      }),
    ];

    const result = await executeRenames(matches, false);

    // The path traversal check should prevent this rename
    expect(mockedSafeRename).not.toHaveBeenCalled();
  });

  it('should process ambiguous matches normally', async () => {
    mockedSafeRename.mockResolvedValue('/media/Ambiguous Match.mkv');

    const matches = [
      makeMatch({ fileName: 'ambig.mkv', newFilename: 'Ambiguous Match.mkv', status: 'ambiguous' }),
    ];

    const result = await executeRenames(matches, false);

    expect(result).toHaveLength(1);
    expect(mockedSafeRename).toHaveBeenCalledOnce();
  });
});

describe('writeRenameLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write rename log with entries', async () => {
    mockedWriteFile.mockResolvedValue(undefined);

    await writeRenameLog('/media', [
      { from: 'old1.mkv', to: 'new1.mkv' },
      { from: 'old2.mkv', to: 'new2.mkv' },
    ]);

    expect(mockedWriteFile).toHaveBeenCalledOnce();
    const [logPath, content] = mockedWriteFile.mock.calls[0] as [string, string];
    expect(logPath).toBe(path.join('/media', '.mediafetch-log.json'));

    const parsed = JSON.parse(content);
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.renames).toHaveLength(2);
    expect(parsed.renames[0].from).toBe('old1.mkv');
    expect(parsed.renames[0].to).toBe('new1.mkv');
  });

  it('should not write log when no renames occurred', async () => {
    await writeRenameLog('/media', []);

    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('should handle write errors gracefully', async () => {
    mockedWriteFile.mockRejectedValue(new Error('EACCES: permission denied'));

    // Should not throw
    await expect(
      writeRenameLog('/media', [{ from: 'a.mkv', to: 'b.mkv' }])
    ).resolves.not.toThrow();
  });

  it('should produce valid JSON in the log file', async () => {
    mockedWriteFile.mockResolvedValue(undefined);

    await writeRenameLog('/media', [
      { from: 'file with spaces.mkv', to: 'New Name (2020).mkv' },
    ]);

    const content = mockedWriteFile.mock.calls[0][1] as string;
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
