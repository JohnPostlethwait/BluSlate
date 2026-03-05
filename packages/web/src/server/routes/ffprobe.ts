import type { FastifyInstance } from 'fastify';
import { isFfprobeAvailable } from '@bluslate/core';

let ffprobeReady: boolean | null = null;

export async function initFfprobe(): Promise<void> {
  ffprobeReady = await isFfprobeAvailable();
}

export async function ffprobeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/ffprobe/check', async () => {
    if (ffprobeReady === null) {
      ffprobeReady = await isFfprobeAvailable();
    }
    return { available: ffprobeReady };
  });
}
