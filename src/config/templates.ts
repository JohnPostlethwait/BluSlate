import { DEFAULT_TEMPLATES } from '../types/config.js';
import { MediaType } from '../types/media.js';
import type { TmdbMatchedItem } from '../types/media.js';
import { sanitizeFilename } from '../utils/sanitize.js';

export function getTemplate(mediaType: MediaType, customTemplate?: string): string {
  if (customTemplate) return customTemplate;
  return mediaType === MediaType.TV ? DEFAULT_TEMPLATES.tv : DEFAULT_TEMPLATES.movie;
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
