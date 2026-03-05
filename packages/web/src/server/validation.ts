/**
 * Input validation and error sanitization — adapted from the Electron GUI's
 * validation.ts but without Electron dependencies.
 */

import { resolve, isAbsolute } from 'node:path';

export const VALID_LANGUAGE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
export const MAX_API_KEY_LENGTH = 1024;
export const MAX_TEMPLATE_LENGTH = 500;

export interface ValidatedPipelineOptions {
  directory: string;
  apiKey: string;
  dryRun: boolean;
  recursive: boolean;
  language: string;
  autoAccept: boolean;
  minConfidence: number;
  template?: string;
}

export function validatePipelineOptions(options: unknown): ValidatedPipelineOptions {
  if (typeof options !== 'object' || options === null) {
    throw new Error('Invalid pipeline options');
  }

  const opts = options as Record<string, unknown>;

  if (typeof opts.directory !== 'string' || opts.directory.length === 0) {
    throw new Error('Directory must be a non-empty string');
  }
  const resolvedDir = resolve(opts.directory);
  if (!isAbsolute(resolvedDir)) {
    throw new Error('Directory must be an absolute path');
  }

  if (typeof opts.apiKey !== 'string' || opts.apiKey.length === 0) {
    throw new Error('API key must be a non-empty string');
  }
  if (opts.apiKey.length > MAX_API_KEY_LENGTH) {
    throw new Error(`API key too long (max ${MAX_API_KEY_LENGTH} characters)`);
  }

  const dryRun = opts.dryRun === true;
  const recursive = opts.recursive === true;
  const autoAccept = opts.autoAccept === true;

  const language = typeof opts.language === 'string' && VALID_LANGUAGE_RE.test(opts.language)
    ? opts.language
    : 'en-US';

  let minConfidence = 85;
  if (typeof opts.minConfidence === 'number' && Number.isFinite(opts.minConfidence)) {
    minConfidence = Math.max(0, Math.min(100, opts.minConfidence));
  }

  let template: string | undefined;
  if (typeof opts.template === 'string' && opts.template.length > 0) {
    if (opts.template.length > MAX_TEMPLATE_LENGTH) {
      throw new Error(`Template too long (max ${MAX_TEMPLATE_LENGTH} characters)`);
    }
    template = opts.template;
  }

  return { directory: resolvedDir, apiKey: opts.apiKey, dryRun, recursive, language, autoAccept, minConfidence, template };
}

export function sanitizeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'An unexpected error occurred';

  if (err.name === 'AuthenticationError' || err.name === 'FatalError') {
    return err.message;
  }

  return err.message.replace(/\/[^\s:]+/g, '<path>');
}
