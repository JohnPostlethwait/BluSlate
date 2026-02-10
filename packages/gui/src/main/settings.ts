import { app } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

export interface AppSettings {
  apiKey?: string;
  recentDirectories: string[];
  windowBounds?: { x: number; y: number; width: number; height: number };
}

const DEFAULT_SETTINGS: AppSettings = {
  recentDirectories: [],
};

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const data = await readFile(getSettingsPath(), 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  await writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export async function addRecentDirectory(dir: string): Promise<AppSettings> {
  const settings = await loadSettings();
  // Remove if already present, then prepend
  settings.recentDirectories = settings.recentDirectories.filter((d) => d !== dir);
  settings.recentDirectories.unshift(dir);
  // Keep only the 10 most recent
  settings.recentDirectories = settings.recentDirectories.slice(0, 10);
  await saveSettings(settings);
  return settings;
}
