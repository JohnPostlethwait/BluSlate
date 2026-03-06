/**
 * Fatal errors that should abort the entire pipeline immediately.
 * These are not recoverable on a per-file basis.
 */
export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}

/**
 * Thrown when the TMDb API key is missing or invalid.
 */
export class AuthenticationError extends FatalError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when the user cancels the pipeline mid-execution.
 * Used by GUI and Web adapters to unwind the pipeline cleanly.
 */
export class PipelineCancelledError extends Error {
  constructor() {
    super('Pipeline cancelled by user');
    this.name = 'PipelineCancelledError';
  }
}
