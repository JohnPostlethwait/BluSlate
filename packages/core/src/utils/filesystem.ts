import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { constants } from 'node:fs';
import { VIDEO_EXTENSIONS } from '../types/media.js';
import { logger } from './logger.js';

export function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Atomically rename a file, avoiding overwrites via race-safe collision handling.
 *
 * Instead of check-then-rename (TOCTOU vulnerable), we attempt the rename
 * and verify the target doesn't already exist atomically using O_CREAT|O_EXCL
 * as a lock file. If a collision is detected, we increment a counter suffix.
 */
export async function safeRename(oldPath: string, newPath: string): Promise<string> {
  const maxAttempts = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const targetPath = attempt === 0
      ? newPath
      : appendCounter(newPath, attempt);

    try {
      // Atomically create a placeholder file — fails with EEXIST if target already exists.
      // This eliminates the TOCTOU gap between checking existence and renaming.
      const handle = await fs.open(targetPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      await handle.close();

      // Placeholder created — now rename over it (safe, we own the target path)
      try {
        await fs.rename(oldPath, targetPath);
        return targetPath;
      } catch (renameErr) {
        // Clean up the orphaned placeholder so it doesn't block future renames
        try { await fs.unlink(targetPath); } catch { logger.warn(`Failed to clean up placeholder: ${targetPath}`); }
        throw renameErr;
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        // Target already exists — try next counter
        continue;
      }
      // Unexpected error — propagate
      throw err;
    }
  }

  throw new Error(`Could not find a unique filename after ${maxAttempts} attempts: ${newPath}`);
}

function appendCounter(filePath: string, counter: number): string {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return path.join(dir, `${base} (${counter})${ext}`);
}
