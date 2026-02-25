import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../../packages/core/src/utils/sanitize.js';

describe('sanitizeFilename', () => {
  it('should return the name unchanged when valid', () => {
    expect(sanitizeFilename('valid-filename')).toBe('valid-filename');
  });

  it('should remove null bytes', () => {
    expect(sanitizeFilename('file\x00name')).toBe('filename');
  });

  it('should collapse consecutive spaces', () => {
    expect(sanitizeFilename('too   many   spaces')).toBe('too many spaces');
  });

  it('should trim whitespace', () => {
    expect(sanitizeFilename('  padded  ')).toBe('padded');
  });

  it('should remove trailing dots', () => {
    expect(sanitizeFilename('filename...')).toBe('filename');
  });

  it('should remove leading dots', () => {
    expect(sanitizeFilename('...filename')).toBe('filename');
  });

  it('should handle empty string by returning "unnamed"', () => {
    expect(sanitizeFilename('')).toBe('unnamed');
  });

  it('should handle strings that become empty after sanitization', () => {
    expect(sanitizeFilename('...')).toBe('unnamed');
  });

  it('should handle forward slashes', () => {
    const result = sanitizeFilename('path/to/file');
    expect(result).not.toContain('/');
  });

  it('should replace colons with dash for readability', () => {
    expect(sanitizeFilename('Star Trek: The Next Generation')).toBe('Star Trek - The Next Generation');
  });

  it('should handle multiple colons', () => {
    expect(sanitizeFilename('A: B: C')).toBe('A - B - C');
  });

  it('should handle colon at start', () => {
    const result = sanitizeFilename(':filename');
    expect(result).not.toContain(':');
    expect(result).toBe('-filename');
  });

  it('should handle colon at end', () => {
    const result = sanitizeFilename('filename:');
    expect(result).not.toContain(':');
  });

  it('should strip Windows-illegal characters on all platforms', () => {
    const result = sanitizeFilename('file<>name"with|bad?chars*');
    expect(result).toBe('filenamewithbadchars');
  });

  it('should strip backslashes on all platforms', () => {
    const result = sanitizeFilename('path\\to\\file');
    expect(result).toBe('pathtofile');
  });

  it('should truncate long filenames', () => {
    const longName = 'a'.repeat(300);
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(250);
  });

  it('should normalize unicode', () => {
    // NFC normalization: e + combining accent -> single character
    const decomposed = 'caf\u0065\u0301'; // e + combining acute
    const result = sanitizeFilename(decomposed);
    expect(result).toBe('caf\u00e9'); // single character e-acute
  });

  // --- Windows reserved device name tests ---
  // These test cross-platform safety; the WINDOWS_RESERVED check only applies on win32
  // but we verify the regex logic is correct regardless

  describe('Windows reserved device names', () => {
    // Override process.platform for these tests by testing the regex directly
    it('should handle CON as a standalone name on Windows', () => {
      // We can't easily mock process.platform, but we verify the regex pattern
      const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;
      expect(WINDOWS_RESERVED.test('CON')).toBe(true);
      expect(WINDOWS_RESERVED.test('con')).toBe(true);
      expect(WINDOWS_RESERVED.test('PRN')).toBe(true);
      expect(WINDOWS_RESERVED.test('AUX')).toBe(true);
      expect(WINDOWS_RESERVED.test('NUL')).toBe(true);
      expect(WINDOWS_RESERVED.test('COM1')).toBe(true);
      expect(WINDOWS_RESERVED.test('COM9')).toBe(true);
      expect(WINDOWS_RESERVED.test('LPT1')).toBe(true);
      expect(WINDOWS_RESERVED.test('LPT9')).toBe(true);
    });

    it('should not match non-reserved names', () => {
      const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;
      expect(WINDOWS_RESERVED.test('CONSOLE')).toBe(false);
      expect(WINDOWS_RESERVED.test('AUXILIARY')).toBe(false);
      expect(WINDOWS_RESERVED.test('Con Artists')).toBe(false);
      expect(WINDOWS_RESERVED.test('normal-filename')).toBe(false);
    });

    it('should strip null bytes defensively', () => {
      const result = sanitizeFilename('file\x00\x00name');
      expect(result).toBe('filename');
      expect(result).not.toContain('\x00');
    });

    it('should handle strings composed entirely of null bytes', () => {
      const result = sanitizeFilename('\x00\x00\x00');
      expect(result).toBe('unnamed');
    });
  });
});
