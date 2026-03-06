import type { FastifyInstance } from 'fastify';
import { renderTemplate, getTemplate } from '@bluslate/core';

export async function filenamesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/regenerate-filenames', async (request, reply) => {
    const { items } = request.body as {
      items: Array<{ tmdbMatch: Record<string, unknown>; extension: string }>;
    };

    if (!Array.isArray(items)) {
      return reply.status(400).send({ error: 'Items must be an array' });
    }

    const template = getTemplate();
    try {
      const filenames = items.map((item) => {
        if (!item.tmdbMatch) return '';
        const tmdbMatch = item.tmdbMatch as unknown as Parameters<typeof renderTemplate>[1];
        return renderTemplate(template, tmdbMatch, item.extension);
      });

      return { filenames };
    } catch (err) {
      return reply.status(500).send({ error: `Filename generation failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
    }
  });
}
