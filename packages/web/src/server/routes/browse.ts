import type { FastifyInstance } from 'fastify';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const MEDIA_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.ts', '.m2ts', '.wmv', '.mov']);

function getMediaRoot(): string {
  return process.env.MEDIA_ROOT || '/media';
}

export async function browseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/browse', async (request, reply) => {
    const { path: requestedPath } = request.query as { path?: string };
    const mediaRoot = resolve(getMediaRoot());

    // Default to media root if no path specified
    const targetPath = requestedPath ? resolve(requestedPath) : mediaRoot;

    // Path traversal prevention: must be within MEDIA_ROOT
    if (!targetPath.startsWith(mediaRoot)) {
      return reply.status(403).send({ error: 'Access denied: path outside media root' });
    }

    try {
      const dirStat = await stat(targetPath);
      if (!dirStat.isDirectory()) {
        return reply.status(400).send({ error: 'Not a directory' });
      }

      const entries = await readdir(targetPath, { withFileTypes: true });
      const result: Array<{ name: string; type: 'directory' | 'file'; size?: number; mediaCount?: number }> = [];

      for (const entry of entries) {
        // Skip hidden files/dirs
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          // Count media files in subdirectory (one level deep, for display)
          let mediaCount = 0;
          try {
            const subEntries = await readdir(join(targetPath, entry.name), { withFileTypes: true });
            mediaCount = subEntries.filter((e) => {
              if (!e.isFile()) return false;
              const ext = e.name.substring(e.name.lastIndexOf('.')).toLowerCase();
              return MEDIA_EXTENSIONS.has(ext);
            }).length;
          } catch {
            // Can't read subdirectory — that's OK
          }
          result.push({ name: entry.name, type: 'directory', mediaCount });
        } else if (entry.isFile()) {
          const ext = entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase();
          if (MEDIA_EXTENSIONS.has(ext)) {
            try {
              const fileStat = await stat(join(targetPath, entry.name));
              result.push({ name: entry.name, type: 'file', size: fileStat.size });
            } catch {
              result.push({ name: entry.name, type: 'file' });
            }
          }
        }
      }

      // Sort: directories first (alphabetical), then files (alphabetical)
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return {
        path: targetPath,
        mediaRoot,
        entries: result,
      };
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to read directory' });
    }
  });
}
