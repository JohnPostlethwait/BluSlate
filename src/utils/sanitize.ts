const WINDOWS_ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;
const UNIX_ILLEGAL = /[/\x00-\x1f]/g;
const CONSECUTIVE_SPACES = /\s{2,}/g;
const TRAILING_DOTS_SPACES = /[.\s]+$/;
const LEADING_DOTS_SPACES = /^[.\s]+/;

const MAX_FILENAME_LENGTH = 250; // Leave room for extension

export function sanitizeFilename(name: string): string {
  const isWindows = process.platform === 'win32';
  const pattern = isWindows ? WINDOWS_ILLEGAL : UNIX_ILLEGAL;

  let sanitized = name
    .normalize('NFC')
    .replace(pattern, '')
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

  return sanitized;
}
