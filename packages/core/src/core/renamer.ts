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
      // Already named correctly — no filesystem operation needed, but still
      // count as successfully processed so summaries are accurate.
      logger.debug(`Already named correctly: ${match.mediaFile.fileName}`);
      renames.push({ from: match.mediaFile.fileName, to: match.newFilename });
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

export async function undoRenames(
  directory: string,
): Promise<{ restored: number; failed: number }> {
  const logPath = path.join(directory, '.mediafetch-log.json');
  let logData: unknown;

  try {
    const raw = await fs.readFile(logPath, 'utf-8');
    logData = JSON.parse(raw);
  } catch (err) {
    logger.error(`Could not read rename log: ${err}`);
    return { restored: 0, failed: 0 };
  }

  // Validate schema: must have a renames array with {from: string, to: string} entries
  const parsed = logData as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.renames) || parsed.renames.length === 0) {
    logger.warn('Rename log is empty or invalid');
    return { restored: 0, failed: 0 };
  }

  const validRenames = parsed.renames.filter(
    (entry: unknown): entry is RenameEntry =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).from === 'string' &&
      typeof (entry as Record<string, unknown>).to === 'string' &&
      (entry as Record<string, unknown>).from !== '' &&
      (entry as Record<string, unknown>).to !== '',
  );

  if (validRenames.length === 0) {
    logger.warn('Rename log contains no valid entries');
    return { restored: 0, failed: 0 };
  }

  if (validRenames.length < parsed.renames.length) {
    logger.warn(`Skipping ${parsed.renames.length - validRenames.length} malformed entries in rename log`);
  }

  let restored = 0;
  let failed = 0;
  const resolvedDir = path.resolve(directory);

  for (const entry of validRenames) {
    const currentPath = path.join(directory, entry.to);
    const originalPath = path.join(directory, entry.from);

    // Defense-in-depth: verify paths stay within directory
    if (
      !path.resolve(currentPath).startsWith(resolvedDir + path.sep) ||
      !path.resolve(originalPath).startsWith(resolvedDir + path.sep)
    ) {
      logger.error(`Skipping undo for "${entry.to}": path would escape directory`);
      failed++;
      continue;
    }

    try {
      await safeRename(currentPath, originalPath);
      logger.rename(`[UNDO] ${entry.to} -> ${entry.from}`);
      restored++;
    } catch (err) {
      logger.error(`Failed to undo "${entry.to}": ${err}`);
      failed++;
    }
  }

  // Clean up log file if all renames were restored
  if (failed === 0) {
    try {
      await fs.unlink(logPath);
      logger.info(`Removed rename log: ${logPath}`);
    } catch (err) {
      logger.warn(`Could not remove rename log: ${err}`);
    }
  }

  return { restored, failed };
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
