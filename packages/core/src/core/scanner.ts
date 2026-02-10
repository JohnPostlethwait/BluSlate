import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isVideoFile } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';
import type { MediaFile } from '../types/media.js';

export async function scanDirectory(
  directory: string,
  recursive: boolean = false,
): Promise<MediaFile[]> {
  const absoluteDir = path.resolve(directory);
  logger.scan(`Scanning ${absoluteDir}${recursive ? ' (recursive)' : ''}`);

  const entries = await fs.readdir(absoluteDir, {
    withFileTypes: true,
    recursive,
  });

  const mediaFiles: MediaFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    // Skip symlinks — they could point outside the scan directory
    if (entry.isSymbolicLink()) continue;

    const parentDir = entry.parentPath ?? absoluteDir;
    const fullPath = path.join(parentDir, entry.name);

    // Skip hidden files
    if (entry.name.startsWith('.')) continue;

    if (!isVideoFile(entry.name)) continue;

    try {
      // Use lstat to avoid following symlinks for size info
      const stat = await fs.lstat(fullPath);
      mediaFiles.push({
        filePath: fullPath,
        fileName: entry.name,
        extension: path.extname(entry.name).toLowerCase(),
        sizeBytes: stat.size,
      });
    } catch (err) {
      logger.warn(`Could not stat file: ${fullPath}`, err);
    }
  }

  logger.scan(`Found ${mediaFiles.length} media file(s)`);
  return mediaFiles.sort((a, b) => a.filePath.localeCompare(b.filePath));
}
