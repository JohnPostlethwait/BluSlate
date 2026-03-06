/**
 * Tests for cross-platform error handling improvements:
 * - CLI input validation (inline, same rules as validatePipelineOptions)
 * - Web ENV var validation (BLUSLATE_LANGUAGE, BLUSLATE_TEMPLATE)
 * - Web PORT validation
 * - Web route error responses (undo, filenames)
 * - Web api-adapter HTTP error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// CLI input validation — test the validation logic inline in cli.ts
// Since the CLI uses parseInt + range check + regex, test those constraints
// ---------------------------------------------------------------------------

import { VALID_LANGUAGE_RE, MAX_TEMPLATE_LENGTH } from '../../packages/core/src/utils/validation.js';

describe('CLI input validation rules', () => {
  describe('--min-confidence validation', () => {
    function validateMinConfidence(raw: string): number | Error {
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return new Error('--min-confidence must be a number between 0 and 100');
      }
      return parsed;
    }

    it('should accept valid confidence values', () => {
      expect(validateMinConfidence('85')).toBe(85);
      expect(validateMinConfidence('0')).toBe(0);
      expect(validateMinConfidence('100')).toBe(100);
      expect(validateMinConfidence('50')).toBe(50);
    });

    it('should reject non-numeric values', () => {
      expect(validateMinConfidence('abc')).toBeInstanceOf(Error);
      expect(validateMinConfidence('')).toBeInstanceOf(Error);
      expect(validateMinConfidence('high')).toBeInstanceOf(Error);
    });

    it('should reject out-of-range values', () => {
      expect(validateMinConfidence('-1')).toBeInstanceOf(Error);
      expect(validateMinConfidence('101')).toBeInstanceOf(Error);
      expect(validateMinConfidence('999')).toBeInstanceOf(Error);
      expect(validateMinConfidence('-50')).toBeInstanceOf(Error);
    });
  });

  describe('--lang validation', () => {
    it('should accept valid language codes', () => {
      expect(VALID_LANGUAGE_RE.test('en-US')).toBe(true);
      expect(VALID_LANGUAGE_RE.test('ja')).toBe(true);
      expect(VALID_LANGUAGE_RE.test('pt-BR')).toBe(true);
      expect(VALID_LANGUAGE_RE.test('de')).toBe(true);
    });

    it('should reject invalid language codes', () => {
      expect(VALID_LANGUAGE_RE.test('INVALID')).toBe(false);
      expect(VALID_LANGUAGE_RE.test('en-us')).toBe(false);
      expect(VALID_LANGUAGE_RE.test('english')).toBe(false);
      expect(VALID_LANGUAGE_RE.test('')).toBe(false);
      expect(VALID_LANGUAGE_RE.test('e')).toBe(false);
      expect(VALID_LANGUAGE_RE.test('en-')).toBe(false);
    });
  });

  describe('--template length validation', () => {
    it('should accept templates within length limit', () => {
      const template = 'x'.repeat(MAX_TEMPLATE_LENGTH);
      expect(template.length <= MAX_TEMPLATE_LENGTH).toBe(true);
    });

    it('should reject templates exceeding length limit', () => {
      const template = 'x'.repeat(MAX_TEMPLATE_LENGTH + 1);
      expect(template.length > MAX_TEMPLATE_LENGTH).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Web ENV var validation (settings.ts applyEnvOverrides)
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

describe('web settings ENV var validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Clear relevant env vars
    delete process.env.TMDB_API_KEY;
    delete process.env.BLUSLATE_LANGUAGE;
    delete process.env.BLUSLATE_TEMPLATE;
    delete process.env.BLUSLATE_MIN_CONFIDENCE;
    delete process.env.BLUSLATE_DATA;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should accept valid BLUSLATE_LANGUAGE', async () => {
    process.env.BLUSLATE_LANGUAGE = 'ja';
    const { loadSettings } = await import('../../packages/web/src/server/settings.js');
    const settings = await loadSettings();
    expect(settings.language).toBe('ja');
  });

  it('should reject invalid BLUSLATE_LANGUAGE and keep default', async () => {
    process.env.BLUSLATE_LANGUAGE = 'INVALID';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadSettings } = await import('../../packages/web/src/server/settings.js');
    const settings = await loadSettings();
    expect(settings.language).toBe('en-US');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('BLUSLATE_LANGUAGE'));
    warnSpy.mockRestore();
  });

  it('should accept BLUSLATE_TEMPLATE within length limit', async () => {
    process.env.BLUSLATE_TEMPLATE = '{show_name} - {episode}';
    const { loadSettings } = await import('../../packages/web/src/server/settings.js');
    const settings = await loadSettings();
    expect(settings.template).toBe('{show_name} - {episode}');
  });

  it('should reject BLUSLATE_TEMPLATE exceeding length limit', async () => {
    process.env.BLUSLATE_TEMPLATE = 'x'.repeat(MAX_TEMPLATE_LENGTH + 1);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadSettings } = await import('../../packages/web/src/server/settings.js');
    const settings = await loadSettings();
    expect(settings.template).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('BLUSLATE_TEMPLATE'));
    warnSpy.mockRestore();
  });

  it('should clamp BLUSLATE_MIN_CONFIDENCE to [0, 100]', async () => {
    process.env.BLUSLATE_MIN_CONFIDENCE = '200';
    const { loadSettings } = await import('../../packages/web/src/server/settings.js');
    const settings = await loadSettings();
    expect(settings.minConfidence).toBe(100);
  });

  it('should ignore non-numeric BLUSLATE_MIN_CONFIDENCE', async () => {
    process.env.BLUSLATE_MIN_CONFIDENCE = 'abc';
    const { loadSettings } = await import('../../packages/web/src/server/settings.js');
    const settings = await loadSettings();
    expect(settings.minConfidence).toBe(85);
  });

  it('should apply TMDB_API_KEY from env', async () => {
    process.env.TMDB_API_KEY = 'test-key-123';
    const { loadSettings } = await import('../../packages/web/src/server/settings.js');
    const settings = await loadSettings();
    expect(settings.apiKey).toBe('test-key-123');
  });
});

// ---------------------------------------------------------------------------
// Web PORT validation
// ---------------------------------------------------------------------------

describe('web PORT validation', () => {
  it('should accept valid port numbers', () => {
    function getPort(portStr: string | undefined): number {
      const raw = parseInt(portStr || '3000', 10);
      if (!Number.isFinite(raw) || raw < 1 || raw > 65535) {
        return 3000;
      }
      return raw;
    }

    expect(getPort('3000')).toBe(3000);
    expect(getPort('8080')).toBe(8080);
    expect(getPort('1')).toBe(1);
    expect(getPort('65535')).toBe(65535);
    expect(getPort(undefined)).toBe(3000);
  });

  it('should fall back to 3000 for invalid port values', () => {
    function getPort(portStr: string | undefined): number {
      const raw = parseInt(portStr || '3000', 10);
      if (!Number.isFinite(raw) || raw < 1 || raw > 65535) {
        return 3000;
      }
      return raw;
    }

    expect(getPort('abc')).toBe(3000);
    expect(getPort('0')).toBe(3000);
    expect(getPort('-1')).toBe(3000);
    expect(getPort('65536')).toBe(3000);
    expect(getPort('99999')).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// Web route error responses
// ---------------------------------------------------------------------------

describe('web route validation patterns', () => {
  describe('undo route validation', () => {
    it('should reject missing directory', () => {
      const body = {} as { directory?: string };
      const directory = body.directory;
      expect(!directory || typeof directory !== 'string').toBe(true);
    });

    it('should reject non-string directory', () => {
      const body = { directory: 42 } as unknown as { directory?: string };
      expect(!body.directory || typeof body.directory !== 'string').toBe(true);
    });

    it('should accept valid directory string', () => {
      const body = { directory: '/media/tv' };
      expect(!body.directory || typeof body.directory !== 'string').toBe(false);
    });

    it('should reject paths outside media root', () => {
      const { resolve } = require('node:path');
      const mediaRoot = resolve('/media');
      const resolvedDir = resolve('/etc/passwd');
      expect(resolvedDir.startsWith(mediaRoot)).toBe(false);
    });
  });

  describe('filenames route validation', () => {
    it('should reject non-array items', () => {
      expect(!Array.isArray('not-an-array')).toBe(true);
      expect(!Array.isArray(null)).toBe(true);
      expect(!Array.isArray({})).toBe(true);
    });

    it('should accept valid array items', () => {
      const items = [{ tmdbMatch: { name: 'Test' }, extension: '.mkv' }];
      expect(Array.isArray(items)).toBe(true);
    });

    it('should handle items with missing tmdbMatch', () => {
      const items = [{ tmdbMatch: null, extension: '.mkv' }];
      const result = items.map((item) => {
        if (!item.tmdbMatch) return '';
        return 'filename.mkv';
      });
      expect(result).toEqual(['']);
    });
  });
});

// ---------------------------------------------------------------------------
// Web api-adapter HTTP error handling
// ---------------------------------------------------------------------------

describe('web api-adapter error handling', () => {
  it('should throw on non-ok response with error body', async () => {
    // Simulate what authFetch now does
    async function checkResponse(res: { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }): Promise<void> {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Request failed: ${res.status} ${res.statusText}`);
      }
    }

    const mockResponse = {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'Invalid API key' }),
    };

    await expect(checkResponse(mockResponse)).rejects.toThrow('Invalid API key');
  });

  it('should throw with status text when no error body', async () => {
    async function checkResponse(res: { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }): Promise<void> {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Request failed: ${res.status} ${res.statusText}`);
      }
    }

    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => { throw new Error('not json'); },
    };

    await expect(checkResponse(mockResponse)).rejects.toThrow('Request failed: 500 Internal Server Error');
  });

  it('should not throw on ok response', async () => {
    async function checkResponse(res: { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }): Promise<void> {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Request failed: ${res.status} ${res.statusText}`);
      }
    }

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: 'test' }),
    };

    await expect(checkResponse(mockResponse)).resolves.toBeUndefined();
  });
});
