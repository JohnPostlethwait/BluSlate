import type { FastifyInstance } from 'fastify';
import { renderTemplate, getTemplate } from '@bluslate/core';

export async function filenamesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/regenerate-filenames', async (request) => {
    const { items } = request.body as {
      items: Array<{ tmdbMatch: Record<string, unknown>; extension: string }>;
    };

    if (!Array.isArray(items)) {
      return { filenames: [] };
    }

    const template = getTemplate();
    const filenames = items.map((item) => {
      if (!item.tmdbMatch) return '';
      const tmdbMatch = item.tmdbMatch as unknown as Parameters<typeof renderTemplate>[1];
      return renderTemplate(template, tmdbMatch, item.extension);
    });

    return { filenames };
  });
}
