import { describe, it, expect } from 'vitest';
import {
  validatePipelineOptions,
  sanitizeErrorMessage,
  VALID_LANGUAGE_RE,
  MAX_API_KEY_LENGTH,
  MAX_TEMPLATE_LENGTH,
} from '../../packages/gui/src/main/validation.js';

// ---------------------------------------------------------------------------
// validatePipelineOptions
// ---------------------------------------------------------------------------

describe('validatePipelineOptions', () => {
  const validOptions = {
    directory: '/Users/test/media',
    apiKey: 'abc123',
    dryRun: true,
    recursive: true,
    language: 'en-US',
    autoAccept: false,
    minConfidence: 85,
    template: '{show_name} - {episode}',
  };

  // --- Happy path ---

  it('should accept valid pipeline options', () => {
    const result = validatePipelineOptions(validOptions);
    expect(result.directory).toBe('/Users/test/media');
    expect(result.apiKey).toBe('abc123');
    expect(result.dryRun).toBe(true);
    expect(result.recursive).toBe(true);
    expect(result.language).toBe('en-US');
    expect(result.autoAccept).toBe(false);
    expect(result.minConfidence).toBe(85);
    expect(result.template).toBe('{show_name} - {episode}');
  });

  it('should accept minimal valid options with defaults', () => {
    const result = validatePipelineOptions({
      directory: '/tmp/media',
      apiKey: 'key123',
    });
    expect(result.directory).toBe('/tmp/media');
    expect(result.apiKey).toBe('key123');
    expect(result.dryRun).toBe(false);
    expect(result.recursive).toBe(false);
    expect(result.autoAccept).toBe(false);
    expect(result.language).toBe('en-US');
    expect(result.minConfidence).toBe(85);
    expect(result.template).toBeUndefined();
  });

  // --- Null / non-object ---

  it('should throw for null input', () => {
    expect(() => validatePipelineOptions(null)).toThrow('Invalid pipeline options');
  });

  it('should throw for string input', () => {
    expect(() => validatePipelineOptions('not an object')).toThrow('Invalid pipeline options');
  });

  it('should throw for undefined input', () => {
    expect(() => validatePipelineOptions(undefined)).toThrow('Invalid pipeline options');
  });

  // --- Directory validation ---

  it('should throw for missing directory', () => {
    expect(() => validatePipelineOptions({ apiKey: 'abc' })).toThrow(
      'Directory must be a non-empty string',
    );
  });

  it('should throw for empty directory', () => {
    expect(() => validatePipelineOptions({ directory: '', apiKey: 'abc' })).toThrow(
      'Directory must be a non-empty string',
    );
  });

  it('should throw for non-string directory', () => {
    expect(() => validatePipelineOptions({ directory: 42, apiKey: 'abc' })).toThrow(
      'Directory must be a non-empty string',
    );
  });

  // --- API key validation ---

  it('should throw for missing API key', () => {
    expect(() => validatePipelineOptions({ directory: '/tmp' })).toThrow(
      'API key must be a non-empty string',
    );
  });

  it('should throw for empty API key', () => {
    expect(() => validatePipelineOptions({ directory: '/tmp', apiKey: '' })).toThrow(
      'API key must be a non-empty string',
    );
  });

  it('should throw for oversized API key', () => {
    const longKey = 'x'.repeat(MAX_API_KEY_LENGTH + 1);
    expect(() => validatePipelineOptions({ directory: '/tmp', apiKey: longKey })).toThrow(
      `API key too long (max ${MAX_API_KEY_LENGTH} characters)`,
    );
  });

  it('should accept API key at maximum length', () => {
    const maxKey = 'x'.repeat(MAX_API_KEY_LENGTH);
    const result = validatePipelineOptions({ directory: '/tmp', apiKey: maxKey });
    expect(result.apiKey).toBe(maxKey);
  });

  // --- Boolean coercion ---

  it('should coerce non-true values to false for booleans', () => {
    const result = validatePipelineOptions({
      directory: '/tmp',
      apiKey: 'abc',
      dryRun: 'yes',
      recursive: 1,
      autoAccept: {},
    });
    expect(result.dryRun).toBe(false);
    expect(result.recursive).toBe(false);
    expect(result.autoAccept).toBe(false);
  });

  // --- Language validation ---

  it('should accept valid language codes', () => {
    expect(validatePipelineOptions({ ...validOptions, language: 'en-US' }).language).toBe('en-US');
    expect(validatePipelineOptions({ ...validOptions, language: 'ja' }).language).toBe('ja');
    expect(validatePipelineOptions({ ...validOptions, language: 'pt-BR' }).language).toBe('pt-BR');
  });

  it('should default to en-US for invalid language codes', () => {
    expect(validatePipelineOptions({ ...validOptions, language: 'invalid' }).language).toBe('en-US');
    expect(validatePipelineOptions({ ...validOptions, language: '' }).language).toBe('en-US');
    expect(validatePipelineOptions({ ...validOptions, language: 123 }).language).toBe('en-US');
    expect(validatePipelineOptions({ ...validOptions, language: 'EN-us' }).language).toBe('en-US');
  });

  // --- Min confidence clamping ---

  it('should clamp minConfidence to [0, 100]', () => {
    expect(
      validatePipelineOptions({ ...validOptions, minConfidence: -10 }).minConfidence,
    ).toBe(0);
    expect(
      validatePipelineOptions({ ...validOptions, minConfidence: 200 }).minConfidence,
    ).toBe(100);
    expect(
      validatePipelineOptions({ ...validOptions, minConfidence: 50 }).minConfidence,
    ).toBe(50);
  });

  it('should default minConfidence to 85 for non-numeric values', () => {
    expect(
      validatePipelineOptions({ ...validOptions, minConfidence: 'high' }).minConfidence,
    ).toBe(85);
    expect(
      validatePipelineOptions({ ...validOptions, minConfidence: NaN }).minConfidence,
    ).toBe(85);
    expect(
      validatePipelineOptions({ ...validOptions, minConfidence: Infinity }).minConfidence,
    ).toBe(85);
  });

  // --- Template validation ---

  it('should throw for oversized template', () => {
    const longTemplate = 'x'.repeat(MAX_TEMPLATE_LENGTH + 1);
    expect(() =>
      validatePipelineOptions({ ...validOptions, template: longTemplate }),
    ).toThrow(`Template too long (max ${MAX_TEMPLATE_LENGTH} characters)`);
  });

  it('should accept template at maximum length', () => {
    const maxTemplate = 'x'.repeat(MAX_TEMPLATE_LENGTH);
    const result = validatePipelineOptions({ ...validOptions, template: maxTemplate });
    expect(result.template).toBe(maxTemplate);
  });

  it('should omit template when empty string', () => {
    const result = validatePipelineOptions({ ...validOptions, template: '' });
    expect(result.template).toBeUndefined();
  });

});

// ---------------------------------------------------------------------------
// sanitizeErrorMessage
// ---------------------------------------------------------------------------

describe('sanitizeErrorMessage', () => {
  it('should return generic message for non-Error values', () => {
    expect(sanitizeErrorMessage('string error')).toBe('An unexpected error occurred');
    expect(sanitizeErrorMessage(null)).toBe('An unexpected error occurred');
    expect(sanitizeErrorMessage(42)).toBe('An unexpected error occurred');
    expect(sanitizeErrorMessage(undefined)).toBe('An unexpected error occurred');
  });

  it('should strip absolute file paths from error messages', () => {
    const err = new Error('Failed to read /Users/john/secret/file.txt');
    expect(sanitizeErrorMessage(err)).toBe('Failed to read <path>');
  });

  it('should strip multiple paths from error messages', () => {
    const err = new Error('Cannot copy /src/a.txt to /dest/b.txt');
    expect(sanitizeErrorMessage(err)).toBe('Cannot copy <path> to <path>');
  });

  it('should pass through AuthenticationError messages', () => {
    const err = new Error('Invalid API key');
    err.name = 'AuthenticationError';
    expect(sanitizeErrorMessage(err)).toBe('Invalid API key');
  });

  it('should pass through FatalError messages', () => {
    const err = new Error('Something went very wrong at /secret/path');
    err.name = 'FatalError';
    expect(sanitizeErrorMessage(err)).toBe('Something went very wrong at /secret/path');
  });

  it('should leave messages without paths unchanged', () => {
    const err = new Error('Something failed');
    expect(sanitizeErrorMessage(err)).toBe('Something failed');
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('validation constants', () => {
  it('should validate language regex correctly', () => {
    expect(VALID_LANGUAGE_RE.test('en')).toBe(true);
    expect(VALID_LANGUAGE_RE.test('en-US')).toBe(true);
    expect(VALID_LANGUAGE_RE.test('ja')).toBe(true);
    expect(VALID_LANGUAGE_RE.test('pt-BR')).toBe(true);
    expect(VALID_LANGUAGE_RE.test('EN')).toBe(false);
    expect(VALID_LANGUAGE_RE.test('en-us')).toBe(false);
    expect(VALID_LANGUAGE_RE.test('')).toBe(false);
    expect(VALID_LANGUAGE_RE.test('english')).toBe(false);
  });

  it('should have expected max lengths', () => {
    expect(MAX_API_KEY_LENGTH).toBe(1024);
    expect(MAX_TEMPLATE_LENGTH).toBe(500);
  });
});
