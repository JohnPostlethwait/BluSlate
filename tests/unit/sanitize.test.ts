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

  it('should handle forward slashes on unix', () => {
    // Forward slash is always removed
    const result = sanitizeFilename('path/to/file');
    expect(result).not.toContain('/');
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
});
