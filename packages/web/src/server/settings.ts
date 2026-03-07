/**
 * Settings persistence for the web server.
 *
 * Stores settings in a JSON file at BLUSLATE_DATA/settings.json.
 * Falls back to TMDB_API_KEY env var for pre-configured API keys.
 */

import { join } from 'node:path';
import os from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { VALID_LANGUAGE_RE, MAX_TEMPLATE_LENGTH } from '@bluslate/core';

export interface AppSettings {
  apiKey?: string;
  recentDirectories: string[];
  language: string;
  template?: string;
  minConfidence: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  recentDirectories: [],
  language: 'en-US',
  minConfidence: 85,
};

function getDataDir(): string {
  if (process.env.BLUSLATE_DATA) return process.env.BLUSLATE_DATA;
  // Docker default is /data; outside Docker fall back to a user-writable XDG path
  return join(os.homedir(), '.local', 'share', 'bluslate');
}

function getSettingsPath(): string {
  return join(getDataDir(), 'settings.json');
}

/** Environment variables take precedence over saved settings */
function applyEnvOverrides(settings: AppSettings): void {
  if (process.env.TMDB_API_KEY) {
    settings.apiKey = process.env.TMDB_API_KEY;
  }
  if (process.env.BLUSLATE_LANGUAGE) {
    if (VALID_LANGUAGE_RE.test(process.env.BLUSLATE_LANGUAGE)) {
      settings.language = process.env.BLUSLATE_LANGUAGE;
    } else {
      console.warn(`Warning: BLUSLATE_LANGUAGE="${process.env.BLUSLATE_LANGUAGE}" is invalid (expected format: en-US), using default`);
    }
  }
  if (process.env.BLUSLATE_TEMPLATE) {
    if (process.env.BLUSLATE_TEMPLATE.length <= MAX_TEMPLATE_LENGTH) {
      settings.template = process.env.BLUSLATE_TEMPLATE;
    } else {
      console.warn(`Warning: BLUSLATE_TEMPLATE exceeds ${MAX_TEMPLATE_LENGTH} characters, ignoring`);
    }
  }
  if (process.env.BLUSLATE_MIN_CONFIDENCE) {
    const parsed = parseInt(process.env.BLUSLATE_MIN_CONFIDENCE, 10);
    if (Number.isFinite(parsed)) {
      settings.minConfidence = Math.max(0, Math.min(100, parsed));
    }
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const data = await readFile(getSettingsPath(), 'utf-8');
    const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    applyEnvOverrides(settings);
    return settings;
  } catch {
    const settings = { ...DEFAULT_SETTINGS };
    applyEnvOverrides(settings);
    return settings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const dir = getDataDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export async function addRecentDirectory(dir: string): Promise<AppSettings> {
  const settings = await loadSettings();
  settings.recentDirectories = settings.recentDirectories.filter((d) => d !== dir);
  settings.recentDirectories.unshift(dir);
  settings.recentDirectories = settings.recentDirectories.slice(0, 10);
  await saveSettings(settings);
  return settings;
}
