import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';

// Mock node:fs/promises before importing the module under test
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  lstat: vi.fn(),
}));

// Mock the logger to suppress output
vi.mock('../../packages/core/src/utils/logger.js', () => ({
  logger: {
    scan: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import * as fs from 'node:fs/promises';
import { scanDirectory } from '../../packages/core/src/core/scanner.js';

const mockedReaddir = vi.mocked(fs.readdir);
const mockedLstat = vi.mocked(fs.lstat);

// Helper to create a mock Dirent
function makeDirent(
  name: string,
  opts: { isFile?: boolean; isSymbolicLink?: boolean; parentPath?: string } = {},
): any {
  return {
    name,
    isFile: () => opts.isFile ?? true,
    isDirectory: () => !opts.isFile,
    isSymbolicLink: () => opts.isSymbolicLink ?? false,
    parentPath: opts.parentPath,
  };
}

function makeStat(size: number): any {
  return { size };
}

describe('scanDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should find video files in a directory', async () => {
    mockedReaddir.mockResolvedValue([
      makeDirent('Movie.mkv'),
      makeDirent('Show.mp4'),
    ]);
    mockedLstat.mockResolvedValue(makeStat(700_000_000));

    const result = await scanDirectory('/media');

    expect(result).toHaveLength(2);
    expect(result[0].fileName).toBe('Movie.mkv');
    expect(result[0].extension).toBe('.mkv');
    expect(result[0].sizeBytes).toBe(700_000_000);
    expect(result[1].fileName).toBe('Show.mp4');
  });

  it('should skip non-video files', async () => {
    mockedReaddir.mockResolvedValue([
      makeDirent('readme.txt'),
      makeDirent('image.jpg'),
      makeDirent('Movie.mkv'),
    ]);
    mockedLstat.mockResolvedValue(makeStat(100_000));

    const result = await scanDirectory('/media');

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe('Movie.mkv');
  });

  it('should skip hidden files (dot-prefixed)', async () => {
    mockedReaddir.mockResolvedValue([
      makeDirent('.hidden-video.mkv'),
      makeDirent('Visible.mkv'),
    ]);
    mockedLstat.mockResolvedValue(makeStat(500_000));

    const result = await scanDirectory('/media');

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe('Visible.mkv');
  });

  it('should skip directories', async () => {
    mockedReaddir.mockResolvedValue([
      makeDirent('Season 1', { isFile: false }),
      makeDirent('Movie.mkv', { isFile: true }),
    ]);
    mockedLstat.mockResolvedValue(makeStat(500_000));

    const result = await scanDirectory('/media');

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe('Movie.mkv');
  });

  it('should skip symbolic links', async () => {
    mockedReaddir.mockResolvedValue([
      makeDirent('linked-movie.mkv', { isFile: true, isSymbolicLink: true }),
      makeDirent('Real.mkv', { isFile: true }),
    ]);
    mockedLstat.mockResolvedValue(makeStat(500_000));

    const result = await scanDirectory('/media');

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe('Real.mkv');
  });

  it('should return empty array when no media files found', async () => {
    mockedReaddir.mockResolvedValue([
      makeDirent('readme.txt'),
      makeDirent('notes.pdf'),
    ]);

    const result = await scanDirectory('/media');

    expect(result).toHaveLength(0);
  });

  it('should sort results by file path', async () => {
    mockedReaddir.mockResolvedValue([
      makeDirent('Zebra.mkv'),
      makeDirent('Alpha.mkv'),
      makeDirent('Middle.mkv'),
    ]);
    mockedLstat.mockResolvedValue(makeStat(100));

    const result = await scanDirectory('/media');

    expect(result[0].fileName).toBe('Alpha.mkv');
    expect(result[1].fileName).toBe('Middle.mkv');
    expect(result[2].fileName).toBe('Zebra.mkv');
  });

  it('should pass recursive option to readdir', async () => {
    mockedReaddir.mockResolvedValue([]);

    await scanDirectory('/media', true);

    expect(mockedReaddir).toHaveBeenCalledWith(
      expect.any(String),
      { withFileTypes: true, recursive: true },
    );
  });

  it('should default to non-recursive', async () => {
    mockedReaddir.mockResolvedValue([]);

    await scanDirectory('/media');

    expect(mockedReaddir).toHaveBeenCalledWith(
      expect.any(String),
      { withFileTypes: true, recursive: false },
    );
  });

  it('should handle stat errors gracefully', async () => {
    mockedReaddir.mockResolvedValue([
      makeDirent('Good.mkv'),
      makeDirent('Bad.mkv'),
    ]);

    // First call succeeds, second fails
    mockedLstat
      .mockResolvedValueOnce(makeStat(100))
      .mockRejectedValueOnce(new Error('Permission denied'));

    const result = await scanDirectory('/media');

    // Only the successfully stat'd file should be in results
    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe('Good.mkv');
  });

  it('should use parentPath from entry when available (recursive mode)', async () => {
    mockedReaddir.mockResolvedValue([
      makeDirent('Episode.mkv', { isFile: true, parentPath: '/media/Season 1' }),
    ]);
    mockedLstat.mockResolvedValue(makeStat(700_000_000));

    const result = await scanDirectory('/media', true);

    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe(path.join('/media/Season 1', 'Episode.mkv'));
  });

  it('should handle all common video extensions', async () => {
    const videoFiles = [
      'movie.mkv', 'movie.mp4', 'movie.avi', 'movie.mov',
      'movie.wmv', 'movie.flv', 'movie.webm', 'movie.m4v', 'movie.ts',
    ];

    mockedReaddir.mockResolvedValue(
      videoFiles.map((name) => makeDirent(name)),
    );
    mockedLstat.mockResolvedValue(makeStat(100));

    const result = await scanDirectory('/media');

    // All extensions are in VIDEO_EXTENSIONS (.ts = transport stream, is included)
    expect(result).toHaveLength(videoFiles.length);
  });
});
