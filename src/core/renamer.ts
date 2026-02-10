import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { safeRename } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';
import type { MatchResult } from '../types/media.js';

export interface RenameEntry {
  from: string;
  to: string;
}

export interface RenameLog {
  timestamp: string;
  renames: RenameEntry[];
}

export async function executeRenames(
  matches: MatchResult[],
  dryRun: boolean,
): Promise<RenameEntry[]> {
  const renames: RenameEntry[] = [];

  for (const match of matches) {
    if (match.status === 'unmatched') continue;
    if (match.newFilename === match.mediaFile.fileName) {
      logger.debug(`Skipping (already named correctly): ${match.mediaFile.fileName}`);
      continue;
    }

    const dir = path.dirname(match.mediaFile.filePath);
    const newPath = path.resolve(dir, match.newFilename);

    // Defense-in-depth: verify the resolved path stays within the source directory.
    // sanitizeFilename() should strip path separators, but this catches any bypass.
    const resolvedDir = path.resolve(dir);
    if (!newPath.startsWith(resolvedDir + path.sep)) {
      logger.error(
        `Skipping "${match.mediaFile.fileName}": new filename would escape source directory`,
      );
      continue;
    }

    if (dryRun) {
      logger.rename(`[DRY RUN] ${match.mediaFile.fileName} -> ${match.newFilename}`);
      renames.push({ from: match.mediaFile.fileName, to: match.newFilename });
      continue;
    }

    try {
      const actualPath = await safeRename(match.mediaFile.filePath, newPath);
      const actualName = path.basename(actualPath);
      logger.rename(`${match.mediaFile.fileName} -> ${actualName}`);
      renames.push({ from: match.mediaFile.fileName, to: actualName });
    } catch (err) {
      logger.error(`Failed to rename ${match.mediaFile.fileName}: ${err}`);
    }
  }

  return renames;
}

export async function writeRenameLog(
  directory: string,
  renames: RenameEntry[],
): Promise<void> {
  if (renames.length === 0) return;

  const logPath = path.join(directory, '.mediafetch-log.json');
  const log: RenameLog = {
    timestamp: new Date().toISOString(),
    renames,
  };

  try {
    await fs.writeFile(logPath, JSON.stringify(log, null, 2) + '\n');
    logger.info(`Rename log written to ${logPath}`);
  } catch (err) {
    logger.warn(`Could not write rename log: ${err}`);
  }
}
