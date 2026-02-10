import type { MediaType } from './media.js';

export interface AppConfig {
  apiKey: string;
  directory: string;
  dryRun: boolean;
  mediaType: MediaType | 'auto';
  template?: string;
  recursive: boolean;
  verbose: boolean;
  autoAccept: boolean;
  minConfidence: number;
  language: string;
}

export interface NamingTemplate {
  tv: string;
  movie: string;
}

export const DEFAULT_TEMPLATES: NamingTemplate = {
  tv: '{show_name} - S{season}E{episode} - {episode_title}',
  movie: '{title} ({year})',
};
