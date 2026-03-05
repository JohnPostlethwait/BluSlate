import type { FastifyInstance } from 'fastify';
import { undoRenames } from '@bluslate/core';

export async function undoRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/undo', async (request) => {
    const { directory } = request.body as { directory?: string };
    if (!directory || typeof directory !== 'string') {
      return { restored: 0, failed: 0 };
    }
    return undoRenames(directory);
  });
}
