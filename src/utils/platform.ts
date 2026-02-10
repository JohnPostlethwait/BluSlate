import * as path from 'node:path';
import * as os from 'node:os';

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function getConfigDir(): string {
  const xdgConfig = process.env['XDG_CONFIG_HOME'];
  if (xdgConfig) {
    return path.join(xdgConfig, 'mediafetch');
  }

  if (isWindows()) {
    const appData = process.env['APPDATA'];
    if (appData) {
      return path.join(appData, 'mediafetch');
    }
  }

  return path.join(os.homedir(), '.config', 'mediafetch');
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'config.json');
}
