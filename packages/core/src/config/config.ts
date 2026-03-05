import * as fs from 'node:fs/promises';
import { getConfigFilePath, getConfigDir } from '../utils/platform.js';
import { logger } from '../utils/logger.js';
import type { AppConfig } from '../types/config.js';

interface ConfigFile {
  apiKey?: string;
  template?: string;
  language?: string;
}

export async function loadApiKey(cliKey?: string): Promise<string | undefined> {
  // Priority: CLI flag > env var > config file
  if (cliKey) return cliKey;

  const envKey = process.env['TMDB_API_KEY'];
  if (envKey) return envKey;

  try {
    const configPath = getConfigFilePath();
    const raw = await fs.readFile(configPath, 'utf-8');
    const config: ConfigFile = JSON.parse(raw);
    return config.apiKey;
  } catch {
    return undefined;
  }
}

export async function saveApiKey(apiKey: string): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });

  const configPath = getConfigFilePath();
  let config: ConfigFile = {};

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    // No existing config file
  }

  config.apiKey = apiKey;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  logger.info(`API key saved to ${configPath}`);
}

export async function buildConfig(options: {
  directory: string;
  apiKey?: string;
  dryRun?: boolean;
  template?: string;
  recursive?: boolean;
  verbose?: boolean;
  yes?: boolean;
  minConfidence?: number;
  lang?: string;
}): Promise<AppConfig> {
  const apiKey = await loadApiKey(options.apiKey);

  if (!apiKey) {
    throw new Error(
      'TMDb API key is required. Set it via:\n' +
      '  1. --api-key flag\n' +
      '  2. TMDB_API_KEY environment variable\n' +
      '  3. Run "bluslate config" to save it\n\n' +
      'Get a free API key at: https://www.themoviedb.org/settings/api'
    );
  }

  return {
    apiKey,
    directory: options.directory,
    dryRun: options.dryRun ?? false,
    template: options.template,
    recursive: options.recursive ?? false,
    verbose: options.verbose ?? false,
    autoAccept: options.yes ?? false,
    minConfidence: options.minConfidence ?? 85,
    language: options.lang ?? 'en-US',
  };
}
