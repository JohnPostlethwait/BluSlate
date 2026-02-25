// Universal: union of all illegal/problematic chars across Windows, macOS, and Linux
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const CONSECUTIVE_SPACES = /\s{2,}/g;
const TRAILING_DOTS_SPACES = /[.\s]+$/;
const LEADING_DOTS_SPACES = /^[.\s]+/;

/**
 * Windows reserved device names. These cannot be used as filenames on Windows
 * regardless of extension (e.g., "CON.txt" is also invalid).
 * Matches: CON, PRN, AUX, NUL, COM0-COM9, LPT0-LPT9
 */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;

const MAX_FILENAME_LENGTH = 250; // Leave room for extension

export function sanitizeFilename(name: string): string {
  // Reject null bytes early (defense-in-depth before regex)
  if (name.includes('\0')) {
    name = name.replace(/\0/g, '');
  }

  let sanitized = name
    .normalize('NFC')
    .replace(/:/g, ' -')
    .replace(ILLEGAL_CHARS, '')
    .replace(CONSECUTIVE_SPACES, ' ')
    .replace(TRAILING_DOTS_SPACES, '')
    .replace(LEADING_DOTS_SPACES, '')
    .trim();

  if (sanitized.length > MAX_FILENAME_LENGTH) {
    sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH).trim();
  }

  if (sanitized.length === 0) {
    sanitized = 'unnamed';
  }

  // On Windows, prefix reserved device names to prevent filesystem issues.
  // Check the base name (without extension) against reserved names.
  if (process.platform === 'win32') {
    const dotIndex = sanitized.indexOf('.');
    const baseName = dotIndex >= 0 ? sanitized.substring(0, dotIndex) : sanitized;
    if (WINDOWS_RESERVED.test(baseName.trim())) {
      sanitized = `_${sanitized}`;
    }
  }

  return sanitized;
}
