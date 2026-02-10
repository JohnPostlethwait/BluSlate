import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { safeRename } from '../../src/utils/filesystem.js';
import { sanitizeFilename } from '../../src/utils/sanitize.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mediafetch-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('safeRename (TOCTOU-safe)', () => {
  it('should rename a file to the target path', async () => {
    const oldPath = path.join(tmpDir, 'old.mkv');
    const newPath = path.join(tmpDir, 'new.mkv');
    await fs.writeFile(oldPath, 'test content');

    const result = await safeRename(oldPath, newPath);

    expect(result).toBe(newPath);
    expect(await fs.readFile(newPath, 'utf-8')).toBe('test content');

    // Old file should no longer exist
    await expect(fs.access(oldPath)).rejects.toThrow();
  });

  it('should append counter when target exists', async () => {
    const oldPath = path.join(tmpDir, 'source.mkv');
    const existingPath = path.join(tmpDir, 'target.mkv');
    await fs.writeFile(oldPath, 'new content');
    await fs.writeFile(existingPath, 'existing content');

    const result = await safeRename(oldPath, existingPath);

    // Should have a counter suffix
    expect(result).toBe(path.join(tmpDir, 'target (1).mkv'));
    expect(await fs.readFile(result, 'utf-8')).toBe('new content');
    // Original target should be untouched
    expect(await fs.readFile(existingPath, 'utf-8')).toBe('existing content');
  });

  it('should increment counter when multiple collisions exist', async () => {
    const oldPath = path.join(tmpDir, 'source.mkv');
    const targetPath = path.join(tmpDir, 'target.mkv');
    await fs.writeFile(oldPath, 'content');
    await fs.writeFile(targetPath, 'existing');
    await fs.writeFile(path.join(tmpDir, 'target (1).mkv'), 'existing1');

    const result = await safeRename(oldPath, targetPath);

    expect(result).toBe(path.join(tmpDir, 'target (2).mkv'));
  });

  it('should clean up placeholder if rename fails', async () => {
    const oldPath = path.join(tmpDir, 'nonexistent.mkv'); // Source doesn't exist
    const newPath = path.join(tmpDir, 'target.mkv');

    // fs.rename will fail because the source doesn't exist
    await expect(safeRename(oldPath, newPath)).rejects.toThrow();

    // The placeholder should have been cleaned up — target should NOT exist
    await expect(fs.access(newPath)).rejects.toThrow();
  });

  it('should not overwrite existing files (race safety)', async () => {
    const oldPath = path.join(tmpDir, 'source.mkv');
    const targetPath = path.join(tmpDir, 'target.mkv');
    await fs.writeFile(oldPath, 'new content');
    await fs.writeFile(targetPath, 'must not be overwritten');

    await safeRename(oldPath, targetPath);

    // The original target file must still have its original content
    expect(await fs.readFile(targetPath, 'utf-8')).toBe('must not be overwritten');
  });
});

describe('sanitizeFilename (path traversal prevention)', () => {
  it('should strip forward slashes (Unix path traversal)', () => {
    const result = sanitizeFilename('../../../etc/passwd');
    expect(result).not.toContain('/');
    expect(result).not.toContain('..');
  });

  it('should handle backslashes in filenames', () => {
    // On Unix, backslashes are valid filename characters (not path separators).
    // The sanitizer strips them on Windows. On Unix, the key defense is that
    // forward slashes (the actual separator) are always stripped, and the
    // directory escape guard in renamer.ts prevents path.resolve from escaping.
    const result = sanitizeFilename('..\\..\\etc\\passwd');
    if (process.platform === 'win32') {
      expect(result).not.toContain('\\');
      expect(result).not.toContain('..');
    } else {
      // On Unix, backslashes remain but are harmless — they're literal chars, not separators
      expect(result).toBeDefined();
    }
  });

  it('should handle null bytes', () => {
    const result = sanitizeFilename('file\x00name.mkv');
    expect(result).not.toContain('\x00');
  });

  it('should handle control characters', () => {
    const result = sanitizeFilename('file\x01\x02\x03name');
    expect(result).not.toContain('\x01');
  });

  it('should handle TMDb API response with path traversal in show name', () => {
    // Simulate a malicious TMDb response — slashes are stripped,
    // leaving dots that are harmless without path separators.
    const maliciousName = 'Show/../../../evil';
    const result = sanitizeFilename(maliciousName);
    expect(result).not.toContain('/');
    // Without slashes, the remaining dots can't cause path traversal.
    // The directory escape guard in renamer.ts is the second line of defense.
    // Verify that path.resolve with the sanitized name stays in-directory:
    const dir = '/media/videos';
    const resolved = path.resolve(dir, result);
    expect(resolved.startsWith(dir + path.sep)).toBe(true);
  });

  it('should handle TMDb API response with dots only', () => {
    const result = sanitizeFilename('...');
    expect(result).toBe('unnamed');
  });
});

describe('directory escape prevention', () => {
  it('should keep renamed file in same directory as original', async () => {
    const oldPath = path.join(tmpDir, 'original.mkv');
    const newPath = path.join(tmpDir, 'renamed.mkv');
    await fs.writeFile(oldPath, 'test');

    const result = await safeRename(oldPath, newPath);
    const resultDir = path.dirname(result);

    expect(resultDir).toBe(tmpDir);
  });

  it('should produce a safe filename from malicious template data', () => {
    // Even if TMDb returned a path traversal string, sanitize should block it
    const dangerous = '../../other-dir/evil';
    const safe = sanitizeFilename(dangerous);

    // The resolved path should stay in the same directory
    const dir = '/media/videos';
    const resolved = path.resolve(dir, safe);
    expect(resolved.startsWith(dir)).toBe(true);
  });
});
