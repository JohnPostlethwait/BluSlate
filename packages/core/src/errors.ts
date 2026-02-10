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
