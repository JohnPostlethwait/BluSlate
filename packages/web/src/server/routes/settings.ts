import type { FastifyInstance } from 'fastify';
import { loadSettings, saveSettings } from '../settings.js';
import { MAX_API_KEY_LENGTH } from '@bluslate/core';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => {
    const settings = await loadSettings();
    return {
      apiKey: settings.apiKey,
      recentDirectories: settings.recentDirectories,
      language: settings.language,
      template: settings.template,
      minConfidence: settings.minConfidence,
    };
  });

  app.post('/api/settings/api-key', async (request, reply) => {
    const { apiKey } = request.body as { apiKey?: string };
    if (typeof apiKey !== 'string' || apiKey.length === 0 || apiKey.length > MAX_API_KEY_LENGTH) {
      return reply.status(400).send({ error: 'Invalid API key' });
    }
    const settings = await loadSettings();
    settings.apiKey = apiKey;
    await saveSettings(settings);
    return { ok: true };
  });

  app.get('/api/settings/recent-directories', async () => {
    const settings = await loadSettings();
    return { directories: settings.recentDirectories };
  });
}
