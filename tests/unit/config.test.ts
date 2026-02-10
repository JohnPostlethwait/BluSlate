import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock platform utils
vi.mock('../../packages/core/src/utils/platform.js', () => ({
  getConfigFilePath: vi.fn(() => '/mock/.config/mediafetch/config.json'),
  getConfigDir: vi.fn(() => '/mock/.config/mediafetch'),
}));

// Mock the logger
vi.mock('../../packages/core/src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import * as fs from 'node:fs/promises';
import { loadApiKey, saveApiKey, buildConfig } from '../../packages/core/src/config/config.js';

const mockedReadFile = vi.mocked(fs.readFile);
const mockedWriteFile = vi.mocked(fs.writeFile);
const mockedMkdir = vi.mocked(fs.mkdir);

describe('loadApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear env var between tests
    delete process.env['TMDB_API_KEY'];
  });

  afterEach(() => {
    delete process.env['TMDB_API_KEY'];
  });

  it('should return CLI key when provided (highest priority)', async () => {
    process.env['TMDB_API_KEY'] = 'env-key';
    mockedReadFile.mockResolvedValue(JSON.stringify({ apiKey: 'file-key' }));

    const result = await loadApiKey('cli-key');

    expect(result).toBe('cli-key');
  });

  it('should return env var when CLI key not provided', async () => {
    process.env['TMDB_API_KEY'] = 'env-key';

    const result = await loadApiKey();

    expect(result).toBe('env-key');
  });

  it('should return config file key when no CLI key or env var', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({ apiKey: 'file-key' }));

    const result = await loadApiKey();

    expect(result).toBe('file-key');
  });

  it('should return undefined when no key is found anywhere', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await loadApiKey();

    expect(result).toBeUndefined();
  });

  it('should handle malformed config file gracefully', async () => {
    mockedReadFile.mockResolvedValue('not valid json');

    const result = await loadApiKey();

    expect(result).toBeUndefined();
  });

  it('should return undefined from config file with no apiKey field', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({ template: '{title}' }));

    const result = await loadApiKey();

    expect(result).toBeUndefined();
  });
});

describe('saveApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedMkdir.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
  });

  it('should create config directory and write API key', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    await saveApiKey('new-key');

    expect(mockedMkdir).toHaveBeenCalledWith('/mock/.config/mediafetch', { recursive: true });
    expect(mockedWriteFile).toHaveBeenCalledOnce();

    const writtenContent = JSON.parse((mockedWriteFile.mock.calls[0][1] as string).trim());
    expect(writtenContent.apiKey).toBe('new-key');
  });

  it('should preserve existing config fields when saving', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({ template: '{title}', language: 'de-DE' }));

    await saveApiKey('my-key');

    const writtenContent = JSON.parse((mockedWriteFile.mock.calls[0][1] as string).trim());
    expect(writtenContent.apiKey).toBe('my-key');
    expect(writtenContent.template).toBe('{title}');
    expect(writtenContent.language).toBe('de-DE');
  });

  it('should overwrite existing API key', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({ apiKey: 'old-key' }));

    await saveApiKey('new-key');

    const writtenContent = JSON.parse((mockedWriteFile.mock.calls[0][1] as string).trim());
    expect(writtenContent.apiKey).toBe('new-key');
  });

  it('should write config with restrictive permissions (0o600)', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    await saveApiKey('secret-key');

    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { mode: 0o600 },
    );
  });
});

describe('buildConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['TMDB_API_KEY'];
  });

  afterEach(() => {
    delete process.env['TMDB_API_KEY'];
  });

  it('should build config with all options provided', async () => {
    const config = await buildConfig({
      directory: '/media',
      apiKey: 'my-key',
      dryRun: true,
      type: 'tv',
      template: '{show_name} - {episode}',
      recursive: true,
      verbose: true,
      yes: true,
      minConfidence: 90,
      lang: 'de-DE',
    });

    expect(config.apiKey).toBe('my-key');
    expect(config.directory).toBe('/media');
    expect(config.dryRun).toBe(true);
    expect(config.mediaType).toBe('tv');
    expect(config.template).toBe('{show_name} - {episode}');
    expect(config.recursive).toBe(true);
    expect(config.verbose).toBe(true);
    expect(config.autoAccept).toBe(true);
    expect(config.minConfidence).toBe(90);
    expect(config.language).toBe('de-DE');
  });

  it('should use default values when options are omitted', async () => {
    const config = await buildConfig({
      directory: '/media',
      apiKey: 'key',
    });

    expect(config.dryRun).toBe(false);
    expect(config.mediaType).toBe('auto');
    expect(config.template).toBeUndefined();
    expect(config.recursive).toBe(false);
    expect(config.verbose).toBe(false);
    expect(config.autoAccept).toBe(false);
    expect(config.minConfidence).toBe(85);
    expect(config.language).toBe('en-US');
  });

  it('should throw when no API key is available', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    await expect(
      buildConfig({ directory: '/media' })
    ).rejects.toThrow('TMDb API key is required');
  });

  it('should load API key from environment variable', async () => {
    process.env['TMDB_API_KEY'] = 'env-key';

    const config = await buildConfig({ directory: '/media' });

    expect(config.apiKey).toBe('env-key');
  });

  it('should prioritize CLI key over environment variable', async () => {
    process.env['TMDB_API_KEY'] = 'env-key';

    const config = await buildConfig({
      directory: '/media',
      apiKey: 'cli-key',
    });

    expect(config.apiKey).toBe('cli-key');
  });
});
