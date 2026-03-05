import { DEFAULT_TEMPLATE } from '../types/config.js';
import type { TmdbMatchedItem } from '../types/media.js';
import { sanitizeFilename } from '../utils/sanitize.js';

const MAX_TEMPLATE_LENGTH = 500;
const VALID_PLACEHOLDERS = new Set([
  '{show_name}', '{title}', '{year}', '{season}',
  '{episode}', '{episode_title}', '{ext}',
]);

export function getTemplate(customTemplate?: string): string {
  if (customTemplate) {
    if (customTemplate.length > MAX_TEMPLATE_LENGTH) {
      throw new Error(`Template too long (max ${MAX_TEMPLATE_LENGTH} characters)`);
    }
    // Validate that only known placeholders are used
    const placeholders = customTemplate.match(/\{[^}]+\}/g) ?? [];
    for (const placeholder of placeholders) {
      if (!VALID_PLACEHOLDERS.has(placeholder)) {
        throw new Error(`Unknown template placeholder: ${placeholder}`);
      }
    }
    return customTemplate;
  }
  return DEFAULT_TEMPLATE;
}

export function renderTemplate(template: string, item: TmdbMatchedItem, extension: string): string {
  const pad = (n: number | undefined, width: number): string => {
    if (n === undefined) return '';
    return String(n).padStart(width, '0');
  };

  let rendered = template
    .replace(/\{show_name\}/g, item.name)
    .replace(/\{title\}/g, item.name)
    .replace(/\{year\}/g, item.year !== undefined ? String(item.year) : '')
    .replace(/\{season\}/g, pad(item.seasonNumber, 2))
    .replace(/\{episode\}/g, () => {
      const start = pad(item.episodeNumber, 2);
      if (item.episodeNumberEnd && item.episodeNumberEnd !== item.episodeNumber) {
        return `${start}-${pad(item.episodeNumberEnd, 2)}`;
      }
      return start;
    })
    .replace(/\{episode_title\}/g, item.episodeTitle ?? '')
    .replace(/\{ext\}/g, extension);

  // Clean up empty segments (e.g., " - " when episode_title is missing)
  rendered = rendered.replace(/\s*-\s*$/g, '').trim();

  return sanitizeFilename(rendered) + extension;
}
