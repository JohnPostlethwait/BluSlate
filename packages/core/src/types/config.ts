export interface AppConfig {
  apiKey: string;
  directory: string;
  dryRun: boolean;
  template?: string;
  recursive: boolean;
  verbose: boolean;
  autoAccept: boolean;
  minConfidence: number;
  language: string;
}

export const DEFAULT_TEMPLATE = '{show_name} - S{season}E{episode} - {episode_title}';
