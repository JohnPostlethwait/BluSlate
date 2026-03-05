import * as path from 'node:path';
import * as os from 'node:os';

function isWindows(): boolean {
  return process.platform === 'win32';
}

export function getConfigDir(): string {
  const xdgConfig = process.env['XDG_CONFIG_HOME'];
  if (xdgConfig) {
    return path.join(xdgConfig, 'bluslate');
  }

  if (isWindows()) {
    const appData = process.env['APPDATA'];
    if (appData) {
      return path.join(appData, 'bluslate');
    }
  }

  return path.join(os.homedir(), '.config', 'bluslate');
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'config.json');
}
