import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import { undoRenames } from '@bluslate/core';

function getMediaRoot(): string {
  return resolve(process.env.MEDIA_ROOT || '/media');
}

export async function undoRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/undo', async (request, reply) => {
    const { directory } = request.body as { directory?: string };
    if (!directory || typeof directory !== 'string') {
      return { restored: 0, failed: 0 };
    }

    const resolvedDir = resolve(directory);
    const mediaRoot = getMediaRoot();
    if (!resolvedDir.startsWith(mediaRoot)) {
      return reply.status(403).send({ error: 'Access denied: path outside media root' });
    }

    return undoRenames(resolvedDir);
  });
}
